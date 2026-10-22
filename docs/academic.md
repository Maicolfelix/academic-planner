# Periodos académicos y asignaturas (Fase 3)

## Modelo

```
User 1──* AcademicPeriod 1──* Subject *──1 User
```

| Entidad          | Campos                                                                                                                                                    | Reglas en la BD                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AcademicPeriod` | `id` (UUID), `userId`, `name`, `startDate` y `endDate` (`DATE`), `isCurrent`, `studyTrackId?`, `studyLevel?`, `studyLevelNote?`, `createdAt`, `updatedAt` | índices únicos parciales: **un solo `isCurrent = true` sin estudio por usuario y uno por estudio**; clave foránea compuesta `(studyTrackId, userId)` hacia `StudyTrack`; `CHECK (endDate > startDate)`; `CHECK` del nivel de estudio (ver abajo); `ON DELETE CASCADE` desde `User` |
| `Subject`        | `id` (UUID), `userId`, `periodId`, `name`, `nameKey`, `professor?`, `color`, `description?`, timestamps                                                   | único `(periodId, nameKey)`; `periodId` con `ON DELETE NO ACTION`; `ON DELETE CASCADE` desde `User`                                                                                                                                                                                |

Los IDs siguen siendo UUID v4 (misma estrategia que `User` y `Session`).

## Decisiones

**Fechas = `DATE`, no `timestamptz`.** Un periodo es "del 3 de agosto al 28 de noviembre": un día de calendario, sin hora ni zona.
Con `timestamptz` el valor dependería de la zona de quien lo escribe y de quien lo lee, y `03/08` podría mostrarse como `02/08`.
La API intercambia strings `YYYY-MM-DD`; el servidor convierte con UTC explícito y el frontend formatea cortando el string
(`formatDateOnly`), sin crear `Date`. Hay un test que crea y lee periodos con el proceso en `Pacific/Auckland` (+13), `America/Los_Angeles` (−8)
y `America/Bogota`, y comprueba el valor con `::text` en la BD.

**Periodo actual.** Máximo uno por usuario, garantizado por la BD. Marcar otro como actual desmarca el anterior en la misma transacción.
El primer periodo **de su ámbito** (sin estudio, o de un estudio) es actual automáticamente. `PATCH { isCurrent }` solo acepta `true`: para dejar de ser actual se marca otro
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

| Método y ruta                 | Notas                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/periods/home`       | el periodo **hogar** (lo decide el servidor; solo lectura) → `{ period }` con `period: null` si no hay                                            |
| `GET /api/periods`            | propios, el más reciente primero → `{ periods }`                                                                                                  |
| `POST /api/periods`           | `{ name, startDate, endDate, isCurrent?, studyTrackId?, studyLevel?, studyLevelNote? }` → 201 `{ period }`                                        |
| `GET /api/periods/:id`        | 404 si no es tuyo                                                                                                                                 |
| `PATCH /api/periods/:id`      | `{ name?, startDate?, endDate?, isCurrent?: true, studyTrackId?, studyLevel?, studyLevelNote? }`; una fecha suelta se valida contra la guardada   |
| `DELETE /api/periods/:id`     | 204; 409 `PERIOD_NOT_EMPTY`                                                                                                                       |
| `GET /api/subjects?periodId=` | propias, por nombre → `{ subjects }`; `?scope=current` en su lugar lista las de todos los periodos actuales y activos; **ambos a la vez → `400`** |
| `POST /api/subjects`          | `{ periodId, name, color?, professor?, description?, educationContext? }` → 201 `{ subject }`                                                     |
| `POST /api/subjects/batch`    | `{ names: string[1..30], educationContext? }` → 201 `{ subjects, createdSubjects, reusedSubjects }` (ver abajo)                                   |
| `GET /api/subjects/:id`       | 404 si no es tuya                                                                                                                                 |
| `PATCH /api/subjects/:id`     | `{ name?, color?, professor?, description?, educationContext? }`; `''` o `null` borran un campo opcional                                          |
| `DELETE /api/subjects/:id`    | 204                                                                                                                                               |

