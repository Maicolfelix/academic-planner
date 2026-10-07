# API

REST sobre JSON bajo `/api`. No hay especificación OpenAPI: este documento es el inventario, **verificado contra los routers** (`apps/api/src/routes/`, montados en `apps/api/src/app.ts`) y contra la matriz de `http.security.test.ts`, que falla si aparece una ruta no-GET sin registrar. Para el detalle de cada módulo (reglas, ejemplos, decisiones) ver el documento enlazado en cada sección. Los esquemas exactos de entrada y salida son los de `packages/core` (Zod).

## Convenciones generales

| Tema               | Regla                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticación      | Cookie de sesión `HttpOnly` (`academic_planner_session`; bajo HTTPS, `__Host-academic_planner_session`). «Sesión: sí» = responde 401 sin ella                           |
| Dueño              | Siempre sale de la sesión. Los cuerpos son `strictObject`: un `userId` o cualquier campo desconocido da 400. El login es la única excepción, a propósito                |
| Formato            | Cuerpos y respuestas JSON (`Content-Type: application/json`); solo la importación de horario usa `multipart/form-data`                                                  |
| Fechas e instantes | Instantes en ISO 8601 UTC (`2026-10-07T15:00:00.000Z`); días de calendario como `YYYY-MM-DD`; horas de pared `HH:mm` (24 h) en la zona del perfil. La interfaz localiza |
| Caché              | Toda respuesta de `/api` lleva `Cache-Control: no-store`                                                                                                                |
| CSRF               | Las rutas no-GET exigen un `Origin`/`Sec-Fetch-Site` permitido (`INVALID_ORIGIN`, 403)                                                                                  |
| Cuerpo             | Máximo 100 kB de JSON (413 si se excede)                                                                                                                                |

### Errores

Misma envoltura siempre: `{ "error": { "code": "…", "message": "…", "details"?: … } }` (`details.fields` en validación). La interfaz nunca recibe pilas, SQL ni rutas.

| Estado | Cuándo                                                      | Códigos                                                                                                                     |
| -----: | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
|    400 | Validación, o regla que necesita datos guardados            | `VALIDATION_ERROR`, `NO_CURRENT_PERIOD`, `INVALID_JSON`, `BAD_REQUEST`                                                      |
|    401 | Sin sesión válida, o credenciales incorrectas               | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                                    |
|    403 | Origen no permitido (CSRF)                                  | `INVALID_ORIGIN`                                                                                                            |
|    404 | Recurso inexistente **o de otro usuario** (misma respuesta) | `NOT_FOUND`                                                                                                                 |
|    409 | Conflicto de dominio                                        | `EMAIL_ALREADY_EXISTS`, `SUBJECT_ALREADY_EXISTS`, `SUBJECT_NOT_EMPTY`, `PERIOD_NOT_EMPTY`, `ACTIVITY_COMPLETED`, `CONFLICT` |
|    413 | Cuerpo o archivo demasiado grande                           | `PAYLOAD_TOO_LARGE` (JSON > 100 kB), `FILE_TOO_LARGE`, `IMAGE_TOO_LARGE`, `TOO_MANY_PAGES`                                  |
|    415 | Tipo de contenido o de archivo no admitido                  | `UNSUPPORTED_MEDIA_TYPE`, `UNSUPPORTED_FILE`                                                                                |
|    429 | Límite de frecuencia, o ya hay una importación en curso     | `RATE_LIMITED` (con `Retry-After`), `IMPORT_IN_PROGRESS`                                                                    |
|    504 | La extracción de un horario superó el tiempo máximo         | `IMPORT_TIMEOUT`                                                                                                            |
|    503 | `GET /api/health` cuando la base de datos no responde       | —                                                                                                                           |

## Salud

