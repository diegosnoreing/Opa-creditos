import { BusinessRuleError } from '../src/domain/errors';
import { validarCondiciones } from '../src/domain/validaciones';

function camposInvalidos(datos: Parameters<typeof validarCondiciones>[0]): string[] {
  try {
    validarCondiciones(datos);
    return [];
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessRuleError);
    return (e as BusinessRuleError).details?.map((d) => d.campo ?? '') ?? [];
  }
}

describe('reglas de negocio sobre las condiciones del credito', () => {
  it('acepta datos validos', () => {
    expect(camposInvalidos({ valorSolicitado: 15_000_000, tasaInteres: 1.5, numeroCuotas: 36 })).toEqual([]);
  });

  it('acepta tasa 0 (limite permitido: tasaInteres >= 0)', () => {
    expect(camposInvalidos({ tasaInteres: 0 })).toEqual([]);
  });

  it.each([0, -1, -0.01])('rechaza valorSolicitado <= 0 (%p)', (valor) => {
    expect(camposInvalidos({ valorSolicitado: valor })).toEqual(['valorSolicitado']);
  });

  it('rechaza tasaInteres negativa', () => {
    expect(camposInvalidos({ tasaInteres: -0.1 })).toEqual(['tasaInteres']);
  });

  it.each([0, -5])('rechaza numeroCuotas <= 0 (%p)', (cuotas) => {
    expect(camposInvalidos({ numeroCuotas: cuotas })).toEqual(['numeroCuotas']);
  });

  it('rechaza cuotas no enteras', () => {
    expect(camposInvalidos({ numeroCuotas: 12.5 })).toEqual(['numeroCuotas']);
  });

  it('rechaza mas de 2 decimales en el valor y mas de 4 en la tasa', () => {
    expect(camposInvalidos({ valorSolicitado: 100.005 })).toEqual(['valorSolicitado']);
    expect(camposInvalidos({ tasaInteres: 1.23456 })).toEqual(['tasaInteres']);
  });

  it('rechaza valores por encima de los limites de las columnas', () => {
    expect(camposInvalidos({ valorSolicitado: 1e14 })).toEqual(['valorSolicitado']);
    expect(camposInvalidos({ tasaInteres: 101 })).toEqual(['tasaInteres']);
    expect(camposInvalidos({ numeroCuotas: 361 })).toEqual(['numeroCuotas']);
  });

  it('informa todos los campos invalidos a la vez', () => {
    expect(camposInvalidos({ valorSolicitado: -1, tasaInteres: -1, numeroCuotas: 0 })).toEqual([
      'valorSolicitado',
      'tasaInteres',
      'numeroCuotas',
    ]);
  });

  it('en una actualizacion parcial solo valida los campos presentes', () => {
    expect(camposInvalidos({ numeroCuotas: 24 })).toEqual([]);
  });
});
