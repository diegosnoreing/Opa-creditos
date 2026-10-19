import { ConflictError } from '../../domain/errors';
import { ESTADOS_EN_CURSO } from '../../domain/estados';
import {
  ESTADOS,
  type ActualizarCreditoInput,
  type Credito,
  type Estado,
  type EventoOutbox,
  type FiltroCreditos,
  type HistorialEntrada,
  type IntentoEnvio,
  type NuevoHistorial,
  type Pagina,
  type ResumenCreditos,
  type Usuario,
} from '../../domain/types';
import type {
  CreditoRepository,
  FiltroNotificaciones,
  NuevoCredito,
  NuevoEventoOutbox,
  OutboxRepository,
  Persistencia,
  Repositorios,
  ResultadoEnvio,
  UnitOfWork,
  UsuarioRepository,
} from '../interfaces';

/**
 * Persistencia en memoria. Se usa en las pruebas automaticas para ejercitar la
 * logica de negocio sin SQL Server. Imita lo que hace la base real: unicidad
 * del asociado, indice de duplicados y rollback de transacciones.
 */

type CreditoInterno = Credito & { eliminado: boolean };

interface Estado_ {
  creditos: CreditoInterno[];
  historial: HistorialEntrada[];
  outbox: EventoOutbox[];
  intentos: IntentoEnvio[];
  usuarios: Usuario[];
  asociados: Map<string, string>;
  seq: number;
  ids: { credito: number; historial: number; outbox: number; intento: number; usuario: number };
}

function estadoInicial(): Estado_ {
  return {
    creditos: [],
    historial: [],
    outbox: [],
    intentos: [],
    usuarios: [],
    asociados: new Map(),
    seq: 0,
    ids: { credito: 0, historial: 0, outbox: 0, intento: 0, usuario: 0 },
  };
}

const sinInterno = ({ eliminado: _e, ...credito }: CreditoInterno): Credito => ({ ...credito });

export class MemoriaPersistencia implements Persistencia {
  state: Estado_ = estadoInicial();
  /** Reloj inyectable para que las pruebas controlen las fechas. */
  reloj: () => Date = () => new Date();

  readonly creditos: CreditoRepository;
  readonly outbox: OutboxRepository;
  readonly usuarios: UsuarioRepository;
  readonly uow: UnitOfWork;

  constructor() {
    this.creditos = this.crearRepoCreditos();
    this.outbox = this.crearRepoOutbox();
    this.usuarios = this.crearRepoUsuarios();
    const repos: Repositorios = { creditos: this.creditos, outbox: this.outbox };
    this.uow = {
      run: async <T>(fn: (r: Repositorios) => Promise<T>): Promise<T> => {
        const copia = structuredClone(this.state);
        try {
          return await fn(repos);
        } catch (error) {
          this.state = copia; // rollback
          throw error;
        }
      },
    };
  }

  async ping(): Promise<void> {
    /* siempre disponible */
  }

