# Requisitos y trazabilidad

Cada requisito se traza a su **implementación**, la **pantalla o endpoint** donde se ve y la **evidencia de pruebas**. Los nombres de archivo son reales; para ver las pruebas concretas basta abrir el archivo (cada uno se llama como la funcionalidad que cubre). Cómo se ejecutan las pruebas: [testing.md](testing.md). Resultados de la validación integral: [system-validation.md](system-validation.md).

> **Nota sobre el origen de los requisitos.** El repositorio no contiene el texto original de RF01–RF09; los títulos de abajo son los que se usaron como referencia durante todo el desarrollo y la validación (Fase 17). Si el documento de requisitos original difiere en la redacción, prevalece el original y esta tabla se ajusta.

## Requisitos funcionales originales

| ID   | Requisito                        | Estado              |
| ---- | -------------------------------- | ------------------- |
| RF01 | Autenticación                    | Cumplido            |
| RF02 | Gestión de asignaturas           | Cumplido (ver nota) |
| RF03 | Gestión de actividades           | Cumplido            |
| RF04 | Filtros de actividades           | Cumplido            |
| RF05 | Agenda con aviso de solapes      | Cumplido            |
| RF06 | Recordatorios internos           | Cumplido            |
| RF07 | Seguimiento del progreso         | Cumplido            |
| RF08 | Aislamiento de datos por usuario | Cumplido            |
| RF09 | PWA instalable                   | Cumplido (ver nota) |

### RF01 — Autenticación

- **Implementación:** registro, inicio y cierre de sesión con sesiones en la base de datos; contraseñas con Argon2id; cookie `HttpOnly`; verificación de origen; límites de frecuencia. `apps/api/src/auth/`, `apps/api/src/routes/auth.ts`, `packages/core/src/auth.ts`. Diseño: [auth.md](auth.md), [security.md](security.md).
- **Pantallas / API:** `/register`, `/login`, cierre de sesión en la barra; `POST /api/auth/register|login|logout`, `GET /api/auth/me`.
- **Evidencia:** `apps/api/src/auth/auth.test.ts`, `password.test.ts`, `security/auth.security.test.ts`; `e2e/auth.spec.ts`, `e2e/security.spec.ts` (cookie, cierre de sesión, CSRF en navegador real); escenario MASTER de `e2e/system-validation.spec.ts` (registro, cierre e inicio de sesión, contexto de navegador nuevo).

### RF02 — Gestión de asignaturas

- **Implementación:** crear, listar, editar y eliminar asignaturas dentro del periodo; nombre único por periodo (sin distinguir mayúsculas ni acentos); color de una paleta fija; profesor y descripción opcionales; no se elimina una asignatura con actividades o bloques. `apps/api/src/services/subjectService.ts`. Diseño: [academic.md](academic.md).
- **Pantallas / API:** `/subjects`; `/api/subjects`.
- **Evidencia:** `apps/api/src/academic/subjects.test.ts`, `idor.test.ts`; `e2e/subjects.spec.ts`.
- **Nota:** el **periodo académico** se crea en el onboarding; la API permite editarlo y eliminarlo, pero la interfaz aún no ofrece esa gestión ([limitations.md](limitations.md)).

### RF03 — Gestión de actividades

- **Implementación:** crear, ver, editar, cambiar estado y eliminar actividades (tipo, prioridad, estado, fecha y hora opcional, descripción). `completedAt` lo controla el servidor. Diseño: [activities.md](activities.md).
- **Pantallas / API:** `/activities` (formulario, estado, edición, eliminación); `/api/activities`.
- **Evidencia:** `apps/api/src/activities/activities.test.ts`, `activityIdor.test.ts`; `e2e/activities.spec.ts`; escenario MASTER (creación por formulario, Captura rápida y Bandeja).

### RF04 — Filtros

