import { Router, type RequestHandler } from 'express';
import { NotFoundError, UnauthorizedError, ConflictError } from '../../domain/errors';
import type { OutboxRepository } from '../../repositories/interfaces';
import type { EventoWebhook } from '../../services/webhookEventos';
import { verificarFirma } from '../../services/webhookDispatcher';
import { authorize } from '../middlewares/auth';
import { parseId, validarQuery } from '../middlewares/validate';
import { listarNotificacionesSchema, type ListarNotificacionesQuery } from '../schemas';
import type { HttpConfig } from '../types';
import '../types';

/** Consulta de la traza de notificaciones (solo ADMIN). Se monta ya autenticado. */
export function notificacionesRouter(outbox: OutboxRepository, reloj: () => Date = () => new Date()): Router {
  const router = Router();
  router.use(authorize('ADMIN'));

  router.get('/', validarQuery(listarNotificacionesSchema), async (_req, res) => {
    const f = res.locals['query'] as ListarNotificacionesQuery;
    const { items, total } = await outbox.listar({
      page: f.page,
      pageSize: f.pageSize,
      ...(f.estado && { estado: f.estado }),
      ...(f.creditoId && { creditoId: f.creditoId }),
    });
    res.json({
      success: true,
      data: items.map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown })),
      meta: { page: f.page, pageSize: f.pageSize, total, totalPages: Math.max(1, Math.ceil(total / f.pageSize)) },
    });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params['id']);
    const evento = await outbox.obtener(id);
    if (!evento) throw new NotFoundError('La notificación no existe', 'NOTIFICACION_NOT_FOUND');
    res.json({
      success: true,
      data: { ...evento, payload: JSON.parse(evento.payload) as unknown, intentosDetalle: await outbox.listarIntentos(id) },
    });
  });

  /** Devuelve a la cola un evento que agoto sus reintentos (FALLIDO). */
  router.post('/:id/reintentar', async (req, res) => {
    const id = parseId(req.params['id']);
    const evento = await outbox.obtener(id);
    if (!evento) throw new NotFoundError('La notificación no existe', 'NOTIFICACION_NOT_FOUND');
    if (!(await outbox.reencolar(id, reloj()))) {
      throw new ConflictError('NOTIFICACION_NO_REINTENTABLE', `Solo se pueden reintentar notificaciones FALLIDAS (estado actual: ${evento.estado})`);
    }
    res.json({ success: true, data: { id, estado: 'PENDIENTE' } });
  });

  return router;
}

/**
 * Receptor de DEMOSTRACION del webhook: hace de "sistema externo" para poder
 * probar el flujo completo en local. Verifica la firma HMAC y el timestamp, y
 * es idempotente por eventId. No usa JWT: la autenticidad la da la firma.
 */
export function receptorDemoRouter(config: HttpConfig, autenticar: RequestHandler): Router {
  const router = Router();
  const recibidos = new Map<string, EventoWebhook>(); // limitado a 1000 (FIFO)

  router.post('/', (req, res) => {
    const timestamp = req.header('x-webhook-timestamp');
    const firma = req.header('x-webhook-signature');
    if (
      !config.webhookSecret ||
      !timestamp ||
      !firma ||
      !req.rawBody ||
      !verificarFirma({ secreto: config.webhookSecret, timestampSeg: timestamp, cuerpo: req.rawBody.toString('utf8'), firma })
    ) {
      throw new UnauthorizedError('Firma del webhook inválida o vencida', 'FIRMA_INVALIDA');
    }

    const evento = req.body as EventoWebhook;
    const duplicado = recibidos.has(evento.eventId);
    if (!duplicado) {
      recibidos.set(evento.eventId, evento);
      if (recibidos.size > 1000) recibidos.delete(recibidos.keys().next().value as string);
    }
    res.json({ success: true, data: { recibido: true, duplicado, eventId: evento.eventId } });
  });

  router.get('/recibidos', autenticar, authorize('ADMIN'), (_req, res) => {
    res.json({ success: true, data: [...recibidos.values()].reverse() });
  });

  return router;
}
