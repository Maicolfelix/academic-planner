# CLAUDE.md

Academic Planner: PWA universitaria de planeación académica. Monorepo npm workspaces (`apps/api`, `apps/web`, `packages/core`, `e2e`). Estado completo, arquitectura y riesgos en [docs/project-state.md](docs/project-state.md).

## Reglas de trabajo (obligatorias)

- **Sistema de fases estricto.** Solo se implementa la fase que el usuario entrega explícitamente. Nunca avanzar a la siguiente por iniciativa propia ni adelantar trabajo de fases futuras.
- Una fase se aprueba solo tras lint, format, typecheck, tests, build, migraciones, verificación en navegador y sin defectos bloqueantes. El informe final termina exactamente con `FASE N APROBADA` o `FASE N BLOQUEADA`.
- **Commit solo cuando el usuario lo pida.** Mensajes con prefijo `feat:`; usar `git commit -F <archivo>` para mensajes con comillas.
- Responder y documentar en español.
- Fase actual: **17 aprobada. Fase 18 (datos de demostración / seed) sin empezar** (esperar el prompt del usuario).

## Comandos

```bash
npm run db:up                       # PostgreSQL 17 (Docker) en :5433
npm run db:deploy                   # aplicar migraciones (dev)
npm run lint && npm run format:check && npm run typecheck
npm test                            # Vitest: core, api (BD real *_test), web
npm run build
PW_CHANNEL=msedge npm run test:browser   # Playwright 360 px y 1366 px; usa `dev:e2e` (bundle compilado + API sin watch) y comparte el puerto 5173: no tener `npm run dev` corriendo
npm run dev                         # core + api + web (web en :5173)
```

Los tests de API usan PostgreSQL real; Docker debe estar arriba. Las pruebas se niegan a correr contra una BD que no termine en `_test`.

## Arquitectura (resumen)

- API por capas: rutas → controladores delgados (Zod, dueño desde la sesión) → servicios (reglas) → repositorios (siempre con `userId`) → Prisma.
- Reglas puras y esquemas Zod compartidos en `packages/core` (se compila a `dist`; reconstruir con `npm run build -w @planner/core` tras cambiarlo).
- Un recurso ajeno o inexistente responde el **mismo 404**. Esquemas `strictObject`: rechazan `userId` y campos internos.
- Fechas: instantes UTC + `User.timezone` (America/Bogota). Toda la lógica horaria en `packages/core/src/time.ts` y `calendar.ts`; nunca matemática de zonas en la UI. "Vencida" se deriva, no se guarda. Reloj inyectable (`clock`) para tests.
- Invariantes críticas en la BD con SQL a mano al final de la migración (índices únicos parciales, `CHECK`). Nunca editar una migración ya aplicada: crear otra.
- Escrituras que tocan varias tablas van en una transacción; ediciones concurrentes de una actividad se serializan con `FOR UPDATE` (`activities.lock`).
- Sin N+1: Prisma con `relationLoadStrategy: 'join'`; el Dashboard usa 9 consultas constantes.
- Validación integral (Fase 17): ver [docs/system-validation.md](docs/system-validation.md). `e2e/system-validation.spec.ts` (escenario MASTER + multiusuario + fallos inyectados + Tokyo/teclado/768 px) y `apps/api/src/systemValidation/` (coherencia entre módulos con reloj fijo, medianoche, bordes del periodo, errores, rendimiento con 500 actividades). Regla: toda pantalla nueva con datos se contrasta contra la API (oráculo), no solo contra el texto esperado. Para inyectar fallos de red con `page.route` hay que usar `test.use({ serviceWorkers: 'block' })` (el service worker se salta `page.route`).
- Seguridad (Fase 16): ver [docs/security.md](docs/security.md). Reglas vigentes: toda ruta no-GET pasa por `originCheck` (CSRF) y debe añadirse a la matriz de `http.security.test.ts` (una prueba de inventario falla si falta); todo recurso nuevo con id debe entrar en la matriz de `ownership.security.test.ts` (ajeno = mismo 404 que inexistente, BD sin cambios); toda la API responde `Cache-Control: no-store`; esquemas de escritura `strict` (el login es la única excepción, a propósito); cookie de sesión `__Host-` bajo HTTPS (`sessionCookieName`); inicio de sesión revoca el token anterior y hay tope de 20 sesiones por usuario; `TRUST_PROXY` con número exacto de proxies (nunca `true`), `CORS_ORIGIN` exacto (nunca `*`), `WEB_DIST_DIR` sirve la app en producción con la CSP real (`script-src 'self'`, sin `unsafe-inline`/`unsafe-eval`); en el navegador Zod va `jitless` (`zodRuntime.ts` de core, primer import) para no violar la CSP. Comprobaciones: `npm run security:scan`, `npm run test:security`, `npm run test:security:browser` (topología de producción en el puerto 4300).
- UX/accesibilidad (Fase 15): ver [docs/ux-accessibility.md](docs/ux-accessibility.md). Reglas vigentes: `Modal` pregunta antes de descartar si el estudiante escribió algo (Escape/clic fuera); un refresco fallido **no** reemplaza datos ya mostrados (`QueryError`); horas siempre 12 h con a. m./p. m. (`formatClockRange`/`formatClock` de core; nunca `HH:mm` en pantalla); cuadrícula de Agenda solo desde 1024 px; rutas secundarias con `React.lazy`; un `h1` por pantalla y título de documento por ruta; 401 con sesión = aviso «Tu sesión expiró» y login. `npm run dev:e2e` escucha en IPv4+IPv6 (`WEB_HOST=::`).
- Importación de horario (Fase 14): interpretación pura en `packages/core/src/scheduleImport.ts` sobre una representación intermedia (palabras con posición); extracción en `apps/api/src/scheduleImport/` (Tesseract local para imágenes y PDF escaneados, texto nativo `unpdf` primero). Solo **propone** (nunca crea); el archivo vive en memoria y no se guarda ni se registra su contenido; cada clase confirmada se crea con el `POST /api/schedule` normal. La asignatura LIKELY nunca se aplica sin confirmar; no se crean asignaturas. Ver [docs/schedule-import.md](docs/schedule-import.md).
- PWA (Fase 13): `vite-plugin-pwa` (Workbox `generateSW`, `registerType: 'prompt'`) en `apps/web/vite.config.ts`; UI en `apps/web/src/pwa/`. Solo precachea el shell estático; **`/api/*` siempre `NetworkOnly`, nunca se guardan respuestas privadas**; sin offline de datos ni escrituras offline. El SW no corre en `npm run dev`. La actualización nunca recarga sola. Ver [docs/pwa.md](docs/pwa.md).
- Bandeja académica (Fase 12): `packages/core/src/academicInbox.ts` (segmentación, contexto por oración, duplicados) sobre los bloques compartidos de `captureShared.ts` (también usados por Captura rápida). Pega → Interpretar → Revisar → Confirmar; máx. 5000 caracteres y 10 propuestas; no guarda el texto ni crea nada: cada propuesta se confirma con el `POST /api/activities` normal, una por una. `/inbox`. Ver [docs/academic-inbox.md](docs/academic-inbox.md).
- Captura rápida (Fase 11): `packages/core/src/quickCapture.ts`. Parser determinístico sin IA; solo **propone** (Capturar → Interpretar → Confirmar). Confirmar usa el `POST /api/activities` y la mutación del formulario manual: la captura rápida **no tiene camino de creación propio**. Nunca inventa una asignatura (ambigua o faltante se pregunta), no corrige en silencio una fecha fuera del periodo y no guarda el texto.
- Progreso y carga (Fase 10): descriptivos, derivados y nunca guardados (`packages/core/src/insights.ts`). Progreso por asignatura = la regla del Dashboard, alfabético y sin ponderar; carga semanal lunes-domingo en la zona del perfil, reutilizando `expandBlock` de la agenda; una actividad es 1 compromiso y 0 horas; sin niveles de carga ni lenguaje de juicio ("sobrecargado", "deberías").
- Atención (Fase 9): motor determinístico en `packages/core/src/attention.ts` (reutiliza `calculateRadarStatus`); el score es interno y nunca se muestra ni se persiste; las razones son plantillas fijas; el servicio siempre aplica el comparador, nunca el orden de la BD; tono neutral ("requiere mayor atención"), sin órdenes ni culpa.
- Radar (Fase 8): categoría derivada por duración real en `packages/core/src/radar.ts` (`calculateRadarStatus`); nunca se persiste ni se duplica la regla; no es prioridad.
- Recordatorios (Fase 7): solo `Activity`; AUTO se recalcula solo si cambian `dueAt`, `type` o el cruce a `COMPLETED`; MANUAL nunca se sobrescribe; el mensaje se deriva, no se guarda.

