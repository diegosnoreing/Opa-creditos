export type Forma = 'vacio' | 'medio' | 'check' | 'x' | 'lleno' | 'guion';

/** Símbolos dibujados en SVG: no dependen de que la tipografía incluya los caracteres. */
export function Glifo({ forma }: { forma: Forma }) {
  const p = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, className: 'glifo', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (forma) {
    case 'vacio': return <svg {...p}><circle cx="6" cy="6" r="4.2" /></svg>;
    case 'medio': return <svg {...p}><circle cx="6" cy="6" r="4.2" /><path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor" stroke="none" /></svg>;
    case 'check': return <svg {...p}><path d="M2.2 6.4 5 9l4.8-5.6" /></svg>;
    case 'x': return <svg {...p}><path d="M3 3l6 6M9 3 3 9" /></svg>;
    case 'lleno': return <svg {...p}><circle cx="6" cy="6" r="4.2" fill="currentColor" /></svg>;
    case 'guion': return <svg {...p}><path d="M2.5 6h7" /></svg>;
  }
}
