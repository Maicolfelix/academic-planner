# Actividades académicas (Fase 4)

## Modelo

```
User 1──* Activity *──1 AcademicPeriod
                  *──0..1 Subject   (la asignatura es opcional; si existe, es del mismo periodo)
```

`Activity`: `id` (UUID v4), `userId`, `periodId`, `subjectId?`, `title`, `description?`, `type`, `priority`, `status`, `dueAt` (`timestamptz`, UTC),
`hasTime`, `completedAt?`, `createdAt`, `updatedAt`.

| Enum       | Valores (UI en español)                                                                                                             | Por defecto                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `type`     | TASK Tarea · EXAM Parcial · QUIZ Quiz · PROJECT Proyecto · PRESENTATION Exposición · WORKSHOP Taller · READING Lectura · OTHER Otro | TASK                       |
| `priority` | LOW Baja · MEDIUM Media · HIGH Alta                                                                                                 | MEDIUM                     |
| `status`   | PENDING Pendiente · IN_PROGRESS En proceso · COMPLETED Finalizada                                                                   | PENDING (siempre al crear) |

Reglas en la BD: `Activity.periodId` y `Activity.subjectId` con `ON DELETE NO ACTION` (la clave de la asignatura es compuesta, ver abajo); `ON DELETE CASCADE` desde `User`;
`CHECK ((status = 'COMPLETED') = ("completedAt" IS NOT NULL))`.

## El periodo SÍ se guarda en `Activity`; la asignatura es opcional (F1)

Una actividad **siempre** pertenece a un periodo académico (`periodId NOT NULL`) y puede no tener asignatura (`subjectId` nulo): una **actividad general**, p. ej. un trámite, una cita con el tutor, pagar la matrícula. «Sin asignatura» **no** significa «sin periodo»: la actividad general cuenta en el Radar, el Dashboard, el Progreso (general), la Carga semanal, los recordatorios y el calendario como cualquier otra.
(Antes de F1 el periodo se deducía de `subject.periodId` y no se guardaba; esa frase ya no es verdad.)

**Invariantes**

1. `periodId` siempre existe.
2. Si `subjectId` no es nulo, `subject.periodId = activity.periodId`. **Lo garantiza la base de datos**: clave foránea compuesta `Activity(subjectId, periodId) → Subject(id, periodId)` (`MATCH SIMPLE`: no se comprueba mientras `subjectId` es nulo). Requiere un índice único `Subject(id, periodId)`, redundante como clave pero necesario como destino de la FK.
3. El periodo **no cambia nunca** después de crear la actividad: no hay endpoint, ni campo en el DTO, ni efecto oculto al editar. Cambiar de asignatura dentro del mismo periodo, o quitarla, no mueve el periodo.
4. El cliente **nunca envía** `periodId` (el esquema `strict` lo rechaza con 400) y la API **no lo expone** (nadie lo lee; exponerlo sugeriría que se puede editar). Lo deriva el servidor al crear: el periodo de la asignatura si hay una, o el **periodo actual** del usuario si no la hay (sin periodo actual: `400 NO_CURRENT_PERIOD`, el mismo código de la Agenda).

**Quién impide que `Activity.userId = A` apunte a un periodo de B** (revisión de F1):

| Capa          | Qué lo impide                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente       | No puede enviar `periodId` (400). Es la barrera principal: el valor nunca viene de fuera.                                                                                                            |
| Servicio      | El periodo sale de `subjects.findOwned(actor.id, …)` (asignatura propia) o de `periods.findCurrent(actor.id)` (periodo actual **del actor**). No hay ninguna búsqueda sin `userId`.                  |
| Repositorio   | Toda consulta lleva `userId`; `update` y `delete` usan `where: { id, userId }`; el filtro `periodId` de la lista es una condición más sobre actividades propias (el de otro usuario da lista vacía). |
| Base de datos | `periodId` existe y es obligatorio; con asignatura, la FK compuesta fuerza el mismo periodo. **No** hay una FK `(periodId, userId) → AcademicPeriod(id, userId)`.                                    |

