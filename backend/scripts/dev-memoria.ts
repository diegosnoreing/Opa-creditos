/**
 * Arranca la API REAL con persistencia en memoria: sin SQL Server ni Docker.
 * Pensado para probar el frontend o la API rapidamente. Los datos se pierden al
 * detenerlo. NO es un modo de produccion.
 *
 *   npm run dev:memoria
 */
import pino from 'pino';
import { createApp } from '../src/http/app';
import { MemoriaPersistencia } from '../src/repositories/memory/memoryPersistencia';
import { AuthService } from '../src/services/authService';
import { CreditoService } from '../src/services/creditoService';
import { iniciarWorker, WebhookDispatcher } from '../src/services/webhookDispatcher';
import type { Actor, CrearCreditoInput, Estado } from '../src/domain/types';

const PUERTO = Number(process.env['PORT'] ?? 3000);
const CLAVE_ADMIN = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin_12345';
const CLAVE_ANALISTA = process.env['SEED_ANALISTA_PASSWORD'] ?? 'Analista_12345';
const SECRETO_WEBHOOK = 'secreto-demo-del-webhook-en-memoria';
const ADMIN: Actor = { username: 'admin', rol: 'ADMIN' };
const ANALISTA: Actor = { username: 'analista', rol: 'ANALISTA' };

interface Demo {
  datos: CrearCreditoInput;
  pasos: Array<[Estado, string?]>;
}

const base = { tasaInteres: 1.5, formaPago: 'NOMINA' } as const;
const DEMO: Demo[] = [
  { datos: { ...base, identificacionAsociado: '1001234567', nombreAsociado: 'Juan Pérez', tipoCredito: 'LIBRE_INVERSION', valorSolicitado: 15_000_000, numeroCuotas: 36 }, pasos: [] },
  { datos: { ...base, identificacionAsociado: '52987345', nombreAsociado: 'María Fernanda Rojas', tipoCredito: 'VIVIENDA', valorSolicitado: 120_000_000, tasaInteres: 0.9, numeroCuotas: 180, formaPago: 'DEBITO_AUTOMATICO' }, pasos: [['EN_ESTUDIO']] },
  { datos: { ...base, identificacionAsociado: '80456123', nombreAsociado: 'Carlos Andrés Gómez', tipoCredito: 'VEHICULO', valorSolicitado: 45_000_000, tasaInteres: 1.2, numeroCuotas: 60, formaPago: 'CAJA' }, pasos: [['EN_ESTUDIO'], ['APROBADO']] },
  { datos: { ...base, identificacionAsociado: '1020345678', nombreAsociado: 'Laura Sofía Martínez', tipoCredito: 'EDUCACION', valorSolicitado: 8_500_000, tasaInteres: 0.8, numeroCuotas: 24 }, pasos: [['EN_ESTUDIO'], ['APROBADO'], ['DESEMBOLSADO']] },
  { datos: { ...base, identificacionAsociado: '79123456', nombreAsociado: 'Pedro Antonio Ramírez', tipoCredito: 'LIBRE_INVERSION', valorSolicitado: 22_000_000, tasaInteres: 1.8, numeroCuotas: 48, formaPago: 'PSE' }, pasos: [['EN_ESTUDIO'], ['RECHAZADO', 'Capacidad de pago insuficiente']] },
  { datos: { ...base, identificacionAsociado: '1098765432', nombreAsociado: 'Ana Lucía Torres', tipoCredito: 'CALAMIDAD', valorSolicitado: 5_000_000, tasaInteres: 0.5, numeroCuotas: 12 }, pasos: [['CANCELADO', 'El asociado desistió de la solicitud']] },
  { datos: { ...base, identificacionAsociado: '1001234567', nombreAsociado: 'Juan Pérez', tipoCredito: 'EDUCACION', valorSolicitado: 6_200_000, tasaInteres: 0.8, numeroCuotas: 18 }, pasos: [['EN_ESTUDIO']] },
  { datos: { ...base, identificacionAsociado: '43876210', nombreAsociado: 'Luz Marina Cardona', tipoCredito: 'LIBRE_INVERSION', valorSolicitado: 9_750_000, numeroCuotas: 24, formaPago: 'CAJA' }, pasos: [] },
];

async function main(): Promise<void> {
  const logger = pino({ level: 'warn' });
  const persistencia = new MemoriaPersistencia();
  const authService = new AuthService(persistencia.usuarios, { jwtSecret: 'secreto-jwt-solo-para-modo-memoria-0123456789', jwtExpiresIn: '8h', bcryptRounds: 6 });
  await authService.sembrarUsuarios({ admin: CLAVE_ADMIN, analista: CLAVE_ANALISTA });
  const creditoService = new CreditoService(persistencia);

  for (const { datos, pasos } of DEMO) {
    const credito = await creditoService.crear(datos, ANALISTA);
    for (const [estado, motivo] of pasos) await creditoService.cambiarEstado(credito.id, estado, motivo, ADMIN);
  }

  const app = createApp({
    creditoService,
    authService,
    outbox: persistencia.outbox,
    logger,
    checkDb: () => persistencia.ping(),
    config: {
      isProduction: false,
      corsOrigins: ['http://localhost:5173'],
      trustProxy: false,
      rateLimit: { windowMs: 60_000, max: 10_000, loginMax: 1_000 },
      webhookSecret: SECRETO_WEBHOOK,
      enableDemoReceiver: true,
    },
  });

  const despachador = new WebhookDispatcher(
    persistencia.outbox,
    {
      url: `http://localhost:${PUERTO}/api/webhooks/demo-receptor`,
      secret: SECRETO_WEBHOOK,
      maxAttempts: 6,
      timeoutMs: 3000,
      backoffBaseMs: 5000,
      backoffMaxMs: 60_000,
      batchSize: 10,
      leaseMs: 15_000,
    },
    logger,
  );

  app.listen(PUERTO, () => {
    iniciarWorker(despachador, 2000, logger);
    console.log(`\nAPI en memoria (sin base de datos) en http://localhost:${PUERTO}`);
    console.log(`  Swagger:  http://localhost:${PUERTO}/api/docs`);
    console.log(`  Usuarios: admin / ${CLAVE_ADMIN}   y   analista / ${CLAVE_ANALISTA}`);
    console.log(`  ${DEMO.length} créditos de ejemplo cargados. Los datos se pierden al detener el proceso.\n`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
