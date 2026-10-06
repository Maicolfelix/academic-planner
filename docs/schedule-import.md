# Importación de horario con imagen o PDF (Fase 14)

## Objetivo

Evitar teclear a mano cada clase («lunes 08:00–10:00 Redes…»): el estudiante sube su horario (imagen o PDF), revisa una **propuesta** y confirma. Es el mismo principio de siempre: «Organizarse no debe convertirse en otra tarea», con la regla **Capturar → Interpretar → Confirmar**.

```
ARCHIVO → EXTRACCIÓN → INTERPRETACIÓN → PREVIEW → CORRECCIÓN → CONFIRMACIÓN → SCHEDULEBLOCK
```

Nunca se crea nada al leer el archivo. Cada clase confirmada se crea con el `POST /api/schedule` de siempre.

## Alcance honesto

No promete entender cualquier horario del mundo. Funciona razonablemente con tablas por días, listas por días y PDF con texto o escaneados, en español. Si no puede leer algo, lo dice y deja que el estudiante lo complete. **Sin IA** (ni modelos generativos ni de visión ni servicios externos): OCR tradicional, geometría y reglas determinísticas.

## Arquitectura

Dos mitades separadas a propósito:

| Mitad          | Pregunta                      | Dónde                                                                               |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| Extracción     | «¿Qué texto veo y dónde?»     | `apps/api/src/scheduleImport/` (`fileValidation.ts`, `providers.ts`, `pipeline.ts`) |
| Interpretación | «¿Qué clases puedo proponer?» | `packages/core/src/scheduleImport.ts` (puro y determinístico)                       |

El contacto entre ambas es una representación intermedia: **palabras con posición** (`ExtractedWord { text, x, y, width, height, confidence? }`) agrupadas por página (`ExtractedDocument`). El dominio no sabe qué motor OCR ni qué librería PDF hay detrás: `PdfProvider` y `OcrProvider` son dos interfaces pequeñas y los tests de interpretación usan palabras simuladas, sin OCR real. Hay además pruebas de integración con el OCR real sobre fixtures sintéticos.

Pipeline (`POST /api/schedule-import/parse`, `multipart/form-data`, campo `file`):

1. `validateFile` — firma real, extensión, tipo declarado, tamaño y dimensiones.
2. `extractContent` — imagen → OCR; PDF → **texto nativo primero, OCR solo como fallback** por página.
3. `detectLayout` / `extractClassCandidates` — tabla por días o lista.
4. `matchSubject` — contra las asignaturas del periodo actual del usuario.
5. `buildScheduleProposals` — propuestas con fecha de primera ocurrencia y repetición semanal.
6. Duplicados y conflictos contra la agenda del usuario.

## Tecnología elegida y por qué

- **OCR: `tesseract.js` 7** (WebAssembly en un worker de Node). Corre **localmente** dentro del proceso de la API: sin binarios nativos que instalar (funciona igual en Windows, CI y Docker), sin servicios externos, devuelve palabras con caja y confianza (necesario para leer tablas por columnas). Peso: ~1,4 MB de código más el modelo de español.
- **Idioma:** el modelo `spa` viene en el paquete npm `@tesseract.js-data/spa` (variante `4.0.0_best_int`, ~2 MB): **nada se descarga en tiempo de ejecución** y no se escribe caché a disco (`cacheMethod: 'none'`).
- **Texto de PDF y render de páginas escaneadas: `unpdf`** (pdf.js empaquetado para servidor, MIT) con **`@napi-rs/canvas`** (binario precompilado, sin dependencias de sistema) para dibujar la página antes del OCR. La extracción nativa da posiciones exactas y es más rápida y precisa que el OCR.
- **Subida: `multer` 2** con almacenamiento en memoria.
- Descartadas: `pdf-parse` (21 MB, sin posiciones útiles), `sharp` (preprocesado no justificado: no mejoró de forma medible), motores nativos (instalación frágil).

El worker de OCR se crea al primer uso, procesa **una imagen a la vez** y se libera tras 30 s sin uso (una API ociosa no retiene memoria de OCR).

## Formatos y límites

|              |                                                                     |
| ------------ | ------------------------------------------------------------------- |
| Formatos     | PNG, JPG/JPEG, PDF (no WebP, no GIF)                                |
| Tamaño       | 10 MB (se corta mientras se sube)                                   |
| PDF          | máximo 5 páginas; más se rechaza con un mensaje claro               |
| Imagen       | máximo 25 megapíxeles (se lee del encabezado, sin decodificar)      |
| Tiempo       | 60 s por solicitud (`504`; se detiene también el motor OCR)         |
| Concurrencia | una importación a la vez por usuario (`429 IMPORT_IN_PROGRESS`)     |
| Frecuencia   | 10 importaciones / 10 min por IP (`SCHEDULE_IMPORT_RATE_LIMIT_MAX`) |

## Validación y seguridad de archivos