  private crearRepoCreditos(): CreditoRepository {
    const store = this;
    return {
      async siguienteNumero(anio) {
        store.state.seq += 1;
        return `CR-${anio}-${String(store.state.seq).padStart(6, '0')}`;
      },

      async insertar(nuevo: NuevoCredito) {
        const s = store.state;
        if (!s.asociados.has(nuevo.identificacionAsociado)) {
          s.asociados.set(nuevo.identificacionAsociado, nuevo.nombreAsociado);
        }
        const nombre = s.asociados.get(nuevo.identificacionAsociado) as string;
        const ahora = store.reloj().toISOString();
        const fila: CreditoInterno = {
          id: ++s.ids.credito,
          numeroCredito: nuevo.numeroCredito,
          identificacionAsociado: nuevo.identificacionAsociado,
          nombreAsociado: nombre,
          tipoCredito: nuevo.tipoCredito,
          valorSolicitado: nuevo.valorSolicitado,
          tasaInteres: nuevo.tasaInteres,
          numeroCuotas: nuevo.numeroCuotas,
          formaPago: nuevo.formaPago,
          estado: 'SOLICITADO',
          fechaSolicitud: ahora,
          fechaActualizacion: ahora,
          eliminado: false,
        };
        if (store.hayDuplicado(fila, undefined)) {
          throw new ConflictError('CREDITO_DUPLICADO', 'Ya existe un crédito en curso con las mismas condiciones');
        }
        s.creditos.push(fila);
        return sinInterno(fila);
      },

      async obtenerPorId(id) {
        const fila = store.state.creditos.find((c) => c.id === id && !c.eliminado);
        return fila ? sinInterno(fila) : null;
      },

      async existeDuplicadoEnCurso({ identificacion, tipoCredito, valorSolicitado, excluirId }) {
        return store.state.creditos.some(
          (c) =>
            !c.eliminado &&
            c.id !== excluirId &&
            c.identificacionAsociado === identificacion &&
            c.tipoCredito === tipoCredito &&
            c.valorSolicitado === valorSolicitado &&
            ESTADOS_EN_CURSO.includes(c.estado),
        );
      },

      async listar(filtro: FiltroCreditos): Promise<Pagina<Credito>> {
        const q = filtro.q?.toLowerCase();
        let filas = store.state.creditos.filter((c) => !c.eliminado);
        if (filtro.estado) filas = filas.filter((c) => c.estado === filtro.estado);
        if (filtro.identificacion) filas = filas.filter((c) => c.identificacionAsociado === filtro.identificacion);
        if (filtro.tipoCredito) filas = filas.filter((c) => c.tipoCredito === filtro.tipoCredito);
        if (q) {
          filas = filas.filter(
            (c) =>
              c.numeroCredito.toLowerCase().includes(q) ||
              c.nombreAsociado.toLowerCase().includes(q) ||
              c.identificacionAsociado.toLowerCase().includes(q),
          );
        }
        const dir = filtro.sortDir === 'asc' ? 1 : -1;
        filas = [...filas].sort((a, b) => {
          const va = a[filtro.sortBy];
          const vb = b[filtro.sortBy];
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
          return (b.id - a.id) * 1;
        });
        const inicio = (filtro.page - 1) * filtro.pageSize;
        return {
          total: filas.length,
          items: filas.slice(inicio, inicio + filtro.pageSize).map(sinInterno),
        };
      },

      async resumen(): Promise<ResumenCreditos> {
        const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<Estado, number>;
        let valor = 0;
        let total = 0;
        for (const c of store.state.creditos) {
          if (c.eliminado) continue;
          porEstado[c.estado] += 1;
          valor += c.valorSolicitado;
          total += 1;
        }
        return { total, valorTotalSolicitado: Math.round(valor * 100) / 100, porEstado };
      },

      async actualizar(id, campos: ActualizarCreditoInput) {
        const fila = store.state.creditos.find((c) => c.id === id && !c.eliminado);
        if (!fila) throw new Error(`Credito ${id} no encontrado`);
        const candidato: CreditoInterno = { ...fila, ...campos };
        if (store.hayDuplicado(candidato, id)) {
          throw new ConflictError('CREDITO_DUPLICADO', 'Ya existe un crédito en curso con las mismas condiciones');
        }
        Object.assign(fila, campos, { fechaActualizacion: store.reloj().toISOString() });
        return sinInterno(fila);
      },

      async cambiarEstado(id, estado) {
        const fila = store.state.creditos.find((c) => c.id === id && !c.eliminado);
        if (!fila) throw new Error(`Credito ${id} no encontrado`);
        fila.estado = estado;
        fila.fechaActualizacion = store.reloj().toISOString();
        return sinInterno(fila);
      },

      async marcarEliminado(id) {
        const fila = store.state.creditos.find((c) => c.id === id && !c.eliminado);
        if (!fila) throw new Error(`Credito ${id} no encontrado`);
        fila.eliminado = true;
        fila.fechaActualizacion = store.reloj().toISOString();
      },

      async agregarHistorial(entrada: NuevoHistorial) {
        store.state.historial.push({
          ...entrada,
          id: ++store.state.ids.historial,
          fecha: store.reloj().toISOString(),
        });
      },

      async listarHistorial(creditoId) {
        return store.state.historial
          .filter((h) => h.creditoId === creditoId)
          .sort((a, b) => b.id - a.id)
          .map((h) => ({ ...h }));
      },
    };
  }

