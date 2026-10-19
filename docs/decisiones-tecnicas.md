# Decisiones técnicas

Resumen de las decisiones principales y su porqué. El detalle del modelo está en `modelo-de-negocio.md` y `arquitectura.md`.

## 1. Stack

| Decisión | Por qué |
|---|---|
| **Node.js + TypeScript + Express 5** | Es el stack recomendado en el enunciado. TypeScript en modo estricto atrapa errores de tipos al compilar; Express 5 propaga los errores de funciones `async` al manejador de errores sin código extra. |
| **SQL Server 2022** | Requisito preferido. Se usa con el paquete `mssql` y **solo consultas parametrizadas**. |
| **Zod** para validar la forma de la petición | Un esquema declarativo por endpoint; rechaza campos desconocidos (`strictObject`). |
| **Jest + Supertest** | Pruebas de servicio y de API HTTP sin levantar un servidor real. |
| **pino** para logs | JSON estructurado, rápido, con redacción de secretos. |

## 2. Arquitectura

- **Capas con dependencias hacia adentro** (`http → services → domain`) y repositorios detrás de interfaces. Permite probar las reglas contra memoria y ejecutarlas en producción contra SQL Server con el mismo código.
- **Unit of Work:** una operación = una transacción. Crédito, historial y evento del webhook se confirman juntos o ninguno (hay una prueba que lo verifica).
- **Reglas de negocio en la capa de servicio**, con los `CHECK`/`UNIQUE` de la base como red de seguridad. Razones en `modelo-de-negocio.md`, sección 9.

## 3. Webhook: Transactional Outbox

**Problema:** notificar a un sistema externo cuando se crea un crédito sin duplicar la lógica de creación y sin perder eventos.

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Llamar al externo dentro de `crear()` | Si el externo tarda o cae, la creación se bloquea o falla. Si el crédito se guarda pero el POST falla, se pierde la notificación. |
| Enviar *después* del commit, en memoria | Si el proceso muere entre el commit y el envío, el evento se pierde sin dejar rastro. |
| Transacción distribuida (2PC) con el externo | Imposible: no controlamos al externo. |

**Solución elegida:** el evento se inserta en `WebhookOutbox` **dentro de la misma transacción** que el crédito. Un worker lo envía después. Es *at-least-once*: nunca se pierde, a cambio de que pueda repetirse, por eso lleva `eventId` para deduplicar.

Detalles de reintentos, *lease*, *dead letter* y firma: `arquitectura.md`, sección 4.

## 4. Seguridad (enunciado, sección 8)

| Mecanismo | Qué protege | Dónde |
|---|---|---|
| **JWT** (HS256, expira en 1 h por defecto) | Autenticación sin sesión en el servidor (la API es *stateless*). El algoritmo se fija al verificar: impide el ataque `alg: none`. | `AuthService`, `middlewares/auth.ts` |
| **bcrypt** (coste 12) | Las contraseñas se guardan como hash lento con *salt*. El login compara contra un hash ficticio si el usuario no existe: mismo tiempo de respuesta, no revela qué usuarios existen. | `AuthService` |
| **RBAC** (ADMIN / ANALISTA) | Autorización por rol y por estado; separación de funciones. Responde 403. | `authorize()`, `CreditoService` |
| **Consultas parametrizadas** | Inyección SQL. El `ORDER BY` usa una lista blanca de columnas; el texto de búsqueda escapa los comodines de `LIKE`. | `repositories/mssql` |
| **Validación de entrada** (Zod + reglas de dominio) | Datos mal formados o fuera de rango. `strictObject` rechaza campos como `estado` o `numeroCredito` al crear (*mass assignment*). | `http/schemas.ts`, `domain/validaciones.ts` |
| **Helmet** | Cabeceras seguras (`nosniff`, `X-Frame-Options`, CSP…). Se desactiva `X-Powered-By`. | `app.ts` |
| **CORS** con lista de orígenes | Solo el frontend configurado puede llamar desde un navegador. | `app.ts`, `CORS_ORIGIN` |
| **Rate limiting** | General: 100 peticiones/min por IP. Login: 10 intentos *fallidos* por ventana (los exitosos no cuentan): frena la fuerza bruta sin molestar al usuario legítimo. | `app.ts` |
| **Límite de cuerpo (100 kb)** | Evita cuerpos gigantes. Responde 413. | `app.ts` |
| **Firma HMAC-SHA256 del webhook** + timestamp | El receptor comprueba que el evento viene de nosotros y no fue alterado ni repetido. Comparación en tiempo constante. | `webhookDispatcher.ts` |
| **Errores sin filtrar detalles** | Un error inesperado devuelve 500 genérico con un `requestId`; la traza y el detalle de la base solo van al log. | `errorHandler.ts` |
| **Logs con secretos redactados** | `Authorization`, firmas y contraseñas no se escriben en el log. | `logger.ts` |
| **Secretos fuera del código** | Todo por variables de entorno; `.env` está en `.gitignore`; en producción el arranque falla si quedan valores de ejemplo o un `JWT_SECRET` corto. | `config/env.ts` |
| **Contenedor sin root, imagen mínima** | Reduce superficie de ataque. | `backend/Dockerfile` |
| **Sin redirecciones en el webhook** | El envío no sigue redirecciones (evita desvíos a otros destinos). | `webhookDispatcher.ts` |

**HTTPS:** lo termina el proxy inverso / balanceador (ver `despliegue-y-escalabilidad.md`). La API confía en él con `TRUST_PROXY=true` para leer la IP real del cliente.

**Limitaciones conocidas** (para no prometer de más): no hay refresh tokens ni revocación de JWT antes de que expiren; no hay bloqueo de cuenta tras N intentos (solo *rate limit* por IP); el contador del *rate limit* está en memoria de cada instancia (con varias réplicas habría que moverlo a un almacén compartido).

