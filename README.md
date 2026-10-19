# Módulo de créditos — Prueba técnica OPA SAS

API REST para administrar solicitudes de crédito de asociados de una entidad del sector financiero solidario, con SQL Server, autenticación JWT, auditoría de cambios y notificación a un sistema externo mediante webhook (patrón *Transactional Outbox*).

> **Estado:** backend, base de datos, frontend web, pruebas, Swagger y documentación **completos**. Pendiente de su parte: ejecutar el proyecto contra SQL Server real (ver sección 11) y validar `docker compose up` en su equipo.

## Contenido

1. [Qué incluye](#1-qué-incluye)
2. [Requisitos](#2-requisitos)
3. [Instalación y ejecución con Docker (recomendado)](#3-instalación-y-ejecución-con-docker-recomendado)
4. [Ejecución sin Docker](#4-ejecución-sin-docker)
5. [Probar la API](#5-probar-la-api)
6. [Referencia de la API](#6-referencia-de-la-api)
7. [Probar el webhook](#7-probar-el-webhook)
8. [Pruebas automatizadas](#8-pruebas-automatizadas)
9. [Variables de entorno](#9-variables-de-entorno)
10. [Estructura del proyecto](#10-estructura-del-proyecto)
11. [Verificación: qué está probado y qué no](#11-verificación-qué-está-probado-y-qué-no)
12. [Solución de problemas](#12-solución-de-problemas)
13. [Documentación](#13-documentación)

---

## 1. Qué incluye

| Requisito del enunciado | Dónde está |
|---|---|
| API REST (CRUD de créditos, cambio de estado, paginación, filtros, orden, búsqueda) | `backend/src/http` |
| SQL Server (Asociados, Creditos, HistorialCredito + outbox y usuarios) | `database/01_schema.sql` |
| Reglas de negocio (valor, tasa, cuotas, duplicados, transiciones de estado, permisos) | `backend/src/services`, `backend/src/domain` |
| Webhook con reutilización de la lógica de creación y traza de envíos | `backend/src/services/webhookDispatcher.ts` |
| Seguridad (JWT, roles, bcrypt, Helmet, CORS, rate limit, HMAC, validación) | `docs/decisiones-tecnicas.md` |
| Manejo consistente de errores | `{ "success": false, "error": { "code", "message" } }` |
| Auditoría / historial de cambios | `GET /api/creditos/{id}/historial` |
| Swagger / OpenAPI | `http://localhost:3000/api/docs` |
| Pruebas automatizadas | `backend/tests` (144 pruebas) |
| Docker Compose | `docker-compose.yml` |
| `.env.example` | raíz del proyecto |
| Diagramas y decisiones técnicas | `docs/` |
| Frontend web (React + TypeScript + Vite): ingreso, resumen, listado con filtros, crear, detalle, cambio de estado, historial y notificaciones | `frontend/` |

## 2. Requisitos

**Con Docker (recomendado):**
- Docker Desktop (Windows/Mac) o Docker Engine + Compose v2 (Linux).
- ~2 GB de RAM libres para el contenedor de SQL Server.

**Sin Docker:**
- Node.js **20 o superior** (probado con 22) y npm.
- SQL Server 2019+ (Developer o Express, gratuitos) y SSMS o `sqlcmd` para cargar el esquema.

## 3. Instalación y ejecución con Docker (recomendado)

Desde la carpeta raíz del proyecto (donde está `docker-compose.yml`):

**1. Crear el archivo `.env`**

```bash
# Linux / Mac
cp .env.example .env
```
```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

**2. Editar `.env`** y cambiar al menos estos valores (el archivo `.env.example` explica cada uno):

| Variable | Qué poner |
|---|---|
| `DB_PASSWORD` | Clave del usuario `sa`. SQL Server exige mínimo 8 caracteres con mayúsculas, minúsculas, números y símbolos. |
| `JWT_SECRET` | Texto largo y aleatorio. Para generar uno: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SEED_ADMIN_PASSWORD` | Clave inicial del usuario `admin`. |
| `SEED_ANALISTA_PASSWORD` | Clave inicial del usuario `analista`. |
| `WEBHOOK_SECRET` | Secreto compartido para firmar el webhook (mínimo 16 caracteres). |

**3. Levantar todo**

```bash
docker compose up --build
```

Esto, en orden: arranca SQL Server → ejecuta `database/01_schema.sql` una sola vez (contenedor `db-init`, termina solo) → arranca la API → construye y arranca el frontend (nginx).
La primera vez tarda unos minutos (descarga las imágenes).

**4. Comprobar que está arriba**

- **Aplicación web:** <http://localhost:5173> (ingrese con `admin` o `analista` y las claves del `.env`)
- Salud: <http://localhost:3000/health> → `{"status":"ok",...}`
- Base de datos: <http://localhost:3000/health/ready> → `{"status":"ready"}`
- **Swagger:** <http://localhost:3000/api/docs>

**Comandos útiles**

```bash
docker compose up -d --build        # en segundo plano
docker compose logs -f backend      # ver logs de la API
docker compose down                 # detener (conserva los datos)
docker compose down -v              # detener y BORRAR la base de datos
```

Los usuarios `admin` y `analista` se crean automáticamente **solo si la tabla `Usuarios` está vacía**, con las claves `SEED_*` del `.env`.

## 4. Ejecución sin Docker

**1. Crear la base de datos.** Con SSMS: conectarse a su servidor, abrir `database/01_schema.sql` y ejecutarlo completo (F5). Crea la base `OpaCreditos` y todas las tablas; se puede ejecutar varias veces sin problema.
Con `sqlcmd`:

```bash
sqlcmd -S localhost -U sa -P "<su_clave>" -C -I -i database/01_schema.sql
```

> `-I` (QUOTED_IDENTIFIER) es **necesario**: los índices filtrados fallan sin él.

**2. Configurar variables.** La API lee el `.env` desde la carpeta `backend/`:

```bash
cp .env.example backend/.env        # Windows: Copy-Item .env.example backend\.env
```

Editar `backend/.env`: `DB_HOST=localhost`, `DB_PASSWORD`, y las demás claves como en la sección 3.
Si usa SQL Server Express con instancia con nombre o autenticación de Windows, ajuste `DB_HOST`/`DB_USER` (la API usa usuario y clave de SQL Server).

**3. Instalar y arrancar**

```bash
cd backend
npm ci
npm run dev          # desarrollo, con recarga automática
# o producción:
npm run build && npm start
```

API en <http://localhost:3000> y Swagger en <http://localhost:3000/api/docs>.
El worker del webhook corre dentro de la API (`WORKER_EMBEDDED=true`). Para ejecutarlo como proceso aparte: `WORKER_EMBEDDED=false` en la API y, en otra terminal, `npm run worker`.

## 4b. Frontend web

Interfaz en español para el personal de crédito. Habla con la API a través de `/api` (en desarrollo lo reenvía Vite; con Docker lo reenvía nginx), así que no hay CORS ni URLs que configurar.

| Pantalla | Qué hace |
|---|---|
| Ingreso | Autenticación con JWT. El token vive solo en `sessionStorage` (se borra al cerrar la pestaña); si vence, vuelve al ingreso con un aviso. |
| Resumen | Valor total, pendientes y aprobadas, distribución por estado (con vista de tabla) y últimas solicitudes. |
| Créditos | Búsqueda por nombre/número, filtros por identificación, estado y tipo, orden por columna y paginación. Los filtros viven en la URL: se pueden compartir y el botón "atrás" funciona. |
| Nueva solicitud | Validación en el navegador (mismas reglas del backend) y, si el servidor rechaza algo, el error aparece junto al campo. Muestra una cuota mensual estimada orientativa. |
| Detalle | Condiciones, **cambio de estado** (solo muestra las transiciones válidas para su rol; rechazar/cancelar exige motivo), modificación, eliminación lógica (ADMIN) e **historial** con los valores antes/después. El ADMIN también ve las notificaciones de ese crédito. |
| Notificaciones (ADMIN) | Estado de cada webhook, detalle de intentos y botón para reenviar los fallidos. |

**Sin Docker ni SQL Server (para ver la interfaz rápido).** El backend trae un modo en memoria con 8 créditos de ejemplo; los datos se pierden al detenerlo:

```bash
# Terminal 1
cd backend && npm ci && npm run dev:memoria     # API en :3000 (admin / Admin_12345, analista / Analista_12345)
# Terminal 2
cd frontend && npm ci && npm run dev            # interfaz en http://localhost:5173
```

Con la API real (SQL Server), use en la terminal 1 `npm run dev` como en la sección 4.

**Comandos del frontend:** `npm run dev` (desarrollo), `npm run build` (producción, revisa tipos), `npm test` (19 pruebas de validación y reglas de estado).

> Las reglas de transición y permisos se **repiten** en `frontend/src/lib/estados.ts` solo para mostrar u ocultar botones. La autoridad es siempre el backend: si se desincronizaran, la API responde 403/409 y la pantalla muestra ese mensaje.

## 5. Probar la API

### Opción A: Swagger (la más fácil)

1. Abrir <http://localhost:3000/api/docs>.
2. En `POST /api/auth/login`: **Try it out** → usuario `admin` y la clave de `SEED_ADMIN_PASSWORD` → **Execute**.
3. Copiar el valor de `data.token`.
4. Botón **Authorize** (arriba a la derecha) → pegar el token → **Authorize**.
5. Probar cualquier endpoint.

### Opción B: línea de comandos

```bash
# 1) Iniciar sesión y guardar el token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<SEED_ADMIN_PASSWORD>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")

# 2) Crear un crédito (ejemplo del enunciado)
curl -s -X POST http://localhost:3000/api/creditos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"identificacionAsociado":"1001234567","nombreAsociado":"Juan Perez","tipoCredito":"LIBRE_INVERSION","valorSolicitado":15000000,"tasaInteres":1.5,"numeroCuotas":36,"formaPago":"NOMINA"}'

# 3) Listar con filtros y paginación
curl -s "http://localhost:3000/api/creditos?estado=SOLICITADO&page=1&pageSize=10&sortBy=valorSolicitado&sortDir=desc" \
  -H "Authorization: Bearer $TOKEN"

# 4) Pasar a EN_ESTUDIO
curl -s -X PATCH http://localhost:3000/api/creditos/1/estado \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"estado":"EN_ESTUDIO","observacion":"Documentos completos"}'

# 5) Ver el historial
curl -s http://localhost:3000/api/creditos/1/historial -H "Authorization: Bearer $TOKEN"
```

**PowerShell (Windows):**

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' `
  -Body '{"username":"admin","password":"<SEED_ADMIN_PASSWORD>"}'
$h = @{ Authorization = "Bearer $($login.data.token)" }

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/creditos -Headers $h `
  -ContentType 'application/json' `
  -Body '{"identificacionAsociado":"1001234567","nombreAsociado":"Juan Perez","tipoCredito":"LIBRE_INVERSION","valorSolicitado":15000000,"tasaInteres":1.5,"numeroCuotas":36,"formaPago":"NOMINA"}'

Invoke-RestMethod -Uri "http://localhost:3000/api/creditos?page=1&pageSize=10" -Headers $h
```

### Usuarios y permisos

| Usuario | Rol | Puede |
|---|---|---|
| `admin` | ADMIN | Todo: aprobar, rechazar, desembolsar, eliminar, ver notificaciones del webhook. |
| `analista` | ANALISTA | Crear, consultar, editar, pasar a EN_ESTUDIO y cancelar. **No** aprueba, rechaza, desembolsa ni elimina (devuelve 403). |

## 6. Referencia de la API

Todas las rutas `/api/*` (salvo login) requieren `Authorization: Bearer <token>`.
Respuestas correctas: `{ "success": true, "data": ... }` (los listados añaden `meta` con `page`, `pageSize`, `total`, `totalPages`).

| Método | Ruta | Descripción | Rol |
|---|---|---|---|
| POST | `/api/auth/login` | Iniciar sesión; devuelve el JWT | público |
| POST | `/api/creditos` | Crear crédito (**201** + `Location`) | ambos |
| GET | `/api/creditos` | Listar (paginación, filtros, búsqueda, orden) | ambos |
| GET | `/api/creditos/resumen` | Dashboard: total, valor total y cantidad por estado | ambos |
| GET | `/api/creditos/{id}` | Consultar un crédito | ambos |
| GET | `/api/creditos/{id}/historial` | Historial de cambios | ambos |
| PATCH | `/api/creditos/{id}` | Actualizar condiciones (solo en SOLICITADO / EN_ESTUDIO) | ambos |
| PATCH | `/api/creditos/{id}/estado` | Cambiar estado (`estado`, `observacion`) | según estado destino |
| DELETE | `/api/creditos/{id}?observacion=` | Borrado lógico | ADMIN |
| GET | `/api/webhooks/notificaciones` | Traza de notificaciones (`estado`, `creditoId`, paginación) | ADMIN |
| GET | `/api/webhooks/notificaciones/{id}` | Detalle e intentos de una notificación | ADMIN |
| POST | `/api/webhooks/notificaciones/{id}/reintentar` | Reencolar una notificación FALLIDA | ADMIN |
| POST | `/api/webhooks/demo-receptor` | Receptor de demostración del webhook (firma HMAC) | firma |
| GET | `/api/webhooks/demo-receptor/recibidos` | Eventos recibidos por el receptor de demostración | ADMIN |
| GET | `/health` · `/health/ready` | Liveness · readiness (consulta la base) | público |
| GET | `/api/docs` · `/api/docs.json` | Swagger UI · especificación OpenAPI | público |

> El enunciado admite `PUT` o `PATCH` para actualizar; se implementó **PATCH** (actualización parcial).

**Parámetros de `GET /api/creditos`:**

| Parámetro | Valores | Por defecto |
|---|---|---|
| `page` | entero ≥ 1 | `1` |
| `pageSize` | 1 a 100 | `10` |
| `estado` | `SOLICITADO`, `EN_ESTUDIO`, `APROBADO`, `RECHAZADO`, `DESEMBOLSADO`, `CANCELADO` | — |
| `identificacion` | documento exacto (solo dígitos) | — |
| `tipoCredito` | `LIBRE_INVERSION`, `VIVIENDA`, `VEHICULO`, `EDUCACION`, `CALAMIDAD` | — |
| `q` | texto: busca en número de crédito, nombre e identificación | — |
| `sortBy` | `fechaSolicitud`, `valorSolicitado`, `estado`, `numeroCredito`, `nombreAsociado` | `fechaSolicitud` |
| `sortDir` | `asc`, `desc` | `desc` |

**Campos al crear:** `identificacionAsociado` (5–15 dígitos), `nombreAsociado`, `tipoCredito`, `valorSolicitado` (> 0, 2 decimales), `tasaInteres` (≥ 0), `numeroCuotas` (entero > 0, máx. 360), `formaPago` (`NOMINA`, `CAJA`, `DEBITO_AUTOMATICO`, `PSE`). Cualquier otro campo se rechaza.

**Códigos de error** (todos con el formato `{ success:false, error:{ code, message, details?, requestId } }`):

| HTTP | Significado | `code` típicos |
|---|---|---|
| 400 | Petición mal formada | `VALIDATION_ERROR`, `JSON_INVALIDO`, `ID_INVALIDO` |
| 401 | Sin sesión, token o firma inválidos | `NO_AUTENTICADO`, `TOKEN_INVALIDO`, `CREDENCIALES_INVALIDAS`, `FIRMA_INVALIDA` |
| 403 | Sin permiso | `PERMISO_DENEGADO` |
| 404 | No existe | `CREDITO_NOT_FOUND`, `NOTIFICACION_NOT_FOUND` |
| 409 | Choca con el estado actual | `CREDITO_DUPLICADO`, `TRANSICION_INVALIDA`, `CREDITO_NO_MODIFICABLE`, `CREDITO_NO_ELIMINABLE` |
| 413 | Cuerpo demasiado grande | `PAYLOAD_DEMASIADO_GRANDE` |
| 422 | Regla de negocio incumplida | `DATOS_CREDITO_INVALIDOS`, `OBSERVACION_REQUERIDA` |
| 429 | Demasiadas peticiones | `DEMASIADAS_PETICIONES` |
| 500 | Error interno (sin detalles internos) | `INTERNAL_ERROR` |

## 7. Probar el webhook

Por defecto `WEBHOOK_URL` apunta al **receptor de demostración** de la propia API, así que el flujo completo funciona sin ningún sistema externo.

1. Iniciar sesión como `admin` y crear un crédito (sección 5).
2. Esperar unos segundos (el worker revisa cada `WEBHOOK_POLL_INTERVAL_MS`, 5 s por defecto).
3. Ver la traza: `GET /api/webhooks/notificaciones` → el evento aparece `ENVIADO`. `GET /api/webhooks/notificaciones/{id}` muestra cada intento con su código HTTP.
4. Ver lo que "recibió" el sistema externo: `GET /api/webhooks/demo-receptor/recibidos`.

**Cuerpo enviado** (el del enunciado), con cabeceras `X-Webhook-Id`, `X-Webhook-Timestamp` y `X-Webhook-Signature` (`sha256=` + HMAC-SHA256 de `timestamp.cuerpo` con `WEBHOOK_SECRET`):

```json
{
  "event": "credito.creado",
  "eventId": "8f7d…",
  "timestamp": "2026-09-07T18:00:00.000Z",
  "data": { "id": 123, "numeroCredito": "CR-2026-000123", "identificacionAsociado": "1001234567", "valorSolicitado": 15000000, "estado": "SOLICITADO" }
}
```

**Simular una falla del sistema externo:** cambie `WEBHOOK_URL` a una dirección que no responda (por ejemplo `http://localhost:9999/x`), reinicie la API y cree un crédito. El evento queda `PENDIENTE` y se reintenta con espera creciente (≈ 30 s, 1 min, 2 min, 4 min, 8 min); tras `WEBHOOK_MAX_ATTEMPTS` (6) pasa a `FALLIDO`. Corrija la URL y use `POST /api/webhooks/notificaciones/{id}/reintentar` para reenviarlo. El crédito nunca se ve afectado.

Para desactivar el envío, deje `WEBHOOK_URL=` vacío: los eventos igual se guardan en el outbox.

## 8. Pruebas automatizadas

No necesitan SQL Server ni Docker (usan persistencia en memoria).

```bash
cd backend
npm ci
npm test                 # 144 pruebas
npm run test:coverage    # con cobertura
npm run typecheck        # solo tipos
```

Cubren: creación, validaciones, consulta inexistente, cambio de estado, transiciones inválidas, duplicados, permisos por rol, borrado lógico, atomicidad (si falla el outbox no queda crédito), seguridad HTTP (JWT, CORS, Helmet, rate limit) y el **webhook** (envío firmado, reintentos, agotamiento, reencolado y flujo completo contra el receptor de demostración).

## 9. Variables de entorno

Plantilla completa y comentada en [`.env.example`](.env.example). Resumen:

| Variable | Descripción | Defecto |
|---|---|---|
| `PORT` | Puerto de la API | `3000` |
| `NODE_ENV` | `development` · `test` · `production` | `development` |
| `LOG_LEVEL` | Nivel de log | `info` |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma | `http://localhost:5173` |
| `TRUST_PROXY` | `true` si hay un proxy/balanceador delante | `false` |
| `DB_HOST` · `DB_PORT` · `DB_NAME` · `DB_USER` | Conexión a SQL Server (con Compose, `DB_HOST` se fuerza a `db`) | `localhost` · `1433` · `OpaCreditos` · `sa` |
| `DB_PASSWORD` | Clave de la base (**obligatoria**) | — |
| `DB_ENCRYPT` · `DB_TRUST_SERVER_CERT` | TLS hacia la base | `false` · `true` |
| `JWT_SECRET` | Secreto del JWT (mín. 16; **32 en producción**) | — |
| `JWT_EXPIRES_IN` | Vigencia del token | `1h` |
| `SEED_ADMIN_PASSWORD` · `SEED_ANALISTA_PASSWORD` | Claves de los usuarios iniciales (mín. 8) | — |
| `WEBHOOK_URL` | Destino del webhook; vacío = no enviar | receptor de demostración |
| `WEBHOOK_SECRET` | Secreto HMAC (mín. 16) | — |
| `WEBHOOK_MAX_ATTEMPTS` | Intentos antes de marcar FALLIDO | `6` |
| `WEBHOOK_TIMEOUT_MS` | Espera máxima por respuesta | `5000` |
| `WEBHOOK_POLL_INTERVAL_MS` | Cada cuánto revisa el worker | `5000` |
| `WEBHOOK_BACKOFF_BASE_MS` · `WEBHOOK_BACKOFF_MAX_MS` | Espera base y tope entre reintentos | `30000` · `3600000` |
| `WEBHOOK_BATCH_SIZE` | Eventos por ciclo | `10` |
| `WORKER_EMBEDDED` | `true`: worker dentro de la API; `false`: proceso aparte | `true` |
| `ENABLE_DEMO_RECEIVER` | Receptor de demostración (por defecto, activo fuera de producción) | — |
| `RATE_LIMIT_WINDOW_MS` · `RATE_LIMIT_MAX` · `LOGIN_RATE_LIMIT_MAX` | Límites de peticiones | `60000` · `100` · `10` |

**Producción** (`NODE_ENV=production`): la API se niega a arrancar si el `JWT_SECRET` tiene menos de 32 caracteres o si algún secreto conserva un valor de ejemplo (`cambiar…`). **Nunca suba `.env` al repositorio** (ya está en `.gitignore`).

## 10. Estructura del proyecto

```
.
├── docker-compose.yml          SQL Server + carga del esquema + API + frontend
├── .env.example                Plantilla de variables (sin secretos reales)
├── database/
│   └── 01_schema.sql           Esquema completo, idempotente
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── http/               Rutas, middlewares, esquemas de petición, OpenAPI
│   │   ├── services/           CreditoService, AuthService, WebhookDispatcher
│   │   ├── domain/             Tipos, máquina de estados, validaciones, errores
│   │   ├── repositories/       Interfaces + implementación SQL Server + implementación en memoria
│   │   ├── config/env.ts       Variables de entorno validadas
│   │   ├── container.ts        Ensamblado de dependencias
│   │   └── server.ts · worker.ts
│   └── tests/                  Pruebas automatizadas
├── docs/                       Documentación técnica (ver abajo)
└── frontend/                   Interfaz web (React + Vite + TypeScript), Dockerfile y nginx.conf
```

## 11. Verificación: qué está probado y qué no

**Verificado en el entorno de desarrollo:**
- Compilación estricta de TypeScript sin errores y *build* de producción.
- 144 pruebas automatizadas pasando (cobertura de líneas ≈ 96 % en lo que no depende de SQL Server).
- Frontend: tipos sin errores, build de producción y 19 pruebas; recorrido completo en un navegador real (Chromium) contra la API en memoria: ingreso, crear con validaciones y duplicado, editar, cambiar estado con motivo, eliminar, notificaciones del webhook, permisos del analista, sesión vencida y vista móvil.
- Sintaxis válida del `docker-compose.yml` (`docker compose config`).
- Dependencias de producción sin vulnerabilidades conocidas (`npm audit --omit=dev`).

**NO verificado todavía — probar primero en su máquina:**
- **El script `database/01_schema.sql` y los repositorios de SQL Server** (`backend/src/repositories/mssql`) **no se han ejecutado contra una instancia real de SQL Server** en este entorno (no había un daemon de Docker disponible). Las pruebas usan la persistencia en memoria, que imita su comportamiento, pero no es lo mismo.
- El arranque completo con `docker compose up --build` (imágenes, healthchecks, carga del esquema) y la imagen del frontend (`frontend/Dockerfile` + nginx): se verificó el frontend con Vite, no dentro del contenedor.

**Lista de comprobación recomendada (5 minutos):**

1. `docker compose up --build` termina sin errores y `db-init` sale con código 0.
2. `GET /health/ready` responde `ready`.
3. Login con `admin`, crear el crédito de ejemplo → **201**.
4. Repetir la misma creación → **409** `CREDITO_DUPLICADO`.
5. Pasar `SOLICITADO → EN_ESTUDIO → RECHAZADO` (con `observacion`) y luego intentar `DESEMBOLSADO` → **409** `TRANSICION_INVALIDA`.
6. `GET /api/creditos/{id}/historial` muestra las 3 entradas.
7. `GET /api/webhooks/notificaciones` muestra el evento `ENVIADO`.
8. En SQL Server: `SELECT * FROM OpaCreditos.dbo.WebhookIntento;` muestra la traza.

Si alguno falla, el mensaje de error de SQL Server indica la línea exacta del script o de la consulta que hay que ajustar.

## 12. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Configuración inválida: …` al arrancar | Falta o es corta alguna variable obligatoria | Revisar `.env` contra `.env.example` (mensaje indica cuál). |
| SQL Server no arranca / `db` queda *unhealthy* | Clave `DB_PASSWORD` que no cumple la complejidad, o poca RAM | Usar una clave con mayúsculas, minúsculas, números y símbolos; dar ≥ 2 GB a Docker. |
| `db-init` falla con *QUOTED_IDENTIFIER* | `sqlcmd` ejecutado sin `-I` | Ya está en el Compose; si lo ejecuta a mano, añadir `-I`. |
| La API no conecta a la base (reintenta 10 veces) | SQL Server aún iniciando, o `DB_HOST` incorrecto | Esperar; sin Docker, `DB_HOST=localhost`. |
| `Login failed for user 'sa'` | `DB_PASSWORD` del `.env` distinta a la usada al crear el volumen | `docker compose down -v` y volver a levantar, o usar la clave original. |
| 401 `TOKEN_INVALIDO` | Token vencido (1 h) o `JWT_SECRET` cambió | Iniciar sesión de nuevo. |
| 429 | *Rate limit* (100 peticiones/min, 10 logins fallidos) | Esperar a que termine la ventana. |
| El `.env` "no se lee" sin Docker | La API lee `backend/.env` | Copiar `.env` a `backend/.env`. |
| Puerto 1433 o 3000 ocupado | Otro servicio local | Detenerlo o cambiar el puerto publicado en `docker-compose.yml`. |

## 13. Documentación

| Documento | Contenido |
|---|---|
| [`docs/modelo-de-negocio.md`](docs/modelo-de-negocio.md) | Entidades, estados, reglas de negocio, duplicados, roles, qué es inmutable, dónde viven las reglas |
| [`docs/arquitectura.md`](docs/arquitectura.md) | Diagramas (componentes, secuencia, ER), capas, outbox, fallas del webhook, justificación del esquema e índices |
| [`docs/decisiones-tecnicas.md`](docs/decisiones-tecnicas.md) | Decisiones, seguridad, errores, pruebas y limitaciones |
| [`docs/despliegue-y-escalabilidad.md`](docs/despliegue-y-escalabilidad.md) | HTTPS, secretos, backups, logs, health checks, monitoreo, CI/CD, stateless vs stateful y de 500 a 500.000 créditos/mes |
