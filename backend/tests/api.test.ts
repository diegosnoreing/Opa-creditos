import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { crearEntorno, creditoValido, SECRETO_JWT } from './helpers';

let app: Express;

async function login(username: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  expect(r.status).toBe(200);
  return r.body.data.token as string;
}
const tokenAdmin = () => login('admin', 'ClaveAdmin_123');
const tokenAnalista = () => login('analista', 'ClaveAnalista_123');
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function crear(token: string, datos = creditoValido()) {
  return request(app).post('/api/creditos').set(auth(token)).send(datos);
}

beforeEach(async () => {
  ({ app } = await crearEntorno());
});

describe('autenticacion', () => {
  it('login correcto devuelve un JWT y el rol', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'ClaveAdmin_123' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toMatchObject({ tokenType: 'Bearer', usuario: { username: 'admin', rol: 'ADMIN' } });
    expect(r.body.data.token.split('.')).toHaveLength(3);
    expect(JSON.stringify(r.body)).not.toContain('passwordHash');
  });

  it('clave incorrecta y usuario inexistente dan el mismo 401 (no revela cual fallo)', async () => {
    const mala = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'incorrecta' });
    const inexistente = await request(app).post('/api/auth/login').send({ username: 'fantasma', password: 'incorrecta' });
    expect(mala.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(mala.body.error.code).toBe('CREDENCIALES_INVALIDAS');
    expect(mala.body.error.message).toBe(inexistente.body.error.message);
  });

  it('sin token -> 401 NO_AUTENTICADO', async () => {
    const r = await request(app).get('/api/creditos');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ success: false, error: { code: 'NO_AUTENTICADO' } });
  });

  it('token basura -> 401 TOKEN_INVALIDO', async () => {
    const r = await request(app).get('/api/creditos').set(auth('no.es.un-jwt'));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_INVALIDO');
  });

  it('token firmado con otro secreto -> 401', async () => {
    const falso = jwt.sign({ rol: 'ADMIN' }, 'otro-secreto-distinto-de-32-caracteres!!', { subject: 'admin' });
    expect((await request(app).get('/api/creditos').set(auth(falso))).status).toBe(401);
  });

  it('token expirado -> 401', async () => {
    const vencido = jwt.sign({ rol: 'ADMIN' }, SECRETO_JWT, { subject: 'admin', expiresIn: -10 });
    expect((await request(app).get('/api/creditos').set(auth(vencido))).status).toBe(401);
  });

  it('rechaza un token con algoritmo "none" (ataque clasico a JWT)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sinFirma = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'admin', rol: 'ADMIN' })}.`;
    expect((await request(app).get('/api/creditos').set(auth(sinFirma))).status).toBe(401);
  });

  it('login sin cuerpo valido -> 400', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'admin' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/creditos', () => {
  it('crea el credito: 201, Location y cuerpo con el formato del enunciado', async () => {
    const t = await tokenAnalista();
    const r = await crear(t);

    expect(r.status).toBe(201);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toMatchObject({
      numeroCredito: expect.stringMatching(/^CR-\d{4}-\d{6}$/),
      identificacionAsociado: '1001234567',
      nombreAsociado: 'Juan Perez',
      tipoCredito: 'LIBRE_INVERSION',
      valorSolicitado: 15000000,
      tasaInteres: 1.5,
      numeroCuotas: 36,
      formaPago: 'NOMINA',
      estado: 'SOLICITADO',
    });
    expect(r.headers['location']).toBe(`/api/creditos/${r.body.data.id}`);
  });

  it('campos obligatorios faltantes -> 400 con detalle por campo', async () => {
    const t = await tokenAnalista();
    const r = await request(app).post('/api/creditos').set(auth(t)).send({ nombreAsociado: 'Juan Perez' });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    const campos = r.body.error.details.map((d: { campo: string }) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['identificacionAsociado', 'tipoCredito', 'valorSolicitado', 'tasaInteres', 'numeroCuotas', 'formaPago']));
  });

  it('tipos incorrectos (valor como texto, tipo desconocido) -> 400', async () => {
    const t = await tokenAnalista();
    const r = await crear(t, { ...creditoValido(), valorSolicitado: '15000000' as unknown as number, tipoCredito: 'OTRO' as never });
    expect(r.status).toBe(400);
  });

  it('rechaza campos que el cliente no debe enviar (estado, numeroCredito)', async () => {
    const t = await tokenAnalista();
    const r = await request(app)
      .post('/api/creditos')
      .set(auth(t))
      .send({ ...creditoValido(), estado: 'DESEMBOLSADO', numeroCredito: 'CR-HACK' });
    expect(r.status).toBe(400);
  });

  it.each([
    ['valor <= 0', { valorSolicitado: 0 }, 'valorSolicitado'],
    ['valor negativo', { valorSolicitado: -100 }, 'valorSolicitado'],
    ['tasa negativa', { tasaInteres: -1 }, 'tasaInteres'],
    ['cuotas <= 0', { numeroCuotas: 0 }, 'numeroCuotas'],
  ])('regla de negocio incumplida (%s) -> 422', async (_n, datos, campo) => {
    const t = await tokenAnalista();
    const r = await crear(t, creditoValido(datos));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('DATOS_CREDITO_INVALIDOS');
    expect(r.body.error.details[0].campo).toBe(campo);
  });

  it('credito duplicado -> 409 CREDITO_DUPLICADO', async () => {
    const t = await tokenAnalista();
    expect((await crear(t)).status).toBe(201);
    const r = await crear(t);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CREDITO_DUPLICADO');
  });

  it('JSON mal formado -> 400 JSON_INVALIDO', async () => {
    const t = await tokenAnalista();
    const r = await request(app).post('/api/creditos').set(auth(t)).set('Content-Type', 'application/json').send('{"identificacion": ');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('JSON_INVALIDO');
  });

  it('cuerpo demasiado grande -> 413', async () => {
    const t = await tokenAnalista();
    const r = await request(app).post('/api/creditos').set(auth(t)).send({ nombreAsociado: 'x'.repeat(200_000) });
    expect(r.status).toBe(413);
  });
});

