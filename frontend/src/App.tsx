import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { CrearCredito } from './pages/CrearCredito';
import { Dashboard } from './pages/Dashboard';
import { Detalle } from './pages/Detalle';
import { Listado } from './pages/Listado';
import { Login } from './pages/Login';
import { Notificaciones } from './pages/Notificaciones';

function RequiereSesion({ admin = false }: { admin?: boolean }) {
  const { usuario } = useAuth();
  const loc = useLocation();
  if (!usuario) return <Navigate to="/login" replace state={{ desde: loc.pathname + loc.search }} />;
  if (admin && usuario.rol !== 'ADMIN') return <Navigate to="/" replace />;
  return <Layout />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequiereSesion />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/creditos" element={<Listado />} />
        <Route path="/creditos/nuevo" element={<CrearCredito />} />
        <Route path="/creditos/:id" element={<Detalle />} />
      </Route>
      <Route element={<RequiereSesion admin />}>
        <Route path="/notificaciones" element={<Notificaciones />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
