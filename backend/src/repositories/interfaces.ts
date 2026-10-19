import type {
  ActualizarCreditoInput,
  Credito,
  CrearCreditoInput,
  EstadoOutbox,
  Estado,
  EventoOutbox,
  FiltroCreditos,
  HistorialEntrada,
  IntentoEnvio,
  NuevoHistorial,
  Pagina,
  ResumenCreditos,
  Rol,
  Usuario,
} from '../domain/types';

export interface NuevoCredito extends CrearCreditoInput {
  numeroCredito: string;
}

export interface CreditoRepository {
  /** Siguiente numero de credito, p. ej. CR-2026-000123. Unico incluso con concurrencia. */
  siguienteNumero(anio: number): Promise<string>;
  /** Crea (o reutiliza) el asociado e inserta el credito en estado SOLICITADO. */
  insertar(nuevo: NuevoCredito): Promise<Credito>;
  /** Con `bloquear` toma un bloqueo de escritura hasta el fin de la transaccion. */
  obtenerPorId(id: number, opciones?: { bloquear?: boolean }): Promise<Credito | null>;
  existeDuplicadoEnCurso(p: {
    identificacion: string;
    tipoCredito: string;
    valorSolicitado: number;
    excluirId?: number;
  }): Promise<boolean>;
  listar(filtro: FiltroCreditos): Promise<Pagina<Credito>>;
  resumen(): Promise<ResumenCreditos>;
  actualizar(id: number, campos: ActualizarCreditoInput): Promise<Credito>;
  cambiarEstado(id: number, estado: Estado): Promise<Credito>;
  marcarEliminado(id: number): Promise<void>;
  agregarHistorial(entrada: NuevoHistorial): Promise<void>;
  listarHistorial(creditoId: number): Promise<HistorialEntrada[]>;
}

export interface NuevoEventoOutbox {
  eventId: string;
  evento: string;
  creditoId: number;
  payload: string;
}

export interface ResultadoEnvio {
  exito: boolean;
  codigoHttp: number | null;
  error: string | null;
  duracionMs: number;
  /** Estado en el que queda el evento tras este intento. */
  nuevoEstado: EstadoOutbox;
  /** Cuando reintentar (solo si nuevoEstado es PENDIENTE). */
  proximoIntento: Date;
  ahora: Date;
}

export interface FiltroNotificaciones {
  estado?: EstadoOutbox;
  creditoId?: number;
  page: number;
  pageSize: number;
}

export interface OutboxRepository {
  insertar(nuevo: NuevoEventoOutbox): Promise<EventoOutbox>;
  /**
   * Reclama hasta `limite` eventos pendientes y vencidos. Los reclamados quedan
   * "alquilados" `leasMs` milisegundos (se posterga su ProximoIntento) para que
   * dos workers no envien el mismo evento a la vez.
   */
  tomarPendientes(limite: number, leaseMs: number, ahora: Date): Promise<EventoOutbox[]>;
  /** Guarda la traza del intento y actualiza el estado del evento, de forma atomica. */
  registrarResultado(id: number, resultado: ResultadoEnvio): Promise<void>;
  listar(filtro: FiltroNotificaciones): Promise<Pagina<EventoOutbox>>;
  obtener(id: number): Promise<EventoOutbox | null>;
  listarIntentos(outboxId: number): Promise<IntentoEnvio[]>;
  /** Devuelve un evento FALLIDO a PENDIENTE con intentos en cero. */
  reencolar(id: number, ahora: Date): Promise<boolean>;
}

export interface UsuarioRepository {
  buscarPorUsername(username: string): Promise<Usuario | null>;
  crear(datos: { username: string; passwordHash: string; rol: Rol }): Promise<void>;
  contar(): Promise<number>;
}

/** Repositorios que comparten una misma transaccion. */
export interface Repositorios {
  creditos: CreditoRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  /** Ejecuta `fn` en una transaccion: todo se confirma o todo se revierte. */
  run<T>(fn: (repos: Repositorios) => Promise<T>): Promise<T>;
}

export interface Persistencia {
  uow: UnitOfWork;
  /** Lecturas fuera de transaccion. */
  creditos: CreditoRepository;
  outbox: OutboxRepository;
  usuarios: UsuarioRepository;
  ping(): Promise<void>;
}
