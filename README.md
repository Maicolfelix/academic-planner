# Academic Planner

Aplicación web progresiva (PWA) para **organizar asignaturas, actividades, agenda y progreso académico** de un estudiante universitario. Centraliza la información en un solo lugar, calcula qué requiere atención primero y reduce los pasos operativos para registrar compromisos (escribiendo una frase, pegando un mensaje o subiendo un horario). Todo el procesamiento ocurre en el servidor de la aplicación: no usa IA generativa ni servicios de terceros.

> Estado: **Release Candidate `1.0.0-rc.2`** (roadmap de las Fases 0–20 completo; congelación de funcionalidades). Candidato para entrega y evaluación académica: **no es una certificación para producción pública**, no se ha desplegado y no hay versión final. Notas: [rc.2](docs/release-notes-1.0.0-rc.2.md) (reemplaza a [rc.1](docs/release-notes-1.0.0-rc.1.md)). El software **no ha medido** efectos sobre el rendimiento o el bienestar académico; las pruebas demuestran que funciona como se describe. Limitaciones: [docs/limitations.md](docs/limitations.md).

## Funcionalidades

- **Cuenta y datos propios:** registro e inicio de sesión; cada estudiante ve solo lo suyo.
- **Periodo académico y asignaturas**, con color, profesor y descripción.
- **Actividades** (tarea, parcial, quiz, proyecto, exposición, taller, lectura) con fecha y hora opcional, prioridad, estado y filtros.
- **Agenda** con clases semanales y aviso de solapes.
- **Recordatorios internos** (automáticos según el tipo de actividad y manuales).
- **Radar académico:** clasifica lo pendiente por tiempo restante. **¿Qué hago ahora?:** recomienda a qué prestar atención primero y explica por qué.
- **Progreso y carga semanal** (descriptivos).
- **Captura rápida** (una frase → una actividad), **Bandeja académica** (un mensaje → hasta 10 actividades) e **Importación de horario** (imagen o PDF → clases, con OCR local). Las tres **proponen** y solo guardan al confirmar.
- **PWA instalable** (el shell abre sin conexión; los datos requieren conexión).

Descripción completa sin código: [docs/system-overview.md](docs/system-overview.md).

## Arquitectura

Monorepo con npm workspaces:

| Carpeta         | Contenido                                                                                |
| --------------- | ---------------------------------------------------------------------------------------- |
| `apps/web`      | React 19 + Vite + Tailwind + React Router + TanStack Query (PWA con `vite-plugin-pwa`)   |
| `apps/api`      | Express 5 + Prisma 7 + PostgreSQL 17; rutas → controladores → servicios → repositorios   |
| `packages/core` | Reglas puras y esquemas Zod compartidos (fechas, Radar, Atención, intérpretes de texto…) |
| `e2e`           | Pruebas Playwright                                                                       |

OCR local con Tesseract.js y `unpdf`. Detalle y diagramas: [docs/architecture.md](docs/architecture.md), [docs/data-model.md](docs/data-model.md), [docs/api.md](docs/api.md).

## Requisitos

- **Node.js ≥ 22.18** (probado con 24.19; ver `.nvmrc`) y **npm ≥ 10**
- **Docker Desktop** (PostgreSQL se ejecuta con Docker Compose)
- Navegador moderno. Probado con Chromium/Edge; la instalación de la PWA varía según el navegador

## Instalación rápida

```bash
npm ci                      # instala todo; el postinstall compila @planner/core y genera el cliente Prisma
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up               # PostgreSQL 17 en Docker (puerto del host: 5433); espera a que esté sano
npm run db:deploy           # aplica las migraciones
npm run dev                 # API :3000 + web :5173
```

Abre http://localhost:5173: te lleva a `/login`; crea una cuenta en `/register` (un usuario nuevo pasa por `/onboarding` para definir el semestre). Estado del servidor: `curl http://localhost:3000/api/health` o http://localhost:5173/status.

PostgreSQL usa el puerto **5433** del host para no chocar con una instalación local en 5432. Si Docker Desktop no está arrancado, ábrelo y espera a que `docker info` responda antes de `db:up`. Guía completa (Windows, problemas comunes): [docs/development.md](docs/development.md).

## Scripts

