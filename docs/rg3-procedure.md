# RG-3: procedimiento de validación completa (preparado, NO ejecutado)

> **Estado (2026-10-27): preparación documental. RG-3 no se ha ejecutado** y requiere autorización explícita del mantenedor. Nada de este documento es evidencia: es el guion, los criterios y la plantilla donde se registrará lo que de verdad se pruebe. Los comandos de las secciones 1 a 4 son los del repositorio; los de las secciones 5 y 6 componen lo ya validado en [RG-2b](deployment.md#validación-https-gratuita-rg-2b-docker-local--cloudflare-quick-tunnel) y **no se han ejecutado tal como están escritos aquí**: si alguno falla al ejecutarlos, se corrige este documento, no se improvisa.

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

Cada sesión de dispositivos empieza aquí y termina en el paso 9. **El hostname cambia en cada ejecución**: una PWA instalada, una sesión o un compartido de una sesión anterior **no** continúan en la siguiente (el origen es otro). Cada sesión de QA se hace de una vez y se reinstala la PWA.

```bash
# 0. imagen del commit a probar (anotar el commit)
docker build -t academic-planner:rg3 .

# 1. red privada y base desechable: SIN publicar ningún puerto de PostgreSQL
docker network create planner-rg3
PGPASS="$(openssl rand -hex 16)"                      # no se imprime ni se guarda en el repositorio
docker run -d --name planner-rg3-db --network planner-rg3 \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=planner_rg3 postgres:17
docker exec planner-rg3-db pg_isready -U postgres -d planner_rg3                  # esperar "accepting connections"
DBURL="postgresql://postgres:$PGPASS@planner-rg3-db:5432/planner_rg3"

# 2. el túnel primero: el hostname solo se conoce al arrancarlo (sin cuenta, sin dominio, sin abrir puertos del router)
docker run -d --name planner-rg3-tunnel --network planner-rg3 cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://planner-rg3-web:8080
HOST="$(docker logs planner-rg3-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)"; echo "$HOST"

# 3. migraciones: un paso aparte, desde la misma imagen (la web nunca migra al arrancar)
docker run --rm --network planner-rg3 -e DATABASE_URL="$DBURL" academic-planner:rg3 npm run db:deploy   # 15 migraciones, exit 0

# 4. el proceso web: CORS_ORIGIN exacto (sin barra final), un salto de proxy, PORT inyectado y sin API_PORT
docker run -d --name planner-rg3-web --network planner-rg3 \
  -e DATABASE_URL="$DBURL" -e CORS_ORIGIN="$HOST" -e TRUST_PROXY=1 -e PORT=8080 academic-planner:rg3
docker inspect -f '{{.State.Health.Status}}' planner-rg3-web                       # esperar "healthy"

# 5. humo completo por HTTPS: debe dar 36 pasan, 0 fallan, 0 n/a
BASE_URL="$HOST" npm run smoke -- --full
```

`TRUST_PROXY=1` está medido **solo** para esta topología (Cloudflare delante de un único contenedor): no se extiende a otro proveedor sin repetir la medición. Después del paso 5, la sesión está lista para los bloques 3, 4 y 5. El mantenedor abre `$HOST` en el teléfono. Para el bloque 5 de sesión y reinicio se usa `docker restart planner-rg3-web` (el hostname del túnel no cambia mientras el contenedor del túnel siga vivo).

**Cierre obligatorio de cada sesión (paso 9)**, aunque algo haya fallado:

```bash
docker rm -f planner-rg3-tunnel planner-rg3-web planner-rg3-db
docker network rm planner-rg3
curl -s -o /dev/null -w "%{http_code}\n" "$HOST/api/health"      # el hostname ya no debe servir la aplicación (se espera 502/404, nunca 200)
docker ps -a --format '{{.Names}}' | grep planner-rg3            # sin salida
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

No toca la base de desarrollo, ninguna `*_test` ni el túnel. Base nueva y desechable; el procedimiento general está en [backup-restore.md](backup-restore.md).

```bash
docker network create planner-rg3-br
PGPASS="$(openssl rand -hex 16)"
docker run -d --name planner-rg3-br-db --network planner-rg3-br -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=planner_origin postgres:17
docker exec planner-rg3-br-db pg_isready -U postgres -d planner_origin

# datos sintéticos: migraciones + humo completo contra un contenedor web local (127.0.0.1, sin túnel)
DBURL="postgresql://postgres:$PGPASS@planner-rg3-br-db:5432/planner_origin"
docker run --rm --network planner-rg3-br -e DATABASE_URL="$DBURL" academic-planner:rg3 npm run db:deploy
docker run -d --name planner-rg3-br-web --network planner-rg3-br -p 127.0.0.1:4310:8080 \
  -e DATABASE_URL="$DBURL" -e CORS_ORIGIN=http://127.0.0.1:4310 -e PORT=8080 academic-planner:rg3
BASE_URL=http://127.0.0.1:4310 npm run smoke -- --full          # HTTP local: los controles solo-HTTPS salen n/a, y está bien aquí

# anotar recuentos de origen (relaciones incluidas)
docker exec planner-rg3-br-db psql -U postgres -d planner_origin -Atc \
  'SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "AcademicPeriod"), (SELECT count(*) FROM "Subject"), (SELECT count(*) FROM "Activity")'

# copia, restauración en OTRA base, integridad
docker exec planner-rg3-br-db pg_dump -U postgres --format=custom --no-owner -f /tmp/planner.dump planner_origin
docker exec planner-rg3-br-db createdb -U postgres planner_restored
docker exec planner-rg3-br-db pg_restore -U postgres --no-owner -d planner_restored /tmp/planner.dump
# mismos recuentos en planner_restored (la consulta de arriba con -d planner_restored)

# migraciones: no debe aplicar nada nuevo sobre la restaurada
docker run --rm --network planner-rg3-br \
  -e DATABASE_URL="postgresql://postgres:$PGPASS@planner-rg3-br-db:5432/planner_restored" academic-planner:rg3 npm run db:deploy

# la aplicación sobre la restaurada: salud 200 y una cuenta de la copia inicia sesión (compararlo con la nota del humo)
# cierre: se destruye todo
docker rm -f planner-rg3-br-web planner-rg3-br-db && docker network rm planner-rg3-br
```

Criterio: recuentos idénticos entre origen y restaurada; las relaciones persisten (una actividad con su asignatura y periodo; una nota con su corte, si se crearon datos de notas); `db:deploy` sobre la restaurada no aplica nada; la aplicación arranca y responde con `database: up`; todo destruido al terminar. El respaldo solo cuenta como **ensayado** con esa evidencia; **no equivale a las copias de un proveedor**, que no existen.

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