Límites: nombre de periodo y de asignatura 1–100, profesor ≤ 100, descripción ≤ 500, fechas reales entre 2000 y 2100.

### Nivel de estudio del periodo (P0-2)

`studyLevel` (entero 1–99) **o** `studyLevelNote` (texto recortado de 1 a 40 caracteres, sin NUL): son alternativas, nunca los dos (400 si llegan ambos con valor; la base lo refuerza con `CHECK`). Ambos son opcionales al crear (el onboarding actual no los envía) y vienen siempre en la respuesta (`null` si no hay). Al editar se mandan de uno en uno: un número fija el nivel y borra la nota; una nota fija la nota y borra el nivel; `null` (o una nota en blanco) borra solo ese campo; no mencionarlos los deja igual. El dominio **no consulta `UserProfile.primaryUse`** ni impone un máximo de 10: guardar 11 o 12 niveles es válido para cualquiera; qué rango ofrecer («semestre» 1–10, «grado» 1–11, «Otro») es decisión futura de la interfaz. Cuando exista un periodo siguiente, la interfaz **podrá sugerir** `studyLevel + 1`; el servidor nunca lo calcula ni lo copia solo.

### Contexto educativo de la asignatura (P0-3)

`educationContext` (`UNIVERSITY` | `SCHOOL` | `OTHER_ACADEMIC` | `null`) siempre viene en la respuesta. Al **crear**, si el cuerpo lo trae (incluso `null`) se usa tal cual; si no, el servidor deriva un **valor por omisión** de `UserProfile.primaryUse` (`UNIVERSITY_STUDENT` → `UNIVERSITY`, `SCHOOL_STUDENT` → `SCHOOL`, `OTHER_STUDENT`/`TEACHER`/`PERSONAL` → `OTHER_ACADEMIC`, sin `primaryUse` → `null`: nada se inventa). **Todo camino que crea una asignatura usa esa misma regla** (un único `subjectMaterializer`): el formulario (`POST /api/subjects`, también el inline), Captura rápida y Bandeja, la importación de horario y el lote. Cambiar `primaryUse` **nunca** cambia asignaturas existentes: solo cambia el valor por omisión de las nuevas. `PATCH` fija, cambia o borra (`null`) el contexto de una asignatura sin tocar su periodo. No equivale a calificable: `UNIVERSITY` no implica notas.

### Periodo y estudio (P0.5-2)

