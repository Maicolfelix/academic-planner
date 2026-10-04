# Planificador Académico (PWA)

Aplicación web progresiva para organizar asignaturas, actividades, agenda y progreso académico.
Estado actual: **Fase 1 — Foundation** (sin funcionalidades de dominio todavía).

## Requisitos

- Node.js ≥ 22.18 (probado con 24 LTS; ver `.nvmrc`) y npm ≥ 10
- Docker Desktop (PostgreSQL se ejecuta con Docker Compose)

## Ejecutar desde cero

```bash
npm ci                      # instala todo; el postinstall compila @planner/core y genera el cliente Prisma
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run db:up               # levanta PostgreSQL 17 (host :5433) y espera a que esté sano
npm run db:deploy           # aplica las migraciones
npm run dev                 # API :3000 + Web :5173 (con proxy /api)
```

Abre http://localhost:5173 (muestra el estado de la API/BD) o `curl http://localhost:3000/api/health`.

PostgreSQL usa el puerto **5433** del host para no chocar con una instalación local en 5432.

## Scripts

| Script                                  | Qué hace                                                     |
| --------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                           | core (watch) + API + Web                                     |
| `npm run lint` / `npm run format:check` | ESLint / Prettier (`npm run format` para corregir)           |
| `npm run typecheck`                     | `tsc` en todos los paquetes                                  |
| `npm test`                              | Vitest en todos los paquetes (la API usa la BD real)         |
| `npm run build`                         | Build de producción de core, API y Web                       |
| `npm run test:browser`                  | Verificación en navegador con Playwright (360 px y 1366 px)  |
| `npm run db:up` / `db:down`             | Inicia / detiene PostgreSQL                                  |
| `npm run db:migrate`                    | Crea/aplica migraciones en desarrollo (`prisma migrate dev`) |
| `npm run db:deploy`                     | Aplica migraciones existentes                                |

### Playwright

Requiere un navegador: `npx playwright install chromium`. Si la descarga no es posible en tu red,
usa un navegador instalado: `PW_CHANNEL=msedge npm run test:browser`
(PowerShell: `$env:PW_CHANNEL='msedge'; npm run test:browser`). `test:browser` arranca `npm run dev`
si no está corriendo y necesita PostgreSQL arriba.

## Estructura

```
apps/api         Express + Prisma (routes → middleware → servicios; /api/health)
apps/web         React + Vite + Tailwind + React Router + TanStack Query
packages/core    Reglas puras, tipos y esquemas Zod compartidos (se compila a dist/)
e2e              Verificación en navegador (suite completa en Fase 17)
```

## Variables de entorno

Ver `.env.example`. El archivo `.env` está en `.gitignore`; nunca se versiona.

## Notas

- Todas las fechas se almacenarán en UTC; zona horaria inicial `America/Bogota`.
- `AppMetadata` es una tabla mínima solo para validar el flujo de migraciones; las entidades de dominio llegan en fases posteriores.
