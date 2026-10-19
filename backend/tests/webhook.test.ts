import pino from 'pino';
import request from 'supertest';
import { MemoriaPersistencia } from '../src/repositories/memory/memoryPersistencia';
import { CreditoService } from '../src/services/creditoService';
import { calcularEspera, firmar, verificarFirma, WebhookDispatcher, type WebhookConfig } from '../src/services/webhookDispatcher';
import { ANALISTA, crearEntorno, creditoValido, SECRETO_WEBHOOK } from './helpers';

const AHORA = new Date('2026-09-07T18:00:00.000Z');
const URL_EXTERNA = 'https://sistema-externo.test/webhooks/creditos';

const cfg: WebhookConfig = {
  url: URL_EXTERNA,
  secret: SECRETO_WEBHOOK,
  maxAttempts: 3,
  timeoutMs: 1000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 3_600_000,
  batchSize: 10,
  leaseMs: 20_000,
};

interface Llamada {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** "Sistema externo" de pruebas: responde en orden con un codigo HTTP o un error (la ultima respuesta se repite). */
function sistemaExterno(respuestas: Array<number | Error>) {
  const llamadas: Llamada[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    llamadas.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: init?.body as string,
    });
    const siguiente = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    if (siguiente instanceof Error) throw siguiente;
    return new Response(null, { status: siguiente ?? 200 });
  };
  return { fetchFn, llamadas };
}

/** Escenario con reloj controlable: avanzar() simula el paso del tiempo entre reintentos. */
function preparar(respuestas: Array<number | Error>, config: WebhookConfig = cfg) {
  const p = new MemoriaPersistencia();
  let ahora = AHORA;
  p.reloj = () => ahora;
  const servicio = new CreditoService(p, () => ahora);
  const externo = sistemaExterno(respuestas);
  const despachador = new WebhookDispatcher(p.outbox, config, pino({ level: 'silent' }), {
    fetchFn: externo.fetchFn,
    reloj: () => ahora,
    aleatorio: () => 1, // sin variacion: la espera es exactamente la exponencial
  });
  const avanzar = (ms: number): void => {
    ahora = new Date(ahora.getTime() + ms);
  };
  return { p, servicio, despachador, externo, avanzar };
}

describe('webhook: envio del evento credito.creado', () => {
  it('envia el cuerpo del enunciado, firmado con HMAC, y marca el evento como ENVIADO', async () => {
    const { p, servicio, despachador, externo } = preparar([200]);
    const credito = await servicio.crear(creditoValido(), ANALISTA);

    const lote = await despachador.procesarLote();

    expect(lote).toEqual({ reclamados: 1, enviados: 1, reintentos: 0, fallidos: 0 });
    expect(externo.llamadas).toHaveLength(1);
    const llamada = externo.llamadas[0]!;
    expect(llamada.url).toBe(URL_EXTERNA);

    const evento = p.state.outbox[0]!;
    expect(llamada.body).toBe(evento.payload);
    expect(JSON.parse(llamada.body)).toEqual({
      event: 'credito.creado',
      eventId: evento.eventId,
      timestamp: '2026-09-07T18:00:00.000Z',
      data: {
        id: credito.id,
        numeroCredito: 'CR-2026-000001',
        identificacionAsociado: '1001234567',
        valorSolicitado: 15_000_000,
        estado: 'SOLICITADO',
      },
    });

    expect(llamada.headers['X-Webhook-Id']).toBe(evento.eventId);
    expect(
      verificarFirma({
        secreto: SECRETO_WEBHOOK,
        timestampSeg: llamada.headers['X-Webhook-Timestamp']!,
        cuerpo: llamada.body,
        firma: llamada.headers['X-Webhook-Signature']!,
        ahora: AHORA,
      }),
    ).toBe(true);

    expect(evento).toMatchObject({ estado: 'ENVIADO', intentos: 1, ultimoCodigoHttp: 200, ultimoError: null });
    expect(evento.fechaEnvio).toBe('2026-09-07T18:00:00.000Z');
    expect(p.state.intentos).toEqual([expect.objectContaining({ outboxId: evento.id, numeroIntento: 1, codigoHttp: 200, exito: true })]);
  });

  it('el envio no crea ni modifica creditos (reutiliza lo que dejo la creacion)', async () => {
    const { p, servicio, despachador } = preparar([200]);
    await servicio.crear(creditoValido(), ANALISTA);
    const antes = structuredClone(p.state.creditos);

    await despachador.procesarLote();

    expect(p.state.creditos).toEqual(antes);
    expect(p.state.outbox).toHaveLength(1);
  });

  it('no reenvia un evento que ya fue ENVIADO', async () => {
    const { servicio, despachador, externo, avanzar } = preparar([200]);
    await servicio.crear(creditoValido(), ANALISTA);
    await despachador.procesarLote();
    avanzar(3_600_000);
    const segundo = await despachador.procesarLote();

    expect(segundo.reclamados).toBe(0);
    expect(externo.llamadas).toHaveLength(1);
  });

  it('un evento reclamado queda reservado: otro worker no lo toma al mismo tiempo', async () => {
    const { p, servicio } = preparar([200]);
    await servicio.crear(creditoValido(), ANALISTA);

    const primero = await p.outbox.tomarPendientes(10, 20_000, AHORA);
    const segundo = await p.outbox.tomarPendientes(10, 20_000, AHORA);

    expect(primero).toHaveLength(1);
    expect(segundo).toHaveLength(0);
  });
});