| Método y ruta     | Sesión | Para qué                                               | Respuesta                                                                                                 |
| ----------------- | :----: | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET /api/health` |   no   | Comprobar que el servidor y la base de datos responden | `200 { status: "ok", database: "up", timestamp }`; `503` con `degraded`/`down`. No expone datos sensibles |

## Autenticación (`/api/auth`) — [auth.md](auth.md)

| Método y ruta             | Sesión | Para qué                       | Entrada                     | Éxito                   | Errores importantes                                                  |
| ------------------------- | :----: | ------------------------------ | --------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `POST /api/auth/register` |   no   | Crear cuenta e iniciar sesión  | `{ name, email, password }` | `201 { user }` + cookie | 400 validación, 409 `EMAIL_ALREADY_EXISTS`, 429                      |
| `POST /api/auth/login`    |   no   | Iniciar sesión                 | `{ email, password }`       | `200 { user }` + cookie | 401 `INVALID_CREDENTIALS` (mismo mensaje exista o no el correo), 429 |
| `POST /api/auth/logout`   |   no   | Cerrar la sesión (idempotente) | —                           | `204`                   | —                                                                    |
| `GET /api/auth/me`        |   sí   | Quién soy                      | —                           | `200 { user }`          | 401                                                                  |

Contraseña: 8 a 128 caracteres. Iniciar sesión revoca el token anterior de ese navegador.

## Periodos académicos (`/api/periods`) — [academic.md](academic.md)

| Método y ruta             | Para qué                             | Entrada                                    | Éxito             | Errores importantes                           |
| ------------------------- | ------------------------------------ | ------------------------------------------ | ----------------- | --------------------------------------------- |
| `GET /api/periods`        | Listar los periodos del usuario      | —                                          | `200 { periods }` | —                                             |
| `POST /api/periods`       | Crear (el primero queda como actual) | `{ name, startDate, endDate, isCurrent? }` | `201 { period }`  | 400 (`endDate` ≤ `startDate`), 409 `CONFLICT` |
| `GET /api/periods/:id`    | Leer uno                             | —                                          | `200 { period }`  | 404                                           |
| `PATCH /api/periods/:id`  | Editar / marcar como actual          | campos opcionales                          | `200 { period }`  | 400, 404, 409 `CONFLICT`                      |
| `DELETE /api/periods/:id` | Eliminar                             | —                                          | `204`             | 404, 409 `PERIOD_NOT_EMPTY`                   |

Hay un único periodo actual por usuario. La interfaz hoy solo crea el periodo en el onboarding (ver [limitations.md](limitations.md)).

## Asignaturas (`/api/subjects`) — [academic.md](academic.md)

| Método y ruta              | Para qué              | Entrada                                                | Éxito              | Errores importantes                                        |
| -------------------------- | --------------------- | ------------------------------------------------------ | ------------------ | ---------------------------------------------------------- |
| `GET /api/subjects`        | Listar (`?periodId=`) | —                                                      | `200 { subjects }` | —                                                          |
| `POST /api/subjects`       | Crear                 | `{ periodId, name, color?, professor?, description? }` | `201 { subject }`  | 400, 404 (periodo ajeno), 409 `SUBJECT_ALREADY_EXISTS`     |
| `GET /api/subjects/:id`    | Leer una              | —                                                      | `200 { subject }`  | 404                                                        |
| `PATCH /api/subjects/:id`  | Editar                | campos opcionales                                      | `200 { subject }`  | 400, 404, 409                                              |
| `DELETE /api/subjects/:id` | Eliminar              | —                                                      | `204`              | 404, 409 `SUBJECT_NOT_EMPTY` (tiene actividades o bloques) |

## Actividades (`/api/activities`) — [activities.md](activities.md)

| Método y ruta                | Para qué                                                                                                                      | Entrada                                                                   | Éxito                | Errores importantes         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------- | --------------------------- |
| `GET /api/activities`        | Listar con filtros combinables (AND): `subjectId`, `periodId`, `status`, `priority`, `type`, `overdue`, `radar`, `from`, `to` | query                                                                     | `200 { activities }` | 400 filtro inválido         |
| `POST /api/activities`       | Crear (siempre `PENDING`; genera sus recordatorios AUTO)                                                                      | `{ subjectId, title, dueDate, dueTime?, type?, priority?, description? }` | `201 { activity }`   | 400, 404 (asignatura ajena) |
| `GET /api/activities/:id`    | Leer una                                                                                                                      | —                                                                         | `200 { activity }`   | 404                         |
| `PATCH /api/activities/:id`  | Editar; incluye `status`. `completedAt` lo decide el servidor                                                                 | campos opcionales                                                         | `200 { activity }`   | 400, 404                    |
| `DELETE /api/activities/:id` | Eliminar (se van sus recordatorios)                                                                                           | —                                                                         | `204`                | 404                         |

`from`/`to` son días locales inclusivos del usuario. `radar` filtra por categoría del Radar (solo actividades abiertas).

## Agenda (`/api/schedule`) — [schedule.md](schedule.md)

| Método y ruta              | Para qué                                                                                  | Entrada                                                                         | Éxito                                                         | Errores importantes          |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| `GET /api/schedule`        | Ocurrencias de un rango (`?from=&to=` juntos; sin ellos, la semana actual lunes–domingo)  | query (máx. 42 días)                                                            | `200 { range, occurrences }`                                  | 400                          |
| `POST /api/schedule`       | Crear un bloque o una serie semanal. `?dryRun=true` valida y avisa de choques sin guardar | `{ type, subjectId?, periodId?, title, date, startTime, endTime, recurrence? }` | `201 { block, warnings }` (`200` con `dryRun`, `block: null`) | 400 (fuera del periodo), 404 |
| `GET /api/schedule/:id`    | Leer un bloque                                                                            | —                                                                               | `200 { block }`                                               | 404                          |
| `PATCH /api/schedule/:id`  | Editar (toda la serie). Admite `?dryRun=true`                                             | campos opcionales                                                               | `200 { block, warnings }`                                     | 400, 404                     |
| `DELETE /api/schedule/:id` | Eliminar (toda la serie)                                                                  | —                                                                               | `204`                                                         | 404                          |

Los choques (`SCHEDULE_CONFLICT`) son **avisos** en `warnings`; nunca impiden guardar. La clase `CLASS` exige `subjectId`.

## Recordatorios (`/api/reminders`) — [reminders.md](reminders.md)

| Método y ruta               | Para qué                                                               | Entrada                                  | Éxito                      | Errores importantes                |
| --------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- | -------------------------- | ---------------------------------- |
| `GET /api/reminders`        | Listar (`?activityId=&status=`)                                        | —                                        | `200 { reminders }`        | —                                  |
| `GET /api/reminders/due`    | Pendientes ya vencidos del periodo actual (máx. 20, con el total real) | —                                        | `200 { reminders, total }` | —                                  |
| `POST /api/reminders`       | Crear uno **manual** (futuro y anterior al plazo)                      | `{ activityId, remindDate, remindTime }` | `201 { reminder }`         | 400, 404, 409 `ACTIVITY_COMPLETED` |
| `POST /api/reminders/seen`  | Marcar como mostrados (solo los ya vencidos; todo o nada)              | `{ ids }`                                | `200 { updated }`          | 404 si algún id es ajeno           |
| `PATCH /api/reminders/:id`  | Cambiar la hora (un AUTO editado pasa a MANUAL)                        | `{ remindDate, remindTime }`             | `200 { reminder }`         | 400, 404                           |
| `DELETE /api/reminders/:id` | Eliminar                                                               | —                                        | `204`                      | 404                                |

## Lecturas derivadas (solo `GET`, sesión: sí)

Nada de lo que devuelven se guarda: se calcula en cada petición.

| Ruta                 | Devuelve                                                                                                                           | Documento                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/dashboard` | `{ dashboard }`: saludo, resumen por estado, progreso, próxima entrega, vencidas, hoy, próximas, clases de hoy, carga de la semana | [dashboard.md](dashboard.md)                         |
| `GET /api/radar`     | `{ radar }`: conteo y listas (máx. 10 por grupo) de las cinco categorías                                                           | [radar.md](radar.md)                                 |
| `GET /api/attention` | `{ attention }`: recomendación («¿Qué hago ahora?») y hasta 2 alternativas, con sus razones                                        | [attention-engine.md](attention-engine.md)           |
| `GET /api/progress`  | `{ progress }`: progreso general y por asignatura                                                                                  | [progress-and-workload.md](progress-and-workload.md) |
| `GET /api/workload`  | `{ workload }`: carga de una semana (`?week=YYYY-MM-DD`; por defecto la actual)                                                    | [progress-and-workload.md](progress-and-workload.md) |

