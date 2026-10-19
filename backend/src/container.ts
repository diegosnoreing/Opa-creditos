import type { ConnectionPool } from 'mssql';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { crearLogger } from './logger';
import { crearPersistenciaMssql, crearPool } from './repositories/mssql/mssqlPersistencia';
import type { Persistencia } from './repositories/interfaces';
import { AuthService } from './services/authService';
import { CreditoService } from './services/creditoService';
import { WebhookDispatcher } from './services/webhookDispatcher';

export interface Contenedor {
  logger: Logger;
  pool: ConnectionPool;
  persistencia: Persistencia;
  creditoService: CreditoService;
  authService: AuthService;
  /** Undefined si WEBHOOK_URL no esta configurado: los eventos se guardan pero no se envian. */
  dispatcher: WebhookDispatcher | undefined;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Conecta a SQL Server reintentando: en docker la base puede tardar unos segundos en aceptar conexiones. */
async function conectarConReintentos(env: Env, logger: Logger): Promise<ConnectionPool> {
  const intentos = 10;
  for (let i = 1; ; i++) {
    try {
      return await crearPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        encrypt: env.DB_ENCRYPT,
        trustServerCertificate: env.DB_TRUST_SERVER_CERT,
      });
    } catch (e) {
      if (i >= intentos) throw e;
      logger.warn({ intento: i, de: intentos, motivo: e instanceof Error ? e.message : String(e) }, 'base de datos no disponible, reintentando en 3 s');
      await esperar(3000);
    }
  }
}

/** Ensambla las dependencias reales (SQL Server). Es el unico lugar que conoce todas las piezas. */
export async function crearContenedor(env: Env): Promise<Contenedor> {
  const logger = crearLogger(env.LOG_LEVEL);
  const pool = await conectarConReintentos(env, logger);
  const persistencia = crearPersistenciaMssql(pool);

  const authService = new AuthService(persistencia.usuarios, { jwtSecret: env.JWT_SECRET, jwtExpiresIn: env.JWT_EXPIRES_IN });
  const creados = await authService.sembrarUsuarios({ admin: env.SEED_ADMIN_PASSWORD, analista: env.SEED_ANALISTA_PASSWORD });
  if (creados > 0) logger.info({ creados }, 'usuarios iniciales creados');

  const creditoService = new CreditoService(persistencia);

  const dispatcher =
    env.WEBHOOK_URL && env.WEBHOOK_SECRET
      ? new WebhookDispatcher(
          persistencia.outbox,
          {
            url: env.WEBHOOK_URL,
            secret: env.WEBHOOK_SECRET,
            maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
            timeoutMs: env.WEBHOOK_TIMEOUT_MS,
            backoffBaseMs: env.WEBHOOK_BACKOFF_BASE_MS,
            backoffMaxMs: env.WEBHOOK_BACKOFF_MAX_MS,
            batchSize: env.WEBHOOK_BATCH_SIZE,
            // El lease debe superar el timeout del envio para no reenviar mientras aun se intenta.
            leaseMs: env.WEBHOOK_TIMEOUT_MS * 3 + 5000,
          },
          logger,
        )
      : undefined;

  return { logger, pool, persistencia, creditoService, authService, dispatcher };
}