describe('GET /api/creditos/:id', () => {
  it('devuelve el credito', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app).get(`/api/creditos/${body.data.id}`).set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.data.numeroCredito).toBe(body.data.numeroCredito);
  });

  it('inexistente -> 404 con el formato exacto del enunciado', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos/9999').set(auth(t));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({
      success: false,
      error: { code: 'CREDITO_NOT_FOUND', message: 'El crédito no existe' },
    });
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('id invalido (%s) -> 400 ID_INVALIDO', async (id) => {
    const t = await tokenAnalista();
    const r = await request(app).get(`/api/creditos/${id}`).set(auth(t));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ID_INVALIDO');
  });
});

describe('GET /api/creditos (listado)', () => {
  beforeEach(async () => {
    const t = await tokenAnalista();
    await crear(t, creditoValido({ identificacionAsociado: '1001111111', nombreAsociado: 'Ana Gomez', valorSolicitado: 1_000_000 }));
    await crear(t, creditoValido({ identificacionAsociado: '1002222222', nombreAsociado: 'Luis Rojas', valorSolicitado: 3_000_000 }));
    await crear(t, creditoValido({ identificacionAsociado: '1003333333', nombreAsociado: 'Maria Lopez', valorSolicitado: 2_000_000, tipoCredito: 'VIVIENDA' }));
  });

  it('pagina y devuelve meta', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos?page=1&pageSize=2').set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const p2 = await request(app).get('/api/creditos?page=2&pageSize=2').set(auth(t));
    expect(p2.body.data).toHaveLength(1);
  });

  it('filtra por identificacion', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos?identificacion=1002222222').set(auth(t));
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0].nombreAsociado).toBe('Luis Rojas');
  });

  it('filtra por estado', async () => {
    const t = await tokenAnalista();
    const todos = await request(app).get('/api/creditos').set(auth(t));
    await request(app).patch(`/api/creditos/${todos.body.data[0].id}/estado`).set(auth(t)).send({ estado: 'EN_ESTUDIO' });
    const r = await request(app).get('/api/creditos?estado=EN_ESTUDIO').set(auth(t));
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0].estado).toBe('EN_ESTUDIO');
  });

  it('busca por nombre (sin distinguir mayusculas) y combina filtros', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos?q=maria').set(auth(t));
    expect(r.body.meta.total).toBe(1);
    const combinado = await request(app).get('/api/creditos?q=maria&tipoCredito=LIBRE_INVERSION').set(auth(t));
    expect(combinado.body.meta.total).toBe(0);
  });

  it('ordena por valor', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos?sortBy=valorSolicitado&sortDir=asc').set(auth(t));
    expect(r.body.data.map((c: { valorSolicitado: number }) => c.valorSolicitado)).toEqual([1_000_000, 2_000_000, 3_000_000]);
  });

  it('ignora filtros vacios (el frontend puede enviar ?estado=)', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get('/api/creditos?estado=&q=&identificacion=').set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBe(3);
  });

  it.each(['pageSize=101', 'pageSize=0', 'page=0', 'estado=INVENTADO', 'sortBy=Password', 'sortDir=sideways', 'identificacion=12abc'])(
    'parametro invalido (%s) -> 400',
    async (qs) => {
      const t = await tokenAnalista();
      const r = await request(app).get(`/api/creditos?${qs}`).set(auth(t));
      expect(r.status).toBe(400);
    },
  );

  it('un intento de inyeccion SQL en la busqueda se trata como texto literal', async () => {
    const t = await tokenAnalista();
    const r = await request(app).get(`/api/creditos?q=${encodeURIComponent("'; DROP TABLE Creditos;--")}`).set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBe(0);
  });
});

