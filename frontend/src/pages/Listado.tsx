import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EstadoBadge } from '../components/EstadoBadge';
import { Paginacion } from '../components/Paginacion';
import { api } from '../lib/api';
import { ETIQUETA_ESTADO, ETIQUETA_TIPO } from '../lib/estados';
import { formatoFecha, formatoMoneda } from '../lib/format';
import { ESTADOS, TIPOS_CREDITO, type Filtros } from '../lib/tipos';
import { useCarga } from '../lib/useCarga';

const ORDENES: Filtros['sortBy'][] = ['fechaSolicitud', 'valorSolicitado', 'estado', 'numeroCredito', 'nombreAsociado'];

function leerFiltros(p: URLSearchParams): Filtros {
  const estado = p.get('estado') ?? '';
  const tipo = p.get('tipoCredito') ?? '';
  const orden = p.get('sortBy') ?? '';
  return {
    page: Math.max(1, Number(p.get('page')) || 1),
    pageSize: 10,
    estado: (ESTADOS as readonly string[]).includes(estado) ? (estado as Filtros['estado']) : '',
    tipoCredito: (TIPOS_CREDITO as readonly string[]).includes(tipo) ? (tipo as Filtros['tipoCredito']) : '',
    identificacion: (p.get('identificacion') ?? '').replace(/\D/g, ''),
    q: p.get('q') ?? '',
    sortBy: (ORDENES as string[]).includes(orden) ? (orden as Filtros['sortBy']) : 'fechaSolicitud',
    sortDir: p.get('sortDir') === 'asc' ? 'asc' : 'desc',
  };
}

export function Listado() {
  const [params, setParams] = useSearchParams();
  const f = leerFiltros(params);
  const [texto, setTexto] = useState(f.q);
  const [ident, setIdent] = useState(f.identificacion);

  const cambiar = (cambios: Record<string, string | undefined>, reiniciarPagina = true) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (reiniciarPagina) p.delete('page');
    setParams(p, { replace: true });
  };

  // Búsqueda con espera: no se consulta en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if (texto !== f.q || ident !== f.identificacion) cambiar({ q: texto.trim() || undefined, identificacion: ident || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, ident]);

  const { datos, error, cargando, recargar } = useCarga(() => api.listar(f), [params.toString()]);

  const ordenar = (campo: Filtros['sortBy']) =>
    cambiar({ sortBy: campo, sortDir: f.sortBy === campo && f.sortDir === 'desc' ? 'asc' : 'desc' }, false);
  const flecha = (campo: Filtros['sortBy']) => (f.sortBy === campo ? (f.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const aria = (campo: Filtros['sortBy']) => (f.sortBy === campo ? (f.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  const hayFiltros = Boolean(f.estado || f.tipoCredito || f.q || f.identificacion);

  const Th = ({ campo, children, num }: { campo: Filtros['sortBy']; children: string; num?: boolean }) => (
    <th scope="col" aria-sort={aria(campo)} className={num ? 'num' : undefined}>
      <button className="th-orden" onClick={() => ordenar(campo)}>{children}{flecha(campo)}</button>
    </th>
  );

  return (
    <>
      <header className="cabecera">
        <h1>Créditos</h1>
        <Link className="btn btn-pri" to="/creditos/nuevo">Nueva solicitud</Link>
      </header>

      <section className="filtros" aria-label="Filtros">
        <div className="campo">
          <label htmlFor="f-q">Buscar por nombre o número</label>
          <input id="f-q" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. Pérez o CR-2026-000003" />
        </div>
        <div className="campo">
          <label htmlFor="f-id">Identificación</label>
          <input id="f-id" inputMode="numeric" value={ident} onChange={(e) => setIdent(e.target.value.replace(/\D/g, ''))} placeholder="Solo dígitos" />
        </div>
        <div className="campo">
          <label htmlFor="f-estado">Estado</label>
          <select id="f-estado" value={f.estado} onChange={(e) => cambiar({ estado: e.target.value || undefined })}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="f-tipo">Tipo de crédito</label>
          <select id="f-tipo" value={f.tipoCredito} onChange={(e) => cambiar({ tipoCredito: e.target.value || undefined })}>
            <option value="">Todos</option>
            {TIPOS_CREDITO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
          </select>
        </div>
        {hayFiltros && (
          <button className="btn btn-txt filtros-limpiar" onClick={() => { setTexto(''); setIdent(''); setParams(new URLSearchParams(), { replace: true }); }}>
            Quitar filtros
          </button>
        )}
      </section>

      {error && <p className="alerta alerta-error" role="alert">{error} <button className="btn btn-txt" onClick={recargar}>Reintentar</button></p>}

      <div className={`tabla-caja${cargando ? ' tabla-cargando' : ''}`} aria-busy={cargando}>
        <table className="tabla">
          <caption className="solo-lectores">Solicitudes de crédito</caption>
          <thead>
            <tr>
              <Th campo="numeroCredito">Número</Th>
              <Th campo="nombreAsociado">Asociado</Th>
              <th scope="col">Tipo</th>
              <Th campo="valorSolicitado" num>Valor</Th>
              <th scope="col" className="num">Cuotas</th>
              <Th campo="estado">Estado</Th>
              <Th campo="fechaSolicitud">Solicitud</Th>
            </tr>
          </thead>
          <tbody>
            {datos?.items.map((c) => (
              <tr key={c.id}>
                <td><Link className="enlace-num" to={`/creditos/${c.id}`}>{c.numeroCredito}</Link></td>
                <td>
                  <span className="celda-nombre">{c.nombreAsociado}</span>
                  <span className="celda-sub">C.C. {c.identificacionAsociado}</span>
                </td>
                <td>{ETIQUETA_TIPO[c.tipoCredito]}</td>
                <td className="num">{formatoMoneda(c.valorSolicitado)}</td>
                <td className="num">{c.numeroCuotas}</td>
                <td><EstadoBadge estado={c.estado} /></td>
                <td>{formatoFecha(c.fechaSolicitud)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {datos && datos.items.length === 0 && (
          <p className="vacio">{hayFiltros ? 'Ninguna solicitud coincide con los filtros.' : 'Todavía no hay solicitudes registradas.'}</p>
        )}
      </div>

      {datos && <Paginacion meta={datos.meta} onCambiar={(p) => cambiar({ page: String(p) }, false)} />}
    </>
  );
}
