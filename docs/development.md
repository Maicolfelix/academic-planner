# Guía de desarrollo

Para quien va a **continuar** el proyecto. Arquitectura: [architecture.md](architecture.md). Pruebas: [testing.md](testing.md). Reglas de trabajo para sesiones de Claude: [CLAUDE.md](../CLAUDE.md).

## Preparar el entorno

Requisitos: Node.js ≥ 22.18 (probado con 24.19; `.nvmrc`), npm ≥ 10 y Docker Desktop.

```bash
npm ci                      # instala todo; el postinstall compila @planner/core y genera el cliente Prisma
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up               # PostgreSQL 17 en Docker (host :5433); espera a que esté sano
npm run db:deploy           # aplica las migraciones a la base de desarrollo
npm run dev                 # core (watch) + API :3000 + web :5173
```

Abre http://localhost:5173. Crea una cuenta en `/register` (o carga los datos de demostración, [demo.md](demo.md)).

### Windows

El desarrollo real fue en Windows. Los comandos de este repositorio funcionan en PowerShell y cmd; donde cambia la sintaxis:

| Tarea                    | bash                                     | PowerShell                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------------ |
| Copiar el `.env`         | `cp .env.example .env`                   | `Copy-Item .env.example .env`                    |
| Variable de entorno      | `PW_CHANNEL=msedge npm run test:browser` | `$env:PW_CHANNEL='msedge'; npm run test:browser` |
| Parar un proceso (árbol) | `kill <pid>`                             | `taskkill /PID <pid> /T /F`                      |
| Ver quién usa un puerto  | `lsof -i :3000`                          | `netstat -ano \| findstr :3000`                  |

Docker Desktop puede no estar arrancado: ábrelo y espera a que `docker info` responda antes de `npm run db:up`. PowerShell 5.1 puede corromper UTF-8 con `Get-Content`/`Set-Content`: edita con un editor o con las herramientas del IDE. `.gitattributes` fija `eol=lf`; si `format:check` falla tras un `pull` por CRLF, `npx prettier --write .` lo normaliza.

## Workspaces

| Comando                                    | Qué hace                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm run build -w @planner/core`           | Recompila `packages/core` a `dist/` (**obligatorio tras cambiarlo**: API y web usan `dist`) |
| `npm run dev -w @planner/api`              | Solo la API con recarga (`node --watch`)                                                    |
| `npm run dev -w @planner/web`              | Solo Vite                                                                                   |
| `npm test -w @planner/api -- src/security` | Un subconjunto de pruebas de la API                                                         |

## Scripts de la raíz

| Script                                     | Qué hace                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm run dev`                              | core + API + web en modo desarrollo                                                         |
| `npm run dev:e2e`                          | Bundle compilado + API sin `--watch` + `vite preview` (lo usa Playwright)                   |
| `npm run build`                            | Compila core, API y web                                                                     |
| `npm run lint` / `format:check` / `format` | ESLint / Prettier (comprobar / corregir)                                                    |
| `npm run typecheck`                        | `tsc` en todos los paquetes y en `e2e/`                                                     |
| `npm test`                                 | Vitest en core, API y web (la API usa PostgreSQL real)                                      |
| `npm run test:browser`                     | Playwright a 360 y 1366 px                                                                  |
| `npm run test:security`                    | `security:scan` + pruebas de seguridad de la API                                            |
| `npm run test:security:browser`            | Seguridad en navegador, topología de producción (puerto 4300)                               |
| `npm run security:scan`                    | Escaneo de secretos y construcciones peligrosas (archivos versionados)                      |
| `npm run docs:check`                       | Enlaces relativos, archivos y scripts mencionados en la documentación                       |
| `npm run db:up` / `db:down`                | Inicia / detiene PostgreSQL (`down` conserva los datos; `docker compose down -v` los borra) |
| `npm run db:generate`                      | Regenera el cliente Prisma                                                                  |
| `npm run db:migrate`                       | Crea y aplica una migración nueva en desarrollo (`prisma migrate dev`)                      |
| `npm run db:deploy`                        | Aplica las migraciones existentes                                                           |
| `npm run db:seed:demo -- --allow-demo`     | Datos de demostración ([demo.md](demo.md))                                                  |

## Base de datos y migraciones

