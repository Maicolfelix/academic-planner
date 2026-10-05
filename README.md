# Planificador Académico (PWA)

Aplicación web progresiva para organizar asignaturas, actividades, agenda y progreso académico.
Estado actual: **Fase 13 completada (PWA instalable)**; siguiente: Fase 14. Estado, arquitectura, riesgos y cómo levantarlo desde cero: [docs/project-state.md](docs/project-state.md). Reglas de trabajo para sesiones de Claude: [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node.js ≥ 22.18 (probado con 24 LTS; ver `.nvmrc`) y npm ≥ 10
- Docker Desktop (PostgreSQL se ejecuta con Docker Compose)

## Ejecutar desde cero

```bash
npm ci                      # instala todo; el postinstall compila @planner/core y genera el cliente Prisma
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run db:up               # levanta PostgreSQL 17 (host :5433) y espera a que esté sano
npm run db:deploy           # aplica las migraciones a la BD de desarrollo
npm run dev                 # API :3000 + Web :5173 (con proxy /api)
```

Abre http://localhost:5173 → te lleva a `/login`. Crea una cuenta en `/register`; un usuario nuevo pasa por `/onboarding`
(configurar el semestre) y llega a `/subjects` para agregar sus asignaturas.
Estado del sistema: http://localhost:5173/status o `curl http://localhost:3000/api/health`.

PostgreSQL usa el puerto **5433** del host para no chocar con una instalación local en 5432.

## Base de datos y migraciones

| BD                                            | Uso                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `academic_planner` (`DATABASE_URL`)           | Desarrollo                                                                      |
| `academic_planner_test` (`TEST_DATABASE_URL`) | Tests de integración y Playwright. Se crea y migra sola. Nunca la de desarrollo |

- `npm run db:migrate` → crea y aplica una migración nueva en desarrollo (`prisma migrate dev --name ...`) y regenera el cliente (`npm run db:generate` si hace falta).
- `npm run db:deploy` → aplica las migraciones existentes (instalación nueva, producción).
- Nunca se edita una migración ya aplicada: se crea otra.
- Reiniciar la BD de desarrollo desde cero: `docker compose down -v && npm run db:up && npm run db:deploy`.

Migraciones actuales:

1. `init` (Fase 1).
2. `auth_user_session_drop_app_metadata` (Fase 2): crea `User` y `Session`, elimina la tabla provisional `AppMetadata`.
3. `academic_periods_and_subjects` (Fase 3): crea `AcademicPeriod` y `Subject`. Incluye SQL escrito a mano (índice único parcial de "un solo periodo actual por usuario" y `CHECK endDate > startDate`) porque Prisma no sabe expresarlos.
4. `activities` (Fase 4): crea `Activity` y sus enums, con un `CHECK` escrito a mano que liga `status = COMPLETED` con `completedAt`.
5. `schedule_blocks` (Fase 6): crea `ScheduleBlock`, con `CHECK` escritos a mano (`endAt > startAt` y duración ≤ 24 h; serie semanal ⇔ fecha final).
6. `reminders` (Fase 7): crea `Reminder` (FK a `Activity` con `ON DELETE CASCADE`), con un `CHECK` (AUTO ⇔ tiene offset negativo) y un índice único parcial `(activityId, offsetMinutes) WHERE kind = 'AUTO'`, escritos a mano.

## Scripts

| Script                                  | Qué hace                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                           | core (watch) + API + Web                                                           |
| `npm run lint` / `npm run format:check` | ESLint / Prettier (`npm run format` para corregir)                                 |
| `npm run typecheck`                     | `tsc` en todos los paquetes y en `e2e/`                                            |
| `npm test`                              | Vitest en todos los paquetes. La API usa PostgreSQL real (`academic_planner_test`) |
| `npm run build`                         | Build de producción de core, API y Web                                             |
| `npm run test:browser`                  | Playwright (360 px y 1366 px) contra su propio stack apuntando a la BD de test     |
| `npm run db:up` / `db:down`             | Inicia / detiene PostgreSQL                                                        |
| `npm run db:migrate` / `db:deploy`      | Migraciones (ver arriba)                                                           |

### Tests

`npm test` necesita PostgreSQL arriba (`npm run db:up`). Antes de correr, crea `academic_planner_test` si no existe, le aplica las migraciones
y cada test vacía las tablas; se niega a ejecutar si `TEST_DATABASE_URL` no termina en `_test` o es igual a `DATABASE_URL`.

### Playwright

Requiere un navegador: `npx playwright install chromium`. Si la descarga no es posible en tu red,
usa uno instalado: `PW_CHANNEL=msedge npm run test:browser`
(PowerShell: `$env:PW_CHANNEL='msedge'; npm run test:browser`).
`test:browser` arranca su propio `npm run dev` (apuntando a la BD de test), así que **detén cualquier `npm run dev` en :5173 antes**.

## Autenticación

Sesiones server-side en PostgreSQL con cookie `academic_planner_session` (HttpOnly, SameSite=Lax, 7 días, `Secure` en producción), contraseñas con Argon2id,
verificación de origen contra CSRF y rate limiting en login/registro. Detalle, decisiones y limitaciones en [docs/auth.md](docs/auth.md).

Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
Pantallas: `/register` y `/login`. El Dashboard real es de la Fase 5.

## Periodos y asignaturas

`/api/periods` y `/api/subjects` (CRUD, todos con sesión). Cada recurso pertenece al usuario de la sesión; el de otro usuario responde `404`, igual que uno inexistente.
Las fechas académicas son `DATE` (`YYYY-MM-DD`, sin zona horaria). Decisiones, reglas de duplicados y de borrado en [docs/academic.md](docs/academic.md).
Pantallas: `/onboarding`, `/dashboard` (aún temporal), `/subjects`.

## Actividades

`/api/activities` (CRUD y filtros: asignatura, estado, prioridad, tipo, vencidas, rango de fechas; todos con sesión). Cada actividad pertenece a una asignatura del usuario;
el periodo se deriva de la asignatura. La fecha límite se guarda como instante UTC más `hasTime`, convertida con la zona horaria del usuario
(`America/Bogota` por defecto) por funciones de `@planner/core`; "vencida" es un valor derivado, nunca guardado. Una asignatura con actividades no se puede eliminar (`409 SUBJECT_NOT_EMPTY`).
Detalle en [docs/activities.md](docs/activities.md). Pantalla: `/activities` (filtros en la URL).

## Dashboard

`GET /api/dashboard` devuelve, en una sola petición, todo lo que muestra la pantalla de inicio para el periodo actual del usuario (resumen por estado, progreso,
próxima entrega, vencidas, para hoy y próximas). Todo se deriva de los datos reales; no se guarda nada. "Hoy" y el saludo usan la zona horaria del perfil (`User.timezone`).
Usa 8 consultas constantes (sin N+1). Reglas, estructura de la respuesta y decisiones en [docs/dashboard.md](docs/dashboard.md). Pantalla: `/dashboard` ("Inicio").

## Agenda

`/api/schedule` (CRUD y consulta semanal; todos con sesión). Una clase semanal es **una sola fila**: las ocurrencias se expanden al leer, solo para el rango pedido, con hora local (también a través de cambios de horario).
Los conflictos de horario son **advertencias**, no restricciones (`warnings` en la respuesta y `?dryRun=true` para avisar antes de guardar). Una asignatura o un periodo con bloques no se puede eliminar.
El Dashboard muestra las clases de hoy. Detalle y decisiones en [docs/schedule.md](docs/schedule.md). Pantalla: `/calendar` (escritorio: semana completa; móvil: lista por día).

## Radar académico

Clasifica cada actividad **abierta** por el tiempo real que falta para su fecha límite: Vencida, Atención inmediata (< 24 h), Próxima (≤ 72 h), Planificable (≤ 7 días) y Bajo control (> 7 días). Es derivado (nunca se guarda), determinístico y no es prioridad ni recomendación. Una sola regla en `packages/core`; `GET /api/radar`, filtro `GET /api/activities?radar=…`, tarjeta en el Dashboard y página `/radar`. Límites, reglas de borde y decisiones en [docs/radar.md](docs/radar.md).

## ¿Qué hago ahora?

Sugiere **una** actividad abierta que requiere mayor atención y explica por qué ("Vence en menos de 24 horas.", "Tiene prioridad alta.", "Ya comenzaste esta actividad."). Es determinístico, sin IA ni datos de comportamiento: suma el peso del nivel del Radar, el de la prioridad y un pequeño bono por "en proceso", y desempata por fecha. El score es interno: no se muestra. `GET /api/attention` y tarjeta en el Dashboard con enlace a la actividad. Fórmula, pesos, desempates y escenarios numéricos en [docs/attention-engine.md](docs/attention-engine.md).

## Captura rápida

Escribe una frase corta ("parcial redes martes 10am") en el Dashboard y la aplicación **propone** una actividad: tipo, asignatura, fecha, hora y título. Flujo **Capturar → Interpretar → Confirmar**: nada se guarda hasta que pulsas "Crear actividad", que usa el mismo `POST /api/activities` que el formulario manual (así heredan recordatorios, Radar, Atención, progreso y carga). Es un parser determinístico de reglas, sin IA ni servicios externos, y el texto no se guarda. `POST /api/quick-capture/parse`. Reglas, ejemplos y limitaciones en [docs/quick-capture.md](docs/quick-capture.md).

## Bandeja académica

En `/inbox` ("Bandeja académica") pegas un mensaje largo de un profesor (hasta 5000 caracteres) y la aplicación **propone** de 0 a 10 actividades: **Pegar → Interpretar → Revisar → Confirmar**. Reutiliza el parser de Captura rápida, es determinístico (sin IA ni servicios externos) y no guarda el texto. Cada propuesta se edita y se crea con el mismo `POST /api/activities` (una por una, sin transacción global). `POST /api/academic-inbox/parse`. Detalle en [docs/academic-inbox.md](docs/academic-inbox.md).

## Progreso y carga semanal

Dos vistas **descriptivas** de lo registrado (no miden rendimiento, productividad ni estrés y no recomiendan nada). **Progreso:** actividades completadas / registradas, en general y por asignatura (alfabético; "Sin actividades registradas" en vez de 0 %), solo del periodo actual. **Carga semanal:** compromisos de una semana lunes-domingo (actividades por su fecha límite + ocurrencias de la agenda), horas programadas, desglose por día y día con más compromisos, sin niveles "alta/baja". `GET /api/progress` y `GET /api/workload?week=<cualquier fecha>`; tarjeta "Esta semana" en el Dashboard y página `/progress`. Definiciones, qué cuenta y limitaciones en [docs/progress-and-workload.md](docs/progress-and-workload.md).

## Recordatorios

Recordatorios **internos** de la app solo para actividades (sin push, correo ni notificaciones del sistema). Al crear una actividad se generan solos según su tipo (p. ej. parcial: 3 días, 1 día y 3 horas antes); nunca se crea uno que ya haya pasado. Se recalculan solo si cambian la fecha/hora límite, el tipo o el estado (finalizar cancela los pendientes; reabrir regenera los futuros). Editar uno automático lo vuelve manual. `GET /api/reminders/due` alimenta el panel "Recordatorios" del Dashboard (máx. 20) y la insignia 🔔 de "Inicio"; nada se marca como visto al leer. Reglas, limitaciones y decisiones en [docs/reminders.md](docs/reminders.md).

## PWA instalable

Academic Planner se puede **instalar** (manifest, iconos, service worker, modo standalone; ayuda para iOS) y su shell estático abre sin conexión. **No es una app offline completa:** consultar o modificar datos académicos requiere conexión; sin ella verás un aviso claro. La API nunca se cachea (privacidad). Hay aviso de «Nueva versión» sin recargar solo. El service worker solo existe en `build` + `preview`/producción (no en `npm run dev`) y requiere HTTPS (o localhost). Detalle, depuración y límites en [docs/pwa.md](docs/pwa.md).

## Estructura

```
apps/api         Express + Prisma (routes → middleware → servicios; auth, health)
apps/web         React + Vite + Tailwind + React Router + TanStack Query
packages/core    Reglas puras, tipos y esquemas Zod compartidos (se compila a dist/)
e2e              Verificación en navegador (suite completa en Fase 17)
docs             Documentación técnica
```

## Variables de entorno

Ver `.env.example` (comentado). `.env` está en `.gitignore`; nunca se versiona.
Nuevas en esta fase: `TEST_DATABASE_URL`, `LOGIN_RATE_LIMIT_MAX`, `REGISTER_RATE_LIMIT_MAX`.

## Notas

- Todas las fechas se almacenan en UTC; zona horaria inicial `America/Bogota`.
- `npm audit` reporta vulnerabilidades en dependencias del CLI de `prisma` (`mysql2`, `deepmerge-ts`); solo de desarrollo, no se usa MySQL. Se revisará en la Fase 16.
