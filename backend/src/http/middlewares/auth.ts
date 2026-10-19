import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors';
import type { Rol } from '../../domain/types';
import type { AuthService } from '../../services/authService';
import '../types';

/** Exige un JWT valido en "Authorization: Bearer <token>" y deja el usuario en req.user. */
export function authenticate(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const cabecera = req.headers.authorization;
    if (!cabecera || !cabecera.startsWith('Bearer ')) {
      throw new UnauthorizedError('Falta el token de autenticación (Authorization: Bearer <token>)');
    }
    req.user = auth.verificarToken(cabecera.slice('Bearer '.length).trim());
    next();
  };
}

/** Control de acceso por rol (RBAC). Debe ir despues de authenticate. */
export function authorize(...roles: Rol[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.rol)) {
      throw new ForbiddenError(`Esta acción requiere el rol: ${roles.join(' o ')}`);
    }
    next();
  };
}

/** Devuelve el usuario autenticado; falla si el middleware no se ejecuto antes. */
export function usuarioActual(req: Express.Request): NonNullable<Express.Request['user']> {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