- **Implementación:** filtros combinables por asignatura, estado, prioridad, tipo, vencidas, categoría del Radar y rango de fechas; viven en la URL y sobreviven a la recarga.
- **Pantallas / API:** `/activities` («Más filtros»); `GET /api/activities?…`.
- **Evidencia:** `apps/api/src/activities/activityFilters.test.ts`; `apps/web/src/pages/activities/filterParams.test.ts`; `e2e/activities.spec.ts` («filters live in the URL, combine, survive reload and can be cleared»).

### RF05 — Agenda y avisos de solape

- **Implementación:** clases, sesiones de estudio y otros bloques; repetición semanal «hasta una fecha» dentro del periodo (una fila por serie; ocurrencias al leer); aviso de conflicto cuando `A.inicio < B.fin` **y** `A.fin > B.inicio` (los bloques contiguos no chocan); el aviso no impide guardar. Diseño: [schedule.md](schedule.md).
- **Pantallas / API:** `/calendar` (cuadrícula desde 1024 px, lista por día en móvil); `/api/schedule` (`?dryRun=true`).
- **Evidencia:** `apps/api/src/schedule/schedule.test.ts`, `scheduleIdor.test.ts`; `packages/core/src/schedule.test.ts`; `e2e/calendar.spec.ts` («weekly class, conflict warning…»); bordes del periodo en `systemValidation/system.test.ts`.

### RF06 — Recordatorios internos

- **Implementación:** recordatorios dentro de la aplicación, generados por tipo de actividad (AUTO) más los que elige el estudiante (MANUAL); solo futuros; se cancelan al finalizar y reviven al reabrir; el panel del Dashboard muestra los vencidos. No hay correo, SMS ni notificaciones push. Diseño: [reminders.md](reminders.md).
- **Pantallas / API:** panel «Recordatorios» del Dashboard, insignia en «Inicio», sección en el formulario de actividad; `/api/reminders`.
- **Evidencia:** `apps/api/src/reminders/reminders.test.ts`, `reminderIdor.test.ts`; `packages/core/src/reminders.test.ts`; `e2e/reminders.spec.ts`; `systemValidation/system.test.ts` (solo futuros, cancelar/revivir, «visto» persiste a través de una instancia nueva del servidor).

### RF07 — Seguimiento del progreso

- **Implementación:** progreso general y por asignatura (`finalizadas / registradas`), Dashboard y pantalla de progreso; carga semanal descriptiva. Todo derivado, nada guardado. Diseño: [progress-and-workload.md](progress-and-workload.md), [dashboard.md](dashboard.md).
- **Pantallas / API:** `/dashboard`, `/progress`; `GET /api/progress`, `/api/workload`, `/api/dashboard`.
- **Evidencia:** `apps/api/src/insights/progress.test.ts`, `workload.test.ts`, `dashboard/*.test.ts`; `packages/core/src/insights.test.ts`, `dashboard.test.ts`; `e2e/progress.spec.ts`, `e2e/dashboard.spec.ts`; coherencia entre módulos en `systemValidation/system.test.ts` (17 % → 33 % → 17 % al completar y reabrir).

### RF08 — Aislamiento por usuario

