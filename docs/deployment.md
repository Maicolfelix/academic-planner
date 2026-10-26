# Guía de despliegue

> **Estado:** el sistema **no se ha desplegado** en ningún servidor ni se ha probado tras un proxy inverso real ni con HTTPS ([limitations.md](limitations.md)). Esta guía describe los requisitos y la configuración que el código soporta y que se verificó en la topología local de producción (la API sirviendo la app compilada en un solo origen, con `NODE_ENV=production`). Úsala como lista de requisitos, no como una receta ya ensayada. Modelo de amenazas y cabeceras: [security.md](security.md). Qué falta para publicar: [release-readiness-audit.md](release-readiness-audit.md) y [final-checklist.md](final-checklist.md).

## Topología soportada

```text
Navegador
    |
  HTTPS
    |
proxy inverso / TLS de la plataforma
    |
API de Node  ── /api  (la API)
    |         └─ web  (la app compilada, apps/web/dist)
    |
PostgreSQL
```

- **Un solo origen.** El navegador, la interfaz y `/api` comparten origen: la web usa URLs relativas `/api` y la CSP tiene `connect-src 'self'`. Un origen distinto para la API **no está soportado** sin cambios de código (URL base de la API, CSP, cookies).
- **Una sola instancia en v1.** Los límites de frecuencia viven en memoria y por proceso (ver [más abajo](#límites-de-frecuencia)); las sesiones están en la base y no lo impiden, pero varias instancias exigirían un almacén compartido que no existe.
- **No es una aplicación sin servidor** (_serverless_): es un proceso Node de larga vida (OCR con memoria, módulos nativos `argon2` y `@napi-rs/canvas`, datos de OCR locales). Los módulos nativos hay que verificarlos en el sistema operativo destino.

## Requisitos

| Componente    | Requisito                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Node.js       | ≥ 22.18 (probado con 24.19; `engines` en `package.json`, `.nvmrc` = 24) y npm ≥ 10             |
| PostgreSQL    | 17 (el desarrollo usa `postgres:17-alpine`); una base propia con usuario de permisos mínimos   |
| HTTPS         | **Obligatorio** en producción: la cookie `__Host-` y el service worker lo exigen               |
| Proxy inverso | Recomendado (termina TLS, redirige a la API). Ver [`TRUST_PROXY`](#trust_proxy)                |
| Memoria       | La importación de horario retiene hasta 10 MB por solicitud y ejecuta OCR; calcular con margen |

## Variables de entorno

Lista real (la valida `apps/api/src/config/env.ts` al arrancar: si algo es inválido, el servidor **no inicia**). Nunca pongas secretos en el repositorio.

### Variables críticas en producción

| Variable       | Para qué                                                                                                        | Valor de ejemplo                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`     | `production` activa las cookies `Secure` y `__Host-` y HSTS, y bloquea el seed demo                             | `production`                                                     |
| `DATABASE_URL` | Conexión a PostgreSQL (**la única que el código exige siempre**)                                                | `postgresql://app:<contraseña>@db.interno:5432/academic_planner` |
| `CORS_ORIGIN`  | Origen público **exacto** (esquema, host y puerto). También es la lista de `originCheck` (CSRF). **Nunca `*`**  | `https://planner.ejemplo.edu`                                    |
| `WEB_DIST_DIR` | Carpeta de la app compilada (`apps/web/dist`); activa el servicio de la app y la CSP real                       | `/srv/planner/apps/web/dist`                                     |
| `TRUST_PROXY`  | Número **exacto** de proxies delante (o lista de direcciones). `true` y `*` se rechazan. Sin proxy, sin definir | `1`                                                              |
| `API_PORT`     | Puerto de la API: `API_PORT`, luego `PORT`, luego 3000                                                          | `3000`                                                           |

**Qué comprueba el arranque.** Con `NODE_ENV=production`, **`CORS_ORIGIN` y `WEB_DIST_DIR` son obligatorias**: si falta alguna (o está en blanco) el proceso **no arranca** y dice cuál, sin imprimir ningún secreto; además `WEB_DIST_DIR` debe contener `index.html` (si no, se niega a arrancar en lugar de parecer sano y responder 404 en `/`). **`NODE_ENV` nunca se asume**: lo declara el operador (la [imagen de contenedor](#imagen-de-contenedor-docker) lo declara `production`; el código no lo fuerza). En desarrollo y pruebas los valores por defecto siguen como siempre. Siguen vigentes estos acoplamientos:

- **`CORS_ORIGIN` debe ser igual al origen público exacto** (esquema, host y puerto). Es también la lista de `originCheck` (CSRF): un `Origin` distinto recibe **403 `INVALID_ORIGIN`**. El smoke lo comprueba enviando el `Origin` real de `BASE_URL`.
- **`NODE_ENV` decide `Secure`, no la conexión.** Sin `production` las cookies no son `Secure` ni `__Host-`; con `production` sobre HTTP plano (fuera de `localhost`) el navegador descarta la cookie y **no se puede iniciar sesión**. Por eso la QA en un teléfono por red local se hizo en modo desarrollo.
- **Puerto:** `API_PORT` tiene prioridad; si no está definido se usa `PORT` (que muchas plataformas inyectan); si no hay ninguno, 3000. Ambos deben ser enteros de 1 a 65535 y solo se valida el que se **usa** (un `PORT` ajeno se ignora mientras `API_PORT` esté definido); un valor presente pero vacío o mal formado es un error, nunca un respaldo silencioso. `WEB_PORT` (Vite, solo desarrollo) no cambia.

### Todas las variables

| Variable                         |  Obligatoria   | Entorno          | Para qué                                                                                                                                                                            | Valor de ejemplo seguro                                             |
| -------------------------------- | :------------: | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`                       |  recomendada   | todos            | `production` activa cookies `Secure`/`__Host-` y HSTS, y bloquea el seed demo. Por defecto `development`                                                                            | `production`                                                        |
| `DATABASE_URL`                   |     **sí**     | todos            | Conexión a PostgreSQL                                                                                                                                                               | `postgresql://app:<contraseña>@db.interno:5432/academic_planner`    |
| `API_PORT`                       |       no       | todos            | Puerto de la API (por defecto 3000); tiene prioridad sobre `PORT`                                                                                                                   | `3000`                                                              |
| `PORT`                           |       no       | todos            | Puerto que inyectan muchas plataformas; solo se usa si `API_PORT` no está definido                                                                                                  | `8080`                                                              |
| `CORS_ORIGIN`                    | **sí en prod** | todos            | Origen(es) exactos permitidos, separados por comas. **Nunca `*`** (se rechaza). En producción **sin valor por defecto**: falta = no arranca. En desarrollo, `http://localhost:5173` | `https://planner.ejemplo.edu`                                       |
| `TRUST_PROXY`                    |  si hay proxy  | producción       | Número **exacto** de proxies delante (o lista de direcciones). `true` y `*` se rechazan al arrancar                                                                                 | `1`                                                                 |
| `WEB_DIST_DIR`                   | **sí en prod** | producción       | Carpeta de la app compilada (`apps/web/dist`); activa el servicio de la app y la CSP real                                                                                           | `/srv/planner/apps/web/dist`                                        |
| `LOGIN_RATE_LIMIT_MAX`           |       no       | todos            | Inicios de sesión **fallidos** por IP cada 15 min (por defecto 10)                                                                                                                  | `10`                                                                |
| `REGISTER_RATE_LIMIT_MAX`        |       no       | todos            | Registros por IP por hora (por defecto 20)                                                                                                                                          | `20`                                                                |
| `SCHEDULE_IMPORT_RATE_LIMIT_MAX` |       no       | todos            | Importaciones de horario por IP cada 10 min (por defecto 10)                                                                                                                        | `10`                                                                |
| `TEST_DATABASE_URL`              |  solo pruebas  | desarrollo / CI  | Base de pruebas; su nombre **debe** terminar en `_test`. No se usa en producción                                                                                                    | `postgresql://planner:planner@localhost:5433/academic_planner_test` |
| `WEB_PORT`                       |       no       | desarrollo       | Puerto del servidor de Vite (por defecto 5173)                                                                                                                                      | `5173`                                                              |
| `WEB_HOST`                       |       no       | desarrollo / e2e | Dirección de escucha de Vite; `::` acepta IPv4 e IPv6 (por defecto `localhost`, solo IPv6 en Node 18+)                                                                              | `::`                                                                |
| `API_PROXY_TARGET`               |       no       | desarrollo / e2e | A dónde reenvía `/api` el proxy de Vite                                                                                                                                             | `http://localhost:3000`                                             |

`.env.example` trae los valores de desarrollo, comentados. El seed demo **no** lee ninguna variable de permiso: usa el flag `--allow-demo` y se niega con `NODE_ENV=production`; la producción **no necesita** seed.

## Instalar y compilar

Se verificó (2026-10-25, sobre `main` `57090dd`, en un clon desechable):

| Comando                           | Resultado                                                                                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                          | Funciona (es lo que usan todos los gates).                                                                                                                                                                                                                                                          |
| `npm ci --omit=dev`               | **Funciona**: código de salida 0, 273 paquetes, 0 vulnerabilidades, 48 s. El `postinstall` (`build` de `@planner/core` y `prisma generate`) se ejecuta con éxito.                                                                                                                                   |
| `npm run build` tras `--omit=dev` | **Falla**: el _build_ de la API no encuentra los tipos de `express`, `cors`, `cookie-parser`… (`@types/*` son de desarrollo; 227 errores de TypeScript, p. ej. `TS7016`) y el de la web no encuentra `vite/client` ni `vite-plugin-pwa/react` (y `vite` no está). El de `@planner/core` sí compila. |

Por qué `--omit=dev` no falla en el `postinstall`: `typescript` y la CLI de `prisma` **no** son solo de desarrollo en el _lockfile_, porque `@prisma/client` las declara como dependencias _peer_ y npm las instala. Es un efecto del grafo de dependencias, **no una garantía**: no hay que apoyarse en que `prisma migrate deploy` exista en una instalación sin desarrollo.

**Flujo que funciona** (provisional):

```bash
npm ci                                  # instala todo, también lo necesario para compilar
npm run build                           # compila core, API (dist/) y web (apps/web/dist)
npm run db:deploy                       # aplica las migraciones (ver Base de datos)
```

Si se prepara un artefacto o contenedor (RG-2), la compilación va en una **etapa aparte** con todas las dependencias, y la etapa de ejecución puede instalar con `npm ci --omit=dev` y recibir los resultados de `dist/` (core, API y web). El paso de migraciones se ejecuta desde la etapa de compilación o de despliegue, no desde el proceso web.

Arranque de la API (sirve también la app si `WEB_DIST_DIR` está definido):

```bash
# con las variables de entorno definidas por la plataforma:
node apps/api/dist/server.js
```

> `npm run start -w @planner/api` ejecuta `node --env-file=../../.env dist/server.js`: **falla si no existe un archivo `.env` en la raíz** (Node lo exige). En una plataforma que inyecta variables, usa el comando de arriba; si prefieres archivo, créalo fuera del control de versiones y con permisos restringidos.

Comprobación mínima tras arrancar (topología local de producción verificada con el candidato `1.0.0-rc.1`: salud 200, la app servida, `Strict-Transport-Security` y CSP presentes):

```bash
curl -i https://planner.ejemplo.edu/api/health      # 200 {"status":"ok","database":"up",…}
curl -I https://planner.ejemplo.edu/                # cabeceras de seguridad
```

## Imagen de contenedor (Docker)

El repositorio trae un `Dockerfile` multi-etapa, **neutral respecto al proveedor** (nada en él conoce un servidor concreto) y un `.dockerignore` que deja fuera `.env`, `.git`, `node_modules` y `dist` del equipo, pruebas, documentación y `graphify-out`. Dos objetivos:

```bash
docker build -t academic-planner .                              # el proceso web (objetivo por defecto: runtime)
docker build --target migrate -t academic-planner-migrate .     # el paso de migraciones (un trabajo, no el proceso web)
```

**Las migraciones nunca se ejecutan al arrancar el proceso web**, y `migrate deploy && node server.js` **no** es el comando de arranque: son dos pasos con ciclos de vida distintos, aunque v1 use una sola instancia.

```bash
# 1) el paso de despliegue de esquema (se ejecuta, termina y sale con 0)
docker run --rm -e DATABASE_URL='postgresql://…' academic-planner-migrate        # = npm run db:deploy

# 2) el proceso web (un solo origen: sirve /api y la app compilada)
docker run -d -p 3000:3000 \
  -e DATABASE_URL='postgresql://…' \
  -e CORS_ORIGIN='https://planner.ejemplo.edu' \
  -e TRUST_PROXY=1 \
  academic-planner
```

Los secretos (`DATABASE_URL`) se pasan **en tiempo de ejecución**; no hay `ARG`/`ENV` con valores reales y `docker history` no los muestra.

| Aspecto                 | Valor                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                    | `node:24-bookworm-slim` (Debian, glibc: los módulos nativos traen binarios precompilados) más `openssl` y `ca-certificates`; `NODE_VERSION` es un `ARG`                                                                                        |
| Etapas                  | `base` → `build` (`npm ci` y `npm run build`: core, API con `prisma generate`, web) → `prod-deps` (`npm prune --omit=dev`) → **`runtime`**; `migrate` sale de `build` con la CLI de Prisma y las migraciones                                   |
| Módulos nativos         | Se instalan **dentro** de la imagen para su sistema operativo; nunca se copia `node_modules` del equipo                                                                                                                                        |
| Usuario                 | **No es root**: `USER node` (uid 1000). Los módulos nativos y el OCR funcionan así                                                                                                                                                             |
| Declarado por la imagen | `NODE_ENV=production` y `WEB_DIST_DIR=/app/apps/web/dist` (una ruta **dentro** de la imagen, no del equipo). `CORS_ORIGIN` y `DATABASE_URL` no tienen valor: sin ellos el proceso no arranca                                                   |
| Puerto                  | Escucha en `API_PORT`, o en `PORT` si lo inyecta la plataforma, o en 3000                                                                                                                                                                      |
| Salud                   | `HEALTHCHECK` que consulta `/api/health` en el puerto efectivo                                                                                                                                                                                 |
| Apagado                 | `SIGTERM` cierra el servidor y la conexión a la base y sale con 0 (medido: 0,4–0,5 s)                                                                                                                                                          |
| Tamaño                  | `runtime` ≈ **1,04 GB** (sin comprimir) y `migrate` ≈ 1,88 GB. Pesan el OCR (WebAssembly y datos `spa`), `@napi-rs/canvas`, Prisma y las dependencias de producción de la web, que el proceso no usa. **No se optimizó**: es razonable para v1 |

**No se publica ninguna imagen** ni se elige un registro: eso es parte de la decisión de alojamiento.

## Validación local (RG-2)

Dos comandos reproducibles, ambos **sin tocar la base de desarrollo ni ninguna `*_test`**:

```bash
npm run validate:fresh-db      # base vacía y desechable: migraciones, deriva, arranque, humo completo, OCR, reinicio y SIGTERM
BASE_URL=https://host npm run smoke            # humo externo contra un despliegue (añade --full para el flujo completo)
```

**`npm run validate:fresh-db`** (necesita Docker; unos minutos con las imágenes en caché; opciones `--skip-build` y `--accept-known-drift`):

1. levanta PostgreSQL 17 en un contenedor propio (red privada, sin puerto publicado, nombre y contraseña aleatorios) y **se niega a ejecutarse** si la cadena de conexión no apunta a esa base `planner_fresh_*`;
2. comprueba que la base está **vacía** y aplica **las 15 migraciones** con la imagen `migrate`; `prisma migrate status` y 15 filas terminadas en `_prisma_migrations`;
3. `prisma migrate diff` contra `schema.prisma` (ver [deriva conocida](#deriva-del-esquema-conocida-e-intencional));
4. arranca la imagen web en modo producción (un solo origen) y espera `/api/health`; comprueba que **no** ejecutó migraciones al arrancar;
5. corre el humo `--full` como cliente externo y `scripts/container-check.mjs` dentro de la imagen: **argon2** y **`@napi-rs/canvas`** (módulos nativos), **`tesseract.js` con los datos `spa` locales** leyendo una imagen sintética, y la ruta `POST /api/schedule-import/parse` de punta a punta (sesión real, subida real, OCR real: 200 con una propuesta);
6. reinicia el proceso web **y** la base y comprueba que los datos persistieron y que el humo pasa de nuevo;
7. `docker stop`: sale con 0 y en menos de un segundo, sin errores en el registro;
8. destruye contenedores y red, y lo verifica. **Sin seed ni datos de demostración.**

**`npm run smoke`** (`scripts/smoke.mjs`) es independiente de Playwright y de la base: solo conoce `BASE_URL`. Prueba, como un navegador: `/api/health`, `/` (HTML de la app), CSP estricta, un enlace profundo (`/dashboard` devuelve la app y un `/api/…` desconocido un 404 JSON, nunca la app), el manifest, que un `Origin` ajeno recibe 403, el registro de **una** cuenta sintética, los atributos de la cookie de sesión, `/api/auth/me`, una escritura autenticada pequeña (un periodo) y su lectura, el cierre de sesión (el **token viejo** deja de valer), un inicio de sesión real y, con `--full`, materia, actividad, completarla y su persistencia entre sesiones. **Los controles que solo tienen sentido con HTTPS** (prefijo `__Host-`, `Secure`, HSTS) están implementados y se marcan **`n/a` —nunca verdes— si `BASE_URL` no es HTTPS**; contra HTTPS un servidor mal configurado (p. ej. sin `NODE_ENV=production`) **falla**. No hay ningún atajo para el humo: no sube los límites de frecuencia (una cuenta por corrida). **La API no tiene eliminación de cuenta**, así que cada corrida deja una cuenta sintética (`smoke-…@smoke.planner.invalid`) y lo que creó: úsalo con criterio en un entorno real y no lo programes en bucle.

**Estado de la validación** (2026-10-26, imagen construida de verdad, Docker en Windows con contenedores Linux): todo lo anterior **pasa en local sobre HTTP**. **Sigue sin validar:** HTTPS real, proxy inverso real (`TRUST_PROXY` y `X-Forwarded-For`), la cookie `__Host-`/`Secure`/HSTS **en un navegador y por HTTPS** (el humo la verificaría, pero no se ha ejecutado contra HTTPS), la PWA instalada, el Share Target en Android y los dispositivos reales. Eso es RG-2 (segundo hito, preproducción) y RG-3.

### Deriva del esquema (conocida e intencional)

Tras aplicar las 15 migraciones desde cero, `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` termina con código 2 y **una sola** diferencia: ``[*] Changed the `Evaluation` table`` / `[-] Removed foreign key on columns (activityId, subjectId)`. Es la clave foránea compuesta `Evaluation_activityId_subjectId_fkey` hacia `Activity("id", "subjectId")`, escrita **a mano** en la migración `20261015203000_grading_foundation` con `ON DELETE SET NULL ("activityId")` (PostgreSQL 15+; solo se anula la columna `activityId`, nunca `subjectId`), que Prisma no sabe expresar en `schema.prisma` (el comentario del modelo `Evaluation` y [data-model.md](data-model.md) lo documentan). **No se generó ninguna migración y no se cambió el esquema.** La validación **falla por defecto** ante esa diferencia y solo la acepta con `--accept-known-drift` cuando el texto es **exactamente** ese; cualquier otra diferencia sigue siendo un fallo. La decisión de aceptarla es del mantenedor. (La afirmación anterior de «sin deriva» era de `rc.1`, con 6 migraciones, antes de las notas.)

## Qué necesita el proveedor

- Ejecutar **un contenedor** (o un servicio Node con la compilación hecha) **de larga duración** con **una sola instancia** (los límites de frecuencia viven en memoria).
- **HTTPS/TLS terminado** por la plataforma o por un proxy delante, que **sobrescriba** `X-Forwarded-For`.
- **Puerto configurable** (`PORT` o `API_PORT`) y variables de entorno propias, incluidos los secretos.
- **PostgreSQL 17** persistente, con copias automáticas ([backup-restore.md](backup-restore.md)).
- Un **trabajo o comando previo al despliegue** para el paso de migraciones (la imagen `migrate`), separado del proceso web.
- **Health check** HTTP sobre `/api/health` (200 con la base, 503 sin ella).
- Memoria suficiente para el OCR (la importación retiene hasta 10 MB por solicitud).

**Tres familias de opciones compatibles** (ejemplos; no se verificaron aquí las capacidades vigentes de cada proveedor y **no se eligió ninguna ni se creó cuenta alguna**):

1. **PaaS de contenedores con PostgreSQL gestionado** (p. ej. Render, Railway, Fly.io): despliegue de la imagen, TLS automático, `PORT` inyectado, trabajo previo para migraciones y health check. Es lo más sencillo.
2. **VPS o máquina propia con Docker y un proxy con TLS automático** (p. ej. Caddy o Traefik) más PostgreSQL gestionado o en un contenedor con volumen: máximo control y más operación (parches, copias, monitoreo).
3. **Contenedor gestionado en una nube pública** (p. ej. Cloud Run con Cloud SQL, o equivalentes) **fijado a una instancia** (mínimo = máximo = 1): cuidado con el escalado a cero y con varias instancias.

## `TRUST_PROXY`

Detrás de un proxy, la IP real del cliente (que usan los límites de frecuencia) viene en `X-Forwarded-For`. Indica **exactamente** cuántos proxies hay delante (`1`, `2`…) o sus direcciones (`loopback`, `10.0.0.0/8`). **No uses `true`**: confiaría en cualquier cabecera que envíe el cliente y cualquier límite de frecuencia se podría evadir; el servidor se niega a arrancar con `TRUE` o `*`. El proxy debe **sobrescribir** `X-Forwarded-For`, no añadir a lo que trae el cliente. Sin proxy, deja la variable sin definir.

## Base de datos

- **15 migraciones** lineales en `apps/api/prisma/migrations` (`migration_lock.toml` en `postgresql`). **Validadas desde una base completamente vacía** (RG-2, 2026-10-26, PostgreSQL 17 en un contenedor desechable): las 15 se aplican, `prisma migrate status` dice «up to date» y quedan 15 filas terminadas; el único resultado no limpio es la [deriva conocida e intencional](#deriva-del-esquema-conocida-e-intencional). **Pendiente:** repetirlo en el PostgreSQL de preproducción real. La base de pruebas se migra sola pero persiste entre corridas, así que no demuestra el caso vacío.
- **Comando de despliegue:** `npm run db:deploy` (`prisma migrate deploy`). Hazlo desde un paso de CI o de despliegue, **no desde el proceso web**. Necesita la CLI de Prisma (ver [Instalar y compilar](#instalar-y-compilar)).
- Usa un usuario de la aplicación con los **permisos mínimos** que necesita (lectura/escritura sobre las tablas); las migraciones las ejecuta otro paso o usuario con permiso de esquema.
- **Respaldo y restauración:** procedimiento mínimo en [backup-restore.md](backup-restore.md) (`pg_dump` en formato personalizado y ensayo de restauración en una base desechable). **No está ensayado.** El proyecto no implementa ningún sistema de respaldo ni planificador; en producción se usan además las copias automáticas del proveedor.
- Las migraciones nunca se editan una vez aplicadas; se crea otra.
- El seed demo no debe ejecutarse en producción (se niega), y la cuenta demo no debe existir en un despliegue público.

## Límites de frecuencia

El almacén es **en memoria y por proceso**: se reinicia con el servidor y no se comparte entre instancias. Con una sola instancia (el supuesto de v1) es suficiente; con varias hará falta un almacén compartido (por ejemplo Redis), que **no está implementado** ([decisions.md](decisions.md#d9-límites-de-frecuencia-en-memoria-instancia-única)).

## Salud

`GET /api/health` no requiere sesión y devuelve `{ status, database, timestamp }`: `200` con la base arriba, `503` si no responde. No expone versiones, rutas ni datos de usuarios; sirve para el chequeo de salud del proxy o del orquestador. **No detecta una migración pendiente**: con un esquema viejo la salud sigue dando 200. Un error de configuración impide que el servidor arranque (sale con error); los fallos 500 se escriben con `console.error`.

## Antes de publicar

Ver [final-checklist.md](final-checklist.md) (estado vigente, con lo que falta sin marcar) y [release-readiness-audit.md](release-readiness-audit.md) (matriz del release gate). La QA en dispositivos: [release-qa-plan.md](release-qa-plan.md).
