import sql from 'mssql';
import type { EstadoOutbox, EventoOutbox, IntentoEnvio, Pagina } from '../../domain/types';
import type { FiltroNotificaciones, NuevoEventoOutbox, OutboxRepository, ResultadoEnvio } from '../interfaces';
import type { FabricaRequest } from './creditoRepository';

interface FilaOutbox {
  Id: number | string;
  EventId: string;
  Evento: string;
  CreditoId: number;
  Payload: string;
  Estado: EstadoOutbox;
  Intentos: number;
  UltimoCodigoHttp: number | null;
  UltimoError: string | null;
  ProximoIntento: Date;
  FechaCreacion: Date;
  FechaEnvio: Date | null;
}

interface FilaIntento {
  Id: number | string;
  OutboxId: number | string;
  NumeroIntento: number;
  Fecha: Date;
  CodigoHttp: number | null;
  Exito: boolean;
  Error: string | null;
  DuracionMs: number;
}

const iso = (d: Date): string => new Date(d).toISOString();

function mapEvento(f: FilaOutbox): EventoOutbox {
  return {
    id: Number(f.Id),
    eventId: String(f.EventId).toLowerCase(), // SQL Server devuelve los GUID en mayusculas
    evento: f.Evento,
    creditoId: f.CreditoId,
    payload: f.Payload,
    estado: f.Estado,
    intentos: f.Intentos,
    ultimoCodigoHttp: f.UltimoCodigoHttp,
    ultimoError: f.UltimoError,
    proximoIntento: iso(f.ProximoIntento),
    fechaCreacion: iso(f.FechaCreacion),
    fechaEnvio: f.FechaEnvio ? iso(f.FechaEnvio) : null,
  };
}

const COLUMNAS =
  'Id, EventId, Evento, CreditoId, Payload, Estado, Intentos, UltimoCodigoHttp, UltimoError, ProximoIntento, FechaCreacion, FechaEnvio';

export class MssqlOutboxRepository implements OutboxRepository {
  constructor(private readonly nuevaRequest: FabricaRequest) {}

  async insertar(n: NuevoEventoOutbox): Promise<EventoOutbox> {
    const r = await this.nuevaRequest()
      .input('eventId', sql.UniqueIdentifier, n.eventId)
      .input('evento', sql.VarChar(50), n.evento)
      .input('creditoId', sql.Int, n.creditoId)
      .input('payload', sql.NVarChar(sql.MAX), n.payload).query<FilaOutbox>(`
        INSERT dbo.WebhookOutbox (EventId, Evento, CreditoId, Payload)
        OUTPUT inserted.Id, inserted.EventId, inserted.Evento, inserted.CreditoId, inserted.Payload, inserted.Estado,
               inserted.Intentos, inserted.UltimoCodigoHttp, inserted.UltimoError, inserted.ProximoIntento,
               inserted.FechaCreacion, inserted.FechaEnvio
        VALUES (@eventId, @evento, @creditoId, @payload)`);
    return mapEvento(r.recordset[0] as FilaOutbox);
  }

  /**
   * Reclama eventos con UPDLOCK + READPAST: si hay varios workers, cada uno
   * toma filas distintas sin esperar a los demas. Al reclamarlos se adelanta
   * ProximoIntento (lease): si el worker muere, el evento vuelve a quedar
   * disponible solo cuando vence ese plazo.
   */
  async tomarPendientes(limite: number, leaseMs: number, ahora: Date): Promise<EventoOutbox[]> {
    const r = await this.nuevaRequest()
      .input('limite', sql.Int, limite)
      .input('ahora', sql.DateTime2(3), ahora)
      .input('hasta', sql.DateTime2(3), new Date(ahora.getTime() + leaseMs)).query<FilaOutbox>(`
        ;WITH candidatos AS (
          SELECT TOP (@limite) *
          FROM dbo.WebhookOutbox WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE Estado = 'PENDIENTE' AND ProximoIntento <= @ahora
          ORDER BY ProximoIntento, Id
        )
        UPDATE candidatos SET ProximoIntento = @hasta
        OUTPUT inserted.Id, inserted.EventId, inserted.Evento, inserted.CreditoId, inserted.Payload, inserted.Estado,
               inserted.Intentos, inserted.UltimoCodigoHttp, inserted.UltimoError, inserted.ProximoIntento,
               inserted.FechaCreacion, inserted.FechaEnvio`);
    return r.recordset.map(mapEvento).sort((a, b) => a.id - b.id);
  }

