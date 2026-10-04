# Planificador Académico (PWA)

Aplicación web progresiva para organizar asignaturas, actividades, agenda y progreso académico.
Estado actual: **Fase 2 — Autenticación** (registro, login, logout, sesión, rutas protegidas).

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

Abre http://localhost:5173 → te lleva a `/login`. Crea una cuenta en `/register`.
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

Migraciones actuales: `init` (Fase 1) y `auth_user_session_drop_app_metadata` (crea `User` y `Session`, elimina la tabla provisional `AppMetadata`).

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
Pantallas: `/register`, `/login` y `/dashboard` (temporal, solo comprueba la sesión; el Dashboard real es de la Fase 5).

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
