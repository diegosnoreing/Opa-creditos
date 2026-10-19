import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../src/domain/errors';
import { MemoriaPersistencia } from '../src/repositories/memory/memoryPersistencia';
import { CreditoService } from '../src/services/creditoService';
import type { EventoWebhook } from '../src/services/webhookEventos';
import { ADMIN, ANALISTA, creditoValido } from './helpers';

const FECHA_FIJA = new Date('2026-09-07T18:00:00.000Z');

function preparar() {
  const p = new MemoriaPersistencia();
  p.reloj = () => FECHA_FIJA;
  const servicio = new CreditoService(p, () => FECHA_FIJA);
  return { p, servicio };
}

describe('CreditoService.crear', () => {
  it('crea el credito en estado SOLICITADO con numero CR-AAAA-######', async () => {
    const { servicio } = preparar();
    const credito = await servicio.crear(creditoValido(), ANALISTA);

    expect(credito).toMatchObject({
      numeroCredito: 'CR-2026-000001',
      identificacionAsociado: '1001234567',
      nombreAsociado: 'Juan Perez',
      estado: 'SOLICITADO',
      valorSolicitado: 15_000_000,
    });
  });

  it('guarda historial y evento de webhook en la misma operacion, con el formato del enunciado', async () => {
    const { p, servicio } = preparar();
    const credito = await servicio.crear(creditoValido(), ANALISTA);

    const historial = await p.creditos.listarHistorial(credito.id);
    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({ accion: 'CREACION', estadoAnterior: null, estadoNuevo: 'SOLICITADO', usuario: 'analista' });

    expect(p.state.outbox).toHaveLength(1);
    const evento = p.state.outbox[0]!;
    expect(evento).toMatchObject({ estado: 'PENDIENTE', intentos: 0, evento: 'credito.creado', creditoId: credito.id });

    const cuerpo = JSON.parse(evento.payload) as EventoWebhook;
    expect(cuerpo).toEqual({
      event: 'credito.creado',
      eventId: evento.eventId,
      timestamp: '2026-09-07T18:00:00.000Z',
      data: {
        id: credito.id,
        numeroCredito: 'CR-2026-000001',
        identificacionAsociado: '1001234567',
        valorSolicitado: 15_000_000,
        estado: 'SOLICITADO',
      },
    });
  });

  it('hace UN solo INSERT del credito: el webhook no crea nada, solo registra el evento', async () => {
    const { p, servicio } = preparar();
    await servicio.crear(creditoValido(), ANALISTA);
    expect(p.state.creditos).toHaveLength(1);
    expect(p.state.outbox).toHaveLength(1);
  });

  it('es atomico: si falla el registro del evento, no queda credito ni historial', async () => {
    const { p, servicio } = preparar();
    jest.spyOn(p.outbox, 'insertar').mockRejectedValueOnce(new Error('fallo simulado del outbox'));

    await expect(servicio.crear(creditoValido(), ANALISTA)).rejects.toThrow('fallo simulado del outbox');

    expect(p.state.creditos).toHaveLength(0);
    expect(p.state.historial).toHaveLength(0);
    expect(p.state.outbox).toHaveLength(0);
  });

  it.each([
    ['valor <= 0', { valorSolicitado: 0 }],
    ['tasa negativa', { tasaInteres: -1 }],
    ['cuotas <= 0', { numeroCuotas: 0 }],
  ])('rechaza con 422 las reglas de negocio (%s) sin guardar nada', async (_nombre, datos) => {
    const { p, servicio } = preparar();
    await expect(servicio.crear(creditoValido(datos), ANALISTA)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(p.state.creditos).toHaveLength(0);
    expect(p.state.outbox).toHaveLength(0);
  });

  it('normaliza espacios del nombre y la identificacion', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido({ nombreAsociado: '  Juan    Perez  ', identificacionAsociado: ' 1001234567 ' }), ANALISTA);
    expect(c.nombreAsociado).toBe('Juan Perez');
    expect(c.identificacionAsociado).toBe('1001234567');
  });
});

