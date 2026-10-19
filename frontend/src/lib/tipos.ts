export const ESTADOS = ['SOLICITADO', 'EN_ESTUDIO', 'APROBADO', 'RECHAZADO', 'DESEMBOLSADO', 'CANCELADO'] as const;
export type Estado = (typeof ESTADOS)[number];
export const TIPOS_CREDITO = ['LIBRE_INVERSION', 'VIVIENDA', 'VEHICULO', 'EDUCACION', 'CALAMIDAD'] as const;
export type TipoCredito = (typeof TIPOS_CREDITO)[number];
export const FORMAS_PAGO = ['NOMINA', 'CAJA', 'DEBITO_AUTOMATICO', 'PSE'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];
export type Rol = 'ADMIN' | 'ANALISTA';

export interface Usuario {
  username: string;
  rol: Rol;
}

export interface Credito {
  id: number;
  numeroCredito: string;
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: TipoCredito;
  valorSolicitado: number;
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: FormaPago;
  estado: Estado;
  fechaSolicitud: string;
  fechaActualizacion: string;
}

export interface NuevoCredito {
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: TipoCredito;
  valorSolicitado: number;
  tasaInteres: number;
  numeroCuotas: number;
  formaPago: FormaPago;
}

export type CambiosCredito = Partial<Pick<NuevoCredito, 'tipoCredito' | 'valorSolicitado' | 'tasaInteres' | 'numeroCuotas' | 'formaPago'>>;

export interface Resumen {
  total: number;
  valorTotalSolicitado: number;
  porEstado: Record<Estado, number>;
}

export interface HistorialItem {
  id: number;
  creditoId: number;
  accion: 'CREACION' | 'ACTUALIZACION' | 'CAMBIO_ESTADO' | 'ELIMINACION';
  estadoAnterior: Estado | null;
  estadoNuevo: Estado | null;
  usuario: string;
  observacion: string | null;
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
  fecha: string;
}

export interface Intento {
  numeroIntento: number;
  codigoHttp: number | null;
  exito: boolean;
  error: string | null;
  duracionMs: number | null;
  fecha: string;
}

export interface Notificacion {
  id: number;
  eventId: string;
  evento: string;
  creditoId: number;
  estado: 'PENDIENTE' | 'ENVIADO' | 'FALLIDO';
  intentos: number;
  ultimoCodigoHttp: number | null;
  ultimoError: string | null;
  proximoIntento: string | null;
  fechaCreacion: string;
  fechaEnvio: string | null;
  intentosDetalle?: Intento[];
}

export interface Meta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Filtros {
  page: number;
  pageSize: number;
  estado: Estado | '';
  tipoCredito: TipoCredito | '';
  identificacion: string;
  q: string;
  sortBy: 'fechaSolicitud' | 'valorSolicitado' | 'estado' | 'numeroCredito' | 'nombreAsociado';
  sortDir: 'asc' | 'desc';
}
