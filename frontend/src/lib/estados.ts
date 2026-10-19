import { ESTADOS, type Estado, type FormaPago, type Rol, type TipoCredito } from './tipos';

/*
 * Copia de las reglas del backend SOLO para guiar la interfaz (mostrar u ocultar botones).
 * La autoridad es siempre el servidor: si estas reglas se desincronizan, la API responde
 * 403/409 y la pantalla muestra ese error. Ver docs/decisiones-tecnicas.md.
 */
export const TRANSICIONES: Record<Estado, readonly Estado[]> = {
  SOLICITADO: ['EN_ESTUDIO', 'CANCELADO'],
  EN_ESTUDIO: ['APROBADO', 'RECHAZADO', 'CANCELADO'],
  APROBADO: ['DESEMBOLSADO', 'CANCELADO'],
  RECHAZADO: [],
  DESEMBOLSADO: [],
  CANCELADO: [],
};

export const ESTADOS_EDITABLES: readonly Estado[] = ['SOLICITADO', 'EN_ESTUDIO'];
export const ESTADOS_ELIMINABLES: readonly Estado[] = ['SOLICITADO', 'EN_ESTUDIO', 'RECHAZADO', 'CANCELADO'];
export const ESTADOS_SOLO_ADMIN: readonly Estado[] = ['APROBADO', 'RECHAZADO', 'DESEMBOLSADO'];
export const ESTADOS_CON_MOTIVO: readonly Estado[] = ['RECHAZADO', 'CANCELADO'];

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  SOLICITADO: 'Solicitado',
  EN_ESTUDIO: 'En estudio',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  DESEMBOLSADO: 'Desembolsado',
  CANCELADO: 'Cancelado',
};

/** Verbo del botón que lleva al crédito a ese estado. */
export const ACCION_ESTADO: Record<Estado, string> = {
  SOLICITADO: 'Reabrir',
  EN_ESTUDIO: 'Pasar a estudio',
  APROBADO: 'Aprobar',
  RECHAZADO: 'Rechazar',
  DESEMBOLSADO: 'Desembolsar',
  CANCELADO: 'Cancelar solicitud',
};

export const ETIQUETA_TIPO: Record<TipoCredito, string> = {
  LIBRE_INVERSION: 'Libre inversión',
  VIVIENDA: 'Vivienda',
  VEHICULO: 'Vehículo',
  EDUCACION: 'Educación',
  CALAMIDAD: 'Calamidad',
};

export const ETIQUETA_PAGO: Record<FormaPago, string> = {
  NOMINA: 'Nómina',
  CAJA: 'Caja',
  DEBITO_AUTOMATICO: 'Débito automático',
  PSE: 'PSE',
};

export const esFinal = (e: Estado): boolean => TRANSICIONES[e].length === 0;

/** Transiciones que ESTE rol puede ejecutar desde el estado actual. */
export function transicionesPermitidas(estado: Estado, rol: Rol): Estado[] {
  return TRANSICIONES[estado].filter((destino) => rol === 'ADMIN' || !ESTADOS_SOLO_ADMIN.includes(destino));
}

export const puedeEditar = (estado: Estado): boolean => ESTADOS_EDITABLES.includes(estado);
export const puedeEliminar = (estado: Estado, rol: Rol): boolean => rol === 'ADMIN' && ESTADOS_ELIMINABLES.includes(estado);
export const exigeMotivo = (estado: Estado): boolean => ESTADOS_CON_MOTIVO.includes(estado);
export const esEstado = (v: string): v is Estado => (ESTADOS as readonly string[]).includes(v);
