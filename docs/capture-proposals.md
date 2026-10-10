# Captura inteligente: motor, confirmación y borradores (F1-2b → F1-2cdp)

Un solo texto produce **1..N propuestas**, ya resueltas, para Captura rápida y para la Bandeja académica, que ahora comparten el mismo motor, la misma revisión y la misma confirmación. Principio de producto: **el estudiante escribe una vez; la aplicación interpreta, estructura, conserva y ejecuta sin obligarlo a repetir trabajo.** Solo pide intervención donde de verdad falta información (mínima intervención). Corolario: **asignatura omitida en el lenguaje ≠ asignatura sin resolver.** Una actividad puede no tener asignatura, así que no nombrar ninguna es una decisión ya tomada (`NONE`), nunca una pregunta; solo un intento fallido (se nombró una que no existe, o varias encajan) pregunta.

**Estado:** F1-2b (motor, solo interpretación) está fusionado (PR #30). **F1-2c** (confirmación en lote), **F1-2d** (la interfaz de revisión compartida, `CaptureReview`), el endurecimiento del lenguaje desordenado (capa de discurso) y los **borradores persistentes** se entregan juntos en el PR de «Smart Capture robusto + drafts» y están **pendientes de QA real en iPhone**. F1-2e (persistir `ScheduleBlock` desde una sugerencia de recurrencia) **no está iniciada**.

Determinístico, sin IA: normalización, tokens, diccionarios, expresiones regulares ancladas y reglas. Nada se envía a servicios externos ni se guarda al interpretar. `now` es inyectable.

## Qué se lee

```
texto original (nunca se modifica)
  → oraciones                                              [splitSentences]
  → entidades: palabras de actividad, cantidades, artículos [captureDiscourse.ts]
  → relaciones: tramos (cada sintagma que nombra una actividad con lo que dice a su alrededor)
  → referencias: «el parcial es a las 7», «las dos tareas…», «ambos», «otra el viernes»
  → plan temporal de cada tramo (días, horas, grupos)      [captureTemporal.ts]
  → palabras: asignatura, tipo, título                     [interpretWords, el de siempre]
  → fusión de las referencias en su actividad → cantidades → propuestas
```

Cada capa es pequeña y tiene una responsabilidad; no hay un framework de lenguaje ni un modelo: unas reglas del español sobre tokens.

- **QUICK** lee un texto corto (máx. **1000** caracteres): si ninguna palabra de actividad lo corta, **todo el texto es una actividad** («Cumpleaños de Ana martes»).
- **INBOX** lee un mensaje pegado (máx. 5000) con la lectura conservadora de siempre: una oración sin actividad no produce nada.
- Anclas (solo en este motor): además de los tipos, «ensayo» (tarea), «reunión», «cita», «trámite» (`OTHER`) y «llevar», «pagar», «renovar», «inscribir»… (`TASK`); y los plurales («tareas», «parciales», «quices»…).
- En QUICK, las palabras **antes** de la primera palabra de actividad son una actividad aparte cuando traen su propio día y la cláusula siguiente también («ciberseguridad martes y reunión jueves» → dos). Una oración compartida («El martes a las 10 tendremos parcial y quiz») sigue compartiendo su día y su hora.

## Menciones y referencias (la capa de discurso)

Un mensaje suelto no dice cada actividad una vez, junto a su día y su hora: **menciona** una actividad y luego **vuelve a ella** para añadir un dato. `segmentDiscourse` corta el texto en tramos (uno por sintagma que nombra una actividad) y decide, para cada uno, si **introduce** una actividad nueva o **se refiere** a una ya introducida.

| Tramo                                                     | Qué es                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| «un parcial de redes…», «tarea…», «dos tareas…»           | introduce (indefinido, sin artículo o con cantidad)                                          |
| «el parcial de redes es a las 7»                          | **se refiere** al parcial de redes: añade su hora, no crea otra actividad                    |
| «las dos tareas… a las 8», «las dos son a las 8»          | se refiere al **grupo de 2** (o a las dos últimas menciones)                                 |
| «una tarea el jueves y **otra** el viernes»               | «otra» es una segunda actividad **del mismo tipo** (y de la misma asignatura, como contexto) |
| «uno para el jueves y otro para el viernes» (de un grupo) | enumeradores del grupo: no son actividades                                                   |

Reglas de decisión, en orden de escritura:

- Un sintagma **definido** («el», «la», «los», «las», «ese», «mi»…) cuyo **tipo coincide** con una mención anterior y cuya **asignatura no la contradice** es una referencia. Con otra asignatura («el parcial de bases») es una actividad nueva.
- Con **varios candidatos** razonables y nada en las palabras que elija (ni asignatura ni cantidad) la referencia es **ambigua**: no se aplica a nadie y cada candidato recibe la pregunta `REFERENCE_AMBIGUOUS` con el dato **ofrecido** («¿usar 7:00 a. m.?»), nunca aplicado.
- «las dos», «ambos», «los tres» solo son un pronombre si no van tras «a» («a las dos» es una hora) y no son posicionales («los dos primeros»).

### Cantidades

«dos tareas» son dos actividades. Con tantas fechas como cantidad, una por fecha («una el jueves y otra el viernes»); con **una** fecha, todas en ese día (y no se colapsan como duplicadas: el estudiante las pidió); con **menos** fechas que la cantidad, las fechas dichas y las que faltan se **preguntan** (`QUANTITY_DATE_MISMATCH`, no se inventa una fecha); con **más** fechas, mandan las fechas y hay un aviso.

### Detalles dichos después y en cualquier orden

Una referencia aplica lo que trae (día, hora, asignatura) a la actividad a la que se refiere, aunque venga en otra oración o antes del sustantivo («el jueves es el parcial a las 7 y el lunes el ensayo a las 5»). Lo que **coincide** no cambia nada; lo que **contradice** no se elige: se conservan las dos lecturas (`CONFLICTING_DATE`, `CONFLICTING_TIME`) y la propuesta pregunta. Un día o una hora repetidos («el martes a las 9 el martes», «jueves jueves», «redes redes») no suman nada: ni propuestas, ni título, ni aviso de duplicado.

### Degradación elegante

Nada se descarta entero porque una parte sea difícil: cuatro entendidas y una en duda son cuatro `READY` y una `NEEDS_REVIEW`. Lo que no se entiende queda visible (una pregunta, un campo vacío), no adivinado. Un mensaje con más de 10 propuestas devuelve `TOO_MANY_PROPOSALS`, nunca recortado en silencio.

## Modelo temporal intermedio

No se va de los tokens a la actividad: primero un plan que conserva las relaciones (`TemporalPlan`):

| Pieza               | Qué guarda                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `days[]`            | los días **en el orden escrito** (semana, fecha explícita o relativa), con el texto original                                    |
| `days[i].time`      | su hora (valor, o alternativas si es ambigua), de **qué expresión de hora** viene (`item`) y **cómo** llegó (`timeVia`)         |
| `days[i].timeIssue` | `TIME_INVALID`, `TIME_UNASSIGNED` o `TIME_COUNT_MISMATCH` cuando no se puede repartir con certeza                               |
| `recurrence`        | `strong` («todos los», «cada», «semanal»), `plural` («los martes»), `untilPeriod` («este semestre») y las palabras que lo dicen |

Reglas de asignación de horas (en este orden):

1. **Por posición:** «los dos primeros», «los dos últimos», «el primero», «los otros dos», «los demás», «el resto». Cada hora toma la frase escrita justo antes. Si el conteo no cuadra, solo los días afectados quedan con `TIME_COUNT_MISMATCH`; los demás conservan su hora.
2. **«Respectivamente»:** las horas en el orden de los días, solo si son tantas como días; si no, **todos** los días preguntan.
3. **Tramos:** una hora pertenece a los días escritos desde la hora anterior («lunes y martes a las 7, jueves a las 4 y viernes a las 6»).
4. **Compartida:** una sola hora después de la lista vale para todos («lunes, miércoles y viernes a las 8»).

Rangos: «lunes a viernes» y «de lunes a viernes» son cinco días, en el orden de la semana. Una lista de días de la semana se lee como **una corrida coherente**: si un día cae antes que el anterior es el de la semana siguiente. **«De la otra semana»**, «de la próxima semana», «de la semana que viene» fijan el día de la semana **siguiente** (de lunes a domingo), sea hoy el día que sea; «de la mañana» es la mañana, nunca «mañana».

**Hora sin a. m./p. m.** («a las 6», «a las 8 y 10», **«7:30»**; de 1:00 a 11:59 y 12:xx): **ambigua**, nunca se adivina. Lleva sus dos lecturas **en orden de reloj, a. m. primero**, sin presentar ninguna como «la usual»: `['06:00','18:00']`, `['07:30','19:30']`, y para las 12 `['00:00','12:00']`. Se resuelve sola, sin preguntar, con lo que las palabras dicen: «7:30 am/pm», «19:30», «a las 14» y «de la mañana / tarde / noche / madrugada» cuando no deja duda («7:30 de la noche» → 19:30; «5 de la tarde» → 17:00; «12 de la noche» → 00:00). Si la frase no la resuelve («12 de la mañana», «1 de la noche») la hora sigue siendo una pregunta. Las propuestas que comparten una expresión de hora comparten `time.groupKey`: **una corrección** las resuelve todas.

## La propuesta (`CaptureProposal`)

Por campo hay valor, `certainty` (`EXACT`, `LIKELY`, `AMBIGUOUS`, `MISSING`) y `origin` (procedencia): `PARSED` (las palabras de al lado), `INHERITED` (del grupo o de la oración), `REFERENCE` (una cláusula posterior se refirió a ella), `POSITIONAL` («los dos primeros»), `DEFAULT`, `USER` (lo fija la interfaz). La interfaz solo destaca lo dudoso; la procedencia dice cómo llegó cada valor. Una propuesta tiene `clientId`, `groupId` (las que vienen de las mismas palabras lo comparten), `selected`, `status`, `rawSegment`, `title`, `type`, `subject`, `date` (con `alternatives` cuando el texto da dos), `time`, `blockingIssues[]`, `warnings[]`, `possibleRecurrence` y `duplicateOf`.

**Estados**

| Estado         | Significa                                                                                                                                                                                   | `selected` |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `READY`        | nada bloquea; no hay que tocarla                                                                                                                                                            | sí         |
| `NEEDS_REVIEW` | falta o es ambiguo algo real: una asignatura nombrada que no se resuelve, una hora sin a. m./p. m., un día sin hora asignada, la fecha, una contradicción, una referencia que pudo ser otra | no         |
| `INVALID`      | lo escrito no sirve tal cual: fecha imposible, ningún título                                                                                                                                | no         |

**`READY` = se puede persistir sin inventar nada:** título y fecha, hora opcional, tipo por omisión, asignatura `NONE` válida; los avisos nunca la impiden.

**Bloqueos frente a avisos.** `blockingIssues` impiden crear tal cual (`TITLE_MISSING`, `SUBJECT_AMBIGUOUS`, `SUBJECT_UNKNOWN`, `DATE_MISSING`, `DATE_INVALID`, `TIME_AMBIGUOUS`, `TIME_INVALID`, `TIME_UNASSIGNED`, `TIME_COUNT_MISMATCH`, `CONFLICTING_DATE`, `CONFLICTING_TIME`, `REFERENCE_AMBIGUOUS`, `QUANTITY_DATE_MISMATCH`). `warnings` solo informan y **nunca bloquean** (`TYPE_DEFAULTED`, `TITLE_FROM_SUBJECT`, `PAST_DATE`, `PAST_TIME_TODAY`, `MOVED_TO_NEXT_WEEK`, `WEEKDAY_MISMATCH`, `DATE_OUTSIDE_PERIOD`, `SUBJECT_INHERITED`, `POSSIBLE_DUPLICATE`, `QUANTITY_DATE_MISMATCH`…). La hora es opcional y el tipo usa el valor por omisión con aviso: ninguno de los dos bloquea.

**Asignatura** (`subject`): `EXISTING` (una del estudiante, `EXACT` o `LIKELY`), `NONE` (actividad general, **nunca bloquea**; `reason`: `NOT_MENTIONED`, `NO_SUBJECTS` o `USER`) o `UNRESOLVED`, solo para un **intento** que falla: `AMBIGUOUS` (varias encajan: `candidates`) o `UNKNOWN_NAME` («parcial de criptografía» y Criptografía no existe: `suggestedName`, solo tras un tipo reconocido y un «de», hasta cuatro palabras, sin dígitos ni sustantivos genéricos; «parcial unidad 3» o «parcial final» no son asignaturas). Tras «ensayo», «reunión»… («ensayo de criptografía», «reunión de semillero») lo que sigue es el tema y queda en el título. El motor **ofrece**, nunca aplica ni crea.

**Título.** Lo que dicen las palabras junto a la palabra de actividad: termina en el primer conector («tarea PARA el jueves y otra…» es «Tarea»); los verbos de tener o entregar («tengo», «entrego») no entran. Si solo queda el nombre de la asignatura, ese nombre con certeza `LIKELY`. Sin nada: `INVALID`.

## Correcciones compartidas

`result.corrections[]` lista cada pregunta que **dos o más** propuestas comparten: la misma asignatura ambigua o desconocida (entre actividades distintas también) y los días que comparten una hora ambigua (también la hora de una referencia a un grupo). Una respuesta se propaga a todas mientras ninguna se haya personalizado: **lo que el estudiante cambia en UNA propuesta deja de seguir al grupo** y no lo pisa una respuesta posterior. Una pregunta que solo tiene una propuesta no se lista: su tarjeta la hace.

## Recurrencia

No se crea ningún bloque aquí. **Evidencia fuerte** («todos los martes», «cada martes», «semanal(mente)») → una `RecurrenceSuggestion` (días, hora por día, asignatura, título, `until` y qué falta: `startTime`, `endTime`, `until`) **en lugar de** actividades puntuales. El fin de la repetición solo se rellena (con el último día del periodo) cuando el texto dice «este semestre» o «todo el periodo»; la hora de fin nunca se infiere. **Evidencia débil** («los martes»; o «asignatura exacta + varios días» sin tipo de actividad) → se generan las propuestas puntuales y se marca `possibleRecurrence`. La revisión muestra la sugerencia **sin obligar a decidir**, con un enlace al horario; persistir el `ScheduleBlock` es F1-2e (reutiliza la confirmación de A1).

## Límite y duplicados

- Máximo **10** propuestas por texto (una cantidad cuenta). Si hay más: `status: TOO_MANY_PROPOSALS`, **ninguna** propuesta y «Encontré más de 10 actividades. Divide el mensaje en dos partes.» Nunca se trunca en silencio.
- El mismo día dicho dos veces es uno; las actividades idénticas dentro del texto se colapsan y se cuentan en `stats.collapsed`, **salvo** las que vienen de una cantidad («dos tareas el viernes»).
- `POST /api/capture/parse` marca (`duplicateOf`, `selected: false`, aviso) las propuestas que se parecen a una actividad del estudiante: mismo día, mismo tipo, título relacionado y la misma asignatura (una actividad **general** se compara con las generales). Solo avisa; una propuesta con la asignatura sin decidir no se compara.

## La revisión (`CaptureReview`, compartida)

Quick Capture (Inicio) y la Bandeja usan el mismo flujo (`CaptureFlow`) y la misma revisión: escribir → interpretar → revisar solo lo dudoso → confirmar una vez.

- Una propuesta `READY` **solo muestra el resultado** («Lunes 12 de octubre · 7:30 a. m. · Tarea · Sin asignatura») con casilla, «Editar» (cerrado por omisión) y «Quitar». Una con duda muestra **solo el campo dudoso**, en su lugar: la hora como botones («7:30 a. m.» / «7:30 p. m.» / «Sin hora» / otra hora), el día (con las alternativas que dio el texto), la asignatura («Crear «Criptografía»», «Elegir otra», «Sin asignatura») o el título.
- Una duda que comparten varias tarjetas se responde **una vez**, arriba («Una sola respuesta para 3 actividades»); cada tarjeta lo dice y permite «Cambiar solo en esta».
- Las completas se marcan solas; las incompletas, no, hasta resolverlas. Una copia de algo que ya existe empieza sin marcar.
- Un botón: **«Crear N actividades»**. Espera si hay marcadas incompletas. Una asignatura nueva se **guarda localmente** como «NEW(nombre)» y **no se crea hasta confirmar**; varias propuestas con el mismo nombre crean una sola.
- Lo que el estudiante deja sin marcar permanece en la revisión después de crear lo demás.
- Móvil: lista vertical, sin carrusel; escritorio: la misma lista legible. Un solo aviso final («4 actividades creadas»), no uno por tarjeta.

## Confirmación en lote (`POST /api/capture/confirm`)

Crea **todo lo marcado o nada**, en **una** transacción: las asignaturas nuevas y las actividades (con sus recordatorios automáticos).

- Cuerpo estricto `{ items: [...] }` (1..10). Cada ítem lleva exactamente los campos de `POST /api/activities` (título, tipo, fecha, hora, prioridad, descripción) más `clientId`, `subject` (`NONE` | `EXISTING{subjectId}` | `NEW{name}`) y `allowDuplicate`. **Nunca** `userId`, `periodId`, estado, `dueAt` ni recordatorios (se rechazan): el dueño sale de la sesión y el periodo se deriva en el servidor.
- **No duplica el dominio:** cada actividad pasa por el mismo `ActivityService.create` que la creación individual, ligado a la transacción (propiedad de la asignatura, periodo, instante, recordatorios). Lo propio del lote: resolver asignaturas (clave de nombre, color de la paleta que el periodo no usa, periodo actual), rechazar copias exactas y reportar **todos** los rechazos a la vez por `clientId`.
- Asignatura `EXISTING`: del usuario **y del periodo actual**; una ajena y una inexistente responden exactamente igual. `NEW`: se crea (o se reutiliza si ya existe por nombre, aunque la haya creado otro mientras tanto) una sola vez en el periodo actual.
- Un ítem inválido → **0 creadas** (la transacción se revierte, incluida la asignatura nueva); el error nombra el `clientId`. Un ítem desmarcado no viaja, así que no puede fallar.
- **Doble envío / reintento:** un bloqueo asesor transaccional por usuario serializa las confirmaciones y, además, una **copia exacta** (mismo título, tipo, asignatura y fecha-hora) de una actividad que ya existe se rechaza con 409 `DUPLICATE_ACTIVITY` salvo `allowDuplicate`. Un segundo toque o un reintento del navegador no crea nada dos veces; la interfaz además deshabilita el botón mientras corre y ofrece «Crear de todos modos». Las copias que vienen del mismo texto («dos tareas el viernes») sí se crean.
- Respuesta 201: `createdActivities` (con su `clientId`), `createdSubjects`, `reusedSubjects`, `count`; `Cache-Control: no-store`.
- Al terminar, la interfaz refresca actividades, Inicio, Radar, Atención, progreso, carga, recordatorios y asignaturas, sin recargar.

## Borradores persistentes

Ver [drafts.md](drafts.md): el texto, las propuestas y las decisiones de la captura, y los formularios de actividad, sobreviven a cerrar un diálogo, cambiar de página, recargar y a que Safari reconstruya la pestaña. Un borrador no crea nada por sí mismo.

## API

`POST /api/capture/parse` — `{ text, mode?: 'QUICK' | 'INBOX' }` (estricto: nada de `periodId`, usuario ni asignaturas; por omisión `QUICK`; la petición admite 20 000 caracteres y el límite de cada modo se devuelve como `status: TOO_LONG`). Responde `{ capture, period }`. Necesita sesión; ve solo las asignaturas del usuario en su periodo actual; `Cache-Control: no-store`; no guarda el texto. `POST /api/capture/confirm`: arriba. Ambas entran en las matrices de seguridad (sesión, mass assignment, propiedad, no-store, robustez frente a entradas hostiles).

Las rutas anteriores (`/api/quick-capture/parse`, `/api/academic-inbox/parse`) **se conservan por compatibilidad** pero la interfaz ya no las usa; se retirarán en una limpieza aparte.

## Compatibilidad y límites

- Una frase simple (`parcial redes martes 10am`, `tarea bases viernes`…) da **una** propuesta con el mismo título, tipo, asignatura, fecha y hora que Captura rápida siempre dio (pruebas lado a lado con el parser anterior); un mensaje pegado da las mismas actividades que la Bandeja.
- Cambia a propósito: «a las 6» (y «7:30») ya no se adivinan sino que son una pregunta con alternativas, a. m. primero; y una frase sin asignatura ya no pregunta por ella.
- Solo español; fraseos muy libres pueden no reconocerse. Las referencias se resuelven **hacia atrás** y solo contra menciones del mismo tipo; «cada uno», «los anteriores» y «los otros» fuera de una lista de días no se interpretan (la actividad queda con lo que dijo, y se pregunta lo que falta). Una cantidad con una lista de días que no cuadra se pregunta, no se adivina.
- Los ordinales fuera de una lista de días («el primer parcial») no se toman por posiciones.
