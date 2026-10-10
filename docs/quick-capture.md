# Captura rápida (Fase 11)

> **F1-2b:** el motor que interpreta varias actividades y varios días por texto, con propuestas `READY` / `NEEDS_REVIEW` / `INVALID`, ya existe ([capture-proposals.md](capture-proposals.md), `POST /api/capture/parse`). **Esta pantalla todavía no lo usa** (F1-2d): sigue con el parser descrito abajo, que admite una actividad por frase y por eso emite «Captura rápida admite una actividad a la vez.».

## Objetivo

Que el estudiante registre una actividad escribiendo **una frase corta** ("parcial redes martes 10am") en lugar de abrir el formulario completo. El sistema interpreta la frase y propone una actividad; el estudiante la revisa y la confirma.

## Capturar → Interpretar → Confirmar

1. **Capturar:** el estudiante escribe la frase en el bloque "Captura rápida" del Dashboard (máximo 300 caracteres).
2. **Interpretar:** `Enter` o "Interpretar" llaman a `POST /api/quick-capture/parse`, que **solo propone**. No crea nada: el texto nunca se convierte directamente en una actividad.
3. **Confirmar:** aparece una vista previa **editable** (título, asignatura, tipo, fecha y hora). Solo el botón **"Crear actividad"** guarda, y lo hace con el **mismo** `POST /api/activities` y la misma mutación del formulario manual. No hay un camino de creación propio.

Por eso, al confirmar ocurre todo lo ya existente, sin duplicar lógica: recordatorios automáticos (Fase 7), el Radar (8), "¿Qué hago ahora?" (9), progreso y carga semanal (10) y la invalidación de consultas del Dashboard y de Actividades.

"Crear actividad" está deshabilitado mientras falte título, asignatura o fecha. También hay "Volver a editar texto" (conserva la frase), "Cancelar" (descarta y vacía el texto; no se crea nada) y "Crear manualmente" (abre el formulario de siempre). La captura rápida no sustituye al método tradicional.

## Parser determinístico (sin IA)

`parseQuickCapture(texto, contexto)` vive en `packages/core/src/quickCapture.ts`. Usa normalización (minúsculas, sin acentos), tokenización, diccionarios, expresiones regulares ancladas y reglas de fechas. **No** usa modelos de lenguaje, APIs externas, embeddings ni servicios de NLP: todo corre en el backend de la aplicación.

El contexto (`now`, zona horaria, asignaturas del **periodo actual** y fechas del periodo) lo arma el servicio con los datos del usuario autenticado; el parser no consulta la base de datos. `now` es inyectable, así que todas las reglas de fecha son testeables.

Fases del parser, en este orden: horas → fechas → asignatura → tipo → título residual → avisos.

### Resultado

Siempre se devuelve lo que se entendió; entender solo una parte **no** es un error:

- `status`: `OK`, `EMPTY` o `TOO_LONG`.
- `title`, `type`, `subjectId`, `dueDate`, `dueTime` (HH:mm, 24 h) y `hasTime`.
- `certainty` por campo, determinística y nunca un porcentaje: `EXACT`, `LIKELY`, `AMBIGUOUS` o `MISSING`.
- `recognizedFields`, `missingFields` (título, asignatura o fecha: lo necesario para crear), `ambiguities` (candidatos de asignatura) y `warnings` con código y mensaje.

No propone prioridad ni descripción; el estado siempre será `PENDING`, como en la creación manual.

## Tipos reconocidos

| Tipo                        | Palabras                                           |
| --------------------------- | -------------------------------------------------- |
| Tarea (`TASK`)              | tarea, trabajo                                     |
| Parcial (`EXAM`)            | parcial, examen                                    |
| Quiz (`QUIZ`)               | quiz, quizz, prueba corta                          |
| Proyecto (`PROJECT`)        | proyecto                                           |
| Exposición (`PRESENTATION`) | exposición, exposicion, presentación, presentacion |
| Taller (`WORKSHOP`)         | taller                                             |
| Lectura (`READING`)         | lectura                                            |
| Otro (`OTHER`)              | otro                                               |

**"Trabajo"** puede ser una tarea o un proyecto: se interpreta como `TASK`; "proyecto" es la forma explícita de decir `PROJECT`. Sin palabra de tipo, el tipo queda en `TASK` (como en el formulario manual) y se avisa de que no se reconoció. Mayúsculas y acentos no importan.

## Asignaturas

