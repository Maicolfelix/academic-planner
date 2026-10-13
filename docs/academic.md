# Periodos académicos y asignaturas (Fase 3)

## Modelo

```
User 1──* AcademicPeriod 1──* Subject *──1 User
```

| Entidad          | Campos                                                                                                                                   | Reglas en la BD                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AcademicPeriod` | `id` (UUID), `userId`, `name`, `startDate` y `endDate` (`DATE`), `isCurrent`, `studyLevel?`, `studyLevelNote?`, `createdAt`, `updatedAt` | índice único parcial: **un solo `isCurrent = true` por usuario**; `CHECK (endDate > startDate)`; `CHECK` del nivel de estudio (ver abajo); `ON DELETE CASCADE` desde `User` |
| `Subject`        | `id` (UUID), `userId`, `periodId`, `name`, `nameKey`, `professor?`, `color`, `description?`, timestamps                                  | único `(periodId, nameKey)`; `periodId` con `ON DELETE NO ACTION`; `ON DELETE CASCADE` desde `User`                                                                         |

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

| Método y ruta                 | Notas                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/periods`            | propios, el más reciente primero → `{ periods }`                                                                                 |
| `POST /api/periods`           | `{ name, startDate, endDate, isCurrent?, studyLevel?, studyLevelNote? }` → 201 `{ period }`                                      |
| `GET /api/periods/:id`        | 404 si no es tuyo                                                                                                                |
| `PATCH /api/periods/:id`      | `{ name?, startDate?, endDate?, isCurrent?: true, studyLevel?, studyLevelNote? }`; una fecha suelta se valida contra la guardada |
| `DELETE /api/periods/:id`     | 204; 409 `PERIOD_NOT_EMPTY`                                                                                                      |
| `GET /api/subjects?periodId=` | propias, por nombre → `{ subjects }`                                                                                             |
| `POST /api/subjects`          | `{ periodId, name, color?, professor?, description?, educationContext? }` → 201 `{ subject }`                                    |
| `POST /api/subjects/batch`    | `{ names: string[1..30], educationContext? }` → 201 `{ subjects, createdSubjects, reusedSubjects }` (ver abajo)                  |
| `GET /api/subjects/:id`       | 404 si no es tuya                                                                                                                |
| `PATCH /api/subjects/:id`     | `{ name?, color?, professor?, description?, educationContext? }`; `''` o `null` borran un campo opcional                         |
| `DELETE /api/subjects/:id`    | 204                                                                                                                              |

Límites: nombre de periodo y de asignatura 1–100, profesor ≤ 100, descripción ≤ 500, fechas reales entre 2000 y 2100.

### Nivel de estudio del periodo (P0-2)

`studyLevel` (entero 1–99) **o** `studyLevelNote` (texto recortado de 1 a 40 caracteres, sin NUL): son alternativas, nunca los dos (400 si llegan ambos con valor; la base lo refuerza con `CHECK`). Ambos son opcionales al crear (el onboarding actual no los envía) y vienen siempre en la respuesta (`null` si no hay). Al editar se mandan de uno en uno: un número fija el nivel y borra la nota; una nota fija la nota y borra el nivel; `null` (o una nota en blanco) borra solo ese campo; no mencionarlos los deja igual. El dominio **no consulta `UserProfile.primaryUse`** ni impone un máximo de 10: guardar 11 o 12 niveles es válido para cualquiera; qué rango ofrecer («semestre» 1–10, «grado» 1–11, «Otro») es decisión futura de la interfaz. Cuando exista un periodo siguiente, la interfaz **podrá sugerir** `studyLevel + 1`; el servidor nunca lo calcula ni lo copia solo.

### Contexto educativo de la asignatura (P0-3)

`educationContext` (`UNIVERSITY` | `SCHOOL` | `OTHER_ACADEMIC` | `null`) siempre viene en la respuesta. Al **crear**, si el cuerpo lo trae (incluso `null`) se usa tal cual; si no, el servidor deriva un **valor por omisión** de `UserProfile.primaryUse` (`UNIVERSITY_STUDENT` → `UNIVERSITY`, `SCHOOL_STUDENT` → `SCHOOL`, `OTHER_STUDENT`/`TEACHER`/`PERSONAL` → `OTHER_ACADEMIC`, sin `primaryUse` → `null`: nada se inventa). **Todo camino que crea una asignatura usa esa misma regla** (un único `subjectMaterializer`): el formulario (`POST /api/subjects`, también el inline), Captura rápida y Bandeja, la importación de horario y el lote. Cambiar `primaryUse` **nunca** cambia asignaturas existentes: solo cambia el valor por omisión de las nuevas. `PATCH` fija, cambia o borra (`null`) el contexto de una asignatura sin tocar su periodo. No equivale a calificable: `UNIVERSITY` no implica notas.

### Creación rápida en lote (`POST /api/subjects/batch`, P0-3)

Pensado para el onboarding. Cuerpo estricto `{ names, educationContext? }` (1–30 nombres con la misma regla que una asignatura; nunca usuario, periodo, colores ni `primaryUse`). El periodo es **siempre el actual** del usuario (`400 NO_CURRENT_PERIOD` si no hay). Una sola transacción: los nombres que normalizan igual («Farmacología», «farmacologia», « FARMACOLOGÍA ») son **una** asignatura; las que ya existen se **reutilizan** tal cual (no hay 409, color y contexto intactos); las nuevas toman el contexto por omisión (o el único `educationContext` del lote) y el servidor les asigna colores **uno tras otro** (el primer color libre al primer nombre escrito; pasada la paleta, vuelve a empezar). La respuesta conserva el **orden de entrada** (primera aparición): `subjects` (todas), `createdSubjects` y `reusedSubjects` (`{ id, name }`). Reintentar o dos peticiones simultáneas con los mismos nombres no duplican nada (el índice único `(periodId, nameKey)` y `INSERT … ON CONFLICT DO NOTHING` mandan; un bloqueo por usuario evita esperas cruzadas).

## Arquitectura

`routes → controllers → services → repositories → Prisma`. Los controllers solo validan (Zod de `@planner/core`) y delegan; las reglas
(ownership, periodo actual, duplicados, periodo no vacío) viven en los services; los repositories solo hablan con Prisma y siempre reciben `userId`.
El frontend nunca habla con Prisma: usa TanStack Query (`useAcademic.ts`) y no decide propiedad.

## UX

- Una cuenta nueva va directo de «Crear cuenta» a `/onboarding` (D29, D30): una pregunta omitible («¿Para qué quieres usar Academic Planner?»), el periodo (nombre prellenado según la fecha; inicio y fin nunca se adivinan), los pasos opcionales de su uso (carrera, semestre o grado, materias rápidas) y una pantalla final que marca `COMPLETED` y lleva al Inicio o a «Importar mi horario». Un usuario sin periodo actual sigue siendo llevado a `/onboarding` por la guarda (omitir la pregunta no omite el periodo); quien ya tiene periodo nunca es redirigido allí y, si lo abre a mano, completa su perfil sin que se cree otro periodo.
- `/subjects` muestra las asignaturas del periodo actual. Formulario rápido: nombre + color; profesor y descripción en "Más opciones".
- Estado vacío con una sola llamada a la acción. La importación de horario no se ofrece aquí sino en la Agenda («Importar horario», [schedule-import.md](schedule-import.md)).
- Diálogos con `<dialog>` nativo (foco atrapado, Esc cierra, el foco vuelve al botón que lo abrió). Eliminar pide confirmación y enfoca "Cancelar" por defecto.
