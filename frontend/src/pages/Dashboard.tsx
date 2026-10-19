import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EstadoBadge } from '../components/EstadoBadge';
import { api } from '../lib/api';
import { ETIQUETA_ESTADO, ETIQUETA_TIPO } from '../lib/estados';
import { formatoCompacto, formatoEntero, formatoFecha, formatoMoneda } from '../lib/format';
import { ESTADOS, type Credito, type Estado, type Resumen } from '../lib/tipos';
import { useCarga } from '../lib/useCarga';

/** Orden del embudo: de lo que entra a lo que sale. Los tres últimos son resultados finales. */
function Distribucion({ resumen }: { resumen: Resumen }) {
  const [tabla, setTabla] = useState(false);
  const max = Math.max(1, ...ESTADOS.map((e) => resumen.porEstado[e] ?? 0));
  return (
    <section className="panel" aria-labelledby="h-dist">
      <div className="panel-cab">
        <h2 id="h-dist">Solicitudes por estado</h2>
        <button className="btn btn-txt" onClick={() => setTabla((t) => !t)} aria-pressed={tabla}>
          {tabla ? 'Ver gráfico' : 'Ver como tabla'}
        </button>
      </div>
      {tabla ? (
        <table className="tabla tabla-compacta">
          <thead><tr><th>Estado</th><th className="num">Solicitudes</th><th className="num">Participación</th></tr></thead>
          <tbody>
            {ESTADOS.map((e) => (
              <tr key={e}>
                <td><EstadoBadge estado={e} /></td>
                <td className="num">{resumen.porEstado[e] ?? 0}</td>
                <td className="num">{resumen.total ? Math.round(((resumen.porEstado[e] ?? 0) / resumen.total) * 100) : 0} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="barras">
          {ESTADOS.map((e: Estado) => {
            const n = resumen.porEstado[e] ?? 0;
            return (
              <li key={e}>
                <Link to={`/creditos?estado=${e}`} className="barra-fila" title={`${ETIQUETA_ESTADO[e]}: ${n} de ${resumen.total} solicitudes`}>
                  <span className="barra-nombre">{ETIQUETA_ESTADO[e]}</span>
                  <span className="barra-pista">
                    <span className={`barra-relleno e-${e}`} style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="barra-valor">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Dashboard() {
  const res = useCarga(() => api.resumen(), []);
  const recientes = useCarga(
    () => api.listar({ page: 1, pageSize: 6, estado: '', tipoCredito: '', identificacion: '', q: '', sortBy: 'fechaSolicitud', sortDir: 'desc' }),
    [],
  );

  const r = res.datos;
  const enCurso = r ? (r.porEstado.SOLICITADO ?? 0) + (r.porEstado.EN_ESTUDIO ?? 0) : 0;

  return (
    <>
      <header className="cabecera">
        <h1>Resumen de la cartera</h1>
        <Link className="btn btn-pri" to="/creditos/nuevo">Nueva solicitud</Link>
      </header>

      {res.error && <p className="alerta alerta-error" role="alert">{res.error} <button className="btn btn-txt" onClick={res.recargar}>Reintentar</button></p>}
      {res.cargando && !r && <p className="cargando">Cargando resumen…</p>}

      {r && (
        <>
          <div className="cifras">
            <div className="cifra cifra-principal">
              <span className="cifra-etq">Valor total solicitado</span>
              <span className="cifra-val" title={formatoMoneda(r.valorTotalSolicitado)}>{formatoMoneda(r.valorTotalSolicitado)}</span>
              <span className="cifra-nota">{formatoCompacto(r.valorTotalSolicitado)} COP en {formatoEntero(r.total)} solicitudes registradas</span>
            </div>
            <div className="cifra">
              <span className="cifra-etq">Pendientes de decisión</span>
              <span className="cifra-val">{enCurso}</span>
              <span className="cifra-nota">Solicitadas o en estudio</span>
            </div>
            <div className="cifra">
              <span className="cifra-etq">Aprobadas sin desembolsar</span>
              <span className="cifra-val">{r.porEstado.APROBADO ?? 0}</span>
              <span className="cifra-nota">Listas para el desembolso</span>
            </div>
          </div>

          <div className="dos-col">
            <Distribucion resumen={r} />
            <section className="panel" aria-labelledby="h-rec">
              <div className="panel-cab">
                <h2 id="h-rec">Últimas solicitudes</h2>
                <Link to="/creditos" className="btn btn-txt">Ver todas</Link>
              </div>
              {recientes.error && <p className="alerta alerta-error" role="alert">{recientes.error}</p>}
              <ul className="lista-rec">
                {recientes.datos?.items.map((c: Credito) => (
                  <li key={c.id}>
                    <Link to={`/creditos/${c.id}`}>
                      <span className="rec-nombre">{c.nombreAsociado}</span>
                      <span className="rec-det">{c.numeroCredito} · {ETIQUETA_TIPO[c.tipoCredito]} · {formatoFecha(c.fechaSolicitud)}</span>
                    </Link>
                    <span className="rec-der">
                      <span className="num">{formatoMoneda(c.valorSolicitado)}</span>
                      <EstadoBadge estado={c.estado} />
                    </span>
                  </li>
                ))}
              </ul>
              {recientes.datos?.items.length === 0 && <p className="vacio">Aún no hay solicitudes. Crea la primera desde “Nueva solicitud”.</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
