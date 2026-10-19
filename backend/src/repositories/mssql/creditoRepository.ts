import sql, { type Request } from 'mssql';
import { ConflictError } from '../../domain/errors';
import {
  ESTADOS,
  type ActualizarCreditoInput,
  type Credito,
  type Estado,
  type FiltroCreditos,
  type HistorialEntrada,
  type NuevoHistorial,
  type Pagina,
  type ResumenCreditos,
} from '../../domain/types';
import type { CreditoRepository, NuevoCredito } from '../interfaces';

export type FabricaRequest = () => Request;

interface FilaCredito {
  id: number;
  numeroCredito: string;
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: Credito['tipoCredito'];
  valorSolicitado: number | string;
  tasaInteres: number | string;
  numeroCuotas: number;
  formaPago: Credito['formaPago'];
  estado: Estado;
  fechaSolicitud: Date;
  fechaActualizacion: Date;
}

interface FilaHistorial {
  Id: number | string;
  CreditoId: number;
  Accion: HistorialEntrada['accion'];
  EstadoAnterior: Estado | null;
  EstadoNuevo: Estado | null;
  Usuario: string;
  Observacion: string | null;
  Cambios: string | null;
  Fecha: Date;
}

/** Columnas que se devuelven siempre, con los alias que espera el dominio. */
const SELECT_CREDITO = `
  c.Id                 AS id,
  c.NumeroCredito      AS numeroCredito,
  a.Identificacion     AS identificacionAsociado,
  a.Nombre             AS nombreAsociado,
  c.TipoCredito        AS tipoCredito,
  c.ValorSolicitado    AS valorSolicitado,
  c.TasaInteres        AS tasaInteres,
  c.NumeroCuotas       AS numeroCuotas,
  c.FormaPago          AS formaPago,
  c.Estado             AS estado,
  c.FechaSolicitud     AS fechaSolicitud,
  c.FechaActualizacion AS fechaActualizacion`;

/** Solo estas columnas se pueden usar en ORDER BY. Nunca se interpola texto del cliente. */
const COLUMNA_ORDEN: Record<FiltroCreditos['sortBy'], string> = {
  fechaSolicitud: 'c.FechaSolicitud',
  valorSolicitado: 'c.ValorSolicitado',
  numeroCredito: 'c.NumeroCredito',
  estado: 'c.Estado',
  nombreAsociado: 'a.Nombre',
};

const NOMBRE_INDICE_DUPLICADOS = 'UX_Creditos_Duplicado_Curso';

function mapCredito(f: FilaCredito): Credito {
  return {
    id: f.id,
    numeroCredito: f.numeroCredito,
    identificacionAsociado: f.identificacionAsociado,
    nombreAsociado: f.nombreAsociado,
    tipoCredito: f.tipoCredito,
    valorSolicitado: Number(f.valorSolicitado),
    tasaInteres: Number(f.tasaInteres),
    numeroCuotas: f.numeroCuotas,
    formaPago: f.formaPago,
    estado: f.estado,
    fechaSolicitud: new Date(f.fechaSolicitud).toISOString(),
    fechaActualizacion: new Date(f.fechaActualizacion).toISOString(),
  };
}

/** 2601/2627 = violacion de indice o restriccion UNIQUE. */
function esDuplicadoEnCurso(e: unknown): boolean {
  const err = e as { number?: number; message?: string };
  return (err.number === 2601 || err.number === 2627) && (err.message ?? '').includes(NOMBRE_INDICE_DUPLICADOS);
}

/** Escapa los comodines de LIKE para que la busqueda del usuario sea literal. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_[]/g, (c) => `\\${c}`);
}

/**
 * Acceso a datos con consultas SIEMPRE parametrizadas (nunca se concatenan
 * valores del usuario al SQL): impide la inyeccion SQL.
 */
export class MssqlCreditoRepository implements CreditoRepository {
  constructor(private readonly nuevaRequest: FabricaRequest) {}

  async siguienteNumero(anio: number): Promise<string> {
    const r = await this.nuevaRequest().query<{ n: number }>('SELECT NEXT VALUE FOR dbo.SeqNumeroCredito AS n');
    const n = r.recordset[0]?.n ?? 0;
    return `CR-${anio}-${String(n).padStart(6, '0')}`;
  }

  async insertar(nuevo: NuevoCredito): Promise<Credito> {
    const asociadoId = await this.obtenerOCrearAsociado(nuevo.identificacionAsociado, nuevo.nombreAsociado);
    try {
      const r = await this.nuevaRequest()
        .input('numero', sql.VarChar(20), nuevo.numeroCredito)
        .input('asociadoId', sql.Int, asociadoId)
        .input('tipo', sql.VarChar(30), nuevo.tipoCredito)
        .input('valor', sql.Decimal(18, 2), nuevo.valorSolicitado)
        .input('tasa', sql.Decimal(7, 4), nuevo.tasaInteres)
        .input('cuotas', sql.Int, nuevo.numeroCuotas)
        .input('forma', sql.VarChar(20), nuevo.formaPago).query<{ Id: number }>(`
          INSERT dbo.Creditos (NumeroCredito, AsociadoId, TipoCredito, ValorSolicitado, TasaInteres, NumeroCuotas, FormaPago)
          OUTPUT inserted.Id
          VALUES (@numero, @asociadoId, @tipo, @valor, @tasa, @cuotas, @forma)`);
      const id = r.recordset[0]?.Id as number;
      return (await this.obtenerPorId(id)) as Credito;
    } catch (e) {
      if (esDuplicadoEnCurso(e)) {
        throw new ConflictError('CREDITO_DUPLICADO', 'Ya existe un crédito en curso del mismo asociado, tipo y valor');
      }
      throw e;
    }
  }

