# Estado del proyecto: Academic Planner

PWA universitaria de planeación académica, construida por **fases estrictas**. Este documento es la fuente de verdad del estado actual. Actualízalo al cerrar cada fase.

> Nota: se pidió "hasta la Fase 6", pero la Fase 7 ya está implementada, aprobada y commiteada (`404a032`), así que se incluye.

**Principio:** «Organizarse no debe convertirse en otra tarea.» **Flujo UX:** Capturar → Interpretar → Confirmar (nada se crea sin confirmación).

## Fase actual

- **Última fase completada y aprobada: Fase 17 (validación integral del sistema)** (rama `feat/phase-17-end-to-end-validation`, PR pendiente de fusionar por el usuario). Base: `main` `cfe5783` (Fase 16 fusionada). Checkpoint previo: tag `phase-12-complete` (`0ab869e`).
- **Siguiente: Fase 18 (datos de demostración / seed), sin empezar.** Solo se implementa cuando el usuario entregue su prompt. Nunca se avanza por iniciativa propia.
- Árbol de trabajo limpio tras el commit de la Fase 7 (salvo este documento y `CLAUDE.md`).

## Fases completadas

| Fase | Contenido                                                                      | Commit                                      |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| 0    | Contexto y decisiones (monorepo, PostgreSQL, sesiones propias, zona horaria)   | n/a                                         |
| 1    | Foundation: monorepo, API, web, Prisma, tooling, Playwright                    | `f542f5e`                                   |
| 2    | Autenticación: registro, login, logout, sesiones en servidor                   | `095c12c`                                   |
| 3    | Periodos académicos y asignaturas (CRUD, propiedad, onboarding)                | `da5eda9`                                   |
| 4-5  | Actividades académicas y Dashboard                                             | `6501bd9`                                   |
| 6    | Agenda, horarios y recurrencia semanal                                         | `7a031fb`                                   |
| 7    | Recordatorios internos automáticos para actividades                            | `404a032`                                   |
| 8    | Radar académico: categorías derivadas por tiempo restante                      | `c0698c0`                                   |
| 9    | ¿Qué hago ahora?: motor de atención determinístico y explicable                | `b7c7874`                                   |
| 10   | Progreso por asignatura y carga semanal (descriptivas)                         | PR #2 (`1848dff`)                           |
| 11   | Captura rápida: parser determinístico de frases cortas con vista previa        | PR #3                                       |
| 12   | Bandeja académica: mensajes largos a 0-10 propuestas revisables                | PR #4 (`6b21f49`)                           |
| 13   | PWA instalable: manifest, service worker, instalación, shell sin conexión      | PR #5 (`bfb7ea5`)                           |
| 14   | Importación de horario (imagen/PDF) con OCR local y vista previa editable      | PR #6 (`d589984`)                           |
| 15   | UX, accesibilidad y responsive: pulido transversal, axe, diálogos, 404, sesión | PR #7 (`4b9c913`)                           |
| 16   | Endurecimiento de seguridad: sesiones, CSRF, IDOR, CSP, subidas, límites       | PR #8 (`cfe5783`)                           |
| 17   | Validación integral: escenario maestro, coherencia entre módulos, fallos, humo | PR de `feat/phase-17-end-to-end-validation` |

Cada fase se aprueba solo tras lint, format, typecheck, tests, build, migraciones, verificación en navegador y sin defectos bloqueantes. El informe termina con exactamente `FASE N APROBADA` o `FASE N BLOQUEADA`.

## Arquitectura vigente

