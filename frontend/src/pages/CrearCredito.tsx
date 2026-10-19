import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Campo } from '../components/Campo';
import { useAviso } from '../components/Toast';
import { ApiError, api, mensajeDeError } from '../lib/api';
import { ETIQUETA_PAGO, ETIQUETA_TIPO } from '../lib/estados';
import { cuotaEstimada, formatoMoneda } from '../lib/format';
import { FORMAS_PAGO, TIPOS_CREDITO, type FormaPago, type NuevoCredito, type TipoCredito } from '../lib/tipos';
import {
  aNumero, validarCuotas, validarIdentificacion, validarNombre, validarTasa, validarValor, type Errores,
} from '../lib/validation';

interface Form {
  identificacionAsociado: string;
  nombreAsociado: string;
  tipoCredito: TipoCredito | '';
  valorSolicitado: string;
  tasaInteres: string;
  numeroCuotas: string;
  formaPago: FormaPago | '';
}
const VACIO: Form = { identificacionAsociado: '', nombreAsociado: '', tipoCredito: '', valorSolicitado: '', tasaInteres: '', numeroCuotas: '', formaPago: '' };

function validar(f: Form): Errores {
  const e: Errores = {};
  const set = <K extends keyof Errores>(k: K, v: string | undefined) => { if (v) e[k] = v; };
  set('identificacionAsociado', validarIdentificacion(f.identificacionAsociado));
  set('nombreAsociado', validarNombre(f.nombreAsociado));
  if (!f.tipoCredito) e.tipoCredito = 'Elige el tipo de crédito';
  set('valorSolicitado', validarValor(f.valorSolicitado));
  set('tasaInteres', validarTasa(f.tasaInteres));
  set('numeroCuotas', validarCuotas(f.numeroCuotas));
  if (!f.formaPago) e.formaPago = 'Elige la forma de pago';
  return e;
}

export function CrearCredito() {
  const nav = useNavigate();
  const avisar = useAviso();
  const [f, setF] = useState<Form>(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string>();
  const [existente, setExistente] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const poner = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((a) => ({ ...a, [k]: v }));
    if (errores[k]) setErrores((e) => ({ ...e, [k]: undefined }));
  };

  const cuota = cuotaEstimada(aNumero(f.valorSolicitado), aNumero(f.tasaInteres), aNumero(f.numeroCuotas));

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    setErrorGeneral(undefined);
    setExistente(false);
    const e = validar(f);
    setErrores(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`c-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    const cuerpo: NuevoCredito = {
      identificacionAsociado: f.identificacionAsociado.trim(),
      nombreAsociado: f.nombreAsociado.trim(),
      tipoCredito: f.tipoCredito as TipoCredito,
      valorSolicitado: aNumero(f.valorSolicitado),
      tasaInteres: aNumero(f.tasaInteres),
      numeroCuotas: aNumero(f.numeroCuotas),
      formaPago: f.formaPago as FormaPago,
    };
    setEnviando(true);
    try {
      const c = await api.crear(cuerpo);
      avisar(`Solicitud ${c.numeroCredito} creada`);
      nav(`/creditos/${c.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details.length > 0) {
        // Errores del servidor por campo (400/422): se muestran junto al campo correspondiente.
        const porCampo: Errores = {};
        for (const d of err.details) if (d.campo && d.campo in VACIO) porCampo[d.campo as keyof Errores] = d.mensaje;
        setErrores(porCampo);
      }
      setExistente(err instanceof ApiError && err.code === 'CREDITO_DUPLICADO');
      setErrorGeneral(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <header className="cabecera">
        <h1>Nueva solicitud de crédito</h1>
      </header>
      <form className="formulario" onSubmit={enviar} noValidate>
        {errorGeneral && (
          <p className="alerta alerta-error" role="alert">
            {errorGeneral}
            {existente && <>. Revisa la lista de <Link to={`/creditos?identificacion=${encodeURIComponent(f.identificacionAsociado.trim())}`}>créditos de este asociado</Link>.</>}
          </p>
        )}

        <fieldset>
          <legend>Asociado</legend>
          <div className="rejilla">
            <Campo id="c-identificacionAsociado" etiqueta="Identificación" ayuda="Entre 5 y 15 dígitos" error={errores.identificacionAsociado}>
              {(p) => <input {...p} inputMode="numeric" autoComplete="off" value={f.identificacionAsociado} onChange={(e) => poner('identificacionAsociado', e.target.value.replace(/[^\d]/g, ''))} />}
            </Campo>
            <Campo id="c-nombreAsociado" etiqueta="Nombre completo" error={errores.nombreAsociado}>
              {(p) => <input {...p} autoComplete="off" value={f.nombreAsociado} onChange={(e) => poner('nombreAsociado', e.target.value)} />}
            </Campo>
          </div>
        </fieldset>

        <fieldset>
          <legend>Condiciones del crédito</legend>
          <div className="rejilla">
            <Campo id="c-tipoCredito" etiqueta="Tipo de crédito" error={errores.tipoCredito}>
              {(p) => (
                <select {...p} value={f.tipoCredito} onChange={(e) => poner('tipoCredito', e.target.value as TipoCredito)}>
                  <option value="">Selecciona…</option>
                  {TIPOS_CREDITO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
                </select>
              )}
            </Campo>
            <Campo id="c-formaPago" etiqueta="Forma de pago" error={errores.formaPago}>
              {(p) => (
                <select {...p} value={f.formaPago} onChange={(e) => poner('formaPago', e.target.value as FormaPago)}>
                  <option value="">Selecciona…</option>
                  {FORMAS_PAGO.map((t) => <option key={t} value={t}>{ETIQUETA_PAGO[t]}</option>)}
                </select>
              )}
            </Campo>
            <Campo id="c-valorSolicitado" etiqueta="Valor solicitado (COP)" ayuda="Ej. 15000000" error={errores.valorSolicitado}>
              {(p) => <input {...p} inputMode="decimal" autoComplete="off" value={f.valorSolicitado} onChange={(e) => poner('valorSolicitado', e.target.value)} />}
            </Campo>
            <Campo id="c-tasaInteres" etiqueta="Tasa de interés mensual (%)" ayuda="Ej. 1,5" error={errores.tasaInteres}>
              {(p) => <input {...p} inputMode="decimal" autoComplete="off" value={f.tasaInteres} onChange={(e) => poner('tasaInteres', e.target.value)} />}
            </Campo>
            <Campo id="c-numeroCuotas" etiqueta="Número de cuotas" ayuda="Hasta 360" error={errores.numeroCuotas}>
              {(p) => <input {...p} inputMode="numeric" autoComplete="off" value={f.numeroCuotas} onChange={(e) => poner('numeroCuotas', e.target.value)} />}
            </Campo>
          </div>
          {cuota !== null && (
            <p className="estimado" aria-live="polite">
              Cuota mensual estimada: <strong className="num">{formatoMoneda(Math.round(cuota))}</strong>
              <span> · cálculo orientativo, no se guarda</span>
            </p>
          )}
        </fieldset>

        <div className="acciones">
          <button className="btn btn-pri" disabled={enviando}>{enviando ? 'Guardando…' : 'Crear solicitud'}</button>
          <Link className="btn btn-sec" to="/creditos">Cancelar</Link>
        </div>
      </form>
    </>
  );
}
