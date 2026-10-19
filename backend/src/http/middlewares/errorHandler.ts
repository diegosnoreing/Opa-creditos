import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../../domain/errors';
import '../types';

interface CuerpoError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string | undefined;
  };
}

function cuerpo(code: string, message: string, requestId: string | undefined, details?: unknown): CuerpoError {
  return { success: false, error: { code, message, ...(details ? { details } : {}), requestId } };
}

export const rutaNoEncontrada: RequestHandler = (req, res) => {
  res.status(404).json(cuerpo('RUTA_NO_ENCONTRADA', `No existe la ruta ${req.method} ${req.path}`, req.requestId));
};

/** Unico lugar donde se convierte un error en respuesta HTTP: formato siempre igual. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof AppError) {
      res.status(err.status).json(cuerpo(err.code, err.message, req.requestId, err.details));
      return;
    }

    // Errores de body-parser (JSON mal formado, cuerpo demasiado grande...).
    const tipo = (err as { type?: string } | null)?.type;
    if (tipo === 'entity.parse.failed') {
      res.status(400).json(cuerpo('JSON_INVALIDO', 'El cuerpo de la petición no es un JSON válido', req.requestId));
      return;
    }
    if (tipo === 'entity.too.large') {
      res.status(413).json(cuerpo('PAYLOAD_DEMASIADO_GRANDE', 'El cuerpo de la petición es demasiado grande', req.requestId));
      return;
    }

    // Cualquier otra cosa es un fallo nuestro: se registra completo, pero al cliente
    // solo se le da una referencia. Nunca se filtran trazas ni detalles de la base de datos.
    logger.error({ err, requestId: req.requestId, method: req.method, url: req.originalUrl }, 'error no controlado');
    res
      .status(500)
      .json(cuerpo('INTERNAL_ERROR', 'Ocurrió un error interno. Si persiste, informa la referencia de la petición.', req.requestId));
  };
}
