export interface DetalleError {
  campo?: string;
  mensaje: string;
}

/** Error esperado de la aplicacion: lleva el codigo HTTP y un codigo de negocio estable. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: DetalleError[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400: la peticion esta mal formada (tipos, campos faltantes, JSON invalido). */
export class ValidationError extends AppError {
  constructor(message: string, details?: DetalleError[], code = 'VALIDATION_ERROR') {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autenticación requerida', code = 'NO_AUTENTICADO') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permisos para realizar esta acción', code = 'PERMISO_DENEGADO') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'El crédito no existe', code = 'CREDITO_NOT_FOUND') {
    super(404, code, message);
  }
}

/** 409: la peticion es valida pero choca con el estado actual del recurso. */
export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

/** 422: la peticion esta bien formada pero incumple una regla de negocio. */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: DetalleError[]) {
    super(422, code, message, details);
  }
}