- Dos bases en el mismo PostgreSQL: `academic_planner` (desarrollo) y `academic_planner_test` (pruebas, se crea y migra sola). Detalle en [testing.md](testing.md#base-de-datos-de-desarrollo-y-de-prueba).
- **Nunca edites una migración ya aplicada**: crea otra (`npm run db:migrate`). Las invariantes que Prisma no expresa (índices únicos parciales, `CHECK`) se escriben a mano al final de la migración.
- Reiniciar la base de desarrollo desde cero: `docker compose down -v`, luego `npm run db:up` y `npm run db:deploy`.
- Para ver la base: `docker exec -it academic-planner-db psql -U planner -d academic_planner`.

## Formato y estilo

Prettier (`npm run format`) y ESLint (`npm run lint`) son la referencia; el código y los nombres van en inglés, la interfaz y la documentación en español. Las horas en pantalla siempre en 12 h con a. m./p. m. (`formatClock`, `formatClockRange` de `core`); nunca `HH:mm`.

## Cómo añadir cosas sin romper invariantes

- **Ruta no-GET nueva:** pasa por `originCheck` y debe añadirse a la matriz de `http.security.test.ts` (una prueba de inventario falla si falta).
- **Recurso nuevo con id:** debe entrar en la matriz de `ownership.security.test.ts` (ajeno = mismo 404, base sin cambios).
- **Esquema de escritura nuevo:** `strictObject`.
- **Regla nueva de dominio:** función pura en `packages/core` con reloj inyectable, antes que lógica en un servicio o en la interfaz.
- **Dato derivado:** no se guarda; se calcula al leer.
- **Mutaciones de actividades en la interfaz:** invalidar `['activities']`, el Dashboard y `['reminders']`.

## Playwright

```bash
npx playwright install chromium             # una vez; o usa Edge instalado con PW_CHANNEL=msedge
PW_CHANNEL=msedge npm run test:browser
```

Levanta su propio stack (puerto 5173, base de test). **Antes de lanzarlo, nada debe escuchar en :3000/:5173.** Las trazas de los fallos quedan en `test-results/` (`npx playwright show-trace <ruta>/trace.zip`). Convenciones de las pruebas en [testing.md](testing.md#reglas-de-calidad-de-las-pruebas).

## Problemas comunes

| Síntoma                                                                                                          | Causa y solución                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:browser`: decenas de fallos, `429` al registrar, usuarios `ana+…@example.com` en la base de **desarrollo** | **Un `npm run dev` huérfano.** Matar `npm run dev` solo por puerto deja vivo el vigilante `node --watch`, que revive la API (con la base de desarrollo) y el e2e se ejecuta contra ella. Mata el **árbol** completo (`taskkill /PID <npm> /T /F`) y comprueba con `netstat`. Esa pasada no vale |
| Al arrancar `npm run dev` aparece `[web] AggregateError [ECONNREFUSED]`                                          | El proxy de Vite intentó llegar a la API antes de que terminara de arrancar (`API listening on http://localhost:3000` aparece segundos después). Es transitorio y no requiere acción; comprueba con `curl http://localhost:3000/api/health`                                                     |
| `Port 5173 is already in use` / `EADDRINUSE`                                                                     | Otro Vite o API vivo (`strictPort`). Busca el proceso por puerto y páralo                                                                                                                                                                                                                       |
| `npm run db:up` falla o se queda esperando                                                                       | Docker Desktop no está arrancado: ábrelo y espera a `docker info`                                                                                                                                                                                                                               |
| `container name "academic-planner-db" is already in use` tras clonar en otra carpeta                             | El contenedor tiene nombre fijo y pertenece al proyecto Compose de la otra carpeta: ejecuta `docker compose down -v` **desde esa carpeta**                                                                                                                                                      |
| `test:browser` espera 120 s y falla con «Timed out waiting from config.webServer»                                | La base de test no existía. Ya se crea sola (`ensureTestDatabaseSync`); si persiste, comprueba que Docker está arriba y que `TEST_DATABASE_URL` termina en `_test`                                                                                                                              |
| `net::ERR_CONNECTION_REFUSED` intermitente en el e2e                                                             | `vite preview` con `host: localhost` escucha solo en IPv6 (`[::1]`) y un cliente que prueba IPv4 es rechazado. El stack e2e usa `WEB_HOST=::` (IPv4+IPv6). Si reaparece, guarda la traza y mira qué URL se rechazó                                                                              |
| Las pruebas se niegan a ejecutarse: «does not look like a *_test database»                                       | `TEST_DATABASE_URL` no termina en `_test` o es igual a `DATABASE_URL`: es una protección, corrige la variable                                                                                                                                                                                   |
| La interfaz muestra una versión vieja en el navegador                                                            | El service worker (solo existe en `build` + `preview`/producción, no en `npm run dev`). Aplica el aviso «Actualizar» o, en las herramientas del navegador, «Application → Service Workers → Unregister» y borra el almacenamiento del sitio                                                     |
| `npm run start -w @planner/api`: «.env: not found»                                                               | Ese script usa `--env-file=../../.env`; en producción ejecuta `node apps/api/dist/server.js` con las variables definidas ([deployment.md](deployment.md))                                                                                                                                       |
| `MaxListenersExceededWarning` al correr las pruebas de la API                                                    | Ruido conocido de Supertest (P17-04); no afecta a nada                                                                                                                                                                                                                                          |
| `format:check` falla tras un `pull`                                                                              | CRLF; `npx prettier --write .`                                                                                                                                                                                                                                                                  |

## Fuente de verdad

Cuando dos cosas no coinciden manda, en este orden: **el código → las pruebas → los documentos**. Si un documento contradice al código, se corrige el documento. `npm run docs:check` detecta enlaces rotos y scripts inexistentes, no afirmaciones falsas: revisa la documentación cuando cambies el comportamiento.
