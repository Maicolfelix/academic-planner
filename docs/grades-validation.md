# Validación del modelo de notas (D36)

**Estado: VALIDACIÓN PROXY COMPLETA — GO provisional de ingeniería. Validación humana (estudiantes reales): PENDIENTE.** Esta ficha cierra el paso previo a escribir código de la decisión [D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones).

## Qué se hizo y qué NO se hizo

- **No se entrevistó a ningún estudiante.** No se presenta ningún ejemplo hipotético como evidencia. Para no bloquear el modelo de datos ni la API se validó D36 contra **3 sistemas de calificación reales, documentados públicamente** en reglamentos oficiales (fuentes primarias), sin datos personales.
- Las mismas 8 preguntas se respondieron desde cada fuente. Donde la fuente no lo dice se escribe **NO DOCUMENTADO** (no se infiere).
- La validación con estudiantes reales **sigue siendo obligatoria antes de cerrar la UX de Notas** (copy, flujo de configuración, formato de entrada). No bloquea el modelo de datos ni la API.

## Las 8 preguntas

1. Escala · 2. Nota mínima para pasar · 3. Cómo se divide la nota final · 4. ¿Mismos cortes y pesos en todas las materias? · 5. ¿Porcentaje de cada evaluación dentro del corte? · 6. Formato (directo / puntos / ambos) · 7. Reglas especiales · 8. Qué cálculos permitiría el modelo.

## Fuentes (todas oficiales, consultadas el 15-oct-2026)

