# RG-3: resultados de la ejecución (2026-10-27)

> **Estado: RG-3 PARCIAL / BLOQUEADO.** Todo lo automatizable pasó sobre HTTPS real y en local. La **QA en un iPhone y un Android reales (PWA instalada y Share Target) NO se ejecutó**: requiere un dispositivo físico y al mantenedor. Eso no significa que el producto esté defectuoso: significa que esa evidencia **todavía no existe**. RG-3 no se declara DONE y RG-4 no se inicia.

Procedimiento ejecutado: [rg3-procedure.md](rg3-procedure.md). Fechas en America/Bogotá. Presupuesto: $0 COP (sin cuentas, sin tarjetas, sin alojamiento). Solo datos sintéticos (`@smoke.planner.invalid`, `@qa.planner.invalid`); no se tocó la base de desarrollo ni ninguna `*_test` fuera de sus suites; PostgreSQL no se publicó (los contenedores de la sesión no tenían puertos publicados).

## Qué commit se probó

| Dato               | Valor                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `main` probado     | `4253a783d41c0de73274d94eb0dea68200b9e539` (merge de #72)                                                                       |
| Código de producto | **Sin cambios** en RG-3. Este PR añade resultados, correcciones del procedimiento y un auxiliar (`scripts/rg3-seed-grades.mjs`) |
| Versión            | `1.0.0-rc.2` (sin cambio) · tag creado: **NO**                                                                                  |
| Entorno            | Windows 11, Docker Desktop (contenedores Linux), Node 24.19.0, npm 10.8.1, Edge (canal `msedge`)                                |

## Gate automatizado (etapa A)

Todos los pasos se ejecutaron en secuencia, sobre un árbol limpio en `4253a78`, sin suites simultáneas sobre la misma base.

| ID      | Comando                                             | Estado | Resultado observado                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTO-01 | `npm ci`                                            | PASS   | exit 0                                                                                                                                                                                                                                                                                                                                       |
| AUTO-02 | `npm run lint`                                      | PASS   | exit 0                                                                                                                                                                                                                                                                                                                                       |
| AUTO-03 | `npm run format:check`                              | PASS   | exit 0                                                                                                                                                                                                                                                                                                                                       |
| AUTO-04 | `npm run typecheck`                                 | PASS   | exit 0                                                                                                                                                                                                                                                                                                                                       |
| AUTO-05 | `npm test`                                          | PASS   | core **1405**/1405 (41 archivos) · API **1578**/1578 (65) · web **700**/700 (44)                                                                                                                                                                                                                                                             |
| AUTO-06 | `npm run build`                                     | PASS   | exit 0 (incluye el service worker)                                                                                                                                                                                                                                                                                                           |
| AUTO-07 | `docs:check` · `test:docs` · `security:scan`        | PASS   | 56 archivos sin hallazgos · 24/24 · sin hallazgos                                                                                                                                                                                                                                                                                            |
| AUTO-08 | `npm run test:security`                             | PASS   | 273/273 (8 archivos)                                                                                                                                                                                                                                                                                                                         |
| AUTO-09 | `PW_CHANNEL=msedge npm run test:security:browser`   | PASS   | 9/9                                                                                                                                                                                                                                                                                                                                          |
| AUTO-10 | `npm audit` · `npm audit --omit=dev`                | PASS   | 0 vulnerabilidades en ambos                                                                                                                                                                                                                                                                                                                  |
| AUTO-11 | `PW_CHANNEL=msedge npx playwright test --workers=2` | PASS   | **877 pasan, 0 fallan, 0 intermitentes, 15 omitidas a propósito** (45,6 min, 892 totales). Las omitidas son `test.skip` por proyecto/ancho/hora del día (p. ej. pruebas de teléfono en el proyecto de escritorio), no pruebas eliminadas ni aserciones relajadas                                                                             |
| AUTO-12 | `npm run validate:fresh-db` (sin flags)             | PASS   | **15 pasan, 0 fallan**: base vacía (0 tablas) → 15 migraciones aplicadas, `migrate status` al día, sin deriva inesperada (solo la FK manual conocida de `Evaluation`), 15 filas terminadas, humo `--full` 33/0/3 n/a (HTTP), OCR y módulos nativos, persistencia tras reiniciar web y base, SIGTERM con exit 0 en 0,4 s, recursos destruidos |
| AUTO-13 | `git diff --check`                                  | PASS   | sin avisos                                                                                                                                                                                                                                                                                                                                   |

Ningún test falló, así que no hubo fallos que investigar, ni se corrigió código de producto.

## Respaldo y restauración (etapa B): `BR-01` PASS

PostgreSQL 17 desechable en una red Docker privada, sin puerto publicado para la base; datos sintéticos del humo `--full` más `scripts/rg3-seed-grades.mjs` (estudio, periodo, materia, escala 0–5, 3 cortes y una nota). Copia con `pg_dump --format=custom`, restauración en **otra** base con `pg_restore --exit-on-error`.

| Comprobación                                                            | Estado | Observado                                                                   |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `pg_dump` terminó bien y el archivo es legible y no vacío               | PASS   | 50 346 bytes, `pg_restore --list` correcto                                  |
| `pg_restore --exit-on-error` terminó bien                               | PASS   | exit 0                                                                      |
| Recuentos e ids idénticos tabla por tabla (12 tablas)                   | PASS   | `diff` vacío; User 2, Subject 2, Activity 1, GradingPeriod 3, Evaluation 1… |
| Relaciones periodo → asignatura → actividad                             | PASS   | 1 de 1 coherente, idéntico en origen y restaurada                           |
| Corte → nota                                                            | PASS   | 1 de 1 coherente (notas y cortes **sí** cubiertos)                          |
| 15 migraciones terminadas; `db:deploy` no cambia nada                   | PASS   | 15/15 antes y después; salida «No pending migrations to apply»              |
| `/api/health` 200 con `database: up` contra la restaurada               | PASS   | 200                                                                         |
| Inicio de sesión de una cuenta de la copia y misma lista de actividades | PASS   | login 200, `/api/auth/me` 200, 1 actividad = origen                         |
| Recursos temporales eliminados                                          | PASS   | sin contenedores ni redes `planner-rg3-*`; solo queda `academic-planner-db` |

Limitación: valida el **procedimiento** de respaldo/restauración sobre un PostgreSQL 17 local; **no** valida copias automáticas de un proveedor (no hay ninguno). Las copias reales de un servicio persistente siguen sin existir.

## HTTPS temporal real (etapa C): Docker local + Cloudflare Quick Tunnel

Sesión creada con `rg3-up.sh` del procedimiento (hostname de `*.trycloudflare.com`, **no se publica porque ya está cerrado**).

| ID       | Comprobación                                                                                           | Estado | Observado                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS-01 | Contenedores y arranque                                                                                | PASS   | web `healthy`; `NODE_ENV=production`, `PORT=8080`, sin `API_PORT`, `TRUST_PROXY=1`; 15/15 migraciones terminadas; ningún puerto publicado en la base ni en la web |
| HTTPS-02 | Humo `npm run smoke -- --full` por HTTPS                                                               | PASS   | **36 pasan, 0 fallan, 0 n/a**                                                                                                                                     |
| HTTPS-03 | Certificado válido, `/api/health` 200                                                                  | PASS   | `fetch` verificado correcto; salud 200 con la base arriba                                                                                                         |
| HTTPS-04 | Cookie `__Host-academic_planner_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain` | PASS   | verificado por el humo                                                                                                                                            |
| HTTPS-05 | HSTS y CSP                                                                                             | PASS   | `max-age=15552000; includeSubDomains`; `script-src 'self'` sin `unsafe-*` (la única relajación documentada es `style-src-attr 'unsafe-inline'`)                   |
| HTTPS-06 | `CORS_ORIGIN` exacto                                                                                   | PASS   | el origen real recibe `Access-Control-Allow-Origin` exacto; uno ajeno, ninguno                                                                                    |
| HTTPS-07 | Deep links, manifest (`start_url`, `scope`, `share_target`), `sw.js`, 3 iconos                         | PASS   | verificado por el humo                                                                                                                                            |
| HTTPS-08 | Navegador de escritorio real (Chromium del panel) sobre el HTTPS                                       | PASS   | contexto seguro; service worker `activated`; precaché creado; manifest `display: standalone`. **Es evidencia de escritorio, no de un dispositivo**                |

`TRUST_PROXY=1` queda válido **solo** para la topología medida (Cloudflare delante de un único contenedor).

## Seguridad y sesiones (etapa D), por HTTPS real con cuentas sintéticas

| ID     | Comprobación                                                                                 | Estado | Observado                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-01 | Registro de dos usuarios sintéticos y datos del usuario A                                    | PASS   | 201 ×2; periodo, materia y actividad creados                                                                                                     |
| SEC-02 | Aislamiento: B no lee, edita ni borra el recurso de A                                        | PASS   | 404 idéntico al de un id inexistente (GET/PATCH/DELETE de actividad, GET de materia); el listado de B no contiene lo de A; lo de A quedó intacto |
| SEC-03 | Sin cookie → 401                                                                             | PASS   | 401                                                                                                                                              |
| SEC-04 | CSRF: sin `Origin` pero `Sec-Fetch-Site: cross-site`; escritura autenticada con origen ajeno | PASS   | 403 ×2; la escritura ajena no cambió nada                                                                                                        |
| SEC-05 | Cliente sin `Origin` ni `Sec-Fetch-Site` (tipo curl)                                         | PASS   | permitido **por diseño** (documentado en `originCheck.ts`: un atacante en un navegador no puede producir esa combinación)                        |
| SEC-06 | CORS: origen ajeno sin cabecera permisiva; origen real exacto                                | PASS   | ver HTTPS-06                                                                                                                                     |
| SEC-07 | Logout invalida el token; reingreso                                                          | PASS   | 204 y luego 401; nuevo login 200                                                                                                                 |
| SEC-08 | Reinicio del servicio (`docker restart`)                                                     | PASS   | la cookie emitida **antes** del reinicio sigue autenticando; los datos persisten                                                                 |
| SEC-09 | Límite de intentos fallidos sin evasión por `X-Forwarded-For` falsificado                    | PASS   | 12 intentos con una cabecera falsa distinta cada uno: 401 ×10 y 429 desde el 11.º. No se cambió ningún límite                                    |

Dos expectativas **de la propia prueba** estaban mal (la CSP incluye la relajación documentada `style-src-attr`, y un cliente sin cabeceras de navegador está permitido por diseño); se corrigieron en la prueba tras leer `securityHeaders.ts`/`originCheck.ts` y `docs/security.md`, **no se relajó ningún control del producto**.

## QA en dispositivos físicos (etapa E): BLOQUEADA

No hay un iPhone ni un Android conectados a esta sesión ni herramienta autorizada para controlarlos; Playwright de escritorio **no** sustituye a un dispositivo. Ninguno de estos escenarios se ejecutó:

| ID        | Escenario                                                                                                                                                                      | Estado  | Motivo                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ---------------------------------------------------------- |
| IOS-01…10 | Safari en iPhone: registro/login, onboarding, estudios y periodos, actividades, Radar, Progreso, notas, Captura rápida, importación de horario e `.ics`, navegación responsive | BLOCKED | requiere dispositivo físico y participación del mantenedor |
| IOS-11    | Instalar la PWA y abrirla desde el icono                                                                                                                                       | BLOCKED | ídem                                                       |
| IOS-12    | Offline/online en la PWA                                                                                                                                                       | BLOCKED | ídem                                                       |
| IOS-13    | Aviso de actualización                                                                                                                                                         | NOT RUN | exige dos builds con distinto precaché                     |
| AND-01…03 | Chrome en Android: recorridos principales, instalar la PWA, abrir en modo standalone                                                                                           | BLOCKED | requiere dispositivo físico y participación del mantenedor |
| AND-04…07 | Share Target real desde otra app: precarga de Captura rápida, nada se crea sin confirmar, borrador no sobrescrito, login y retorno al compartir                                | BLOCKED | ídem                                                       |

El iOS no necesita Web Share Target (Safari/iOS no puede ser destino de compartir): no se exige.

## Limpieza (etapa G)

Se ejecutó `rg3-down.sh`: el hostname **ya no sirve la aplicación**, no queda ningún contenedor ni red de la sesión, el archivo de estado se borró y se repitió el cierre sin error (idempotente). El túnel no se dejó abierto porque no había dispositivos disponibles. `academic-planner-db` (desarrollo) no se tocó.

## Defectos encontrados y corregidos

Ningún defecto de **producto**. Sí se encontraron y corrigieron cuatro errores **del procedimiento** al ejecutarlo por primera vez (documentados en `rg3-procedure.md`):

1. `UserProfile` no tiene columna `id` (su clave es `userId`): la huella SQL fallaba.
2. El `curl` de Git Bash salía con 23 (error de escritura) con `-o /dev/null` y con `curl | grep -q` bajo `pipefail`: se sustituyó por `http_code()` y por capturar la respuesta en una variable. El mismo fallo habría hecho fallar `public_ok` en el arranque.
3. El ensayo no cubría notas ni cortes: se añadió `scripts/rg3-seed-grades.mjs` (solo contra una pila local desechable) y ahora es obligatorio.
4. Las expectativas de CSP y de «sin `Origin`» de las pruebas de seguridad (ver arriba).

## Veredicto

| Criterio de RG-3 DONE            | Estado                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| Gate automatizado completo verde | **PASS**                                                       |
| Playwright completo verde        | **PASS** (877/0, 15 omitidas por diseño)                       |
| Fresh DB                         | **PASS** (15/15)                                               |
| Respaldo y restauración          | **PASS**                                                       |
| Humo HTTPS                       | **PASS** (36/0/0)                                              |
| Seguridad y sesiones             | **PASS**                                                       |
| QA real iPhone                   | **BLOCKED**                                                    |
| QA real Android                  | **BLOCKED**                                                    |
| PWA instalada verificada         | **BLOCKED** (solo se verificó el service worker en escritorio) |
| Share Target real Android        | **BLOCKED**                                                    |
| Recursos temporales eliminados   | **PASS**                                                       |

**RG-3 = PARCIAL / BLOQUEADO.** Para cerrarlo hace falta una sesión con el mantenedor: abrir una sesión nueva con `rg3-up.sh` (el hostname será otro), probar en un iPhone y un Android reales, registrar los resultados en la matriz y cerrar con `rg3-down.sh`. RG-4 no se inicia.
