import { useCallback, useEffect, useRef, useState } from 'react';
import { mensajeDeError } from './api';

export interface Carga<T> {
  datos: T | undefined;
  error: string | undefined;
  cargando: boolean;
  recargar: () => void;
}

/** Carga datos al montar y cuando cambian las dependencias; ignora respuestas viejas. */
export function useCarga<T>(fn: () => Promise<T>, deps: readonly unknown[]): Carga<T> {
  const [datos, setDatos] = useState<T>();
  const [error, setError] = useState<string>();
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);
  const ultima = useRef(0);

  useEffect(() => {
    const mia = ++ultima.current;
    setCargando(true);
    fn()
      .then((d) => {
        if (mia !== ultima.current) return;
        setDatos(d);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (mia === ultima.current) setError(mensajeDeError(e));
      })
      .finally(() => {
        if (mia === ultima.current) setCargando(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { datos, error, cargando, recargar: useCallback(() => setVersion((v) => v + 1), []) };
}
