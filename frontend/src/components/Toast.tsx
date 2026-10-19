import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tipo = 'ok' | 'error';
interface Aviso {
  id: number;
  tipo: Tipo;
  texto: string;
}
const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => undefined);
let contador = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const avisar = useCallback((texto: string, tipo: Tipo = 'ok') => {
    const id = ++contador;
    setAvisos((a) => [...a, { id, tipo, texto }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'error' ? 8000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={avisar}>
      {children}
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`}>
            <span aria-hidden="true">{a.tipo === 'ok' ? '✓' : '!'}</span>
            <span>{a.texto}</span>
            <button className="aviso-cerrar" aria-label="Cerrar aviso" onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useAviso = () => useContext(Ctx);
