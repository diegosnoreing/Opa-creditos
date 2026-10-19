import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import type { EventoOutbox } from '../domain/types';
import type { OutboxRepository, ResultadoEnvio } from '../repositories/interfaces';

export interface WebhookConfig {
  url: string;
  secret: string;
  maxAttempts: number;
  timeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  batchSize: number;
  /** Tiempo que un evento reclamado queda reservado para un worker. */
  leaseMs: number;
}

export interface ResumenLote {
  reclamados: number;
  enviados: number;
  reintentos: number;
  fallidos: number;
}

/* ---------------- Firma HMAC ---------------- */

/** Firma "timestamp.cuerpo" con HMAC-SHA256. Incluir el timestamp evita ataques de repeticion. */
export function firmar(secreto: string, timestampSeg: string, cuerpo: string): string {
  return 'sha256=' + createHmac('sha256', secreto).update(`${timestampSeg}.${cuerpo}`).digest('hex');
}

export function verificarFirma(p: {
  secreto: string;
  timestampSeg: string;
  cuerpo: string;
  firma: string;
  ahora?: Date;
  toleranciaSeg?: number;
}): boolean {
  const tolerancia = p.toleranciaSeg ?? 300;
  const ts = Number(p.timestampSeg);
  const ahoraSeg = Math.floor((p.ahora ?? new Date()).getTime() / 1000);
  if (!Number.isFinite(ts) || Math.abs(ahoraSeg - ts) > tolerancia) return false;

  const esperada = Buffer.from(firmar(p.secreto, p.timestampSeg, p.cuerpo));
  const recibida = Buffer.from(p.firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/* ---------------- Reintentos ---------------- */

/**
 * Espera antes del siguiente intento: crece de forma exponencial
 * (base, 2*base, 4*base...) hasta un tope, con "jitter" para que muchos
 * eventos fallidos a la vez no reintenten todos en el mismo instante.
 * `intentosHechos` es la cantidad de intentos ya realizados (>= 1).
 */
export function calcularEspera(intentosHechos: number, baseMs: number, maxMs: number, aleatorio: () => number = Math.random): number {
  const exponencial = Math.min(maxMs, baseMs * 2 ** (intentosHechos - 1));
  return Math.round(exponencial / 2 + (exponencial / 2) * aleatorio());
}

/* ---------------- Despachador ---------------- */

export class WebhookDispatcher {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly cfg: WebhookConfig,
    private readonly logger: Logger,
    private readonly deps: {
      fetchFn?: typeof fetch;
      reloj?: () => Date;
      aleatorio?: () => number;
    } = {},
  ) {}

  /** Procesa un lote de eventos vencidos. Pensado para llamarse en bucle desde el worker. */
  async procesarLote(): Promise<ResumenLote> {
    const ahora = this.reloj();
    const eventos = await this.outbox.tomarPendientes(this.cfg.batchSize, this.cfg.leaseMs, ahora);
    const resumen: ResumenLote = { reclamados: eventos.length, enviados: 0, reintentos: 0, fallidos: 0 };

    for (const evento of eventos) {
      const estado = await this.enviar(evento);
      if (estado === 'ENVIADO') resumen.enviados += 1;
      else if (estado === 'PENDIENTE') resumen.reintentos += 1;
      else resumen.fallidos += 1;
    }
    return resumen;
  }

  private async enviar(evento: EventoOutbox): Promise<ResultadoEnvio['nuevoEstado']> {
    const fetchFn = this.deps.fetchFn ?? fetch;
    const inicio = Date.now();
    const timestampSeg = String(Math.floor(this.reloj().getTime() / 1000));

    let codigoHttp: number | null = null;
    let error: string | null = null;
    let exito = false;

    try {
      const respuesta = await fetchFn(this.cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'opa-creditos-webhook/1.0',
          'X-Webhook-Id': evento.eventId,
          'X-Webhook-Timestamp': timestampSeg,
          'X-Webhook-Signature': firmar(this.cfg.secret, timestampSeg, evento.payload),
        },
        body: evento.payload,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        redirect: 'error', // no seguir redirecciones: evita desvios hacia otros destinos
      });
      codigoHttp = respuesta.status;
      exito = respuesta.status >= 200 && respuesta.status < 300;
      if (!exito) error = `El destino respondió HTTP ${respuesta.status}`;
      await respuesta.body?.cancel().catch(() => undefined);
    } catch (e) {
      const nombre = e instanceof Error ? e.name : '';
      error = nombre === 'TimeoutError' || nombre === 'AbortError'
        ? `Sin respuesta en ${this.cfg.timeoutMs} ms (timeout)`
        : `Error de red: ${e instanceof Error ? e.message : String(e)}`;
    }

    const ahora = this.reloj();
    const intentosHechos = evento.intentos + 1;
    let nuevoEstado: ResultadoEnvio['nuevoEstado'];
    let proximo = ahora;
    if (exito) {
      nuevoEstado = 'ENVIADO';
    } else if (intentosHechos >= this.cfg.maxAttempts) {
      nuevoEstado = 'FALLIDO'; // agotados: queda para revision manual (dead letter)
    } else {
      nuevoEstado = 'PENDIENTE';
      proximo = new Date(
        ahora.getTime() + calcularEspera(intentosHechos, this.cfg.backoffBaseMs, this.cfg.backoffMaxMs, this.deps.aleatorio),
      );
    }

    await this.outbox.registrarResultado(evento.id, {
      exito,
      codigoHttp,
      error: error ? error.slice(0, 500) : null,
      duracionMs: Date.now() - inicio,
      nuevoEstado,
      proximoIntento: proximo,
      ahora,
    });

    this.logger.info(
      { eventId: evento.eventId, intento: intentosHechos, codigoHttp, nuevoEstado, error },
      'webhook: intento de envio',
    );
    return nuevoEstado;
  }

  private reloj(): Date {
    return (this.deps.reloj ?? (() => new Date()))();
  }
}

/** Bucle del worker: sin solapar lotes y con parada limpia. */
export function iniciarWorker(dispatcher: WebhookDispatcher, intervaloMs: number, logger: Logger): () => Promise<void> {
  let detenido = false;
  let temporizador: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> = Promise.resolve();

  const ciclo = (): void => {
    enCurso = (async () => {
      try {
        const r = await dispatcher.procesarLote();
        if (r.reclamados > 0) logger.info(r, 'webhook: lote procesado');
      } catch (e) {
        logger.error({ err: e }, 'webhook: error procesando el lote');
      }
      if (!detenido) {
        temporizador = setTimeout(ciclo, intervaloMs);
        temporizador.unref();
      }
    })();
  };
  ciclo();

  return async () => {
    detenido = true;
    if (temporizador) clearTimeout(temporizador);
    await enCurso;
  };
}
