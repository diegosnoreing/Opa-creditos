import type { NuevoCredito } from './tipos';

/** Mismos límites que backend/src/domain/validaciones.ts. Aquí solo sirven para avisar antes de enviar. */
export const LIMITES = { valorMax: 9_999_999_999_999.99, tasaMax: 100, cuotasMax: 360 } as const;

export type Errores = Partial<Record<keyof NuevoCredito, string>>;

const maxDecimales = (n: number, d: number): boolean => {
  const f = 10 ** d;
  return Math.abs(Math.round(n * f) - n * f) < 1e-6;
};

/** Convierte lo que escribe la persona ("15.000.000", "1,5") a número; NaN si no es un número. */
export function aNumero(texto: string): number {
  const t = texto.trim().replace(/\s/g, '');
  if (t === '') return NaN;
  // Con coma: el punto es separador de miles y la coma el decimal ("1.500,50").
  // Sin coma: varios puntos o grupos de 3 dígitos tras un punto son miles ("15.000.000").
  let limpio = t;
  if (t.includes(',')) limpio = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) limpio = t.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
}

export function validarValor(texto: string): string | undefined {
  const n = aNumero(texto);
  if (Number.isNaN(n)) return 'Escribe el valor como número, por ejemplo 15000000';
  if (n <= 0) return 'El valor debe ser mayor que 0';
  if (n > LIMITES.valorMax) return 'El valor es demasiado alto';
  if (!maxDecimales(n, 2)) return 'Usa máximo 2 decimales';
}

export function validarTasa(texto: string): string | undefined {
  const n = aNumero(texto);
  if (Number.isNaN(n)) return 'Escribe la tasa como número, por ejemplo 1,5';
  if (n < 0) return 'La tasa no puede ser negativa';
  if (n > LIMITES.tasaMax) return `La tasa no puede superar ${LIMITES.tasaMax}`;
  if (!maxDecimales(n, 4)) return 'Usa máximo 4 decimales';
}

export function validarCuotas(texto: string): string | undefined {
  const n = aNumero(texto);
  if (Number.isNaN(n) || !Number.isInteger(n)) return 'Las cuotas deben ser un número entero';
  if (n <= 0) return 'Debe haber al menos 1 cuota';
  if (n > LIMITES.cuotasMax) return `Máximo ${LIMITES.cuotasMax} cuotas`;
}

export function validarIdentificacion(texto: string): string | undefined {
  if (!/^\d{5,15}$/.test(texto.trim())) return 'Entre 5 y 15 dígitos, sin puntos ni espacios';
}

export function validarNombre(texto: string): string | undefined {
  const t = texto.trim();
  if (t.length < 3) return 'Escribe al menos 3 caracteres';
  if (t.length > 150) return 'Máximo 150 caracteres';
}
