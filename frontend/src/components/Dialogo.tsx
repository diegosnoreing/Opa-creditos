import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}

/** Usa el <dialog> nativo: gestiona foco, Escape y el fondo inerte. */
export function Dialogo({ abierto, titulo, onCerrar, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} className="dialogo" onClose={onCerrar} onClick={(e) => e.target === ref.current && onCerrar()} aria-labelledby="dialogo-titulo">
      {abierto && (
        <div className="dialogo-cuerpo">
          <h2 id="dialogo-titulo">{titulo}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
