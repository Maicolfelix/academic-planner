# Validación integral del sistema (Fase 17)

Objetivo: comprobar el producto **como un todo**, no módulo por módulo. No se añadió ninguna funcionalidad. Se escribió una suite de validación que recorre al estudiante de principio a fin, se contrastó cada pantalla con una lectura independiente de la API (un «oráculo»), se repitieron los recorridos con fallos inyectados, relojes fijos y varios navegadores, y se reprodujo la instalación desde cero siguiendo el README.

Lo que **no** se afirma: no es una prueba de penetración, no es una prueba de carga real, no se probó en iOS ni Android físicos (ver [Pendiente](#pendiente-y-limites-honestos)).

## Qué se añadió

| Archivo                                                                                                   | Qué es                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [apps/api/src/systemValidation/system.test.ts](../apps/api/src/systemValidation/system.test.ts)           | 13 pruebas de API con reloj fijo (`2026-10-05T17:00Z`, Bogotá 12:00): coherencia entre módulos, límites de tiempo, errores |
| [apps/api/src/systemValidation/performance.test.ts](../apps/api/src/systemValidation/performance.test.ts) | 3 pruebas de humo de rendimiento (500 actividades, 5000 caracteres, login)                                                 |
| [e2e/system-validation.spec.ts](../e2e/system-validation.spec.ts)                                         | 9 bloques de navegador real (18 ejecuciones: 360 px y 1366 px; el de teclado solo se ejecuta en escritorio)                |

## Matriz de escenarios

«Real» = lo que se observó al ejecutar. Todos los escenarios **pasaron**; no hubo que cambiar código de producto.

| ID         | Escenario                      | Precondiciones                                | Pasos (resumen)                                                                                                  | Esperado                                                                                                                                | Real                                                                 | Evidencia                        |
| ---------- | ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| E2E-01/02  | Registro, periodo, asignaturas | Navegador limpio                              | Registrar → onboarding (Segundo semestre 2026) → 5 asignaturas por la UI                                         | Un periodo actual; 5 asignaturas; sesión activa                                                                                         | Igual                                                                | MASTER                           |
| E2E-03     | Actividades manuales           | E2E-01/02                                     | 3 por el diálogo, 2 por la API (vencida, inmediata, próxima, planificable, bajo control)                         | Aparecen en la lista con su estado Radar                                                                                                | Igual                                                                | MASTER                           |
| E2E-04     | Captura rápida                 | Asignaturas                                   | `parcial redes <día> 10am` → interpretar → editar título → confirmar                                             | Se crea con el `POST /api/activities` normal; nunca antes de confirmar                                                                  | Igual                                                                | MASTER                           |
| E2E-05     | Bandeja académica              | Asignaturas                                   | Mensaje con 2 propuestas → revisar → confirmar una a una                                                         | 2 actividades creadas, una por confirmación                                                                                             | Igual                                                                | MASTER                           |
| E2E-06     | Clase semanal manual           | Periodo                                       | Crear bloque semanal                                                                                             | Ocurrencias dentro del periodo                                                                                                          | Igual                                                                | MASTER                           |
| E2E-07     | Importación de horario (OCR)   | Imagen de tabla conocida                      | Subir → OCR local → vista previa → confirmar; reimportar                                                         | 2 clases propuestas y creadas; la reimportación avisa duplicados                                                                        | Igual                                                                | MASTER                           |
| E2E-08     | Recordatorios                  | Parcial con fecha cercana                     | Ver pendientes, mover el reloj en la BD, marcar visto, recargar                                                  | Solo futuros y antes del plazo; vencidos aparecen; «visto» persiste                                                                     | Igual                                                                | MASTER, `system.test.ts`         |
| E2E-09     | Radar                          | Actividades deliberadas                       | Comparar UI con API                                                                                              | Cada actividad en exactamente su banda; completadas en ninguna                                                                          | Igual (también los bordes 23 h 59 min / 24 h 1 min)                  | MASTER, `system.test.ts`         |
| E2E-10     | ¿Qué hago ahora?               | Vencida de prioridad alta                     | Leer Dashboard y `/api/attention`                                                                                | La vencida de prioridad alta lidera, con las mismas razones                                                                             | Igual                                                                | MASTER, `system.test.ts`         |
| E2E-11/12  | Progreso y carga               | Mezcla de completadas                         | Comparar con conteos independientes de Agenda/Actividades                                                        | Coinciden; sin lenguaje de juicio; asignatura vacía = «vacía», no 0 %                                                                   | Igual                                                                | `system.test.ts`                 |
| E2E-13     | Completar y reabrir            | Recomendación activa                          | Finalizar la recomendada, comprobar todo, reabrir                                                                | Dashboard, Radar, Atención, Progreso, Recordatorios se mueven juntos y vuelven (17 %→33 %→17 %)                                         | Igual                                                                | MASTER, `system.test.ts`         |
| E2E-14     | Persistencia                   | Datos del MASTER                              | Recargar; contexto de navegador nuevo; cerrar e iniciar sesión; instancia nueva del servidor con la misma cookie | Instantáneas idénticas                                                                                                                  | Igual                                                                | MASTER, `system.test.ts`         |
| E2E-15     | PWA y cierre de sesión         | Service worker activo                         | Sin conexión: el shell abre sin datos privados; cerrar sesión                                                    | Shell sin datos; nada privado en caché; sesión antigua muerta                                                                           | Igual                                                                | MASTER, `pwa.spec.ts`, seguridad |
| E2E-16     | Dos usuarios                   | Usuario A con datos                           | Usuario B parte de cero; intenta leer/editar ids de A                                                            | B ve vacío; recurso ajeno = mismo 404 que inexistente; BD sin cambios                                                                   | Igual                                                                | `E2E-16`, `ownership.security`   |
| E2E-17     | Recuperación de errores        | Fallos inyectados (`serviceWorkers: 'block'`) | Fallo de refresco; fallo de creación; una propuesta de la Bandeja falla; una clase de la importación falla       | Los datos mostrados se conservan + «Reintentar»; el formulario conserva lo escrito; lotes parciales (1 creada, 1 pendiente) y reintento | Igual                                                                | 3 pruebas `E2E-17`               |
| E2E-18     | Zona horaria, teclado, 768 px  | Navegador en `Asia/Tokyo`, perfil Bogotá      | Horas y día; recorrido solo con teclado hasta completar; tablet                                                  | El día es el del perfil; todo operable con teclado; diseño acordado a 768 px                                                            | Igual                                                                | 3 pruebas `E2E-18`               |
| Frontera   | Medianoche y periodo           | Reloj fijo                                    | 23:50 → 00:10 Bogotá; clase antes/después del periodo; último sábado                                             | `localDate`, «vencida», Radar y saludo cambian a la vez; 400 fuera del periodo                                                          | Igual (saludo a las 00:10 = «Buenas noches», comportamiento vigente) | `system.test.ts`                 |
| Integridad | Base de datos                  | Historia completa                             | Consultas directas                                                                                               | Dueño coherente, `COMPLETED ⇔ completedAt`, bloques en periodo, recordatorios, un periodo actual                                        | Igual                                                                | MASTER, `system.test.ts`         |
| Errores    | Envoltorio de errores          | —                                             | Provocar 400/401/403/404/409/413/415/429                                                                         | Mismo `{ error: { code, message } }` y estado correcto                                                                                  | Igual (`SUBJECT_ALREADY_EXISTS` para el 409)                         | `system.test.ts`                 |
| Rutas      | Inventario de pantallas        | —                                             | Cada pantalla carga, resiste recarga; las protegidas redirigen al login                                          | Ver [Inventario de rutas](#inventario-de-rutas-de-la-app)                                                                               | Igual                                                                | `route inventory`                |

Nota de etiquetas: el paso del Dashboard del MASTER lleva en su comentario la etiqueta histórica `E2E-26`; verifica «el Dashboard dice lo que dicen los demás módulos» y es parte de E2E-08…E2E-13.

## Escenario maestro (un estudiante, un semestre)

Una sola prueba larga (`MASTER`, 360 px y 1366 px), solo con la interfaz salvo donde se indica:

1. Registro y onboarding; periodo; 5 asignaturas.
2. Tres actividades por el diálogo; dos por la API para fijar vencida/inmediata (fecha exacta).
3. Captura rápida; Bandeja con dos propuestas.
4. Clase semanal manual (por la API: el diálogo ya lo cubre `calendar.spec.ts`) y clases importadas por OCR; reimportación con avisos de duplicado.
5. Dashboard, Radar, Atención, Recordatorios, Progreso y Carga, **cada uno contra el oráculo de la API**.
6. Completar la recomendada y reabrirla; todos los módulos se mueven juntos.
7. Recarga, contexto de navegador nuevo, cerrar e iniciar sesión: instantáneas idénticas.
8. axe (WCAG A/AA) en 5 rutas con datos; integridad en la BD; consola y red limpias (`watch`); shell sin conexión.

## Evidencia por requisito (RF01–RF09)

| RF   | Requisito              | Dónde se comprueba                                                                                                        |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| RF01 | Autenticación          | MASTER (registro, cierre e inicio de sesión), `auth.spec.ts`, `security/auth.security.test.ts`                            |
| RF02 | Asignaturas            | MASTER (5 por la UI), `subjects.spec.ts`, `E2E-16`                                                                        |
| RF03 | Actividades            | MASTER (dialog, API, Captura rápida, Bandeja), `activities.spec.ts`                                                       |
| RF04 | Filtros                | `activities.spec.ts` (filtros en la URL, combinados, sobreviven a la recarga), `system.test.ts` (Radar)                   |
| RF05 | Agenda y solapes       | MASTER (clase manual + importada), `calendar.spec.ts` (aviso de conflicto), `system.test.ts` (bordes del periodo)         |
| RF06 | Recordatorios          | MASTER y `system.test.ts` (solo futuros, cancelar/revivir, «visto» persiste), `reminders.spec.ts`                         |
| RF07 | Progreso               | MASTER y `system.test.ts` (17 %→33 %→17 %, asignatura vacía), `progress.spec.ts`                                          |
| RF08 | Propiedad de los datos | `E2E-16`, `ownership.security.test.ts` (matriz IDOR)                                                                      |
| RF09 | PWA                    | MASTER (shell sin conexión), `pwa.spec.ts`, prueba manual de actualización de la Fase 13 (el SW no se tocó en la Fase 17) |

## Resultados

Todas las cifras son de esta rama, sin doble conteo (cada prueba se cuenta una vez).

| Suite                                    | Resultado                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Vitest `core`                            | 766 pasan                                                                |
| Vitest `api` (BD real `*_test`)          | 754 pasan (738 previas + 13 de sistema + 3 de rendimiento + 0 retiradas) |
| Vitest `web`                             | 37 pasan                                                                 |
| **Vitest total**                         | **1557**                                                                 |
| Playwright (360 px y 1366 px)            | 256 por pasada: 252 pasan + 4 omitidas a propósito (según el viewport)   |
| Playwright de seguridad (topología prod) | 9 pasan                                                                  |
| `npm run test:security`                  | escaneo limpio + 155 pruebas pasan (subconjunto ya contado en la API)    |
| `npm audit`                              | 4 altas (cadena del CLI de Prisma), aceptadas; no se usó `--force`       |

Cinco pasadas completas consecutivas de Playwright tras el último cambio, todas verdes: ver [Pasadas consecutivas](#pasadas-consecutivas).

### Pruebas de humo de rendimiento

Una cuenta con 500 actividades, base de datos local en Docker, mediana de 7 repeticiones (ms, incluye HTTP en el mismo proceso):

| Operación                      | Mediana (ms) |
| ------------------------------ | -----------: |
| `GET /api/dashboard`           |         15,2 |
| `GET /api/activities`          |         15,5 |
| `GET /api/radar`               |         15,0 |
| `GET /api/attention`           |         13,3 |
| `GET /api/progress`            |          8,2 |
| `GET /api/workload`            |          9,8 |
| `GET /api/schedule` (semana)   |         10,6 |
| Bandeja: 5000 caracteres → ≤10 |         21,5 |
| Captura rápida                 |          7,7 |
| Login (Argon2id)               |        180,5 |

OCR de imagen (Fase 16): ≈ 136 ms con el fixture. Es una prueba de humo en una máquina de desarrollo, no una medición de capacidad.

## Persistencia

Probada de cuatro formas: recarga de página, **contexto de navegador nuevo** (sin cookies compartidas), cerrar/iniciar sesión (instantáneas iguales), y **instancia nueva del servidor** (`buildApp()` nuevo con la misma cookie sirve la misma sesión y los mismos datos; un recordatorio «visto» sigue visto).

## Inventario de rutas de la app

`/login`, `/register`, `/status` (públicas); `/onboarding`, `/dashboard`, `/subjects`, `/activities`, `/calendar`, `/calendar/import`, `/radar`, `/progress`, `/inbox` (protegidas: sin sesión llevan a `/login`); cualquier otra → 404 con enlace de vuelta.

## Inventario de la API

No hay OpenAPI; el inventario es esta lista, comprobada contra los routers y contra la matriz de `http.security.test.ts` (una prueba de inventario falla si falta una ruta no-GET).

| Base                                                                               | Operaciones                                                                    | Sesión                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `/api/health`                                                                      | `GET`                                                                          | no                          |
| `/api/auth`                                                                        | `POST register`, `POST login` (límites de frecuencia), `POST logout`, `GET me` | register/login no; resto sí |
| `/api/periods`                                                                     | `GET`, `POST`, `GET/:id`, `PATCH/:id`, `DELETE/:id`                            | sí                          |
| `/api/subjects`                                                                    | ídem                                                                           | sí                          |
| `/api/activities`                                                                  | ídem                                                                           | sí                          |
| `/api/schedule`                                                                    | ídem (bloques y agenda)                                                        | sí                          |
| `/api/reminders`                                                                   | `GET`, `GET due`, `POST`, `POST seen`, `PATCH/:id`, `DELETE/:id`               | sí                          |
| `/api/dashboard`, `/api/radar`, `/api/attention`, `/api/progress`, `/api/workload` | `GET`                                                                          | sí                          |
| `/api/quick-capture/parse`, `/api/academic-inbox/parse`                            | `POST` (solo proponen)                                                         | sí                          |
| `/api/schedule-import/parse`                                                       | `POST` multipart (límite de frecuencia, un import por usuario)                 | sí                          |

Estados: 400 validación, 401 sin sesión, 403 origen no permitido (CSRF), 404 inexistente **o ajeno**, 409 conflicto de dominio, 413 cuerpo demasiado grande, 415 tipo no admitido, 429 límite de frecuencia, 500 genérico sin pila. Todos con el mismo envoltorio `{ error: { code, message } }` (probado).

## Registro de defectos

Sin defectos BLOQUEANTES, ALTOS ni MEDIOS **del producto**. Hallazgos (todos menores, de herramientas, documentación o pruebas):

| ID     | Gravedad | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Estado                                                                                                                                                  |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P17-01 | BAJA     | `npm run security:scan` fallaba en un clon limpio: una URL falsa con credenciales (`SECRETPW@10.1.2.3`) en `http.security.test.ts` (prueba de que el 500 no filtra secretos). En la Fase 16 pasó solo porque el archivo aún no estaba bajo git cuando se escaneó.                                                                                                                                                                                                                                                                                         | **Corregido** (host `example.test`; la aserción no cambia)                                                                                              |
| P17-02 | BAJA     | README desactualizado: decía que `test:browser` arranca `npm run dev` (es `dev:e2e`), faltaban los scripts de seguridad, la cookie `__Host-` bajo HTTPS y quedaba una frase de la Fase 5.                                                                                                                                                                                                                                                                                                                                                                 | **Corregido**                                                                                                                                           |
| P17-03 | BAJA     | **Trampa de entorno, no del producto.** Matar `npm run dev` solo por puerto deja vivo el vigilante `node --watch`, que reaparece en :3000 con la BD **de desarrollo**. El siguiente `test:browser` pasa su comprobación de salud (llega a esa API a través del proxy de Vite) y ejecuta contra ella: 20 registros y 429 (el límite por defecto), 218 fallos y 20 usuarios basura en la BD de desarrollo. Esa pasada se **descartó**; se mató el árbol completo, se vació la BD de desarrollo (con autorización) y la pasada se repitió: 252 + 4 omitidas. | Documentado en `CLAUDE.md` y aquí; sin cambio de código                                                                                                 |
| P17-04 | BAJA     | `MaxListenersExceededWarning` (11 listeners en `Server`) al correr las pruebas de API con Supertest. Preexistente: aparece sin los archivos de la Fase 17 (738 pruebas). Es ruido de las pruebas, no del servidor.                                                                                                                                                                                                                                                                                                                                        | Sin corregir (sin efecto funcional)                                                                                                                     |
| P17-05 | BAJA     | Un fallo intermitente de una prueba ya existente (`activities.spec.ts`, «activity flow», 360 px) en 1 de 6 pasadas: `401 /api/activities` al final. La traza lo explica: dos `GET /api/activities` seguían en vuelo (272–295 ms bajo la carga de 4 navegadores) cuando la prueba pulsó «Cerrar sesión»; el servidor los atendió con la sesión ya destruida. No es un defecto del producto (el estudiante llega al login y la respuesta se descarta), sino una carrera del test que no esperaba a que la pantalla terminara de cargar.                     | **Corregido** en el test (`waitForLoadState('networkidle')` antes de cerrar sesión; 12/12 en repetición bajo carga) y la tanda de 5 pasadas se reinició |

## Recorrido manual del producto

En el navegador integrado, contra `npm run dev` y la BD de desarrollo: registro, onboarding, 2 asignaturas, una actividad por el diálogo, Dashboard. Todo coincidió con lo esperado (la actividad aparece como «Próxima», el Dashboard la recomienda con su motivo, resumen 1/0/0/0, carga de la semana, progreso 0 %). Limitación honesta: la ventana de la aplicación estaba oculta y las capturas de pantalla agotaron el tiempo, así que el recorrido se hizo leyendo el árbol de accesibilidad y el texto, no mirando píxeles. La comprobación visual a 360 px y 1366 px con datos poblados la cubren las pasadas de Playwright (medición de desbordamiento horizontal, controles ≥ 44 px, axe) y las capturas de revisión de la Fase 15; **no** se repitió una inspección visual humana en esta fase. Los datos de la visita (usuario de prueba) se borraron.

## Reproducibilidad desde cero

Se clonó la rama a otra carpeta y se siguió el README **al pie de la letra** tras `docker compose down -v`: `npm ci` → `cp .env.example .env` → `npm run db:up` → `npm run db:deploy` → lint, format, typecheck, `npm test`, build → `npm run test:security` → `npm run test:browser` → `npm run test:security:browser`. Resultado: todo verde (766 + 754 + 37; Playwright 252 pasan + 4 omitidas; seguridad 9/9). La BD de desarrollo quedó con 0 filas.

Requisito que el README ya dice y que este hallazgo refuerza: **no debe haber nada escuchando en :3000/:5173** al lanzar `test:browser` (ni `npm run dev`, ni un vigilante huérfano).

## Pasadas consecutivas

Tras el último cambio de código (la espera de `activities.spec.ts`, ver P17-05), **cinco pasadas completas consecutivas, todas verdes**, con el stack `dev:e2e` propio y 4 trabajadores:

| Pasada | Pasaron | Fallaron | Omitidas | Duración |
| -----: | ------: | -------: | -------: | -------: |
|      1 |     252 |        0 |        4 |  6,2 min |
|      2 |     252 |        0 |        4 |  6,3 min |
|      3 |     252 |        0 |        4 |  6,5 min |
|      4 |     252 |        0 |        4 |  6,5 min |
|      5 |     252 |        0 |        4 |  6,5 min |

Sin `ERR_CONNECTION_REFUSED` en ninguna (se ejecutaron con `DEBUG=pw:webserver` y los registros se conservaron). Las 4 omitidas son a propósito (teclado solo en escritorio, tamaño táctil solo en móvil). Al terminar: BD de desarrollo con 0 filas y nada escuchando en :3000/:5173/:4300.

Intentos previos, para que el historial sea completo: (a) una pasada en el clon limpio contra una API huérfana: **descartada** (P17-03); (b) la primera pasada de una tanda anterior en el árbol de trabajo: 251 pasan + 1 fallo (P17-05), tras lo cual se corrigió el test y la tanda se **reinició desde cero** (la de arriba).

## Pendiente y límites honestos

- **Dispositivos reales (iOS/Android):** no se probaron. Instalación de la PWA, comportamiento del teclado virtual y de la cámara/archivos en móvil real siguen pendientes; lo medido es emulación a 360/768/1366 px en Edge.
- **Seguridad (límites ya documentados en [security.md](security.md)):** 4 vulnerabilidades altas de `npm audit` en la cadena del CLI de Prisma (no alcanzables, no se retrocedió a Prisma 6); no hay una versión estable posterior a `7.10.0` (el tag `latest` apunta a `8.0.0-rc.20`, no se actualizó); límites de frecuencia en memoria y por proceso; el registro revela si un correo existe; sin verificación de correo, recuperación de contraseña ni MFA; sesión fija de 7 días; HTTPS y proxy inverso reales sin validar (solo la topología local de producción).
- **Rendimiento:** humo con 500 actividades y una cuenta; no hay prueba con muchos usuarios simultáneos ni con una base grande.
- **Datos de demostración (Fase 18):** hoy un revisor debe crear su propia cuenta y datos; el escenario maestro de `e2e/system-validation.spec.ts` sirve de guion para un seed (asignaturas, una vencida, una inmediata, un parcial, una clase semanal, una importada).

## Cómo reproducir la validación

```bash
npm run db:up
npm run lint && npm run format:check && npm run typecheck
npm test
npm run build
npm run test:security
PW_CHANNEL=msedge npm run test:browser            # con :3000 y :5173 libres
PW_CHANNEL=msedge npm run test:security:browser   # puerto 4300
# solo la Fase 17:
npm test -w @planner/api -- src/systemValidation
PW_CHANNEL=msedge npx playwright test e2e/system-validation.spec.ts
```
