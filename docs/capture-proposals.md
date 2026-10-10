# Motor de propuestas de captura (F1-2b)

Un solo texto produce **1..N propuestas**, ya resueltas, para Captura rápida y para la Bandeja académica. Principio de producto: **el estudiante escribe una vez, la aplicación interpreta todo lo posible y solo pide intervención donde de verdad falta información.**

**Estado:** implementado en `packages/core` (`captureProposals.ts`, `captureTemporal.ts`) y expuesto solo como interpretación (`POST /api/capture/parse`): **no persiste nada, no crea asignaturas ni actividades** y **no cambia ninguna pantalla** todavía. Las pantallas actuales de Captura rápida y Bandeja siguen usando sus rutas anteriores (`/api/quick-capture/parse`, `/api/academic-inbox/parse`); la nueva interfaz de revisión es **F1-2d**, la confirmación en lote es **F1-2c** y la persistencia de bloques de Agenda es **F1-2e** ([roadmap](roadmap-post-rc.md#f1-actividades-sin-asignatura)). El aviso «Captura rápida admite una actividad a la vez» solo lo emite el parser anterior, que F1-2d deja de usar; el motor nuevo nunca lo emite.

Determinístico, sin IA: normalización, tokens, diccionarios, expresiones regulares ancladas y reglas. Nada se envía a servicios externos ni se guarda. `now` es inyectable.

## Qué se lee

```
texto
  → segmentación en cláusulas (una por actividad)         [la de la Bandeja]
  → plan temporal de cada cláusula (días, horas, grupos)   [captureTemporal.ts]
  → palabras: asignatura, tipo, título                     [interpretWords, el de siempre]
  → 1 propuesta por actividad y por día (o una sugerencia de recurrencia)
  → duplicados dentro del texto, límite de 10, correcciones compartidas
```

- **QUICK** lee una frase corta (máx. 300 caracteres): si ninguna palabra de actividad la corta, **todo el texto es una actividad** («Ensayo lunes y martes»).
- **INBOX** lee un mensaje pegado (máx. 5000) con la lectura conservadora de siempre: una oración sin actividad no produce nada.
- En QUICK, las palabras que van **antes** de la primera palabra de actividad son una actividad aparte cuando traen su propio día y la cláusula siguiente también («ensayo lunes y reunión martes» → dos). Una oración compartida («El martes a las 10 tendremos parcial y quiz») sigue compartiendo su día y su hora.
- Se añaden anclas que antes no existían, **solo** para este motor: «reunión», «cita», «trámite» (tipo `OTHER`) y «llevar», «pagar», «renovar», «inscribir»… (tipo `TASK`), para que «parcial martes, exposición jueves y reunión de semillero viernes» sean tres actividades y no dos.

## Modelo temporal intermedio

No se va de los tokens a la actividad: primero un plan que conserva las relaciones (`TemporalPlan`):

| Pieza               | Qué guarda                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `days[]`            | los días **en el orden escrito** (semana, fecha explícita o relativa), con el texto original                                    |
| `days[i].time`      | su hora (valor, o alternativas si es ambigua) y de **qué expresión de hora** viene (`item`)                                     |
| `days[i].timeIssue` | `TIME_INVALID`, `TIME_UNASSIGNED` o `TIME_COUNT_MISMATCH` cuando no se puede repartir con certeza                               |
| `recurrence`        | `strong` («todos los», «cada», «semanal»), `plural` («los martes»), `untilPeriod` («este semestre») y las palabras que lo dicen |

Reglas de asignación de horas (en este orden):

1. **Por posición:** «los dos primeros», «los dos últimos», «el primero», «los otros dos», «los demás», «el resto». Cada hora toma la frase escrita justo antes. Si el conteo no cuadra, solo los días afectados quedan con `TIME_COUNT_MISMATCH`; los demás conservan su hora.
2. **«Respectivamente»:** las horas en el orden de los días, solo si son tantas como días; si no, **todos** los días preguntan.
3. **Tramos:** una hora pertenece a los días escritos desde la hora anterior («lunes y martes a las 7, jueves a las 4 y viernes a las 6»).
4. **Compartida:** una sola hora después de la lista vale para todos («lunes, miércoles y viernes a las 8»).

Rangos: «lunes a viernes» y «de lunes a viernes» son cinco días, en el orden de la semana. Una lista de días de la semana se lee como **una corrida coherente**: si un día cae antes que el anterior es el de la semana siguiente (escrito un lunes por la tarde, «lunes, martes… a las 7:30 am» es el lunes **y** el martes de la semana próxima, nunca el martes antes del lunes).

**Hora sin a. m./p. m.** («a las 6», «a las 8 y 10»): **ambigua**, nunca 06:00. Lleva sus dos lecturas, la usual primero (1–6 suelen ser de la tarde, 7–11 de la mañana): `['18:00','06:00']`. «a las 14», «6 pm», «7:30» no son ambiguas. Las propuestas que comparten una expresión de hora comparten `time.groupKey`: **una corrección** las resuelve todas.

## La propuesta (`CaptureProposal`)

Compartida por Captura rápida y Bandeja. Por campo hay valor, `certainty` (`EXACT`, `LIKELY`, `AMBIGUOUS`, `MISSING`) y `origin` (`PARSED`, `INHERITED` del grupo o de la oración, `DEFAULT`, `USER` —reservado para la interfaz—). Una propuesta tiene `clientId`, `groupId` (las que vienen de las mismas palabras lo comparten), `selected`, `status`, `rawSegment`, `title`, `type`, `subject`, `date`, `time`, `blockingIssues[]`, `warnings[]`, `possibleRecurrence` y `duplicateOf`.

**Estados**

| Estado         | Significa                                                                                                 | `selected` |
| -------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `READY`        | nada bloquea; no hay que tocarla                                                                          | sí         |
| `NEEDS_REVIEW` | falta o es ambiguo algo real: la asignatura, una hora sin a. m./p. m., un día sin hora asignada, la fecha | no         |
| `INVALID`      | lo escrito no sirve tal cual: fecha imposible, ningún título                                              | no         |

**Bloqueos frente a avisos.** `blockingIssues` impiden crear tal cual (`TITLE_MISSING`, `SUBJECT_MISSING`, `SUBJECT_AMBIGUOUS`, `SUBJECT_UNKNOWN`, `DATE_MISSING`, `DATE_INVALID`, `TIME_AMBIGUOUS`, `TIME_INVALID`, `TIME_UNASSIGNED`, `TIME_COUNT_MISMATCH`). `warnings` solo informan y **nunca bloquean** (`TYPE_DEFAULTED`, `TITLE_FROM_SUBJECT`, `PAST_DATE`, `PAST_TIME_TODAY`, `MOVED_TO_NEXT_WEEK`, `WEEKDAY_MISMATCH`, `DATE_OUTSIDE_PERIOD`, `SUBJECT_INHERITED`, `POSSIBLE_DUPLICATE`…). La hora es opcional y el tipo usa el valor por omisión con aviso: ninguno de los dos bloquea.

**Asignatura** (`subject`): `EXISTING` (una del estudiante, `EXACT` o `LIKELY`), `NONE` (**solo** cuando el estudiante no tiene ninguna: no hay alternativa y no se le pide una decisión inútil) o `UNRESOLVED` con `reason`: `MISSING` (no se mencionó), `AMBIGUOUS` (varias encajan: `candidates`) o `UNKNOWN_NAME` («parcial de ciberseguridad» y Ciberseguridad no existe: `suggestedName`, solo tras un tipo reconocido y un «de», hasta cuatro palabras, sin dígitos ni sustantivos genéricos como «unidad»; «parcial unidad 3» o «parcial final» no son asignaturas). El motor **ofrece**, nunca aplica ni crea: elegir, crear u omitir es decisión del estudiante (F1-2d) y la creación, de F1-2c.

**Título.** Lo que dicen las palabras; si solo queda el nombre de la asignatura, ese nombre con certeza `LIKELY` (aviso `TITLE_FROM_SUBJECT`); cuando se ofrece un nombre de asignatura nueva, la etiqueta del tipo («Parcial»). Sin nada: `INVALID`.

## Correcciones compartidas

`result.corrections[]` lista cada pregunta que **dos o más** propuestas comparten: la misma asignatura faltante, ambigua o desconocida (entre actividades distintas también) y los días que comparten una hora ambigua. Una decisión se propaga a todas mientras ninguna se haya personalizado (el estado `USER` lo lleva la interfaz). Una pregunta que solo tiene una propuesta no se lista: su tarjeta la hace.

## Recurrencia

No se crea ningún bloque aquí. **Evidencia fuerte** («todos los martes», «cada martes», «semanal(mente)») → una `RecurrenceSuggestion` (días, hora por día, asignatura, título, `until` y qué falta: `startTime`, `endTime`, `until`) **en lugar de** actividades puntuales. El fin de la repetición solo se rellena (con el último día del periodo) cuando el texto dice «este semestre» o «todo el periodo»; la hora de fin nunca se infiere. **Evidencia débil** («los martes»; o «asignatura exacta + varios días» sin tipo de actividad: «Ciberseguridad martes y jueves a las 6») → se generan las propuestas puntuales y se marca `possibleRecurrence`, para que la interfaz pregunte sin obligar. La persistencia es F1-2e (reutiliza la confirmación de A1).

## Límite y duplicados

- Máximo **10** propuestas por texto. Si hay más: `status: TOO_MANY_PROPOSALS`, **ninguna** propuesta y «Encontré más de 10 actividades. Divide el mensaje en dos partes.» Nunca se trunca en silencio.
- El mismo día dicho dos veces es uno; las actividades idénticas (tipo, título, fecha, hora o alternativas, asignatura) se colapsan y se cuentan en `stats.collapsed`.
- `POST /api/capture/parse` además marca (`duplicateOf`, `selected: false`, aviso) las propuestas que se parecen a una actividad del estudiante: mismo día, mismo tipo, título relacionado y la misma asignatura (una actividad **general** se compara con las generales). Solo avisa; una propuesta con la asignatura sin decidir no se compara.

## API

`POST /api/capture/parse` — `{ text, mode?: 'QUICK' | 'INBOX' }` (estricto: nada de `periodId`, usuario ni asignaturas; por omisión `QUICK`; la petición admite 20 000 caracteres y el límite de cada modo se devuelve como `status: TOO_LONG`). Responde `{ capture, period }`. Necesita sesión; ve solo las asignaturas del usuario en su periodo actual; `Cache-Control: no-store`; no guarda el texto. Entra en las matrices de seguridad (sesión, mass assignment, propiedad, no-store, robustez frente a entradas hostiles).

## Compatibilidad y límites

- Una frase simple (`parcial redes martes 10am`, `tarea bases viernes`…) da **una** propuesta con el mismo título, tipo, asignatura, fecha y hora que Captura rápida siempre dio (pruebas lado a lado con el parser anterior); un mensaje pegado da las mismas actividades que la Bandeja.
- Cambia a propósito: «a las 6» ya no es 06:00 sino una pregunta con alternativas.
- Solo español; fraseos muy libres pueden no reconocerse. Los ordinales fuera de una lista de días («el primer parcial») no se toman por posiciones.
- Aún sin interfaz: las tarjetas, las correcciones de grupo, el «Crear N actividades» y la confirmación son F1-2c y F1-2d.