Solo se comparan las asignaturas **del usuario autenticado en su periodo actual**. Orden de preferencia, sin coincidencia aproximada agresiva (una asignatura equivocada es peor que ninguna):

1. **Nombre completo normalizado** (sin acentos ni mayúsculas): `EXACT`.
2. _(Alias propios: no están implementados.)_
3. **Palabras o prefijos inequívocos** de al menos 3 letras ("bases", "anato", "datos"): `LIKELY` si queda una sola asignatura.
4. Si varias asignaturas encajan: **`AMBIGUOUS`**, nunca se elige una al azar. La vista previa pregunta "¿A cuál te refieres?" con los candidatos (operable con teclado). Una palabra más que las distinga ("programación ii") lo resuelve.
5. Si ninguna encaja: `subjectId = null` y aviso "No reconocí una asignatura". **Nunca se crea una asignatura.**

Una palabra de tipo suelta ("proyecto") no elige asignatura por sí sola: "proyecto redes" es un proyecto de Redes, aunque exista una asignatura "Proyecto Integrador". Si se escribe el nombre completo de una asignatura que contiene una palabra de tipo ("taller de redes"), prevalece la asignatura.

## Fechas

Siempre sobre el calendario **local** del usuario (`User.timezone`), reutilizando los ayudantes de fecha existentes.

- **Relativas:** `hoy`, `mañana`, `pasado mañana`.
- **Días de la semana:** lunes … domingo (con o sin acento). "este martes" es la próxima ocurrencia contando hoy; **"próximo martes" es estrictamente posterior a hoy** (si hoy es martes, el de la semana siguiente).
- **Numéricas, día primero (formato colombiano, nunca MM/DD):** `15/10`, `15-10`, `15/10/2026`, `15/10/26`.
- **Con el mes escrito:** `10 de octubre`, `10 octubre`, `octubre 10`, `10 de octubre de 2026`.
- **Sin año:** la próxima ocurrencia de ese día y mes, contando hoy (`29/02` → el próximo 29 de febrero real).
- Fechas imposibles (`31/02`) se avisan como inválidas; no se adivinan.

### Regla del día de la semana

Un nombre de día significa **la próxima ocurrencia de ese día, contando hoy**. Excepción: si ese día **es hoy** y se escribió una **hora que ya pasó**, se entiende el mismo día de la **próxima semana** (con aviso). Sin hora, "martes" un martes es hoy. A la hora exacta aún no ha pasado. "hoy" con una hora pasada se queda en hoy y avisa ("La hora indicada ya pasó para hoy.").

### Periodo académico

Si la fecha interpretada queda **fuera del periodo actual**, no se corrige: se muestra el aviso "La fecha interpretada está fuera del periodo académico actual." y el estudiante puede editarla. Una fecha anterior a hoy (solo posible con año explícito) avisa "La fecha interpretada ya pasó.".

## Horas

`10am`, `10 am`, `10 a.m.`, `10 a. m.`, `10:30`, `10:30pm`, `14:00`, `2pm`, `2 pm`, y "a las 10am". Se normalizan a `HH:mm` en 24 h (`12am` = 00:00, `12pm` = 12:00). Una hora inválida (`25:00`, `14:90`, `0pm`, `13pm`) se avisa con un mensaje claro y se descarta, sin romper el resto. Un número suelto ("unidad 3") **no** se toma como hora: hace falta `am/pm` o `HH:mm`. Única excepción: "a las 10" se lee como 10:00 con certeza `LIKELY` (no `EXACT`), para que el estudiante lo revise. Si se escribe un día de la semana junto a una fecha ("martes 13 de octubre") y no coinciden, se usa la fecha y se avisa (`WEEKDAY_MISMATCH`).

Sin hora, `hasTime = false`: la actividad conserva el comportamiento de siempre (vence al terminar el día); no se inventa "11:59 p. m." en la interfaz.

## Título

El título es la **etiqueta del tipo** más el texto que sobra, tal como se escribió (mayúsculas y acentos incluidos), sin conectores sueltos en los extremos. Si solo queda el tipo, es la etiqueta: "Parcial". "parcial redes unidad 3 martes 10am" → **"Parcial unidad 3"**. Sin tipo, el texto restante (con la primera letra en mayúscula) es el título. Si pasa de 150 caracteres se recorta con aviso.

## Avisos

No reconocí una asignatura · Encontré más de una asignatura posible · No encontré una fecha · La fecha interpretada está fuera del periodo académico actual · La hora indicada ya pasó para hoy · La hora de hoy ya pasó: se propuso el mismo día de la próxima semana · La fecha interpretada ya pasó · La hora/fecha "…" no es válida · El título se acortó a 150 caracteres · **Captura rápida admite una actividad a la vez.**

