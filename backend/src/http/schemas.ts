import { z } from 'zod';
import { CAMPOS_ORDEN, ESTADOS, FORMAS_PAGO, TIPOS_CREDITO } from '../domain/types';

/**
 * Esquemas de la PETICION: forma y tipos de los datos (400 si no cumplen).
 * Las reglas de NEGOCIO (valor > 0, tasa >= 0, cuotas > 0, tope de decimales...)
 * no estan aqui sino en domain/validaciones.ts (422), para que ningun otro punto
 * de entrada pueda saltarselas.
 *
 * z.strictObject rechaza campos desconocidos: asi nadie puede enviar "estado"
 * o "numeroCredito" al crear (proteccion contra "mass assignment").
 */

const vacioComoUndefined = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema);

const numero = (nombre: string) =>
  z.number({ error: `${nombre} es obligatorio y debe ser un número` });

export const crearCreditoSchema = z.strictObject({
  identificacionAsociado: z
    .string({ error: 'La identificación del asociado es obligatoria' })
    .trim()
    .regex(/^\d{5,15}$/, 'La identificación debe tener entre 5 y 15 dígitos'),
  nombreAsociado: z
    .string({ error: 'El nombre del asociado es obligatorio' })
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(150, 'El nombre no puede superar 150 caracteres'),
  tipoCredito: z.enum(TIPOS_CREDITO, { error: `El tipo de crédito debe ser uno de: ${TIPOS_CREDITO.join(', ')}` }),
  valorSolicitado: numero('El valor solicitado'),
  tasaInteres: numero('La tasa de interés'),
  numeroCuotas: numero('El número de cuotas'),
  formaPago: z.enum(FORMAS_PAGO, { error: `La forma de pago debe ser una de: ${FORMAS_PAGO.join(', ')}` }),
});

export const actualizarCreditoSchema = z
  .strictObject({
    tipoCredito: z.enum(TIPOS_CREDITO, { error: `El tipo de crédito debe ser uno de: ${TIPOS_CREDITO.join(', ')}` }),
    valorSolicitado: numero('El valor solicitado'),
    tasaInteres: numero('La tasa de interés'),
    numeroCuotas: numero('El número de cuotas'),
    formaPago: z.enum(FORMAS_PAGO, { error: `La forma de pago debe ser una de: ${FORMAS_PAGO.join(', ')}` }),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'Debes enviar al menos un campo para modificar' });

export const cambiarEstadoSchema = z.strictObject({
  estado: z.enum(ESTADOS, { error: `El estado debe ser uno de: ${ESTADOS.join(', ')}` }),
  observacion: z.string().trim().max(500, 'La observación no puede superar 500 caracteres').optional(),
});

export const listarCreditosSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  estado: vacioComoUndefined(z.enum(ESTADOS).optional()),
  identificacion: vacioComoUndefined(z.string().trim().regex(/^\d{1,15}$/, 'La identificación solo admite dígitos').optional()),
  tipoCredito: vacioComoUndefined(z.enum(TIPOS_CREDITO).optional()),
  q: vacioComoUndefined(z.string().trim().max(100).optional()),
  sortBy: z.enum(CAMPOS_ORDEN).default('fechaSolicitud'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const eliminarCreditoSchema = z.object({
  observacion: vacioComoUndefined(z.string().trim().max(500).optional()),
});

export const loginSchema = z.strictObject({
  username: z.string({ error: 'El usuario es obligatorio' }).trim().min(1).max(50),
  password: z.string({ error: 'La contraseña es obligatoria' }).min(1).max(200),
});

export const listarNotificacionesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  estado: vacioComoUndefined(z.enum(['PENDIENTE', 'ENVIADO', 'FALLIDO']).optional()),
  creditoId: vacioComoUndefined(z.coerce.number().int().min(1).optional()),
});

export type ListarCreditosQuery = z.infer<typeof listarCreditosSchema>;
export type ListarNotificacionesQuery = z.infer<typeof listarNotificacionesSchema>;
