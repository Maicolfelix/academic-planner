# CLAUDE.md

Academic Planner: PWA universitaria de planeación académica (asignaturas, actividades, agenda, Radar, «¿Qué hago ahora?», progreso, Captura rápida, Bandeja académica, importación de horario con OCR local). Monorepo npm workspaces: `apps/api` (Express 5 + Prisma 7 + PostgreSQL 17), `apps/web` (React 19 + Vite + Tailwind + TanStack Query), `packages/core` (reglas puras + Zod compartidos), `e2e` (Playwright). Estado actual y riesgos: [docs/project-state.md](docs/project-state.md). Índice de documentación: [docs/README.md](docs/README.md).

## Reglas de trabajo (obligatorias)

- **Sistema de fases estricto.** Solo se implementa la fase que el usuario entrega explícitamente. Nunca avanzar a la siguiente por iniciativa propia ni adelantar trabajo de fases futuras.
- Una fase se aprueba solo tras lint, format, typecheck, tests, build, migraciones, verificación en navegador y sin defectos bloqueantes. El informe final termina exactamente con `FASE N APROBADA` o `FASE N BLOQUEADA`.
- **Commit solo cuando el usuario lo pida** (las fases lo piden explícitamente si quedan aprobadas). Mensajes con prefijo (`feat:`, `test:`, `docs:`); `git commit -F <archivo>` para mensajes con comillas. Un PR por fase, **sin fusionarlo** salvo orden del usuario.
- Responder y documentar en español; código y nombres en inglés.
- Fuente de verdad: **código → pruebas → documentos**. Si un documento contradice al código, se corrige el documento. No afirmar impacto académico (rendimiento, estrés, notas): el software no lo ha medido.
- **Roadmap completo (Fases 0–20). Estado del proyecto: Release Candidate `1.0.0-rc.2`** ([notas](docs/release-notes-1.0.0-rc.2.md); ficha de rc.1: [docs/release-manifest.md](docs/release-manifest.md)). **No existe una Fase 21** y no se debe inventar ni proponer una: cualquier trabajo nuevo (arreglos, versión final, nuevas funciones) requiere un **alcance explícito del usuario**.
- **Congelación de funcionalidades:** sin pantallas, entidades, endpoints funcionales, reglas de dominio ni integraciones nuevas. Una idea nueva se documenta como trabajo futuro, no se implementa. Hallazgos: BLOCKER/HIGH se corrigen; MEDIUM/LOW se documentan salvo arreglo trivial y seguro.
- **Versiones y etiquetas:** `v1.0.0-rc.1` está publicado y es **inmutable** (nunca `git tag -f` ni force push). Un tag nuevo (`v1.0.0-rc.2`) se crea **solo después de fusionar** el PR del candidato, desde `main` (nunca desde una rama sin fusionar); no se publica un `v1.0.0` final ni un GitHub Release sin orden del usuario.

## Comandos

```bash
npm run db:up && npm run db:deploy     # PostgreSQL 17 (Docker, host :5433) y migraciones (dev)
npm run dev                            # core + api :3000 + web :5173
npm run lint && npm run format:check && npm run typecheck
npm test                               # Vitest: core, api (BD real *_test), web
npm run build
PW_CHANNEL=msedge npm run test:browser # Playwright 360/1366 px; stack propio `dev:e2e` en :5173
npm run test:security && npm run test:security:browser   # seguridad (API y navegador, puerto 4300)
npm run docs:check                     # enlaces, archivos y scripts de la documentación
npm run db:seed:demo -- --allow-demo   # datos demo (solo desarrollo; docs/demo.md)
```

Los tests de API usan PostgreSQL real (Docker arriba); se niegan a correr contra una BD que no termine en `_test`, que se crea y migra sola (`ensureTestDatabaseSync` también para Playwright). Guía completa: [docs/development.md](docs/development.md).

## Invariantes (no romperlos)

