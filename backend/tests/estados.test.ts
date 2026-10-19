import { esEstadoFinal, puedeTransitar, TRANSICIONES } from '../src/domain/estados';
import { ESTADOS } from '../src/domain/types';

describe('maquina de estados', () => {
  it.each([
    ['SOLICITADO', 'EN_ESTUDIO'],
    ['SOLICITADO', 'CANCELADO'],
    ['EN_ESTUDIO', 'APROBADO'],
    ['EN_ESTUDIO', 'RECHAZADO'],
    ['EN_ESTUDIO', 'CANCELADO'],
    ['APROBADO', 'DESEMBOLSADO'],
    ['APROBADO', 'CANCELADO'],
  ] as const)('permite %s -> %s', (desde, hacia) => {
    expect(puedeTransitar(desde, hacia)).toBe(true);
  });

  it('prohibe RECHAZADO -> DESEMBOLSADO (ejemplo del enunciado)', () => {
    expect(puedeTransitar('RECHAZADO', 'DESEMBOLSADO')).toBe(false);
  });

  it.each([
    ['SOLICITADO', 'APROBADO'],
    ['SOLICITADO', 'DESEMBOLSADO'],
    ['EN_ESTUDIO', 'DESEMBOLSADO'],
    ['APROBADO', 'RECHAZADO'],
    ['APROBADO', 'EN_ESTUDIO'],
  ] as const)('prohibe saltos o retrocesos: %s -> %s', (desde, hacia) => {
    expect(puedeTransitar(desde, hacia)).toBe(false);
  });

  it('los estados finales no tienen salida', () => {
    for (const final of ['RECHAZADO', 'DESEMBOLSADO', 'CANCELADO'] as const) {
      expect(esEstadoFinal(final)).toBe(true);
      for (const destino of ESTADOS) expect(puedeTransitar(final, destino)).toBe(false);
    }
  });

  it('ningun estado puede pasar a si mismo', () => {
    for (const e of ESTADOS) expect(puedeTransitar(e, e)).toBe(false);
  });

  it('define transiciones para todos los estados', () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...ESTADOS].sort());
  });
});
