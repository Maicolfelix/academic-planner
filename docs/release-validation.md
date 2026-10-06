# Evidencia de validación del candidato 1.0.0-rc.1

Resultados de la validación del **Release Candidate 1**. No copia registros completos: resume cada comprobación con su comando, resultado y commit. Ficha técnica: [release-manifest.md](release-manifest.md). Notas: [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md). Pendientes: [final-checklist.md](final-checklist.md).

**Veredicto de esta validación:** sin BLOCKER ni HIGH abiertos al aprobar el candidato. Eso **no** significa «sin errores» ni «listo para producción pública»: ver [Límites de la validación](#límites-de-la-validación).

## Commits

| Qué                                               | Commit                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Congelación de código (`main`, Fase 19 fusionada) | `151f6b31c44611babc427f743dc499b717deade0`                                                                                                                                         |
| **Commit del candidato** (versiones y documentos) | `c6ae6c3f813ebc2aeac59d301daf3bf8db288c9b` — **todas las comprobaciones de abajo se ejecutaron sobre este commit**, en un clon limpio del remoto, con el árbol sin cambios         |
| Commit con esta evidencia                         | El que añade este archivo y actualiza la lista final: **solo documentación** (`git diff --stat c6ae6c3f..HEAD` solo toca `docs/release-validation.md` y `docs/final-checklist.md`) |
| Commit final del release                          | Se asigna después de fusionar el PR; no se inventa aquí                                                                                                                            |

Entre el candidato y el commit de evidencia no cambia código, pruebas, versiones ni dependencias. `docs:check`, `security:scan` y el formato se repitieron sobre el commit con la evidencia.

## Línea base (sobre la congelación `151f6b31`, antes de tocar nada)

`npm ci` (61 s), `lint`, `format:check`, `typecheck`, `npm test` (1585 pruebas), `build`, `docs:check`, `security:scan`, `test:security` (155), Playwright completo (254 pasan + 4 omitidas, 7,1 min) y `test:security:browser` (9): todo en verde. `git status` limpio y puertos libres.

## Matriz final de comprobaciones (commit `c6ae6c3f`, clon limpio)

| Comprobación               | Comando                               | Resultado                                          | Cantidad                         |               Duración |
| -------------------------- | ------------------------------------- | -------------------------------------------------- | -------------------------------- | ---------------------: |
| Instalación                | `npm ci`                              | OK                                                 | —                                |                   23 s |
| Lint                       | `npm run lint`                        | OK                                                 | —                                |                   11 s |
| Formato                    | `npm run format:check`                | OK                                                 | —                                |                    9 s |
| Tipos                      | `npm run typecheck`                   | OK                                                 | core, api, web, e2e              |                   17 s |
| Vitest                     | `npm test`                            | OK                                                 | **1585** = 766 + 782 + 37        |                  273 s |
| Build                      | `npm run build`                       | OK (solo el aviso de tamaño de _chunk_ de siempre) | —                                |                   15 s |
| Documentación              | `npm run docs:check`                  | 0 hallazgos                                        | 39 archivos                      |                    1 s |
| Prueba del verificador     | `npm run test:docs`                   | OK                                                 | 5                                |                    2 s |
| Escaneo de secretos        | `npm run security:scan`               | «nothing found»                                    | —                                |                   <1 s |
| Seguridad de la API        | `npm run test:security`               | OK                                                 | 155 (en 5 archivos)              |                   47 s |
| Seguridad en navegador     | `npm run test:security:browser`       | OK                                                 | 9                                |                   45 s |
| Playwright (360 y 1366 px) | `npx playwright test` (×5, ver abajo) | 5 de 5 verdes                                      | 258 por pasada: 254 + 4 omitidas | 5,3–6,2 min por pasada |
| Auditoría                  | `npm audit`                           | 4 altas (sin cambios)                              | —                                |                      — |

Las 4 omitidas son a propósito (teclado solo en escritorio y tamaño táctil solo en móvil). Humo de rendimiento (dentro de las 782 pruebas de API): ver [más abajo](#humo-de-rendimiento).

## Instalación limpia (solo con el README)

Clon nuevo **del remoto** (`gh repo clone`, rama `release/phase-20-rc`), después de `docker compose down -v`, sin conocimiento oculto:

- `npm ci` → `cp .env.example .env` → `npm run db:up` → `npm run db:deploy` → `npm run dev`: la API responde `{"status":"ok","database":"up"}` y la web sirve `/login` (200) y proxifica `/api/health`.
- **Migraciones:** 6 aplicadas desde una base vacía (`init`, `auth_user_session_drop_app_metadata`, `academic_periods_and_subjects`, `activities`, `schedule_blocks`, `reminders`), sin SQL manual. **Sin deriva de esquema:** `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` → «No difference detected».
- No hubo que corregir el README.

## Arranque tipo producción (mismo origen)

`npm run build`, luego `NODE_ENV=production … WEB_DIST_DIR=<apps/web/dist> node apps/api/dist/server.js` (puerto 4400; es el comando de [deployment.md](deployment.md)).

| Comprobación             | Resultado                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Salud                    | `GET /api/health` → 200 `{"status":"ok","database":"up","timestamp":…}`; no expone versiones, rutas ni datos                                                                                                                                                                                                                           |
| Mismo origen             | La API sirve la app (`/` → 200) y `/api/*` desde el mismo origen; las rutas de la interfaz abren al recargar                                                                                                                                                                                                                           |
| Cabeceras (`/` y `/api`) | CSP estricta (`script-src 'self'`, `frame-ancestors 'none'`, sin `unsafe-inline`/`unsafe-eval` en scripts), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-*`, y `Cache-Control: no-store` en la API |
| Autenticación            | registro 201, `/me` 200 con la cookie, `/me` 401 sin ella, cierre de sesión 204, **origen ajeno → 403** (CSRF)                                                                                                                                                                                                                         |
| Cookie                   | `__Host-academic_planner_session; Path=/; HttpOnly; Secure; SameSite=Lax`, sin `Domain`. Los navegadores aceptan `Secure` en `http://localhost`; **HTTPS real sigue sin validarse**                                                                                                                                                    |
| CSP en el navegador      | Sin errores de consola durante todo el recorrido (las violaciones de CSP se reportan ahí) y sin eventos `securitypolicyviolation` en la última pantalla, con el _build_ de producción                                                                                                                                                  |

## Humo funcional del _build_ de producción (navegador real, Edge)

Scripts temporales (no versionados) sobre el servidor tipo producción: **25/25 comprobaciones**.

- Registro, onboarding, asignaturas y actividad por la interfaz; **Captura rápida** (`parcial redes martes 10am`) y **Bandeja** (mensaje con dos actividades) muestran vista previa y **no crean nada**.
- **Importación de horario con PNG, PDF con texto y PDF escaneado:** las tres proponen «Redes» y «Bases de Datos»; la agenda queda vacía (no se crea nada) y no quedan archivos en el directorio temporal del sistema.
- 8 pantallas sin desbordes a **360, 768 y 1366 px**; **axe: 0 violaciones** en 7 pantallas.
- PWA: _service worker_ registrado; **Cache Storage sin respuestas de `/api`** (también tras cerrar sesión); sin red, el _shell_ abre.
- Dos usuarios: el segundo recibe el **mismo 404** para la actividad del primero que para un id inexistente.
- La primera ejecución de los scripts falló en 4 comprobaciones por errores **del propio script** (selectores de la pantalla de importación y ruido del paso sin conexión); se corrigieron y no eran hallazgos del producto.

## Teclado y diseño adaptable

- **Solo teclado** sobre el _build_ de producción: inicio de sesión, enlace «Saltar al contenido» como primer _Tab_, navegación a Actividades, apertura de un diálogo (el foco entra en él), `Escape` lo cierra, creación de una actividad (asignatura con flechas, fecha tecleada, Enter) y cierre de sesión: **12/12**. Una primera pasada del script falló por una carrera del script (la URL cambia antes de que cargue la pantalla perezosa); con la página cargada el orden de _Tab_ es correcto (verificado). La prueba e2e de teclado del repositorio también está en las cinco pasadas.
- Responsivo a 360, 768 y 1366 px: sin desbordes ni regresiones.

## Datos de demostración y recorrido manual (`docs/demo.md`)

Desde la instalación limpia:

- `npm run db:seed:demo -- --allow-demo` crea 1 usuario, 6 asignaturas, 6 clases semanales, 15 actividades (4 finalizadas) y 30 recordatorios en 0,8 s; la **segunda ejecución no duplica** (mismos conteos, 1 usuario demo).
- **Guardas:** sin el flag → rechaza (código 2, «Demo seed is disabled…»); `NODE_ENV=production` **más** `--allow-demo` → rechaza (código 2, «NODE_ENV is "production"»).
- **Recorrido manual de la demo, escritorio y móvil: 24/24.** Inicio de sesión; Dashboard con **«¿Qué hago ahora?» = Parcial 1 de Redes** (prioridad alta, vence en menos de 24 h); Radar 1/2/2/3/3; Agenda con las clases; 15 actividades; Captura rápida (`parcial seguridad martes 10am` → Seguridad Informática, Parcial, 10:00 a. m.); Bandeja (quiz de Bases de Datos y taller de Bioestadística); importación por OCR con vista previa editable (propone «¿Quisiste decir Redes de Computadores?» y deja la asignatura por confirmar); Progreso 27 % y carga semanal; cierre de sesión (la API responde 401 después).

## Cinco pasadas completas consecutivas de Playwright

**Un solo commit: `c6ae6c3f813ebc2aeac59d301daf3bf8db288c9b`**, árbol limpio, clon recién instalado, `PW_CHANNEL=msedge npx playwright test` con `DEBUG=pw:webserver`; puertos 3000/5173 libres antes de cada pasada y al final.

| Pasada | Pasan | Fallan | Omitidas | `ERR_CONNECTION_REFUSED` | Duración |
| -----: | ----: | -----: | -------: | -----------------------: | -------: |
|      1 |   254 |      0 |        4 |                        0 |  6,2 min |
|      2 |   254 |      0 |        4 |                        0 |  5,4 min |
|      3 |   254 |      0 |        4 |                        0 |  5,3 min |
|      4 |   254 |      0 |        4 |                        0 |  5,3 min |
|      5 |   254 |      0 |        4 |                        0 |  5,3 min |

Sin fallos ni intermitencias, así que no hay análisis de _flakes_ que hacer. Aislamiento: la base de test se crea y migra sola (`ensureTestDatabaseSync`), cada especificación crea sus propios usuarios, no hay orden ni datos previos de los que dependa, y la base de desarrollo quedó con 0 filas.

## Humo de rendimiento

`apps/api/src/systemValidation/performance.test.ts` (3 pruebas, en verde). **Medianas en una máquina de desarrollo, una cuenta con 500 actividades; no es una prueba de carga ni un SLA.**

| Operación                        | Mediana (ms) |
| -------------------------------- | -----------: |
| `GET /api/dashboard`             |         15,9 |
| `GET /api/activities`            |         15,2 |
| `GET /api/radar`                 |         13,5 |
| `GET /api/attention`             |         13,5 |
| `GET /api/progress`              |          9,0 |
| `GET /api/workload`              |          9,9 |
| `GET /api/schedule` (una semana) |          7,2 |
| Bandeja (5000 caracteres)        |         22,3 |
| Captura rápida                   |          7,2 |
| Inicio de sesión (Argon2id)      |        157,4 |

## Auditoría, Prisma y secretos

| Comprobación            | Resultado                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit`             | **4 altas** (cadena del CLI de Prisma: `@prisma/config` → `deepmerge-ts`, y `mysql2`). Sin cambios desde la Fase 16. **No se usó `--force`**                                                              |
| Prisma                  | Instalada 7.10.0 = **última estable**; el tag `latest` es `8.0.0-rc.20` (candidato, no estable) y `next` es `8.0.0-rc.10`. No se actualiza; riesgo aceptado                                               |
| `npm run security:scan` | Limpio                                                                                                                                                                                                    |
| Secretos versionados    | Solo `.env.example` (sin secretos); `.env` no está versionado; sin claves, tokens ni cookies; la contraseña de la demo es sintética y local ([demo.md](demo.md))                                          |
| Archivos grandes        | El mayor es `package-lock.json` (432 kB); en el repositorio solo hay 4 iconos PNG pequeños (PWA); sin modelos, videos, PDF ni capturas versionados. El modelo OCR viene de `@tesseract.js-data/spa` (npm) |
| `package-lock.json`     | La diferencia del candidato son 14 líneas: las versiones de los cuatro paquetes y los rangos de `@planner/core`; **sin actualizaciones de dependencias**                                                  |
| SBOM                    | `npm sbom --sbom-format spdx --sbom-type application`: 751 paquetes, 1560 relaciones; sin rutas ni datos personales. **No se versiona** (≈ 1 MB, se regenera); se adjuntaría al release                   |

## `MaxListenersExceededWarning` (P17-04)

Sigue ocurriendo (14 avisos en una corrida completa de las pruebas de API). **Causa conocida:** con `--trace-warnings` el origen es `supertest` (`Test.end` registra un listener `once` por solicitud) cuando una prueba lanza más de 10 solicitudes concurrentes sobre la misma aplicación. No hay código del producto en la traza. BAJA, documentado; no se refactoriza en un candidato.

## Revisión visual

Se tomaron capturas reales del _build_ de producción con los datos de la demo (Dashboard, Agenda, Actividades, Captura rápida, Bandeja, Importación y Progreso, en escritorio y móvil) y **se revisaron visualmente** el Dashboard (1366 y 360 px), la Agenda de escritorio y la vista previa de importación en móvil: legibles, coherentes, sin desbordes y con la recomendación, el Radar y el progreso visibles. El resto de las capturas se generó y se ejercitó con comprobaciones automáticas, pero no se inspeccionó una por una. Las capturas no se versionan.

## Registro de hallazgos

| ID     | Severidad | Descripción                                                        | Estado                    | Impacto en el release |
| ------ | --------- | ------------------------------------------------------------------ | ------------------------- | --------------------- |
| P17-04 | BAJA      | `MaxListenersExceededWarning` de `supertest` en las pruebas de API | Documentado, sin corregir | Ninguno               |

**No se encontró ningún hallazgo nuevo del producto en esta validación.** BLOCKER abiertos: **0**. HIGH abiertos: **0**. MEDIUM abiertos: 0. LOW abiertos: 1 (P17-04).

## Límites de la validación

- **Sin dispositivos físicos** (iOS ni Android): no hubo acceso; lo medido es emulación a 360, 768 y 1366 px en Edge. Es una validación previa a una versión final, no un defecto funcional.
- **Sin HTTPS ni proxy inverso reales** y sin despliegue: la prueba tipo producción es local, sobre HTTP en `localhost`.
- El humo de rendimiento son medidas en una máquina de desarrollo.
- La accesibilidad se evaluó con axe y teclado; no está certificada.
- Los scripts de humo, recorrido y teclado son temporales y no están versionados: la evidencia de arriba es su resultado.
- «Validado con pruebas automatizadas, de integración y de extremo a extremo» no equivale a «sin errores».
