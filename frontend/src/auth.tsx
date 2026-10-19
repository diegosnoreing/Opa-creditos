import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, guardarSesion, leerSesion, registrarExpiracion, type Sesion } from './lib/api';
import type { Usuario } from './lib/tipos';

interface AuthCtx {
  usuario: Usuario | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Se pone en true cuando el servidor rechazó el token (venció o es inválido). */
  expirada: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(() => leerSesion());
  const [expirada, setExpirada] = useState(false);

  const logout = useCallback(() => {
    guardarSesion(null);
    setSesion(null);
  }, []);

  useEffect(() => {
    registrarExpiracion(() => {
      guardarSesion(null);
      setSesion(null);
      setExpirada(true);
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const s = await api.login(username, password);
    guardarSesion(s);
    setSesion(s);
    setExpirada(false);
  }, []);

  const valor = useMemo(() => ({ usuario: sesion?.usuario ?? null, login, logout, expirada }), [sesion, login, logout, expirada]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
}
