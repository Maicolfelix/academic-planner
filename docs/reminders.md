# Recordatorios (Fase 7)

Recordatorios **internos** de la app, solo para `Activity`. Fuera de alcance: push, Web Push, correo, SMS, notificaciones del sistema, service worker, recordatorios de clases (`ScheduleBlock`).

## Modelo

`Reminder`: `id`, `userId`, `activityId`, `remindAt` (instante UTC), `kind` (`AUTO` | `MANUAL`), `status` (`PENDING` | `SHOWN` | `CANCELLED`), `offsetMinutes?` (solo AUTO, negativo), `createdAt`, `updatedAt`.
FK a `Activity` con `ON DELETE CASCADE` (borrar la actividad borra sus recordatorios). El **mensaje no se guarda**: se deriva de la actividad al mostrarlo (`reminderMessage` en `packages/core`), así que renombrar o reprogramar la actividad se refleja solo.

Garantías en la base de datos (SQL escrito a mano en la migración):

- `CHECK`: `kind = 'AUTO'` ⇔ `offsetMinutes IS NOT NULL`, y el offset es negativo.
- Índice único parcial `(activityId, offsetMinutes) WHERE kind = 'AUTO'`: nunca hay dos AUTO iguales para una actividad.

## Reglas automáticas

`remindAt = dueAt + offsetMinutes` (offset en minutos absolutos).

| Tipo       | Antes de la entrega    |
| ---------- | ---------------------- |
| Tarea      | 1 día, 3 horas         |
| Parcial    | 3 días, 1 día, 3 horas |
| Quiz       | 1 día, 3 horas         |
| Proyecto   | 7 días, 3 días, 1 día  |
| Exposición | 3 días, 1 día          |
| Taller     | 1 día, 3 horas         |
| Lectura    | 1 día                  |
| Otro       | 1 día                  |

- Solo se crean los que quedan **en el futuro**; nunca un `PENDING` con `remindAt <= ahora`. Una actividad ya vencida o finalizada no tiene ninguno.
- Sin hora, la entrega es el final del día local (23:59:59.999 en la zona del usuario); no se inventa otra hora.
- Los offsets son minutos absolutos: en un cambio de horario (DST) "1 día antes" son 24 h reales.

## AUTO vs MANUAL

- AUTO: lo genera el sistema; se recalcula (se borran y se recrean).
- MANUAL: lo crea el estudiante (fecha + hora, estrictamente en el futuro y antes de la entrega). **Nunca** se recalcula ni se sobrescribe.
- Editar un AUTO lo convierte en MANUAL (`offsetMinutes = null`, vuelve a `PENDING`).

## Cuándo se recalcula

Solo cambian los recordatorios si cambia `dueAt`, `type` o `status` cruzando `COMPLETED` (función pura `planReminderChange`). Cambiar título, descripción, prioridad, asignatura o pasar entre Pendiente/En proceso **no** toca nada.

- Finalizar: los `PENDING` pasan a `CANCELLED` (se conservan; los `SHOWN` se quedan).
- Reabrir: se regeneran los AUTO futuros y se reviven los MANUAL cancelados cuya hora aún no pasó.
- Cambiar fecha/tipo: se reemplazan los AUTO; los MANUAL quedan intactos.
- Una actividad finalizada no admite recordatorios nuevos (409 `ACTIVITY_COMPLETED`).

**Limitación documentada:** si el estudiante elimina un AUTO, se queda eliminado hasta que cambie la fecha, el tipo o el estado de la actividad (entonces se vuelve a aplicar la regla completa).

## Recordatorios pendientes de mostrar

- `GET /api/reminders/due`: `PENDING`, `remindAt <= ahora`, actividad no finalizada, **periodo actual** del usuario, más antiguos primero, máximo 20 (`DUE_REMINDERS_LIMIT`) con el `total` real. Leer nunca cambia nada.
- `POST /api/reminders/seen` `{ ids }`: marca `SHOWN` solo los que ya vencieron. Todo o nada: si algún id es ajeno o no existe, 404 y no cambia nada. Idempotente.
- UI: panel "Recordatorios" en el Dashboard ("Tienes N recordatorios", "Visto" / "Marcar todos como vistos") e insignia 🔔 N en "Inicio"; se refrescan cada minuto.

## Endpoints

`GET /api/reminders[?activityId&status]`, `GET /api/reminders/due`, `POST /api/reminders` (`activityId`, `remindDate`, `remindTime`), `PATCH /api/reminders/:id`, `DELETE /api/reminders/:id`, `POST /api/reminders/seen`. Todos con sesión y `no-store`.

## Propiedad y concurrencia

- Todo está filtrado por `userId`; un recordatorio o actividad ajeno o inexistente da el **mismo** 404.
- Crear/editar actividad y sus recordatorios ocurre en **una transacción**, con `SELECT … FOR UPDATE` sobre la fila de la actividad: ediciones simultáneas se serializan y no quedan AUTO duplicados ni con fechas viejas; si falla algo, se revierte todo. El índice único parcial es la red de seguridad.

## Zona horaria

`remindDate`/`remindTime` son hora local del perfil (America/Bogota por defecto); el navegador puede estar en otra zona. La conversión se hace en `packages/core/src/time.ts`.
