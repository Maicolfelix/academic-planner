# Actividades académicas (Fase 4)

## Modelo

```
User 1──* Activity *──1 Subject *──1 AcademicPeriod
```

`Activity`: `id` (UUID v4), `userId`, `subjectId`, `title`, `description?`, `type`, `priority`, `status`, `dueAt` (`timestamptz`, UTC),
`hasTime`, `completedAt?`, `createdAt`, `updatedAt`.

| Enum       | Valores (UI en español)                                                                                                             | Por defecto                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `type`     | TASK Tarea · EXAM Parcial · QUIZ Quiz · PROJECT Proyecto · PRESENTATION Exposición · WORKSHOP Taller · READING Lectura · OTHER Otro | TASK                       |
| `priority` | LOW Baja · MEDIUM Media · HIGH Alta                                                                                                 | MEDIUM                     |
| `status`   | PENDING Pendiente · IN_PROGRESS En proceso · COMPLETED Finalizada                                                                   | PENDING (siempre al crear) |

Reglas en la BD: `Activity.subjectId` con `ON DELETE NO ACTION`; `ON DELETE CASCADE` desde `User`;
`CHECK ((status = 'COMPLETED') = ("completedAt" IS NOT NULL))`.

## `periodId` NO se guarda en `Activity`

El periodo se **deriva** de `subject.periodId`. Guardarlo también permitiría que ambos discrepen (una actividad "del periodo A" cuya asignatura es del B).
Hoy las asignaturas no cambian de periodo, y filtrar por periodo es un join con índice (`Subject(userId, periodId)`), suficiente para el volumen de un estudiante.
`GET /api/activities?periodId=` filtra a través de la asignatura. Se reconsiderará solo si una consulta futura (p. ej. la carga semanal) demuestra con medidas que hace falta.

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

| Método y ruta                | Notas                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/activities`        | filtros abajo; orden `dueAt` ascendente → `{ activities }`                      |
| `POST /api/activities`       | `{ subjectId, title, dueDate, dueTime?, type?, priority?, description? }` → 201 |
| `GET /api/activities/:id`    | 404 si no es tuya                                                               |
| `PATCH /api/activities/:id`  | cualquier campo, incluido `status` y `subjectId` (otra asignatura propia)       |
| `DELETE /api/activities/:id` | 204                                                                             |

**Filtros** (se combinan con AND): `subjectId`, `periodId` (derivado), `status`, `priority`, `type`, `overdue=true|false`,
`from` y `to` (días locales del usuario, `YYYY-MM-DD`, ambos inclusivos). Valores inválidos → `400 VALIDATION_ERROR`.
Límites: título 1–150, descripción ≤ 2000.

## Borrar una asignatura

`DELETE /api/subjects/:id` con actividades → `409 SUBJECT_NOT_EMPTY` ("Esta asignatura tiene actividades asociadas. Elimínalas o muévelas antes de borrar la asignatura.").
Se decide en `subjectService.remove`; la FK (`NO ACTION`) lo refuerza ante una carrera. No hay cascadas silenciosas. Para "mover" una actividad: `PATCH { subjectId }`.

## UX (`/activities`)

- Formulario rápido: **Título, Asignatura, Fecha**; "Más opciones": Hora, Tipo, Prioridad, Descripción. El estado solo se edita en una actividad existente.
  Con una sola asignatura queda preseleccionada; con varias hay que elegir (así no se asigna por error).
- Tarjeta: título, asignatura, fecha/hora, y badges de **texto con símbolo** (▲ Alta, ● Media, ▽ Baja; ○ Pendiente, ◐ En proceso, ✓ Finalizada, ⚠ Vencida): nada depende solo del color.
  Las finalizadas llevan además el título tachado y se listan después de las abiertas. Un selector "Cambiar estado" permite avanzar sin abrir el formulario.
- Filtros: botones Todas / Pendientes / En proceso / Finalizadas / Vencidas y selectores de Asignatura, Prioridad y Tipo, **guardados en la URL**
  (`/activities?status=PENDING&subject=<id>&priority=HIGH`): se pueden compartir y sobreviven a recargar. Valores desconocidos en la URL se ignoran.
- Estados: cargando, error con "Reintentar", vacío ("Aún no tienes actividades."), sin resultados con filtros ("Limpiar filtros") y sin asignaturas ("Primero agrega una asignatura.").
- Sin actualizaciones optimistas: tras cada mutación se invalidan las consultas (`['activities']`), priorizando consistencia.
