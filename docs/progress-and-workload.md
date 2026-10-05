# Progreso y carga semanal (Fase 10)

Dos vistas **descriptivas** de lo que el estudiante registró: cuánto de sus actividades ha completado y cómo se reparten sus compromisos en una semana. Se derivan de datos que ya existen; no se pide nada nuevo y no se guarda nada (sin tablas `Progress`, `WeeklyLoad` ni `Statistics`).

## Qué significa y qué NO significa

**Significa:** "de las actividades que registré en este periodo, tantas están completadas" y "esta semana tengo tantos compromisos registrados y tantas horas en la agenda".

**No es** rendimiento, desempeño académico, productividad, estrés, sobrecarga ni riesgo: la aplicación no tiene datos para medirlos. Por eso la interfaz usa "Progreso de actividades", "Carga semanal", "Compromisos de la semana" y nunca "demasiado cargada" ni "deberías…". Tampoco recomienda nada (no dice "estudia el martes") y no interviene en el motor de atención de la Fase 9.

## Progreso

### General

La fórmula ya existente del Dashboard (`calculateProgress`, en `packages/core/src/dashboard.ts`):

```
porcentaje = completadas / total × 100   (entero)
```

Reglas heredadas: sin actividades es 0 %; nunca exagera (100 % solo si **todo** está completado; 199/200 muestra 99 %) y nunca se queda en 0 % si hay alguna completada (1/300 muestra 1 %). Solo cuenta las actividades **registradas** del **periodo actual**. Una actividad vencida y no completada **sigue siendo pendiente o en proceso** según su estado y, además, se cuenta en `overdue`: vencida no es un estado nuevo y no cambia el porcentaje.

El progreso general de `/api/progress` y el del Dashboard coinciden (un test lo comprueba).

### Por asignatura

Para cada asignatura del periodo actual: `total`, `completed`, `pending`, `inProgress`, `overdue` y `percentage`, con la misma fórmula.

- **No ponderado:** una actividad completada cuenta como una, sin importar prioridad, tipo, dificultad, nota o créditos.
- **Asignatura sin actividades:** la API devuelve `total = 0` y `percentage = 0`, pero la pantalla muestra **"Sin actividades registradas"** (sin barra), para no presentar "0 %" como mal progreso. Es distinto de "0 de 5 completadas · 0 %".
- **Orden:** alfabético (sin distinguir acentos ni mayúsculas; el `id` desempata). Es un orden estable y neutro: no coloca primero ni último a quien va mejor o peor.

## Carga semanal

### Definición

Cantidad y distribución de **compromisos académicos registrados** durante una semana (de lunes 00:00 a domingo 23:59:59.999 en la zona horaria del perfil, no en UTC ni en la del navegador). No es una escala psicológica. Hay dos fuentes:

1. **Activities** cuya fecha límite cae en la semana.
2. **Ocurrencias de la agenda** (`ScheduleBlock`) de la semana.

### Qué cuenta

| Cuenta                                                                                                                                                                   | No cuenta                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Una `Activity` con `dueAt` en la semana, en **cualquier estado** (una completada de esa semana sigue siendo un compromiso de esa semana; el desglose muestra su estado). | Una actividad **vencida de otra semana** solo por estar aún pendiente: la carga describe compromisos cuya fecha pertenece a la semana. |
| Cada **ocurrencia** de la agenda en la semana. Una serie semanal da **exactamente** la ocurrencia de esa semana (no la serie completa).                                  | Un bloque o una ocurrencia fuera de la semana.                                                                                         |
| Bloques solapados: **todos** cuentan; no se fusionan ni se restan.                                                                                                       | Actividades u horarios de **otro periodo** u otro usuario.                                                                             |

Se reutiliza la expansión de recurrencia de la agenda (`expandBlock` / `occurrencesInRange`): no se duplica ni se guarda en la BD.

### Métricas

`activityCount` (con `activitiesByStatus` y `openActivityCount` = pendientes + en proceso), `classCount`, `studyBlockCount`, `otherAcademicBlockCount`, `scheduleOccurrenceCount`, `scheduledMinutes` y:

```
totalCommitments = activityCount + scheduleOccurrenceCount
```

### Horas programadas (`scheduledMinutes`)

