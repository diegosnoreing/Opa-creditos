import type { ReactNode } from 'react';

interface Props {
  id: string;
  etiqueta: string;
  ayuda?: string | undefined;
  error?: string | undefined;
  children: (a: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}

export function Campo({ id, etiqueta, ayuda, error, children }: Props) {
  const desc = error ? `${id}-error` : ayuda ? `${id}-ayuda` : undefined;
  return (
    <div className={`campo${error ? ' campo-error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': desc })}
      {error ? <p id={`${id}-error`} className="campo-msg">{error}</p> : ayuda ? <p id={`${id}-ayuda`} className="campo-ayuda">{ayuda}</p> : null}
    </div>
  );
}
