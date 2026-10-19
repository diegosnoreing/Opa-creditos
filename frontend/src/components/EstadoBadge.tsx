import { ETIQUETA_ESTADO } from '../lib/estados';
import type { Estado } from '../lib/tipos';
import { Glifo, type Forma } from './Glifo';

/** El estado nunca se comunica solo con color: lleva un símbolo y el nombre. */
const FORMA: Record<Estado, Forma> = {
  SOLICITADO: 'vacio',
  EN_ESTUDIO: 'medio',
  APROBADO: 'check',
  RECHAZADO: 'x',
  DESEMBOLSADO: 'lleno',
  CANCELADO: 'guion',
};

export function EstadoBadge({ estado }: { estado: Estado }) {
  return (
    <span className={`estado e-${estado}`}>
      <Glifo forma={FORMA[estado]} />
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}
