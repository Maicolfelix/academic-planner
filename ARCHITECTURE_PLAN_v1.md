# ARCHITECTURE PLAN v1 — PWA de Planificación Académica

Estado: Fase 0 (análisis). No se escribió código de producto.

## 1. Estado actual del repositorio

| Aspecto                 | Hallazgo                                                 |
| ----------------------- | -------------------------------------------------------- |
| Código existente        | Ninguno (proyecto desde cero, confirmado por el usuario) |
| Dependencias / configs  | Ninguna                                                  |
| Deuda técnica / errores | N/A                                                      |
| Git                     | Sin repositorio del proyecto; se crea en Fase 1          |

Entorno de desarrollo verificado:

| Herramienta | Estado                                                      | Implicación                                                               |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Node        | v20.12.2                                                    | Vite 7 exige Node ≥ 20.19 → usar **Vite 6** o actualizar Node (riesgo R1) |
| npm         | 10.8.1                                                      | OK; se usarán npm workspaces                                              |
| Git         | 2.44                                                        | OK                                                                        |
| PostgreSQL  | Servicio `postgresql-x64-18` activo; `psql` no está en PATH | Usable; alternativa reproducible: Docker                                  |
| Docker      | 29.5.3                                                      | `docker-compose.yml` con Postgres para instalación reproducible           |

Comparación contra el contexto maestro: 0 % implementado; todas las funciones están por construir.

## 2. Arquitectura final

### Frontend

React + Vite + TypeScript + Tailwind + React Router. Sin lógica de negocio: solo presentación, formularios y llamadas a la API. Estado de servidor con **TanStack Query** (justificación: el Dashboard debe actualizarse al mutar actividades "sin recargar toda la app"; la invalidación de queries lo resuelve de forma estándar). Formularios con **react-hook-form + zod resolver**, reutilizando los esquemas Zod compartidos.

### Backend

Node + TypeScript + Express en capas: `routes → controllers (delgados) → services (reglas de negocio) → repositories (Prisma)`. Reglas puras (vencimiento, urgencia, scoring, carga, parser) en `packages/core`, sin dependencias de Express ni Prisma, para testearlas con fechas controladas.

### Base de datos

PostgreSQL + Prisma. Migraciones versionadas. Toda tabla de dominio lleva `userId` con índice.

### Comunicación

REST JSON bajo `/api`, errores con formato uniforme `{ error: { code, message, details? } }`. En desarrollo, proxy de Vite hacia `/api` (mismo origen, cookies sin fricción, CORS innecesario). En producción, un único origen: Express sirve el build del frontend y la API.

### Autenticación

Sesión por **cookie HTTP-only** (ver §5).

## 3. Estructura de carpetas (monorepo npm workspaces)

```
/
├─ apps/
│  ├─ web/            # React + Vite + PWA
│  └─ api/            # Express + Prisma
│     ├─ prisma/      # schema.prisma, migrations, seed
│     └─ src/{routes,controllers,services,repositories,middleware,config}
├─ packages/
│  └─ core/           # reglas puras + esquemas Zod compartidos + tipos
├─ docs/              # architecture, database, business-rules, api, testing...
├─ e2e/               # Playwright
├─ docker-compose.yml # Postgres
├─ .env.example
└─ README.md
```

Justificación del monorepo: los esquemas Zod y las reglas puras se comparten entre cliente y servidor sin duplicar (requisito "no duplicar código"). Si `packages/core` resulta incómodo en Fase 1, la alternativa es dos paquetes con `core` copiado en el backend; no se espera.

## 4. Modelo de datos (conceptual)

- **User**: id, email (único, normalizado a minúsculas), passwordHash, name, timezone (default `America/Bogota`), createdAt.
- **AcademicPeriod**: id, userId, name, startDate, endDate, isCurrent. Alcance del "progreso del periodo" y fin de recurrencias.
- **Subject**: id, userId, periodId?, name, professor?, color, description?.
- **Activity**: id, userId, subjectId?, title, description?, type, priority, status, dueAt (timestamptz UTC), hasTime (bool: distingue "viernes" de "viernes 11:59pm"), completedAt?, createdAt, updatedAt.
- **ScheduleBlock**: id, userId, subjectId?, title, type (CLASS/STUDY/ACADEMIC_PERSONAL), startAt, endAt, recurrence (JSON/RRULE), recurrenceUntil?, createdAt.
- **Reminder**: id, userId, activityId (FK `onDelete: Cascade`), remindAt, kind (AUTO/MANUAL), status (PENDING/SENT/CANCELLED), createdAt.
- Fases tardías (justificadas cuando toque): `InboxItem` opcional (la bandeja puede ser solo una pantalla sin persistir).