describe('GET /api/creditos/resumen (dashboard)', () => {
  it('devuelve total y cantidad por estado', async () => {
    const t = await tokenAnalista();
    await crear(t, creditoValido({ valorSolicitado: 1_000_000 }));
    const b = await crear(t, creditoValido({ valorSolicitado: 2_000_000 }));
    await request(app).patch(`/api/creditos/${b.body.data.id}/estado`).set(auth(t)).send({ estado: 'EN_ESTUDIO' });

    const r = await request(app).get('/api/creditos/resumen').set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(2);
    expect(r.body.data.valorTotalSolicitado).toBe(3_000_000);
    expect(r.body.data.porEstado).toMatchObject({ SOLICITADO: 1, EN_ESTUDIO: 1, APROBADO: 0 });
  });
});

describe('PATCH /api/creditos/:id/estado', () => {
  it('cambia el estado y queda en el historial con el usuario', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app)
      .patch(`/api/creditos/${body.data.id}/estado`)
      .set(auth(t))
      .send({ estado: 'EN_ESTUDIO', observacion: 'Documentos completos' });
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('EN_ESTUDIO');

    const h = await request(app).get(`/api/creditos/${body.data.id}/historial`).set(auth(t));
    expect(h.status).toBe(200);
    expect(h.body.data[0]).toMatchObject({
      accion: 'CAMBIO_ESTADO',
      estadoAnterior: 'SOLICITADO',
      estadoNuevo: 'EN_ESTUDIO',
      usuario: 'analista',
      observacion: 'Documentos completos',
    });
  });

  it('RECHAZADO -> DESEMBOLSADO -> 409 TRANSICION_INVALIDA', async () => {
    const analista = await tokenAnalista();
    const admin = await tokenAdmin();
    const { body } = await crear(analista);
    const id = body.data.id;
    await request(app).patch(`/api/creditos/${id}/estado`).set(auth(analista)).send({ estado: 'EN_ESTUDIO' });
    await request(app).patch(`/api/creditos/${id}/estado`).set(auth(admin)).send({ estado: 'RECHAZADO', observacion: 'Sin capacidad de pago' });

    const r = await request(app).patch(`/api/creditos/${id}/estado`).set(auth(admin)).send({ estado: 'DESEMBOLSADO' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TRANSICION_INVALIDA');
    expect(r.body.error.message).toContain('RECHAZADO');
  });

  it('estado inexistente en el enum -> 400', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app).patch(`/api/creditos/${body.data.id}/estado`).set(auth(t)).send({ estado: 'VOLANDO' });
    expect(r.status).toBe(400);
  });

  it('un analista no puede aprobar -> 403 PERMISO_DENEGADO', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    await request(app).patch(`/api/creditos/${body.data.id}/estado`).set(auth(t)).send({ estado: 'EN_ESTUDIO' });
    const r = await request(app).patch(`/api/creditos/${body.data.id}/estado`).set(auth(t)).send({ estado: 'APROBADO' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PERMISO_DENEGADO');
  });

  it('rechazar sin motivo -> 422 OBSERVACION_REQUERIDA', async () => {
    const analista = await tokenAnalista();
    const admin = await tokenAdmin();
    const { body } = await crear(analista);
    await request(app).patch(`/api/creditos/${body.data.id}/estado`).set(auth(analista)).send({ estado: 'EN_ESTUDIO' });
    const r = await request(app).patch(`/api/creditos/${body.data.id}/estado`).set(auth(admin)).send({ estado: 'RECHAZADO' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('OBSERVACION_REQUERIDA');
  });

  it('credito inexistente -> 404', async () => {
    const t = await tokenAnalista();
    const r = await request(app).patch('/api/creditos/9999/estado').set(auth(t)).send({ estado: 'EN_ESTUDIO' });
    expect(r.status).toBe(404);
  });
});

describe('PATCH /api/creditos/:id (actualizar)', () => {
  it('actualiza condiciones', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app).patch(`/api/creditos/${body.data.id}`).set(auth(t)).send({ valorSolicitado: 12000000, numeroCuotas: 24 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ valorSolicitado: 12000000, numeroCuotas: 24 });
  });

  it('cuerpo vacio -> 400', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    expect((await request(app).patch(`/api/creditos/${body.data.id}`).set(auth(t)).send({})).status).toBe(400);
  });

  it('no permite cambiar el asociado ni el numero (inmutables) -> 400', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app).patch(`/api/creditos/${body.data.id}`).set(auth(t)).send({ identificacionAsociado: '999999999' });
    expect(r.status).toBe(400);
  });

  it('valor invalido -> 422', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    expect((await request(app).patch(`/api/creditos/${body.data.id}`).set(auth(t)).send({ valorSolicitado: -1 })).status).toBe(422);
  });
});