  /** HOLDLOCK + UPDLOCK evitan que dos peticiones simultaneas creen el mismo asociado. */
  private async obtenerOCrearAsociado(identificacion: string, nombre: string): Promise<number> {
    const existente = await this.nuevaRequest()
      .input('ident', sql.VarChar(20), identificacion)
      .query<{ Id: number }>('SELECT Id FROM dbo.Asociados WITH (UPDLOCK, HOLDLOCK) WHERE Identificacion = @ident');
    if (existente.recordset[0]) return existente.recordset[0].Id;

    const creado = await this.nuevaRequest()
      .input('ident', sql.VarChar(20), identificacion)
      .input('nombre', sql.NVarChar(150), nombre)
      .query<{ Id: number }>('INSERT dbo.Asociados (Identificacion, Nombre) OUTPUT inserted.Id VALUES (@ident, @nombre)');
    return creado.recordset[0]?.Id as number;
  }

  async obtenerPorId(id: number, opciones?: { bloquear?: boolean }): Promise<Credito | null> {
    const pista = opciones?.bloquear ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const r = await this.nuevaRequest().input('id', sql.Int, id).query<FilaCredito>(`
      SELECT ${SELECT_CREDITO}
      FROM dbo.Creditos c ${pista}
      INNER JOIN dbo.Asociados a ON a.Id = c.AsociadoId
      WHERE c.Id = @id AND c.Eliminado = 0`);
    const fila = r.recordset[0];
    return fila ? mapCredito(fila) : null;
  }

  async existeDuplicadoEnCurso(p: {
    identificacion: string;
    tipoCredito: string;
    valorSolicitado: number;
    excluirId?: number;
  }): Promise<boolean> {
    const r = await this.nuevaRequest()
      .input('ident', sql.VarChar(20), p.identificacion)
      .input('tipo', sql.VarChar(30), p.tipoCredito)
      .input('valor', sql.Decimal(18, 2), p.valorSolicitado)
      .input('excluir', sql.Int, p.excluirId ?? null)
      .query<{ existe: number }>(`
        SELECT TOP (1) 1 AS existe
        FROM dbo.Creditos c
        INNER JOIN dbo.Asociados a ON a.Id = c.AsociadoId
        WHERE a.Identificacion = @ident
          AND c.TipoCredito = @tipo
          AND c.ValorSolicitado = @valor
          AND c.Eliminado = 0
          AND c.Estado IN ('SOLICITADO','EN_ESTUDIO','APROBADO')
          AND (@excluir IS NULL OR c.Id <> @excluir)`);
    return r.recordset.length > 0;
  }

  async listar(f: FiltroCreditos): Promise<Pagina<Credito>> {
    const req = this.nuevaRequest();
    const condiciones = ['c.Eliminado = 0'];

    if (f.estado) {
      condiciones.push('c.Estado = @estado');
      req.input('estado', sql.VarChar(20), f.estado);
    }
    if (f.identificacion) {
      condiciones.push('a.Identificacion = @ident');
      req.input('ident', sql.VarChar(20), f.identificacion);
    }
    if (f.tipoCredito) {
      condiciones.push('c.TipoCredito = @tipo');
      req.input('tipo', sql.VarChar(30), f.tipoCredito);
    }
    if (f.q) {
      condiciones.push(
        `(c.NumeroCredito LIKE @q ESCAPE '\\' OR a.Nombre LIKE @q ESCAPE '\\' OR a.Identificacion LIKE @q ESCAPE '\\')`,
      );
      req.input('q', sql.NVarChar(120), `%${escaparLike(f.q)}%`);
    }

    req.input('offset', sql.Int, (f.page - 1) * f.pageSize);
    req.input('limite', sql.Int, f.pageSize);

    const where = condiciones.join(' AND ');
    const orden = `${COLUMNA_ORDEN[f.sortBy]} ${f.sortDir === 'asc' ? 'ASC' : 'DESC'}, c.Id DESC`;

    const r = await req.query(`
      SELECT COUNT(*) AS total
      FROM dbo.Creditos c INNER JOIN dbo.Asociados a ON a.Id = c.AsociadoId
      WHERE ${where};

      SELECT ${SELECT_CREDITO}
      FROM dbo.Creditos c INNER JOIN dbo.Asociados a ON a.Id = c.AsociadoId
      WHERE ${where}
      ORDER BY ${orden}
      OFFSET @offset ROWS FETCH NEXT @limite ROWS ONLY;`);

    const [conteo, filas] = r.recordsets as unknown as [Array<{ total: number }>, FilaCredito[]];
    return { total: conteo[0]?.total ?? 0, items: filas.map(mapCredito) };
  }