- El tipo se decide por el **contenido** (firma PNG/JPEG/`%PDF-`), nunca por el nombre. El nombre y el tipo declarado solo deben **coincidir**: un `.txt` renombrado `.png` se rechaza (`415`), igual que un PDF que dice ser imagen.
- El nombre del archivo no se usa para nada más. **El archivo vive solo en memoria durante la solicitud: nunca se escribe a disco**, así que no hay archivo temporal que limpiar ni ruta que recorrer (un test comprueba que la carpeta temporal queda intacta, también cuando falla).
- Cuerpo estricto: un solo archivo en el campo `file` y ningún otro campo (`userId`, `periodId`… se rechazan). El periodo y las asignaturas salen de la sesión.
- Respuesta `Cache-Control: no-store`.

## Cómo se interpreta

**Días:** lunes … domingo y abreviaturas (lun, mar, mié/mie, jue, vie, sáb/sab, dom), sin distinguir mayúsculas ni acentos.

**Horas y rangos:** `07:00`, `7:00`, `7am`, `07:00 AM`, `14:00`, `2pm`; rangos `08:00-10:00`, `08:00 – 10:00`, `8 a 10`, `8:00 a.m. - 10:00 a.m.`, `2-4pm`. Un número suelto como `Salón 301` o `Grupo 1-2` no es una hora. Un rango que no crece (`10:00-08:00`) se conserva para corregirlo y se avisa. **Sin hora de fin no se inventa duración** (`MISSING_END_TIME`).

**Rangos compactos de 24 horas (`HHMM-HHMM`):** los calendarios visuales (tipo calendario semanal) imprimen en cada bloque horas sin dos puntos, p. ej. `1900-2030` (19:00–20:30), `1400-1615`, `0800-0930` o `900-1030`. Se aceptan con guion, raya corta o raya larga (también con espacios). Es **conservador**: ambos extremos deben ser horas reales (`2560-2700` y `1965-2030` no lo son), el inicio una hora de clase plausible (desde las 05:00), y la duración entre 15 minutos y 12 horas, de modo que `2019-2024` (años) o `207-215` (aulas) no se toman por horas; un número más largo nunca se parte (`Folio 120045-130045`). Lo que no cumple queda en el texto sin tocar.

**Un rango válido manda:** si el bloque trae un rango válido (compacto o normal), las demás horas sueltas del mismo bloque (p. ej. un `12pm` de la escala del calendario) **no lo reemplazan ni quedan en el título**. Sin ningún rango, una hora suelta sigue siendo el inicio de la clase y el fin queda vacío (no se inventa). Además, una celda que trae su propia hora **no toma prestada** la etiqueta de la fila de la escala: esa etiqueta no se añade a «Texto leído» ni afecta a su confianza.

**La escala del calendario no es una clase:** un texto compuesto por **cuatro o más horas aisladas** (`1pm 2pm 3pm 4pm 5pm pm 7pm E 12pm`, también con los deslices del OCR como `lpm` o `Spm`) y **ninguna palabra** de al menos tres letras se descarta como escala de horas, no como propuesta. Es una heurística estructural, no una lista fija: un título legítimo con números (`Proyecto 2`) tiene palabras y no se ve afectado. Puede fallar con escalas muy deformadas por el OCR; en ese caso aparecerá una tarjeta que el estudiante puede desmarcar. **No se promete reconocimiento perfecto.**

**Formato A — tabla por días:** una línea de cabecera con ≥ 2 días fija las columnas; cada celda se asigna a la columna más cercana. Si hay una columna de horas a la izquierda, cada celda pertenece a la última etiqueta de hora que está a su altura o por encima; con etiquetas de hora única, la clase termina donde empieza la fila siguiente (solo si el salto es coherente con el paso de la tabla) y **la misma asignatura en filas contiguas se une** (08:00 + 09:00 → 08:00–10:00). Sin columna de horas, cada celda trae su propio rango.

**Formato B — lista:** encabezados de día y líneas `08:00 - 10:00 Redes` (el nombre puede ir antes o después, o en la línea siguiente).

**Ruido que no es asignatura:** salones, aulas, laboratorios, profesores, códigos de materia (`MAT101 - Cálculo`) y grupos (`G2`) se descartan. No se importan salón ni profesor (el modelo no tiene `room`).

## Asignaturas

Contra las asignaturas del **periodo actual del usuario** (nunca de otro usuario). Nunca se crea una asignatura.

| Resultado   | Cuándo                                                                                                                                                           | Qué hace la interfaz                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `EXACT`     | mismo nombre sin acentos/mayúsculas, o la etiqueta contiene el nombre completo                                                                                   | se asigna sola                                          |
| `LIKELY`    | la etiqueta es el inicio de **un** nombre («Redes» / «Redes de Computadores») o está a un desliz de OCR (≤ 25 % de distancia de edición, con variantes `rn`→`m`) | «¿Quisiste decir X?»: **nunca se aplica sin confirmar** |
| `AMBIGUOUS` | varios nombres encajan                                                                                                                                           | selector «¿A cuál te refieres?»; no se elige ninguno    |
| `MISSING`   | nada encaja                                                                                                                                                      | selector manual entre las asignaturas existentes        |

