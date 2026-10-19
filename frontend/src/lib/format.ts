const moneda = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const moneda2 = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const entero = new Intl.NumberFormat('es-CO');
const fecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const fechaHora = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
});

export const formatoMoneda = (n: number): string => (Number.isInteger(n) ? moneda.format(n) : moneda2.format(n));
export const formatoCompacto = (n: number): string => compacto.format(n);
export const formatoEntero = (n: number): string => entero.format(n);
export const formatoFecha = (iso: string): string => fecha.format(new Date(iso));
export const formatoFechaHora = (iso: string): string => fechaHora.format(new Date(iso));
export const formatoTasa = (n: number): string => `${n.toLocaleString('es-CO', { maximumFractionDigits: 4 })} % mensual`;

/** Cuota mensual aproximada (sistema francés) con la tasa mensual del crédito. Solo orientativa. */
export function cuotaEstimada(valor: number, tasaMensualPct: number, cuotas: number): number | null {
  if (!(valor > 0) || !(cuotas > 0) || !(tasaMensualPct >= 0)) return null;
  const i = tasaMensualPct / 100;
  if (i === 0) return valor / cuotas;
  return (valor * i) / (1 - Math.pow(1 + i, -cuotas));
}
