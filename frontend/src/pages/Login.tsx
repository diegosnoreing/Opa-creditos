import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { mensajeDeError } from '../lib/api';

export function Login() {
  const { usuario, login, expirada } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const destino = (loc.state as { desde?: string } | null)?.desde ?? '/';

  if (usuario) return <Navigate to={destino} replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setEnviando(true);
    try {
      await login(username.trim(), password);
      nav(destino, { replace: true });
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <div className="login-lado" aria-hidden="true">
        <div className="login-marca"><span className="marca-sello" /> OPA <strong>Créditos</strong></div>
        <p className="login-frase">Cada solicitud, con su estado, su responsable y su historia.</p>
      </div>
      <main className="login-form">
        <form onSubmit={enviar} noValidate>
          <h1>Ingresar</h1>
          <p className="sub">Usa tu usuario de la plataforma de crédito.</p>
          {expirada && !error && <p className="alerta alerta-info" role="status">Tu sesión venció. Ingresa de nuevo para continuar.</p>}
          {error && <p className="alerta alerta-error" role="alert">{error}</p>}
          <div className="campo">
            <label htmlFor="usuario">Usuario</label>
            <input id="usuario" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="campo">
            <label htmlFor="clave">Contraseña</label>
            <input id="clave" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-pri btn-ancho" disabled={enviando || !username || !password}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </main>
    </div>
  );
}
