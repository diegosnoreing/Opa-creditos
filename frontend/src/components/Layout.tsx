import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export function Layout() {
  const { usuario, logout } = useAuth();
  const nav = useNavigate();
  if (!usuario) return null;
  return (
    <div className="app">
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <aside className="lateral">
        <div className="marca">
          <span className="marca-sello" aria-hidden="true" />
          <span>OPA <strong>Créditos</strong></span>
        </div>
        <nav aria-label="Principal" className="menu">
          <NavLink to="/" end>Resumen</NavLink>
          <NavLink to="/creditos" end>Créditos</NavLink>
          <NavLink to="/creditos/nuevo">Nueva solicitud</NavLink>
          {usuario.rol === 'ADMIN' && <NavLink to="/notificaciones">Notificaciones</NavLink>}
        </nav>
        <div className="sesion">
          <div>
            <div className="sesion-nombre">{usuario.username}</div>
            <div className="sesion-rol">{usuario.rol === 'ADMIN' ? 'Administrador' : 'Analista'}</div>
          </div>
          <button className="btn btn-claro" onClick={() => { logout(); nav('/login'); }}>Salir</button>
        </div>
      </aside>
      <main id="contenido" className="principal" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
