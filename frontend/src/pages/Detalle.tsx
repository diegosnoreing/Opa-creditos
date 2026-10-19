import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Campo } from '../components/Campo';
import { Dialogo } from '../components/Dialogo';
import { EstadoBadge } from '../components/EstadoBadge';
import { EstadoWh } from '../components/EstadoWh';
import { useAviso } from '../components/Toast';
import { ApiError, api, mensajeDeError } from '../lib/api';
import {
  ACCION_ESTADO, ETIQUETA_ESTADO, ETIQUETA_PAGO, ETIQUETA_TIPO, esFinal, exigeMotivo, puedeEditar, puedeEliminar, transicionesPermitidas,
} from '../lib/estados';
import { cuotaEstimada, formatoFechaHora, formatoMoneda, formatoTasa } from '../lib/format';
import { FORMAS_PAGO, TIPOS_CREDITO, type CambiosCredito, type Credito, type Estado, type FormaPago, type HistorialItem, type TipoCredito } from '../lib/tipos';
import { useCarga } from '../lib/useCarga';
import { aNumero, validarCuotas, validarTasa, validarValor } from '../lib/validation';

const ETIQUETA_CAMPO: Record<string, string> = {
  tipoCredito: 'Tipo de crédito',
  valorSolicitado: 'Valor solicitado',
  tasaInteres: 'Tasa de interés',
  numeroCuotas: 'Cuotas',
  formaPago: 'Forma de pago',
};

function valorLegible(campo: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (campo === 'valorSolicitado' && typeof v === 'number') return formatoMoneda(v);
  if (campo === 'tipoCredito') return ETIQUETA_TIPO[v as TipoCredito] ?? String(v);
  if (campo === 'formaPago') return ETIQUETA_PAGO[v as FormaPago] ?? String(v);
  if (campo === 'tasaInteres' && typeof v === 'number') return `${v} %`;
  return String(v);
}