Esta última aparece si la frase tiene dos tipos distintos, dos fechas distintas o dos asignaturas claras ("parcial redes martes y tarea bases viernes"). No se crean dos actividades: se propone la primera. No es una detección perfecta.

## Entradas especiales

- Vacío: "Escribe una actividad para continuar." (no se llama a la API).
- Más de 300 caracteres: "Este texto parece demasiado largo para Captura rápida." Un mensaje largo de un profesor es otra cosa (Fase 12).
- Texto desconocido (`asdf xyz`): una vista previa incompleta, nunca un error 500.
- Si falla el endpoint: "No pudimos interpretar el texto. Puedes intentarlo de nuevo o crear la actividad manualmente." El texto escrito no se pierde.

## Ejemplos

"Hoy" es el lunes 5 de octubre de 2026, 12:00, en Bogotá.

| Texto                                                    | Resultado                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `parcial redes martes 10am`                              | Parcial · Redes · mar 6 oct · 10:00 · título "Parcial"                              |
| `tarea bases viernes`                                    | Tarea · Bases de Datos · vie 9 oct · sin hora                                       |
| `quiz anatomia mañana 8am`                               | Quiz · Anatomía · 6 oct · 08:00                                                     |
| `proyecto programacion 15/10`                            | Proyecto · Programación · 15 oct · sin hora                                         |
| `exposicion epidemiologia jueves 2pm`                    | Exposición · Epidemiología · 8 oct · 14:00                                          |
| `lectura inmunologia hoy`                                | Lectura · Inmunología · 5 oct · sin hora                                            |
| `taller bioestadistica 20/10 14:30`                      | Taller · Bioestadística · 20 oct · 14:30                                            |
| `parcial programacion martes`                            | **Ambiguo** con "Programación I" y "Programación II": pregunta a cuál; fecha 6 oct  |
| `parcial mañana`                                         | **Incompleto**: Parcial · 6 oct; falta la asignatura                                |
| `parcial redes unidad 3 martes 10am`                     | Título residual: "Parcial unidad 3"                                                 |
| `parcial redes martes 10am` (dicho el martes a las 3 pm) | Martes **siguiente** 10:00, con aviso de que la hora de hoy ya pasó                 |
| `parcial redes martes y tarea bases viernes`             | Propone el parcial de Redes del martes y avisa de que admite una actividad a la vez |
| `parcial redes viernes 25:00`                            | Hora inválida avisada y descartada; el resto se entiende                            |

## Privacidad

El texto se interpreta **dentro de la aplicación**: no se envía a servicios externos, no se usa telemetría y **no se guarda** (no hay tabla de capturas ni historial). Una vez creada la actividad no se conserva la frase original.

## Seguridad

El texto es solo texto: nunca se ejecuta ni se interpola en consultas. Las expresiones regulares son simples y ancladas (sin retroceso catastrófico) y la entrada está acotada (300 caracteres de producto, 2000 como tope del cuerpo). El endpoint solo ve las asignaturas del usuario autenticado y de su periodo actual; el cuerpo es estricto (`{ text }`, sin `userId`, `periodId` ni asignaturas).

## Por qué no usa IA

Un parser de reglas es explicable, reproducible, testeable y funciona sin conexión ni coste. Cada decisión (qué asignatura, qué día, por qué se movió a la semana siguiente) tiene una regla escrita y una prueba. A cambio, solo entiende lo que está en sus diccionarios y reglas.

## Limitaciones

- Una frase = una actividad. No separa varias actividades ni interpreta mensajes largos.
- Sin alias de asignatura propios; solo nombre completo, palabras y prefijos.
- Sin prioridad, descripción ni horas relativas ("en dos horas"); sin meses abreviados ni rangos de fechas.
- "Trabajo" es siempre tarea; si el nombre de la asignatura contiene una palabra de tipo, prevalece la asignatura.
- Un número suelto no es una hora ni un día sin el mes.
- Un nombre de día sin hora el mismo día se interpreta como hoy.

## Diferencia con la Fase 12

La Fase 11 entiende **frases cortas y semiestructuradas** ("parcial redes martes 10am"). La Fase 12 ([academic-inbox.md](academic-inbox.md)) trata **mensajes largos** y varias actividades, reutilizando este mismo parser (`captureShared.ts`) sin duplicar reglas.