Reglas de integridad: `Subject.userId` y `Activity.userId` se validan en el servicio (la asignatura referenciada debe pertenecer al mismo usuario, evita IDOR por referencia cruzada). `Activity.subjectId` con `onDelete: SetNull` o bloqueo; decisión en Fase 3 (recomiendo bloquear/avisar al eliminar asignaturas con actividades).

## 5. Estrategia de autenticación

- Argon2id (`argon2`; requiere binario nativo: verificar instalación en Windows en Fase 1/2, riesgo R3).
- Sesiones **server-side en BD** (tabla `Session` con token aleatorio hasheado), cookie `HttpOnly; SameSite=Lax; Secure` en producción. Justificación frente a JWT: logout real y revocable, sin gestionar refresh tokens.
- Protección CSRF: `SameSite=Lax` + verificación de `Origin` en métodos no seguros (suficiente para API JSON mismo-origen).
- Rate limiting en `/auth/*` (`express-rate-limit`), `helmet`, mensajes de login genéricos (no revelan si el correo existe).
- Middleware `requireAuth` y consultas siempre filtradas por `userId` (repositorios reciben `userId` obligatorio).

## 6. Fechas y timezone

- Persistir todo en **UTC** (`timestamptz`). Zona objetivo inicial `America/Bogota` (UTC−5, sin DST), almacenada por usuario para evolución futura.
- Librería: **date-fns + date-fns-tz** (ligera, tree-shakeable) en `packages/core`. Alternativa Luxon; se elige date-fns por tamaño de bundle.
- Toda función de `core` recibe `now` y `timezone` por parámetro (nunca `Date.now()` oculto) → tests determinísticos.
- Frontend convierte al mostrar; el backend nunca formatea para humanos.
- Actividades sin hora: se guardan como fin del día local (23:59) con `hasTime=false`.

## 7. Dependencias

**Obligatorias**

