# RG-3: procedimiento de validación completa

> **Estado (2026-10-27): ejecutado; resultados reales en [rg3-results.md](rg3-results.md).** Los bloques automatizados, HTTPS, seguridad y respaldo se ejecutaron y pasaron (con correcciones al procedimiento que quedaron aquí) y el mantenedor declaró haber hecho la QA en un iPhone y dos Android reales, pero **sin la evidencia que este documento exige** (capturas, modelos y versiones): esos escenarios están `DECLARED_PASS`, no `PASS`, y RG-3 sigue PARCIAL hasta cerrar esa brecha. Este documento sigue siendo el guion y la plantilla; los resultados viven en `rg3-results.md`.

**Presupuesto: $0 COP.** Sin cuentas de pago, sin tarjetas, sin contratar alojamiento, sin abrir el servicio como público permanente. **Solo datos sintéticos** (cuentas `@smoke.planner.invalid` o `@qa.planner.invalid`, nunca información personal real). Sin cambios de producto ni de diseño, sin subir versión y sin crear tags (RG-4).

## Estado de partida

| Paso                   | Estado                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------- |
| RG-0, RG-1             | DONE (RG-1 = #69)                                                                     |
| RG-2a                  | DONE (#70)                                                                            |
| RG-2b                  | DONE (#71): HTTPS temporal validado con Cloudflare Quick Tunnel; humo `--full` 36/0/0 |
| Alojamiento permanente | **NO** (no existe; el túnel no garantiza disponibilidad)                              |
| RG-3                   | **NOT STARTED**: esta preparación no la ejecuta                                       |
| RG-4                   | NOT STARTED (versión `1.0.0-rc.2` sin cambios, sin tag nuevo)                         |

## Shell requerido

El equipo de desarrollo usa **Windows con Docker Desktop** (contenedores Linux). Las secciones 1, 2 y 6 están escritas para **Git Bash** (el que trae Git for Windows) o **WSL con la integración de Docker Desktop**; **no se incluyen equivalentes de PowerShell ni de `cmd`** y no deben ejecutarse allí. Requisitos: `bash` 4 o superior (con `set -euo pipefail` y sustitución de procesos), `docker` (CLI hablando con Docker Desktop: `docker info` responde), `curl`, `openssl`, `git`, `awk`, `sed`, y Node/npm (el mismo del repositorio: `node` también procesa JSON en la sección 6). En Git Bash, las funciones de ayuda exportan `MSYS_NO_PATHCONV=1` para que una ruta como `/tmp/planner.dump` dentro de un contenedor no se convierta en una ruta de Windows; por el mismo motivo, los scripts se guardan en `$TEMP` y no se pegan línea por línea en PowerShell.

**Estado de los comandos:** las secciones 2 y 6 se **ejecutaron en Git Bash sobre Windows con Docker Desktop** el 2026-10-27 (`rg3-up.sh`, `rg3-down.sh`, `rg3-br.sh`); al ejecutarlos aparecieron cuatro errores que ya están corregidos aquí ([rg3-results.md](rg3-results.md#defectos-encontrados-y-corregidos)). **WSL no se probó.**

## Qué es automatizado y qué requiere a una persona

| Bloque                                 | Quién lo ejecuta                  | Qué puede probar                                                         | Qué **no** prueba                                                      |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1. Gate automatizado                   | Claude/CI local, sin personas     | Código, reglas, API, migraciones, navegador de escritorio (Edge)         | Dispositivos físicos, Safari/Chrome móviles, PWA instalada, HTTPS real |
| 2. Sesión HTTPS temporal + humo        | Claude, sin personas              | HTTPS real, cookie `__Host-`, HSTS, CORS, proxy                          | La interfaz en un navegador real                                       |
| 3. QA iPhone (Safari y PWA instalada)  | **El mantenedor, con su iPhone**  | Recorridos reales, instalación, offline, teclado                         | Share Target (iOS no puede ser destino: no se exige)                   |
| 4. QA Android (Chrome y PWA instalada) | **El mantenedor, con un Android** | Lo anterior **y** el Share Target real                                   | —                                                                      |
| 5. Sesión y seguridad                  | Mixto (ver la sección)            | Cookie, logout, invalidación, aislamiento, CORS, CSRF, límites, reinicio | —                                                                      |
| 6. Copia y restauración                | Claude, sin personas              | Integridad de copia/restauración en PostgreSQL 17 aislado                | Las copias de un proveedor (no hay ninguno)                            |

**Reglas de evidencia.** Un resultado de HTTP local **no** es evidencia de HTTPS real. Un resultado automatizado **no** es evidencia de un dispositivo físico. Una celda sin ejecutar es `NOT RUN`, no `PASS`. Si un dispositivo o permiso no está disponible, es `BLOCKED`, con el motivo.

## 1. Gate automatizado

Antes de empezar: Docker arriba (`docker info`), la base de desarrollo en marcha para las pruebas de API y seguridad (`npm run db:up`), y **nada escuchando en :3000 ni :5173** (`netstat -ano | findstr ":3000 :5173"`; si hay un `npm run dev`, matar el árbol con `taskkill /PID <npm> /T /F`). Las suites no se ejecutan en paralelo sobre la misma base. Se anota el commit probado (`git rev-parse HEAD`) y se parte de un árbol limpio.

```bash
docker exec academic-planner-db pg_isready -h 127.0.0.1 -U planner   # PostgreSQL de pruebas: debe responder «accepting connections»; si no, no seguir
npm ci
npm run lint && npm run format:check && npm run typecheck
npm test                                                  # core, api (BD *_test), web
npm run build
npm run docs:check && npm run test:docs && npm run security:scan
npm run test:security                                     # suite de seguridad de la API
PW_CHANNEL=msedge npm run test:security:browser           # seguridad en navegador (puerto 4300)
npm audit && npm audit --omit=dev                         # ambos deben dar 0
PW_CHANNEL=msedge npx playwright test --workers=2         # Playwright completo (360/1366 px)
npm run validate:fresh-db                                 # sin flags: 15 migraciones, deriva, arranque, humo, OCR, reinicio, SIGTERM
git diff --check
```

Resultado esperado: todo en verde, `npm audit` = 0 en ambos, el reporte de `validate:fresh-db` con 15 migraciones aplicadas desde una base vacía, el humo sin fallos y el apagado con exit 0. Un fallo intermitente de Playwright se investiga con su traza; no se repite hasta que pase. Un `grep MUTATION` sobre el código debe dar 0.

## 2. Sesión HTTPS temporal (túnel de Cloudflare)

Cada sesión de dispositivos empieza aquí y termina en el cierre obligatorio. **El hostname cambia en cada ejecución**: una PWA instalada, una sesión o un compartido de una sesión anterior **no** continúan en la siguiente (el origen es otro). Cada sesión de QA se hace de una vez y se reinstala la PWA.

**Ejecución:** los bloques se guardan como archivos fuera del repositorio (por ejemplo en `$TEMP`) y se ejecutan con `bash`, desde la raíz del repositorio y en [Git Bash o WSL](#shell-requerido). Ninguno usa `set -x`, ni imprime la contraseña ni la cadena de conexión, ni usa `docker inspect` sin filtrar (mostraría las variables de entorno).

### Funciones de ayuda (`$TEMP/rg3-lib.sh`)

Esperan con reintentos y con tiempo máximo: una consulta justo después de `docker run -d` no basta, porque PostgreSQL y el túnel tardan en estar listos. Si algo no arranca, muestran las últimas líneas del registro del contenedor y fallan.

```bash
set -euo pipefail
export MSYS_NO_PATHCONV=1      # Git Bash: que /tmp/... dentro del contenedor no se convierta en una ruta de Windows

diag() { echo "--- últimas líneas de $1 (revisar antes de pegarlas en un informe) ---" >&2; docker logs --tail 30 "$1" >&2 2>&1 || true; }
fail() { echo "ERROR: $*" >&2; [ -z "${DIAG:-}" ] || diag "$DIAG"; exit 1; }

# wait_for <segundos> <qué se espera> <función o comando…>: reintenta cada 2 s; al vencer, falla y muestra el registro de $DIAG
wait_for() {
  local limit=$1 what=$2; shift 2
  local end=$((SECONDS + limit))
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$end" ] || fail "tiempo agotado (${limit} s) esperando: $what"
    sleep 2
  done
}
# pg_url <contenedor> <base>: arma la cadena de conexión con $PGPASS (sin escribirla literal)
pg_url() { printf 'postgresql://%s:%s@%s:5432/%s' postgres "$PGPASS" "$1" "$2"; }
# http_code <argumentos de curl…>: imprime solo el código HTTP. Se evita «-o /dev/null»: el curl de Git Bash puede salir con 23 (error de escritura) aunque haya respuesta
http_code() { curl -s -w '
%{http_code}' "$@" | tail -n 1; }
alive()   { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
healthy() { alive "$1" || fail "el contenedor $1 se detuvo"; [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; }
```

### Arranque de la sesión (`$TEMP/rg3-up.sh`)

```bash
source "$TEMP/rg3-lib.sh"
STATE="$TEMP/rg3-session.env"                           # estado de la sesión (solo el hostname), FUERA del repositorio; lo lee rg3-down.sh

# no pisar una sesión que sigue viva: el trap de abajo la destruiría
if [ -e "$STATE" ] || docker ps -a --format '{{.Names}}' | grep -qE '^planner-rg3-(db|web|tunnel)$'; then
  echo "Ya hay una sesión (o restos de una): ejecuta primero rg3-down.sh" >&2; exit 1
fi

# limpieza automática si el arranque falla en CUALQUIER punto (migraciones, healthcheck, humo, Ctrl+C…); idempotente
SESSION_OK=0
cleanup_failed_start() {
  [ "$SESSION_OK" = 1 ] && return 0                     # arranque correcto: el túnel DEBE seguir vivo para los dispositivos
  echo "El arranque falló: se destruyen los recursos de la sesión." >&2
  docker rm -f planner-rg3-tunnel planner-rg3-web planner-rg3-db >/dev/null 2>&1 || true
  docker network rm planner-rg3 >/dev/null 2>&1 || true
  rm -f "$STATE"
}
trap cleanup_failed_start EXIT
trap 'exit 1' INT TERM

# 0. imagen del commit a probar (anotar el commit en la matriz)
git rev-parse HEAD
docker build -t academic-planner:rg3 .

# 1. red privada y base desechable: SIN publicar ningún puerto de PostgreSQL
docker network create planner-rg3
PGPASS="$(openssl rand -hex 16)"                        # no se imprime ni se guarda en el repositorio
docker run -d --name planner-rg3-db --network planner-rg3 \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=planner_rg3 postgres:17 >/dev/null
# por TCP (-h): durante la inicialización la imagen solo escucha en un socket, así que esto no da un «listo» falso
pg_ready() { docker exec planner-rg3-db pg_isready -h 127.0.0.1 -U postgres -d planner_rg3; }
DIAG=planner-rg3-db wait_for 90 "PostgreSQL acepta conexiones" pg_ready
DBURL="$(pg_url planner-rg3-db planner_rg3)"

# 2. el túnel primero: el hostname solo se conoce al arrancarlo (sin cuenta, sin dominio, sin abrir puertos del router)
docker run -d --name planner-rg3-tunnel --network planner-rg3 cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://planner-rg3-web:8080 >/dev/null
# se descarta api.trycloudflare.com, que aparece en los errores del propio cloudflared
get_host() { docker logs planner-rg3-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.' | head -1 || true; }
have_host() { [ -n "$(get_host)" ]; }
DIAG=planner-rg3-tunnel wait_for 90 "un hostname HTTPS de Cloudflare" have_host
HOST="$(get_host)"
[[ "$HOST" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]] || fail "hostname vacío o inválido: '$HOST'"
echo "Hostname de esta sesión: $HOST"                   # no se copia a ningún documento versionado
# se guarda para rg3-down.sh (cada script es un proceso Bash distinto y las variables no sobreviven); solo el hostname, nunca una contraseña
( umask 077; printf 'HOST=%s\n' "$HOST" > "$STATE" )

# 3. migraciones: un paso aparte, desde la misma imagen (la web nunca migra al arrancar); con set -e un fallo detiene todo
docker run --rm --network planner-rg3 -e DATABASE_URL="$DBURL" academic-planner:rg3 npm run db:deploy

# 4. el proceso web: CORS_ORIGIN exacto (sin barra final), un salto de proxy, PORT inyectado y sin API_PORT
docker run -d --name planner-rg3-web --network planner-rg3 \
  -e DATABASE_URL="$DBURL" -e CORS_ORIGIN="$HOST" -e TRUST_PROXY=1 -e PORT=8080 academic-planner:rg3 >/dev/null
web_healthy() { healthy planner-rg3-web; }
DIAG=planner-rg3-web wait_for 120 "el contenedor web en estado healthy" web_healthy

# 5. el hostname público ya llega a la aplicación (el DNS del túnel puede tardar unos segundos)
# la respuesta se captura antes de comprobarla: con «curl | grep -q» y pipefail, curl puede salir con 23 (error de escritura) aunque haya respuesta
public_ok() { local body; body="$(curl -fsS --max-time 10 "$HOST/api/health")" && [[ "$body" == *'"database":"up"'* ]]; }
DIAG=planner-rg3-tunnel wait_for 120 "$HOST/api/health con database up" public_ok

# 6. humo completo por HTTPS: debe dar 36 pasan, 0 fallan, 0 n/a (con set -e, un fallo detiene el script)
BASE_URL="$HOST" npm run smoke -- --full

# arranque correcto: desarmar la limpieza. El script termina, pero los contenedores y el túnel QUEDAN corriendo.
SESSION_OK=1
echo "Sesión lista en $HOST. Cuando acabes: bash \"\$TEMP/rg3-down.sh\""
```

El script **no cierra el túnel** al terminar bien: la sesión queda en marcha para las pruebas en el iPhone y el Android hasta que se ejecute `rg3-down.sh`. Solo un fallo (o Ctrl+C) durante el arranque dispara la limpieza.

`TRUST_PROXY=1` está medido **solo** para esta topología (Cloudflare delante de un único contenedor): no se extiende a otro proveedor sin repetir la medición. Con la sesión lista, el mantenedor abre `$HOST` en el teléfono para los bloques 3, 4 y 5. Para el reinicio del bloque 5, `docker restart planner-rg3-web` (el hostname no cambia mientras el contenedor del túnel siga vivo).

### Cierre obligatorio de cada sesión (`$TEMP/rg3-down.sh`)

Se ejecuta siempre al terminar, y es **idempotente**: se puede repetir sin error aunque ya no quede nada. Lee el hostname del archivo de estado (no depende de variables de otro proceso), destruye los recursos, **comprueba que el hostname ya no sirve la aplicación** y borra el archivo solo si esa comprobación pasó (si no, lo conserva para poder repetir). No usa `set -e` para que un recurso ya inexistente no corte la limpieza. Sale con código distinto de 0 si el hostname sigue sirviendo.

```bash
export MSYS_NO_PATHCONV=1
STATE="$TEMP/rg3-session.env"
HOST=""
[ ! -f "$STATE" ] || HOST="$(sed -n 's/^HOST=//p' "$STATE" | head -1)"
[[ -z "$HOST" || "$HOST" =~ ^https://[a-z0-9-]+\.trycloudflare\.com$ ]] || { echo "Archivo de estado inválido; se ignora el hostname." >&2; HOST=""; }

docker rm -f planner-rg3-tunnel planner-rg3-web planner-rg3-db >/dev/null 2>&1 || true
docker network rm planner-rg3 >/dev/null 2>&1 || true

STATUS=0
if [ -n "$HOST" ]; then
  # el hostname no debe servir la aplicación; el corte del túnel puede tardar unos segundos
  still_serving() { curl -fsS --max-time 10 "$HOST/api/health" 2>/dev/null | grep -q '"database"'; }
  for _ in $(seq 1 15); do still_serving || break; sleep 2; done
  if still_serving; then echo "FALLO: $HOST sigue sirviendo la aplicación" >&2; STATUS=1
  else echo "OK: $HOST ya no sirve la aplicación"; fi
else
  echo "Sin archivo de estado: no hay hostname que verificar (cierre ya hecho o sesión sin hostname)."
fi

if docker ps -a --format '{{.Names}}' | grep -E '^planner-rg3-(db|web|tunnel)$'; then echo "FALLO: quedan contenedores de la sesión" >&2; STATUS=1
else echo "sin contenedores de la sesión"; fi
[ "$STATUS" = 0 ] && rm -f "$STATE"                     # solo si todo quedó cerrado
exit "$STATUS"
```

Reglas de la sesión: solo datos sintéticos, nunca la base de desarrollo, no publicar el puerto de PostgreSQL ni el motor de Docker, no abrir puertos del router, no pegar el hostname en ningún documento versionado ni dejar contraseñas en el historial o en el repositorio, y no tratar el túnel como servicio: no garantiza disponibilidad (200 peticiones simultáneas, sin SSE).

## 3. QA real en iPhone (Safari sobre el HTTPS temporal)

Guion base: [release-qa-plan.md](release-qa-plan.md) (flujos 1 a 15 y comprobaciones transversales). En el orden de uso real, sobre Safari y después sobre la PWA instalada:

1. Registro e inicio de sesión (errores de validación incluidos).
2. Onboarding completo (uso, periodo, pasos opcionales, pantalla final).
3. Crear un estudio y periodos (Mis estudios → Periodos), incluida la transición de periodo.
4. Importar horario (captura o PDF, OCR local) y confirmar.
5. Crear, editar y completar actividades.
6. Radar y Progreso (con la línea de notas).
7. Notas: escala, cortes y registro de una nota.
8. Captura rápida y Bandeja académica (nada se crea sin confirmar).
9. Importación `.ics`.
10. Navegación responsive a 360 px reales, teclado virtual y zonas seguras.
11. **Instalar la PWA** («Agregar a pantalla de inicio») y **abrirla** desde el icono.
12. **Offline/online:** el shell abre sin conexión y avisa; las acciones fallan con un mensaje, nunca con un éxito falso; al volver la conexión todo funciona.
13. **Actualización:** el aviso «Nueva versión disponible» exige dos builds con distinto precaché. Sin tocar el producto solo es posible si se dispone de otro commit ya construido; si no, se registra `NOT RUN` con el motivo. Si aparece, la actualización nunca recarga sola.

**No se exige Web Share Target en iOS.** Safari/iOS no puede ser destino de compartir: no es un defecto ni bloquea.

## 4. QA real en Android (Chrome sobre el HTTPS temporal)

1. Las operaciones principales de la sección 3 (puntos 1 a 10) en Chrome.
2. **Instalar la PWA** y **abrirla en modo standalone** (sin barra del navegador).
3. **Share Target real** desde otra aplicación (WhatsApp, el navegador, el correo): procedimiento en [release-qa-plan.md](release-qa-plan.md#share-target-en-android-pwa-instalada). Con al menos una asignatura creada.
4. Comprobar que **compartir texto precarga la Captura rápida** (texto en la caja, caja enfocada, parámetros fuera de la URL).
5. Comprobar que **nada se crea sin confirmación** (ni al compartir ni al abrir): solo tras «Interpretar» y la confirmación explícita.
6. Comprobar que **no se sobrescribe un borrador en silencio**: con un borrador existente pregunta «Usar lo compartido» / «Mantener mi borrador».
7. Repetir con la sesión cerrada (debe pedir iniciar sesión y volver con lo compartido), con un enlace y con un texto muy largo (aviso de recorte).

Registrar modelo, versión de Android, versión de Chrome y de la PWA.

## 5. Sesión y seguridad

| Qué                                          | Cómo                                                                                                                                                              | Quién                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Cookie real, `Secure`, `HttpOnly`, `__Host-` | Ya cubierto por el humo HTTPS (paso 5 de la sesión); en el dispositivo, comprobar que la sesión sobrevive a cerrar la PWA                                         | Claude (humo) + mantenedor |
| Logout e invalidación                        | El humo comprueba que el token viejo da 401; en el dispositivo, tras cerrar sesión «Atrás» no muestra datos privados                                              | Claude + mantenedor        |
| Reingreso                                    | Iniciar sesión otra vez con la misma cuenta sintética: los datos persisten                                                                                        | Mantenedor                 |
| Aislamiento entre usuarios                   | Dos cuentas sintéticas A y B; con A crear datos y comprobar que B no los ve; los ids ajenos responden el mismo 404 (la suite `test:security` ya lo cubre por API) | Claude + mantenedor        |
| CORS y CSRF                                  | El humo envía orígenes ajenos, de otro esquema y parecidos y espera 403 `INVALID_ORIGIN`                                                                          | Claude (humo)              |
| Rate limiting                                | 12 inicios fallidos con una cuenta sintética: 401 ×10 y 429 desde el 11.º; con distinto `X-Forwarded-For` falso, igual                                            | Claude                     |
| Reinicio del servicio                        | `docker restart planner-rg3-web`: la sesión sigue válida y los datos persisten; los contadores en memoria se reinician (limitación documentada)                   | Claude + mantenedor        |

## 6. Respaldo y restauración (PostgreSQL 17 local, aislado)

No toca la base de desarrollo, ninguna `*_test` ni el túnel. Base nueva y desechable; el procedimiento general está en [backup-restore.md](backup-restore.md). Se guarda como `$TEMP/rg3-br.sh` y se ejecuta con `bash` desde la raíz del repositorio, en [Git Bash o WSL](#shell-requerido), con la imagen `academic-planner:rg3` ya construida y las funciones de [`rg3-lib.sh`](#funciones-de-ayuda-temprg3-libsh).

**El script no decide el resultado por sí solo.** `BR-01` solo es `PASS` si **cada** comprobación de abajo se cumple y quedó registrada en la matriz; que los comandos terminen no basta. Con `set -e`, cualquier fallo de `pg_dump`, `pg_restore`, de una comparación o de una migración detiene el script y la limpieza (`trap`) destruye los recursos.

```bash
source "$TEMP/rg3-lib.sh"
br_cleanup() { docker rm -f planner-rg3-br-web planner-rg3-br-web2 planner-rg3-br-db >/dev/null 2>&1 || true; docker network rm planner-rg3-br >/dev/null 2>&1 || true; }
trap br_cleanup EXIT

# --- origen: base nueva, migraciones y datos sintéticos --------------------------------------------------------------
docker network create planner-rg3-br
PGPASS="$(openssl rand -hex 16)"
docker run -d --name planner-rg3-br-db --network planner-rg3-br \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=planner_origin postgres:17 >/dev/null
pg_ready() { docker exec planner-rg3-br-db pg_isready -h 127.0.0.1 -U postgres -d planner_origin; }
DIAG=planner-rg3-br-db wait_for 90 "PostgreSQL acepta conexiones" pg_ready
URL_ORIGIN="$(pg_url planner-rg3-br-db planner_origin)"
URL_RESTORED="$(pg_url planner-rg3-br-db planner_restored)"

docker run --rm --network planner-rg3-br -e DATABASE_URL="$URL_ORIGIN" academic-planner:rg3 npm run db:deploy
docker run -d --name planner-rg3-br-web --network planner-rg3-br -p 127.0.0.1:4310:8080 \
  -e DATABASE_URL="$URL_ORIGIN" -e CORS_ORIGIN=http://127.0.0.1:4310 -e PORT=8080 academic-planner:rg3 >/dev/null
origin_healthy() { healthy planner-rg3-br-web; }
DIAG=planner-rg3-br-web wait_for 120 "la web de origen healthy" origin_healthy
BASE_URL=http://127.0.0.1:4310 npm run smoke -- --full        # HTTP local: los controles solo-HTTPS salen n/a, y aquí está bien

# datos sintéticos de notas (el humo no los crea): un estudio, periodo, materia, escala, 3 cortes y una nota, por la API pública
node scripts/rg3-seed-grades.mjs http://127.0.0.1:4310

# --- huellas: recuentos reales y suma de ids por tabla, y las relaciones --------------------------------------------
psql_in() { docker exec -i planner-rg3-br-db psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -At; }
fingerprint() { psql_in "$1" <<'SQL'
SELECT 'User', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "User"
UNION ALL SELECT 'UserProfile', count(*), coalesce(md5(string_agg("userId"::text, ',' ORDER BY "userId"::text)), '') FROM "UserProfile"
UNION ALL SELECT 'StudyTrack', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "StudyTrack"
UNION ALL SELECT 'AcademicPeriod', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "AcademicPeriod"
UNION ALL SELECT 'Subject', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "Subject"
UNION ALL SELECT 'Activity', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "Activity"
UNION ALL SELECT 'Reminder', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "Reminder"
UNION ALL SELECT 'ScheduleBlock', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "ScheduleBlock"
UNION ALL SELECT 'GradingProfile', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "GradingProfile"
UNION ALL SELECT 'GradingPeriod', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "GradingPeriod"
UNION ALL SELECT 'Evaluation', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "Evaluation"
UNION ALL SELECT 'Session', count(*), coalesce(md5(string_agg(id::text, ',' ORDER BY id::text)), '') FROM "Session"
UNION ALL SELECT 'migrations_applied', count(*), count(finished_at)::text FROM _prisma_migrations;
SQL
}
relations() { psql_in "$1" <<'SQL'
SELECT 'activity_with_subject', count(*) FROM "Activity" WHERE "subjectId" IS NOT NULL
UNION ALL SELECT 'activity_subject_period_ok', count(*) FROM "Activity" a
  JOIN "Subject" s ON s.id = a."subjectId" AND s."periodId" = a."periodId"
  JOIN "AcademicPeriod" p ON p.id = a."periodId"
  WHERE a."subjectId" IS NOT NULL
UNION ALL SELECT 'evaluation_total', count(*) FROM "Evaluation"
UNION ALL SELECT 'evaluation_chain_ok', count(*) FROM "Evaluation" e
  JOIN "GradingPeriod" g ON g.id = e."gradingPeriodId" AND g."subjectId" = e."subjectId"
  JOIN "Subject" s ON s.id = e."subjectId" AND s."periodId" = e."periodId";
SQL
}
# las relaciones son coherentes DENTRO de una base: cada actividad con asignatura llega a su asignatura y a su periodo, y cada nota a su corte y materia
relations_ok() { relations "$1" | awk -F'|' '{ v[$1] = $2 } END { exit !(v["activity_with_subject"] > 0 && v["activity_subject_period_ok"] == v["activity_with_subject"] && v["evaluation_chain_ok"] == v["evaluation_total"]) }'; }

fingerprint planner_origin > "$TEMP/br-origin.txt"
relations   planner_origin > "$TEMP/br-origin-rel.txt"
relations_ok planner_origin || fail "el ORIGEN no tiene relaciones coherentes (¿se crearon actividades con asignatura?)"
echo "huella del origen:"; cat "$TEMP/br-origin.txt" "$TEMP/br-origin-rel.txt"
grep -q '^migrations_applied|15|15$' "$TEMP/br-origin.txt" || fail "el origen no tiene las 15 migraciones terminadas"

# --- copia: pg_dump debe terminar con éxito y el archivo debe ser legible y no vacío ------------------------------------
docker exec planner-rg3-br-db pg_dump -U postgres --format=custom --no-owner -f /tmp/planner.dump planner_origin
docker exec planner-rg3-br-db test -s /tmp/planner.dump
docker exec planner-rg3-br-db pg_restore --list /tmp/planner.dump >/dev/null
echo "pg_dump: OK ($(docker exec planner-rg3-br-db stat -c %s /tmp/planner.dump) bytes)"

# --- restauración en OTRA base, y se detiene en el primer error -----------------------------------------------------------
docker exec planner-rg3-br-db createdb -U postgres planner_restored
docker exec planner-rg3-br-db pg_restore -U postgres --exit-on-error --no-owner -d planner_restored /tmp/planner.dump
echo "pg_restore --exit-on-error: OK"

# --- verificación estricta: compara datos reales, no que los comandos hayan terminado ------------------------------------
fingerprint planner_restored > "$TEMP/br-restored.txt"
relations   planner_restored > "$TEMP/br-restored-rel.txt"
diff "$TEMP/br-origin.txt" "$TEMP/br-restored.txt"         || fail "los recuentos o los ids difieren entre origen y restaurada"
diff "$TEMP/br-origin-rel.txt" "$TEMP/br-restored-rel.txt" || fail "las relaciones difieren entre origen y restaurada"
relations_ok planner_restored                              || fail "la restaurada tiene relaciones rotas"
grep -q '^migrations_applied|15|15$' "$TEMP/br-restored.txt" || fail "la restaurada no tiene las 15 migraciones terminadas"
NOTES="$(awk -F'|' '$1=="evaluation_total"{print $2}' "$TEMP/br-restored-rel.txt")"
[ "$NOTES" -gt 0 ] || fail "el origen no tiene notas: BR-01 no cubriría notas ni cortes"
echo "notas y cortes verificados: $NOTES evaluaciones"

# --- db:deploy sobre la restaurada no debe aplicar nada --------------------------------------------------------------
DEPLOY_OUT="$(docker run --rm --network planner-rg3-br -e DATABASE_URL="$URL_RESTORED" academic-planner:rg3 npm run db:deploy 2>&1)"
echo "$DEPLOY_OUT" | tail -5
# la prueba objetiva es que el estado no cambió (siguen siendo las mismas 15 migraciones terminadas); el texto de Prisma solo se señala
fingerprint planner_restored | diff - "$TEMP/br-restored.txt" || fail "db:deploy modificó la base restaurada (aplicó o cambió algo)"
echo "$DEPLOY_OUT" | grep -q 'No pending migrations' || echo "AVISO: no apareció «No pending migrations»; registrar la salida literal de arriba en la matriz"

# --- la aplicación sobre la restaurada: salud 200 y autenticación real ------------------------------------------------------
docker run -d --name planner-rg3-br-web2 --network planner-rg3-br -p 127.0.0.1:4311:8080 \
  -e DATABASE_URL="$URL_RESTORED" -e CORS_ORIGIN=http://127.0.0.1:4311 -e PORT=8080 academic-planner:rg3 >/dev/null
restored_healthy() { healthy planner-rg3-br-web2; }
DIAG=planner-rg3-br-web2 wait_for 120 "la web restaurada healthy" restored_healthy
[ "$(http_code http://127.0.0.1:4311/api/health)" = 200 ] || fail "/api/health de la restaurada no dio 200"
HEALTH_BODY="$(curl -fsS http://127.0.0.1:4311/api/health)"
[[ "$HEALTH_BODY" == *'"database":"up"'* ]] || fail "la restaurada no reporta database up"

# la cuenta sintética del humo viene de la copia; su contraseña se deriva de su correo (smoke-<etiqueta>@… → smoke-<etiqueta>-correct-horse)
EMAIL="$(psql_in planner_restored <<<"SELECT email FROM \"User\" WHERE email LIKE 'smoke-%@smoke.planner.invalid'" | head -1)"
[ -n "$EMAIL" ] || fail "no hay cuenta sintética del humo en la restaurada"
TAG="${EMAIL#smoke-}"; TAG="${TAG%@smoke.planner.invalid}"
LOGIN_BODY="{\"email\":\"$EMAIL\",\"password\":\"smoke-$TAG-correct-horse\"}"
LOGIN_HEADERS="$(curl -si -X POST http://127.0.0.1:4311/api/auth/login -H 'content-type: application/json' -H 'origin: http://127.0.0.1:4311' -d "$LOGIN_BODY" | tr -d '\r')"
echo "$LOGIN_HEADERS" | head -1 | grep -q ' 200' || fail "el inicio de sesión contra la restaurada no dio 200"
COOKIE="$(echo "$LOGIN_HEADERS" | grep -i '^set-cookie:.*academic_planner_session=' | head -1 | sed -E 's/^[^:]*: *//; s/;.*//')"
[ -n "$COOKIE" ] || fail "el inicio de sesión no entregó cookie de sesión"
ME_STATUS="$(http_code http://127.0.0.1:4311/api/auth/me -H "cookie: $COOKIE")"
[ "$ME_STATUS" = 200 ] || fail "/api/auth/me con la sesión de la restaurada dio $ME_STATUS"
ACTIVITIES_BODY="$(curl -fsS http://127.0.0.1:4311/api/activities -H "cookie: $COOKIE")"
N_API="$(printf '%s' "$ACTIVITIES_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).activities.length))")"
N_DB="$(awk -F'|' '$1=="Activity"{print $2}' "$TEMP/br-origin.txt")"
[ "$N_API" = "$N_DB" ] || fail "la API de la restaurada lista $N_API actividades y el origen tenía $N_DB"
echo "BR-01: TODAS LAS COMPROBACIONES DEL SCRIPT CUMPLIDAS (falta registrarlas en la matriz)"
rm -f "$TEMP"/br-origin*.txt "$TEMP"/br-restored*.txt          # los recuentos no son datos personales, pero no se dejan archivos sueltos
```

Criterio de `BR-01`, todos a la vez y cada uno registrado: (1) `pg_dump` terminó con éxito y el archivo es legible; (2) `pg_restore --exit-on-error` terminó con éxito; (3) recuentos e ids idénticos entre origen y restaurada, tabla por tabla; (4) las relaciones periodo → asignatura → actividad (y corte → nota, **si existen notas**) son coherentes y no cambian; (5) las 15 migraciones constan como terminadas y `db:deploy` no aplica ninguna; (6) `/api/health` da 200 con `database: up` contra la restaurada; (7) una cuenta de la copia inicia sesión y su lista de actividades coincide con el origen; (8) todo quedó destruido (el `trap` lo hace; comprobarlo con `docker ps -a | grep planner-rg3-br`). El origen siempre lleva notas y cortes sintéticos (`scripts/rg3-seed-grades.mjs`); si faltaran, el script falla. El respaldo solo cuenta como **ensayado** con esa evidencia; **no equivale a las copias de un proveedor**, que no existen.

## Matriz de evidencia

Se llena durante la ejecución, una fila por escenario. **Un escenario sin fila es `NOT RUN`.** La evidencia es una captura, una salida de comando, una traza o un identificador de CI; nunca «lo vi bien».

| Campo                 | Qué se anota                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| ID                    | `AUTO-nn`, `HTTPS-nn`, `IOS-nn`, `AND-nn`, `SEC-nn`, `BR-nn`                                                   |
| Entorno               | Local HTTP · Docker local · HTTPS temporal (túnel) · Dispositivo físico                                        |
| Dispositivo/navegador | p. ej. «iPhone 13, iOS 18.x, Safari» · «Pixel 7, Android 15, Chrome 130, PWA instalada» · «Edge de escritorio» |
| Acción realizada      | El paso exacto                                                                                                 |
| Resultado esperado    | Lo que debía ocurrir                                                                                           |
| Resultado observado   | Lo que ocurrió                                                                                                 |
| Estado                | `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`                                                                        |
| Evidencia             | Captura, salida del comando, traza, enlace al defecto                                                          |
| Commit probado        | `git rev-parse HEAD` de la imagen/árbol probado                                                                |

Escenarios mínimos (cada uno con su fila): `AUTO-01…` un escenario por comando de la sección 1; `HTTPS-01` humo 36/0/0, `HTTPS-02` cierre del túnel; `IOS-01…13` y `AND-01…07` los puntos de las secciones 3 y 4; `SEC-01…07` las filas de la sección 5; `BR-01` copia y restauración.

| ID        | Entorno | Dispositivo/navegador | Acción | Esperado | Observado | Estado    | Evidencia | Commit |
| --------- | ------- | --------------------- | ------ | -------- | --------- | --------- | --------- | ------ |
| _(vacío)_ |         |                       |        |          |           | `NOT RUN` |           |        |

## Criterios de aprobación y bloqueo

**RG-3 se aprueba** solo si: el gate automatizado está completo y verde sobre el commit probado; el humo `--full` por HTTPS real da 0 fallos y 0 `n/a`; los recorridos principales de la sección 3 y 4 pasan en un iPhone real y en un Android real (con Share Target en Android); la seguridad de sesión pasa; la copia se restauró con integridad; y el túnel y los recursos quedaron destruidos. Todo lo que no se pudo probar queda como `BLOCKED` o `NOT RUN` y se **declara** en el informe, no se esconde.

**Bloquean** (no se etiqueta `rc.3`):

- Pérdida o corrupción de datos.
- Fallos de autenticación o de aislamiento entre usuarios.
- Fallos de migraciones (incluida la restauración).
- Errores reproducibles en los recorridos principales.
- Vulnerabilidades críticas o altas explotables.
- Fallos relevantes de seguridad de sesión (cookie, logout, invalidación).
- PWA instalada inutilizable, cuando la instalación es parte del alcance aprobado.

**No bloquean:** los problemas visuales menores. Se documentan en [limitations.md](limitations.md) y **no provocan rediseños durante el release gate**. Un defecto bloqueante se corrige en su propio PR y se repite la celda afectada sobre el nuevo commit; la corrección no arrastra funciones nuevas.

## Fuera de alcance de RG-3

Un alojamiento permanente, un dominio, copias automáticas de un proveedor, QA con estudiantes, validación de Railway u otro proveedor (habría que medir su proxy de nuevo), y cualquier función o cambio visual nuevo. Cambiar la versión y crear el tag es RG-4.