Decisión: **no** se añadió esa FK de endurecimiento. Haría falta otro índice único en `AcademicPeriod` y repetir el patrón en `Subject` y `ScheduleBlock` (hoy tampoco la tienen: el dueño se valida en el servicio en todo el esquema); protegería un camino que ningún código tiene (nadie recibe un `periodId` del cliente) y rompería la coherencia entre tablas. Si algún día un endpoint acepta un `periodId` del cliente, se reconsidera (y se aplica a las tres tablas a la vez).

**Fronteras futuras (sin implementar)**: una actividad sin asignatura **no participa** en notas, ponderaciones ni programa de curso (no hay relación con una evaluación); **no** entra en la asistencia (que se relaciona con asignaturas y bloques de agenda); y sigue siendo **privada** del usuario: no se asocia a grupos de estudio ni a asignaturas compartidas salvo una función futura explícita.

## Fecha límite y zona horaria

Se guarda un **instante UTC** (`dueAt`) más `hasTime`. El cliente envía lo que el usuario ve: `dueDate` (`YYYY-MM-DD`) y `dueTime` opcional (`HH:mm`).
El backend convierte con la zona del usuario (`User.timezone`, `America/Bogota` por defecto) usando `dueFromLocal` de `@planner/core`:

| Entrada (Bogotá, UTC−5) | `dueAt` guardado                                             | `hasTime` |
| ----------------------- | ------------------------------------------------------------ | --------- |
| `2026-10-10` (sin hora) | `2026-10-11T04:59:59.999Z` (fin del día local, 23:59:59.999) | `false`   |
| `2026-10-10` + `14:00`  | `2026-10-10T19:00:00.000Z`                                   | `true`    |
| `2026-10-10` + `00:00`  | `2026-10-10T05:00:00.000Z`                                   | `true`    |

- **Toda** la lógica de zona horaria está en `packages/core/src/time.ts` (`dueFromLocal`, `localDayBounds`, `toLocalParts`, `formatDue`, `zonedTimeToUtc`).
  Los componentes React solo llaman a esas funciones: el formulario de edición obtiene fecha/hora con `toLocalParts`, las tarjetas muestran con `formatDue`.
- Usa `Intl` con una segunda pasada que corrige los cambios de horario de verano; es genérico (no solo Bogotá) y no requiere librerías.
  Hay tests con Bogotá, UTC, Kolkata (+5:30), Auckland (+13), Nueva York y Los Ángeles (incluidos los días de cambio de hora).
- Sin hora, la UI muestra solo el día (el 23:59 guardado es un detalle interno). Un test de navegador con el navegador en `Asia/Tokyo` comprueba que
  se sigue mostrando "10 oct, 2:00 p. m." y que el formulario devuelve `14:00`.
- `PATCH`: enviar solo `dueDate` conserva la hora guardada; solo `dueTime`, conserva el día; `dueTime: null` quita la hora.

## Vencimiento (derivado)

`isOverdue(activity, now)` en `@planner/core`: `dueAt < now && status !== COMPLETED`. Comparación estricta (en el instante exacto del límite aún no está vencida).
No se guarda (hay un test que comprueba que no existe esa columna) ni se envía en la API: se calcula con el reloj de cada cliente (la UI lo refresca cada minuto).
"Vencida" **no cambia** `status`: sigue Pendiente o En proceso. `GET /api/activities?overdue=true|false` aplica la misma regla en el servidor con un reloj inyectable.

## Estado y `completedAt`

Decidido por el backend (`resolveCompletedAt`, función pura), nunca por el cliente (que no puede enviar `completedAt`):

- pasar a COMPLETED guarda `completedAt = ahora`;
- volver a guardar una actividad ya COMPLETED conserva la fecha original;
- salir de COMPLETED pone `completedAt = null`.

