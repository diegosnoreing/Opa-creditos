import { Router } from 'express';
import type { CreditoService } from '../../services/creditoService';
import { usuarioActual } from '../middlewares/auth';
import { parseId, validarBody, validarQuery } from '../middlewares/validate';
import {
  actualizarCreditoSchema,
  cambiarEstadoSchema,
  crearCreditoSchema,
  eliminarCreditoSchema,
  listarCreditosSchema,
  type ListarCreditosQuery,
} from '../schemas';
import { authorize } from '../middlewares/auth';

/**
 * Los controladores son delgados: leen la peticion ya validada, llaman al
 * servicio y dan formato a la respuesta. No contienen reglas de negocio.
 * La autenticacion se aplica al montar el router (ver app.ts).
 */
export function creditosRouter(servicio: CreditoService): Router {
  const router = Router();

  // Va antes de "/:id" para que "resumen" no se interprete como un id.
  router.get('/resumen', async (_req, res) => {
    res.json({ success: true, data: await servicio.resumen() });
  });

  router.post('/', validarBody(crearCreditoSchema), async (req, res) => {
    const credito = await servicio.crear(req.body, usuarioActual(req));
    res.status(201).location(`/api/creditos/${credito.id}`).json({ success: true, data: credito });
  });

  router.get('/', validarQuery(listarCreditosSchema), async (_req, res) => {
    const filtro = res.locals['query'] as ListarCreditosQuery;
    const { items, total } = await servicio.listar({
      page: filtro.page,
      pageSize: filtro.pageSize,
      sortBy: filtro.sortBy,
      sortDir: filtro.sortDir,
      ...(filtro.estado && { estado: filtro.estado }),
      ...(filtro.identificacion && { identificacion: filtro.identificacion }),
      ...(filtro.tipoCredito && { tipoCredito: filtro.tipoCredito }),
      ...(filtro.q && { q: filtro.q }),
    });
    res.json({
      success: true,
      data: items,
      meta: {
        page: filtro.page,
        pageSize: filtro.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / filtro.pageSize)),
      },
    });
  });

  router.get('/:id', async (req, res) => {
    res.json({ success: true, data: await servicio.obtener(parseId(req.params['id'])) });
  });

  router.get('/:id/historial', async (req, res) => {
    res.json({ success: true, data: await servicio.historial(parseId(req.params['id'])) });
  });

  router.patch('/:id', validarBody(actualizarCreditoSchema), async (req, res) => {
    const credito = await servicio.actualizar(parseId(req.params['id']), req.body, usuarioActual(req));
    res.json({ success: true, data: credito });
  });

  router.patch('/:id/estado', validarBody(cambiarEstadoSchema), async (req, res) => {
    const { estado, observacion } = req.body as { estado: Parameters<CreditoService['cambiarEstado']>[1]; observacion?: string };
    const credito = await servicio.cambiarEstado(parseId(req.params['id']), estado, observacion, usuarioActual(req));
    res.json({ success: true, data: credito });
  });

  // Solo el ADMIN elimina; ademas el servicio rechaza estados que ya generaron compromisos.
  router.delete('/:id', authorize('ADMIN'), validarQuery(eliminarCreditoSchema), async (req, res) => {
    const { observacion } = res.locals['query'] as { observacion?: string };
    const id = parseId(req.params['id']);
    await servicio.eliminar(id, observacion, usuarioActual(req));
    res.json({ success: true, data: { id, eliminado: true } });
  });

  return router;
}
