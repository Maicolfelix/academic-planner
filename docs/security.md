# Seguridad (Fase 16)

Este documento recoge una **revisión orientada a seguridad y su endurecimiento** (security hardening). **No es una prueba de penetración ni una certificación**, y no afirma que la aplicación «sea segura»: describe qué se revisó, qué se corrigió, qué protege cada capa, qué queda pendiente y cómo reproducir la revisión.

Principio: **defensa en profundidad**. Ninguna regla crítica depende de que «el frontend no lo permite»: se hace cumplir en el servidor y, cuando importa, también en PostgreSQL.

## 1. Modelo de amenazas

**Activos:** la cuenta y su contraseña; la sesión; las actividades, asignaturas, periodos y agenda del estudiante; los recordatorios; el texto pegado en Captura rápida/Bandeja; los archivos subidos para importar el horario y su texto OCR (solo en memoria durante la solicitud).

**Actores:** estudiante legítimo; **usuario autenticado malicioso** (quiere leer o tocar datos de otro); **anónimo** (quiere entrar o abusar de rutas); **atacante automatizado** (relleno de credenciales, fuerza bruta, agotar recursos); **sitio web ajeno** (CSRF).

| Vector                                 | Cómo se mitiga                                                                                                                                                         | Prueba                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| IDOR / acceso a datos ajenos           | Todo repositorio filtra por `userId` de la sesión; recurso ajeno = **el mismo 404** que uno inexistente; claves foráneas verificadas en cada escritura                 | `ownership.security.test.ts` (matriz A contra B, comparación byte a byte con un id inexistente y base de datos sin cambios) |
| Relleno de credenciales / fuerza bruta | Límite de fallos por IP, Argon2id, respuesta idéntica para «correo desconocido» y «contraseña incorrecta», contraseña de relleno para igualar tiempos                  | `auth.security.test.ts`                                                                                                     |
| Robo/fijación de sesión                | Token de 256 bits, solo su SHA-256 en la BD, cookie HttpOnly, token nuevo en cada inicio de sesión y revocación del anterior, logout destruye la sesión en el servidor | `auth.security.test.ts`, `security.spec.ts`                                                                                 |
| CSRF                                   | `Origin`/`Sec-Fetch-Site` obligatorios en toda ruta que no sea GET + `SameSite=Lax` + CORS de lista exacta                                                             | `http.security.test.ts` (todas las rutas), `security.spec.ts` (navegador real)                                              |
| XSS                                    | React escapa el texto; sin `dangerouslySetInnerHTML`/`innerHTML`; **CSP estricta** (`script-src 'self'`, sin `unsafe-inline`/`unsafe-eval`)                            | `security.spec.ts`, `security:scan`                                                                                         |
| Abuso de subida / OCR                  | Tamaño, firma real, dimensiones, páginas, tiempo, una importación por usuario, límite por IP                                                                           | `scheduleImport.test.ts`, `robustness.security.test.ts`                                                                     |
| Agotamiento de recursos                | Límite de cuerpo JSON (100 kB), tipos de contenido conocidos, textos con tope, límites de importación                                                                  | `http.security.test.ts`, `robustness.security.test.ts`                                                                      |
| Fuga por caché                         | `Cache-Control: no-store` en toda la API, el service worker nunca guarda `/api/*`                                                                                      | `http.security.test.ts`, `pwa.spec.ts`, `security.spec.ts`                                                                  |
| Entrada malformada                     | Esquemas Zod `strict`, filtros desconocidos ignorados de forma definida, parámetros repetidos rechazados                                                               | `ownership…`, `robustness…`                                                                                                 |

## 2. Autenticación