`status` y `completedAt` se escriben en el mismo `UPDATE`, y el `CHECK` de la BD impide cualquier combinación inconsistente, incluso con peticiones simultáneas.

## Propiedad

Igual que en la Fase 3: el dueño sale de la sesión; los esquemas son `strict` (rechazan `userId`, `status` al crear, `completedAt`, `periodId`…);
cada consulta lleva `userId`; una actividad o asignatura ajena responde `404 NOT_FOUND` idéntico al de un recurso inexistente (también al crear o mover usando una asignatura ajena).

## Endpoints (todos requieren sesión)

| Método y ruta                | Notas                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/activities`        | filtros abajo; orden `dueAt` ascendente → `{ activities }`                       |
| `POST /api/activities`       | `{ subjectId?, title, dueDate, dueTime?, type?, priority?, description? }` → 201 |
| `GET /api/activities/:id`    | 404 si no es tuya                                                                |
| `PATCH /api/activities/:id`  | cualquier campo, incluido `status` y `subjectId` (ver abajo)                     |
| `DELETE /api/activities/:id` | 204                                                                              |

**Crear.** `subjectId` ausente o `null` crea una actividad general, anclada al periodo actual. Con `subjectId`, la asignatura debe ser del usuario (ajena e inexistente dan el mismo 404) y la actividad toma **su** periodo. Crear, el cálculo del periodo y los recordatorios AUTO ocurren en una sola transacción.

**Editar `subjectId`** (ausente y `null` son cosas distintas):

| Se envía                                               | Resultado                                                                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nada                                                   | no cambia ni la asignatura ni el periodo                                                                                                                 |
| `null`                                                 | se desvincula la asignatura; la actividad pasa a ser general y **conserva su periodo** y sus recordatorios                                               |
| un uuid de una asignatura propia del **mismo periodo** | se asigna (sirve para «sin asignatura → asignatura» y para «A → B»)                                                                                      |
| un uuid propio de **otro periodo**                     | `400 VALIDATION_ERROR` en `subjectId`: «La asignatura debe pertenecer al mismo periodo.» (el mismo mecanismo que la Agenda); la FK compuesta lo respalda |
| un uuid ajeno o inexistente                            | `404 NOT_FOUND` idéntico                                                                                                                                 |

**Filtros** (se combinan con AND): `subjectId` (un uuid, o `none` para las actividades generales; cualquier otro valor es 400, sin otros comodines), `periodId` (el periodo guardado en la actividad), `status`, `priority`, `type`, `overdue=true|false`,
`from` y `to` (días locales del usuario, `YYYY-MM-DD`, ambos inclusivos). Valores inválidos → `400 VALIDATION_ERROR`.
Límites: título 1–150, descripción ≤ 2000.

## Añadir al calendario

`GET /api/activities/:id/calendar.ics` (sesión; ajena o inexistente = el mismo 404) descarga la actividad como `.ics` para abrirla con la aplicación de calendario del estudiante; es una instantánea de solo lectura, también para actividades completadas. Detalle, representación del tiempo y límites: [calendar-export.md](calendar-export.md).

## Borrar una asignatura o un periodo

`DELETE /api/subjects/:id` con actividades → `409 SUBJECT_NOT_EMPTY` ("La asignatura tiene actividades o bloques de agenda asociados.", desde la Fase 6: también cuentan los bloques de la agenda).
Se decide en `subjectService.remove`; la FK (`NO ACTION`) lo refuerza ante una carrera. No hay cascadas silenciosas **ni desvinculación automática**: con F1 una actividad puede quedar sin asignatura, pero solo si el estudiante la desvincula (`PATCH { subjectId: null }`); entonces la asignatura sí se puede borrar y la actividad sigue en su periodo. Para "mover" una actividad a otra asignatura del mismo periodo: `PATCH { subjectId }`.

`DELETE /api/periods/:id` cuenta asignaturas, bloques **y actividades** del periodo: una actividad general (sin asignatura) también lo impide (`409 PERIOD_NOT_EMPTY`). La FK (`NO ACTION`) es solo la red de seguridad ante una carrera; el 409 sale de la comprobación explícita, nunca de un 500.

## UX (`/activities`)

- Formulario rápido: **Título, Asignatura, Fecha**; "Más opciones": Hora, Tipo, Prioridad, Descripción. El estado solo se edita en una actividad existente.
  Con una sola asignatura queda preseleccionada; con varias hay que elegir (así no se asigna por error).
- **Sin asignatura (F1-1).** La asignatura es opcional y omitirla es una **decisión explícita**, nunca el valor por defecto cuando hay asignaturas. Bajo el selector hay un botón de texto, **«Omitir asignatura»**: con un toque el selector sale del árbol (no queda un `select` oculto que pueda tomar el foco) y aparece el estado **«Sin asignatura»** con el botón **«Elegir asignatura»**, que devuelve el selector; el foco pasa al control que reemplaza al que se pulsó. Sin diálogo de confirmación. Mientras el formulario está abierto se **conserva la última asignatura elegida** (omitir y volver no la pierde); al guardar en el estado «Sin asignatura» se envía `subjectId: null` (nunca la que quedó en el selector) y nunca `periodId`. Una actividad general se abre ya como «Sin asignatura», sin error; una nueva sin ninguna asignatura en el periodo también (con la nota «Aún no tienes asignaturas.» y nada que elegir; no hay enlace a Asignaturas dentro del diálogo, porque navegar perdería lo escrito). Si el servidor rechaza una asignatura de otro periodo se muestra su mensaje; la interfaz nunca intenta cambiar el periodo.
- **Tarjeta sin asignatura:** una línea discreta «Sin asignatura» con el punto y el riel neutros (`NO_SUBJECT_COLOR`, el gris que ya se usaba para «sin color»), sin disfrazarla de una asignatura ni de «deshabilitada». Una asignatura que solo falta en la lista (aún no cargada) no dice «Sin asignatura»: solo `subjectId === null` lo dice. Se puede completar, cambiar de estado, editar, eliminar y añadir al calendario como cualquier otra.
- **Filtro:** el selector de Asignatura ofrece siempre «Sin asignatura» (la última opción, exista o no una actividad general; `subject=none` en la URL → `subjectId=none` en la API). Persiste al recargar, convive con los demás filtros y «Todas» o «Limpiar filtros» no dejan rastro.
- Home, recordatorios y Radar muestran «Sin asignatura» donde iría la asignatura; Progreso añade, solo cuando hay actividades generales, «Incluye N actividades sin asignatura, que no aparecen en ninguna asignatura» (las filas por asignatura pueden sumar menos que el total general, y no hay fila «Sin asignatura»).
- Tarjeta: título, asignatura, fecha/hora, y badges de **texto con símbolo** (▲ Alta, ● Media, ▽ Baja; ○ Pendiente, ◐ En proceso, ✓ Finalizada, ⚠ Vencida): nada depende solo del color.
  Las finalizadas llevan además el título tachado y se listan después de las abiertas. Un selector "Cambiar estado" permite avanzar sin abrir el formulario.
- Filtros: botones Todas / Pendientes / En proceso / Finalizadas / Vencidas y selectores de Asignatura, Prioridad y Tipo, **guardados en la URL**
  (`/activities?status=PENDING&subject=<id>&priority=HIGH`): se pueden compartir y sobreviven a recargar. Valores desconocidos en la URL se ignoran.
- Estados: cargando, error con "Reintentar", vacío ("Aún no tienes actividades.") y sin resultados con filtros ("Limpiar filtros"). Desde F1-1 **no tener asignaturas ya no bloquea** la pantalla ni «Agregar actividad» (antes: «Primero agrega una asignatura.»). El formulario espera a que carguen las asignaturas para decidir su primer modo.
- Sin actualizaciones optimistas: tras cada mutación se invalidan las consultas (`['activities']`), priorizando consistencia.