  async resumen(): Promise<ResumenCreditos> {
    const r = await this.nuevaRequest().query<{ estado: Estado; cantidad: number; valor: number | string }>(`
      SELECT Estado AS estado, COUNT(*) AS cantidad, SUM(ValorSolicitado) AS valor
      FROM dbo.Creditos WHERE Eliminado = 0 GROUP BY Estado`);
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<Estado, number>;
    let total = 0;
    let valor = 0;
    for (const fila of r.recordset) {
      porEstado[fila.estado] = fila.cantidad;
      total += fila.cantidad;
      valor += Number(fila.valor);
    }
    return { total, valorTotalSolicitado: Math.round(valor * 100) / 100, porEstado };
  }

  async actualizar(id: number, campos: ActualizarCreditoInput): Promise<Credito> {
    const req = this.nuevaRequest().input('id', sql.Int, id);
    const sets: string[] = [];
    if (campos.tipoCredito !== undefined) {
      sets.push('TipoCredito = @tipo');
      req.input('tipo', sql.VarChar(30), campos.tipoCredito);
    }
    if (campos.valorSolicitado !== undefined) {
      sets.push('ValorSolicitado = @valor');
      req.input('valor', sql.Decimal(18, 2), campos.valorSolicitado);
    }
    if (campos.tasaInteres !== undefined) {
      sets.push('TasaInteres = @tasa');
      req.input('tasa', sql.Decimal(7, 4), campos.tasaInteres);
    }
    if (campos.numeroCuotas !== undefined) {
      sets.push('NumeroCuotas = @cuotas');
      req.input('cuotas', sql.Int, campos.numeroCuotas);
    }
    if (campos.formaPago !== undefined) {
      sets.push('FormaPago = @forma');
      req.input('forma', sql.VarChar(20), campos.formaPago);
    }
    sets.push('FechaActualizacion = SYSUTCDATETIME()');

    try {
      await req.query(`UPDATE dbo.Creditos SET ${sets.join(', ')} WHERE Id = @id AND Eliminado = 0`);
    } catch (e) {
      if (esDuplicadoEnCurso(e)) {
        throw new ConflictError('CREDITO_DUPLICADO', 'Ya existe un crédito en curso del mismo asociado, tipo y valor');
      }
      throw e;
    }
    return (await this.obtenerPorId(id)) as Credito;
  }

  async cambiarEstado(id: number, estado: Estado): Promise<Credito> {
    await this.nuevaRequest()
      .input('id', sql.Int, id)
      .input('estado', sql.VarChar(20), estado)
      .query('UPDATE dbo.Creditos SET Estado = @estado, FechaActualizacion = SYSUTCDATETIME() WHERE Id = @id AND Eliminado = 0');
    return (await this.obtenerPorId(id)) as Credito;
  }

  async marcarEliminado(id: number): Promise<void> {
    await this.nuevaRequest()
      .input('id', sql.Int, id)
      .query(`UPDATE dbo.Creditos
              SET Eliminado = 1, FechaEliminacion = SYSUTCDATETIME(), FechaActualizacion = SYSUTCDATETIME()
              WHERE Id = @id AND Eliminado = 0`);
  }

  async agregarHistorial(e: NuevoHistorial): Promise<void> {
    await this.nuevaRequest()
      .input('creditoId', sql.Int, e.creditoId)
      .input('accion', sql.VarChar(20), e.accion)
      .input('anterior', sql.VarChar(20), e.estadoAnterior)
      .input('nuevo', sql.VarChar(20), e.estadoNuevo)
      .input('usuario', sql.VarChar(100), e.usuario)
      .input('observacion', sql.NVarChar(500), e.observacion)
      .input('cambios', sql.NVarChar(sql.MAX), e.cambios ? JSON.stringify(e.cambios) : null).query(`
        INSERT dbo.HistorialCredito (CreditoId, Accion, EstadoAnterior, EstadoNuevo, Usuario, Observacion, Cambios)
        VALUES (@creditoId, @accion, @anterior, @nuevo, @usuario, @observacion, @cambios)`);
  }

  async listarHistorial(creditoId: number): Promise<HistorialEntrada[]> {
    const r = await this.nuevaRequest().input('id', sql.Int, creditoId).query<FilaHistorial>(`
      SELECT Id, CreditoId, Accion, EstadoAnterior, EstadoNuevo, Usuario, Observacion, Cambios, Fecha
      FROM dbo.HistorialCredito WHERE CreditoId = @id
      ORDER BY Fecha DESC, Id DESC`);
    return r.recordset.map((f) => ({
      id: Number(f.Id),
      creditoId: f.CreditoId,
      accion: f.Accion,
      estadoAnterior: f.EstadoAnterior,
      estadoNuevo: f.EstadoNuevo,
      usuario: f.Usuario,
      observacion: f.Observacion,
      cambios: f.Cambios ? (JSON.parse(f.Cambios) as HistorialEntrada['cambios']) : null,
      fecha: new Date(f.Fecha).toISOString(),
    }));
  }
}