Un periodo pertenece a un estudio (`studyTrackId`, uuid) o a ninguno (`null`, válido para siempre: [D32](decisions.md#d32-un-periodo-puede-pertenecer-a-un-estudio-p05-2)). «Actual» es **por ámbito**: un periodo general y uno por estudio pueden ser actuales a la vez; dos en el mismo ámbito, nunca (índices únicos parciales). `POST` con `studyTrackId` crea el periodo de ese estudio (propio y activo; si no, `404` indistinguible o `409 STUDY_TRACK_ARCHIVED`); `PATCH` con `studyTrackId` lo **mueve** (uuid) o lo deja general (`null`): un periodo que no es actual se mueve libremente y uno actual solo si el destino no tiene actual (si no, `409 CURRENT_PERIOD_CONFLICT`: nadie se degrada en silencio). Archivar un estudio apaga sus periodos actuales; restaurarlo no los reactiva. Las funciones que todavía leen un solo periodo usan el **periodo hogar**: el actual sin estudio; si no, el del estudio principal activo; si no, ninguno.

### Todos los periodos actuales (P0.5-3)

Los resúmenes («qué requiere mi atención ahora») leen **todos** los periodos actuales y activos —el general y el de cada estudio activo— y no solo HOME ([D33](decisions.md#d33-resumen-global-de-los-periodos-actuales-p05-3)); `GET /api/periods/current` los lista con su estudio. Las escrituras sin destino siguen yendo a HOME. La lista de Actividades y el filtro por asignatura leen ese mismo alcance con `scope=current` (el servidor lo resuelve; el cliente no envía periodos).

### Notas: base y pantalla por materia (D36, B1 + B2 DONE)

Existe la **base** (datos, API y aritmética) y la **pantalla de notas de una asignatura** (B2 DONE, fusionada en el PR #45) ([ux-accessibility.md](ux-accessibility.md#notas-de-una-asignatura-b2)); no hay Captura inteligente, Radar ni Progreso de notas. El modelo ([D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones)) pone las notas en el periodo: una escala numérica por periodo (`GradingProfile`), cortes **de cada materia** (`GradingPeriod`, con peso sobre la nota final de esa materia: dos materias del mismo periodo pueden dividirla distinto) y evaluaciones por materia (`Evaluation`, con peso dentro del corte, nota canónica en la escala y, opcionalmente, lo que se reportó como «18 de 20»), con enlace opcional a una actividad. Un periodo general (sin estudio) no tiene notas. Validado con 3 sistemas reales documentados (GO provisional; [grades-validation.md](grades-validation.md)); la validación UX con estudiantes sigue pendiente. El Progreso, el Radar y la Atención no cambian: el Progreso sigue siendo solo conteo de actividades, nunca una nota ni un promedio.

### Del onboarding al estudio (P0.5-5)

Al **terminar** el onboarding (`POST /api/onboarding/complete`, [D35](decisions.md#d35-studytrack-como-autoridad-de-la-formación-y-finalización-del-onboarding-p05-5)) quien estudia (universidad, colegio u otro estudio) queda con un **estudio principal** y el periodo que ya creó pasa a ser el suyo (adoptado en el sitio, sin copiar nada): universidad = el programa elegido o «Universidad», colegio = «Colegio», otro = el programa o curso escrito o «Otro estudio». Docente, uso personal y perfil omitido no reciben estudio. Nada se crea mientras se responde, y las cuentas anteriores **no** se migran: usan «Convertir en estudio». Con algún estudio, el programa del perfil ya no es autoridad (`PATCH /api/profile` responde `409 PROGRAM_MANAGED_BY_STUDY`): se administra desde Mis estudios.

### Mis estudios (P0.5-4)

La pantalla `/settings/studies` ([D34](decisions.md#d34-mis-estudios-y-adopción-explícita-p05-4)) lista los estudios (cada tarjeta: nombre, tipo en palabras —Universidad, Colegio, Otro estudio—, «Principal», periodo actual con su nivel y el número de materias de ese periodo), ofrece **Editar**, **Periodos**, **Hacer principal** y **Archivar** tras un único menú, una sección **Archivados** con **Restaurar**, y «Agregar estudio». Abrirla **solo lee**. Una cuenta anterior a los estudios ve «Tu planificación actual» (su periodo general actual) con «Convertir en estudio»: el formulario propone nombre y tipo desde el perfil y **nada se escribe hasta confirmar**; convertir adopta el **mismo** periodo (`POST /api/study-tracks/adopt-period`), sin copiar nada y sin tocar el perfil. «Agregar estudio» crea todo en una petición atómica (`POST /api/study-tracks/setup`). `/subjects?period=<id>` muestra y crea materias en ese periodo **sin necesitar HOME** (un periodo ajeno o inexistente: «No encontramos ese periodo.»); sin parámetro, HOME, y sin HOME, el onboarding como antes. «Agregar estudio» pregunta el nivel (opcional) para todo tipo: «Otro estudio» dice «nivel» y admite un número o unas palabras.

### Estudios (P0.5-1)

Un **estudio** (`StudyTrack`, [D31](decisions.md#d31-studytrack-una-formación-que-el-usuario-cursa-p05-1)) es una formación que el usuario cursa; un **periodo** puede pertenecer a uno (`studyTrackId`); la asignatura llega a él **por su periodo**, nunca directamente. Una asignatura **nueva** toma por omisión el `type` del estudio de su periodo (si no, el de `primaryUse`), y `Subject.educationContext` sigue siendo la foto que cada asignatura recibió al crearse: cambiar el `type` de un estudio no la modifica).

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

## Captura inteligente de notas (B3)

Una sola entrada puede producir: solo una actividad; solo una evaluación; actividad + evaluación (atómico); la nota de una evaluación pendiente; o la nota directa de un corte. **Nunca** una nota en `Activity`. Un intérprete determinista **aparte** (`interpretGrades`, `packages/core/src/captureGrades.ts`) lee primero el texto contra **todas** las asignaturas de los periodos actuales (varios estudios), con sus cortes y evaluaciones; enmascara las palabras de nota (`maskedText`) y el motor de actividades solo ve lo demás; `mergeGradeCapture` enlaza una evaluación nueva con la actividad de su misma frase (sin fecha no hay actividad, solo evaluación; la actividad debe ser del periodo hogar y de la misma asignatura). El resultado viaja en `grades.suggestions` de `POST /api/capture/parse`; `resolveGrade` es la única fuente de qué falta y de la petición de confirmación (la usan la web y las pruebas). Frases: «saqué / me fue / nota 4.3», «18 de 20», «18/20», «Corte 2» / «segundo corte» (términos por tipo de estudio: Corte / Periodo / Etapa), «vale / pesa 40 %», «del corte», «de la nota final».

Reglas: la asignatura se resuelve con el emparejador determinista; el mismo nombre en varios estudios es **pregunta** (opciones con la etiqueta del estudio), nunca se elige uno. Los cortes se resuelven **solo dentro de esa asignatura** (nombre normalizado exacto u ordinal; si no coinciden, revisión). Una nota para una evaluación existente busca **solo pendientes de esa asignatura** por nombre normalizado exacto y luego por título exacto de la actividad enlazada (sin aproximaciones): una → actualiza; varias → candidatas; ninguna → «¿A cuál evaluación corresponde?», nunca un duplicado silencioso. Un corte con nota directa se **actualiza** (nunca se duplica); un corte desglosado no admite nota directa («Corte 1 está desglosado en evaluaciones»), y una evaluación detallada sobre un corte con nota directa pide revisión (sin cambio de modo silencioso). «18 de 20» con mínimo 0 se convierte con la regla del núcleo y **se guardan los puntos**; con mínimo ≠ 0 se pide la nota en la escala (nunca se adivina). «Vale 40 %» sin base es `UNKNOWN` → pregunta «¿corte o nota final?»; «de la nota final» se convierte a porcentaje del corte solo si es **exacto**. Sin configuración de notas no se crea nada: «Esta materia todavía no tiene configuradas sus notas.» con enlace «Configurar notas», y lo interpretado se conserva en el borrador.

Confirmación: `POST /api/capture/confirm` acepta `evaluations` (hasta 20; acciones `SET_CUT_GRADE`, `UPDATE_CUT_GRADE`, `SCORE_EVALUATION`, `CREATE_EVALUATION`; `activityClientId` apunta a un ítem de la misma petición). Todo (actividades, bloques y notas) va en **la misma transacción** y bajo el mismo candado por usuario; las operaciones de notas reutilizan `GradingService` (`createEvaluationInTx` / `updateEvaluationInTx`: propiedad, corte de la misma asignatura, suma de pesos ≤ 100 % bajo el candado de estudios, escala, directa XOR desglose). Una actualización solo se aplica a lo que el estudiante vio (`expectScoreMilli`): si la nota cambió o la evaluación ya no existe/no es de esa asignatura → `409 EVALUATION_CONFLICT` con ítem `STALE_EVALUATION` y **nada** se guarda; un nombre repetido en el corte → `DUPLICATE_EVALUATION`. Ajeno e inexistente responden igual. El cliente nunca envía usuario ni periodo.

**Ajustes de B3 (PR #46).** Una misma frase puede traer porcentaje **y** nota («Parcial de Anatomía el viernes, vale 40 % del Corte 1 y saqué 4.2»): se leen por separado, la evaluación nueva nace ya calificada (`CREATE_EVALUATION` acepta `scoreMilli` y, con puntos, el par «ganado/máximo»; las mismas reglas de `GradingService`; si la nota es inválida se revierte también la actividad) y el motor de actividades solo ve «Parcial de Anatomía el viernes». Una frase de actividad + evaluación nunca se parte entre estudios: si la materia de la nota pertenece a otro estudio que el hogar, no se propone la actividad (solo la evaluación, con el aviso «no se añadirá a la agenda desde esta captura»), y si el estudiante elige en la tarjeta la materia de otro estudio, la actividad relacionada queda bloqueada. No hay captura con varios destinos.

Una actividad bloqueada por ese motivo sigue visible con su aviso («no se añadirá a la Agenda porque la materia elegida pertenece a otro estudio»), con la casilla deshabilitada; `toggle`, `summarize` y `buildConfirmRequest` la excluyen (defensa en profundidad). La tarjeta de nota ofrece «Cambiar a …» entre las materias candidatas: al volver a la del hogar, la actividad se puede marcar otra vez.

## Editar la distribución de los cortes (ajuste de PR #46)

Sale de la QA real: quien ajusta un corte espera que la nota final de la materia siga sumando 100 % sin hacer las cuentas. **No** hay validación con estudiantes. Reglas: los **cortes de una materia** deben sumar **exactamente 100 %** para guardar; las **evaluaciones dentro de un corte** pueden sumar **menos** de 100 % (el profesor puede no haber anunciado las demás) pero **nunca más**. «Editar distribución» (pantalla de notas de la materia, con al menos dos cortes) abre todos los cortes juntos; **un solo** corte puede ser «Completar automáticamente» y absorbe lo que dejan los demás (30/30/auto → 40; cambiar el primero a 40 → 30; a 20 → 50). No hay redistribución proporcional ni efectos ocultos: si el estudiante escribe en el corte automático, deja de serlo; con todos manuales que no suman 100 % se muestra «Falta distribuir X %» y no se guarda; con más de 100 % «Te pasaste por X %» y no se guarda. Servidor: `POST /api/subjects/:id/grading-periods/distribution` con todos los cortes de la materia (ids, `finalShareBp`), una transacción bajo el candado de estudios; ajeno o de otra materia = el mismo 404; suma ≠ 100 % o faltantes = 400. El `PATCH /api/grading-periods/:id` ya **no acepta `finalShareBp`** (400 «Edita los porcentajes desde la distribución de la materia.»: solo renombra) y la estructura se protege igual: agregar un corte solo es válido si el total queda en 100 % exacto (en la práctica, el único corte de 100 % de una materia vacía) y quitar uno de varios se rechaza (solo el último corte puede quitarse, volviendo la materia a «sin configurar»). **Limitación temporal:** cambiar la cantidad de cortes de una materia ya configurada aún no tiene vista conjunta; los pesos se editan en «Editar distribución» y la estructura se fija al configurar la materia. Invariante: toda materia configurada persiste con `SUM(finalShareBp) = 10000`. Lógica pura: `distributeWeights` (`@planner/core`).

**Materia escrita que no existe (QA real).** La lectura distingue «no se escribió materia» de «se escribió algo en el lugar de la materia que no coincide con ninguna actual»: solo la estructura «… Corte 2 de X», «… el parcial de X» (hasta cuatro palabras tras «de / del / en»; una fecha, un artículo, un porcentaje o una nota la terminan). En ese caso `explicitUnknownSubjectText` conserva «X» tal como se escribió, `options` queda vacío y no se ofrece ninguna otra materia, no se crea nada y no hay coincidencia aproximada; la tarjeta dice «No encontré «X» entre tus materias actuales.» y mantiene la nota y el corte entendidos. Sin materia escrita se pregunta entre las materias actuales; con el mismo nombre en dos estudios, solo entre esas dos. Si nada está listo y algo necesita revisión, el botón dice «Resolver antes de guardar».

## Notas en el Radar y en el Progreso

**Radar: el contexto de nota es informativo.** El Radar sigue siendo **temporal**: su orden y sus categorías dependen solo del plazo, nunca de una nota, un porcentaje, un promedio ni del peso académico (hay una regresión: dos actividades con el mismo plazo, una que vale 5 % y otra 30 %, se ordenan igual). Si una actividad tiene evaluaciones enlazadas (0..N, no se asume 1:1), `GET /api/radar` añade a esa actividad `gradeContext` (las evaluaciones con su corte, su nota si ya la tiene, su peso dentro del corte, el peso de su corte y `finalWeightUnits`, y la escala para mostrar la nota); una actividad sin evaluación, o sin asignatura, no trae ningún campo ni placeholder y se comporta exactamente como antes. **Peso efectivo:** `finalWeightUnits = cut.finalShareBp × evaluation.periodShareBp` (100 % = 10 000 × 10 000), en enteros, sin redondeo interno (`effectiveFinalWeightUnits` en `@planner/core`): corte 30 % × parcial 40 % = 12 %; una nota directa del corte pesa exactamente lo que su corte. Con dos o más evaluaciones se muestra un resumen compacto («2 evaluaciones · 18 % de la nota final») sin elegir una. Dentro de un corte los pesos pueden sumar menos de 100 %: el Radar muestra el peso conocido y no asume nada del resto. Texto: «Parcial · Corte 1 · 12 % de la nota final», y con nota «Parcial · Corte 1 · 12 % · Nota 4.2».

**Progreso: actividad ≠ rendimiento académico.** Cada materia de `GET /api/progress` añade `grade` (datos, no texto): `accumulatedMilli`, `currentMilli` (promedio de lo registrado), la escala (`maxMilli`, `passMilli`, `decimals`), `evaluatedWeightUnits`, `remainingWeightUnits`, `cutsWithGrade`, `cutsTotal` y `complete`, con la misma aritmética de la pantalla de Notas (`summarizeSubjectGrade`, `accumulatedMilli`; un corte «calculado» es el que tiene nota directa o un desglose completo al 100 % y calificado: un Parcial al 40 % con 4.2 ya suma a la acumulada, pero su corte aún no está «calculado», por eso la pantalla dice «0 de 3 cortes calculados» y nunca «con nota»; la aritmética de `cutsWithGrade` no cambió, solo la palabra). `grade` es `null` si el periodo no tiene escala o la materia no tiene cortes: nunca se inventa un 0.0. Cada materia se lee con **sus** cortes y evaluaciones; dos materias con el mismo nombre en dos estudios no se mezclan (se distinguen por su periodo/estudio) y los estudios archivados siguen fuera. La pantalla de Progreso conserva primero el avance de actividades y añade aparte la sección «Notas» (solo materias con notas configuradas; «Acumulada 1.2 / 5.0 · 1 de 3 cortes calculados»; con todo calculado «3.9 / 5.0 · 3 de 3 cortes calculados»): no se mezclan en un único porcentaje. **Costo:** el Radar añade 1 consulta (las evaluaciones de las actividades listadas, con su corte y su escala) y el Progreso 3 (escalas, cortes y evaluaciones de todos los periodos actuales); nunca una por materia. Sin juicios ni predicciones: no se afirma mejora, riesgo ni impacto sobre el rendimiento.

## Pixel Companion (P8)

Un personaje decorativo del Inicio dice una frase neutra sobre el momento académico (qué hay cerca). No usa las notas ni el porcentaje para juzgar, no guarda nada y no gamifica. Detalle: [pixel-companion.md](pixel-companion.md). **EN REVISIÓN: sin QA real.**

## Compartir hacia la Captura rápida (A5)

Lo que otra aplicación comparte (texto, título, enlace `http(s)`) se precarga en la Captura rápida; no crea nada y no sobrescribe un borrador sin preguntar. Detalle y límites: [share-target.md](share-target.md). **DONE (PR #57 fusionado); QA funcional manual vía `/share` en desarrollo local; el menú «Compartir» real del SO queda para P12.**

## Importador de calendarios `.ics` (A2)

Un `.ics` se interpreta en propuestas (actividad, clase semanal o no soportado) que el estudiante revisa y confirma en una sola solicitud, con las asignaturas de todos los estudios actuales (la ambigüedad entre estudios se resuelve preguntando solo entre las candidatas; nunca se adivina ni se crea una asignatura). Subir el archivo no crea nada. Subconjunto exacto, límites y decisiones: [ics-import.md](ics-import.md). **DONE (PR #56 fusionado); QA real funcional en dispositivo en entorno local/LAN HTTP.**
