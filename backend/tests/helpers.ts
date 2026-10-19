import pino from 'pino';
import { createApp } from '../src/http/app';
import type { HttpConfig } from '../src/http/types';
import { MemoriaPersistencia } from '../src/repositories/memory/memoryPersistencia';
import { AuthService } from '../src/services/authService';
import { CreditoService } from '../src/services/creditoService';
import type { Actor, CrearCreditoInput } from '../src/domain/types';

export const SECRETO_JWT = 'secreto-de-pruebas-con-mas-de-16-caracteres';
export const SECRETO_WEBHOOK = 'secreto-webhook-de-pruebas-123';

export const ADMIN: Actor = { username: 'admin', rol: 'ADMIN' };
export const ANALISTA: Actor = { username: 'analista', rol: 'ANALISTA' };

export const creditoValido = (sobrescribir: Partial<CrearCreditoInput> = {}): CrearCreditoInput => ({
  identificacionAsociado: '1001234567',
  nombreAsociado: 'Juan Perez',
  tipoCredito: 'LIBRE_INVERSION',
  valorSolicitado: 15_000_000,
  tasaInteres: 1.5,
  numeroCuotas: 36,
  formaPago: 'NOMINA',
  ...sobrescribir,
});

export const configHttp = (sobrescribir: Partial<HttpConfig> = {}): HttpConfig => ({
  isProduction: false,
  corsOrigins: ['http://localhost:5173'],
  trustProxy: false,
  rateLimit: { windowMs: 60_000, max: 10_000, loginMax: 10_000 },
  webhookSecret: SECRETO_WEBHOOK,
  enableDemoReceiver: true,
  ...sobrescribir,
});

/** Arma toda la aplicacion con persistencia en memoria (sin SQL Server). */
export async function crearEntorno(config: Partial<HttpConfig> = {}) {
  const persistencia = new MemoriaPersistencia();
  const authService = new AuthService(persistencia.usuarios, { jwtSecret: SECRETO_JWT, jwtExpiresIn: '1h', bcryptRounds: 4 });
  await authService.sembrarUsuarios({ admin: 'ClaveAdmin_123', analista: 'ClaveAnalista_123' });
  const creditoService = new CreditoService(persistencia);
  const logger = pino({ level: 'silent' });
  const app = createApp({
    creditoService,
    authService,
    outbox: persistencia.outbox,
    logger,
    checkDb: () => persistencia.ping(),
    config: configHttp(config),
  });
  return { app, persistencia, authService, creditoService, logger };
}