| Caso | Documento                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Universidad Central (Bogotá), Resolución del Consejo Académico n.º 02 de 2011, art. 23: [PDF](https://www.ucentral.edu.co/sites/default/files/2024-11/2011-resolucion-consejo-academico-002.pdf); art. 28 (nueva redacción) en la Resolución n.º 01-2019: [PDF](https://www.ucentral.edu.co/sites/default/files/2024-08/resolucion-01-consejo-academico-2019.pdf) |
| A+   | Contraste de redondeo: Universidad de Santander (UDES), «Registro de calificaciones – Estudiantes»: [PDF](https://udes.edu.co/images/micrositios/registro-control/servicios/r-c-estudiantes-2023-b.pdf)                                                                                                                                                           |
| B    | Escuela Tecnológica Instituto Técnico Central (ETITC), colegio IBTI, Acuerdo n.º 03 del 4-dic-2020 (Sistema Institucional de Evaluación de los Estudiantes, SIEE; Decreto 1290 de 2009): [PDF](https://www.etitc.edu.co/archives/acuerdosie2020.pdf)                                                                                                              |
| C    | Universidad de Chile, Facultad de Ciencias, «Reglamento para Diplomas» (extensión y postítulo): [PDF](https://portaluchile.uchile.cl/dam/jcr:7bb31a45-fb60-43f7-b0c6-ef177f1ae4a4/reglamento-diplomas-facultad-de-ciencias.pdf), sección III «De las evaluaciones y asistencia»                                                                                   |

## Caso A — Universidad (Universidad Central, pregrado)

1. **Escala:** «escala numérica desde cero punto cero (0.0) hasta cinco punto cero (5.0) en intervalos de una décima (0.1)» (art. 28).
2. **Para pasar:** «la nota mínima aprobatoria será tres punto cero (3.0)» (art. 28, par. 1).
3. **División:** «tres reportes de calificaciones en el periodo académico. Dos … parciales, con un valor de 30% cada uno, y uno final con un valor del 40%» (art. 23). La definitiva es «el resultado, sin aproximación, de la ponderación» de los tres (art. 28, par. 2).
4. **Mismos cortes en todas las materias:** sí, es la regla general. Excepción: el Consejo Académico, con justificación escrita de la facultad, «podrá autorizar una sola evaluación o la modificación de los valores porcentuales … en algunas asignaturas» (art. 23, par. único). Es una excepción autorizada, no el caso normal.
5. **% de cada evaluación dentro del corte:** NO DOCUMENTADO en estos artículos («los docentes podrán realizar diferentes evaluaciones, según lo previsto en el PDA»).
6. **Formato:** directo (0.0–5.0). Puntos «ganado/máximo»: NO DOCUMENTADO.
7. **Reglas especiales:** el artículo 28 exige cumplir la escala de décimas incluso con una sola calificación. Habilitaciones/otras: NO DOCUMENTADO en lo leído.
8. **Cálculos que D36 permitiría:** nota actual, peso evaluado/restante, «¿cuánto necesito?» para llegar a 3.0, proyección, imposible/asegurado.
9. **¿D36 encaja?** **SÍ.** Cortes compartidos 30/30/40 = `GradingPeriod` con `finalShareBp` 3000/3000/4000; «sin aproximación» coincide con la comparación exacta de D36.

## Caso B — Colegio (ETITC / IBTI, SIEE)

1. **Escala:** institucional 1.0–5.0 equiparada a la nacional: Superior 4.6–5.0, Básico 3.0–3.9, Bajo 1.0–2.9 (art. 6; el rango Alto está en la misma tabla).
2. **Para pasar:** el desempeño Básico empieza en «tres punto cero (3.0)» (art. 6).
3. **División:** cuatro periodos académicos; «cada uno de los cuatro (4) periodos … tiene un valor porcentual de veinticinco por ciento (25%)» (art. 12). Hay «evaluaciones en mínimo dos (2) cortes dentro de cada periodo académico».
4. **Mismos pesos en todas las materias:** 25 % ×4 para toda área/asignatura. Excepción documentada: en Ciencias Naturales las asignaturas tienen subpesos por área (p. ej. Biología 50 %, Física 25 %, Química 25 %; art. 12, par.). Se modela como materias separadas; el subpeso entre asignaturas de un área queda fuera del MVP.
5. **% de cada evaluación dentro del periodo:** NO DOCUMENTADO.
6. **Formato:** directo (escala numérica 1.0–5.0). Puntos: NO DOCUMENTADO.
7. **Reglas especiales:** pruebas de mejoramiento (superación, refuerzo, profundización) cada periodo; prueba de suficiencia final; redondeo: «En caso de resultar centésimas … la nota se aproxima a la décima superior si su valor es mayor o igual a cinco (5) o se elimina si su valor es inferior a cinco» (art. 6, par. 1).
8. **Cálculos:** los mismos que A (periodos = `GradingPeriod` 2500 bp ×4).
9. **¿D36 encaja?** **SÍ, con límites declarados:** las pruebas de mejoramiento y el subpeso por área quedan fuera del MVP; el redondeo institucional no coincide con la comparación exacta (ver «Hallazgo»).

## Caso C — Otro estudio (Diplomado, Universidad de Chile, Facultad de Ciencias)

1. **Escala:** «escala de 1,0 a 7,0 con un solo decimal» (III.2).
2. **Para pasar:** módulo reprobado si «nota final inferior a 4,0» (III.3). Para recibir el diploma: aprobar todos los módulos y cumplir ≥ 80 % de asistencia (II.2, III.5).
3. **División:** por módulos; el coordinador define «el sistema de evaluación del Programa, atendiendo a las características propias de cada módulo» (III.1). Pesos entre módulos: NO DOCUMENTADO.
4. **Mismos cortes/pesos en todas las materias:** NO; el sistema se define por módulo. Cada módulo es una materia con una sola etapa («Nota final», 100 %) cuyas evaluaciones pesan lo que defina el coordinador («cualquiera sea su forma, número o importancia relativa», III.2). No hay cortes distintos _dentro_ del mismo periodo que choquen con D36: el módulo se representa con el bloque único de D36.
5. **% de cada evaluación:** NO DOCUMENTADO en el reglamento (lo fija cada programa).
6. **Formato:** directo (1,0–7,0). Puntos: NO DOCUMENTADO.
7. **Reglas especiales:** asistencia mínima 80 % (con justificación hasta 60 %) y encuesta obligatoria; aprobación del diploma = aprobar todos los módulos. Quedan fuera del MVP (no hay asistencia por materia ni aprobación a nivel de programa).
8. **Cálculos:** nota actual por módulo, lo que falta y «¿cuánto necesito?» para 4,0.
9. **¿D36 encaja?** **SÍ.** Escala 1–7 con aprobatoria 4,0 = `GradingProfile` (minMilli 1000, maxMilli 7000, passMilli 4000, decimals 1); sin cortes = un bloque «Nota final» de 10000 bp.

**Contraste cualitativo (no cuenta para el veredicto):** el SENA (formación técnica) evalúa por «juicios evaluativos» (aprobado / por mejorar, no numérico), según documentos de terceros ([sindesena.org](https://sindesena.org/wp-content/uploads/2023/11/01IRREGULARIDADES-EN-APROBACION-DE-JUICIOS-EN-CENTRO-DEL-TOLIMA.pdf)). No se verificó el reglamento vigente y **no se usa como evidencia**. Se declara **fuera del MVP** (escalas numéricas únicamente): un estudiante así simplemente no configura notas, y el resto de la app (actividades, agenda, Radar) no cambia.

## Matriz de decisión

| Caso                    | Fuente                      | Escala                 | Pass           | Cortes                                              | Pesos compartidos                              | Formato | Reglas especiales                                              | D36 encaja | Cambio requerido                                      |
| ----------------------- | --------------------------- | ---------------------- | -------------- | --------------------------------------------------- | ---------------------------------------------- | ------- | -------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| A Universidad Central   | Res. CA 02/2011 art. 23, 28 | 0.0–5.0, décimas       | 3.0            | 3 reportes 30/30/40                                 | Sí; excepción autorizada por Consejo Académico | Directo | Sin aproximación. Otras: NO DOCUMENTADO                        | **SÍ**     | Ninguno                                               |
| B ETITC / IBTI (SIEE)   | Acuerdo 03/2020 art. 6, 12  | 1.0–5.0 (4 desempeños) | 3.0            | 4 periodos × 25 %                                   | Sí; subpesos por área en Ciencias Naturales    | Directo | Pruebas de mejoramiento; redondeo a la décima (≥ 5 centésimas) | **SÍ**     | Ninguno en B1; `roundingMode` aditivo futuro (límite) |
| C Diplomado U. de Chile | Reglamento Diplomas III     | 1,0–7,0, un decimal    | 4,0 por módulo | Por módulo (sin cortes fijos); pesos NO DOCUMENTADO | No: el sistema lo define cada módulo/programa  | Directo | Asistencia ≥ 80 %; aprobar todos los módulos                   | **SÍ**     | Ninguno                                               |

## Hallazgo: el redondeo institucional difiere

- Universidad Central: «sin aproximación» (coincide con D36).
- ETITC: centésimas ≥ 5 suben a la décima superior antes de usarse.
- UDES: «tiende a redondear cuando la centésima esta entre 5 y 9, por ejemplo, si la nota acumulada es de 2,97 la nota definitiva … será de 3,0» (contraste A+).

**Consecuencia:** D36 compara la nota exacta con la aprobatoria; en una institución que redondea, 2,97 diría «no pasas» donde la institución dice «pasas». Es un **límite conocido**, no un NO-GO: no cambia el modelo (cortes, pesos, escala). La UX debe decir «estimación; tu institución puede redondear» cerca del borde, y un `roundingMode` (por defecto `NONE`) puede agregarse después como columna aditiva en `GradingProfile` sin tocar nada existente.

## Criterios GO / NO-GO y veredicto

**NO-GO** si fuera un requisito normal: pesos de cortes distintos por materia; escala no numérica obligatoria; reglas que invaliden el promedio ponderado; o evaluaciones no representables con `GradingPeriod` + `Evaluation`.

| Criterio NO-GO                        | Resultado                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pesos de cortes distintos por materia | No es lo normal: A y B los fijan para todas; solo A admite excepción autorizada; C usa un bloque. |
| Escala no numérica obligatoria        | No: A, B y C son numéricas. El SENA queda fuera del MVP (contraste no verificado).                |
| Fórmula que invalide el promedio      | No: promedio ponderado en los 3. Mejoramiento/habilitación quedan como límites fuera del MVP.     |
| Evaluación no representable           | No: toda evaluación cabe en `GradingPeriod` + `Evaluation`.                                       |

**Resultado: GO provisional de ingeniería.** Dominio de notas: DISEÑO APROBADO / VALIDADO CON PROXY / LISTO PARA IMPLEMENTAR. Validación UX humana: PENDIENTE.

> **Nota posterior (QA real, PR #45):** la columna «Pesos compartidos» y la fila del criterio NO-GO sobre pesos distintos por materia se leyeron como «raros». La QA real mostró que **sí** son normales (distintos profesores, distintos porcentajes en el mismo semestre), así que los cortes pasaron a ser **de la materia** ([D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones)). Los tres casos siguen encajando: cada materia define sus cortes.

## MVP congelado (reconfirmado)

`GradingProfile → AcademicPeriod`; `GradingPeriod → Subject` (revisado en la QA real; antes `→ AcademicPeriod`); `Evaluation → Subject`; la evaluación exige `GradingPeriod`; una `Activity` tiene 0..N evaluaciones; `scoreMilli` canónico; `rawEarnedMilli`/`rawMaxMilli` aparte; solo escalas numéricas; cortes compartidos por `AcademicPeriod`; sin pesos de corte por materia; sin puntos extra; sin letras; sin fórmulas arbitrarias.

## Pendiente antes de cerrar la UX de Notas

Validar con estudiantes reales: lenguaje («corte»/«etapa»), flujo de configuración, formato de entrada (4.2 vs 18/20) y el aviso de redondeo. No bloquea el modelo de datos ni la API.