- **Monorepo npm workspaces:** `apps/api` (Express 5, Prisma 7 con `@prisma/adapter-pg`), `apps/web` (React 19, Vite 8, Tailwind 4, React Router, TanStack Query), `packages/core` (reglas puras y esquemas Zod, compilado a `dist`), `e2e` (Playwright).
- **Base de datos:** PostgreSQL 17 en Docker Compose, puerto host **5433**. BD `academic_planner` y `academic_planner_test` (la de test se crea sola; las pruebas se niegan a tocar otra que no termine en `_test`).
- **Capas API:** rutas → controladores (delgados, parsean con Zod, el dueño sale de la sesión) → servicios (reglas) → repositorios (siempre filtrados por `userId`) → Prisma.
- **Validación:** esquemas Zod `strictObject` compartidos; rechazan `userId` y campos internos. Errores con sobre `{error:{code,message,details:{fields}}}`.
- **Propiedad:** un recurso ajeno o inexistente devuelve el **mismo 404** (sin oráculo de existencia).
- **Sesiones:** cookie HttpOnly `SameSite=Lax`, token guardado como hash SHA-256 en PostgreSQL, Argon2id para contraseñas, verificación de origen contra CSRF, rate limit por IP.
- **Tiempo:** instantes en UTC; `User.timezone` (por defecto America/Bogota). Toda la lógica de zona horaria vive en `packages/core/src/time.ts` y `calendar.ts` (semana lunes-domingo). "Vencida" se **deriva**, nunca se guarda. Reloj inyectable (`createApp({clock})`) para tests deterministas.
- **Invariantes en la BD:** SQL escrito a mano al final de las migraciones (índices únicos parciales, `CHECK`). FKs `NO ACTION` donde no se quieren cascadas silenciosas; borrados bloqueados con 409 (`SUBJECT_NOT_EMPTY`, `PERIOD_NOT_EMPTY`).
- **Recurrencia (Fase 6):** una clase semanal es una sola fila; las ocurrencias se expanden al leer, con hora local (seguro ante cambios de horario).
- **Dashboard:** un solo `GET /api/dashboard` con 9 consultas constantes (sin N+1); listas disjuntas (vencidas, hoy, próximas).
- **Recordatorios (Fase 7):** solo para `Activity`. AUTO se recalcula solo si cambian `dueAt`, `type` o el estado cruza `COMPLETED`; MANUAL nunca se sobrescribe. Escrituras de actividad + recordatorios en una transacción con `FOR UPDATE` sobre la actividad; índice único parcial `(activityId, offsetMinutes) WHERE kind='AUTO'`. Marcar como visto es todo o nada; `/due` solo del periodo actual, máximo 20. Detalle en [reminders.md](reminders.md).
- **Relaciones Prisma:** `relationJoins` con `relationLoadStrategy: 'join'` para evitar consultas extra.

- **Radar (Fase 8):** categoría derivada (`OVERDUE`/`IMMEDIATE`/`UPCOMING`/`PLANNABLE`/`UNDER_CONTROL`) calculada por `calculateRadarStatus` en `packages/core/src/radar.ts` con duración real; nunca se guarda. `GET /api/radar` (2 consultas) y filtro `?radar=`. Detalle en [radar.md](radar.md).

- **Atención (Fase 9):** `packages/core/src/attention.ts`. `score = peso del nivel (Radar, con la vencida > 7 días rebajada) + peso de prioridad + bono de en proceso`; la brecha entre niveles (10) supera cualquier ayuda de prioridad + estado (9), así que la urgencia domina. Desempates totales, razones por plantillas, score nunca expuesto. `GET /api/attention` (2 consultas). Detalle en [attention-engine.md](attention-engine.md).

- **Progreso y carga (Fase 10):** `packages/core/src/insights.ts`. Progreso = la regla del Dashboard, por asignatura, alfabético, sin ponderar; "Sin actividades registradas" en vez de 0 %. Carga semanal lunes-domingo en la zona del perfil: actividades por el día local de `dueAt` (cualquier estado; una vencida de otra semana no cuenta) + ocurrencias de la agenda (reutiliza `expandBlock`), `scheduledMinutes` reales (una actividad es 1 compromiso y 0 horas), día con más compromisos (compromisos → minutos → día más temprano), sin niveles alta/baja. `GET /api/progress` y `GET /api/workload?week=` (solo periodo actual, consultas constantes). Detalle en [progress-and-workload.md](progress-and-workload.md).

