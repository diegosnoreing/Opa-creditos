import 'dotenv/config';
import { cargarEnv } from './config/env';
import { crearContenedor } from './container';
import { iniciarWorker } from './services/webhookDispatcher';

/**
 * Worker independiente del webhook: "npm run worker".
 * En produccion se ejecuta como proceso/contenedor aparte de la API, para escalarlo
 * y reiniciarlo sin afectar las peticiones (la API usa WORKER_EMBEDDED=false).
 */
async function main(): Promise<void> {
  const env = cargarEnv();
  const c = await crearContenedor(env);

  if (!c.dispatcher) {
    c.logger.error('WEBHOOK_URL y WEBHOOK_SECRET son obligatorios para ejecutar el worker');
    await c.pool.close();
    process.exit(1);
  }

  const detener = iniciarWorker(c.dispatcher, env.WEBHOOK_POLL_INTERVAL_MS, c.logger);
  c.logger.info('worker de webhooks iniciado');

  let cerrando = false;
  const apagar = async (senal: string): Promise<void> => {
    if (cerrando) return;
    cerrando = true;
    c.logger.info({ senal }, 'apagando worker...');
    await detener();
    await c.pool.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

main().catch((e) => {
  console.error('No se pudo iniciar el worker:', e instanceof Error ? e.message : e);
  process.exit(1);
});