function Historial({ items }: { items: HistorialItem[] }) {
  const titulo = (h: HistorialItem): string => {
    switch (h.accion) {
      case 'CREACION': return 'Solicitud creada';
      case 'ACTUALIZACION': return 'Condiciones modificadas';
      case 'ELIMINACION': return 'Solicitud eliminada';
      default: return `Pasó a ${h.estadoNuevo ? ETIQUETA_ESTADO[h.estadoNuevo] : ''}`.trim();
    }
  };
  return (
    <ol className="linea">
      {items.map((h) => (
        <li key={h.id}>
          <div className="linea-cab">
            <strong>{titulo(h)}</strong>
            <time dateTime={h.fecha}>{formatoFechaHora(h.fecha)}</time>
          </div>
          <div className="linea-det">
            {h.estadoAnterior && h.estadoNuevo && h.estadoAnterior !== h.estadoNuevo && <span>{ETIQUETA_ESTADO[h.estadoAnterior]} → {ETIQUETA_ESTADO[h.estadoNuevo]} · </span>}
            por {h.usuario}
          </div>
          {h.observacion && <p className="linea-obs">“{h.observacion}”</p>}
          {h.cambios && (
            <ul className="linea-cambios">
              {Object.entries(h.cambios).map(([campo, c]) => (
                <li key={campo}>
                  {ETIQUETA_CAMPO[campo] ?? campo}: <s>{valorLegible(campo, c.antes)}</s> → <strong>{valorLegible(campo, c.despues)}</strong>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function Edicion({ credito, onCancelar, onGuardado }: { credito: Credito; onCancelar: () => void; onGuardado: (c: Credito) => void }) {
  const avisar = useAviso();
  const [tipo, setTipo] = useState<TipoCredito>(credito.tipoCredito);
  const [pago, setPago] = useState<FormaPago>(credito.formaPago);
  const [valor, setValor] = useState(String(credito.valorSolicitado));
  const [tasa, setTasa] = useState(String(credito.tasaInteres));
  const [cuotas, setCuotas] = useState(String(credito.numeroCuotas));
  const [errores, setErrores] = useState<Record<string, string | undefined>>({});
  const [errorGeneral, setErrorGeneral] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const err = { valor: validarValor(valor), tasa: validarTasa(tasa), cuotas: validarCuotas(cuotas) };
    setErrores({ valorSolicitado: err.valor, tasaInteres: err.tasa, numeroCuotas: err.cuotas });
    if (err.valor || err.tasa || err.cuotas) return;
    // Solo se envía lo que cambió: el historial registra únicamente diferencias reales.
    const cambios: CambiosCredito = {};
    if (tipo !== credito.tipoCredito) cambios.tipoCredito = tipo;
    if (pago !== credito.formaPago) cambios.formaPago = pago;
    if (aNumero(valor) !== credito.valorSolicitado) cambios.valorSolicitado = aNumero(valor);
    if (aNumero(tasa) !== credito.tasaInteres) cambios.tasaInteres = aNumero(tasa);
    if (aNumero(cuotas) !== credito.numeroCuotas) cambios.numeroCuotas = aNumero(cuotas);
    if (Object.keys(cambios).length === 0) {
      setErrorGeneral('No hay cambios para guardar.');
      return;
    }
    setEnviando(true);
    try {
      const c = await api.actualizar(credito.id, cambios);
      avisar('Condiciones actualizadas');
      onGuardado(c);
    } catch (ex) {
      if (ex instanceof ApiError) {
        const m: Record<string, string> = {};
        for (const d of ex.details) if (d.campo) m[d.campo] = d.mensaje;
        setErrores(m);
      }
      setErrorGeneral(mensajeDeError(ex));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="formulario formulario-inline" onSubmit={enviar} noValidate>
      <h2>Modificar condiciones</h2>
      <p className="sub">El asociado y la fecha de solicitud no se pueden modificar. Cada cambio queda en el historial.</p>
      {errorGeneral && <p className="alerta alerta-error" role="alert">{errorGeneral}</p>}
      <div className="rejilla">
        <Campo id="e-tipo" etiqueta="Tipo de crédito">
          {(p) => <select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCredito)}>{TIPOS_CREDITO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}</select>}
        </Campo>
        <Campo id="e-pago" etiqueta="Forma de pago">
          {(p) => <select {...p} value={pago} onChange={(e) => setPago(e.target.value as FormaPago)}>{FORMAS_PAGO.map((t) => <option key={t} value={t}>{ETIQUETA_PAGO[t]}</option>)}</select>}
        </Campo>
        <Campo id="e-valor" etiqueta="Valor solicitado (COP)" error={errores['valorSolicitado']}>
          {(p) => <input {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
        </Campo>
        <Campo id="e-tasa" etiqueta="Tasa mensual (%)" error={errores['tasaInteres']}>
          {(p) => <input {...p} inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} />}
        </Campo>
        <Campo id="e-cuotas" etiqueta="Número de cuotas" error={errores['numeroCuotas']}>
          {(p) => <input {...p} inputMode="numeric" value={cuotas} onChange={(e) => setCuotas(e.target.value)} />}
        </Campo>
      </div>
      <div className="acciones">
        <button className="btn btn-pri" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar cambios'}</button>
        <button type="button" className="btn btn-sec" onClick={onCancelar}>Descartar</button>
      </div>
    </form>
  );
}

function Notificaciones({ creditoId }: { creditoId: number }) {
  const { datos, error } = useCarga(() => api.notificaciones({ page: 1, pageSize: 20, creditoId }), [creditoId]);
  return (
    <section className="panel" aria-labelledby="h-wh">
      <div className="panel-cab">
        <h2 id="h-wh">Notificación al sistema externo</h2>
        <Link to="/notificaciones" className="btn btn-txt">Ver todas</Link>
      </div>
      {error && <p className="alerta alerta-error" role="alert">{error}</p>}
      {datos?.items.length === 0 && <p className="vacio">No hay notificaciones para este crédito.</p>}
      <ul className="lista-simple">
        {datos?.items.map((n) => (
          <li key={n.id}>
            <EstadoWh estado={n.estado} />
            <span>{n.evento} · {n.intentos} {n.intentos === 1 ? 'intento' : 'intentos'}{n.ultimoCodigoHttp ? ` · HTTP ${n.ultimoCodigoHttp}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Detalle() {
  const { id: idTxt } = useParams();
  const id = Number(idTxt);
  const { usuario } = useAuth();
  const nav = useNavigate();
  const avisar = useAviso();
  const credito = useCarga(() => api.obtener(id), [id]);
  const historial = useCarga(() => api.historial(id), [id]);
  const [editando, setEditando] = useState(false);
  const [destino, setDestino] = useState<Estado>();
  const [motivo, setMotivo] = useState('');
  const [errorDialogo, setErrorDialogo] = useState<string>();
  const [trabajando, setTrabajando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  if (!Number.isInteger(id) || id < 1) return <p className="alerta alerta-error">El identificador del crédito no es válido.</p>;
  if (credito.error && !credito.datos) {
    return (
      <>
        <p className="alerta alerta-error" role="alert">{credito.error}</p>
        <Link className="btn btn-sec" to="/creditos">Volver al listado</Link>
      </>
    );
  }
  const c = credito.datos;
  if (!c || !usuario) return <p className="cargando">Cargando crédito…</p>;

  const salidas = transicionesPermitidas(c.estado, usuario.rol);
  const bloqueadoPorRol = !esFinal(c.estado) && salidas.length < (transicionesPermitidas(c.estado, 'ADMIN').length);
  const cuota = cuotaEstimada(c.valorSolicitado, c.tasaInteres, c.numeroCuotas);
  const motivoObligatorio = destino ? exigeMotivo(destino) : false;

  const refrescar = () => { credito.recargar(); historial.recargar(); };

  const confirmarEstado = async (e: FormEvent) => {
    e.preventDefault();
    if (!destino) return;
    if (motivoObligatorio && motivo.trim().length === 0) {
      setErrorDialogo('Escribe el motivo: queda registrado en el historial.');
      return;
    }
    setTrabajando(true);
    setErrorDialogo(undefined);
    try {
      await api.cambiarEstado(c.id, destino, motivo.trim() || undefined);
      avisar(`Crédito ${c.numeroCredito}: ${ETIQUETA_ESTADO[destino].toLowerCase()}`);
      setDestino(undefined);
      setMotivo('');
      refrescar();
    } catch (ex) {
      setErrorDialogo(mensajeDeError(ex));
      if (ex instanceof ApiError && ex.status === 409) refrescar(); // otro usuario pudo cambiarlo antes
    } finally {
      setTrabajando(false);
    }
  };

  const confirmarEliminar = async (e: FormEvent) => {
    e.preventDefault();
    setTrabajando(true);
    setErrorDialogo(undefined);
    try {
      await api.eliminar(c.id, motivo.trim() || undefined);
      avisar(`Crédito ${c.numeroCredito} eliminado`);
      nav('/creditos');
    } catch (ex) {
      setErrorDialogo(mensajeDeError(ex));
    } finally {
      setTrabajando(false);
    }
  };

  const cerrarDialogos = () => { setDestino(undefined); setEliminando(false); setMotivo(''); setErrorDialogo(undefined); };

  return (
    <>
      <nav aria-label="Ruta" className="migas"><Link to="/creditos">Créditos</Link> / {c.numeroCredito}</nav>
      <header className="cabecera">
        <div>
          <h1>{c.nombreAsociado}</h1>
          <p className="sub sub-tight">{c.numeroCredito} · C.C. {c.identificacionAsociado}</p>
        </div>
        <EstadoBadge estado={c.estado} />
      </header>

      <div className="detalle-rejilla">
        <div className="detalle-col">
          <section className="panel" aria-labelledby="h-datos">
            <div className="panel-cab">
              <h2 id="h-datos">Condiciones</h2>
              {puedeEditar(c.estado) && !editando && <button className="btn btn-sec" onClick={() => setEditando(true)}>Modificar</button>}
            </div>
            {editando ? (
              <Edicion credito={c} onCancelar={() => setEditando(false)} onGuardado={() => { setEditando(false); refrescar(); }} />
            ) : (
              <dl className="datos">
                <div><dt>Valor solicitado</dt><dd className="num dato-grande">{formatoMoneda(c.valorSolicitado)}</dd></div>
                <div><dt>Tipo de crédito</dt><dd>{ETIQUETA_TIPO[c.tipoCredito]}</dd></div>
                <div><dt>Tasa de interés</dt><dd className="num">{formatoTasa(c.tasaInteres)}</dd></div>
                <div><dt>Cuotas</dt><dd className="num">{c.numeroCuotas}</dd></div>
                <div><dt>Forma de pago</dt><dd>{ETIQUETA_PAGO[c.formaPago]}</dd></div>
                {cuota !== null && <div><dt>Cuota mensual estimada</dt><dd className="num">{formatoMoneda(Math.round(cuota))}</dd></div>}
                <div><dt>Solicitud</dt><dd>{formatoFechaHora(c.fechaSolicitud)}</dd></div>
                <div><dt>Última actualización</dt><dd>{formatoFechaHora(c.fechaActualizacion)}</dd></div>
              </dl>
            )}
          </section>

          <section className="panel" aria-labelledby="h-acc">
            <h2 id="h-acc">Acciones</h2>
            {esFinal(c.estado) ? (
              <p className="nota">Este crédito está en un estado final ({ETIQUETA_ESTADO[c.estado].toLowerCase()}): ya no admite cambios de estado.</p>
            ) : (
              <div className="acciones">
                {salidas.map((s) => (
                  <button key={s} className={`btn ${s === 'RECHAZADO' || s === 'CANCELADO' ? 'btn-peligro-sec' : 'btn-pri'}`} onClick={() => { setErrorDialogo(undefined); setDestino(s); }}>
                    {ACCION_ESTADO[s]}
                  </button>
                ))}
              </div>
            )}
            {bloqueadoPorRol && <p className="nota">Aprobar, rechazar y desembolsar son decisiones del administrador.</p>}
            {puedeEliminar(c.estado, usuario.rol) && (
              <div className="zona-peligro">
                <button className="btn btn-peligro" onClick={() => { setErrorDialogo(undefined); setEliminando(true); }}>Eliminar solicitud</button>
                <p className="nota">Es un borrado lógico: deja de mostrarse pero queda en el historial.</p>
              </div>
            )}
          </section>

          {usuario.rol === 'ADMIN' && <Notificaciones creditoId={c.id} />}
        </div>

        <section className="panel" aria-labelledby="h-hist">
          <h2 id="h-hist">Historial</h2>
          {historial.error && <p className="alerta alerta-error" role="alert">{historial.error}</p>}
          {historial.datos && <Historial items={[...historial.datos].sort((a, b) => b.id - a.id)} />}
        </section>
      </div>

      <Dialogo abierto={destino !== undefined} titulo={destino ? `${ACCION_ESTADO[destino]}: ${c.numeroCredito}` : ''} onCerrar={cerrarDialogos}>
        <form onSubmit={confirmarEstado} noValidate>
          <p>El crédito pasará de <strong>{ETIQUETA_ESTADO[c.estado]}</strong> a <strong>{destino ? ETIQUETA_ESTADO[destino] : ''}</strong>.</p>
          {errorDialogo && <p className="alerta alerta-error" role="alert">{errorDialogo}</p>}
          <Campo id="d-motivo" etiqueta={motivoObligatorio ? 'Motivo (obligatorio)' : 'Observación (opcional)'}>
            {(p) => <textarea {...p} rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
          <div className="acciones">
            <button className={`btn ${destino && exigeMotivo(destino) ? 'btn-peligro' : 'btn-pri'}`} disabled={trabajando}>{trabajando ? 'Guardando…' : destino ? ACCION_ESTADO[destino] : ''}</button>
            <button type="button" className="btn btn-sec" onClick={cerrarDialogos}>Volver</button>
          </div>
        </form>
      </Dialogo>

      <Dialogo abierto={eliminando} titulo={`Eliminar ${c.numeroCredito}`} onCerrar={cerrarDialogos}>
        <form onSubmit={confirmarEliminar}>
          <p>La solicitud de <strong>{c.nombreAsociado}</strong> dejará de aparecer en los listados.</p>
          {errorDialogo && <p className="alerta alerta-error" role="alert">{errorDialogo}</p>}
          <Campo id="d-motivo-el" etiqueta="Motivo (opcional)">
            {(p) => <textarea {...p} rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
          <div className="acciones">
            <button className="btn btn-peligro" disabled={trabajando}>{trabajando ? 'Eliminando…' : 'Eliminar solicitud'}</button>
            <button type="button" className="btn btn-sec" onClick={cerrarDialogos}>Volver</button>
          </div>
        </form>
      </Dialogo>
    </>
  );
}
