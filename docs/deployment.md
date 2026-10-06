# Guía de despliegue

> **Estado:** el sistema **no se ha desplegado** en ningún servidor ni se ha probado tras un proxy inverso real ni con HTTPS ([limitations.md](limitations.md)). Esta guía describe los requisitos y la configuración que el código soporta y que se verificó en la topología local de producción (la API sirviendo la app compilada en un solo origen, con `NODE_ENV=production`). Úsala como lista de requisitos, no como una receta ya ensayada. Modelo de amenazas y cabeceras: [security.md](security.md).

## Requisitos

| Componente    | Requisito                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Node.js       | ≥ 22.18 (probado con 24.19; `engines` en `package.json`, `.nvmrc` = 24) y npm ≥ 10             |
| PostgreSQL    | 17 (el desarrollo usa `postgres:17-alpine`); una base propia con usuario de permisos mínimos   |
| HTTPS         | **Obligatorio** en producción: la cookie `__Host-` y el service worker lo exigen               |
| Proxy inverso | Recomendado (termina TLS, redirige a la API). Ver [`TRUST_PROXY`](#trust_proxy)                |
| Memoria       | La importación de horario retiene hasta 10 MB por solicitud y ejecuta OCR; calcular con margen |

## Un solo origen

La configuración preferida: **la API sirve también la app compilada** (`WEB_DIST_DIR`), de modo que navegador, interfaz y `/api` comparten origen. Así no hay CORS entre sitios, la cookie `__Host-` funciona (sin atributo `Domain`) y la CSP real (`script-src 'self'`, sin `unsafe-inline`/`unsafe-eval`) cubre toda la aplicación. El servidor entrega solo archivos de esa carpeta (sin archivos ocultos ni listados), el shell para las rutas de la interfaz y un 404 JSON para `/api/*`.

## Variables de entorno

Lista real (la valida `apps/api/src/config/env.ts` al arrancar: si algo es inválido, el servidor **no inicia**). Nunca pongas secretos en el repositorio.

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

`.env.example` trae los valores de desarrollo, comentados. El seed demo **no** lee ninguna variable de permiso: usa el flag `--allow-demo` y se niega con `NODE_ENV=production`.

## Pasos

```bash
npm ci                                  # (o npm ci --omit=dev si el CLI de Prisma se ejecuta desde CI)
npm run build                           # compila core, API (dist/) y web (apps/web/dist)
npm run db:deploy                       # aplica las migraciones; hazlo desde un paso de CI/despliegue, no desde el proceso web
```

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

- Usa un usuario de la aplicación con los **permisos mínimos** que necesita (lectura/escritura sobre las tablas); las migraciones las ejecuta otro paso o usuario con permiso de esquema.
- Haz **copias de seguridad** automáticas y comprueba que se pueden restaurar. El proyecto no implementa ningún sistema de respaldo.
- Las migraciones nunca se editan una vez aplicadas; se crea otra.
- El seed demo no debe ejecutarse en producción (se niega), y la cuenta demo no debe existir en un despliegue público.

## Límites de frecuencia

El almacén es **en memoria y por proceso**: se reinicia con el servidor y no se comparte entre instancias. Con una sola instancia es suficiente; con varias hará falta un almacén compartido (por ejemplo Redis), que **no está implementado** ([decisions.md](decisions.md#d9-límites-de-frecuencia-en-memoria-instancia-única)).

## Salud

`GET /api/health` no requiere sesión y devuelve `{ status, database, timestamp }`: `200` con la base arriba, `503` si no responde. No expone versiones, rutas ni datos de usuarios; sirve para el chequeo de salud del proxy o del orquestador.

## Antes de publicar

Ver [final-checklist.md](final-checklist.md): instalación limpia, pruebas, auditoría revisada, dispositivos reales, HTTPS/proxy validados y etiqueta de versión.
