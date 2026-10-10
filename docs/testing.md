# Estrategia de pruebas

Las pruebas son la segunda fuente de verdad después del código: si un documento contradice a una prueba, se corrige el documento. Este archivo explica **qué capas hay, qué cubre cada una y cómo ejecutarlas**. Resultados de la validación integral: [system-validation.md](system-validation.md). Trazabilidad requisito → prueba: [requirements.md](requirements.md).

## Cifras actuales (candidato 1.0.0-rc.2)

| Capa                     | Herramienta                                       | Pruebas                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Núcleo (`packages/core`) | Vitest                                            | 880 en 17 archivos                                                                                                                                                                                                                                                                                                                                                                                                   |
| API (`apps/api`)         | Vitest + Supertest, PostgreSQL real               | 891 en 35 archivos (incluye 169 de seguridad, 28 del seed demo, 32 de actividades sin asignatura y 4 de la migración de F1 sobre datos antiguos)                                                                                                                                                                                                                                                                     |
| Interfaz (`apps/web`)    | Vitest                                            | 239 en 20 archivos                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Total Vitest**         |                                                   | **2010**                                                                                                                                                                                                                                                                                                                                                                                                             |
| Navegador                | Playwright (360 px y 1366 px)                     | 416 registrados por pasada: 403 se ejecutan y 13 se omiten a propósito (teclado solo en escritorio; tamaño táctil y barra inferior solo en móvil). `MASTER` depende de la hora (**KNOWN PRE-EXISTING / TEST RELIABILITY DEBT**, futura TEST-REL-1: no arreglada, no silenciada): corrido un jueves antes de las 8 a. m. (Bogotá) falla porque el «Quiz» de la Bandeja pasa a ser lo más urgente; es previo a UX1-2.5 |
| Seguridad en navegador   | Playwright (puerto 4300, topología de producción) | 9 (configuración aparte)                                                                                                                                                                                                                                                                                                                                                                                             |

Las cifras de Playwright cuentan **ejecuciones** (cada prueba corre en dos proyectos: móvil y escritorio). Nada se cuenta dos veces: las pruebas de seguridad de la API están dentro de las 845, y las de seguridad en navegador son un conjunto distinto de las 258.

## Capas

### Unitarias (`packages/core`)

Reglas puras, sin base de datos ni reloj real: fechas y zonas horarias, Radar, Atención, progreso y carga, recordatorios, intérpretes de texto, esquemas Zod. Reciben un `now` fijo, así que los bordes (23 h 59 min vs 24 h 1 min, medianoche, fin de mes, año bisiesto) se prueban con exactitud.

### Integración de API (`apps/api`)

Supertest contra **PostgreSQL real**, nunca contra simulacros: se prueban consultas, transacciones, restricciones (`CHECK`, índices únicos parciales), `FOR UPDATE` y propiedad de datos. Cada prueba parte de tablas vacías y el reloj de la aplicación es inyectable.

### Navegador (Playwright)

Recorridos reales con `watch(page, …)`, que falla ante cualquier error de consola, excepción o llamada fallida inesperada a la API. Dos proyectos: `mobile-360` (Pixel 5 a 360 px) y `desktop-1366`. Cada especificación crea sus propios usuarios; nada depende de datos previos.

### Seguridad

- **API** (`apps/api/src/security/`, 159 pruebas): autenticación y sesiones, cabeceras/CSRF/CORS/estáticos, **matriz IDOR** (todo recurso con id: el ajeno responde el mismo 404 y la base no cambia), robustez ante entradas hostiles, restricciones de base de datos.
- **Exportación a calendario (A4.1):** `calendarExport.test.ts` (API), `icalendar.test.ts` (core, con casos de inyección de CRLF, plegado a 75 octetos, Unicode y determinismo; los _mutation checks_ del serializador están descritos en [calendar-export.md](calendar-export.md)) y `e2e/calendar-export.spec.ts` (descarga real, 401, error con reintento, axe a 360 y 1366 px). Playwright no abre ninguna aplicación de calendario externa.
- **Navegador** (`e2e/security.spec.ts`, 9): cookie invisible para scripts, XSS almacenado mostrado como texto, CSRF desde otro origen, archivos servidos, subida inválida, todo con la CSP real.
- **Escaneo** (`npm run security:scan`): sin red; busca secretos y construcciones peligrosas en los archivos versionados.
- Una prueba de inventario falla si aparece una ruta no-GET sin registrar en la matriz de seguridad.

