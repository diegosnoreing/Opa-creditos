import { randomUUID } from 'node:crypto';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../domain/errors';
import {
  ESTADOS_CON_MOTIVO_OBLIGATORIO,
  ESTADOS_EDITABLES,
  ESTADOS_ELIMINABLES,
  ESTADOS_SOLO_ADMIN,
  puedeTransitar,
} from '../domain/estados';
import {
  CAMPOS_ACTUALIZABLES,
  type Actor,
  type ActualizarCreditoInput,
  type CrearCreditoInput,
  type Credito,
  type Estado,
  type FiltroCreditos,
  type HistorialEntrada,
  type Pagina,
  type ResumenCreditos,
} from '../domain/types';
import { validarCondiciones } from '../domain/validaciones';
import type { Persistencia } from '../repositories/interfaces';
import { construirEventoCreditoCreado, EVENTO_CREDITO_CREADO } from './webhookEventos';

const normalizarEspacios = (s: string): string => s.trim().replace(/\s+/g, ' ');

/**
 * Unico punto de entrada para las operaciones sobre creditos. Aqui viven las
 * reglas de negocio: validaciones, duplicados, transiciones de estado,
 * permisos por estado, auditoria y evento de webhook. Los controladores solo
 * traducen HTTP; la base de datos es la ultima red de seguridad (CHECK, UNIQUE).
 */
