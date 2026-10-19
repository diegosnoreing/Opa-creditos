import { BusinessRuleError, type DetalleError } from './errors';
import type { ActualizarCreditoInput, CrearCreditoInput } from './types';

/** Limites alineados con las columnas DECIMAL(18,2), DECIMAL(7,4) e INT del esquema. */
export const LIMITES = {
  valorMax: 9_999_999_999_999.99, // por debajo de 2^53: un number lo representa sin perdida
  tasaMax: 100,
  cuotasMax: 360,
} as const;

function maxDecimales(n: number, decimales: number): boolean {
  const f = 10 ** decimales;
  return Math.abs(Math.round(n * f) - n * f) < 1e-6;
}

/**
 * Reglas de negocio sobre las condiciones financieras. Valida solo los campos
 * presentes, asi sirve tanto para crear (todos) como para actualizar (algunos).
 *
 * Vive en el dominio y no en el controlador: cualquier punto de entrada
 * (API, un worker, un script) pasa por aqui y no puede saltarse las reglas.
 */
export function validarCondiciones(datos: Partial<CrearCreditoInput | ActualizarCreditoInput>): void {
  const errores: DetalleError[] = [];
  const { valorSolicitado: valor, tasaInteres: tasa, numeroCuotas: cuotas } = datos;

  if (valor !== undefined) {
    if (!Number.isFinite(valor) || valor <= 0) {
      errores.push({ campo: 'valorSolicitado', mensaje: 'El valor solicitado debe ser mayor que 0' });
    } else if (valor > LIMITES.valorMax) {
      errores.push({ campo: 'valorSolicitado', mensaje: `El valor solicitado no puede superar ${LIMITES.valorMax}` });
    } else if (!maxDecimales(valor, 2)) {
      errores.push({ campo: 'valorSolicitado', mensaje: 'El valor solicitado admite máximo 2 decimales' });
    }
  }

  if (tasa !== undefined) {
    if (!Number.isFinite(tasa) || tasa < 0) {
      errores.push({ campo: 'tasaInteres', mensaje: 'La tasa de interés no puede ser negativa' });
    } else if (tasa > LIMITES.tasaMax) {
      errores.push({ campo: 'tasaInteres', mensaje: `La tasa de interés no puede superar ${LIMITES.tasaMax}` });
    } else if (!maxDecimales(tasa, 4)) {
      errores.push({ campo: 'tasaInteres', mensaje: 'La tasa de interés admite máximo 4 decimales' });
    }
  }

  if (cuotas !== undefined) {
    if (!Number.isInteger(cuotas) || cuotas <= 0) {
      errores.push({ campo: 'numeroCuotas', mensaje: 'El número de cuotas debe ser un entero mayor que 0' });
    } else if (cuotas > LIMITES.cuotasMax) {
      errores.push({ campo: 'numeroCuotas', mensaje: `El número de cuotas no puede superar ${LIMITES.cuotasMax}` });
    }
  }

  if (errores.length > 0) {
    throw new BusinessRuleError(
      'DATOS_CREDITO_INVALIDOS',
      'Los datos del crédito incumplen las reglas de negocio',
      errores,
    );
  }
}