### Accesibilidad

`@axe-core/playwright` (etiquetas WCAG 2.0/2.1 A y AA) sobre cada pantalla con una cuenta cargada y sobre las pantallas con datos del escenario MASTER, más recorridos solo con teclado, foco en diálogos, tamaño táctil y desbordes. Es una evaluación orientada a WCAG, **no una certificación**. Antes de axe, las pruebas esperan a que terminen las animaciones de entrada (`entrancesDone(page)` en `e2e/helpers.ts`; los bucles ambientales, infinitos, se ignoran): un texto a medio aparecer se lee semitransparente y axe lo marcaba (un botón blanco al 70 % da 4,17:1). La prueba de `shell-navigation` que no esperaba daba esa falsa alarma en 2 de 20 ejecuciones **también en `main`**; ya espera (30 de 30 después). La misma regla vale para un clic forzado (`check({ force: true })` en un radio `sr-only`): no espera a que el diálogo termine de subir, así que se llama antes a `entrancesDone`. La semilla demo marcaba las fichas del Radar a medio aparecer (1,4:1) y fallaba casi siempre al repetirse en serie, **también en `main`**; ya espera (12 de 12 después). Ver [ux-accessibility.md](ux-accessibility.md).

### OCR e importación de horario

`packages/core/src/scheduleImport.test.ts` (interpretación sobre palabras con posición), `apps/api/src/scheduleImport/scheduleImport.test.ts` (validación de archivos, OCR real sobre imágenes sintéticas, PDF con texto y escaneado, límites, tiempo máximo) y `e2e/schedule-import.spec.ts`. Los archivos de prueba son **sintéticos** y se generan en el código (`apps/api/test/scheduleImportFixtures.ts`).

### Validación de sistema

`apps/api/src/systemValidation/system.test.ts` (coherencia entre módulos con reloj fijo, medianoche, bordes del periodo, errores, reinicio del servidor) y `e2e/system-validation.spec.ts` (un semestre completo de un estudiante, dos usuarios, fallos de red inyectados con recuperación, `Asia/Tokyo`, teclado, 768 px, inventario de rutas). Nota técnica: para inyectar fallos con `page.route` hay que bloquear el service worker (`serviceWorkers: 'block'`).

### Datos de demostración

`apps/api/src/demo/demoSeed.test.ts` y `e2e/demo-seed.spec.ts`. Ninguna otra prueba depende del seed.

## Base de datos de desarrollo y de prueba

| Base                    | Variable            | Uso                                                                 |
| ----------------------- | ------------------- | ------------------------------------------------------------------- |
| `academic_planner`      | `DATABASE_URL`      | Desarrollo y demostración                                           |
| `academic_planner_test` | `TEST_DATABASE_URL` | Pruebas de API y Playwright. **Su nombre debe terminar en `_test`** |

- `apps/api/test/testDb.ts` es el único lugar que decide qué base pueden tocar las pruebas. **Se niega** a ejecutar si el nombre no termina en `_test` o si `TEST_DATABASE_URL` es igual a `DATABASE_URL`.
- La base de test **se crea y se migra sola** (`prepareTestDatabase`). Vitest lo hace antes de las pruebas de API. Playwright arranca su servidor _antes_ de su `globalSetup`, así que las dos configuraciones de Playwright llaman primero a `ensureTestDatabaseSync()`, que la crea y migra en un proceso hijo; por eso `npm run test:browser` funciona también en una máquina nueva.
- Las pruebas vacían las tablas entre casos y **nunca** escriben en la base de desarrollo (se comprueba que queda con 0 filas).

## Cómo ejecutar