| Script                                     | Qué hace                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                              | core (watch) + API + web                                                     |
| `npm run build`                            | Compila core, API y web                                                      |
| `npm run lint` / `format:check` / `format` | ESLint / Prettier                                                            |
| `npm run typecheck`                        | `tsc` en todos los paquetes y en `e2e/`                                      |
| `npm test`                                 | Vitest en core, API (PostgreSQL real) y web                                  |
| `npm run test:browser`                     | Playwright a 360 y 1366 px con su propio stack (`dev:e2e`) y la base de test |
| `npm run test:security`                    | `security:scan` + pruebas de seguridad de la API                             |
| `npm run test:security:browser`            | Playwright en topología de producción (la API sirve la app, puerto 4300)     |
| `npm run security:scan`                    | Escaneo offline de secretos y construcciones peligrosas                      |
| `npm run docs:check` / `test:docs`         | Verifica enlaces y scripts de la documentación / prueba el verificador       |
| `npm run db:up` / `db:down`                | Inicia / detiene PostgreSQL                                                  |
| `npm run db:migrate` / `db:deploy`         | Crea una migración (desarrollo) / aplica las existentes                      |
| `npm run db:seed:demo -- --allow-demo`     | Datos de demostración (solo desarrollo)                                      |

## Demo local

`npm run db:seed:demo -- --allow-demo` crea un estudiante ficticio con un semestre completo (6 asignaturas, 6 clases semanales, 15 actividades, con fechas relativas a «hoy») y se puede repetir para restablecerlo. Nunca corre solo ni con `NODE_ENV=production`. Credenciales sintéticas, recorrido de presentación y límites: [docs/demo.md](docs/demo.md).

## Pruebas

Vitest (1691 pruebas: núcleo, API con PostgreSQL real, interfaz), Playwright (280 ejecuciones por pasada a 360 y 1366 px, 4 omitidas a propósito), pruebas de seguridad (API y navegador), axe y teclado para accesibilidad, y una validación integral de un semestre completo. La base de test (`academic_planner_test`) se crea y migra sola y las pruebas se niegan a tocar otra. Antes de `test:browser`, nada debe escuchar en los puertos 3000/5173:

```bash
PW_CHANNEL=msedge npm run test:browser      # PowerShell: $env:PW_CHANNEL='msedge'; npm run test:browser
```

Estrategia y cifras: [docs/testing.md](docs/testing.md). Validación integral: [docs/system-validation.md](docs/system-validation.md).

## Seguridad

Endurecimiento de seguridad realizado (no es una prueba de penetración ni una garantía): Argon2id, sesiones en servidor con token cuyo hash es lo único almacenado, cookie `HttpOnly` (`__Host-` y `Secure` bajo HTTPS), verificación de origen contra CSRF, CSP estricta, aislamiento por usuario (un recurso ajeno responde el mismo 404 que uno inexistente), límites de frecuencia y de archivos, API sin caché. `npm audit` reporta **4 vulnerabilidades altas** en la cadena del CLI de Prisma (no alcanzables en tiempo de ejecución según el análisis actual; pendiente de una versión estable que las corrija). Tras el candidato apareció además un aviso crítico de `shell-quote` en `concurrently` (solo herramienta de desarrollo; `npm audit --omit=dev` sigue en 4). Detalle y limitaciones: [docs/security.md](docs/security.md).

## Documentación

Índice completo: **[docs/README.md](docs/README.md)**. Lo esencial:

| Quiero…                       | Documento                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entender qué hace y cómo      | [system-overview.md](docs/system-overview.md), [architecture.md](docs/architecture.md)                                                                                                                          |
| Ver requisitos y su evidencia | [requirements.md](docs/requirements.md)                                                                                                                                                                         |
| Continuar el desarrollo       | [development.md](docs/development.md), [CLAUDE.md](CLAUDE.md), [project-state.md](docs/project-state.md)                                                                                                        |
| Desplegar                     | [deployment.md](docs/deployment.md), [final-checklist.md](docs/final-checklist.md)                                                                                                                              |
| Ver el candidato a versión    | [release-notes-1.0.0-rc.2.md](docs/release-notes-1.0.0-rc.2.md), [rc.1](docs/release-notes-1.0.0-rc.1.md), [release-validation.md](docs/release-validation.md), [release-manifest.md](docs/release-manifest.md) |
| Presentar el proyecto         | [demo.md](docs/demo.md)                                                                                                                                                                                         |

## Limitaciones principales

No probado en dispositivos móviles reales ni tras un proxy HTTPS real; sin sincronización con calendarios externos, notificaciones fuera de la app ni modo sin conexión para datos; sin verificación de correo, recuperación de contraseña ni MFA; la interfaz no gestiona el periodo ni la zona horaria después del onboarding; el OCR puede equivocarse y exige revisión; los intérpretes de texto solo entienden los fraseos previstos, en español. Lista completa: [docs/limitations.md](docs/limitations.md).

## Licencia

El repositorio **no incluye un archivo de licencia**: sin una licencia explícita, el código no concede permisos de uso, copia o distribución. La licencia es una decisión pendiente del propietario ([docs/final-checklist.md](docs/final-checklist.md)).
