# Agenda, horarios y recurrencia (Fase 6)

La Agenda (`/calendar`, visible como **Agenda**) organiza clases, sesiones de estudio y otros bloques académicos.
Una clase que se repite todos los martes se crea **una sola vez**: no hay una fila por semana.

## Modelo: `ScheduleBlock`

| Campo                    | Notas                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `id` (UUID v4), `userId` | el dueño sale siempre de la sesión                                                                        |
| `periodId`               | **directo** (a diferencia de `Activity`): una sesión de estudio puede no tener asignatura pero sí periodo |
| `subjectId?`             | opcional; si existe debe ser del usuario **y del mismo periodo**                                          |
| `title`, `type`          | `CLASS` Clase · `STUDY` Estudio · `ACADEMIC_PERSONAL` Otro académico (solo bloques académicos)            |
| `startAt`, `endAt`       | instantes UTC de la **primera (o única)** ocurrencia                                                      |
| `recurrenceType`         | `NONE` o `WEEKLY`                                                                                         |
| `recurrenceUntil`        | `DATE` (día local, inclusivo); obligatorio si es `WEEKLY` y nulo si es `NONE`                             |

Reglas en la BD (a mano en la migración, porque Prisma no las expresa): `CHECK (endAt > startAt AND endAt - startAt <= interval '24 hours')` y
`CHECK ((recurrenceType = 'WEEKLY') = (recurrenceUntil IS NOT NULL))`. `periodId` y `subjectId` usan `ON DELETE NO ACTION`; borrar un usuario sí lo elimina todo.

### Por qué no se guarda el día de la semana

Se **deriva** de `startAt` en la zona del usuario. Así no puede contradecir la primera ocurrencia, y mover la fecha de una serie mueve su día.
La regla es: "cada semana, el mismo día y la misma hora local que la primera ocurrencia, hasta `until`".

## Recurrencia: regla propia simple, no RRULE

Solo existe `WEEKLY` + `until`, con forma de objeto (`{ "frequency": "WEEKLY", "until": "2026-11-28" }`) para poder añadir otras frecuencias sin tocar el almacenamiento.
Se descartó RRULE completo: el caso real es "semanal hasta fin de semestre", y RRULE añadiría dependencia, excepciones y reglas (`BYSETPOS`, `EXDATE`) que no se usarían.

- **Una fila por serie.** Al consultar una semana, la regla se expande **solo para ese rango** (`expandBlock`, función pura de `@planner/core`).
  Evita duplicación, borrados masivos e inconsistencias, y un semestre completo cuesta lo mismo que una semana.
- **Hora local, nunca `+7 × 24 h`.** Cada ocurrencia avanza 7 días **de calendario local** y se convierte desde su hora de pared a UTC. Así una clase a las 08:00 sigue
  a las 08:00 al cruzar un cambio de horario (el instante UTC se mueve una hora). Probado en Nueva York, Madrid, Auckland y Los Ángeles, incluidos los fines de semana del cambio.
- **Límites del periodo.** Una serie nunca produce ocurrencias fuera de su periodo (por si las fechas del periodo se editan después).
- **Sin excepciones.** Editar una serie edita **todas** las semanas; eliminarla elimina la regla completa. No hay "solo esta ocurrencia" ni "esta y las siguientes" (futuro).

### Un bloque no cruza la medianoche ni dura más de 24 h

`endTime > startTime` el mismo día: dura menos de 24 horas por construcción, y la BD lo garantiza con un `CHECK`. Duración cero o fin anterior al inicio se rechazan.

## Zona horaria

Todo respeta `User.timezone`. La API recibe lo que el usuario ve (`date`, `startTime`, `endTime`) y convierte con las utilidades de `@planner/core`
(`blockInstants`, `toLocalParts`, `zonedTimeToUtc`…): React nunca hace aritmética de zonas. Un navegador configurado en Tokio sigue mostrando "08:00" para una clase de las 08:00 de Bogotá
(hay un test de navegador). Las horas se muestran en formato 24 h (`08:00–10:00`).
_Limitación conocida:_ la zona es la del perfil; si una futura función permitiera cambiarla, las series seguirían a la nueva zona.

**Semana** = lunes a domingo (`weekRangeOf`, una sola definición en `core/calendar.ts`). La Agenda abre en la semana actual **del usuario**.

## Ocurrencias derivadas (`ScheduleOccurrence`)

No son una tabla: son un DTO calculado al leer. Campos: `blockId`, `periodId`, `occurrenceDate`, `startAt`, `endAt`, `title`, `type`, `subject`, `isRecurring`, `hasConflict`.

## Conflictos: advertencia, nunca restricción

Dos bloques chocan si `A.start < B.end && A.end > B.start`; los extremos exactos (08–10 y 10–12) **no** chocan.