```bash
npm run db:up                                  # PostgreSQL (Docker) en :5433
npm run lint && npm run format:check && npm run typecheck
npm test                                       # Vitest: core, api, web
npm run build
npm run test:security                          # escaneo + pruebas de seguridad de la API
PW_CHANNEL=msedge npm run test:browser         # Playwright 360/1366 px (PowerShell: $env:PW_CHANNEL='msedge')
PW_CHANNEL=msedge npm run test:security:browser # seguridad en navegador (puerto 4300)
npm run docs:check                             # enlaces y scripts de la documentación
npm run test:docs                              # prueba del propio verificador (node:test, 5 pruebas)
```

- `PW_CHANNEL=msedge` usa Edge instalado; sin él, Playwright necesita su Chromium (`npx playwright install chromium`).
- `test:browser` levanta su propio stack con `npm run dev:e2e` (bundle compilado + API sin `--watch`) en el puerto 5173: **nada debe escuchar en :3000/:5173** antes de lanzarlo (ver [development.md](development.md#problemas-comunes)).

## Reglas de calidad de las pruebas

- **Mutation checks manuales** en reglas críticas (se rompe la regla a propósito, la prueba debe fallar, y se revierte; `grep MUTATION` debe dar 0).
- En e2e no se espera con una aserción que ya es cierta, y antes de cerrar sesión o borrar la cookie se espera a que la pantalla termine de cargar (si no, una petición en vuelo recibe 401 y el resultado depende del azar).
- Una falla intermitente no se «arregla repitiendo hasta que pase»: se guarda la traza, se busca la causa y solo entonces se reinician las pasadas.
- Las capturas de revisión visual van en un script temporal que se borra.

## Pruebas de humo de rendimiento

`apps/api/src/systemValidation/performance.test.ts`. Una sola cuenta con **500 actividades**, base de datos local en Docker, máquina de desarrollo, mediana de 7 repeticiones (milisegundos, incluye HTTP en el mismo proceso). **No es una prueba de carga, ni un benchmark, ni un SLA.**

| Operación                    | Mediana (ms) |
| ---------------------------- | -----------: |
| `GET /api/dashboard`         |         15,2 |
| `GET /api/activities`        |         15,5 |
| `GET /api/radar`             |         15,0 |
| `GET /api/attention`         |         13,3 |
| `GET /api/progress`          |          8,2 |
| `GET /api/workload`          |          9,8 |
| `GET /api/schedule` (semana) |         10,6 |
| Bandeja: 5000 caracteres     |         21,5 |
| Captura rápida               |          7,7 |
| Inicio de sesión (Argon2id)  |        180,5 |

Medidas de la Fase 17 (siguen siendo válidas: el código de esos caminos no cambió). El OCR de una imagen sintética tardó ≈ 136 ms en la Fase 16 y el seed demo ≈ 0,8 s. No se afirma ninguna capacidad de usuarios concurrentes.

## Prueba de migración sobre datos antiguos (F1-0)

Una migración que reescribe datos no se prueba solo con una base nueva. `apps/api/src/db/activityPeriodMigration.test.ts` crea una base desechable (`<test>_f1_migration_test`, derivada de la `*_test`), aplica las migraciones **anteriores** a F1, inserta filas con el esquema antiguo (actividades con asignatura, sin periodo, con un recordatorio), aplica la migración de F1 y comprueba: mismas filas y mismas asignaturas, ningún `periodId` nulo, cada periodo igual al de su asignatura, el recordatorio intacto, la FK compuesta sin cascadas ni `MATCH FULL` y los tres casos del invariante en esa base. La base se borra al terminar. Además, `prisma migrate diff` entre la base migrada y `schema.prisma` no da diferencias.

## Falla conocida de las pruebas

`MaxListenersExceededWarning` de Node (11 listeners en `Server`) al correr las pruebas de API: `supertest` añade un listener por solicitud cuando una prueba lanza más de 10 concurrentes sobre la misma aplicación. No afecta al servidor y no se ha corregido ([limitations.md](limitations.md)).
