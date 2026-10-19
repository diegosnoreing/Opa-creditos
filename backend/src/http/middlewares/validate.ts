import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { ValidationError, type DetalleError } from '../../domain/errors';

function detalles(error: ZodError): DetalleError[] {
  return error.issues.map((i) => ({
    campo: i.path.length > 0 ? i.path.join('.') : undefined,
    mensaje: i.message,
  })) as DetalleError[];
}

/** Valida y reemplaza req.body por la version limpia (sin campos desconocidos, recortada). */
export function validarBody<T>(esquema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const r = esquema.safeParse(req.body ?? {});
    if (!r.success) throw new ValidationError('La petición contiene datos inválidos', detalles(r.error));
    req.body = r.data;
    next();
  };
}

/** Valida req.query. En Express 5 req.query es de solo lectura: el resultado queda en res.locals.query. */
export function validarQuery<T>(esquema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const r = esquema.safeParse(req.query);
    if (!r.success) throw new ValidationError('Los parámetros de consulta son inválidos', detalles(r.error));
    res.locals['query'] = r.data;
    next();
  };
}

/** Convierte un parametro de ruta en entero positivo (INT de SQL Server). */
export function parseId(valor: string | string[] | undefined, nombre = 'id'): number {
  if (typeof valor !== 'string' || !/^\d{1,10}$/.test(valor)) {
    throw new ValidationError(`El parámetro "${nombre}" debe ser un entero positivo`, undefined, 'ID_INVALIDO');
  }
  const n = Number(valor);
  if (n < 1 || n > 2_147_483_647) {
    throw new ValidationError(`El parámetro "${nombre}" está fuera de rango`, undefined, 'ID_INVALIDO');
  }
  return n;
}