describe('DELETE /api/creditos/:id', () => {
  it('un analista no puede eliminar -> 403', async () => {
    const t = await tokenAnalista();
    const { body } = await crear(t);
    const r = await request(app).delete(`/api/creditos/${body.data.id}`).set(auth(t));
    expect(r.status).toBe(403);
  });

  it('el admin elimina (logico): despues el GET da 404', async () => {
    const analista = await tokenAnalista();
    const admin = await tokenAdmin();
    const { body } = await crear(analista);
    const r = await request(app).delete(`/api/creditos/${body.data.id}?observacion=Duplicado%20por%20error`).set(auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: body.data.id, eliminado: true });
    expect((await request(app).get(`/api/creditos/${body.data.id}`).set(auth(admin))).status).toBe(404);
  });

  it('credito aprobado -> 409 CREDITO_NO_ELIMINABLE', async () => {
    const analista = await tokenAnalista();
    const admin = await tokenAdmin();
    const { body } = await crear(analista);
    const id = body.data.id;
    await request(app).patch(`/api/creditos/${id}/estado`).set(auth(analista)).send({ estado: 'EN_ESTUDIO' });
    await request(app).patch(`/api/creditos/${id}/estado`).set(auth(admin)).send({ estado: 'APROBADO' });
    const r = await request(app).delete(`/api/creditos/${id}`).set(auth(admin));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CREDITO_NO_ELIMINABLE');
  });
});