- **Contraseñas:** solo se guarda `passwordHash` (Argon2id). Nunca sale en la API (probado sobre las respuestas de registro, login y `/me`) ni se registra (probado capturando la consola en los flujos de autenticación, incluido JSON malformado).
- **Argon2id:** `memoryCost` 65 536 KiB (64 MiB), `timeCost` 3, `parallelism` 1 (explícitos, para que un cambio de valores por defecto de la librería no debilite los hashes). Un inicio de sesión cuesta ≈ 160 ms en la máquina de desarrollo; no se subieron parámetros para no volver lento el login.
- **Política de contraseña:** 8 a 128 caracteres, cualquier carácter (Unicode incluido), sin reglas de composición y **sin recortar espacios**. Una contraseña enorme se rechaza antes de calcular ningún hash.
- **Correo:** se normaliza (recorte y minúsculas) antes de comparar y guardar.
- **Enumeración:** el login responde siempre «Correo o contraseña incorrectos.»; para un correo inexistente se verifica contra un hash de relleno (mismo coste de CPU). El **registro sí informa** de que el correo ya existe (409): compromiso aceptado y documentado; el límite de registros por hora lo acota.
- **Esquemas:** el registro rechaza campos desconocidos (`strict`); el login ignora los sobrantes porque no asigna nada del cuerpo.

## 3. Sesiones y cookie

| Aspecto             | Valor                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token               | 32 bytes del CSPRNG (`crypto.randomBytes`), base64url (43 caracteres)                                                                                                                            |
| En la BD            | solo el SHA-256 (hex); el token no existe en ninguna tabla                                                                                                                                       |
| Vida                | fija, 7 días; no se renueva                                                                                                                                                                      |
| Fijación            | cada inicio de sesión/registro emite un token **nuevo** y **revoca** el que el navegador traía; un token elegido por el atacante nunca se adopta                                                 |
| Logout              | borra la fila en el servidor (el token copiado deja de servir) y la cookie; es idempotente                                                                                                       |
| Expiradas           | no autentican, se borran al usarse y todas se purgan al iniciar sesión                                                                                                                           |
| Varias sesiones     | permitidas (varios dispositivos) hasta **20** por usuario; al crear la 21.ª se descartan las más antiguas                                                                                        |
| Cookie (desarrollo) | `academic_planner_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`, sin `Domain`, sin `Secure` (HTTP)                                                                            |
| Cookie (producción) | **`__Host-academic_planner_session`**, además `Secure`: el navegador solo la acepta con `Secure`, `Path=/` y sin `Domain`, así un subdominio hermano no puede plantarla. La antigua no se acepta |

El frontend maneja la caducidad: un 401 estando con sesión redirige una sola vez al login con «Tu sesión expiró. Inicia sesión nuevamente.».

## 4. CSRF y CORS

Estrategia en capas: (1) **`SameSite=Lax`**; (2) verificación de origen en **toda** petición que no sea GET/HEAD/OPTIONS bajo `/api`: si hay `Origin` debe estar en la lista exacta; si no hay `Origin` pero sí `Sec-Fetch-Site`, debe ser `same-origin` o `none`; sin ninguna de las dos (clientes que no son navegador) se permite, porque un atacante en un navegador no puede producir esa petición; (3) los GET **no cambian estado** (probado: leer recordatorios, Dashboard, etc. no modifica nada).

- **CORS:** lista exacta (`CORS_ORIGIN`) con credenciales. La configuración **se rechaza al arrancar** si contiene `*` o algo que no sea un origen `http(s)` exacto. Un origen ajeno no recibe ninguna cabecera CORS. En producción el origen es el mismo (la API sirve la app), sin necesidad de CORS.
- El orden de middlewares es: cabeceras → `no-store` → CORS → origen → tipo de contenido → cuerpo → cookies. Un origen falsificado o un tipo raro se rechaza **antes** de leer el cuerpo.
- Una prueba de inventario falla si aparece una ruta no-GET que no esté en la matriz de CSRF. `POST /api/schedule-import/confirm` (A1: crea asignaturas y clases) está en esa matriz y en la de autenticación, y tiene su propia batería (`scheduleImportConfirm.test.ts`): propiedad (una asignatura ajena responde el **mismo** 404 que una inexistente, también dentro de un lote), periodo derivado en el servidor, campos internos rechazados (`strictObject` en todos los niveles), todo o nada, simultaneidad real y cuerpos mal formados.

## 5. Autorización, propiedad e IDOR

