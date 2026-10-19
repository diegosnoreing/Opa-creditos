export const ESTADOS = ['SOLICITADO', 'EN_ESTUDIO', 'APROBADO', 'RECHAZADO', 'DESEMBOLSADO', 'CANCELADO'] as const;
export type Estado = (typeof ESTADOS)[number];

export const TIPOS_CREDITO = ['LIBRE_INVERSION', 'VIVIENDA', 'VEHICULO', 'EDUCACION', 'CALAMIDAD'] as const;
export type TipoCredito = (typeof TIPOS_CREDITO)[number];

export const FORMAS_PAGO = ['NOMINA', 'CAJA', 'DEBITO_AUTOMATICO', 'PSE'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];

export const ROLES = ['ADMIN', 'ANALISTA'] as const;
export type Rol = (typeof ROLES)[number];

/** Usuario autenticado que ejecuta una operacion (queda en el historial). */
export interface Actor {
  username: string;
  rol: Rol;
}

/** Columnas por las que se permite ordenar el listado (lista blanca). */
export const CAMPOS_ORDEN = ['fechaSolicitud', 'valorSolicitado', 'estado', 'numeroCredito', 'nombreAsociado'] as const;
export type CampoOrden = (typeof CAMPOS_ORDEN)[number];

/** Unicos campos que se pueden modificar despues de crear el credito. El resto es inmutable. */
export const CAMPOS_ACTUALIZABLES = ['tipoCredito', 'valorSolicitado', 'tasaInteres', 'numeroCuotas', 'formaPago'] as const;

export interface CrearCreditoInput {
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: TipoCredito;
  valorSolicitado: number;
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: FormaPago;
}

export type ActualizarCreditoInput = Partial<Pick<CrearCreditoInput, (typeof CAMPOS_ACTUALIZABLES)[number]>>;

export interface Credito extends CrearCreditoInput {
  id: number;
  numeroCredito: string;
  estado: Estado;
  fechaSolicitud: string;
  fechaActualizacion: string;
}

export interface FiltroCreditos {
  page: number;
  pageSize: number;
  estado?: Estado;
  identificacion?: string;
  tipoCredito?: TipoCredito;
  q?: string;
  sortBy: CampoOrden;
  sortDir: 'asc' | 'desc';
}

export interface Pagina<T> {
  items: T[];
  total: number;
}

export interface ResumenCreditos {
  total: number;
  valorTotalSolicitado: number;
  porEstado: Record<Estado, number>;
}

/* ---------------- Auditoria ---------------- */

export type AccionHistorial = 'CREACION' | 'ACTUALIZACION' | 'CAMBIO_ESTADO' | 'ELIMINACION';

export interface NuevoHistorial {
  creditoId: number;
  accion: AccionHistorial;
  estadoAnterior: Estado | null;
  estadoNuevo: Estado | null;
  usuario: string;
  observacion: string | null;
  /** Solo en ACTUALIZACION: { campo: { antes, despues } }. */
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
}

export interface HistorialEntrada extends NuevoHistorial {
  id: number;
  fecha: string;
}

/* ---------------- Webhook (outbox) ---------------- */

export type EstadoOutbox = 'PENDIENTE' | 'ENVIADO' | 'FALLIDO';

export interface EventoOutbox {
  id: number;
  eventId: string;
  evento: string;
  creditoId: number;
  /** JSON serializado: es exactamente el cuerpo que se firma y se envia. */
  payload: string;
  estado: EstadoOutbox;
  intentos: number;
  ultimoCodigoHttp: number | null;
  ultimoError: string | null;
  proximoIntento: string;
  fechaCreacion: string;
  fechaEnvio: string | null;
}

export interface IntentoEnvio {
  id: number;
  outboxId: number;
  numeroIntento: number;
  fecha: string;
  codigoHttp: number | null;
  exito: boolean;
  error: string | null;
  duracionMs: number;
}

/* ---------------- Usuarios ---------------- */

export interface Usuario {
  id: number;
  username: string;
  passwordHash: string;
  rol: Rol;
  activo: boolean;
}