  async registrarResultado(id: number, res: ResultadoEnvio): Promise<void> {
    await this.nuevaRequest()
      .input('id', sql.BigInt, id)
      .input('estado', sql.VarChar(15), res.nuevoEstado)
      .input('codigo', sql.Int, res.codigoHttp)
      .input('error', sql.NVarChar(500), res.error)
      .input('exito', sql.Bit, res.exito)
      .input('duracion', sql.Int, res.duracionMs)
      .input('proximo', sql.DateTime2(3), res.proximoIntento)
      .input('ahora', sql.DateTime2(3), res.ahora).query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
          UPDATE dbo.WebhookOutbox
             SET Estado = @estado,
                 Intentos = Intentos + 1,
                 UltimoCodigoHttp = @codigo,
                 UltimoError = @error,
                 ProximoIntento = @proximo,
                 FechaEnvio = CASE WHEN @estado = 'ENVIADO' THEN @ahora ELSE FechaEnvio END
           WHERE Id = @id;

          INSERT dbo.WebhookIntento (OutboxId, NumeroIntento, Fecha, CodigoHttp, Exito, Error, DuracionMs)
          SELECT Id, Intentos, @ahora, @codigo, @exito, @error, @duracion
            FROM dbo.WebhookOutbox WHERE Id = @id;
        COMMIT TRANSACTION;`);
  }

  async listar(f: FiltroNotificaciones): Promise<Pagina<EventoOutbox>> {
    const req = this.nuevaRequest();
    const condiciones = ['1 = 1'];
    if (f.estado) {
      condiciones.push('Estado = @estado');
      req.input('estado', sql.VarChar(15), f.estado);
    }
    if (f.creditoId) {
      condiciones.push('CreditoId = @creditoId');
      req.input('creditoId', sql.Int, f.creditoId);
    }
    req.input('offset', sql.Int, (f.page - 1) * f.pageSize);
    req.input('limite', sql.Int, f.pageSize);
    const where = condiciones.join(' AND ');

    const r = await req.query(`
      SELECT COUNT(*) AS total FROM dbo.WebhookOutbox WHERE ${where};
      SELECT ${COLUMNAS} FROM dbo.WebhookOutbox WHERE ${where}
      ORDER BY Id DESC OFFSET @offset ROWS FETCH NEXT @limite ROWS ONLY;`);
    const [conteo, filas] = r.recordsets as unknown as [Array<{ total: number }>, FilaOutbox[]];
    return { total: conteo[0]?.total ?? 0, items: filas.map(mapEvento) };
  }

  async obtener(id: number): Promise<EventoOutbox | null> {
    const r = await this.nuevaRequest()
      .input('id', sql.BigInt, id)
      .query<FilaOutbox>(`SELECT ${COLUMNAS} FROM dbo.WebhookOutbox WHERE Id = @id`);
    const fila = r.recordset[0];
    return fila ? mapEvento(fila) : null;
  }

  async listarIntentos(outboxId: number): Promise<IntentoEnvio[]> {
    const r = await this.nuevaRequest().input('id', sql.BigInt, outboxId).query<FilaIntento>(`
      SELECT Id, OutboxId, NumeroIntento, Fecha, CodigoHttp, Exito, Error, DuracionMs
      FROM dbo.WebhookIntento WHERE OutboxId = @id ORDER BY NumeroIntento, Id`);
    return r.recordset.map((f) => ({
      id: Number(f.Id),
      outboxId: Number(f.OutboxId),
      numeroIntento: f.NumeroIntento,
      fecha: iso(f.Fecha),
      codigoHttp: f.CodigoHttp,
      exito: Boolean(f.Exito),
      error: f.Error,
      duracionMs: f.DuracionMs,
    }));
  }

  async reencolar(id: number, ahora: Date): Promise<boolean> {
    const r = await this.nuevaRequest()
      .input('id', sql.BigInt, id)
      .input('ahora', sql.DateTime2(3), ahora)
      .query(`UPDATE dbo.WebhookOutbox
              SET Estado = 'PENDIENTE', Intentos = 0, ProximoIntento = @ahora
              WHERE Id = @id AND Estado = 'FALLIDO'`);
    return (r.rowsAffected[0] ?? 0) > 0;
  }
}
