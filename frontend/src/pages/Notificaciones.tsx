import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { EstadoWh } from '../components/EstadoWh';
import { Paginacion } from '../components/Paginacion';
import { useAviso } from '../components/Toast';
import { api, mensajeDeError } from '../lib/api';
import { formatoFechaHora } from '../lib/format';
import type { Notificacion } from '../lib/tipos';
import { useCarga } from '../lib/useCarga';


function Detalle({ id }: { id: number }) {
  const { datos, error } = useCarga(() => api.notificacion(id), [id]);
  if (error) return <p className="alerta alerta-error">{error}</p>;
  if (!datos) return <p className="cargando">Cargando intentos…</p>;
  return (
    <div className="intentos">
      <p className="nota">Identificador del evento (para deduplicar en el receptor): <code>{datos.eventId}</code></p>
      {datos.intentosDetalle && datos.intentosDetalle.length > 0 ? (
        <table className="tabla tabla-compacta">
          <thead><tr><th>Intento</th><th>Fecha</th><th>Resultado</th><th className="num">Duración</th></tr></thead>
          <tbody>
            {datos.intentosDetalle.map((i) => (
              <tr key={i.numeroIntento}>
                <td>{i.numeroIntento}</td>
                <td>{formatoFechaHora(i.fecha)}</td>
                <td>{i.exito ? `Correcto · HTTP ${i.codigoHttp}` : `Falló · ${i.codigoHttp ? `HTTP ${i.codigoHttp}` : (i.error ?? 'sin respuesta')}`}</td>
                <td className="num">{i.duracionMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="vacio">Todavía no se ha intentado el envío.</p>
      )}
      {datos.proximoIntento && datos.estado === 'PENDIENTE' && <p className="nota">Próximo intento: {formatoFechaHora(datos.proximoIntento)}</p>}
    </div>
  );
}

export function Notificaciones() {
  const avisar = useAviso();
  const [estado, setEstado] = useState('');
  const [page, setPage] = useState(1);
  const [abierta, setAbierta] = useState<number>();
  const { datos, error, cargando, recargar } = useCarga(() => api.notificaciones({ page, pageSize: 10, estado }), [page, estado]);

  const reintentar = async (n: Notificacion) => {
    try {
      await api.reintentar(n.id);
      avisar('Notificación devuelta a la cola: se reenviará en el próximo ciclo');
      recargar();
    } catch (e) {
      avisar(mensajeDeError(e), 'error');
    }
  };

  return (
    <>
      <header className="cabecera">
        <h1>Notificaciones al sistema externo</h1>
      </header>
      <p className="sub">Cada crédito nuevo genera un aviso firmado. Si el sistema externo falla, se reintenta con esperas crecientes; al agotar los intentos queda como fallida y se puede reenviar desde aquí.</p>

      <section className="filtros" aria-label="Filtros">
        <div className="campo">
          <label htmlFor="n-estado">Estado</label>
          <select id="n-estado" value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            <option value="PENDIENTE">Pendientes</option>
            <option value="ENVIADO">Enviadas</option>
            <option value="FALLIDO">Fallidas</option>
          </select>
        </div>
        <button className="btn btn-sec" onClick={recargar}>Actualizar</button>
      </section>

      {error && <p className="alerta alerta-error" role="alert">{error}</p>}
      <div className={`tabla-caja${cargando ? ' tabla-cargando' : ''}`}>
        <table className="tabla">
          <caption className="solo-lectores">Notificaciones</caption>
          <thead>
            <tr><th>Estado</th><th>Crédito</th><th>Evento</th><th className="num">Intentos</th><th>Último resultado</th><th>Creada</th><th><span className="solo-lectores">Acciones</span></th></tr>
          </thead>
          <tbody>
            {datos?.items.map((n) => (
              <Fragment key={n.id}>
                <tr>
                  <td><EstadoWh estado={n.estado} /></td>
                  <td><Link className="enlace-num" to={`/creditos/${n.creditoId}`}>#{n.creditoId}</Link></td>
                  <td>{n.evento}</td>
                  <td className="num">{n.intentos}</td>
                  <td>{n.ultimoCodigoHttp ? `HTTP ${n.ultimoCodigoHttp}` : (n.ultimoError ?? '—')}</td>
                  <td>{formatoFechaHora(n.fechaCreacion)}</td>
                  <td className="celda-acc">
                    <button className="btn btn-txt" aria-expanded={abierta === n.id} onClick={() => setAbierta(abierta === n.id ? undefined : n.id)}>
                      {abierta === n.id ? 'Ocultar' : 'Intentos'}
                    </button>
                    {n.estado === 'FALLIDO' && <button className="btn btn-sec" onClick={() => void reintentar(n)}>Reintentar</button>}
                  </td>
                </tr>
                {abierta === n.id && <tr className="fila-detalle"><td colSpan={7}><Detalle id={n.id} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
        {datos && datos.items.length === 0 && <p className="vacio">No hay notificaciones con ese filtro.</p>}
      </div>
      {datos && <Paginacion meta={datos.meta} onCambiar={setPage} />}
    </>
  );
}
