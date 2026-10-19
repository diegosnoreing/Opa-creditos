import sql, { type ConnectionPool } from 'mssql';
import type { Rol, Usuario } from '../../domain/types';
import type { Persistencia, Repositorios, UnitOfWork, UsuarioRepository } from '../interfaces';
import { MssqlCreditoRepository } from './creditoRepository';
import { MssqlOutboxRepository } from './outboxRepository';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export async function crearPool(cfg: DbConfig): Promise<ConnectionPool> {
  const pool = new sql.ConnectionPool({
    server: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: { encrypt: cfg.encrypt, trustServerCertificate: cfg.trustServerCertificate },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 15_000,
  });
  await pool.connect();
  return pool;
}

class MssqlUsuarioRepository implements UsuarioRepository {
  constructor(private readonly pool: ConnectionPool) {}

  async buscarPorUsername(username: string): Promise<Usuario | null> {
    const r = await this.pool
      .request()
      .input('u', sql.VarChar(50), username)
      .query<{ Id: number; Username: string; PasswordHash: string; Rol: Rol; Activo: boolean }>(
        'SELECT Id, Username, PasswordHash, Rol, Activo FROM dbo.Usuarios WHERE Username = @u',
      );
    const f = r.recordset[0];
    return f ? { id: f.Id, username: f.Username, passwordHash: f.PasswordHash, rol: f.Rol, activo: Boolean(f.Activo) } : null;
  }

  async crear(d: { username: string; passwordHash: string; rol: Rol }): Promise<void> {
    await this.pool
      .request()
      .input('u', sql.VarChar(50), d.username)
      .input('h', sql.VarChar(100), d.passwordHash)
      .input('r', sql.VarChar(20), d.rol)
      .query('INSERT dbo.Usuarios (Username, PasswordHash, Rol) VALUES (@u, @h, @r)');
  }

  async contar(): Promise<number> {
    const r = await this.pool.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.Usuarios');
    return r.recordset[0]?.n ?? 0;
  }
}

/** Una transaccion de SQL Server: credito, historial y outbox se confirman juntos o ninguno. */
class MssqlUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: ConnectionPool) {}

  async run<T>(fn: (repos: Repositorios) => Promise<T>): Promise<T> {
    const tx = new sql.Transaction(this.pool);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      const fabrica = () => new sql.Request(tx);
      const resultado = await fn({
        creditos: new MssqlCreditoRepository(fabrica),
        outbox: new MssqlOutboxRepository(fabrica),
      });
      await tx.commit();
      return resultado;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        /* la transaccion ya estaba abortada: se conserva el error original */
      }
      throw error;
    }
  }
}

export function crearPersistenciaMssql(pool: ConnectionPool): Persistencia {
  const fabrica = () => pool.request();
  return {
    uow: new MssqlUnitOfWork(pool),
    creditos: new MssqlCreditoRepository(fabrica),
    outbox: new MssqlOutboxRepository(fabrica),
    usuarios: new MssqlUsuarioRepository(pool),
    async ping() {
      await pool.request().query('SELECT 1 AS ok');
    },
  };
}
