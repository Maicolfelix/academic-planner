# Estado del proyecto: Academic Planner

PWA universitaria de planeación académica, construida por **fases estrictas**. Este documento es la fuente de verdad del estado actual. Actualízalo al cerrar cada fase.

> Nota: se pidió "hasta la Fase 6", pero la Fase 7 ya está implementada, aprobada y commiteada (`404a032`), así que se incluye.

## Fase actual

- **Última fase completada y aprobada: Fase 8 (Radar académico).**
- **Siguiente: Fase 9, sin empezar.** Solo se implementa cuando el usuario entregue su prompt. Nunca se avanza por iniciativa propia.
- Árbol de trabajo limpio tras el commit de la Fase 7 (salvo este documento y `CLAUDE.md`).

## Fases completadas

| Fase | Contenido                                                                    | Commit        |
| ---- | ---------------------------------------------------------------------------- | ------------- |
| 0    | Contexto y decisiones (monorepo, PostgreSQL, sesiones propias, zona horaria) | n/a           |
| 1    | Foundation: monorepo, API, web, Prisma, tooling, Playwright                  | `f542f5e`     |
| 2    | Autenticación: registro, login, logout, sesiones en servidor                 | `095c12c`     |
| 3    | Periodos académicos y asignaturas (CRUD, propiedad, onboarding)              | `da5eda9`     |
| 4-5  | Actividades académicas y Dashboard                                           | `6501bd9`     |
| 6    | Agenda, horarios y recurrencia semanal                                       | `7a031fb`     |
| 7    | Recordatorios internos automáticos para actividades                          | `404a032`     |
| 8    | Radar académico: categorías derivadas por tiempo restante                    | ver `git log` |

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

Documentos por área: [auth](auth.md), [academic](academic.md), [activities](activities.md), [dashboard](dashboard.md), [schedule](schedule.md), [reminders](reminders.md), [radar](radar.md).

## Fuera de alcance hasta nueva orden

Push/Web Push/correo/SMS, service worker, OCR, importación, IA, captura rápida, bandeja, PWA instalable, "¿Qué hago ahora?", scoring de recomendación y carga semanal. Cada uno pertenece a una fase futura definida por el usuario.

## Totales de tests (tras la Fase 8)

Vitest: core 298, API 394, web 28 (720). Playwright: 84 (móvil 360 px y escritorio 1366 px).

## Riesgos conocidos

- Un recordatorio AUTO eliminado por el estudiante no vuelve hasta que cambie la fecha, el tipo o el estado de la actividad (documentado).
- Los offsets de recordatorio son minutos absolutos: en un cambio de horario "1 día antes" son 24 h reales.
- `/api/reminders/due` solo cubre el periodo actual.
- Un e2e (`activities.spec` "activity flow", escritorio) falló una vez bajo carga completa (Fase 7) sin causa encontrada; no reapareció en 5 pasadas completas posteriores (en monitoreo). Si vuelve, investigar la causa con la evidencia, no solo reejecutar.
- `npm audit` reporta vulnerabilidades altas en dependencias de desarrollo del CLI de `prisma` (`mysql2`, `deepmerge-ts`); no se usa MySQL. Revisar en la fase de endurecimiento.
- Sin notificaciones fuera de la app: solo recordatorios internos.
- Windows: Git avisa de conversión LF→CRLF; es inocuo. Los scripts de PowerShell 5.1 pueden corromper UTF-8 al leer/escribir; usar las herramientas de edición.

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
PW_CHANNEL=msedge npm run test:browser   # Playwright (levanta su propio stack contra la BD de test; parar `npm run dev` antes)
```

Verificación de instalación limpia: `docker compose down -v`, borrar `node_modules`, `dist`, `apps/api/src/generated`, `test-results` y `.env`, y repetir la secuencia anterior. Comprobar también que no hay drift de esquema (`prisma migrate diff ... --exit-code`) y que la BD de desarrollo queda sin filas tras los tests.

## Cómo trabajar una fase

1. Leer el prompt de la fase y limitarse a ese alcance.
2. Implementar por capas, con tests de núcleo, API (BD real), web y Playwright.
3. Probar propiedad (IDOR), concurrencia y zona horaria; hacer _mutation checks_ y revertirlos.
4. Ejecutar la validación completa desde instalación limpia.
5. Entregar el informe estructurado terminado en `FASE N APROBADA` o `FASE N BLOQUEADA`.
6. Commit solo cuando el usuario lo pida.