  /** Imita el indice unico filtrado UX_Creditos_Duplicado_Curso. */
  private hayDuplicado(candidato: CreditoInterno, ignorarId: number | undefined): boolean {
    if (candidato.eliminado || !ESTADOS_EN_CURSO.includes(candidato.estado)) return false;
    return this.state.creditos.some(
      (c) =>
        !c.eliminado &&
        c.id !== ignorarId &&
        c.id !== candidato.id &&
        c.identificacionAsociado === candidato.identificacionAsociado &&
        c.tipoCredito === candidato.tipoCredito &&
        c.valorSolicitado === candidato.valorSolicitado &&
        ESTADOS_EN_CURSO.includes(c.estado),
    );
  }

  private crearRepoOutbox(): OutboxRepository {
    const store = this;
    return {
      async insertar(nuevo: NuevoEventoOutbox) {
        const ahora = store.reloj().toISOString();
        const evento: EventoOutbox = {
          id: ++store.state.ids.outbox,
          ...nuevo,
          estado: 'PENDIENTE',
          intentos: 0,
          ultimoCodigoHttp: null,
          ultimoError: null,
          proximoIntento: ahora,
          fechaCreacion: ahora,
          fechaEnvio: null,
        };
        store.state.outbox.push(evento);
        return { ...evento };
      },

      async tomarPendientes(limite, leaseMs, ahora) {
        const vencidos = store.state.outbox
          .filter((e) => e.estado === 'PENDIENTE' && new Date(e.proximoIntento) <= ahora)
          .sort((a, b) => a.proximoIntento.localeCompare(b.proximoIntento) || a.id - b.id)
          .slice(0, limite);
        const copia = vencidos.map((e) => ({ ...e }));
        for (const e of vencidos) e.proximoIntento = new Date(ahora.getTime() + leaseMs).toISOString();
        return copia;
      },

      async registrarResultado(id, r: ResultadoEnvio) {
        const evento = store.state.outbox.find((e) => e.id === id);
        if (!evento) throw new Error(`Evento ${id} no encontrado`);
        evento.intentos += 1;
        evento.estado = r.nuevoEstado;
        evento.ultimoCodigoHttp = r.codigoHttp;
        evento.ultimoError = r.error;
        evento.proximoIntento = r.proximoIntento.toISOString();
        if (r.nuevoEstado === 'ENVIADO') evento.fechaEnvio = r.ahora.toISOString();
        store.state.intentos.push({
          id: ++store.state.ids.intento,
          outboxId: id,
          numeroIntento: evento.intentos,
          fecha: r.ahora.toISOString(),
          codigoHttp: r.codigoHttp,
          exito: r.exito,
          error: r.error,
          duracionMs: r.duracionMs,
        });
      },

      async listar(f: FiltroNotificaciones) {
        let filas = [...store.state.outbox];
        if (f.estado) filas = filas.filter((e) => e.estado === f.estado);
        if (f.creditoId) filas = filas.filter((e) => e.creditoId === f.creditoId);
        filas.sort((a, b) => b.id - a.id);
        const inicio = (f.page - 1) * f.pageSize;
        return { total: filas.length, items: filas.slice(inicio, inicio + f.pageSize).map((e) => ({ ...e })) };
      },

      async obtener(id) {
        const e = store.state.outbox.find((x) => x.id === id);
        return e ? { ...e } : null;
      },

      async listarIntentos(outboxId) {
        return store.state.intentos.filter((i) => i.outboxId === outboxId).map((i) => ({ ...i }));
      },

      async reencolar(id, ahora) {
        const e = store.state.outbox.find((x) => x.id === id);
        if (!e || e.estado !== 'FALLIDO') return false;
        e.estado = 'PENDIENTE';
        e.intentos = 0;
        e.proximoIntento = ahora.toISOString();
        return true;
      },
    };
  }

  private crearRepoUsuarios(): UsuarioRepository {
    const store = this;
    return {
      async buscarPorUsername(username) {
        const u = store.state.usuarios.find((x) => x.username === username);
        return u ? { ...u } : null;
      },
      async crear({ username, passwordHash, rol }) {
        store.state.usuarios.push({ id: ++store.state.ids.usuario, username, passwordHash, rol, activo: true });
      },
      async contar() {
        return store.state.usuarios.length;
      },
    };
  }
}