- **Implementación:** todo repositorio filtra por el `userId` de la sesión; los esquemas de escritura rechazan `userId`; un recurso ajeno responde **el mismo 404** que uno inexistente y no cambia ningún dato. [security.md](security.md#5-autorización-propiedad-e-idor).
- **Evidencia:** matriz IDOR `apps/api/src/security/ownership.security.test.ts` (todo recurso con id), `academic/idor.test.ts`, `activities/activityIdor.test.ts`, `schedule/scheduleIdor.test.ts`, `reminders/reminderIdor.test.ts`; `e2e/system-validation.spec.ts` (dos usuarios: el segundo parte de cero y no alcanza los datos del primero).

### RF09 — PWA instalable

- **Implementación:** manifest, iconos, `display: standalone`, service worker (Workbox) que precachea solo el shell estático; `/api/*` siempre por red; aviso de actualización que nunca recarga solo. Diseño: [pwa.md](pwa.md).
- **Evidencia:** `apps/web/src/pwa/pwaState.test.ts`; `e2e/pwa.spec.ts`; shell sin conexión y cierre de sesión en el escenario MASTER; prueba manual de actualización de la Fase 13.
- **Nota:** la instalación en **dispositivos iOS/Android reales no se ha probado** (solo emulación y navegador de escritorio). No es una aplicación offline: los datos requieren conexión.

## Extensiones desarrolladas (no eran RF originales)

Se agregaron durante el desarrollo para reducir pasos operativos; no deben presentarse como parte del alcance original.

| Extensión              | Qué es                                                                         | Documento                                  | Evidencia principal                                                  |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| Radar académico        | Clasifica las actividades abiertas por tiempo restante (5 categorías)          | [radar.md](radar.md)                       | `radar.test.ts` (core y API), `e2e/radar.spec.ts`                    |
| ¿Qué hago ahora?       | Recomienda a qué prestar atención primero, con razones; determinístico, sin IA | [attention-engine.md](attention-engine.md) | `attention.test.ts` (core y API), `e2e/attention.spec.ts`            |
| Captura rápida         | Interpreta una frase como una actividad y la propone                           | [quick-capture.md](quick-capture.md)       | `quickCapture.test.ts` (core y API), `e2e/quick-capture.spec.ts`     |
| Bandeja académica      | Interpreta un mensaje largo como 0–10 propuestas                               | [academic-inbox.md](academic-inbox.md)     | `academicInbox.test.ts` (core y API), `e2e/academic-inbox.spec.ts`   |
| Importación de horario | Lee una imagen o PDF y propone clases (OCR local)                              | [schedule-import.md](schedule-import.md)   | `scheduleImport.test.ts` (core y API), `e2e/schedule-import.spec.ts` |
| Datos de demostración  | Comando que crea un estudiante ficticio para presentar el proyecto             | [demo.md](demo.md)                         | `demo/demoSeed.test.ts`, `e2e/demo-seed.spec.ts`                     |

## Requisitos no funcionales

| Requisito          | Cómo se atiende                                                                                                                                                                                      | Evidencia                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Seguridad          | Endurecimiento de la Fase 16: sesiones, CSRF, CSP, IDOR, límites, subidas, errores genéricos ([security.md](security.md)). No es una prueba de penetración                                           | `apps/api/src/security/` (155 pruebas), `e2e/security.spec.ts` (9), `npm run security:scan` |
| Diseño adaptable   | Legible a 360 px, sin desbordes, controles táctiles ≥ 44 px; cuadrícula de Agenda desde 1024 px                                                                                                      | Playwright a 360 y 1366 px; humo a 768 px en `system-validation.spec.ts`                    |
| Accesibilidad      | Orientada a WCAG 2.1 AA: etiquetas, foco, diálogos, teclado, enlace para saltar al contenido ([ux-accessibility.md](ux-accessibility.md)). Evaluada con axe y pruebas de teclado; **no certificada** | `e2e/ux-accessibility.spec.ts`, axe en pantallas con datos                                  |
| Reproducibilidad   | Instalación desde cero con el README; migraciones; BD de test que se crea sola; datos de demostración repetibles                                                                                     | Instalación limpia en las Fases 17 y 18 ([system-validation.md](system-validation.md))      |
| Zona horaria       | Instantes UTC + `User.timezone`; semana lunes–domingo; actividad sin hora vence al final del día local                                                                                               | `time.test.ts`, `calendar.test.ts`; navegador en `Asia/Tokyo` con perfil Bogotá             |
| Rendimiento (humo) | Pruebas de humo con 500 actividades en una máquina de desarrollo; **no es una prueba de carga ni un SLA** ([testing.md](testing.md#pruebas-de-humo-de-rendimiento))                                  | `systemValidation/performance.test.ts`                                                      |
| Privacidad         | Aislamiento por usuario; OCR local; los archivos subidos no se guardan; `Cache-Control: no-store`; sin procesamiento por terceros                                                                    | [security.md](security.md), [schedule-import.md](schedule-import.md)                        |
