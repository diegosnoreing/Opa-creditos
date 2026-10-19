import { describe, expect, it } from 'vitest';
import { aNumero, validarCuotas, validarIdentificacion, validarNombre, validarTasa, validarValor } from './validation';
import { esFinal, exigeMotivo, puedeEditar, puedeEliminar, transicionesPermitidas } from './estados';
import { cuotaEstimada, formatoMoneda } from './format';

describe('aNumero', () => {
  it.each([
    ['15000000', 15000000],
    ['15.000.000', 15000000],
    ['1.500,50', 1500.5],
    ['1,5', 1.5],
    ['1.5', 1.5],
    [' 36 ', 36],
  ])('interpreta %s', (texto, esperado) => expect(aNumero(texto)).toBe(esperado));
  it.each(['', 'abc', '1,2,3', '--4'])('rechaza "%s"', (t) => expect(aNumero(t)).toBeNaN());
});

describe('validaciones de formulario (reflejan las reglas del backend)', () => {
  it('valor', () => {
    expect(validarValor('15000000')).toBeUndefined();
    expect(validarValor('0')).toMatch(/mayor que 0/);
    expect(validarValor('-5')).toMatch(/mayor que 0/);
    expect(validarValor('10,005')).toMatch(/2 decimales/);
    expect(validarValor('abc')).toMatch(/número/);
  });
  it('tasa', () => {
    expect(validarTasa('0')).toBeUndefined();
    expect(validarTasa('1,5')).toBeUndefined();
    expect(validarTasa('-1')).toMatch(/negativa/);
    expect(validarTasa('101')).toMatch(/superar/);
  });
  it('cuotas', () => {
    expect(validarCuotas('36')).toBeUndefined();
    expect(validarCuotas('0')).toMatch(/al menos 1/);
    expect(validarCuotas('2,5')).toMatch(/entero/);
    expect(validarCuotas('361')).toMatch(/Máximo/);
  });
  it('identificación y nombre', () => {
    expect(validarIdentificacion('1001234567')).toBeUndefined();
    expect(validarIdentificacion('123')).toBeDefined();
    expect(validarIdentificacion('10.012.345')).toBeDefined();
    expect(validarNombre('Ana')).toBeUndefined();
    expect(validarNombre('Al')).toBeDefined();
  });
});

describe('reglas de estado para la interfaz', () => {
  it('el analista no ve decisiones de ADMIN', () => {
    expect(transicionesPermitidas('EN_ESTUDIO', 'ANALISTA')).toEqual(['CANCELADO']);
    expect(transicionesPermitidas('EN_ESTUDIO', 'ADMIN')).toEqual(['APROBADO', 'RECHAZADO', 'CANCELADO']);
    expect(transicionesPermitidas('SOLICITADO', 'ANALISTA')).toEqual(['EN_ESTUDIO', 'CANCELADO']);
  });
  it('los estados finales no tienen salida', () => {
    for (const e of ['RECHAZADO', 'DESEMBOLSADO', 'CANCELADO'] as const) {
      expect(esFinal(e)).toBe(true);
      expect(transicionesPermitidas(e, 'ADMIN')).toEqual([]);
    }
  });
  it('edición, eliminación y motivo', () => {
    expect(puedeEditar('EN_ESTUDIO')).toBe(true);
    expect(puedeEditar('APROBADO')).toBe(false);
    expect(puedeEliminar('SOLICITADO', 'ADMIN')).toBe(true);
    expect(puedeEliminar('SOLICITADO', 'ANALISTA')).toBe(false);
    expect(puedeEliminar('APROBADO', 'ADMIN')).toBe(false);
    expect(exigeMotivo('RECHAZADO')).toBe(true);
    expect(exigeMotivo('APROBADO')).toBe(false);
  });
});

describe('formato', () => {
  it('cuota estimada', () => {
    expect(cuotaEstimada(1200, 0, 12)).toBe(100);
    expect(cuotaEstimada(0, 1, 12)).toBeNull();
    const c = cuotaEstimada(10_000_000, 1.5, 36);
    expect(c).toBeGreaterThan(361_000);
    expect(c).toBeLessThan(362_000);
  });
  it('moneda en pesos', () => {
    expect(formatoMoneda(15000000)).toContain('15.000.000');
  });
});
