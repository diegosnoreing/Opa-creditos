import type { Credito } from '../domain/types';

export const EVENTO_CREDITO_CREADO = 'credito.creado';

export interface EventoWebhook {
  event: string;
  eventId: string;
  timestamp: string;
  data: {
    id: number;
    numeroCredito: string;
    identificacionAsociado: string;
    valorSolicitado: number;
    estado: string;
  };
}

/** Arma el cuerpo exacto que describe el enunciado (seccion 7). */
export function construirEventoCreditoCreado(credito: Credito, eventId: string, ahora: Date): EventoWebhook {
  return {
    event: EVENTO_CREDITO_CREADO,
    eventId,
    timestamp: ahora.toISOString(),
    data: {
      id: credito.id,
      numeroCredito: credito.numeroCredito,
      identificacionAsociado: credito.identificacionAsociado,
      valorSolicitado: credito.valorSolicitado,
      estado: credito.estado,
    },
  };
}
