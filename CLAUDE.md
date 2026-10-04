# CLAUDE.md

Academic Planner: PWA universitaria de planeación académica. Monorepo npm workspaces (`apps/api`, `apps/web`, `packages/core`, `e2e`). Estado completo, arquitectura y riesgos en [docs/project-state.md](docs/project-state.md).

## Reglas de trabajo (obligatorias)

- **Sistema de fases estricto.** Solo se implementa la fase que el usuario entrega explícitamente. Nunca avanzar a la siguiente por iniciativa propia ni adelantar trabajo de fases futuras.
- Una fase se aprueba solo tras lint, format, typecheck, tests, build, migraciones, verificación en navegador y sin defectos bloqueantes. El informe final termina exactamente con `FASE N APROBADA` o `FASE N BLOQUEADA`.
- **Commit solo cuando el usuario lo pida.** Mensajes con prefijo `feat:`; usar `git commit -F <archivo>` para mensajes con comillas.
- Responder y documentar en español.
- Fase actual: **7 aprobada y commiteada. Fase 8 sin empezar** (esperar el prompt del usuario).

## Comandos

```bash
npm run db:up                       # PostgreSQL 17 (Docker) en :5433
npm run db:deploy                   # aplicar migraciones (dev)
npm run lint && npm run format:check && npm run typecheck
npm test                            # Vitest: core, api (BD real *_test), web
npm run build
PW_CHANNEL=msedge npm run test:browser   # Playwright 360 px y 1366 px; no tener `npm run dev` corriendo
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
- Recordatorios (Fase 7): solo `Activity`; AUTO se recalcula solo si cambian `dueAt`, `type` o el cruce a `COMPLETED`; MANUAL nunca se sobrescribe; el mensaje se deriva, no se guarda.

## Convenciones

- TanStack Query: invalidar `['activities']`, `DASHBOARD_KEY` y `['reminders']` desde las mutaciones de actividades.
- UI: legible a 360 px, sin desbordamiento horizontal, controles táctiles ≥ 44 px, estados siempre con texto (no solo color), `aria-label` en botones sin texto claro.
- Tests: Vitest (core/api/web), Supertest contra BD real, Playwright con el helper `watch(page, alsoExpected)`. Hacer _mutation checks_ en reglas críticas y revertirlos (`grep MUTATION` debe dar 0). Las capturas de revisión van en un spec temporal que se borra.
- Zona horaria en tests e2e: probar navegador en `Asia/Tokyo` con perfil Bogotá.

## Trampas del entorno (Windows)

- Docker Desktop puede no estar arrancado: abrirlo y esperar a `docker info` antes de `npm run db:up`.
- PowerShell 5.1 corrompe UTF-8 al leer/escribir con `Get-Content`/`Set-Content`; usar Read/Write/Edit. Heredocs largos en Bash pueden fallar al parsear: preferir Write.
- Los avisos LF→CRLF de git son inocuos.

## Fuera de alcance hasta nueva orden

Push/Web Push/correo/SMS, service worker, OCR, importación, IA, captura rápida, bandeja, PWA instalable, Radar y "¿Qué hago ahora?".
