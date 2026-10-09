# CLAUDE.md

Academic Planner: PWA universitaria de planeación académica (asignaturas, actividades, agenda, Radar, «¿Qué hago ahora?», progreso, Captura rápida, Bandeja académica, importación de horario con OCR local). Monorepo npm workspaces: `apps/api` (Express 5 + Prisma 7 + PostgreSQL 17), `apps/web` (React 19 + Vite + Tailwind + TanStack Query), `packages/core` (reglas puras + Zod compartidos), `e2e` (Playwright). Estado actual y riesgos: [docs/project-state.md](docs/project-state.md). Índice de documentación: [docs/README.md](docs/README.md).

**Visión (ciclo post-RC, planificación):** Academic Planner convierte horarios, planes de curso, calendarios y mensajes académicos en un semestre organizado, ayuda al estudiante a decidir qué hacer y le da herramientas para hacerlo. _No debe pedirle al estudiante que organice la aplicación; la aplicación debe organizar lo que el estudiante ya recibe_, y _organizarse no debe convertirse en otra tarea_. Nada de esto está implementado salvo lo que describe el código (RC).

## Reglas de trabajo (obligatorias)

- **Sistema de fases estricto (histórico) y aprobación por etapa (ciclo actual).** Solo se implementa lo que el usuario entrega explícitamente: una fase en el roadmap original, un objetivo/PR en el ciclo post-RC. Nunca avanzar al siguiente por iniciativa propia ni adelantar trabajo futuro.
- Una fase se aprueba solo tras lint, format, typecheck, tests, build, migraciones, verificación en navegador y sin defectos bloqueantes. El informe final termina exactamente con `FASE N APROBADA` o `FASE N BLOQUEADA`.
- **Commit solo cuando el usuario lo pida** (las fases lo piden explícitamente si quedan aprobadas). Mensajes con prefijo (`feat:`, `test:`, `docs:`); `git commit -F <archivo>` para mensajes con comillas. Un PR por fase, **sin fusionarlo** salvo orden del usuario.
- Responder y documentar en español; código y nombres en inglés.
- Fuente de verdad: **código → pruebas → documentos**. Si un documento contradice al código, se corrige el documento. No afirmar impacto académico (rendimiento, estrés, notas): el software no lo ha medido.
- **Roadmap original (Fases 0–20) cerrado. Release publicado: `v1.0.0-rc.2`** ([notas](docs/release-notes-1.0.0-rc.2.md); ficha de rc.1: [docs/release-manifest.md](docs/release-manifest.md)). **No existe una Fase 21** y no se debe inventar ni proponer una.
- **Ciclo de producto post-RC activo** ([docs/roadmap-post-rc.md](docs/roadmap-post-rc.md)): etapas 0 y A–E, trabajadas con **PR pequeños** (rama nueva, nunca sobre los tags). **Cada etapa y cada objetivo necesita aprobación explícita del usuario**; al terminar una etapa se detiene el trabajo y se espera. El roadmap es un plan, **no autoriza** implementar nada. Estado: A1 (Schedule Import crea las asignaturas faltantes) **fusionado** (PR #18, `00f63ac`); spike del calendario A4-0/A4-0b **fusionado** (PR #20, `6c9a673`); **A4.1 «Añadir al calendario»** (`.ics` por actividad, [docs/calendar-export.md](docs/calendar-export.md)) **fusionado** (PR #21, `ff1ca2c`) con QA real en iPhone + Safari + Apple Calendar (Android, Google, Outlook y PWA sin probar); **A4.2 (feed sincronizado) diferido** hasta que haya evidencia; **UX1-0** (base visual: tokens y primitivas `Button`/`Card`/`Badge`, [docs/ux-accessibility.md](docs/ux-accessibility.md#sistema-visual-ux1-0)) fusionado (PR #22, `39f8505`); **UX1-1** (shell y navegación: barra inferior en teléfono/tableta, superior desde 1024 px) **fusionado** (PR #23) y validado en un iPhone real; **UX1-2** (Home, paleta propia, jerarquía de superficies y movimiento sutil) y sus pasadas **UX1-2.5** (movimiento y personalidad) y **UX1-2.75** («Pulso Ambiental»: luz ambiental, escritorio en dos columnas, Radar vivo; sin dependencias nuevas) **fusionados en el mismo PR (#24) y aprobados en un iPhone real** (deuda visual esperada; `MASTER` es deuda de pruebas dependiente de la hora, TEST-REL-1); **UX1-3** (Actividades + Asignaturas: tarjeta con una acción primaria y menú «Más acciones», filtros y rejillas nuevos; sin dependencias) está **fusionado (PR #25) y aprobado en un iPhone real**; **UX1-4** (formularios y diálogos: campos nativos tonales, `Modal` con entrada, pie común, recordatorios integrados; sin dependencias ni cambios de validación) está **implementado en su PR (`feat/ux1-forms-dialogs`) y pendiente de QA real en iPhone**; los siguientes pasos (UX2a, notas…) no se inician sin aprobación explícita ([docs/project-state.md](docs/project-state.md)).
- **Alcance:** solo se construye lo que el usuario entrega explícitamente; sin pantallas, entidades, endpoints funcionales, reglas de dominio ni integraciones nuevas por iniciativa propia. Una idea nueva se documenta como trabajo futuro (en el roadmap), no se implementa. Hallazgos: BLOCKER/HIGH se corrigen; MEDIUM/LOW se documentan salvo arreglo trivial y seguro. Una función solo vale si **elimina más trabajo del que añade** al estudiante.
- **Versiones y etiquetas:** `v1.0.0-rc.1` y `v1.0.0-rc.2` están publicados y son **inmutables** (nunca `git tag -f`, nunca mover un tag, nunca force push). Un tag nuevo se crea **solo después de fusionar** el PR correspondiente, desde `main` (nunca desde una rama sin fusionar); no se publica un `v1.0.0` final ni un GitHub Release sin orden del usuario. El esquema de versiones por etapa del roadmap es una propuesta: la versión de cada entrega la decide el mantenedor.

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
- **Proponer, confirmar y crear únicamente después de confirmación explícita.** Nada se persiste por una entrada (texto, archivo, calendario) sin que el estudiante vea una propuesta y la confirme (CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR). **Hoy:** Captura rápida y Bandeja no tienen camino de creación propio (confirmar usa `POST /api/activities`) y nunca inventan una asignatura. La **Importación de horario** (A1, fusionada en el PR #18) confirma con `POST /api/schedule-import/confirm`: una transacción todo-o-nada que crea las asignaturas **nuevas que el estudiante vio y aceptó** (nombre editable, nunca una asignatura sin confirmar) y las clases, reutilizando `ScheduleService`; el servidor deriva usuario, periodo, `nameKey` y color. Todos son determinísticos, sin IA, y no guardan el texto ni el archivo (decisión D16 en [docs/decisions.md](docs/decisions.md), [docs/schedule-import.md](docs/schedule-import.md)).
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

Verificación de correo, recuperación de contraseña, MFA, OAuth, roles, eliminación de cuenta y CAPTCHA externo. Push/Web Push/correo/SMS, IA (incluida visión), sincronización offline completa, integración con calendarios externos (salvo el archivo `.ics` por actividad de A4.1: sin feed, sin OAuth, sin API de Google), duración estimada, dificultad y recomendaciones basadas en hábitos.

Varias de estas ideas **están planificadas** en el [roadmap post-RC](docs/roadmap-post-rc.md) (feed e importación `.ics`, esfuerzo personal, IA asistiva opcional, recuperación de contraseña antes de un despliegue público abierto), pero **siguen sin implementarse y fuera de alcance hasta que el usuario apruebe esa etapa u objetivo**. La suscripción por URL a calendarios (A3) está explícitamente diferida. Si se añade IA: asistiva, opcional (sin `AI_PROVIDER` queda desactivada), nunca decide fechas, notas, porcentajes, estado, agenda ni recordatorios.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Graphify sirve para **navegación y contexto**, no sustituye la lectura crítica del código. La fuente de verdad sigue siendo código → pruebas → documentos. `graphify-out/` es un artefacto local y no se versiona.