- Web: react, react-dom, react-router, vite, typescript, tailwindcss, @tanstack/react-query, zod, react-hook-form, date-fns(-tz).
- API: express, @prisma/client, prisma, zod, argon2, helmet, cors (solo si hace falta), express-rate-limit, cookie-parser, pino (logs).
- Dev: eslint, prettier, vitest, supertest, tsx, @types/*, concurrently.

**Opcionales / posteriores**

- `@playwright/test` (Fase 17), `vite-plugin-pwa` (Fase 13), `tesseract.js` u OCR equivalente (Fase 14), `multer` + validación MIME (Fase 14), `rrule` (solo si se justifica, ver §14), `sharp` (iconos PWA).

No se agregará ninguna librería UI pesada: Tailwind + componentes propios pequeños (accesibilidad con elementos nativos, `<dialog>` para modales).

## 8. Estrategia de pruebas

| Nivel           | Herramienta                            | Alcance                                                                                    |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unitarias       | Vitest                                 | `packages/core`: vencimiento, urgencia, scoring, carga, parser, recurrencia (fechas fijas) |
| Integración API | Vitest + Supertest + BD de prueba real | Auth, CRUD, ownership (dos usuarios), validaciones                                         |
| Componentes     | Vitest + Testing Library               | Solo formularios críticos                                                                  |
| E2E             | Playwright                             | 5 flujos de Fase 17, viewports 360 y 1366                                                  |

BD de prueba: base separada (`*_test`), migraciones aplicadas antes de la suite, limpieza por test. Sin mocks de Prisma para integración (los mocks ocultan fallos de persistencia/ownership).

## 9. Estrategia PWA (Fase 13)

`vite-plugin-pwa` (Workbox): precache de assets estáticos con hash, `manifest` standalone, iconos 192/512 + maskable. **Nunca** cachear `/api/*` (red directa). Sin offline completo en el MVP; página fallback simple sin conexión.

## 10. Estrategia de despliegue

Un solo servicio Node (Express sirve `apps/web/dist` + `/api`) + PostgreSQL gestionado. Candidatos: Render/Railway/Fly.io. HTTPS por la plataforma; `Secure` cookies + `trust proxy`. Migraciones con `prisma migrate deploy` en el arranque/release. Variables de entorno por plataforma; sin secretos en repo.

## 11. Roadmap (confirmado, una fase a la vez)

0 Análisis → 1 Foundation → 2 Auth → 3 Asignaturas → 4 Actividades → 5 Dashboard → 6 Agenda → 7 Recordatorios → 8 Radar → 9 ¿Qué hago ahora? → 10 Progreso/carga → 11 Captura rápida → 12 Bandeja → 13 PWA → 14 Importación → 15 UX/a11y → 16 Seguridad → 17 E2E → 18 Seed/demo → 19 Docs → 20 RC.

Recomendaciones sobre el orden (no se aplican sin tu aprobación):

1. Crear `AcademicPeriod` ya en Fase 3 (el progreso "del periodo" y la recurrencia "hasta fin de semestre" dependen de él).
2. Que el cálculo de vencimiento (Fase 4) viva en `packages/core` desde el inicio para que Dashboard, Radar y scoring lo reutilicen.
3. La tabla `Session` entra en Fase 2.

## 12. Riesgos

| ID  | Riesgo                                                               | Mitigación                                                                            |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| R1  | Node 20.12 < requisito de Vite 7                                     | Fijar Vite 6 o actualizar Node ≥ 20.19; declarar `engines`                            |
| R2  | PostgreSQL local con credenciales desconocidas; `psql` fuera de PATH | Docker Compose como camino documentado y reproducible; README cubre ambos             |
| R3  | `argon2` nativo en Windows (compilación)                             | Verificar en Fase 1; fallback documentado: `@node-rs/argon2` (binarios precompilados) |
| R4  | Zona horaria/DST y recurrencias                                      | Todo en UTC + `now` inyectado; tests con fechas fijas                                 |
| R5  | Parser de lenguaje natural en español con ambigüedad                 | Nunca guardar sin confirmar; `needsConfirmation` + `confidence`; sin inventar fechas  |
| R6  | OCR de horarios poco fiable                                          | Fase 14 tardía, preview editable obligatorio                                          |
| R7  | Sobrealcance (21 fases)                                              | Una fase a la vez con criterios de salida estrictos                                   |
| R8  | IDOR por referencias cruzadas (ej. `subjectId` ajeno)                | Validar pertenencia en servicios; tests de dos usuarios desde Fase 3                  |

## 13. Funciones a posponer

Offline completo, notificaciones push/email, sincronización con Google Calendar, IA generativa (parser y bandeja), importación PDF (tras imagen), multi-periodo avanzado, compartir/colaboración, internacionalización, modo oscuro.

## 14. Decisión de recurrencia (para Fase 6)

Recomendación preliminar: **regla propia simple** `{ freq: WEEKLY, byDay, until }` expandida en `core`, en lugar de RRULE completo. Justificación: el caso de uso es "semanal hasta fin de semestre"; RRULE añade dependencia y complejidad (EXDATE, BYSETPOS) que no se usarán. Se mantiene el formato extensible. Se confirma en Fase 6.

## 15. Definición exacta del MVP

El MVP incluye **Fases 1–10 y 13** (autenticación, asignaturas, actividades, dashboard, agenda con recurrencia semanal y conflictos, recordatorios internos, radar, "¿qué hago ahora?", progreso/carga, PWA instalable), más la Captura rápida (Fase 11) por ser el diferenciador.

Fuera del MVP mínimo (si el tiempo aprieta, en este orden de recorte): Importación de horario (14) → Bandeja (12) → Captura rápida (11). Las fases 15–20 (UX, seguridad, E2E, demo, docs, RC) son obligatorias para entregar.

## 16. Decisiones que necesito confirmar antes de la Fase 1

1. ¿Monorepo con npm workspaces (propuesto) o dos carpetas independientes?
2. ¿Postgres vía Docker Compose (recomendado) o el servicio local `postgresql-x64-18`?
3. ¿Sesiones en BD (recomendado) o JWT en cookie?
4. ¿Carpeta definitiva del proyecto? Hoy este documento está en un espacio temporal.

---

Fin de ARCHITECTURE PLAN v1. **Me detengo aquí.** No avanzo a la Fase 1 hasta tu aprobación explícita.