## Proponer sin guardar (sesión: sí) — nada se crea

| Método y ruta                     | Para qué                                          | Entrada                                                                                            | Éxito                                                    | Errores importantes                                                                                                                            |
| --------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/quick-capture/parse`   | Interpretar una frase como una actividad          | `{ text }` (la petición admite 2000 caracteres; más de 300 se devuelve como `status: TOO_LONG`)    | `200` propuesta con certeza por campo y avisos           | 400                                                                                                                                            |
| `POST /api/academic-inbox/parse`  | Interpretar un mensaje largo como 0–10 propuestas | `{ text }` (la petición admite 20 000 caracteres; más de 5000 se devuelve como `status: TOO_LONG`) | `200` propuestas, ambigüedades, duplicados               | 400                                                                                                                                            |
| `POST /api/schedule-import/parse` | Leer un horario (imagen o PDF) y proponer clases  | `multipart/form-data`, un archivo en el campo `file`                                               | `200` propuestas con asignatura, conflictos y duplicados | 413 `FILE_TOO_LARGE`/`IMAGE_TOO_LARGE`/`TOO_MANY_PAGES`, 415 `UNSUPPORTED_FILE`, 429 `RATE_LIMITED`/`IMPORT_IN_PROGRESS`, 504 `IMPORT_TIMEOUT` |

Confirmar una propuesta de **Captura rápida o Bandeja** es una llamada normal a `POST /api/activities`; la de **Importación de horario** tiene su propia confirmación en lote (siguiente sección). Límites de la importación: 10 MB, 5 páginas, 25 megapíxeles, 40 propuestas, 60 s, un archivo por solicitud, una importación a la vez por usuario y 10 por IP cada 10 minutos (configurable). Detalle: [quick-capture.md](quick-capture.md), [academic-inbox.md](academic-inbox.md), [schedule-import.md](schedule-import.md).

### Confirmar la importación de horario (sesión: sí) — **crea**

| Método y ruta                       | Para qué                                                                                                                      | Entrada                                                                                                                                                                                                                                                | Éxito                                                                             | Errores importantes                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/schedule-import/confirm` | Crear, **todo o nada**, las clases revisadas y las asignaturas nuevas que necesiten (una transacción, un bloqueo por usuario) | JSON `{ classes: [{ clientId, weekday, startTime, endTime, title, until, subject: { kind: 'EXISTING', subjectId } \| { kind: 'NEW', name } }] }`, 1–40 clases; usuario, periodo, `nameKey` y color los deriva el servidor (cualquier otro campo → 400) | `201` `{ createdSubjects, reusedSubjects, createdBlocks: [{ clientId, block }] }` | 400 `VALIDATION_ERROR` (con `details.items` por clase), 400 `NO_CURRENT_PERIOD`, 404 (asignatura inexistente o ajena: igual), 409 `DUPLICATE_CLASS`, 429 `IMPORT_IN_PROGRESS` |

Reglas completas, formato de errores y concurrencia: [schedule-import.md](schedule-import.md#previsualización-y-confirmación).

## Rutas que no existen

Cualquier otra ruta bajo `/api` responde un `404` JSON (`NOT_FOUND`), nunca HTML. No hay registro de dispositivos, notificaciones push, correo ni integración con calendarios externos.
