import 'dotenv/config';
import { cargarEnv } from './config/env';
import { crearContenedor } from './container';
import { createApp } from './http/app';
import { iniciarWorker } from './services/webhookDispatcher';

async function main(): Promise<void> {
  const env = cargarEnv();
  const c = await crearContenedor(env);
  const { logger } = c;

  const app = createApp({
    creditoService: c.creditoService,
    authService: c.authService,
    outbox: c.persistencia.outbox,
    logger,
    checkDb: () => c.persistencia.ping(),
    config: {
      isProduction: env.NODE_ENV === 'production',
      corsOrigins: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
      trustProxy: env.TRUST_PROXY,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX, loginMax: env.LOGIN_RATE_LIMIT_MAX },
      webhookSecret: env.WEBHOOK_SECRET,
      // El receptor de demostracion no debe existir en produccion salvo que se pida explicitamente.
      enableDemoReceiver: env.ENABLE_DEMO_RECEIVER ?? env.NODE_ENV !== 'production',
    },
  });

  const servidor = app.listen(env.PORT, () => {
    logger.info({ puerto: env.PORT, entorno: env.NODE_ENV }, 'API escuchando');
    logger.info(`Swagger: http://localhost:${env.PORT}/api/docs`);
  });

  let detenerWorker: (() => Promise<void>) | undefined;
  if (c.dispatcher && env.WORKER_EMBEDDED) {
    detenerWorker = iniciarWorker(c.dispatcher, env.WEBHOOK_POLL_INTERVAL_MS, logger);
    logger.info('worker de webhooks iniciado dentro del proceso de la API');
  } else if (!c.dispatcher) {
    logger.warn('WEBHOOK_URL no configurado: los eventos se guardan en el outbox pero no se envian');
  }

  // Apagado ordenado: deja de aceptar peticiones, termina el lote en curso y cierra la conexion.
  let cerrando = false;
  const apagar = async (senal: string): Promise<void> => {
    if (cerrando) return;
    cerrando = true;
    logger.info({ senal }, 'apagando...');
    servidor.close();
    await detenerWorker?.();
    await c.pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

main().catch((e) => {
  console.error('No se pudo iniciar la aplicación:', e instanceof Error ? e.message : e);
  process.exit(1);
});