export class CreditoService {
  constructor(
    private readonly p: Pick<Persistencia, 'uow' | 'creditos'>,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  /**
   * Crea el credito, su historial y el evento del webhook en UNA transaccion.
   * El webhook no hace un segundo INSERT ni repite reglas: solo se enviara
   * (despues, desde el worker) lo que esta transaccion dejo en el outbox.
   */
  async crear(entrada: CrearCreditoInput, actor: Actor): Promise<Credito> {
    const datos: CrearCreditoInput = {
      ...entrada,
      identificacionAsociado: entrada.identificacionAsociado.trim(),
      nombreAsociado: normalizarEspacios(entrada.nombreAsociado),
    };
    validarCondiciones(datos);

    return this.p.uow.run(async ({ creditos, outbox }) => {
      const duplicado = await creditos.existeDuplicadoEnCurso({
        identificacion: datos.identificacionAsociado,
        tipoCredito: datos.tipoCredito,
        valorSolicitado: datos.valorSolicitado,
      });
      if (duplicado) throw this.errorDuplicado();

      const numeroCredito = await creditos.siguienteNumero(this.reloj().getUTCFullYear());
      const credito = await creditos.insertar({ ...datos, numeroCredito });

      await creditos.agregarHistorial({
        creditoId: credito.id,
        accion: 'CREACION',
        estadoAnterior: null,
        estadoNuevo: credito.estado,
        usuario: actor.username,
        observacion: null,
        cambios: null,
      });

      const eventId = randomUUID();
      await outbox.insertar({
        eventId,
        evento: EVENTO_CREDITO_CREADO,
        creditoId: credito.id,
        payload: JSON.stringify(construirEventoCreditoCreado(credito, eventId, this.reloj())),
      });

      return credito;
    });
  }

  async obtener(id: number): Promise<Credito> {
    const credito = await this.p.creditos.obtenerPorId(id);
    if (!credito) throw new NotFoundError();
    return credito;
  }

  listar(filtro: FiltroCreditos): Promise<Pagina<Credito>> {
    return this.p.creditos.listar(filtro);
  }

  resumen(): Promise<ResumenCreditos> {
    return this.p.creditos.resumen();
  }

  async historial(id: number): Promise<HistorialEntrada[]> {
    await this.obtener(id);
    return this.p.creditos.listarHistorial(id);
  }

  /** Solo se pueden editar las condiciones mientras el credito sigue SOLICITADO o EN_ESTUDIO. */
  async actualizar(id: number, cambios: ActualizarCreditoInput, actor: Actor): Promise<Credito> {
    validarCondiciones(cambios);

    return this.p.uow.run(async ({ creditos }) => {
      const actual = await creditos.obtenerPorId(id, { bloquear: true });
      if (!actual) throw new NotFoundError();

      if (!ESTADOS_EDITABLES.includes(actual.estado)) {
        throw new ConflictError(
          'CREDITO_NO_MODIFICABLE',
          `Un crédito en estado ${actual.estado} ya no admite cambios en sus condiciones`,
        );
      }

      // Solo se registra lo que realmente cambia.
      const diferencias: NonNullable<HistorialEntrada['cambios']> = {};
      const aplicar: ActualizarCreditoInput = {};
      for (const campo of CAMPOS_ACTUALIZABLES) {
        const nuevo = cambios[campo];
        if (nuevo !== undefined && nuevo !== actual[campo]) {
          diferencias[campo] = { antes: actual[campo], despues: nuevo };
          Object.assign(aplicar, { [campo]: nuevo });
        }
      }
      if (Object.keys(diferencias).length === 0) return actual;

      const resultante = { ...actual, ...aplicar };
      const duplicado = await creditos.existeDuplicadoEnCurso({
        identificacion: actual.identificacionAsociado,
        tipoCredito: resultante.tipoCredito,
        valorSolicitado: resultante.valorSolicitado,
        excluirId: id,
      });
      if (duplicado) throw this.errorDuplicado();

      const actualizado = await creditos.actualizar(id, aplicar);
      await creditos.agregarHistorial({
        creditoId: id,
        accion: 'ACTUALIZACION',
        estadoAnterior: actual.estado,
        estadoNuevo: actual.estado,
        usuario: actor.username,
        observacion: null,
        cambios: diferencias,
      });
      return actualizado;
    });
  }

  async cambiarEstado(id: number, nuevoEstado: Estado, observacion: string | undefined, actor: Actor): Promise<Credito> {
    const motivo = observacion ? normalizarEspacios(observacion) : '';

    return this.p.uow.run(async ({ creditos }) => {
      const actual = await creditos.obtenerPorId(id, { bloquear: true });
      if (!actual) throw new NotFoundError();

      if (ESTADOS_SOLO_ADMIN.includes(nuevoEstado) && actor.rol !== 'ADMIN') {
        throw new ForbiddenError(
          `Solo un administrador puede pasar un crédito a ${nuevoEstado}`,
          'PERMISO_DENEGADO',
        );
      }

      if (!puedeTransitar(actual.estado, nuevoEstado)) {
        throw new ConflictError(
          'TRANSICION_INVALIDA',
          `No se puede pasar un crédito de ${actual.estado} a ${nuevoEstado}`,
        );
      }

      if (ESTADOS_CON_MOTIVO_OBLIGATORIO.includes(nuevoEstado) && motivo.length === 0) {
        throw new BusinessRuleError('OBSERVACION_REQUERIDA', `Debes indicar el motivo para pasar el crédito a ${nuevoEstado}`, [
          { campo: 'observacion', mensaje: 'La observación es obligatoria para este estado' },
        ]);
      }

      const actualizado = await creditos.cambiarEstado(id, nuevoEstado);
      await creditos.agregarHistorial({
        creditoId: id,
        accion: 'CAMBIO_ESTADO',
        estadoAnterior: actual.estado,
        estadoNuevo: nuevoEstado,
        usuario: actor.username,
        observacion: motivo || null,
        cambios: null,
      });
      return actualizado;
    });
  }

  /** Borrado logico: el registro y su historial se conservan para auditoria. */
  async eliminar(id: number, observacion: string | undefined, actor: Actor): Promise<void> {
    await this.p.uow.run(async ({ creditos }) => {
      const actual = await creditos.obtenerPorId(id, { bloquear: true });
      if (!actual) throw new NotFoundError();

      if (!ESTADOS_ELIMINABLES.includes(actual.estado)) {
        throw new ConflictError(
          'CREDITO_NO_ELIMINABLE',
          `Un crédito en estado ${actual.estado} no se puede eliminar`,
        );
      }

      await creditos.marcarEliminado(id);
      await creditos.agregarHistorial({
        creditoId: id,
        accion: 'ELIMINACION',
        estadoAnterior: actual.estado,
        estadoNuevo: null,
        usuario: actor.username,
        observacion: observacion ? normalizarEspacios(observacion) : null,
        cambios: null,
      });
    });
  }

  private errorDuplicado(): ConflictError {
    return new ConflictError(
      'CREDITO_DUPLICADO',
      'Ya existe un crédito en curso del mismo asociado, tipo y valor',
    );
  }
}