- **Detección** (`findConflicts`): se expanden el candidato y los demás bloques del usuario en **todo el rango del candidato** (un día si es único; toda la serie si es semanal), así una
  nueva clase semanal se compara con otras clases semanales y con bloques sueltos de cualquier fecha del semestre, no solo con su fecha de creación. Al editar, el bloque se ignora a sí mismo.
- **`POST` y `PATCH` guardan igualmente** y devuelven `{ block, warnings }` con `warnings: [{ code: "SCHEDULE_CONFLICT", message, with: { blockId, title, type, startAt, endAt, occurrences } }]`
  (`with` describe la primera ocurrencia del bloque **existente** que choca y cuántas veces choca).
- **Aviso antes de guardar:** ambos aceptan `?dryRun=true`: validan todo (y devuelven 400/404 como siempre) y calculan los conflictos **sin guardar** (`block: null`).
  El formulario lo usa para mostrar "Ya tienes otra actividad programada en este horario." con **Guardar de todas formas** / **Revisar horario**.
- `GET /api/schedule` marca cada ocurrencia con `hasConflict` (solapa con otra de la misma respuesta).
- Los conflictos **no son una restricción de BD**: dos peticiones simultáneas pueden crear bloques solapados (a propósito); la agenda los marcará.
  Los conflictos solo se calculan contra bloques del propio usuario.

## Endpoints (todos requieren sesión)

| Método y ruta                 | Notas                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/schedule?from=&to=` | días locales inclusivos (máx. 42 días); sin parámetros = semana actual. → `{ range, occurrences }`                           |
| `POST /api/schedule`          | `{ type, subjectId?, periodId?, title, date, startTime, endTime, recurrence? }` → 201 `{ block, warnings }`                  |
| `GET /api/schedule/:id`       | el bloque completo (una serie es un bloque)                                                                                  |
| `PATCH /api/schedule/:id`     | cualquier campo salvo `periodId`; `recurrence: null` convierte la serie en bloque único; un objeto, un bloque único en serie |
| `DELETE /api/schedule/:id`    | 204; si es serie, se elimina entera                                                                                          |

Validaciones: título 1–100; `date` real y dentro del periodo; `until` ≥ `date` y ≤ fin del periodo; una `CLASS` exige asignatura; la asignatura (y el `periodId` si se envía) deben ser del usuario
(si no existen o son ajenos: el mismo `404`) y del mismo periodo (si es propia pero de otro periodo: `400`). Los cuerpos son `strict`: `userId` o campos internos dan `400`.
Sin `periodId` se usa el periodo actual (`NO_CURRENT_PERIOD` si no hay).

> **Reutilización:** la creación recibe solo una fecha, dos horas y, opcionalmente, `recurrence`, así que la futura **importación de horarios** (Fase 14) podrá crear bloques con esta misma API
> (calculando la primera fecha con `firstWeekdayOnOrAfter` de `core`). No hay OCR ni importación todavía.

## Relación con el resto

- **Subject:** no se puede borrar si tiene actividades **o** bloques (`409 SUBJECT_NOT_EMPTY`, "La asignatura tiene actividades o bloques de agenda asociados.", con los conteos en `details`).
- **AcademicPeriod:** no se puede borrar si tiene asignaturas **o** bloques (también los que no tienen asignatura) → `409 PERIOD_NOT_EMPTY`.
- **Dashboard:** `classesToday` = bloques `CLASS` del día local actual y del periodo actual, por hora, máximo 5 (se expande solo "hoy"; +1 consulta). Los `Activity` **no** se mezclan en la agenda todavía.
- **Rendimiento:** una consulta semanal usa 2 consultas (sesión + bloques candidatos) y solo expande el rango pedido. Medido: 15 ocurrencias de 72 bloques, ~20 ms.

## UX

- **Escritorio (≥ 768 px):** semana completa lunes→domingo, bloques posicionados por hora; los que se solapan se reparten el ancho y muestran una versión compacta (⚠ + título + hora).
- **Móvil (360 px):** una rejilla de 7 columnas es ilegible, así que la semana es una fila de botones de día y debajo la lista del día seleccionado, con la hora como dato principal.
  Se renderiza **un solo** diseño (no ambos ocultos con CSS).
- **Navegación:** Anterior · Hoy · Siguiente; la semana vive en la URL (`/calendar?week=YYYY-MM-DD`); un valor inválido cae a la semana actual.
- **Formulario:** Tipo, Asignatura, Título (una clase toma el nombre de su asignatura hasta que el estudiante escribe uno propio), "Repetir semanalmente" (marcado por defecto para clases),
  **Día** + Inicio + Fin + **Hasta** (por defecto el fin del periodo) o una **Fecha** si no se repite. La primera fecha de una serie es el primer día elegido desde el inicio del periodo.
  Al editar una serie se avisa: "Este cambio se aplicará a todas las semanas." Al eliminarla: "Esta clase se repite semanalmente. Se eliminarán todas las apariciones de la agenda."