Suma la duración real de cada ocurrencia (`endAt − startAt`). Una `Activity` **no tiene duración conocida**: cuenta como **1 compromiso y 0 horas** (no se inventa "cada tarea = 2 horas"). Se muestra como "12 h 30 min programadas".

- **Medianoche:** una ocurrencia que termina después de medianoche cuenta, con todos sus minutos, en el día en que **empieza**.
- **DST:** la recurrencia conserva la hora de pared (una clase a las 08:00 sigue a las 08:00 tras un cambio de hora) y la duración es el tiempo transcurrido real. Un bloque 01:00–04:00 la noche en que los relojes adelantan una hora dura 120 min, no 180 (hay un test). Bogotá no tiene cambio de hora; el caso es excepcional y queda documentado.

### Distribución por día

Para cada día de lunes a domingo: `activityCount`, `scheduleCount`, `scheduledMinutes` y `totalCommitments`.

### Día con más compromisos (`busiestDay`)

El día con mayor `totalCommitments`. Desempates, en este orden: más `scheduledMinutes`; si persiste, **el día más temprano de la semana**. Si la semana no tiene compromisos no hay día más cargado (`null`). Siempre se presenta como "Día con más compromisos", nunca como "día más estresante", y se aclara que se basa en lo registrado.

### Sin niveles de carga

Deliberadamente **no** hay "baja/media/alta": sin una escala validada serían categorías arbitrarias. Se muestran números ("14 compromisos", "11 h 30 min programadas").

## API

- `GET /api/progress`: periodo actual. `{ generatedAt, period, general, subjects[] }`.
- `GET /api/workload?week=YYYY-MM-DD`: `week` es **cualquier fecha** de la semana deseada (la misma semántica que `/calendar?week=`); sin parámetro, la semana local actual del usuario. `{ generatedAt, period, week:{from,to}, totals, days[7], busiestDay }`. Una fecha inválida da 400.

Ambos exigen sesión, responden `Cache-Control: no-store`, toman usuario y periodo de la sesión (un `userId`/`periodId` en la query nunca se lee) y se limitan al **periodo actual**: una semana fuera del periodo devuelve ceros, no trae periodos antiguos. Si una semana cruza el inicio o el fin del periodo, solo cuenta lo que pertenece al periodo actual.

### Rendimiento

Constante, sin consulta por asignatura ni por actividad:

- Progreso: periodo actual + asignaturas + `GROUP BY` (asignatura, estado) + `GROUP BY` de vencidas.
- Carga: periodo actual + actividades de la semana (una consulta por rango) + bloques candidatos de la agenda. Las ocurrencias se calculan en memoria solo para esa semana.

Los tests miden 20 asignaturas / 500 actividades / varias series semanales y comprueban que el número de consultas no depende de los datos.

## Interfaz

- **Dashboard:** la tarjeta "Progreso de actividades" mantiene su contenido y añade "Ver progreso por asignatura"; la tarjeta compacta **"Esta semana"** muestra compromisos, horas programadas, día con más compromisos y el resumen por tipo, con "Ver semana" (→ `/calendar?week=…`) y "Ver detalle por día".
- **`/progress`** ("Progreso y carga semanal"; sin entrada en la barra de navegación): progreso general y por asignatura con barras CSS (`role="progressbar"` con `aria-valuenow/min/max`), y la semana con navegación anterior / actual / siguiente, siete barras diarias y la lista día por día. Las barras son decorativas: cada día tiene su nombre y su número en texto.
- En 360 px las siete barras caben sin scroll horizontal y el detalle diario es una lista.

## Actualización

Sin polling: nada de esto depende del reloj. Las mutaciones invalidan `['progress']` (actividades y asignaturas) y `['workload']` (actividades y bloques de agenda).

## Limitaciones

- Una actividad cuenta como un compromiso sin importar cuánto tarde: la carga subestima semanas con pocas entregas muy pesadas.
- Las horas son solo las de la agenda; el estudio fuera de ella no se ve.
- Todos los compromisos pesan igual y no se distingue la dificultad ni la prioridad.
- Los minutos de un bloque que cruza la medianoche se atribuyen al día en que empieza.
- Describe solo el periodo actual.
