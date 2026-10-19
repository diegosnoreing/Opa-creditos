import { CAMPOS_ORDEN, ESTADOS, FORMAS_PAGO, TIPOS_CREDITO } from '../domain/types';

/** Especificacion OpenAPI 3.0 servida en /api/docs (Swagger UI) y /api/docs.json. */

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const jsonBody = (schema: object, ejemplo?: object) => ({
  required: true,
  content: { 'application/json': { schema, ...(ejemplo && { example: ejemplo }) } },
});
const respuesta = (descripcion: string, schema?: object) => ({
  description: descripcion,
  ...(schema && { content: { 'application/json': { schema } } }),
});
const errores = (...codigos: Array<400 | 401 | 403 | 404 | 409 | 422 | 429>) =>
  Object.fromEntries(codigos.map((c) => [String(c), { $ref: `#/components/responses/Error${c}` }]));
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const seguro = [{ bearerAuth: [] }];

const errorResponse = (descripcion: string, code: string, message: string) => ({
  description: descripcion,
  content: {
    'application/json': {
      schema: ref('Error'),
      example: { success: false, error: { code, message, requestId: '0b0f6c1e-6a3e-4a64-9f0e-3f1a9d6c2f11' } },
    },
  },
});

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'API de Créditos — OPA SAS',
    version: '1.0.0',
    description:
      'Módulo de créditos para una entidad del sector financiero solidario.\n\n' +
      '**Cómo probar:** ejecuta `POST /api/auth/login`, copia el `token` de la respuesta, pulsa **Authorize** y pégalo.\n\n' +
      'Usuarios iniciales (si los creaste con SEED_*): `admin` (rol ADMIN) y `analista` (rol ANALISTA).',
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [
    { name: 'Autenticación' },
    { name: 'Créditos' },
    { name: 'Webhooks', description: 'Trazabilidad de notificaciones y receptor de demostración' },
    { name: 'Sistema' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'CREDITO_NOT_FOUND' },
              message: { type: 'string', example: 'El crédito no existe' },
              details: {
                type: 'array',
                items: { type: 'object', properties: { campo: { type: 'string' }, mensaje: { type: 'string' } } },
              },
              requestId: { type: 'string' },
            },
          },
        },
      },
      Credito: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 123 },
          numeroCredito: { type: 'string', example: 'CR-2026-000123' },
          identificacionAsociado: { type: 'string', example: '1001234567' },
          nombreAsociado: { type: 'string', example: 'Juan Perez' },
          tipoCredito: { type: 'string', enum: TIPOS_CREDITO },
          valorSolicitado: { type: 'number', example: 15000000 },
          tasaInteres: { type: 'number', example: 1.5 },
          numeroCuotas: { type: 'integer', example: 36 },
          formaPago: { type: 'string', enum: FORMAS_PAGO },
          estado: { type: 'string', enum: ESTADOS },
          fechaSolicitud: { type: 'string', format: 'date-time' },
          fechaActualizacion: { type: 'string', format: 'date-time' },
        },
      },
      CrearCredito: {
        type: 'object',
        required: ['identificacionAsociado', 'nombreAsociado', 'tipoCredito', 'valorSolicitado', 'tasaInteres', 'numeroCuotas', 'formaPago'],
        properties: {
          identificacionAsociado: { type: 'string', pattern: '^\\d{5,15}$' },
          nombreAsociado: { type: 'string', minLength: 3, maxLength: 150 },
          tipoCredito: { type: 'string', enum: TIPOS_CREDITO },
          valorSolicitado: { type: 'number', description: 'Mayor que 0, máximo 2 decimales' },
          tasaInteres: { type: 'number', description: 'Mayor o igual a 0, máximo 100, hasta 4 decimales' },
          numeroCuotas: { type: 'integer', description: 'Entero entre 1 y 360' },
          formaPago: { type: 'string', enum: FORMAS_PAGO },
        },
      },
      ActualizarCredito: {
        type: 'object',
        minProperties: 1,
        description: 'Solo créditos SOLICITADO o EN_ESTUDIO. El asociado y el número son inmutables.',
        properties: {
          tipoCredito: { type: 'string', enum: TIPOS_CREDITO },
          valorSolicitado: { type: 'number' },
          tasaInteres: { type: 'number' },
          numeroCuotas: { type: 'integer' },
          formaPago: { type: 'string', enum: FORMAS_PAGO },
        },
      },
      CambiarEstado: {
        type: 'object',
        required: ['estado'],
        properties: {
          estado: { type: 'string', enum: ESTADOS },
          observacion: { type: 'string', maxLength: 500, description: 'Obligatoria para RECHAZADO y CANCELADO' },
        },
      },
      Historial: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          creditoId: { type: 'integer' },
          accion: { type: 'string', enum: ['CREACION', 'ACTUALIZACION', 'CAMBIO_ESTADO', 'ELIMINACION'] },
          estadoAnterior: { type: 'string', nullable: true },
          estadoNuevo: { type: 'string', nullable: true },
          usuario: { type: 'string' },
          observacion: { type: 'string', nullable: true },
          cambios: { type: 'object', nullable: true, additionalProperties: true },
          fecha: { type: 'string', format: 'date-time' },
        },
      },
      Meta: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      Resumen: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          valorTotalSolicitado: { type: 'number' },
          porEstado: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
      Notificacion: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          eventId: { type: 'string', format: 'uuid' },
          evento: { type: 'string', example: 'credito.creado' },
          creditoId: { type: 'integer' },
          estado: { type: 'string', enum: ['PENDIENTE', 'ENVIADO', 'FALLIDO'] },
          intentos: { type: 'integer' },
          ultimoCodigoHttp: { type: 'integer', nullable: true },
          ultimoError: { type: 'string', nullable: true },
          proximoIntento: { type: 'string', format: 'date-time' },
          fechaEnvio: { type: 'string', format: 'date-time', nullable: true },
          payload: { type: 'object' },
        },
      },
    },
    responses: {
      Error400: errorResponse('Petición mal formada', 'VALIDATION_ERROR', 'La petición contiene datos inválidos'),
      Error401: errorResponse('Sin autenticar o token inválido', 'TOKEN_INVALIDO', 'Token inválido o expirado'),
      Error403: errorResponse('Sin permisos', 'PERMISO_DENEGADO', 'Esta acción requiere el rol: ADMIN'),
      Error404: errorResponse('No existe', 'CREDITO_NOT_FOUND', 'El crédito no existe'),
      Error409: errorResponse('Conflicto con el estado actual', 'TRANSICION_INVALIDA', 'No se puede pasar un crédito de RECHAZADO a DESEMBOLSADO'),
      Error422: errorResponse('Incumple una regla de negocio', 'DATOS_CREDITO_INVALIDOS', 'Los datos del crédito incumplen las reglas de negocio'),
      Error429: errorResponse('Demasiadas peticiones', 'DEMASIADAS_PETICIONES', 'Demasiadas peticiones, intenta más tarde'),
    },
  },
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión y obtener un JWT',
        requestBody: jsonBody(
          { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } },
          { username: 'admin', password: '<la clave de SEED_ADMIN_PASSWORD>' },
        ),
        responses: { '200': respuesta('Sesión iniciada'), ...errores(400, 401, 429) },
      },
    },
    '/api/creditos': {
      post: {
        tags: ['Créditos'],
        summary: 'Crear un crédito',
        description:
          'Valida reglas de negocio, controla duplicados, guarda el historial y registra el evento `credito.creado` en el outbox, todo en una sola transacción.',
        security: seguro,
        requestBody: jsonBody(ref('CrearCredito'), {
          identificacionAsociado: '1001234567',
          nombreAsociado: 'Juan Perez',
          tipoCredito: 'LIBRE_INVERSION',
          valorSolicitado: 15000000,
          tasaInteres: 1.5,
          numeroCuotas: 36,
          formaPago: 'NOMINA',
        }),
        responses: {
          '201': respuesta('Crédito creado', { type: 'object', properties: { success: { type: 'boolean' }, data: ref('Credito') } }),
          ...errores(400, 401, 409, 422),
        },
      },
      get: {
        tags: ['Créditos'],
        summary: 'Listar créditos con paginación, filtros, búsqueda y orden',
        security: seguro,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 } },
          { name: 'estado', in: 'query', schema: { type: 'string', enum: ESTADOS } },
          { name: 'identificacion', in: 'query', description: 'Identificación exacta del asociado', schema: { type: 'string' } },
          { name: 'tipoCredito', in: 'query', schema: { type: 'string', enum: TIPOS_CREDITO } },
          { name: 'q', in: 'query', description: 'Búsqueda por número de crédito, nombre o identificación', schema: { type: 'string' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: CAMPOS_ORDEN, default: 'fechaSolicitud' } },
          { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        ],
        responses: {
          '200': respuesta('Página de créditos', {
            type: 'object',
            properties: { success: { type: 'boolean' }, data: { type: 'array', items: ref('Credito') }, meta: ref('Meta') },
          }),
          ...errores(400, 401),
        },
      },
    },
    '/api/creditos/resumen': {
      get: {
        tags: ['Créditos'],
        summary: 'Totales para el dashboard (total y cantidad por estado)',
        security: seguro,
        responses: {
          '200': respuesta('Resumen', { type: 'object', properties: { success: { type: 'boolean' }, data: ref('Resumen') } }),
          ...errores(401),
        },
      },
    },
    '/api/creditos/{id}': {
      get: {
        tags: ['Créditos'],
        summary: 'Consultar un crédito',
        security: seguro,
        parameters: [idParam],
        responses: {
          '200': respuesta('Crédito', { type: 'object', properties: { success: { type: 'boolean' }, data: ref('Credito') } }),
          ...errores(400, 401, 404),
        },
      },
      patch: {
        tags: ['Créditos'],
        summary: 'Actualizar condiciones (parcial)',
        description: 'Solo en estado SOLICITADO o EN_ESTUDIO. Registra en el historial los valores antes y después.',
        security: seguro,
        parameters: [idParam],
        requestBody: jsonBody(ref('ActualizarCredito'), { valorSolicitado: 12000000, numeroCuotas: 24 }),
        responses: {
          '200': respuesta('Crédito actualizado', { type: 'object', properties: { success: { type: 'boolean' }, data: ref('Credito') } }),
          ...errores(400, 401, 404, 409, 422),
        },
      },
      delete: {
        tags: ['Créditos'],
        summary: 'Eliminar (borrado lógico) — solo ADMIN',
        description: 'No se puede eliminar un crédito APROBADO o DESEMBOLSADO. El historial se conserva.',
        security: seguro,
        parameters: [idParam, { name: 'observacion', in: 'query', schema: { type: 'string', maxLength: 500 } }],
        responses: { '200': respuesta('Eliminado'), ...errores(400, 401, 403, 404, 409) },
      },
    },
    '/api/creditos/{id}/estado': {
      patch: {
        tags: ['Créditos'],
        summary: 'Cambiar el estado',
        description:
          'Transiciones válidas: SOLICITADO→EN_ESTUDIO|CANCELADO · EN_ESTUDIO→APROBADO|RECHAZADO|CANCELADO · APROBADO→DESEMBOLSADO|CANCELADO. ' +
          'RECHAZADO, DESEMBOLSADO y CANCELADO son finales. APROBADO, RECHAZADO y DESEMBOLSADO solo los puede asignar un ADMIN.',
        security: seguro,
        parameters: [idParam],
        requestBody: jsonBody(ref('CambiarEstado'), { estado: 'EN_ESTUDIO', observacion: 'Documentos completos' }),
        responses: {
          '200': respuesta('Crédito con el nuevo estado', { type: 'object', properties: { success: { type: 'boolean' }, data: ref('Credito') } }),
          ...errores(400, 401, 403, 404, 409, 422),
        },
      },
    },
    '/api/creditos/{id}/historial': {
      get: {
        tags: ['Créditos'],
        summary: 'Historial de cambios del crédito (más reciente primero)',
        security: seguro,
        parameters: [idParam],
        responses: {
          '200': respuesta('Historial', { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: ref('Historial') } } }),
          ...errores(400, 401, 404),
        },
      },
    },
    '/api/webhooks/notificaciones': {
      get: {
        tags: ['Webhooks'],
        summary: 'Traza de notificaciones del webhook (solo ADMIN)',
        security: seguro,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'estado', in: 'query', schema: { type: 'string', enum: ['PENDIENTE', 'ENVIADO', 'FALLIDO'] } },
          { name: 'creditoId', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': respuesta('Notificaciones', {
            type: 'object',
            properties: { success: { type: 'boolean' }, data: { type: 'array', items: ref('Notificacion') }, meta: ref('Meta') },
          }),
          ...errores(401, 403),
        },
      },
    },
    '/api/webhooks/notificaciones/{id}': {
      get: {
        tags: ['Webhooks'],
        summary: 'Detalle de una notificación con cada intento de envío (solo ADMIN)',
        security: seguro,
        parameters: [idParam],
        responses: { '200': respuesta('Notificación con intentos'), ...errores(401, 403, 404) },
      },
    },
    '/api/webhooks/notificaciones/{id}/reintentar': {
      post: {
        tags: ['Webhooks'],
        summary: 'Reencolar una notificación FALLIDA (solo ADMIN)',
        security: seguro,
        parameters: [idParam],
        responses: { '200': respuesta('Reencolada'), ...errores(401, 403, 404, 409) },
      },
    },
    '/api/webhooks/demo-receptor': {
      post: {
        tags: ['Webhooks'],
        summary: 'Receptor de DEMOSTRACIÓN del webhook (hace de "sistema externo")',
        description:
          'Verifica la firma HMAC-SHA256 (`X-Webhook-Signature`) sobre `timestamp.cuerpo` y rechaza timestamps con más de 5 minutos. Idempotente por `eventId`. Solo existe si ENABLE_DEMO_RECEIVER=true.',
        requestBody: jsonBody({ type: 'object' }),
        responses: { '200': respuesta('Evento recibido'), ...errores(401) },
      },
    },
    '/health': {
      get: { tags: ['Sistema'], summary: 'Liveness: el proceso está vivo', responses: { '200': respuesta('OK') } },
    },
    '/health/ready': {
      get: {
        tags: ['Sistema'],
        summary: 'Readiness: la API puede atender (verifica la base de datos)',
        responses: { '200': respuesta('Lista'), '503': respuesta('Base de datos no disponible') },
      },
    },
  },
};