## 5. Manejo de errores (enunciado, sección 10)

Todas las respuestas siguen el mismo formato y salen de **un único manejador**:

```json
{ "success": false, "error": { "code": "CREDITO_NOT_FOUND", "message": "El crédito no existe", "requestId": "…" } }
```

| HTTP | Cuándo | Ejemplos de `code` |
|---|---|---|
| **200 / 201** | Éxito / creado (con cabecera `Location`) | — |
| **400** | La petición está *mal formada*: tipos, campos faltantes o sobrantes, JSON inválido, id no numérico | `VALIDATION_ERROR`, `JSON_INVALIDO`, `ID_INVALIDO` |
| **401** | No autenticado, token inválido/vencido, credenciales o firma incorrectas | `NO_AUTENTICADO`, `TOKEN_INVALIDO`, `CREDENCIALES_INVALIDAS`, `FIRMA_INVALIDA` |
| **403** | Autenticado pero sin permiso | `PERMISO_DENEGADO` |
| **404** | El recurso no existe | `CREDITO_NOT_FOUND`, `NOTIFICACION_NOT_FOUND`, `RUTA_NO_ENCONTRADA` |
| **409** | Choca con el *estado actual* del recurso | `CREDITO_DUPLICADO`, `TRANSICION_INVALIDA`, `CREDITO_NO_MODIFICABLE`, `CREDITO_NO_ELIMINABLE` |
| **413** | Cuerpo demasiado grande | `PAYLOAD_DEMASIADO_GRANDE` |
| **422** | La petición es válida en forma pero incumple una **regla de negocio** | `DATOS_CREDITO_INVALIDOS`, `OBSERVACION_REQUERIDA` |
| **429** | Demasiadas peticiones | `DEMASIADAS_PETICIONES` |
| **500** | Fallo interno (genérico; el detalle solo va al log) | `INTERNAL_ERROR` |

**Criterio 400 vs 422:** 400 si el problema se detecta mirando solo la *forma* de la petición ("`valorSolicitado` debe ser un número"); 422 si la forma es correcta pero el contenido viola el negocio ("`valorSolicitado` debe ser mayor que 0"). El campo `details` indica qué campos fallaron.

## 6. Pruebas automatizadas (enunciado, sección 12)

144 pruebas en 5 archivos, sin necesidad de SQL Server ni Docker (usan persistencia en memoria que imita la unicidad, el índice de duplicados y el *rollback*).

| Lo que pide el enunciado | Dónde se cubre |
|---|---|
| Creación de crédito | `creditoService.test.ts`, `api.test.ts` (POST) |
| Validaciones | `validaciones.test.ts`, `api.test.ts` |
| Consulta de crédito inexistente | `api.test.ts` (404 `CREDITO_NOT_FOUND`) |
| Cambio de estado | `creditoService.test.ts`, `api.test.ts` |
| Transiciones inválidas | `estados.test.ts`, `api.test.ts` (RECHAZADO → DESEMBOLSADO) |
| **Integración con el webhook** | `webhook.test.ts`: envío firmado, reintentos con espera exponencial, `FALLIDO`, reencolado, e integración real despachador → receptor de demostración |
| Seguridad, rate limit, salud, Swagger | `api.test.ts` |

**Qué no cubren:** los repositorios SQL Server y el script SQL (requieren una base real) y el bucle `iniciarWorker`. Esa es la parte a verificar primero en un entorno con Docker (ver README, "Verificación").

## 7. Frontend

| Decisión | Por qué |
|---|---|
| **React + TypeScript + Vite** | Estándar del enunciado; tipos compartidos en espíritu con la API y arranque rápido. Sin librería de componentes ni de estado global: cuatro pantallas no lo justifican (menos dependencias que defender). |
| **`/api` por proxy (Vite en desarrollo, nginx en Docker)** | El navegador habla con un solo origen: sin CORS en el camino principal y sin URLs de API en el código. |
| **JWT en `sessionStorage`** | Se borra al cerrar la pestaña. `localStorage` lo dejaría vivo indefinidamente. Si la API responde 401, se limpia la sesión y se vuelve al ingreso. Limitación conocida: un XSS podría leer el token; se mitiga con React (escapa por defecto), sin `dangerouslySetInnerHTML` y con las cabeceras de nginx/Helmet. Alternativa más robusta: cookie `HttpOnly` + protección CSRF. |
| **Reglas de estado duplicadas en el cliente** | Solo para mostrar los botones válidos. El backend es la autoridad y sus errores (403/409) se muestran tal cual. Es un compromiso consciente: evita una llamada por pantalla a cambio de mantener dos copias. |
| **Filtros en la URL** | Estado compartible y botón "atrás" correcto, sin estado global. |
| **Estado nunca solo con color** | Cada estado lleva icono y nombre (accesibilidad y daltonismo). El gráfico del resumen tiene vista de tabla. |
| **Dinero en `Intl.NumberFormat('es-CO')`** y fechas en `America/Bogota` | El backend guarda UTC; la conversión ocurre solo al mostrar. |

## 8. Lo que haría con más tiempo

- Pruebas de interfaz automatizadas (Playwright) en CI; hoy el recorrido se hizo con un script puntual.
- Pruebas de integración contra SQL Server real (Testcontainers) en CI.
- Migraciones versionadas (Flyway o DbUp) en lugar de un único script idempotente.
- Revocación de tokens y refresh tokens; almacén compartido (Redis) para el rate limit.
- Métricas (Prometheus/OpenTelemetry), en especial la antigüedad del evento pendiente más viejo del outbox.
- Paginación por cursor (*keyset*) para listados muy grandes.
