# Reglas de dominio (resumen verificado)

Las reglas exactas que el sistema aplica hoy, en un solo lugar. Cada una se tomó del código de `packages/core` (y de los servicios de la API) y se contrasta con sus pruebas; el detalle y los ejemplos están en el documento de cada módulo. Si algo aquí contradice al código, manda el código.

## Tiempo

| Regla               | Definición                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autoridad horaria   | `User.timezone` (por defecto `America/Bogota`) decide «hoy», la semana, el saludo y el día de vencimiento. El servidor y la interfaz usan los mismos ayudantes de `packages/core/src/time.ts` |
| Instantes           | UTC; la API los intercambia en ISO 8601 (`…Z`); la interfaz los localiza. Los días de calendario son `YYYY-MM-DD`                                                                             |
| Actividad sin hora  | Vence al **final del día local** (23:59:59.999 en la zona del usuario); no se inventa «11:59 p. m.» en pantalla                                                                               |
| Semana              | **Lunes a domingo**, en la zona del usuario                                                                                                                                                   |
| Recurrencia semanal | Repite la **misma hora de pared** cada 7 días **de calendario** (no cada 168 horas) hasta `recurrenceUntil` (inclusive, dentro del periodo)                                                   |
| Reloj               | Inyectable (`clock`) en servicios y reglas; las pruebas fijan «ahora»                                                                                                                         |

## Radar académico

Solo para actividades **abiertas** (no `COMPLETED`). Con `restante = dueAt − ahora` (duración real, sin depender de la zona):

| Categoría       | Condición                  | Nota                                 |
| --------------- | -------------------------- | ------------------------------------ |
| `OVERDUE`       | `restante < 0`             | Vencida (se deriva; nunca se guarda) |
| `IMMEDIATE`     | `0 ≤ restante < 24 h`      | Exactamente 24 h ya es `UPCOMING`    |
| `UPCOMING`      | `24 h ≤ restante ≤ 72 h`   |                                      |
| `PLANNABLE`     | `72 h < restante ≤ 7 días` |                                      |
| `UNDER_CONTROL` | `restante > 7 días`        |                                      |

El endpoint lista como máximo 10 actividades por categoría (el conteo es siempre el real). El Radar no es prioridad. [radar.md](radar.md).

## ¿Qué hago ahora? (Atención)

Determinístico, explicable, sin IA. `puntaje = peso del nivel + peso de la prioridad + bono de «en proceso»`; el puntaje es **interno**, nunca se muestra ni se guarda.

| Nivel (Radar)                               | Peso |
| ------------------------------------------- | ---: |
| `OVERDUE` (vencida hace **≤ 7 días**)       |   60 |
| `IMMEDIATE`                                 |   50 |
| `UPCOMING`                                  |   40 |
| `PLANNABLE`                                 |   30 |
| `OVERDUE_STALE` (vencida hace **> 7 días**) |   20 |
| `UNDER_CONTROL`                             |   10 |

| Prioridad / estado | Peso |
| ------------------ | ---: |
| `HIGH`             |    9 |
| `MEDIUM`           |    5 |
| `LOW`              |    1 |
| En proceso         |   +1 |

Los niveles consecutivos distan 10, más que la máxima ayuda de prioridad + estado (9): la urgencia siempre domina. Desempates (orden total): mayor puntaje → plazo más cercano → «en proceso» primero → mayor prioridad → creada antes → `id`. Devuelve una recomendación y hasta 2 alternativas, cada una con razones de plantillas fijas («Vence en menos de 24 horas.», «Tiene prioridad alta.», «Ya comenzaste esta actividad.»…). Una vencida de **más de 7 días** sigue siendo candidata pero no domina. [attention-engine.md](attention-engine.md).

## Progreso

`porcentaje = redondeo(finalizadas / registradas × 100)`, sin ponderar, con dos salvaguardas para no exagerar: **100 solo si todo está finalizado** (199 de 200 muestra 99) y **0 solo si nada está finalizado** (1 de 300 muestra 1). Sin actividades: `total = 0` y la interfaz dice «Sin actividades registradas» (no un 0 % engañoso). Mide tareas registradas; **no** mide notas, conocimiento ni rendimiento. [progress-and-workload.md](progress-and-workload.md).

