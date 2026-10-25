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
| `API_PORT`     | Puerto de la API (por defecto 3000)                                                                             | `3000`                                                           |

**Acoplamientos que hoy el código no vigila** (fallan en silencio; la mitigación prevista es de RG-2, no está implementada):

- **`CORS_ORIGIN` debe ser igual al origen público.** Su valor por defecto es `http://localhost:5173`. Si en producción no coincide, **todo POST del navegador recibe 403 `INVALID_ORIGIN`**: falla de forma segura pero confusa.
- **`NODE_ENV` decide `Secure`, no la conexión.** Sin `production` las cookies no son `Secure` ni `__Host-`; con `production` sobre HTTP plano (fuera de `localhost`) el navegador descarta la cookie y **no se puede iniciar sesión**. Por eso la QA en un teléfono por red local se hizo en modo desarrollo.
- **`CORS_ORIGIN`, `WEB_DIST_DIR` y `NODE_ENV=production` no son obligatorios para el código**, aunque lo sean para un despliegue correcto.
- **El puerto:** algunas plataformas exponen el puerto en la variable `PORT`, pero **el código solo lee `API_PORT`**. Hasta que RG-2 lo resuelva, hay que fijar `API_PORT` al valor que la plataforma espera. (No hay mapeo de `PORT`: no se ha implementado.)

### Todas las variables

| Variable                         |  Obligatoria   | Entorno          | Para qué                                                                                                            | Valor de ejemplo seguro                                             |
| -------------------------------- | :------------: | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`                       |  recomendada   | todos            | `production` activa cookies `Secure`/`__Host-` y HSTS, y bloquea el seed demo. Por defecto `development`            | `production`                                                        |
| `DATABASE_URL`                   |     **sí**     | todos            | Conexión a PostgreSQL                                                                                               | `postgresql://app:<contraseña>@db.interno:5432/academic_planner`    |
| `API_PORT`                       |       no       | todos            | Puerto de la API (por defecto 3000)                                                                                 | `3000`                                                              |
| `CORS_ORIGIN`                    | **sí en prod** | todos            | Origen(es) exactos permitidos, separados por comas. **Nunca `*`** (se rechaza). Por defecto `http://localhost:5173` | `https://planner.ejemplo.edu`                                       |
| `TRUST_PROXY`                    |  si hay proxy  | producción       | Número **exacto** de proxies delante (o lista de direcciones). `true` y `*` se rechazan al arrancar                 | `1`                                                                 |
| `WEB_DIST_DIR`                   | **sí en prod** | producción       | Carpeta de la app compilada (`apps/web/dist`); activa el servicio de la app y la CSP real                           | `/srv/planner/apps/web/dist`                                        |
| `LOGIN_RATE_LIMIT_MAX`           |       no       | todos            | Inicios de sesión **fallidos** por IP cada 15 min (por defecto 10)                                                  | `10`                                                                |
| `REGISTER_RATE_LIMIT_MAX`        |       no       | todos            | Registros por IP por hora (por defecto 20)                                                                          | `20`                                                                |
| `SCHEDULE_IMPORT_RATE_LIMIT_MAX` |       no       | todos            | Importaciones de horario por IP cada 10 min (por defecto 10)                                                        | `10`                                                                |
| `TEST_DATABASE_URL`              |  solo pruebas  | desarrollo / CI  | Base de pruebas; su nombre **debe** terminar en `_test`. No se usa en producción                                    | `postgresql://planner:planner@localhost:5433/academic_planner_test` |
| `WEB_PORT`                       |       no       | desarrollo       | Puerto del servidor de Vite (por defecto 5173)                                                                      | `5173`                                                              |
| `WEB_HOST`                       |       no       | desarrollo / e2e | Dirección de escucha de Vite; `::` acepta IPv4 e IPv6 (por defecto `localhost`, solo IPv6 en Node 18+)              | `::`                                                                |
| `API_PROXY_TARGET`               |       no       | desarrollo / e2e | A dónde reenvía `/api` el proxy de Vite                                                                             | `http://localhost:3000`                                             |

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

## `TRUST_PROXY`

Detrás de un proxy, la IP real del cliente (que usan los límites de frecuencia) viene en `X-Forwarded-For`. Indica **exactamente** cuántos proxies hay delante (`1`, `2`…) o sus direcciones (`loopback`, `10.0.0.0/8`). **No uses `true`**: confiaría en cualquier cabecera que envíe el cliente y cualquier límite de frecuencia se podría evadir; el servidor se niega a arrancar con `TRUE` o `*`. El proxy debe **sobrescribir** `X-Forwarded-For`, no añadir a lo que trae el cliente. Sin proxy, deja la variable sin definir.

## Base de datos

- **15 migraciones** lineales en `apps/api/prisma/migrations` (`migration_lock.toml` en `postgresql`). La base de desarrollo está al día (`prisma migrate status`). **La validación desde una base vacía con las 15 está PENDIENTE** (RG-2/RG-3): la base de pruebas se migra automáticamente, pero persiste entre corridas y no demuestra el caso vacío; la última instalación limpia documentada fue con 6 migraciones.
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