## Convenciones

- TanStack Query: invalidar `['activities']`, `DASHBOARD_KEY` y `['reminders']` desde las mutaciones de actividades.
- UI: legible a 360 px, sin desbordamiento horizontal, controles táctiles ≥ 44 px, estados siempre con texto (no solo color), `aria-label` en botones sin texto claro.
- E2E: tras abrir un diálogo que carga datos (editar bloque), esperar a un campo del formulario antes de medirlo (hay un diálogo provisional con el mismo nombre).
- E2E: nunca esperar con una aserción ya cierta (p. ej. el texto de una `<option>` dentro de la propia tarjeta) antes de recargar o navegar: espera el efecto real (valor de un control controlado, aparición/desaparición de elementos) o el `PATCH` queda abortado.
- Tests: Vitest (core/api/web), Supertest contra BD real, Playwright con el helper `watch(page, alsoExpected)`. Hacer _mutation checks_ en reglas críticas y revertirlos (`grep MUTATION` debe dar 0). Las capturas de revisión van en un spec temporal que se borra.
- Zona horaria en tests e2e: probar navegador en `Asia/Tokyo` con perfil Bogotá.

## Trampas del entorno (Windows)

- Antes de `test:browser` comprueba que **nada escucha en :3000/:5173**. Matar `npm run dev` solo por puerto deja vivo el vigilante `node --watch`, que revive la API (con la BD de **desarrollo**) y el e2e se ejecuta contra ella: 429 en el registro, decenas de fallos y usuarios basura en la BD de desarrollo. Mata el árbol completo del `npm run dev` (`taskkill /PID <npm> /T /F`) y verifica con `netstat`.
- Docker Desktop puede no estar arrancado: abrirlo y esperar a `docker info` antes de `npm run db:up`.
- PowerShell 5.1 corrompe UTF-8 al leer/escribir con `Get-Content`/`Set-Content`; usar Read/Write/Edit. Heredocs largos en Bash pueden fallar al parsear: preferir Write.
- `.gitattributes` fija `eol=lf`; si `format:check` falla tras un `pull` por CRLF, `npx prettier --write .` lo normaliza sin cambiar contenido. Un aviso LF→CRLF de `git add` es inocuo.

## Fuera de alcance hasta nueva orden

Verificación de correo, recuperación de contraseña, MFA, OAuth, roles, eliminación de cuenta y CAPTCHA externo (documentados como mejoras futuras en docs/security.md). Push/Web Push/correo/SMS, IA (incluida visión), sincronización offline completa (escrituras offline, colas, background sync), integración con calendarios externos, duración estimada, dificultad y recomendaciones basadas en hábitos.
