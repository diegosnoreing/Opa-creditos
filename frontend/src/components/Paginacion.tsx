import type { Meta } from '../lib/tipos';
import { formatoEntero } from '../lib/format';

export function Paginacion({ meta, onCambiar }: { meta: Meta; onCambiar: (p: number) => void }) {
  if (meta.total === 0) return null;
  const desde = (meta.page - 1) * meta.pageSize + 1;
  const hasta = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="paginacion" aria-label="Paginación">
      <span>
        {formatoEntero(desde)}–{formatoEntero(hasta)} de {formatoEntero(meta.total)}
      </span>
      <div>
        <button className="btn btn-sec" disabled={meta.page <= 1} onClick={() => onCambiar(meta.page - 1)}>Anterior</button>
        <span className="paginacion-pos">Página {meta.page} de {meta.totalPages}</span>
        <button className="btn btn-sec" disabled={meta.page >= meta.totalPages} onClick={() => onCambiar(meta.page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
}
