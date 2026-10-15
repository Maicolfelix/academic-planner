# Validación del modelo de notas con 3 casos reales

**Estado: validación PENDIENTE. Nada del modelo de notas está implementado.** Esta ficha cierra el paso previo a escribir código de la decisión [D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones). No necesita ninguna interfaz: se hace con una conversación corta o una hoja de cálculo.

## Reglas de la validación

- **3 casos reales** (estudiantes reales o casos reales que ellos confirmen), idealmente: **A** universidad con cortes (p. ej. 0–5 con cortes 30/30/40), **B** colegio con periodos de evaluación, **C** otro estudio (curso, técnico o diplomado).
- **No se recoge nada personal:** ni nombre, ni código estudiantil, ni la institución (salvo que sea imprescindible para entender una regla). Se anota el caso como «A», «B» o «C».
- Se pregunta **solo** lo de la lista de abajo y se anota lo que el estudiante dice, sin completarlo.
- No se guardan documentos del estudiante (syllabus, notas) en el repositorio.

## Las 8 preguntas

1. ¿Cuál es la escala de notas?
2. ¿Cuál es la nota mínima para pasar?
3. ¿Cómo se divide la nota final (por cortes, por periodos, por módulos…)?
4. ¿Todos los cursos o materias usan los mismos cortes y los mismos porcentajes?
5. Dentro de un corte, ¿cada evaluación tiene su propio porcentaje?
6. ¿Reciben las notas como 4.2, como 18/20, o de las dos formas?
7. ¿Hay reglas especiales frecuentes (recuperación, habilitación, descartar la menor, puntos extra)?
8. ¿Qué quieren saber más: la nota actual, cuánto necesitan, o las dos?

## Matriz de decisión (se llena con los 3 casos)

| Caso             | Escala | Nota para pasar | Cortes | Pesos comunes a todas las materias | Formato de nota | Reglas especiales | ¿El MVP encaja? (SÍ/NO) | Cambio requerido |
| ---------------- | ------ | --------------- | ------ | ---------------------------------- | --------------- | ----------------- | ----------------------- | ---------------- |
| A (universidad)  | —      | —               | —      | —                                  | —               | —                 | —                       | —                |
| B (colegio)      | —      | —               | —      | —                                  | —               | —                 | —                       | —                |
| C (otro estudio) | —      | —               | —      | —                                  | —               | —                 | —                       | —                |

Una fila vacía significa que **ese caso aún no se validó**. No se implementa hasta llenar las tres.

## Criterios GO / NO-GO

**GO** solo si:

- los 3 casos caben en el modelo MVP (escala numérica, cortes compartidos por periodo, promedio ponderado, nota canónica con «ganado/máximo» opcional), **o**
- las diferencias se pueden declarar claramente **fuera del MVP** sin que la función deje de ser útil (por ejemplo, «descartar la menor» o «puntos extra» como límites conocidos).

**NO-GO** si aparece con frecuencia:

- pesos de cortes **distintos por materia** dentro del mismo periodo (obligaría a diseñar el _override_ antes);
- una escala **no numérica obligatoria** (letras, solo aprobado/reprobado);
- fórmulas institucionales que **invaliden** el promedio ponderado del MVP.

## Qué hacer con el resultado

1. Se llena la matriz y se anota el GO o el NO-GO con su motivo, sin datos personales.
2. Con **GO**: se registra en [D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones) y el siguiente paso es un PR pequeño de implementación aprobado explícitamente (nada se inicia por iniciativa propia).
3. Con **NO-GO**: se revisa la decisión (el cambio más probable es el _override_ por materia o una escala adicional) antes de cualquier código.

**Resultado actual:** pendiente. Ningún caso ha sido validado.
