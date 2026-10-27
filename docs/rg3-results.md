# RG-3: resultados de la ejecución (2026-10-27)

> **Estado: RG-3 DONE — aceptado por el mantenedor con renuncia a la evidencia formal de dispositivos.**
>
> | Bloque                                    | Estado                                                                              |
> | ----------------------------------------- | ----------------------------------------------------------------------------------- |
> | RG-3 automatizado                         | **DONE**                                                                            |
> | RG-3 HTTPS / seguridad / respaldo         | **DONE**                                                                            |
> | RG-3 QA en dispositivos físicos           | **OWNER_ACCEPTED / DECLARED_PASS**                                                  |
> | Ejecución declarada por el mantenedor     | **SÍ**                                                                              |
> | Evidencia formal completa de dispositivos | **NO** (sin capturas, modelos ni versiones)                                         |
> | Renuncia del mantenedor a esa evidencia   | **ACEPTADA** ([decisión](#decisión-del-mantenedor-sobre-evidencia-de-dispositivos)) |
> | **RG-3 en conjunto**                      | **DONE — OWNER ACCEPTED WITH DEVICE-EVIDENCE WAIVER**                               |
>
> Esto **no** significa que hayan aparecido capturas que no existen: la QA en un iPhone (Safari) y dos Android (Chrome), con PWA instalada, modo standalone, sin conexión, Share Target y recorridos académicos, sigue siendo una **declaración del mantenedor**, y los escenarios siguen identificados como `DECLARED_PASS`/`OWNER_ACCEPTED`, **no** como evidencia independiente. `Device QA accepted by maintainer; formal device evidence incomplete.`

Procedimiento ejecutado: [rg3-procedure.md](rg3-procedure.md). Fechas en America/Bogotá. Presupuesto: $0 COP (sin cuentas, sin tarjetas, sin alojamiento). Solo datos sintéticos (`@smoke.planner.invalid`, `@qa.planner.invalid`); no se tocó la base de desarrollo ni ninguna `*_test` fuera de sus suites; PostgreSQL no se publicó (los contenedores de la sesión no tenían puertos publicados).

## Qué commit se probó

El árbol no fue idéntico en todo RG-3: el auxiliar `scripts/rg3-seed-grades.mjs` se creó **durante** RG-3 para ampliar el ensayo de respaldo. Ningún archivo de producto (`apps/`, `packages/`, `e2e/`, `Dockerfile`) se modificó.

| Qué                                                                                                                                                              | Commit / árbol                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate de producto y automatizado** (lint, format, typecheck, `npm test`, build, docs, seguridad API y navegador, audits, **Playwright completo**, **fresh-db**) | **`4253a783d41c0de73274d94eb0dea68200b9e539`** (`main`, merge de #72), árbol limpio al empezar                                                                                                                                                      |
| **Ensayo de respaldo y restauración** (BR-01, corrida final que pasó)                                                                                            | El mismo código de producto + el auxiliar de #73. El auxiliar existía en el árbol de trabajo y se **commiteó en `7e0ffaed6030e03243c8873d37ea97afafa8f037`**; las corridas anteriores (que fallaron por los errores del procedimiento) no lo usaban |
| **Primera sesión HTTPS** (humo 36/0/0 y pruebas de seguridad/sesiones)                                                                                           | Imagen construida del mismo código de producto que `4253a78`, con correcciones del procedimiento aún sin commitear (solo documentación)                                                                                                             |
| **Segunda sesión HTTPS** (sesión de dispositivos)                                                                                                                | `7e0ffaed6030e03243c8873d37ea97afafa8f037` (producto idéntico a `4253a78` + el auxiliar)                                                                                                                                                            |
| HEAD de este PR al redactar                                                                                                                                      | `83b05dbe48cd0a0c1f3555ba9fa2a42f6b4ce2c8` (antes de esta corrección)                                                                                                                                                                               |

Los archivos cambiados respecto a `4253a78` son documentación, `scripts/rg3-seed-grades.mjs` y nada más (`git diff origin/main --stat -- apps packages e2e` vacío).

| Dato               | Valor                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Código de producto | **Sin cambios**                                                                                  |
| Versión            | `1.0.0-rc.2` (sin cambio) · tag creado: **NO**                                                   |
| Entorno            | Windows 11, Docker Desktop (contenedores Linux), Node 24.19.0, npm 10.8.1, Edge (canal `msedge`) |

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

## QA en dispositivos físicos (etapa E): ejecutada por el mantenedor, evidencia incompleta, aceptada por el mantenedor

Segunda sesión HTTPS temporal (otro hostname, ya cerrado), levantada con `rg3-up.sh` (humo 36/0/0 antes de entregar la dirección) sobre `7e0ffae`. El **mantenedor** probó **a mano, en dispositivos físicos: un iPhone con Safari y dos Android con Chrome**, con cuentas y datos sintéticos, instalando la PWA desde el HTTPS temporal y abriéndola desde el icono.

**Estados usados aquí** (ninguno equivale a un `PASS` con evidencia completa):

- `DECLARED_PASS` — el mantenedor reportó que el escenario funcionó. **No verificado por una captura, un vídeo ni un comando.** `OWNER_ACCEPTED` indica que el mantenedor aceptó formalmente esa carencia de evidencia (ver la decisión más abajo); **no** la convierte en un `PASS` con evidencia.
- `SERVER-CORROBORATED` — además, el servidor tiene datos que son consistentes con el escenario (se indican). Corrobora que algo se creó; **no** que la interfaz se vio bien ni en qué dispositivo.
- `NOT RUN` — no se ejecutó.

**Por qué no es todavía un `PASS` formal.** El procedimiento exige una captura, una salida de comando, una traza o un identificador de CI por escenario. Para estos escenarios **no hay capturas ni vídeos; no se registró el modelo de ningún dispositivo; no se registraron las versiones de iOS, Android, Safari ni Chrome** (se pidieron y no se facilitaron). El servidor no registra peticiones, así que solo algunos efectos se pueden corroborar en la base. Por tanto, **esta sección no satisface el estándar formal de evidencia**; RG-3 se cierra por la decisión del mantenedor, no porque la evidencia sea completa.

| ID        | Escenario                                                                                                                          | Estado                                                                                | Corroboración del servidor                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| IOS-01…02 | Safari: registro, inicio de sesión, onboarding                                                                                     | DECLARED_PASS · OWNER_ACCEPTED · SERVER-CORROBORATED                                  | 2 cuentas nuevas (además de la del humo) y 2 sesiones                                                         |
| IOS-03    | Estudios y periodos                                                                                                                | DECLARED_PASS · OWNER_ACCEPTED · SERVER-CORROBORATED                                  | 2 estudios y 3 periodos en la base                                                                            |
| IOS-04…06 | Asignaturas, actividades, Radar, Progreso                                                                                          | DECLARED_PASS · OWNER_ACCEPTED · SERVER-CORROBORATED (solo asignaturas y actividades) | 6 asignaturas y 3 actividades (pendiente, en curso, completada); **Radar y Progreso: sin corroboración**      |
| IOS-07    | Notas (escala, cortes y nota)                                                                                                      | DECLARED_PASS · OWNER_ACCEPTED · SERVER-CORROBORATED                                  | 3 cortes y 3 evaluaciones                                                                                     |
| IOS-08    | Captura rápida                                                                                                                     | DECLARED_PASS · OWNER_ACCEPTED                                                        | ninguna (no deja rastro propio)                                                                               |
| IOS-09    | Importación de horario e `.ics`                                                                                                    | DECLARED_PASS · OWNER_ACCEPTED                                                        | **ninguna: la base tiene 0 clases de horario**; si se importó un horario, no se confirmó                      |
| IOS-10    | Navegación responsive                                                                                                              | DECLARED_PASS · OWNER_ACCEPTED                                                        | ninguna                                                                                                       |
| IOS-11    | Instalar la PWA y abrirla desde el icono                                                                                           | DECLARED_PASS · OWNER_ACCEPTED                                                        | ninguna                                                                                                       |
| IOS-12    | Sin conexión: las acciones fallan con un mensaje (nunca éxito falso) y al volver la conexión todo funciona                         | DECLARED_PASS · OWNER_ACCEPTED                                                        | ninguna                                                                                                       |
| IOS-13    | Aviso de actualización de la PWA                                                                                                   | NOT RUN                                                                               | exige dos builds con distinto precaché                                                                        |
| AND-01…03 | Chrome (dos Android): recorridos principales, instalar la PWA, abrir en modo standalone                                            | DECLARED_PASS · OWNER_ACCEPTED                                                        | los datos de arriba pudieron crearse desde cualquiera de los tres dispositivos; **no se atribuyen a ninguno** |
| AND-04…07 | Share Target real desde otra app: precarga de Captura rápida, nada se crea sin confirmar, borrador no sobrescrito, login y retorno | DECLARED_PASS · OWNER_ACCEPTED                                                        | **ninguna, ni independiente ni del servidor** (el Share Target no deja rastro hasta que se confirma)          |
| AND-08    | Sin conexión en la PWA instalada                                                                                                   | DECLARED_PASS · OWNER_ACCEPTED                                                        | ninguna                                                                                                       |

iOS no necesita Web Share Target (Safari/iOS no puede ser destino de compartir): no se exigió.

Puntos que merecen mención aparte: (1) la importación de horario no tiene respaldo (0 clases en la base); (2) el Share Target y sus tres comprobaciones descansan solo en la declaración; (3) no hay modelos ni versiones.

### Evidencia formal que sigue faltando (renunciada por el mantenedor)

Para convertir estos escenarios en `PASS` con evidencia formal bastaría una QA física mínima: en **iPhone**, una captura de Safari sobre HTTPS, una de la PWA abierta desde el icono, y modelo, iOS y Safari; en **Android**, una captura de Chrome sobre HTTPS, una de la PWA standalone, una del Share Target (menú del sistema o Captura rápida precargada), y modelo, Android y Chrome. **No se exige para cerrar RG-3** por la decisión de abajo, pero sigue siendo el camino si se quiere elevar la evidencia más adelante (requiere una sesión nueva con `rg3-up.sh` y cuentas sintéticas, y cerrarla con `rg3-down.sh`).

## Decisión del mantenedor sobre evidencia de dispositivos

- El estándar original del procedimiento pedía, para cada escenario, una captura, una salida de comando, una traza o un identificador de CI, y el registro de modelo y versiones.
- **Esa evidencia no se registró** en la QA en un iPhone (Safari) y dos Android (Chrome).
- El mantenedor **confirmó que realizó las pruebas** (PWA instalada, modo standalone, sin conexión, Share Target real en Android y recorridos académicos principales) y que funcionaron.
- El mantenedor **aceptó formalmente esa carencia para este proyecto universitario** y autorizó cerrar RG-3.
- Por esa decisión, **RG-3 puede cerrarse**: `DONE — OWNER ACCEPTED WITH DEVICE-EVIDENCE WAIVER`.
- Los escenarios **siguen identificados como `DECLARED_PASS` / `OWNER_ACCEPTED`**, no como evidencia independiente. Nada se reclasificó retroactivamente como `PASS` con evidencia.
- **Esta excepción no es un precedente automático** para otros release gates: cada gate que pida evidencia de dispositivos debe pedirla de nuevo, o el mantenedor debe renunciar a ella de forma explícita.

## Limpieza (etapa G)

Las **dos** sesiones HTTPS se cerraron con `rg3-down.sh`: el hostname de cada una **ya no sirve la aplicación**, no queda ningún contenedor ni red de la sesión, el archivo de estado se borró y el cierre es idempotente (repetirlo no da error). El túnel de la segunda sesión se cerró justo después de que el mantenedor terminó las pruebas. `academic-planner-db` (desarrollo) no se tocó. Los datos de la sesión (cuentas sintéticas) se destruyeron con la base desechable.

## Defectos encontrados y corregidos

Ningún defecto de **producto**. Sí se encontraron y corrigieron cuatro errores **del procedimiento** al ejecutarlo por primera vez (documentados en `rg3-procedure.md`):

1. `UserProfile` no tiene columna `id` (su clave es `userId`): la huella SQL fallaba.
2. El `curl` de Git Bash salía con 23 (error de escritura) con `-o /dev/null` y con `curl | grep -q` bajo `pipefail`: se sustituyó por `http_code()` y por capturar la respuesta en una variable. El mismo fallo habría hecho fallar `public_ok` en el arranque.
3. El ensayo no cubría notas ni cortes: se añadió `scripts/rg3-seed-grades.mjs` (solo contra una pila local desechable) y ahora es obligatorio.
4. Las expectativas de CSP y de «sin `Origin`» de las pruebas de seguridad (ver arriba).

## Veredicto

| Criterio                                                      | Estado                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Gate automatizado completo verde                              | **READY** (PASS)                                                     |
| Playwright completo                                           | **READY** (877 pasan, 0 fallan, 15 omitidas por diseño)              |
| Seguridad API y navegador                                     | **READY** (273/273 · 9/9)                                            |
| Fresh DB                                                      | **READY** (15/15)                                                    |
| Respaldo y restauración                                       | **READY** (PASS, con notas y cortes)                                 |
| Humo HTTPS                                                    | **READY** (36 pasan, 0 fallan, 0 n/a, en las dos sesiones)           |
| Cookies, HSTS, CSP y CORS                                     | **READY** (PASS)                                                     |
| Aislamiento de usuarios, logout, reinicio, límite de intentos | **READY** (PASS)                                                     |
| Recursos temporales eliminados                                | **READY** (PASS)                                                     |
| QA real iPhone                                                | **OWNER_ACCEPTED / DECLARED_PASS** · evidencia formal incompleta     |
| QA real Android                                               | **OWNER_ACCEPTED / DECLARED_PASS** · evidencia formal incompleta     |
| PWA instalada                                                 | **OWNER_ACCEPTED / DECLARED_PASS** · evidencia formal incompleta     |
| Share Target real Android                                     | **OWNER_ACCEPTED / DECLARED_PASS** · sin corroboración independiente |

| Bloque                            | Estado                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| RG-3 automatizado                 | **DONE**                                                        |
| RG-3 HTTPS / seguridad / respaldo | **DONE**                                                        |
| RG-3 QA en dispositivos físicos   | **OWNER_ACCEPTED / DECLARED_PASS**                              |
| Evidencia formal de dispositivos  | **INCOMPLETA**                                                  |
| Renuncia del mantenedor           | **ACEPTADA**                                                    |
| **RG-3 en conjunto**              | **DONE — OWNER ACCEPTED WITH DEVICE-EVIDENCE WAIVER**           |
| RG-4                              | **NOT STARTED** (autorizado por el mantenedor tras este cierre) |

Ningún defecto de producto apareció. Sin cambio de versión (`1.0.0-rc.2`) y sin tags en este PR.
