import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import type { OutboxRepository } from '../repositories/interfaces';
import type { AuthService } from '../services/authService';
import type { CreditoService } from '../services/creditoService';
import { openApiSpec } from './openapi';
import { authenticate } from './middlewares/auth';
import { errorHandler, rutaNoEncontrada } from './middlewares/errorHandler';
import { requestId } from './middlewares/requestId';
import { authRouter } from './routes/auth';
import { creditosRouter } from './routes/creditos';
import { notificacionesRouter, receptorDemoRouter } from './routes/webhooks';
import type { HttpConfig } from './types';
import './types';

export interface AppDeps {
  creditoService: CreditoService;
  authService: AuthService;
  outbox: OutboxRepository;
  config: HttpConfig;
  logger: Logger;
  /** Lanza si la base de datos no responde. */
  checkDb: () => Promise<void>;
}

function limitador(opciones: { windowMs: number; limit: number; skipSuccessfulRequests?: boolean }): RequestHandler {
  return rateLimit({
    windowMs: opciones.windowMs,
    limit: opciones.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: opciones.skipSuccessfulRequests ?? false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'DEMASIADAS_PETICIONES', message: 'Demasiadas peticiones. Intenta de nuevo en unos minutos.', requestId: req.requestId },
      });
    },
  });
}

export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? '',
      // Los health checks llegan cada pocos segundos: no llenan el log.
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/health/ready' },
    }),
  );
  app.use(
    helmet({
      // En desarrollo se quita upgrade-insecure-requests para que Swagger UI cargue por http://localhost.
      contentSecurityPolicy: config.isProduction ? undefined : { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  // "verify" conserva el cuerpo original: la firma HMAC se calcula sobre esos bytes exactos.
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  /* ---------- Salud (sin autenticacion ni rate limit) ---------- */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await deps.checkDb();
      res.json({ status: 'ready' });
    } catch (e) {
      logger.error({ err: e }, 'readiness: la base de datos no responde');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  /* ---------- Documentacion ---------- */
  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { swaggerOptions: { persistAuthorization: true } }));

  /* ---------- API ---------- */
  const autenticar = authenticate(deps.authService);
  const api = express.Router();
  api.use(limitador({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.max }));

  // Solo cuentan los logins fallidos: frena la fuerza bruta sin molestar al usuario legitimo.
  const limitadorLogin = limitador({ windowMs: config.rateLimit.windowMs, limit: config.rateLimit.loginMax, skipSuccessfulRequests: true });
  api.use('/auth', authRouter(deps.authService, limitadorLogin));

  api.use('/creditos', autenticar, creditosRouter(deps.creditoService));
  api.use('/webhooks/notificaciones', autenticar, notificacionesRouter(deps.outbox));
  if (config.enableDemoReceiver) {
    api.use('/webhooks/demo-receptor', receptorDemoRouter(config, autenticar));
  }
  app.use('/api', api);

  app.use(rutaNoEncontrada);
  app.use(errorHandler(logger));
  return app;
}