describe('webhook: el sistema externo falla', () => {
  it('con HTTP 500 el evento sigue PENDIENTE, con espera exponencial, y se reintenta despues', async () => {
    const { p, servicio, despachador, externo, avanzar } = preparar([500, 200]);
    await servicio.crear(creditoValido(), ANALISTA);

    const primero = await despachador.procesarLote();
    expect(primero).toMatchObject({ enviados: 0, reintentos: 1, fallidos: 0 });
    const evento = p.state.outbox[0]!;
    expect(evento).toMatchObject({ estado: 'PENDIENTE', intentos: 1, ultimoCodigoHttp: 500 });
    expect(evento.ultimoError).toContain('HTTP 500');
    expect(evento.proximoIntento).toBe(new Date(AHORA.getTime() + 30_000).toISOString());

    // Aun no vence la espera: no se reintenta.
    avanzar(10_000);
    expect((await despachador.procesarLote()).reclamados).toBe(0);

    // Vencida la espera, se reintenta y esta vez llega.
    avanzar(25_000);
    const segundo = await despachador.procesarLote();
    expect(segundo.enviados).toBe(1);
    expect(externo.llamadas).toHaveLength(2);
    expect(p.state.outbox[0]).toMatchObject({ estado: 'ENVIADO', intentos: 2 });

    // La traza conserva cada intento, tambien el fallido.
    expect(p.state.intentos.map((i) => [i.numeroIntento, i.codigoHttp, i.exito])).toEqual([
      [1, 500, false],
      [2, 200, true],
    ]);
  });

  it('el evento reenviado conserva el mismo eventId (el receptor puede deduplicar)', async () => {
    const { servicio, despachador, externo, avanzar } = preparar([503, 200]);
    await servicio.crear(creditoValido(), ANALISTA);
    await despachador.procesarLote();
    avanzar(60_000);
    await despachador.procesarLote();

    const [a, b] = externo.llamadas;
    expect(a!.headers['X-Webhook-Id']).toBe(b!.headers['X-Webhook-Id']);
    expect(JSON.parse(a!.body).eventId).toBe(JSON.parse(b!.body).eventId);
  });

  it('si el sistema externo esta caido (error de red) se registra y se reintenta', async () => {
    const { p, servicio, despachador } = preparar([new Error('connect ECONNREFUSED 10.0.0.5:443')]);
    await servicio.crear(creditoValido(), ANALISTA);

    await despachador.procesarLote();

    expect(p.state.outbox[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 1, ultimoCodigoHttp: null });
    expect(p.state.outbox[0]!.ultimoError).toContain('Error de red');
    expect(p.state.outbox[0]!.ultimoError).toContain('ECONNREFUSED');
  });

  it('si no responde a tiempo se registra como timeout', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { p, servicio, despachador } = preparar([timeout]);
    await servicio.crear(creditoValido(), ANALISTA);

    await despachador.procesarLote();

    expect(p.state.outbox[0]!.ultimoError).toBe('Sin respuesta en 1000 ms (timeout)');
    expect(p.state.outbox[0]!.estado).toBe('PENDIENTE');
  });

  it('al agotar los intentos queda FALLIDO y no se vuelve a enviar; un admin puede reencolarlo', async () => {
    const { p, servicio, despachador, externo, avanzar } = preparar([500, 500, 500, 200]);
    await servicio.crear(creditoValido(), ANALISTA);

    for (let i = 0; i < 3; i++) {
      await despachador.procesarLote();
      avanzar(3_600_000);
    }
    expect(p.state.outbox[0]).toMatchObject({ estado: 'FALLIDO', intentos: 3, ultimoCodigoHttp: 500 });

    expect((await despachador.procesarLote()).reclamados).toBe(0);
    expect(externo.llamadas).toHaveLength(3);

    expect(await p.outbox.reencolar(p.state.outbox[0]!.id, AHORA)).toBe(true);
    expect(p.state.outbox[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    await despachador.procesarLote();
    expect(p.state.outbox[0]).toMatchObject({ estado: 'ENVIADO' });
  });

  it('la falla del webhook nunca afecta al credito ya creado', async () => {
    const { p, servicio, despachador } = preparar([500]);
    const credito = await servicio.crear(creditoValido(), ANALISTA);
    await despachador.procesarLote();

    expect(await servicio.obtener(credito.id)).toMatchObject({ id: credito.id, estado: 'SOLICITADO' });
    expect(p.state.creditos).toHaveLength(1);
  });

  it('solo se reencolan los eventos FALLIDOS', async () => {
    const { p, servicio } = preparar([200]);
    await servicio.crear(creditoValido(), ANALISTA);
    expect(await p.outbox.reencolar(p.state.outbox[0]!.id, AHORA)).toBe(false);
  });
});

describe('webhook: reintentos y firma', () => {
  it('la espera crece de forma exponencial hasta un tope', () => {
    const base = 30_000;
    const tope = 3_600_000;
    expect([1, 2, 3, 4].map((n) => calcularEspera(n, base, tope, () => 1))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(calcularEspera(20, base, tope, () => 1)).toBe(tope);
  });

  it('el jitter reparte los reintentos entre la mitad y el total de la espera', () => {
    expect(calcularEspera(3, 30_000, 3_600_000, () => 0)).toBe(60_000);
    expect(calcularEspera(3, 30_000, 3_600_000, () => 1)).toBe(120_000);
  });

  const parametros = { secreto: SECRETO_WEBHOOK, timestampSeg: '1788804000', cuerpo: '{"event":"credito.creado"}' };
  const ahora = new Date(1788804000 * 1000);

  it('acepta una firma correcta', () => {
    const firma = firmar(parametros.secreto, parametros.timestampSeg, parametros.cuerpo);
    expect(verificarFirma({ ...parametros, firma, ahora })).toBe(true);
  });

  it('rechaza cuerpo alterado, secreto distinto y firma mal formada', () => {
    const firma = firmar(parametros.secreto, parametros.timestampSeg, parametros.cuerpo);
    expect(verificarFirma({ ...parametros, cuerpo: '{"event":"otro"}', firma, ahora })).toBe(false);
    expect(verificarFirma({ ...parametros, secreto: 'otro-secreto-distinto-123', firma, ahora })).toBe(false);
    expect(verificarFirma({ ...parametros, firma: 'sha256=abc', ahora })).toBe(false);
  });

  it('rechaza una peticion repetida fuera de la ventana de tolerancia (replay)', () => {
    const firma = firmar(parametros.secreto, parametros.timestampSeg, parametros.cuerpo);
    const diezMinutosDespues = new Date(ahora.getTime() + 10 * 60_000);
    expect(verificarFirma({ ...parametros, firma, ahora: diezMinutosDespues })).toBe(false);
  });
});

describe('webhook: integracion con el receptor de demostracion', () => {
  const login = async (app: Parameters<typeof request>[0], username: string, password: string): Promise<string> =>
    (await request(app).post('/api/auth/login').send({ username, password })).body.data.token as string;

  /** Hace que el despachador "envie" directamente a la aplicacion en memoria, sin red. */
  const haciaLaApp =
    (app: Parameters<typeof request>[0]): typeof fetch =>
    async (_url, init) => {
      const r = await request(app)
        .post('/api/webhooks/demo-receptor')
        .set(init?.headers as Record<string, string>)
        .send(init?.body as string);
      return new Response(null, { status: r.status });
    };

  it('el evento firmado por el despachador es aceptado por el receptor y queda ENVIADO', async () => {
    const e = await crearEntorno();
    await e.creditoService.crear(creditoValido(), ANALISTA);
    const despachador = new WebhookDispatcher(e.persistencia.outbox, cfg, e.logger, { fetchFn: haciaLaApp(e.app) });

    const lote = await despachador.procesarLote();

    expect(lote.enviados).toBe(1);
    expect(e.persistencia.state.outbox[0]).toMatchObject({ estado: 'ENVIADO', ultimoCodigoHttp: 200 });

    const admin = await login(e.app, 'admin', 'ClaveAdmin_123');
    const recibidos = await request(e.app).get('/api/webhooks/demo-receptor/recibidos').set('Authorization', `Bearer ${admin}`);
    expect(recibidos.status).toBe(200);
    expect(recibidos.body.data).toHaveLength(1);
    expect(recibidos.body.data[0]).toMatchObject({ event: 'credito.creado', data: { numeroCredito: expect.stringMatching(/^CR-\d{4}-\d{6}$/) } });
  });

  it('con un secreto distinto el receptor responde 401 y el evento queda para reintento', async () => {
    const e = await crearEntorno();
    await e.creditoService.crear(creditoValido(), ANALISTA);
    const despachador = new WebhookDispatcher(e.persistencia.outbox, { ...cfg, secret: 'otro-secreto-del-emisor-123' }, e.logger, {
      fetchFn: haciaLaApp(e.app),
    });

    await despachador.procesarLote();

    expect(e.persistencia.state.outbox[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 1, ultimoCodigoHttp: 401 });
  });

  it('el receptor es idempotente: el mismo eventId recibido dos veces se marca como duplicado', async () => {
    const e = await crearEntorno();
    const cuerpo = JSON.stringify({ event: 'credito.creado', eventId: 'evt-123', timestamp: AHORA.toISOString(), data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const enviar = () =>
      request(e.app)
        .post('/api/webhooks/demo-receptor')
        .set({ 'Content-Type': 'application/json', 'X-Webhook-Timestamp': ts, 'X-Webhook-Signature': firmar(SECRETO_WEBHOOK, ts, cuerpo) })
        .send(cuerpo);

    const primera = await enviar();
    const segunda = await enviar();

    expect(primera.body.data).toMatchObject({ recibido: true, duplicado: false, eventId: 'evt-123' });
    expect(segunda.body.data).toMatchObject({ recibido: true, duplicado: true });
  });

  it('el receptor rechaza peticiones sin firma o con firma falsa (401 FIRMA_INVALIDA)', async () => {
    const e = await crearEntorno();
    const cuerpo = '{"event":"credito.creado","eventId":"evt-1"}';
    const ts = String(Math.floor(Date.now() / 1000));

    const sinFirma = await request(e.app).post('/api/webhooks/demo-receptor').set('Content-Type', 'application/json').send(cuerpo);
    const firmaFalsa = await request(e.app)
      .post('/api/webhooks/demo-receptor')
      .set({ 'Content-Type': 'application/json', 'X-Webhook-Timestamp': ts, 'X-Webhook-Signature': 'sha256=' + '0'.repeat(64) })
      .send(cuerpo);

    for (const r of [sinFirma, firmaFalsa]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('FIRMA_INVALIDA');
    }
  });

  it('con ENABLE_DEMO_RECEIVER desactivado la ruta no existe', async () => {
    const e = await crearEntorno({ enableDemoReceiver: false });
    const r = await request(e.app).post('/api/webhooks/demo-receptor').send({});
    expect(r.status).toBe(404);
  });
});

describe('webhook: consulta de la traza (solo ADMIN)', () => {
  it('lista las notificaciones con su detalle de intentos y permite reintentar las fallidas', async () => {
    const e = await crearEntorno();
    const admin = (await request(e.app).post('/api/auth/login').send({ username: 'admin', password: 'ClaveAdmin_123' })).body.data.token as string;
    const analista = (await request(e.app).post('/api/auth/login').send({ username: 'analista', password: 'ClaveAnalista_123' })).body.data.token as string;
    await e.creditoService.crear(creditoValido(), ANALISTA);
    const despachador = new WebhookDispatcher(e.persistencia.outbox, { ...cfg, maxAttempts: 1 }, e.logger, {
      fetchFn: sistemaExterno([500]).fetchFn,
    });
    await despachador.procesarLote();
    const id = e.persistencia.state.outbox[0]!.id;
    const h = (t: string) => ({ Authorization: `Bearer ${t}` });

    expect((await request(e.app).get('/api/webhooks/notificaciones').set(h(analista))).status).toBe(403);

    const lista = await request(e.app).get('/api/webhooks/notificaciones?estado=FALLIDO').set(h(admin));
    expect(lista.status).toBe(200);
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0]).toMatchObject({ id, estado: 'FALLIDO', payload: { event: 'credito.creado' } });

    const detalle = await request(e.app).get(`/api/webhooks/notificaciones/${id}`).set(h(admin));
    expect(detalle.body.data.intentosDetalle).toEqual([expect.objectContaining({ numeroIntento: 1, codigoHttp: 500, exito: false })]);

    const reintento = await request(e.app).post(`/api/webhooks/notificaciones/${id}/reintentar`).set(h(admin));
    expect(reintento.status).toBe(200);
    expect(reintento.body.data).toEqual({ id, estado: 'PENDIENTE' });

    const otraVez = await request(e.app).post(`/api/webhooks/notificaciones/${id}/reintentar`).set(h(admin));
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error.code).toBe('NOTIFICACION_NO_REINTENTABLE');

    expect((await request(e.app).get('/api/webhooks/notificaciones/9999').set(h(admin))).status).toBe(404);
  });
});