describe('seguridad HTTP y formato de errores', () => {
  it('ruta inexistente -> 404 con el mismo formato', async () => {
    const r = await request(app).get('/api/nada');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ success: false, error: { code: 'RUTA_NO_ENCONTRADA' } });
  });

  it('cada respuesta lleva X-Request-Id y los errores lo repiten', async () => {
    const r = await request(app).get('/api/creditos');
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.body.error.requestId).toBe(r.headers['x-request-id']);
  });

  it('respeta un X-Request-Id valido y descarta uno sospechoso', async () => {
    const ok = await request(app).get('/health').set('X-Request-Id', 'abc12345-trace');
    expect(ok.headers['x-request-id']).toBe('abc12345-trace');
    const mal = await request(app).get('/health').set('X-Request-Id', 'x y<script>');
    expect(mal.headers['x-request-id']).not.toContain('script');
  });

  it('helmet: cabeceras de seguridad y sin X-Powered-By', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS: permite el origen configurado y no otros', async () => {
    const permitido = await request(app).options('/api/creditos').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(permitido.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const ajeno = await request(app).options('/api/creditos').set('Origin', 'http://sitio-malicioso.com').set('Access-Control-Request-Method', 'POST');
    expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('un error inesperado devuelve 500 generico sin filtrar detalles internos', async () => {
    const entorno = await crearEntorno();
    jest.spyOn(entorno.persistencia.creditos, 'resumen').mockRejectedValueOnce(new Error('Login failed for user sa at SQLSERVER01'));
    const login = await request(entorno.app).post('/api/auth/login').send({ username: 'admin', password: 'ClaveAdmin_123' });
    const r = await request(entorno.app).get('/api/creditos/resumen').set(auth(login.body.data.token));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r.body)).not.toContain('SQLSERVER01');
  });
});

describe('rate limiting', () => {
  it('limita las peticiones por ventana -> 429 con el formato de error', async () => {
    const { app: limitada } = await crearEntorno({ rateLimit: { windowMs: 60_000, max: 3, loginMax: 100 } });
    const t = (await request(limitada).post('/api/auth/login').send({ username: 'admin', password: 'ClaveAdmin_123' })).body.data.token;
    // el login ya consumio 1 de las 3 peticiones permitidas
    expect((await request(limitada).get('/api/creditos').set(auth(t))).status).toBe(200);
    expect((await request(limitada).get('/api/creditos').set(auth(t))).status).toBe(200);
    const r = await request(limitada).get('/api/creditos').set(auth(t));
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ success: false, error: { code: 'DEMASIADAS_PETICIONES' } });
  });

  it('frena la fuerza bruta del login: solo cuentan los intentos fallidos', async () => {
    const { app: limitada } = await crearEntorno({ rateLimit: { windowMs: 60_000, max: 1000, loginMax: 3 } });
    for (let i = 0; i < 3; i++) {
      expect((await request(limitada).post('/api/auth/login').send({ username: 'admin', password: 'mala' })).status).toBe(401);
    }
    const bloqueado = await request(limitada).post('/api/auth/login').send({ username: 'admin', password: 'ClaveAdmin_123' });
    expect(bloqueado.status).toBe(429);
  });
});

describe('salud y documentacion', () => {
  it('/health responde sin autenticar', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('/health/ready verifica la base de datos y da 503 si falla', async () => {
    expect((await request(app).get('/health/ready')).status).toBe(200);
    const entorno = await crearEntorno();
    jest.spyOn(entorno.persistencia, 'ping').mockRejectedValueOnce(new Error('sin conexion'));
    expect((await request(entorno.app).get('/health/ready')).status).toBe(503);
  });

  it('sirve la especificacion OpenAPI con todos los endpoints del enunciado', async () => {
    const r = await request(app).get('/api/docs.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toMatch(/^3\./);
    expect(Object.keys(r.body.paths)).toEqual(
      expect.arrayContaining(['/api/creditos', '/api/creditos/{id}', '/api/creditos/{id}/estado', '/api/auth/login']),
    );
    expect((await request(app).get('/api/docs/')).status).toBe(200);
  });
});