- **Capas de la API:** ruta → controlador delgado (Zod `strictObject`, dueño desde la **sesión**) → servicio (reglas) → repositorio (siempre con `userId`) → Prisma. Un recurso ajeno o inexistente responde el **mismo 404**.
- **Reglas puras en `packages/core`** (se compila a `dist`: `npm run build -w @planner/core` tras cambiarlo). Reloj inyectable (`clock`) para tests.
- **Fechas:** instantes UTC + `User.timezone` (America/Bogota). Toda la lógica horaria en `core/time.ts` y `calendar.ts`; **nunca** matemática de zonas en la UI. Semana lunes–domingo. Actividad sin hora vence al final del día local. Horas en pantalla siempre 12 h con a. m./p. m. (`formatClock`/`formatClockRange`).
- **Derivado, no guardado:** «vencida», Radar, puntaje de Atención, progreso y carga se calculan al leer.
- **Proponer, no crear:** Captura rápida, Bandeja e Importación no tienen camino de creación propio; confirmar usa `POST /api/activities` / `POST /api/schedule`. Nunca inventan una asignatura. Determinísticos, sin IA; no guardan el texto ni el archivo.
- **Recordatorios:** solo de `Activity`; AUTO se recalcula solo si cambian `dueAt`, `type` o el cruce a `COMPLETED`; MANUAL nunca se sobrescribe.
- **Atención:** el motor pone toda vencida de ≤ 7 días por encima de las «inmediatas»; el puntaje es interno. Tono neutral, sin órdenes ni culpa. Progreso y carga son descriptivos, sin juicios.
- **BD:** invariantes críticas con SQL a mano al final de la migración (índices únicos parciales, `CHECK`). **Nunca editar una migración aplicada**: crear otra. Escrituras multi-tabla en transacción; ediciones concurrentes de una actividad con `FOR UPDATE`. Sin N+1 (`relationLoadStrategy: 'join'`; el Dashboard usa 9 consultas).
- **Seguridad** ([docs/security.md](docs/security.md)): toda ruta no-GET pasa por `originCheck` y entra en la matriz de `http.security.test.ts`; todo recurso con id entra en la matriz de `ownership.security.test.ts`; la API responde `Cache-Control: no-store`; cookie `__Host-` bajo HTTPS; `TRUST_PROXY` con número exacto (nunca `true`), `CORS_ORIGIN` exacto (nunca `*`); CSP real sin `unsafe-inline`/`unsafe-eval` (Zod `jitless` en el navegador, `zodRuntime.ts` primer import). Seed demo: se niega con `NODE_ENV=production` y exige `--allow-demo`; solo toca a `demo@academicplanner.local`.
- **PWA** ([docs/pwa.md](docs/pwa.md)): solo precachea el shell; `/api/*` siempre `NetworkOnly`; sin offline de datos; la actualización nunca recarga sola. El SW no corre en `npm run dev`.
- **UI:** legible a 360 px, sin desbordes, controles táctiles ≥ 44 px, estados con texto (no solo color), `aria-label` en botones sin texto, un `h1` por pantalla, `Modal` pregunta antes de descartar, un refresco fallido no reemplaza datos mostrados ([docs/ux-accessibility.md](docs/ux-accessibility.md)). Mutaciones de actividades invalidan `['activities']`, `DASHBOARD_KEY` y `['reminders']`.

## Convenciones de pruebas

Vitest (core/api/web), Supertest contra BD real, Playwright con `watch(page, alsoExpected)`. Hacer _mutation checks_ en reglas críticas y revertirlos (`grep MUTATION` debe dar 0). En e2e: no esperar con una aserción ya cierta; esperar el efecto real; antes de cerrar sesión o borrar la cookie esperar a que cargue la pantalla (`networkidle`); para fallos de red con `page.route` usar `serviceWorkers: 'block'`; navegador en `Asia/Tokyo` con perfil Bogotá para zona horaria. Una falla intermitente se investiga con su traza, no se repite hasta que pase. Capturas de revisión en un script temporal que se borra. Ver [docs/testing.md](docs/testing.md).

## Trampas del entorno (Windows)

- Antes de `test:browser` comprobar que **nada escucha en :3000/:5173**. Matar `npm run dev` solo por puerto deja vivo el vigilante `node --watch`, que revive la API (con la BD de **desarrollo**) y el e2e corre contra ella. Matar el árbol (`taskkill /PID <npm> /T /F`) y verificar con `netstat`.
- Docker Desktop puede no estar arrancado (esperar a `docker info`). El contenedor `academic-planner-db` tiene nombre fijo: `docker compose down -v` se ejecuta en la carpeta que lo creó.
- PowerShell 5.1 corrompe UTF-8 con `Get-Content`/`Set-Content`: usar Read/Write/Edit. `.gitattributes` fija `eol=lf` (si `format:check` falla por CRLF: `npx prettier --write .`). Un aviso LF→CRLF de `git add` es inocuo.

## Limitaciones vigentes ([docs/limitations.md](docs/limitations.md))

Sin validar en dispositivos iOS/Android reales ni tras HTTPS/proxy reales; sin despliegue. `npm audit` = 4 altas de la cadena del CLI de Prisma (no alcanzables; esperar una estable que las corrija, nunca `--force`). Desde el RC además 2 críticas de `shell-quote` vía `concurrently` (solo desarrollo; `--omit=dev` sigue en 4). Límites de frecuencia en memoria; el registro revela si un correo existe; sesión fija de 7 días; sin verificación de correo, recuperación de contraseña ni MFA; sin UI para editar el periodo ni la zona horaria. Sin licencia explícita (decisión del propietario).

## Fuera de alcance hasta nueva orden

Verificación de correo, recuperación de contraseña, MFA, OAuth, roles, eliminación de cuenta y CAPTCHA externo. Push/Web Push/correo/SMS, IA (incluida visión), sincronización offline completa, integración con calendarios externos, duración estimada, dificultad y recomendaciones basadas en hábitos.
