import { z } from 'zod';

/** "true"/"false" (cualquier otro valor es un error de configuracion, no un false silencioso). */
const booleano = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Una variable vacia en el .env (por ejemplo WEBHOOK_URL=) cuenta como no definida. */
const vacioComoUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.preprocess(vacioComoUndefined, booleano.default(false)),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  DB_NAME: z.string().min(1).default('OpaCreditos'),
  DB_USER: z.string().min(1).default('sa'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD es obligatorio'),
  DB_ENCRYPT: z.preprocess(vacioComoUndefined, booleano.default(false)),
  DB_TRUST_SERVER_CERT: z.preprocess(vacioComoUndefined, booleano.default(true)),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().min(1).default('1h'),

  SEED_ADMIN_PASSWORD: z.preprocess(vacioComoUndefined, z.string().min(8, 'SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres').optional()),
  SEED_ANALISTA_PASSWORD: z.preprocess(vacioComoUndefined, z.string().min(8, 'SEED_ANALISTA_PASSWORD debe tener al menos 8 caracteres').optional()),

  WEBHOOK_URL: z.preprocess(vacioComoUndefined, z.url().optional()),
  WEBHOOK_SECRET: z.preprocess(vacioComoUndefined, z.string().min(16, 'WEBHOOK_SECRET debe tener al menos 16 caracteres').optional()),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(6),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  WEBHOOK_BACKOFF_BASE_MS: z.coerce.number().int().min(1).default(30_000),
  WEBHOOK_BACKOFF_MAX_MS: z.coerce.number().int().min(1).default(3_600_000),
  WEBHOOK_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(10),
  WORKER_EMBEDDED: z.preprocess(vacioComoUndefined, booleano.default(true)),
  /** Sin valor: se activa fuera de produccion. */
  ENABLE_DEMO_RECEIVER: z.preprocess(vacioComoUndefined, booleano.optional()),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
});

export type Env = z.infer<typeof esquema>;

/** Valores de ejemplo de .env.example: nunca deben llegar a produccion. */
const VALOR_DE_EJEMPLO = /cambiar|changeme/i;

/** Lee y valida las variables de entorno; si algo esta mal falla al arrancar, con un mensaje claro. */
export function cargarEnv(fuente: NodeJS.ProcessEnv = process.env): Env {
  const r = esquema.safeParse(fuente);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  const env = r.data;

  if (env.NODE_ENV === 'production') {
    const problemas: string[] = [];
    if (env.JWT_SECRET.length < 32) problemas.push('JWT_SECRET debe tener al menos 32 caracteres en producción');
    const secretos: Array<[string, string | undefined]> = [
      ['JWT_SECRET', env.JWT_SECRET],
      ['DB_PASSWORD', env.DB_PASSWORD],
      ['WEBHOOK_SECRET', env.WEBHOOK_SECRET],
      ['SEED_ADMIN_PASSWORD', env.SEED_ADMIN_PASSWORD],
      ['SEED_ANALISTA_PASSWORD', env.SEED_ANALISTA_PASSWORD],
    ];
    for (const [nombre, valor] of secretos) {
      if (valor && VALOR_DE_EJEMPLO.test(valor)) problemas.push(`${nombre} conserva el valor de ejemplo de .env.example`);
    }
    if (problemas.length > 0) throw new Error(`Configuración insegura para producción:\n  - ${problemas.join('\n  - ')}`);
  }
  return env;
}