- **Validación integral (Fase 17):** sin funcionalidad nueva. Suite de sistema (API con reloj fijo: coherencia Radar/Atención/Progreso/Carga/Recordatorios, medianoche, bordes del periodo, errores, rendimiento con 500 actividades; navegador: escenario MASTER de un semestre completo, dos usuarios, fallos de red inyectados con recuperación, Tokyo, teclado, 768 px, inventario de rutas), instalación limpia reproducida siguiendo el README y cinco pasadas completas consecutivas. Defectos de producto: ninguno; hallazgos menores (escáner de seguridad con una URL falsa, README desactualizado, trampa de entorno con `npm run dev` huérfano) corregidos o documentados. Todo en [system-validation.md](system-validation.md). revisión orientada a seguridad con modelo de amenazas y `docs/security.md`. Cambios: cookie `__Host-` bajo HTTPS; el inicio de sesión revoca el token anterior y limita a 20 sesiones por usuario; registro `strict`; `Cache-Control: no-store` global en `/api`; cabeceras (CSP estricta sin `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, HSTS solo con HTTPS); la API puede servir la app (`WEB_DIST_DIR`) sin dotfiles/listados y con 404 JSON para `/api/*`; tipos de contenido conocidos (415), cuerpo > 100 kB = 413 (antes 500); `TRUST_PROXY` explícito (nunca `true`) y `CORS_ORIGIN` exacto validados al arrancar; Zod `jitless` en el navegador (hallazgo: violación de CSP); errores genéricos sin pila. Pruebas: matriz IDOR, autenticación, HTTP/CSRF/CORS/cabeceras/estáticos, robustez (parsers y archivos hostiles), restricciones de BD, y navegador real en la topología de producción. Requisitos de despliegue en [security.md](security.md).
- **UX, accesibilidad y responsive (Fase 15):** auditoría orientada a WCAG 2.1 AA con `@axe-core/playwright` (0 violaciones A/AA en todas las pantallas y estados probados) más revisión manual con capturas a 360/768/1366 px y reflow a 320. Navegación compacta en móvil, enlace «Saltar al contenido», un `h1` y un título de documento por ruta, `Modal` que pregunta antes de descartar cambios, `QueryError` (un refresco fallido conserva los datos), 404 útil, `ErrorBoundary` global, manejo de sesión caducada, horas en 12 h con a. m./p. m. en todo el producto, cuadrícula semanal solo ≥ 1024 px, filtros secundarios plegables en móvil, rutas con `React.lazy` (paquete principal 799 → 529 kB, 223 → 154 kB gzip, más un fragmento de React de 164 kB). Sin dispositivo real (lista pendiente en [ux-accessibility.md](ux-accessibility.md)). La actualización de la PWA se probó de verdad (compilación A → B).
- **Importación de horario (Fase 14):** `POST /api/schedule-import/parse` (multipart, campo `file`). OCR local con `tesseract.js` 7 (WASM, modelo `spa` del paquete `@tesseract.js-data/spa`, sin descargas), texto de PDF con `unpdf` y render de páginas escaneadas con `@napi-rs/canvas`, subida con `multer` en memoria. Formatos PNG/JPG/PDF, 10 MB, 5 páginas, 60 s, una importación a la vez por usuario y 10 cada 10 min por IP (`SCHEDULE_IMPORT_RATE_LIMIT_MAX`). Extracción separada de la interpretación (`ExtractedDocument` → clases candidatas → propuestas); asignaturas `EXACT/LIKELY/AMBIGUOUS/MISSING` (nunca se aplica una aproximada sin confirmar); duplicados propios y conflictos vía `dryRun` del servicio de Agenda. Detalle en [schedule-import.md](schedule-import.md).
- **PWA (Fase 13):** `vite-plugin-pwa` 2.0 + Workbox `generateSW`, `registerType: 'prompt'`. Manifest «Academic Planner» (`standalone`, `start_url` `/`), iconos propios en `apps/web/public`. Precache solo del shell estático; `/api/*` siempre `NetworkOnly` (nunca se guardan datos privados); navegación con fallback a `index.html` salvo `/api`. Alcance offline: solo el shell; las operaciones académicas requieren conexión (sin colas, background sync ni Web Push). Aviso «Sin conexión», aviso de nueva versión que nunca recarga solo, botón de instalar solo si el navegador lo ofrece y pista para iOS. El SW está desactivado en `npm run dev`. Detalle en [pwa.md](pwa.md).
- **Bandeja académica (Fase 12):** `packages/core/src/academicInbox.ts` + `captureShared.ts` (bloques del parser compartidos con Captura rápida). Un mensaje de hasta 5000 caracteres produce de 0 a 10 propuestas (segmentación conservadora en oraciones y cláusulas, herencia de asignatura/fecha/hora solo por oración y solo si es inequívoca, ambigüedad con candidatos, propuestas incompletas válidas). `POST /api/academic-inbox/parse` solo propone y avisa de posibles duplicados del mismo usuario; la UI (`/inbox`) crea cada propuesta con el `POST /api/activities` normal, una por una, sin transacción global. Detalle en [academic-inbox.md](academic-inbox.md).
- **Captura rápida (Fase 11):** `packages/core/src/quickCapture.ts`. Una frase corta se convierte en una **propuesta** de actividad (Capturar → Interpretar → Confirmar). Parser determinístico (sin IA ni servicios externos; el texto no se guarda): tipos, asignatura (exacta → palabras/prefijos inequívocos → ambigua o faltante, nunca inventada), fechas (hoy, mañana, día de la semana = próxima ocurrencia contando hoy salvo hora ya pasada, DD/MM[/AAAA], "10 de octubre"), horas y título residual, con certeza `EXACT/LIKELY/AMBIGUOUS/MISSING` y avisos. `POST /api/quick-capture/parse` solo propone; confirmar usa el `POST /api/activities` normal (sin camino de creación propio). Detalle en [quick-capture.md](quick-capture.md).

Documentos por área: [auth](auth.md), [academic](academic.md), [activities](activities.md), [dashboard](dashboard.md), [schedule](schedule.md), [reminders](reminders.md), [radar](radar.md), [attention-engine](attention-engine.md), [progress-and-workload](progress-and-workload.md), [quick-capture](quick-capture.md).

## Fuera de alcance hasta nueva orden

Push/Web Push/correo/SMS, IA (incluida visión), sincronización offline completa (escrituras offline, colas, background sync), integración con calendarios externos, duración estimada, dificultad y recomendaciones basadas en hábitos. Cada uno pertenece a una fase futura definida por el usuario.

## Endpoints principales

`/api/auth/*` (registro, login, logout, me), `/api/periods`, `/api/subjects`, `/api/activities`, `/api/schedule-blocks` y agenda, `/api/dashboard`, `/api/reminders`, `/api/radar`, `/api/attention`, `/api/progress`, `/api/workload`, `POST /api/quick-capture/parse`, `POST /api/academic-inbox/parse`. Todos exigen sesión salvo registro/login; ver cada `docs/*.md` por módulo.

## Estrategia de ramas y PR

Una rama por fase (`feat/phase-N-...`) desde `main`, un commit `feat: ...` por fase, un PR por fase que el usuario autoriza fusionar (merge commit). Tras fusionar, tag anotado de checkpoint (`phase-12-complete`). `main` es la fuente persistente del proyecto.

## Totales de tests (tras la Fase 17)

Vitest: core 766, API 754, web 37 (1557). Playwright: 256 por pasada (252 se ejecutan y 4 se omiten a propósito según el viewport: teclado solo en escritorio, tamaño táctil solo en móvil) más 9 de seguridad en navegador (`npm run test:security:browser`, configuración aparte). Móvil 360 px y escritorio 1366 px.

## Riesgos conocidos

- Un recordatorio AUTO eliminado por el estudiante no vuelve hasta que cambie la fecha, el tipo o el estado de la actividad (documentado).
- Los offsets de recordatorio son minutos absolutos: en un cambio de horario "1 día antes" son 24 h reales.
- `/api/reminders/due` solo cubre el periodo actual.
- **Resuelto en la Fase 9:** el flake de `activities.spec` ("activity flow") era del propio test: comprobaba `toContainText('En proceso')`, siempre cierto por ser también el texto de una `<option>`, y recargaba con el `PATCH` aún en vuelo (en la traza, estado `-1`). Ahora espera el valor del `<select>` controlado. Lección: en e2e, no esperar con una aserción que ya es cierta; esperar el efecto real antes de recargar.
- **Problema conocido sin causa raíz (e2e):** en la Fase 10 una pasada completa de Playwright falló una vez (`dashboard.spec`, al final del test) con `net::ERR_CONNECTION_REFUSED`: un error de transporte, no una aserción sobre la app. En el stack con el servidor de desarrollo de Vite hubo varios casos (reproducido el mecanismo con 800 conexiones simultáneas); con `vite preview` apareció 1 vez en 11 pasadas completas y no se reprodujo en 8 pasadas completas seguidas ni en 80 repeticiones del test aislado, así que no se pudo capturar su traza. **No reapareció en las 6 pasadas completas de la Fase 11 ni en las 3 de la Fase 12 ni en las 3 de la Fase 13. Reapareció en la Fase 14** (1 vez en 4 pasadas, más un fallo de `dashboard.spec` en otra pasada) y esta vez SÍ se guardó evidencia: la traza muestra que la petición rechazada fue **`http://localhost:5173/icon.svg`**, el favicon que la Fase 13 había convertido en archivo (antes era un `data:` URI): una petición iniciada por el navegador, fuera del control del test, contra `vite preview` bajo la carga de 4 navegadores en paralelo. El rechazo de conexiones de `vite preview` bajo carga sigue sin causa raíz; se quitó esa petición (favicon de nuevo en línea) y las 5 pasadas siguientes dieron 194/194. Si reaparece: la traza dirá qué URL se rechazó. **Fase 15: causa probable hallada.** Con otra tanda de evidencia (la petición rechazada fue `/assets/SubjectsPage-*.js`, y antes `/icon.svg`) se comprobó que `vite preview` con `host: 'localhost'` escucha **solo en `[::1]` (IPv6)**: `127.0.0.1` es rechazado siempre. Un navegador que intente IPv4 (orden/carrera de resolución, reintento de conexión) recibe `ERR_CONNECTION_REFUSED` de forma intermitente, a cualquier URL. Corrección: el stack e2e usa `WEB_HOST=::` (IPv4+IPv6, como ya hacía la API). Además las pantallas lazy reintentan una vez su descarga. Tras el cambio no volvió a aparecer en 9 pasadas completas (2 de ellas con otros fallos, no de conexión: una carrera de un diálogo provisional en un test y un 401 de refresco al cerrar sesión, ya corregidos en los tests; las 4 últimas, verdes); es una causa verificada en su mecanismo, pero un fallo intermitente nunca se "demuestra" ausente: si reaparece, guardar de nuevo la traza (132 tests cada una, con registro de evidencia preparado): sigue en monitoreo, sin causa raíz. Si reaparece: guardar la traza de ese fallo, ver qué URL rechaza la conexión y no limitarse a repetir hasta que salga verde.
- El stack e2e (`npm run dev:e2e`) sirve el bundle compilado con `vite preview` y la API sin `--watch`: el servidor de desarrollo reiniciaba la API al re-emitir `dist` y rechazaba conexiones bajo carga (167 de 800 en una prueba).
- `npm audit` reporta vulnerabilidades altas en dependencias de desarrollo del CLI de `prisma` (`mysql2`, `deepmerge-ts`); no se usa MySQL. Revisar en la fase de endurecimiento.
- Sin notificaciones fuera de la app: solo recordatorios internos.
- **Dependencias (Fase 16):** `npm audit` = 4 altas, todas de la cadena del **CLI** `prisma@7.10.0` (`@prisma/config` → `deepmerge-ts`, y `mysql2`): no alcanzables (configuración propia; nunca se conecta a MySQL). El arreglo que propone npm es retroceder a `prisma@6.19.3`; se rechazó. Pendiente: pasar a la siguiente estable de Prisma que la corrija.
- **Dispositivos reales (pendiente):** instalación de la PWA y uso en iOS/Android físicos no probados (solo emulación a 360/768/1366 px en Edge).
- **Seguridad (límites conocidos):** límites de frecuencia en memoria y por proceso (una sola instancia o almacén compartido); el registro revela si un correo existe; sin verificación de correo, recuperación de contraseña ni MFA; sesión fija de 7 días. Detalle en [security.md](security.md).
- Windows: `.gitattributes` fija `eol=lf` para que `git pull` no deje archivos con CRLF (antes `format:check` fallaba en archivos sin cambios); un aviso LF→CRLF de `git add` es inocuo. Los scripts de PowerShell 5.1 pueden corromper UTF-8 al leer/escribir; usar las herramientas de edición.

## Comandos de validación

Requisitos: Node ≥ 22.18 (probado 24.19), Docker Desktop corriendo.

```bash
cp .env.example .env
npm ci
npm run db:up            # PostgreSQL en :5433
npm run db:deploy        # migraciones a la BD de desarrollo
npm run lint
npm run format:check
npm run typecheck        # compila core, tipos de todos los workspaces y e2e
npm test                 # Vitest (core, api, web); crea y migra academic_planner_test
npm run build
PW_CHANNEL=msedge npm run test:browser   # Playwright (levanta su propio stack `dev:e2e` contra la BD de test; parar `npm run dev` antes: ambos usan el puerto 5173)
```

Antes de `test:browser`, verificar con `netstat` que nada escucha en :3000/:5173 (un `npm run dev` huérfano arruina la pasada y ensucia la BD de desarrollo; ver [system-validation.md](system-validation.md), P17-03).

Verificación de instalación limpia: `docker compose down -v`, borrar `node_modules`, `dist`, `apps/api/src/generated`, `test-results` y `.env`, y repetir la secuencia anterior. Comprobar también que no hay drift de esquema (`prisma migrate diff ... --exit-code`) y que la BD de desarrollo queda sin filas tras los tests.

## Cómo trabajar una fase

1. Leer el prompt de la fase y limitarse a ese alcance.
2. Implementar por capas, con tests de núcleo, API (BD real), web y Playwright.
3. Probar propiedad (IDOR), concurrencia y zona horaria; hacer _mutation checks_ y revertirlos.
4. Ejecutar la validación completa desde instalación limpia.
5. Entregar el informe estructurado terminado en `FASE N APROBADA` o `FASE N BLOQUEADA`.
6. Commit solo cuando el usuario lo pida.