## Propuestas

Cada una: `CLASS` (nunca `Activity`), día, hora de inicio y fin, asignatura, título (= nombre de la asignatura, como en el formulario manual), `recurrence WEEKLY` hasta el **fin del periodo**, fecha de la primera ocurrencia (`firstWeekdayOnOrAfter` del inicio del periodo: la misma lógica que el formulario manual), texto leído (`source.rawText`, no se guarda) y avisos. Estado `READY` o `REVIEW`. Máximo 40 propuestas.

Pide revisión (`REVIEW`) si falta o es dudoso: asignatura, día, hora de inicio/fin, rango inválido, o si el OCR leyó con poca confianza las letras del nombre o los números de la hora. La confianza del OCR **no se muestra como número**. La revisión no bloquea por sí sola; **sí se bloquea importar con campos obligatorios vacíos** o con fin ≤ inicio.

## Previsualización y confirmación

`/calendar/import` (botón «Importar horario» en la Agenda; no hay entrada nueva en la navegación). Tarjetas verticales editables: asignatura, día, inicio, fin, título y «se repite hasta». Casilla «Incluir», «Seleccionar todas» / «Deseleccionar todas». Empiezan marcadas solo las propuestas limpias y nuevas.

«Importar seleccionadas» crea las clases **una tras otra** con el mismo servicio de Agenda (`POST /api/schedule`): sin endpoint por lotes ni transacción global. Si 4 de 5 se crean, se muestra «4 clases importadas, 1 necesita corrección» y no se revierten las cuatro. Una clase importada se marca «Importada ✓» y no se puede crear de nuevo; un doble clic no importa dos veces.

## Duplicados y conflictos (conceptos distintos)

- **Duplicado:** misma asignatura, mismo día de la semana, misma hora de inicio y fin y serie semanal ya existente → «Esta clase parece estar ya en tu agenda.» No bloquea; la tarjeta empieza sin marcar.
- **Conflicto:** se solapa con una clase **distinta**. Se calcula con el **mismo servicio de Agenda en `dryRun`** (sin duplicar el detector) → «Conflicto con Redes, lunes 08:00–10:00». Solo avisa. Al editar una tarjeta se recalcula (con una pausa de 400 ms). Un duplicado no se reporta además como conflicto consigo mismo.
- Solo se comparan clases **del propio usuario**.

## Privacidad

- El archivo se procesa **localmente en Academic Planner**: no se envía a terceros ni a servicios de IA.
- **No se guarda** (solo memoria durante la solicitud) ni se construye una biblioteca de horarios.
- Solo se guardan `ScheduleBlock`s, y solo tras confirmar.
- Los registros contienen tipo, tamaño, duración y resultado; **nunca** el texto leído, la imagen ni datos académicos (un test lo comprueba).
- Sin telemetría externa.

## PWA

Requiere conexión con el servidor (no hay OCR sin conexión). Sin conexión, el botón sigue visible pero al procesar explica que hace falta conexión. `/api/schedule-import/*` va por `NetworkOnly` como toda la API; ni el archivo ni la lectura se guardan en Cache Storage (test e2e).

## Rendimiento (esta máquina, solo de referencia)

Medido con fixtures sintéticos: imagen sencilla ≈ 0,5 s (incluye arranque en frío del worker), PDF con texto ≈ 0,3 s, PDF escaneado de una página ≈ 0,3 s (OCR a ~1240 px de ancho). No son un compromiso: depende de la máquina, del tamaño y de la calidad.

## Limitaciones

- El OCR se equivoca: p. ej. en pruebas leyó «12:00» como «17:00» con ciertos tamaños de letra. **Revisa siempre las horas** antes de importar; por eso hay vista previa editable.
- No hace preprocesado de imagen ni corrige la rotación (una imagen girada puede fallar).
- Horarios muy visuales (colores, celdas fusionadas complejas, varias semanas) pueden requerir corrección o no leerse.
- No interpreta salones ni profesores y no crea asignaturas. Un número de aula leído por el OCR (p. ej. `207` de «A207») puede quedar al final del título: se corrige en la vista previa; no hay un campo de aula.
- Solo español; PNG/JPG/PDF; máx. 10 MB y 5 páginas.
- No importa actividades ni tareas (solo clases) y no lee fotos de tareas.
- No hay cola de trabajos: una importación a la vez por usuario y 10 cada 10 minutos por IP (el límite es por proceso).

## Trabajo futuro (no incluido)

Visión por IA, corrección de rotación, importación de salones/profesores, más formatos de horario, cola de trabajos.
