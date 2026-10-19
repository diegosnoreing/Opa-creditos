import pino, { type Logger } from 'pino';

/** Logs en JSON (una linea por evento): faciles de recolectar y consultar. Sin secretos. */
export function crearLogger(nivel: string): Logger {
  return pino({
    level: nivel,
    base: { servicio: 'opa-creditos-api' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-webhook-signature"]', '*.password', '*.passwordHash'],
      censor: '[REDACTED]',
    },
  });
}
