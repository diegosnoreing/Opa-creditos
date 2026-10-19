import type { Notificacion } from '../lib/tipos';
import { Glifo } from './Glifo';

const DATOS = {
  ENVIADO: { forma: 'check', texto: 'Enviada' },
  FALLIDO: { forma: 'x', texto: 'Fallida' },
  PENDIENTE: { forma: 'medio', texto: 'Pendiente' },
} as const;

export function EstadoWh({ estado }: { estado: Notificacion['estado'] }) {
  const d = DATOS[estado];
  return <span className={`wh wh-${estado}`}><Glifo forma={d.forma} />{d.texto}</span>;
}
