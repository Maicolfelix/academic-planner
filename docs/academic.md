# Periodos académicos y asignaturas (Fase 3)

## Modelo

```
User 1──* AcademicPeriod 1──* Subject *──1 User
```

| Entidad          | Campos                                                                                                  | Reglas en la BD                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AcademicPeriod` | `id` (UUID), `userId`, `name`, `startDate` y `endDate` (`DATE`), `isCurrent`, `createdAt`, `updatedAt`  | índice único parcial: **un solo `isCurrent = true` por usuario**; `CHECK (endDate > startDate)`; `ON DELETE CASCADE` desde `User` |
| `Subject`        | `id` (UUID), `userId`, `periodId`, `name`, `nameKey`, `professor?`, `color`, `description?`, timestamps | único `(periodId, nameKey)`; `periodId` con `ON DELETE NO ACTION`; `ON DELETE CASCADE` desde `User`                               |

Los IDs siguen siendo UUID v4 (misma estrategia que `User` y `Session`).

## Decisiones

**Fechas = `DATE`, no `timestamptz`.** Un periodo es "del 3 de agosto al 28 de noviembre": un día de calendario, sin hora ni zona.
Con `timestamptz` el valor dependería de la zona de quien lo escribe y de quien lo lee, y `03/08` podría mostrarse como `02/08`.
La API intercambia strings `YYYY-MM-DD`; el servidor convierte con UTC explícito y el frontend formatea cortando el string
(`formatDateOnly`), sin crear `Date`. Hay un test que crea y lee periodos con el proceso en `Pacific/Auckland` (+13), `America/Los_Angeles` (−8)
y `America/Bogota`, y comprueba el valor con `::text` en la BD.

**Periodo actual.** Máximo uno por usuario, garantizado por la BD. Marcar otro como actual desmarca el anterior en la misma transacción.
El primer periodo de un usuario es actual automáticamente. `PATCH { isCurrent }` solo acepta `true`: para dejar de ser actual se marca otro
(así nunca queda un usuario con periodos y ninguno actual por accidente). Dos peticiones simultáneas "hazlo actual": la BD deja pasar una y la otra recibe `409 CONFLICT`.

**Color = paleta fija de 10 hex** (`#3B82F6`, …), validada en el servidor y normalizada a mayúsculas. Un clic en la UI, nada de texto libre
(sin riesgo de inyección en estilos) y todos son tonos medios visibles sobre fondo claro. El color solo se usa como barra/muestra: el texto
siempre es oscuro, así que el contraste no depende del color elegido. En el formulario es un grupo de radios con nombre ("Azul", "Rojo", …).

**Duplicados (opción B).** Dentro de un mismo periodo no puede haber dos asignaturas con el mismo nombre _normalizado_:
minúsculas, sin tildes y con espacios colapsados (`normalizeNameKey` en `@planner/core`). `Redes`, `redes` y `REDES` colisionan; también `Matemáticas` y `matematicas`.
`name` se guarda como lo escribió el usuario (solo `trim`); `nameKey` es únicamente para comparar. La unicidad la impone la BD (también ante peticiones simultáneas).
El mismo nombre en otro periodo, o en otro usuario, es válido. Error: `409 SUBJECT_ALREADY_EXISTS` con `details.fields.name`.

**Eliminar un periodo.** Si tiene asignaturas **o bloques de agenda** (Fase 6, también los que no tienen asignatura) → `409 PERIOD_NOT_EMPTY` y no se borra nada (sin cascadas silenciosas). Lo refuerza la BD (FK `NO ACTION`).
Primero hay que eliminar las asignaturas. Borrar un _usuario_ sí elimina todo lo suyo.

**Eliminar una asignatura.** Si tiene actividades → `409 SUBJECT_NOT_EMPTY` y no se borra nada (regla en `subjectService.remove`, reforzada por la FK).
Hay que eliminar o mover sus actividades primero; ver [docs/activities.md](activities.md). Sin actividades se borra tras la confirmación.

## Propiedad (ownership)

- El dueño sale **siempre de la sesión** (`authOf(req).user.id`). Ningún body o query acepta `userId`: los esquemas son `strict`, así que enviarlo
  da `400 VALIDATION_ERROR` y no se escribe nada. `periodId` tampoco se puede cambiar en un `PATCH` de asignatura.
- Cada consulta de repositorio lleva `userId` en el `where` (`findFirst({ id, userId })`, `update({ where: { id, userId } })`, `deleteMany({ id, userId })`).
- Al crear una asignatura, el servicio comprueba que `periodId` pertenece al usuario autenticado.
- **Recursos ajenos → `404 NOT_FOUND`, nunca `403`.** La respuesta para "no existe" y "es de otro" es idéntica (mismo status, código y mensaje),
  incluido un `periodId` ajeno o inexistente al crear, y un id mal formado en la ruta. Así no se confirma la existencia de recursos de otros.
  Los tests lo comprueban comparando ambas respuestas y verificando en la BD que los datos de B no cambiaron (ni `updatedAt`).
- `GET /api/subjects?periodId=<ajeno>` devuelve `200 []` (el filtro por `userId` siempre aplica).

## Endpoints (todos requieren sesión)

| Método y ruta                 | Notas                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/periods`            | propios, el más reciente primero → `{ periods }`                                                   |
| `POST /api/periods`           | `{ name, startDate, endDate, isCurrent? }` → 201 `{ period }`                                      |
| `GET /api/periods/:id`        | 404 si no es tuyo                                                                                  |
| `PATCH /api/periods/:id`      | `{ name?, startDate?, endDate?, isCurrent?: true }`; una fecha suelta se valida contra la guardada |
| `DELETE /api/periods/:id`     | 204; 409 `PERIOD_NOT_EMPTY`                                                                        |
| `GET /api/subjects?periodId=` | propias, por nombre → `{ subjects }`                                                               |
| `POST /api/subjects`          | `{ periodId, name, color?, professor?, description? }` → 201 `{ subject }`                         |
| `GET /api/subjects/:id`       | 404 si no es tuya                                                                                  |
| `PATCH /api/subjects/:id`     | `{ name?, color?, professor?, description? }`; `''` o `null` borran un campo opcional              |
| `DELETE /api/subjects/:id`    | 204                                                                                                |

Límites: nombre de periodo y de asignatura 1–100, profesor ≤ 100, descripción ≤ 500, fechas reales entre 2000 y 2100.

## Arquitectura

`routes → controllers → services → repositories → Prisma`. Los controllers solo validan (Zod de `@planner/core`) y delegan; las reglas
(ownership, periodo actual, duplicados, periodo no vacío) viven en los services; los repositories solo hablan con Prisma y siempre reciben `userId`.
El frontend nunca habla con Prisma: usa TanStack Query (`useAcademic.ts`) y no decide propiedad.

## UX

- Un usuario sin periodo actual es llevado a `/onboarding` (nombre prellenado según la fecha, inicio y fin) y después a `/subjects`.
- `/subjects` muestra las asignaturas del periodo actual. Formulario rápido: nombre + color; profesor y descripción en "Más opciones".
- Estado vacío con una sola llamada a la acción. Aún **no** hay botón de "Importar horario" (Fase 14): se añadirá junto al estado vacío.
- Diálogos con `<dialog>` nativo (foco atrapado, Esc cierra, el foco vuelve al botón que lo abrió). Eliminar pide confirmación y enfoca "Cancelar" por defecto.