- **Política:** un recurso ajeno o inexistente responde exactamente lo mismo (404 con el mismo cuerpo). No se devuelve 403 ni mensajes que distingan; borrar la asignatura de otro **no** revela que tiene actividades (404, nunca un 409 con conteo).
- **Matriz** (`ownership.security.test.ts`): para periodos, asignaturas, actividades, agenda y recordatorios, A ejecuta GET/PATCH/DELETE y acciones especiales (`dryRun`, `seen`) sobre ids de B: respuesta idéntica a la de un id aleatorio y **filas de la BD idénticas antes y después**. Con F1 la matriz incluye también una actividad **general** (sin asignatura) de B. El `periodId` de una actividad **nunca viene del cliente** (el cuerpo `strict` lo rechaza con 400): lo deriva el servidor de una asignatura propia o del periodo actual del propio usuario; una asignatura de otro periodo propio se rechaza (400) y la base de datos lo impide con una FK compuesta (`database.security.test.ts`). Revisión de por qué no se añadió una FK `(periodId, userId)`: [activities.md](activities.md#el-periodo-sí-se-guarda-en-activity-la-asignatura-es-opcional-f1).
- **Claves foráneas en el cuerpo:** actividad/bloque/recordatorio/asignatura con ids de B → misma respuesta que con un id inexistente.
- **Fugas por agregados:** Dashboard, Radar, Atención, Progreso, Carga, listados, Captura rápida, Bandeja, duplicados y conflictos nunca contienen ids, títulos ni nombres de B; las respuestas de A son idénticas con y sin la cuenta de B.
- **Mass assignment:** cada escritura rechaza `userId`, `id`, `passwordHash`, `createdAt`, `updatedAt`, `completedAt`, `kind`. `completedAt` solo lo fija el servidor al completar (con el reloj del servidor).
- Toda ruta protegida responde 401 sin sesión (33 rutas probadas).

## 6. Validación y parámetros

- Esquemas Zod `strict` en todas las escrituras; consultas con valores inválidos → 400; **parámetros repetidos** (`?status=A&status=B`) → 400; claves tipo operador (`status[$ne]=…`, `__proto__[x]`) son **claves desconocidas inertes**: no filtran nada ni contaminan prototipos.
- **Tipos de contenido:** JSON en todas las rutas; `multipart/form-data` solo en `POST /api/schedule-import/parse` (desde A1 ya no en el resto de `/api/schedule-import/*`; un solo campo `file`, un solo archivo, sin otros campos). Otro tipo → 415 antes de leer el cuerpo. Cuerpo JSON > 100 kB → 413 (y el servidor sigue respondiendo).
- **Texto de entrada:** Captura rápida 300 caracteres (2000 duro), Bandeja 5000 (20 000 duro). Cadenas hostiles (repetitivas, cercanas a los límites) responden en < 1,5 s sin 500 (no hay expresiones regulares con retroceso catastrófico en los parsers).
- **UTF-8 y marcado:** no se «sanitiza» destructivamente; `<script>`, comillas, tildes y emoji se guardan y devuelven tal cual, y React los escapa al mostrarlos.

## 7. Inyección SQL y XSS

- **SQL:** Prisma parametriza. El único SQL crudo de ejecución es `SELECT 1` (health) y el `FOR UPDATE` de actividades, ambos con plantillas etiquetadas (parametrizadas). El único `$executeRawUnsafe` está en el helper de pruebas (nombres de tablas del catálogo, solo en BDs `*_test`).
- **XSS:** no hay `dangerouslySetInnerHTML`, `innerHTML`, `document.write` ni `eval` en el código del frontend (`security:scan`). En el navegador se probó XSS almacenado en asignatura, título y descripción (Dashboard, Actividades, Radar, Progreso, Agenda, Asignaturas, Bandeja y Captura rápida): se muestra como texto, no aparece ningún elemento inyectado ni diálogo, y `window.__xss` nunca se define.

## 8. Cabeceras HTTP

| Cabecera                                          | Valor                                                                                                                                                                                                                                                                        | Motivo                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Content-Security-Policy`                         | `default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | La app son archivos propios y solo habla con su origen              |
| `X-Content-Type-Options`                          | `nosniff`                                                                                                                                                                                                                                                                    | Evita que el navegador adivine tipos                                |
| `X-Frame-Options`                                 | `DENY` (y `frame-ancestors 'none'`)                                                                                                                                                                                                                                          | La app no se incrusta (clickjacking)                                |
| `Referrer-Policy`                                 | `strict-origin-when-cross-origin`                                                                                                                                                                                                                                            | No filtra rutas a terceros                                          |
| `Permissions-Policy`                              | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`                                                                                                                                                                                           | La app no los usa (la foto del horario va por un `input type=file`) |
| `Strict-Transport-Security`                       | `max-age=15552000; includeSubDomains` **solo si la instalación es HTTPS**                                                                                                                                                                                                    | No fijar `localhost` por HTTP                                       |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin`                                                                                                                                                                                                                                                                | Aislamiento de contexto                                             |
| `Cache-Control`                                   | `no-store` en todo `/api`                                                                                                                                                                                                                                                    | Nada privado en cachés                                              |
| `X-Powered-By`                                    | ausente                                                                                                                                                                                                                                                                      | No anunciar el framework                                            |

**Relajaciones de la CSP, cada una por un motivo medido:** `style-src-attr 'unsafe-inline'` (atributos `style` de React: posiciones de la cuadrícula semanal y barras de progreso; solo atributos, los elementos `<style>` y los scripts en línea siguen bloqueados) e `img-src data:` (el favicon es un SVG en línea). `script-src` no lleva `unsafe-inline` ni `unsafe-eval`.

**Hallazgo corregido durante el endurecimiento de la Fase 16:** con la CSP real, la app intentaba compilar validadores de Zod con `new Function`; el navegador lo bloqueaba y lo reportaba como violación. Ahora el paquete de core declara `jitless` en el navegador (en el servidor se mantiene la ruta rápida), de modo que hay **cero violaciones de CSP** en todas las pantallas, el diálogo y el service worker.

**Desarrollo:** el servidor de Vite no aplica estas cabeceras (la CSP real se ve con la topología de producción, abajo). En desarrollo la API sí las envía a sus respuestas JSON.

## 9. Producción: la API sirve la app

Con `WEB_DIST_DIR` (carpeta `apps/web/dist`), el servidor sirve la app **en el mismo origen** con las cabeceras anteriores: solo archivos de esa carpeta, **nunca dotfiles ni listados**, `index: false`, los archivos con hash de `/assets` con caché larga e inmutable y el shell/`sw.js`/manifiesto con `no-cache`; las rutas del cliente sin extensión reciben `index.html`; **un `/api/*` desconocido sigue siendo un 404 JSON** (nunca el shell con 200) y un archivo inexistente es 404. Probado con recorridos (`/.env`, `/..%2f..%2fpackage.json`, `/%2e%2e/…`), métodos no GET y el build real (sin mapas de fuente ni archivos `.env`/`.ts`).

## 10. Subidas y OCR

Orden de comprobaciones (lo barato primero, todo **antes** del trabajo costoso): origen → tipo de contenido → autenticación → límite por IP → **tamaño** (se corta mientras llega, 10 MB) → **firma real** PNG/JPEG/PDF (no el nombre ni el `Content-Type`) → coherencia de extensión y tipo declarado → **dimensiones leídas del encabezado** (máx. 25 MP: un PNG diminuto que declara 60 000 × 60 000 se rechaza sin decodificarlo) → una importación por usuario → extracción (PDF: máx. 5 páginas, **60 s** de tiempo total y el motor OCR se detiene al vencer). El archivo vive **solo en memoria** (no se escribe a disco; el nombre del archivo nunca se usa para rutas). Si cualquier paso falla, el bloqueo del usuario se libera (`finally`) y la siguiente subida válida funciona. Bytes aleatorios bajo cualquier nombre/tipo nunca llegan a un motor ni producen un 500. Los registros solo llevan tipo, tamaño, duración y resultado (nunca el texto leído ni nombres de asignaturas).

Límite de memoria conocido: cada solicitud en curso retiene hasta 10 MB; el tope es «una importación por usuario» más el límite por IP.

## 11. Límites de frecuencia

| Ruta                                | Límite                                               | Notas                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`              | 10 **fallos** / 15 min / IP (`LOGIN_RATE_LIMIT_MAX`) | los éxitos no cuentan                                                                                                                 |
| `POST /api/auth/register`           | 20 / hora / IP (`REGISTER_RATE_LIMIT_MAX`)           |                                                                                                                                       |
| `POST /api/schedule-import/parse`   | 10 / 10 min / IP (`SCHEDULE_IMPORT_RATE_LIMIT_MAX`)  | además una importación simultánea por usuario                                                                                         |
| `POST /api/schedule-import/confirm` | ninguno propio                                       | escribe, pero no es costoso (como `POST /api/schedule`); las confirmaciones de un usuario se serializan con un bloqueo de transacción |

Respuesta 429 con `Retry-After` y mensaje genérico (nunca dice si un correo tiene cuenta). **Limitación:** el almacén es **en memoria y por proceso**: un reinicio vuelve a cero los contadores y varias instancias no los comparten. Es aceptable con **una sola instancia**; con varias hace falta un almacén compartido (p. ej. Redis), no incluido a propósito. **Detrás de un proxy** `req.ip` sería la IP del proxy (todos compartirían cubo): configurar `TRUST_PROXY` con el **número exacto de proxies** (o direcciones); `true` se rechaza al arrancar porque haría evitable cualquier límite (un `X-Forwarded-For` falsificado). Sin `TRUST_PROXY` la cabecera se ignora (probado).

## 12. PWA y caché

`/api/*` es `NetworkOnly` en el service worker (probado sobre el worker generado y sobre Cache Storage antes y después de iniciar y cerrar sesión), las respuestas llevan `no-store`, y tras cerrar sesión Atrás/sin conexión no muestran datos privados (el shell puede abrir; los datos no). La importación de horario no se guarda en caché.

## 13. Registros y errores

- Una falla inesperada responde 500 con un cuerpo genérico (`Internal server error`): sin mensaje, pila, SQL, rutas ni variables; el detalle va solo al registro del servidor. Las violaciones de unicidad son errores de dominio (409), nunca texto de Prisma. Un JSON malformado es un 400 en español. Rutas/métodos desconocidos responden el mismo 404 genérico.
- No se registran contraseñas, `passwordHash`, tokens, cookies, cuerpos de autenticación, archivos ni texto OCR.
- `GET /api/health` solo devuelve `status`, `database` y `timestamp`.

## 14. Base de datos

Restricciones que PostgreSQL hace cumplir por sí mismo (probadas con escrituras directas que se saltan los servicios): correo único; **un solo periodo actual por usuario** (índice único parcial); fin de periodo > inicio; nombre de asignatura único por periodo (`nameKey`); `COMPLETED` ⇔ `completedAt` no nulo; clase con fin > inicio y duración ≤ 24 h; serie semanal ⇔ fecha final; recordatorio automático ⇔ desplazamiento negativo y **uno por actividad y desplazamiento**; claves foráneas sin cascadas silenciosas donde hay dependientes. Un usuario eliminado arrastra sus sesiones y datos.

**Producción:** usar un usuario de BD con los permisos mínimos (sin `SUPERUSER`/`CREATEDB`), distinto del que ejecuta migraciones; `DATABASE_URL` solo por variable de entorno, nunca en el frontend.

## 15. Dependencias (`npm audit`)

**Antes de la fase: 4 vulnerabilidades altas. Después: 4 (sin cambio, por decisión).** Todas son de **una sola cadena**: `prisma@7.10.0` (CLI) → `@prisma/config` → `deepmerge-ts`, y `prisma` → `mysql2`.

**Actualización posterior al candidato `1.0.0-rc.1` (2026-10-06):** la base de avisos de npm añadió `shell-quote` 1.8.4–1.10.0 (**crítica**, inyección de comandos en `quote()` ante un terminador de línea tras un token de comentario; GHSA-pqg4-j6r4-53mv), que llega por `concurrently` 10 (**solo `devDependencies`**: lo usan los scripts `dev` y `dev:e2e` con comandos fijos escritos en el repositorio, no recibe entradas de usuarios). `npm audit` pasó a **6 (4 altas + 2 críticas)**; con `npm audit --omit=dev` siguen siendo las **4 altas** de la cadena de Prisma, así que **no hay ningún aviso nuevo en lo que se instala para ejecutar la aplicación**. No se actualizó nada ni se usó `--force` (npm propone `concurrently@9.2.1`, un cambio con rotura); queda como riesgo aceptado de herramientas de desarrollo y pendiente de revisar con la siguiente actualización de dependencias.

| Paquete                    | Aviso                                                                                              | ¿Alcanzable?                                                                                                                       | Ruta                                         | Solución propuesta por npm                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deepmerge-ts` 7.1.5       | agotamiento de pila al fusionar grafos recursivos                                                  | **No**: lo usa el CLI de Prisma para fusionar su configuración (`prisma.config.ts`, escrita por nosotros), nunca datos de usuarios | `@planner/api` → `prisma` → `@prisma/config` | `npm audit fix --force` instalaría `prisma@6.19.3` (**una versión mayor anterior**: retroceso incompatible con el cliente 7 y el adaptador `pg`) |
| `mysql2` 3.15.3            | degradación de plugin de autenticación; bomba de descompresión en el protocolo comprimido de MySQL | **No**: solo se usa al conectar con MySQL; este proyecto usa PostgreSQL y nunca abre una conexión MySQL                            | `@planner/api` → `prisma` → `mysql2`         | igual                                                                                                                                            |
| `@prisma/config`, `prisma` | transitivos de los anteriores                                                                      | —                                                                                                                                  | —                                            | igual                                                                                                                                            |

Evidencia de no alcanzabilidad: el servidor en ejecución importa `@prisma/client` y `@prisma/adapter-pg`, que no importan ninguno de los dos; el CLI solo se ejecuta en desarrollo/CI (`migrate`, `generate`) sobre nuestro esquema. **No se ejecutó `npm audit fix --force`** (retrocedería Prisma). La versión más reciente (`8.0.0-rc.20`) es un candidato a versión, no estable: no se adopta. **Pendiente:** actualizar a la siguiente versión estable de Prisma que corrija la cadena y revisar. En un despliegue, instalar con `npm ci --omit=dev` y ejecutar las migraciones desde un paso de CI/despliegue, no desde el proceso web.

Superficie no confiable de archivos (`tesseract.js`, `unpdf`, `@napi-rs/canvas`, `multer` 2.x): sin avisos en `npm audit`; se usan con límites estrictos (sección 10). `npm outdated` (informativo): solo actualizaciones menores/mayores de herramientas de desarrollo (`typescript` 7, `@types/node`), sin impacto de seguridad; no se actualizó nada indiscriminadamente.

## 16. Secretos

`.env` no está versionado (solo `.env.example`, sin secretos; la única URL con credenciales es la de la base Docker local de desarrollo). `npm run security:scan` busca claves privadas, claves de AWS/GitHub/Slack, JWT, URLs con credenciales, secretos fijos, archivos `.env` versionados y construcciones peligrosas (`innerHTML`, `eval`, SQL crudo inseguro, contraseñas en logs, `res.cookie` fuera de `auth/cookies.ts`, CORS comodín); sale con código 1 si encuentra algo y se probó con un directorio con problemas plantados (7 hallazgos). Además se revisó **todo el historial de git** (31 commits): `.env` nunca se añadió y no hay patrones de claves ni credenciales. No se encontró ningún secreto real.

## 17. Limitaciones conocidas

- Límites de frecuencia en memoria y por proceso (sección 11).
- El registro revela si un correo existe (409).
- Fuera de alcance, recomendables antes de un servicio público: **verificación de correo, recuperación de contraseña, MFA, eliminación de cuenta, comprobación de contraseñas filtradas, CAPTCHA, lista de sesiones activas con revocación por el usuario**.
- Sesión de duración fija de 7 días (sin renovación ni cierre por inactividad).
- Cada solicitud de importación retiene hasta 10 MB en memoria.
- `style-src-attr 'unsafe-inline'` (sección 8).
- No se hizo prueba de penetración ni revisión del proxy/infraestructura de despliegue.

## 18. Recomendaciones de despliegue

HTTPS siempre (el service worker y la cookie `__Host-` lo exigen); `NODE_ENV=production` (cookies `Secure`, HSTS); `WEB_DIST_DIR` apuntando al build; `CORS_ORIGIN` con el origen exacto; **`TRUST_PROXY` con el número exacto de proxies** si hay uno delante (y que el proxy sobrescriba `X-Forwarded-For`); una sola instancia o un almacén de límites compartido; PostgreSQL gestionado con copias de seguridad automáticas y usuario de permisos mínimos; credenciales solo por variables de entorno; sin servidor de desarrollo; migraciones desde CI; registros sin datos personales y rotación.

## 19. Lista de verificación reproducible

```bash
npm run security:scan                          # secretos y construcciones peligrosas (sin red)
npm audit                                      # revisar cada hallazgo (sección 15)
npm run test:security                          # escaneo + pruebas de seguridad de la API (BD *_test)
PW_CHANNEL=msedge npm run test:security:browser   # navegador real, topología de producción (CSP, XSS, CSRF, Atrás)
PW_CHANNEL=msedge npm run test:browser         # suite completa (PWA, accesibilidad, OCR…)
```

Cabeceras reales: arrancar con `WEB_DIST_DIR=apps/web/dist` y `curl -I http://localhost:3000/`. Para repetir las comprobaciones negativas, romper a propósito una regla (el filtro de propietario de un repositorio, `originCheck`, `httpOnly`, la regla `NetworkOnly`…) y confirmar que alguna prueba falla.

## 20. Datos de demostración (Fase 18)

`npm run db:seed:demo -- --allow-demo` es el único camino que crea datos de demostración. **Desactivado en producción:** rechaza con código 2 si `NODE_ENV` es `production` aunque lleve el flag, y rechaza sin el flag. No se ejecuta con `npm install`, `dev`, `db:deploy` ni al arrancar el servidor. Solo lee y escribe filas del usuario demo (correo fijo `demo@academicplanner.local`), nunca borra otros usuarios ni sus sesiones, no hace `DROP`/`TRUNCATE` y no imprime la URL de la base de datos ni el hash. La contraseña demo es sintética y pública (docs/demo.md): **la cuenta demo no debe existir en un despliegue público**; si por error se hubiera sembrado una base compartida, se elimina con una sola sentencia sobre ese correo. No hay modo demo en el producto ni credenciales en el frontend. Se probó (BD de test) que el flag es obligatorio, que producción lo rechaza, que otros usuarios quedan intactos y que la contraseña sirve solo a través del inicio de sesión normal.

## 21. Añadir al calendario (A4.1)

`GET /api/activities/:id/calendar.ics` descarga un `.ics` de una actividad ([calendar-export.md](calendar-export.md)).

- **Sin superficie nueva de acceso:** misma sesión que el resto de `/api/activities`, sin ruta pública, sin token en la URL, sin cookie nueva y sin redirección. Es un GET de solo lectura (no cambia estado, por eso no entra en la matriz de CSRF de las rutas no-GET); entra en la matriz de **propiedad** (una actividad ajena responde el mismo 404 que una inexistente o un id mal formado, y la base no cambia) y en la de **sesión anónima** (401).
- **Respuesta:** `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment` con un nombre **fijo** (`academic-planner-activity.ics`, nunca derivado del título: sin inyección de cabeceras ni rutas), `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.
- **Inyección en el archivo:** el título es texto no confiable. El serializador normaliza saltos de línea y caracteres de control y escapa `\`, `;` y `,`, de modo que un título con CRLF no puede abrir `BEGIN:VEVENT`, `ATTENDEE`, `DESCRIPTION` ni otra propiedad (casos probados en core, API y navegador, y leídos de vuelta con un parser independiente).
- **Privacidad:** el archivo contiene solo título, nombre de la asignatura y fechas. Sin descripción, prioridad, estado, tipo, correo, nombre del usuario ni identificadores de usuario o asignatura (el `UID` deriva del id de la actividad y no lleva dominio). Una vez descargado, el archivo es del estudiante y de su calendario; la aplicación no lo rastrea.
