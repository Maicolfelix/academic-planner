> **F1-2b:** el mismo motor de propuestas que usa ahora Captura rápida ([capture-proposals.md](capture-proposals.md), `POST /api/capture/parse` con `mode: 'INBOX'`) ya existe y da las mismas actividades que esta pantalla, más listas de días y horas por posición. **Esta pantalla todavía usa su ruta anterior** (F1-2d).

# Bandeja académica (Fase 12)

## Objetivo

Convertir un mensaje largo de un profesor ("El martes tendremos parcial de Redes a las 10am y el viernes deben entregar el taller 2") en **propuestas** de actividad que el estudiante revisa y confirma. Nada se crea solo.

## Diferencia con Captura rápida

|           | Captura rápida (F11)            | Bandeja académica (F12)                                    |
| --------- | ------------------------------- | ---------------------------------------------------------- |
| Entrada   | una frase, hasta 300 caracteres | un mensaje, hasta 5000                                     |
| Resultado | una actividad                   | de 0 a 10 propuestas                                       |
| Contexto  | una sola cláusula               | contexto por oración (asignatura, fecha, hora compartidas) |
| Endpoint  | `POST /api/quick-capture/parse` | `POST /api/academic-inbox/parse`                           |

Ambas usan los mismos bloques (`packages/core/src/captureShared.ts`): alias de tipos, asignaturas, fechas, horas, normalización y zona horaria. La bandeja solo añade segmentación, contexto y duplicados.

## Pipeline

1. **Segmentación en oraciones** (`splitSentences`): saltos de línea, `;`, `.`, `!`, `?`. No corta en "a. m.", abreviaturas (Prof.), iniciales, decimales ni numeración de listas.
2. **Anclas** (`findAnchors`): palabras de tipo explícitas (parcial, taller…) y verbos de entrega/lectura con sustantivos ("entregar informe" puede ser TAREA). "Hablaremos del tema" no es actividad.
3. **Cláusulas** (`clauseStart`): varias actividades en una oración se cortan en la última conjunción (`y`, `además`, `luego`…) o coma entre anclas.
4. **Interpretación**: cada cláusula pasa por `interpretTokens` (el parser de F11).
5. **Filtro**: se conserva una propuesta solo si entendió fecha, hora o asignatura, hay asignatura ambigua o hay una palabra de intención (tendremos, deben, entregar…). Las idénticas se colapsan.
6. **Límite**: máximo 10; si hay más, aviso "Encontré más de 10 actividades".
7. **Duplicados** (solo en la API): ver abajo.

## Contexto y herencia

Lo que la oración dice **antes de su primera actividad** (asignatura, fecha, hora) se comparte con las cláusulas siguientes **solo si la cláusula no trae lo suyo**. "En Redes tendremos parcial el martes. En Bases de Datos entregaremos proyecto el viernes" da a cada oración su asignatura. Una asignatura heredada es `LIKELY`, nunca `EXACT`, y avisa ("SUBJECT_INHERITED").

## Ambigüedad e incompletitud

- Asignaturas parecidas ("Programación" con I y II) devuelven candidatos; nunca se elige una al azar.
- Una propuesta incompleta (`INCOMPLETE`) es válida y conserva lo entendido; la interfaz exige completarla antes de crearla.
- Certeza por campo: `EXACT`, `LIKELY`, `AMBIGUOUS`, `MISSING` (sin porcentajes).
- Prioridad no se infiere (queda MEDIA), descripción vacía, estado PENDIENTE. "Primer parcial" → "Parcial 1".

## Duplicados

La API consulta **las actividades del usuario** en el periodo actual para los días de las propuestas (una consulta, filtrada por `userId`). Es posible duplicado si coinciden asignatura, día local, tipo y título (igual o prefijo por palabras). Solo **avisa** ("Ya existe una actividad similar."): no bloquea. En la interfaz esas propuestas empiezan sin seleccionar.

## Confirmar

"Crear seleccionadas" crea cada propuesta marcada, **una tras otra**, con el mismo `POST /api/activities` que el formulario manual (recordatorios, Radar, Atención, progreso y carga se refrescan igual). No hay endpoint por lotes ni transacción global: si una falla, las ya creadas se quedan y se muestra "n creadas, n pendientes". Una tarjeta creada no se puede volver a crear.

## Privacidad y seguridad

- El texto se interpreta en memoria; **no se guarda** (no hay tabla de mensajes) ni se registra.
- Sin IA ni servicios externos.
- Cuerpo estricto `{ text }`; `userId`, `periodId` o listas de asignaturas se rechazan. Dueño, zona horaria, periodo y asignaturas salen de la sesión.
- Respuesta `Cache-Control: no-store`.
- Texto de más de 5000 caracteres: estado `TOO_LONG` con "El texto es demasiado largo. Pega únicamente el mensaje académico relevante."; más de 20000 se rechaza con 400.

## Por qué no usa IA

Las reglas son auditables, reproducibles y sin costo ni envío de datos; el estudiante siempre revisa. Una IA podría cubrir más fraseos, pero requeriría enviar mensajes a terceros.

## Limitaciones

- Solo español; fraseos muy libres pueden no reconocerse (se verá "No encontramos actividades claras").
- Fechas sin año se resuelven con la próxima ocurrencia y avisan si caen fuera del periodo.
- Una asignatura mencionada en una oración no se hereda a la siguiente.
- Los duplicados no se detectan para propuestas sin asignatura o sin fecha, ni se compara contra actividades generales (sin asignatura): un duplicado se juzga por asignatura.