## Carga semanal

Semana lunes–domingo en la zona del perfil. Cuenta:

- **Actividades** por el día local de su `dueAt`, en cualquier estado (una vencida de otra semana no cuenta aquí). Cada una es **1 compromiso y 0 horas**.
- **Ocurrencias de la agenda** por el día en que **empiezan** (con todos sus minutos, aunque terminen después de medianoche). Las solapadas cuentan todas; no se fusionan.

Resultado: `activityCount`, `openActivityCount`, `scheduleOccurrenceCount`, `totalCommitments = activityCount + scheduleOccurrenceCount`, `scheduledMinutes` (suma real de `endAt − startAt`) y `busiestDay` (más compromisos → más minutos → día más temprano; `null` si no hay ninguno). **No mide estrés, dificultad ni riesgo.**

## Recordatorios

Ciclo de vida: `PENDING` → `SHOWN` (la app lo mostró) o `CANCELLED` (la actividad se finalizó). Tipos: `AUTO` (por reglas) y `MANUAL` (lo eligió el estudiante).

| Tipo de actividad | Recordatorios AUTO (antes de la entrega) |
| ----------------- | ---------------------------------------- |
| `TASK`            | 1 día, 3 horas                           |
| `EXAM`            | 3 días, 1 día, 3 horas                   |
| `QUIZ`            | 1 día, 3 horas                           |
| `PROJECT`         | 7 días, 3 días, 1 día                    |
| `PRESENTATION`    | 3 días, 1 día                            |
| `WORKSHOP`        | 1 día, 3 horas                           |
| `READING`         | 1 día                                    |
| `OTHER`           | 1 día                                    |

- Solo se crean los que quedan **en el futuro**; una actividad vencida o finalizada no tiene ninguno. Los desfases son minutos absolutos.
- Se recalculan **solo** si cambian `dueAt`, `type` o el estado cruza `COMPLETED`. Finalizar cancela los `PENDING`; reabrir regenera los AUTO futuros y revive los MANUAL cuya hora no pasó.
- Un `MANUAL` debe ser **futuro y anterior al plazo**, y nunca se recalcula. Editar un AUTO lo convierte en MANUAL.
- El mensaje se **deriva** de la actividad al mostrarlo. [reminders.md](reminders.md).

## Agenda

- **Solape (conflicto):** dos bloques chocan si `A.inicio < B.fin` **y** `A.fin > B.inicio` (los contiguos no chocan). Es un **aviso**, nunca impide guardar. Las series se comparan en todas sus ocurrencias.
- Una clase exige asignatura (del mismo periodo); el bloque debe caer dentro del periodo; la serie no puede terminar después de él; duración máxima de un bloque: 24 h. Editar o eliminar una serie afecta a **todas** sus semanas.

## Datos y propiedad

- **Un periodo actual por usuario** (índice único parcial); el primero que se crea queda como actual.
- **Borrado:** una asignatura con actividades o bloques no se elimina (409 `SUBJECT_NOT_EMPTY`); un periodo con asignaturas o bloques tampoco (409 `PERIOD_NOT_EMPTY`); eliminar una actividad elimina sus recordatorios; eliminar un usuario elimina todo lo suyo.
- **Finalización:** `completedAt` lo fija el servidor: pasar a `COMPLETED` estampa «ahora», seguir finalizada conserva la marca y reabrir la borra.
- **Propiedad:** un recurso ajeno responde **404, igual que uno inexistente**, y no cambia ningún dato; el dueño sale siempre de la sesión.
- **Asignatura única** por periodo según el nombre normalizado (sin acentos ni mayúsculas).

## Intérpretes de texto

Captura rápida (una actividad), Bandeja académica (hasta 10 propuestas) e Importación de horario (hasta 40 clases): determinísticos, **proponen** y solo guardan al confirmar; nunca crean una asignatura. Límites y fraseos: [quick-capture.md](quick-capture.md), [academic-inbox.md](academic-inbox.md), [schedule-import.md](schedule-import.md).