describe('control de duplicados', () => {
  it('rechaza el mismo asociado + tipo + valor mientras hay un credito en curso', async () => {
    const { servicio } = preparar();
    await servicio.crear(creditoValido(), ANALISTA);
    const intento = servicio.crear(creditoValido({ numeroCuotas: 12 }), ANALISTA);
    await expect(intento).rejects.toMatchObject({ status: 409, code: 'CREDITO_DUPLICADO' });
  });

  it('permite otro credito si cambia el valor, el tipo o el asociado', async () => {
    const { servicio } = preparar();
    await servicio.crear(creditoValido(), ANALISTA);
    await expect(servicio.crear(creditoValido({ valorSolicitado: 9_000_000 }), ANALISTA)).resolves.toBeDefined();
    await expect(servicio.crear(creditoValido({ tipoCredito: 'VIVIENDA' }), ANALISTA)).resolves.toBeDefined();
    await expect(servicio.crear(creditoValido({ identificacionAsociado: '2002345678' }), ANALISTA)).resolves.toBeDefined();
  });

  it('permite repetir las condiciones cuando el anterior fue RECHAZADO (estado final)', async () => {
    const { servicio } = preparar();
    const primero = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(primero.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await servicio.cambiarEstado(primero.id, 'RECHAZADO', 'Capacidad de pago insuficiente', ADMIN);
    await expect(servicio.crear(creditoValido(), ANALISTA)).resolves.toBeDefined();
  });

  it('permite repetir las condiciones cuando el anterior fue eliminado', async () => {
    const { servicio } = preparar();
    const primero = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.eliminar(primero.id, undefined, ADMIN);
    await expect(servicio.crear(creditoValido(), ANALISTA)).resolves.toBeDefined();
  });
});

describe('CreditoService.cambiarEstado', () => {
  it('avanza por el flujo completo y deja historial de cada paso', async () => {
    const { p, servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);

    await servicio.cambiarEstado(c.id, 'EN_ESTUDIO', 'Documentos completos', ANALISTA);
    await servicio.cambiarEstado(c.id, 'APROBADO', undefined, ADMIN);
    const final = await servicio.cambiarEstado(c.id, 'DESEMBOLSADO', undefined, ADMIN);

    expect(final.estado).toBe('DESEMBOLSADO');
    const historial = await p.creditos.listarHistorial(c.id);
    expect(historial.map((h) => h.estadoNuevo)).toEqual(['DESEMBOLSADO', 'APROBADO', 'EN_ESTUDIO', 'SOLICITADO']);
    expect(historial.find((h) => h.estadoNuevo === 'EN_ESTUDIO')).toMatchObject({
      accion: 'CAMBIO_ESTADO',
      estadoAnterior: 'SOLICITADO',
      usuario: 'analista',
      observacion: 'Documentos completos',
    });
  });

  it('rechaza RECHAZADO -> DESEMBOLSADO con 409 TRANSICION_INVALIDA', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(c.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await servicio.cambiarEstado(c.id, 'RECHAZADO', 'No cumple politica', ADMIN);

    await expect(servicio.cambiarEstado(c.id, 'DESEMBOLSADO', undefined, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'TRANSICION_INVALIDA',
    });
  });

  it('no permite saltarse el estudio (SOLICITADO -> APROBADO)', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await expect(servicio.cambiarEstado(c.id, 'APROBADO', undefined, ADMIN)).rejects.toBeInstanceOf(ConflictError);
  });

  it('un analista no puede aprobar, rechazar ni desembolsar (separacion de funciones)', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(c.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await expect(servicio.cambiarEstado(c.id, 'APROBADO', undefined, ANALISTA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(servicio.cambiarEstado(c.id, 'RECHAZADO', 'motivo', ANALISTA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('exige el motivo al rechazar o cancelar', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await expect(servicio.cambiarEstado(c.id, 'CANCELADO', '   ', ANALISTA)).rejects.toMatchObject({
      status: 422,
      code: 'OBSERVACION_REQUERIDA',
    });
    await expect(servicio.cambiarEstado(c.id, 'CANCELADO', 'Desistio el asociado', ANALISTA)).resolves.toMatchObject({
      estado: 'CANCELADO',
    });
  });

  it('un error de validacion no deja cambios a medias', async () => {
    const { p, servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(c.id, 'APROBADO', undefined, ADMIN).catch(() => undefined);
    expect((await servicio.obtener(c.id)).estado).toBe('SOLICITADO');
    expect(p.state.historial).toHaveLength(1);
  });

  it('lanza 404 si el credito no existe', async () => {
    const { servicio } = preparar();
    await expect(servicio.cambiarEstado(999, 'EN_ESTUDIO', undefined, ADMIN)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('consulta', () => {
  it('obtener un credito inexistente lanza CREDITO_NOT_FOUND', async () => {
    const { servicio } = preparar();
    await expect(servicio.obtener(123)).rejects.toMatchObject({ status: 404, code: 'CREDITO_NOT_FOUND', message: 'El crédito no existe' });
  });
});

describe('CreditoService.actualizar', () => {
  it('modifica condiciones y registra en el historial el antes y el despues', async () => {
    const { p, servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);

    const actualizado = await servicio.actualizar(c.id, { valorSolicitado: 12_000_000, numeroCuotas: 24 }, ANALISTA);

    expect(actualizado).toMatchObject({ valorSolicitado: 12_000_000, numeroCuotas: 24, tasaInteres: 1.5 });
    const [ultimo] = await p.creditos.listarHistorial(c.id);
    expect(ultimo).toMatchObject({ accion: 'ACTUALIZACION', usuario: 'analista' });
    expect(ultimo?.cambios).toEqual({
      valorSolicitado: { antes: 15_000_000, despues: 12_000_000 },
      numeroCuotas: { antes: 36, despues: 24 },
    });
  });

  it('si no cambia nada, no escribe historial', async () => {
    const { p, servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.actualizar(c.id, { numeroCuotas: 36 }, ANALISTA);
    expect(p.state.historial).toHaveLength(1);
  });

  it('valida las reglas de negocio al actualizar', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await expect(servicio.actualizar(c.id, { valorSolicitado: -5 }, ANALISTA)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('no deja modificar un credito ya aprobado (condiciones inmutables)', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(c.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await servicio.cambiarEstado(c.id, 'APROBADO', undefined, ADMIN);
    await expect(servicio.actualizar(c.id, { valorSolicitado: 1_000_000 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'CREDITO_NO_MODIFICABLE',
    });
  });

  it('no permite que una edicion cree un duplicado', async () => {
    const { servicio } = preparar();
    await servicio.crear(creditoValido({ valorSolicitado: 5_000_000 }), ANALISTA);
    const otro = await servicio.crear(creditoValido({ valorSolicitado: 7_000_000 }), ANALISTA);
    await expect(servicio.actualizar(otro.id, { valorSolicitado: 5_000_000 }, ANALISTA)).rejects.toMatchObject({
      code: 'CREDITO_DUPLICADO',
    });
  });
});

describe('CreditoService.eliminar (borrado logico)', () => {
  it('oculta el credito pero conserva el registro y su historial', async () => {
    const { p, servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.eliminar(c.id, 'Registrado por error', ADMIN);

    await expect(servicio.obtener(c.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(p.state.creditos).toHaveLength(1); // sigue en la "tabla"
    expect(p.state.creditos[0]?.eliminado).toBe(true);
    expect(p.state.historial.at(-1)).toMatchObject({ accion: 'ELIMINACION', estadoAnterior: 'SOLICITADO', observacion: 'Registrado por error' });
  });

  it('no elimina creditos APROBADOS ni DESEMBOLSADOS', async () => {
    const { servicio } = preparar();
    const c = await servicio.crear(creditoValido(), ANALISTA);
    await servicio.cambiarEstado(c.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await servicio.cambiarEstado(c.id, 'APROBADO', undefined, ADMIN);
    await expect(servicio.eliminar(c.id, undefined, ADMIN)).rejects.toMatchObject({ status: 409, code: 'CREDITO_NO_ELIMINABLE' });
  });
});

describe('resumen y listado', () => {
  it('cuenta creditos por estado y excluye los eliminados', async () => {
    const { servicio } = preparar();
    const a = await servicio.crear(creditoValido({ valorSolicitado: 1_000_000 }), ANALISTA);
    await servicio.crear(creditoValido({ valorSolicitado: 2_000_000 }), ANALISTA);
    const c = await servicio.crear(creditoValido({ valorSolicitado: 3_000_000 }), ANALISTA);
    await servicio.cambiarEstado(a.id, 'EN_ESTUDIO', undefined, ANALISTA);
    await servicio.eliminar(c.id, undefined, ADMIN);

    const r = await servicio.resumen();
    expect(r.total).toBe(2);
    expect(r.valorTotalSolicitado).toBe(3_000_000);
    expect(r.porEstado).toMatchObject({ SOLICITADO: 1, EN_ESTUDIO: 1, APROBADO: 0, RECHAZADO: 0, DESEMBOLSADO: 0, CANCELADO: 0 });
  });
});
