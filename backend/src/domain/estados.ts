import type { Estado } from './types';

/**
 * Maquina de estados del credito. RECHAZADO, DESEMBOLSADO y CANCELADO son
 * finales: un credito rechazado nunca llega a DESEMBOLSADO.
 */
export const TRANSICIONES: Readonly<Record<Estado, readonly Estado[]>> = {
  SOLICITADO: ['EN_ESTUDIO', 'CANCELADO'],
  EN_ESTUDIO: ['APROBADO', 'RECHAZADO', 'CANCELADO'],
  APROBADO: ['DESEMBOLSADO', 'CANCELADO'],
  RECHAZADO: [],
  DESEMBOLSADO: [],
  CANCELADO: [],
};

export function puedeTransitar(desde: Estado, hacia: Estado): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export function esEstadoFinal(estado: Estado): boolean {
  return TRANSICIONES[estado].length === 0;
}

/** Estados "en curso": son los que cuentan para la regla de duplicados. */
export const ESTADOS_EN_CURSO: readonly Estado[] = ['SOLICITADO', 'EN_ESTUDIO', 'APROBADO'];

/** Las condiciones financieras solo se modifican antes de la aprobacion. */
export const ESTADOS_EDITABLES: readonly Estado[] = ['SOLICITADO', 'EN_ESTUDIO'];

/** Con el credito aprobado o desembolsado ya hay compromisos: no se permite ni el borrado logico. */
export const ESTADOS_ELIMINABLES: readonly Estado[] = ['SOLICITADO', 'EN_ESTUDIO', 'RECHAZADO', 'CANCELADO'];

/** Decisiones que solo toma un ADMIN (separacion de funciones: quien estudia no decide). */
export const ESTADOS_SOLO_ADMIN: readonly Estado[] = ['APROBADO', 'RECHAZADO', 'DESEMBOLSADO'];

/** Rechazar o cancelar exige dejar el motivo en el historial. */
export const ESTADOS_CON_MOTIVO_OBLIGATORIO: readonly Estado[] = ['RECHAZADO', 'CANCELADO'];
