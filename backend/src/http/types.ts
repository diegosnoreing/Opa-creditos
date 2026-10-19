import type { Actor } from '../domain/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identificador de la peticion, tambien devuelto en X-Request-Id y en los errores. */
      requestId?: string;
      /** Usuario autenticado (lo pone el middleware authenticate). */
      user?: Actor;
      /** Cuerpo sin procesar: necesario para verificar firmas HMAC. */
      rawBody?: Buffer;
    }
  }
}

export interface HttpConfig {
  isProduction: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimit: { windowMs: number; max: number; loginMax: number };
  /** Secreto del webhook; lo usa el receptor de demostracion para verificar la firma. */
  webhookSecret?: string | undefined;
  enableDemoReceiver: boolean;
}
