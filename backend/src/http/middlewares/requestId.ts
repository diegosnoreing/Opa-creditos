import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import '../types';

/** Asigna un id a cada peticion para poder rastrearla en los logs y en las respuestas de error. */
export const requestId: RequestHandler = (req, res, next) => {
  const entrante = req.header('x-request-id');
  // Solo se acepta un id entrante con forma segura: evita inyectar basura en los logs.
  req.requestId = entrante && /^[A-Za-z0-9._-]{8,64}$/.test(entrante) ? entrante : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};
