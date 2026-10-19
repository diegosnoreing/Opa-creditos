import type {
  CambiosCredito, Credito, Estado, Filtros, HistorialItem, Meta, NuevoCredito, Notificacion, Resumen, Usuario,
} from './tipos';

const CLAVE = 'opa.sesion';

export interface Sesion {
  token: string;
  usuario: Usuario;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Array<{ campo?: string; mensaje: string }> = [],
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export const leerSesion = (): Sesion | null => {
  try {
    const raw = sessionStorage.getItem(CLAVE);
    return raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    return null;
  }
};
export const guardarSesion = (s: Sesion | null): void => {
  try {
    if (s) sessionStorage.setItem(CLAVE, JSON.stringify(s));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: la sesión vive solo en memoria */
  }
};

let alExpirarSesion: (() => void) | undefined;
export const registrarExpiracion = (fn: () => void): void => {
  alExpirarSesion = fn;
};

interface Respuesta<T> {
  data: T;
  meta?: Meta;
}

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, conAuth = true): Promise<Respuesta<T>> {
  const headers: Record<string, string> = {};
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  const sesion = leerSesion();
  if (conAuth && sesion) headers['Authorization'] = `Bearer ${sesion.token}`;

  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  } catch {
    throw new ApiError(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Revisa que la API esté en marcha.');
  }

  let json: { success?: boolean; data?: T; meta?: Meta; error?: { code: string; message: string; details?: Array<{ campo?: string; mensaje: string }>; requestId?: string } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* cuerpo vacío o no JSON */
  }

  if (!res.ok || !json || json.success === false) {
    const e = json?.error;
    if (res.status === 401 && conAuth) alExpirarSesion?.();
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Error inesperado (${res.status})`, e?.details ?? [], e?.requestId);
  }
  return json.data === undefined ? { data: undefined as T } : { data: json.data, ...(json.meta && { meta: json.meta }) };
}

const qs = (obj: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: async (username: string, password: string): Promise<Sesion> => {
    const { data } = await pedir<{ token: string; usuario: Usuario }>('POST', '/auth/login', { username, password }, false);
    return { token: data.token, usuario: data.usuario };
  },
  resumen: async () => (await pedir<Resumen>('GET', '/creditos/resumen')).data,
  listar: async (f: Filtros) => {
    const r = await pedir<Credito[]>(
      'GET',
      `/creditos${qs({ page: f.page, pageSize: f.pageSize, estado: f.estado, tipoCredito: f.tipoCredito, identificacion: f.identificacion, q: f.q, sortBy: f.sortBy, sortDir: f.sortDir })}`,
    );
    return { items: r.data, meta: r.meta as Meta };
  },
  obtener: async (id: number) => (await pedir<Credito>('GET', `/creditos/${id}`)).data,
  historial: async (id: number) => (await pedir<HistorialItem[]>('GET', `/creditos/${id}/historial`)).data,
  crear: async (c: NuevoCredito) => (await pedir<Credito>('POST', '/creditos', c)).data,
  actualizar: async (id: number, cambios: CambiosCredito) => (await pedir<Credito>('PATCH', `/creditos/${id}`, cambios)).data,
  cambiarEstado: async (id: number, estado: Estado, observacion?: string) =>
    (await pedir<Credito>('PATCH', `/creditos/${id}/estado`, { estado, ...(observacion && { observacion }) })).data,
  eliminar: async (id: number, observacion?: string) => {
    await pedir('DELETE', `/creditos/${id}${qs({ observacion })}`);
  },
  notificaciones: async (p: { page: number; pageSize: number; estado?: string; creditoId?: number }) => {
    const r = await pedir<Notificacion[]>('GET', `/webhooks/notificaciones${qs(p)}`);
    return { items: r.data, meta: r.meta as Meta };
  },
  notificacion: async (id: number) => (await pedir<Notificacion>('GET', `/webhooks/notificaciones/${id}`)).data,
  reintentar: async (id: number) => (await pedir<{ id: number; estado: string }>('POST', `/webhooks/notificaciones/${id}/reintentar`)).data,
};

/** Mensaje legible para mostrar al usuario. */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado';
}
