# Roadmap del ciclo post-RC

> **Estado: planificación. Nada de lo descrito aquí está implementado.** Este documento define un nuevo ciclo de producto posterior a `v1.0.0-rc.2`. El código y las pruebas siguen siendo la fuente de verdad de lo que el sistema hace hoy ([project-state.md](project-state.md), [limitations.md](limitations.md)). Cada elemento de este roadmap necesita **aprobación explícita del propietario** antes de implementarse; este documento no autoriza ninguno.

## Contexto

- El roadmap técnico original (Fases 0–20) está **cerrado**. `v1.0.0-rc.1` y `v1.0.0-rc.2` están publicados como pre-releases y son **inmutables** ([notas de rc.2](release-notes-1.0.0-rc.2.md), [rc.1](release-notes-1.0.0-rc.1.md)).
- **No existe una Fase 21.** Lo que sigue es un ciclo de producto distinto, organizado en **etapas** y **PR pequeños**, no en fases numeradas.
- Cada etapa pasa por: análisis, arquitectura, contratos, pruebas, implementación, validación y documentación, y **termina con una compuerta**: al cerrarla se detiene el trabajo y se espera aprobación explícita para la siguiente.
- Antes de explorar el repositorio se usa Graphify para ubicar módulos; después se lee el código. La fuente de verdad sigue siendo código → pruebas → documentos. `graphify-out/` es un artefacto local y no se versiona.

## Visión

> Academic Planner convierte horarios, planes de curso, calendarios y mensajes académicos en un semestre organizado, ayuda al estudiante a decidir qué hacer y le da herramientas para hacerlo.

Principios centrales:

- **Academic Planner no debe pedirle al estudiante que organice la aplicación; la aplicación debe organizar lo que el estudiante ya recibe.**
- **Organizarse no debe convertirse en otra tarea.**

**Regla de producto: cada nueva función debe eliminar más trabajo del que añade.** Si una función exige demasiada configuración manual, se cuestiona antes de implementarla. No se optimiza para «tener más funciones».

Paradigma de toda entrada de datos: **CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR.** Nunca «entrada → persistencia silenciosa».

## Los cuatro pilares

1. **Entrada casi cero.** Aprovechar lo que el estudiante ya recibe: horarios, planes de curso (syllabus), mensajes, calendarios `.ics`, contenido compartido y, eventualmente, LMS o correo.
2. **Alcance real.** Llegar al estudiante fuera de la pantalla principal. Primera estrategia: feed/exportación `.ics`. Resumen diario, push u otros canales solo si se justifican después.
3. **Decidir y hacer.** Pasar de «qué tengo» a «qué me conviene hacer» y luego a «cómo puedo hacerlo»: esfuerzo personal, huecos, bloques de estudio, Attention enriquecido y asistencia con IA.
4. **Contexto universitario.** Lo que las aplicaciones genéricas no entienden: notas, cortes, porcentajes, «cuánto necesito sacar», faltas, syllabus y horarios académicos.

## Orden aprobado

### Preparación

| Paso                | Contenido                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ |
| PR-00               | Este PR: documentación e invariantes del nuevo ciclo (sin código)                          |
| Piloto listo/spikes | Los tres spikes de [más abajo](#spikes-previos) y, para el piloto autónomo, sus requisitos |

### Etapa 0 — Validación / piloto

Descubrir qué problemas importan de verdad antes de construir mucho. Ver [Piloto controlado y autónomo](#piloto-controlado-y-autónomo). No se afirma que la aplicación mejore notas, reduzca estrés, mejore el rendimiento o aumente la retención: el software no lo ha medido.

### Etapa A — Automatización de entrada (apunta a la serie `1.1.x`)

| Id  | Objetivo                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Schedule Import crea las asignaturas faltantes al confirmar (**fusionado**, PR #18)                                                                                                                                                                                                                                     |
| A4  | Integración con calendario externo: **A4.1** «Añadir al calendario» (`.ics` por actividad; implementado en su PR); **A4.2** feed sincronizado (**diferido** hasta tener evidencia)                                                                                                                                      |
| A5  | Web Share Target (compartir texto desde otras aplicaciones hacia la Bandeja o Captura rápida) — **DONE** (PR #57 fusionado; texto/título/URL hacia la Captura rápida; QA funcional manual vía `/share` en desarrollo local; la validación real desde el menú del SO queda para P12; [share-target.md](share-target.md)) |
| P8  | Pixel Companion v1: personaje decorativo del Inicio con una frase neutra (4 estados deterministas, sin backend ni gamificación) — **DONE** (PR #58 fusionado; QA visual manual en escritorio y móvil real, entorno local; [pixel-companion.md](pixel-companion.md))                                                     |
| A2  | Importación de un archivo `.ics` — **DONE** (PR #56 fusionado; QA real funcional en dispositivo, entorno local/LAN HTTP; [ics-import.md](ics-import.md))                                                                                                                                                                |
| A3  | Suscripción por URL a un calendario externo: **diferida** (ver [decisión](#decisión-ics))                                                                                                                                                                                                                               |

### Etapa UX — Base visual y ajustes (orden aprobado en la revisión del roadmap)

Orden vigente tras la revisión: **UX1-lite → UX2a → B1/B2 (notas) → piloto controlado → A2 → asistencia y semana cargada → A6 → …**; lo social (cursos compartidos por invitación) queda condicionado al piloto y a un despliegue con HTTPS.

| Id       | Objetivo                                                                                                                                                                                                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX1-0    | Base visual: tokens de diseño y primitivas `Button`, `Card`, `Badge` (**implementado en su PR**; sin rediseño de pantallas, ver [ux-accessibility.md](ux-accessibility.md#sistema-visual-ux1-0))                                                                                                                                              |
| UX1-1    | Shell y navegación (**implementado y validado en un iPhone real**: barra inferior en teléfono y tableta, superior desde 1024 px, iconos SVG en línea, `PageHeader`; sin rediseñar Home ni campana/avatar)                                                                                                                                     |
| UX1-2    | Home + identidad visual + movimiento (**fusionado, PR #24; aprobado en un iPhone real**; ver [dirección visual](#dirección-visual-para-ux1-2) y [la guía aplicada](ux-accessibility.md#identidad-visual-y-movimiento-ux1-2))                                                                                                                  |
| UX1-2.5  | Pasada de movimiento y personalidad (**fusionada con UX1-2, PR #24**; sin dependencias nuevas; ver [la guía](ux-accessibility.md#movimiento-y-personalidad-ux1-25))                                                                                                                                                                           |
| UX1-2.75 | Experiencia ambiental inteligente, «Pulso Ambiental»: luz ambiental con tono por estado, escritorio en dos columnas, Radar vivo, superficies con sistema (**fusionada con UX1-2, PR #24; aprobada en un iPhone real**, con deuda visual esperada; ver [la guía](ux-accessibility.md#experiencia-ambiental-inteligente-ux1-275))               |
| UX1-3    | Actividades + Asignaturas (**fusionado, PR #25; aprobado en un iPhone real**; ver [UX1-3](#ux1-3-actividades--asignaturas) y [la guía aplicada](ux-accessibility.md#actividades-y-asignaturas-ux1-3))                                                                                                                                         |
| UX1-4    | Formularios y diálogos (Agregar/Editar, `Modal`, `FormField`, recordatorios) con el lenguaje de Pulso Ambiental (**fusionado, PR #26, por orden del mantenedor; el resultado de la QA real en iPhone no está registrado**; ver [la guía](ux-accessibility.md#formularios-y-diálogos-ux1-4)); la Agenda semanal es aparte y va después de UX2a |
| UX2a     | Ajustes mínimos: editar periodo, nombre y contraseña, conservar el destino tras el login (la zona horaria queda fuera hasta definir su efecto)                                                                                                                                                                                                |

#### UX1-3: Actividades + Asignaturas

**Fusionado (PR #25) y aprobado en un iPhone real** (Safari, HTTP en la red local; PWA y HTTPS sin probar): **DONE**. Objetivos que se atendieron (solo presentación, sin tocar lógica): una `ActivityCard` menos administrativa (una acción primaria clara y las secundarias más discretas); filtros más refinados; menos `select` y botones apilados donde sea razonable; `RadarBadge` sin emojis; tarjetas de asignatura más visuales; eliminar la deuda de `slate-*` restante; mantener «Pulso Ambiental» y su movimiento (con `prefers-reduced-motion`); **sin tocar lógica**.

#### F1: Actividades sin asignatura

**Estado:** descubrimiento **DONE**; **F1-0 DONE** (fusionado, PR #27): modelo, migración, API y núcleo ([modelo canónico](activities.md#el-periodo-sí-se-guarda-en-activity-la-asignatura-es-opcional-f1)); **F1-1 DONE** (fusionado, PR #28; QA real en un iPhone con Safari (HTTP en la red local) **aprobada para la fase actual** por el mantenedor: se validaron visualmente y en la interacción principal (Omitir asignatura → Sin asignatura → Elegir asignatura); **no** consta un recorrido funcional exhaustivo (PWA y HTTPS sin probar); [la guía](ux-accessibility.md#actividades-sin-asignatura-f1-1)); **F1-2 DONE (F1 cerrada): F1-2a (creación inline de asignatura), F1-2b (parser, PR #30), F1-2c (confirmación en lote), F1-2d (`CaptureReview` compartida) y los borradores quedaron fusionados en el PR #31 (que absorbió al #29), con QA real funcional aprobado por el mantenedor; también DONE en ese PR: descripción opcional, carrusel de próximas actividades del Inicio y Agenda unificada (actividades + bloques); **F1-2e** (recurrencia semanal → `ScheduleBlock`) fusionada en el PR #32 (merge `a76388d`) con QA real en iPhone aprobada por el mantenedor.** Cada paso necesita aprobación explícita.

**F1-1 — web de las actividades sin asignatura** (**DONE**; el alcance fue): en el formulario de actividad, la acción **«Omitir asignatura»**, el estado **«Sin asignatura»** y la vuelta **«Elegir asignatura»** (no es el valor por defecto; un toque, sin diálogo de confirmación); fallback **«Sin asignatura»** en `ActivityCard` con un tratamiento visual neutro; opción **«Sin asignatura»** en el filtro de asignatura (`subjectId=none`); `ActivitiesPage` deja de bloquear la creación cuando no hay asignaturas; textos de Home, recordatorios y Progreso; pruebas de navegador. No incluyó Captura rápida ni Bandeja.

**F1-2 — captura inteligente y creación inline de asignatura** (rediseño por la QA real en iPhone; el descubrimiento está en la conversación de diseño y las decisiones abajo). Una entrada puede producir **1..N propuestas**, siempre proponer → confirmar antes de persistir, parser determinístico (sin IA como autoridad). División:

| Paso  | Alcance                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1-2a | **Creación inline de asignatura** en el formulario manual de actividad: «Crear asignatura» junto a «Omitir asignatura», un subflujo dentro del diálogo (sin modal anidado ni navegación), que al crear selecciona la nueva y **conserva todo lo escrito**. Solo web, sin backend.                                                                                                                   |
| F1-2b | **Parser `Proposal[]`**: segmentación y desdoblamiento de fechas («martes y jueves» → una propuesta por fecha), anclas nuevas («reunión», «cita», «llevar»…), recurrencia como sugerencia, ambigüedad horaria, nombre sugerido de asignatura, sin asignatura. No persiste nada.                                                                                                                     |
| F1-2c | **Confirmación en lote transaccional** (`POST /api/capture/confirm`, todo o nada, reutiliza `ActivityService.create`), con asignaturas nuevas, sin asignatura, copias exactas, doble envío y la matriz de seguridad. **DONE (fusionada en el PR #31).**                                                                                                                                             |
| F1-2d | **`CaptureReview`**: la interfaz de revisión compartida por Captura rápida y Bandeja (tarjetas editables, excluir, decisión de asignatura, confirmar), pruebas de navegador. **DONE (fusionada en el PR #31):** Captura rápida y Bandeja ya no usan los parsers anteriores. Queda pendiente, sin hacer, el seed demo con 1 o 2 actividades generales («Renovar matrícula», «Reunión de semillero»). |
| F1-2e | **Confirmación de `ScheduleBlock` recurrente** desde la sugerencia, en la misma revisión y la misma confirmación en lote. **DONE: fusionada (PR #32, merge `a76388d`) con QA real en iPhone aprobada por el mantenedor; F1 cerrada** ([D25](decisions.md#d25-recurrencia-semanal-una-confirmación-bloques-por-día-y-rangos-de-horas-leídos-con-horario-de-clases)).                                 |

**Decisiones aprobadas para F1-2:**

1. **Endpoint de lote transaccional: aprobado.** Puede existir una ruta de confirmación propia para Captura rápida y Bandeja si reutiliza las invariantes de `Activity` y `Subject` y no duplica reglas de dominio. (Esto matiza el invariante «sin camino de creación propio» de `CLAUDE.md`: hasta F1-2c no existe.)
2. **Asignatura:** si las palabras **no mencionan** ninguna, la actividad es general (`NONE`) y queda lista, sin preguntar (asignatura omitida en el lenguaje ≠ asignatura sin resolver; un usuario con 0 asignaturas se comporta igual). Si el estudiante **intentó** nombrar una y no se resuelve (no existe, o varias encajan), decisión explícita **Elegir / Crear / Omitir**; nunca se asigna ni se crea en silencio.
3. **Hora sin a. m./p. m.** («a las 6»): **ambigua**, con alternativas; no se inventa 06:00.
4. **Si solo queda el nombre de la asignatura como título:** se usa como título con certeza `LIKELY`.
5. **Recurrencia:** se detecta y se muestra como **sugerencia dentro de `CaptureReview`**; la persistencia del `ScheduleBlock` es F1-2e (implementada: una tarjeta «Horario semanal» en la misma revisión y la misma confirmación; una actividad que se repite solo se explica).
6. **Máximo de 50 propuestas por entrada** (era 10; ampliado en el PR #31 tras medirlo). Nunca se trunca en silencio (si hay más, se avisa).
7. **Atomicidad:** solo participan las propuestas **seleccionadas**. Si una seleccionada es inválida, **ninguna seleccionada se guarda**; las desmarcadas no bloquean el lote.
8. **«Asignatura + varios días + hora» sin tipo de actividad:** se trata como **posible recurrencia**. No se asume ni una actividad múltiple ni un `ScheduleBlock` automáticamente; la interfaz ofrece una decisión explícita cuando la evidencia es ambigua.

Reglas de producto que se mantienen: no inventar fechas ni asignaturas; crear una asignatura no destruye lo ya escrito; «sin asignatura» sigue perteneciendo al periodo actual; no convertir lenguaje ambiguo en recurrencia sin evidencia suficiente; la ambigüedad se muestra para confirmar. La semántica `MISSING` de la importación de horario es otra capa y no se mezcla.

**Deuda de endurecimiento (futura, no iniciada): FK `(periodId, userId) → AcademicPeriod(id, userId)`.** Se decidió **no** añadirla en F1-0 (razonamiento en [activities.md](activities.md#el-periodo-sí-se-guarda-en-activity-la-asignatura-es-opcional-f1)): el cliente no envía `periodId`, el servidor lo deriva y todo repositorio filtra por `userId`; ponerla solo en `Activity` sería incoherente con `Subject` y `ScheduleBlock`. Si se retoma, se aplica a las tres tablas a la vez.

#### Deuda de fiabilidad de pruebas: TEST-REL-1 (resuelta)

**Resolución (PR #47, fusionado):** `MASTER` ya no usa «el jueves»/«el viernes» en el mensaje de la Bandeja sino días relativos (a 4 y 5 días), de modo que nunca compiten con «Taller express» (a 6 horas) a ninguna hora ni día; es un cambio solo de la prueba, sin tocar el producto. Una prueba de regresión comprueba la separación para varias horas de ejecución. Texto original de la deuda:

**Cuándo resolverla:** antes del piloto controlado (o, a más tardar, antes de un release candidate final): hasta entonces cada pasada completa puede dar una falsa alarma en `MASTER` según la hora. La prueba `MASTER` de `e2e/system-validation.spec.ts` depende de la hora: corrida un jueves antes de las 8:00 (Bogotá), el «Quiz» que la Bandeja crea para «el jueves a las 8 a. m.» supera a «Taller express» y la aserción de «¿Qué hago ahora?» falla. Está **reproducida en `d23f8b6`** (previa a UX1-2.5/2.75) y **no está arreglada**: pasa o falla según la hora de ejecución. Es deuda de pruebas (**KNOWN PRE-EXISTING / TEST RELIABILITY DEBT**), no un defecto del producto; se corregirá, si el mantenedor lo aprueba, en una fase propia (fijar el reloj o el fixture), nunca de pasada.

#### Deuda de fiabilidad de pruebas: TEST-REL-2 (resuelta)

Dos pruebas de `e2e/capture.spec.ts` daban falsas alarmas intermitentes; ambas se resolvieron en el PR `test: remove remaining capture e2e flakes`, sin reintentos, esperas arbitrarias, ampliación de tiempos ni aserciones más débiles.

- **N.º 17 («dos cuentas nunca ven borradores ajenos»), 401 tras cerrar sesión.** Causa (con la línea de tiempo de peticiones): la prueba hacía `goto('/activities')` y cerraba la sesión de inmediato, mientras la pantalla (carga diferida) aún arrancaba sus consultas; las consultas que arrancaban con la sesión ya cerrada recibían 401. Además, el `toHaveCount(0)` que sigue al `goto` era cierto de forma vacía en una pantalla sin cargar. Ahora la prueba espera el efecto real (el encabezado de la pantalla y el fin de la carga, como indica la convención del proyecto antes de cerrar sesión) y **esa comprobación de privacidad se hace sobre una pantalla ya cargada**. Medido en `main` limpio: fallaba 2 de 20 repeticiones (7 de 16 en otra pasada); tras el cambio, 20 de 20. El producto no cambia: cerrar sesión durante una carga solo deja 401 inofensivos en una pantalla que ya se abandona.
- **N.º 28 («Tengo 3 actividades para el martes…»), depende del día y la hora.** Causa: era un defecto del **producto**, no solo de la prueba. Un día dicho una vez («para el día martes») se resolvía por separado con la hora propia de cada actividad: un martes a las 10:00, la de las 8:00 pasaba a la semana siguiente y las de las 2:00 p. m. y 7:30 p. m. se quedaban hoy (tres fechas partidas). Ahora la **fecha** del día compartido se resuelve una vez con la hora más temprana del grupo (cada actividad conserva su hora). Regresión en el núcleo con 7 relojes controlados (domingo, lunes, martes antes, entre y después de las horas, miércoles). La prueba de navegador ya no depende de la hora de la pasada.

#### Dirección visual para UX1-2

Entrada del mantenedor tras probar UX1-1 en un iPhone real: la mejora es clara y va en buena dirección, pero **queda mucho margen visual**. Se busca una sensación **moderna, universitaria, suave («smooth») y con personalidad**, con la calidad percibida de las apps y páginas de Apple **como principios, no como copia**: más aire, superficies, menos bordes duros, sombras muy sutiles, radios coherentes, transiciones cortas, respuesta visual al toque, color con intención e identidad propia. Todo respetando `prefers-reduced-motion`.

**Premium no significa más decoración:** mejor jerarquía, menos ruido, menos bordes, color y movimiento con propósito. Sin glassmorphism excesivo, degradados por toda la app, neón, animaciones permanentes, desenfoque pesado ni estética de videojuego.

Problemas observados que UX1-2 y UX1-3 deben atender (UX1-1 no los toca): exceso de blanco plano; paleta aún slate, gris y negra, sin color de acento (`accent` está definido y sin uso); tarjetas rectangulares y con bordes visibles, todavía administrativas; Home largo y apilado, más informativo que visual; filtros de Actividades que parecen controles web; indicadores del Radar básicos; falta de profundidad y de movimiento perceptible; «¿Qué hago ahora?» (el mayor valor funcional) parece una tarjeta más; estado activo de la barra inferior y barra superior mejorables en identidad.

UX1-2 explorará: nueva paleta y acento, hero de Home, jerarquía de superficies, menos bordes, sombras sutiles, movimiento y respuesta al toque, animación del progreso, resumen visual del Radar y compactación de Home.

### P0 — Perfil educativo y onboarding (discovery aprobado; diseño en la conversación del 12 de octubre de 2026)

Objetivo: conocer al usuario desde el registro, de forma **corta, opcional, progresiva y editable** (30–90 s, siempre «Omitir por ahora»), para personalizar después materias, horario, notas, cortes, promedio, Radar e importaciones. Reparto aprobado en PR pequeños:

| PR     | Contenido                                                                                                                                                                                                                                                                             | Estado                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P0-PRE | Quitar un byte NUL accidental de `academic.ts`                                                                                                                                                                                                                                        | **hecho** (fusionado con P0-1, PR #34)                                                                   |
| P0-1   | `UserProfile` 1:1 (`primaryUse`, `programName`, `programKey`, `onboardingStatus`), catálogo pequeño, `GET`/`PATCH /api/profile`, [D26](decisions.md#d26-perfil-educativo-separado-del-usuario)                                                                                        | **DONE: fusionado (PR #34, merge `c55e190`); sin interfaz**                                              |
| P0-2   | Nivel de estudio en el periodo (`AcademicPeriod.studyLevel` / `studyLevelNote`), [D27](decisions.md#d27-el-nivel-de-estudio-vive-en-el-periodo-académico)                                                                                                                             | **DONE: fusionado (PR #35, merge `afefdf7`); sin interfaz**                                              |
| P0-3   | `Subject.educationContext` y `POST /api/subjects/batch`, [D28](decisions.md#d28-el-contexto-educativo-de-una-asignatura)                                                                                                                                                              | **DONE: fusionado (PR #36, merge `585b284`); sin interfaz**                                              |
| P0-4a  | Asistente web (primera parte): registro → `/onboarding`, pregunta «¿Para qué quieres usar Academic Planner?» y periodo actual ([D29](decisions.md#d29-onboarding-p0-4a-una-pregunta-por-pantalla-derivado-del-servidor))                                                              | **DONE: fusionado (PR #37, merge `c94237b`)**                                                            |
| P0-4b  | Onboarding completo: programa/carrera, semestre o grado, materias rápidas (lote), pantalla final con «Importar mi horario» / «Ir al Inicio», aviso «Completa tu perfil» y demo ([D30](decisions.md#d30-onboarding-completo-pasos-opcionales-derivados-y-completed-significa-terminé)) | **DONE: fusionado (PR #38); QA real en iPhone aprobada por el mantenedor (red local, no QA de release)** |

**P0 DONE** (P0-PRE y P0-1…P0-4b fusionados). Cada paso nuevo necesita aprobación explícita.

#### P0.5 — Base multi-estudio

**P0.5 DONE** (P0.5-1 … P0.5-5, PR #39–#43). El bloque de producto siguiente, notas / cortes / evaluaciones, se aprobó y avanza como B1/B2 (DONE, ver más abajo); lo demás de notas no se inicia sin aprobación explícita.

Una persona puede estudiar varias cosas a la vez (Medicina + un diplomado, colegio + técnico…). `primaryUse` **no** se convierte en lista: la entidad es `StudyTrack` ([D31](decisions.md#d31-studytrack-una-formación-que-el-usuario-cursa-p05-1)). El _discovery_ recomendó hacerlo **antes de Notas** (la escala, la nota mínima y el promedio pertenecen a un estudio). Orden propuesto, un PR cada uno y **cada uno con aprobación explícita**:

| PR     | Contenido                                                                                                                                                                                | Estado                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P0.5-1 | Fundación invisible: `StudyTrack` (tabla, núcleo, API, seguridad, migración sin respaldo), sin enlazar nada                                                                              | **DONE: fusionado (PR #39, merge `de6af89`)**                   |
| P0.5-2 | Vincular periodos (`AcademicPeriod.studyTrackId?`, un periodo actual **por estudio**), periodo «hogar», regla del `materializer`                                                         | **DONE: fusionado (PR #40, merge `51d2bec`)**                   |
| P0.5-3 | Lectura multi-periodo (Inicio, Radar, Atención, Progreso, Carga, recordatorios, lista de Actividades), etiqueta de origen en la Agenda y Actividades                                     | **DONE: fusionado (PR #41, merge `8df3e26`)**                   |
| P0.5-4 | «Mis estudios»: listar, agregar (alta atómica), convertir la planificación actual (adopción explícita), editar, principal, archivar, restaurar, periodos; materias con periodo explícito | **DONE (PR #42; QA real en iPhone aprobada por el mantenedor)** |
| P0.5-5 | Onboarding → estudio: completar crea el estudio principal y adopta el periodo; el estudio pasa a ser la autoridad (el programa del perfil queda como metadato heredado)                  | **DONE (PR #43; QA real en iPhone aprobada por el mantenedor)** |

### Etapa B — Contexto universitario (`1.2.x`)

| Id    | Objetivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1/B2 | Notas por cortes/evaluaciones y «¿cuánto necesito sacar?» (aritmética pura). **Diseño aprobado ([D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones)), validado con 3 sistemas reales documentados (GO provisional); validación UX humana pendiente. B1 (base: datos, API, aritmética; sin pantallas) DONE y fusionada (PR #44, `a2c51fd`); B2 (interfaz de notas por materia, cortes por materia) DONE (PR #45 fusionado; QA real en iPhone aprobada por el mantenedor en entorno local, sin incidencias reportadas). B3 (Captura inteligente de notas) **DONE** (PR #46 fusionado; QA real funcional en dispositivo aprobada por el mantenedor (entorno local/de desarrollo por red local, HTTP; **no** es QA de release ni valida HTTPS, la PWA instalada ni producción; sin validación con estudiantes)). Radar y Progreso con notas: **DONE** (PR #55 fusionado; contexto informativo, el Radar no se ordena por peso; QA real funcional en dispositivo aprobada por el mantenedor (entorno local/de desarrollo por red local, HTTP; no valida HTTPS, la PWA instalada, producción ni a estudiantes)). Siguen pendientes, sin aprobación: copiar del periodo anterior y notificaciones de notas; validación UX con estudiantes pendiente** |
| A6    | Importación de syllabus (**después** del modelo de notas)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| B4    | Faltas / asistencia (solo excepciones)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B5    | Semana cargada, con hechos y sin juicios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Etapa C — Planificación personal (`1.3.x`)

| Id  | Objetivo                                                                      |
| --- | ----------------------------------------------------------------------------- |
| C1  | Esfuerzo real: «¿cuánto te tomó?», opcional                                   |
| C2  | Mediana personal por tipo de actividad                                        |
| C4  | Huecos disponibles en la agenda                                               |
| C5  | Bloques de estudio propuestos (el estudiante confirma)                        |
| C6  | Factibilidad de la semana («semana realista»)                                 |
| C3  | Attention enriquecido (como anotaciones, ver [decisión](#decisión-attention)) |

### Etapa D — Asistente académico con IA (`1.4.x`)

| Id  | Objetivo                                                                        |
| --- | ------------------------------------------------------------------------------- |
| D0  | Infraestructura de IA: interfaz de proveedor, consentimiento, límites, registro |
| D1  | «Prepararme»: explicar, plan de estudio, dentro de una actividad                |
| D2  | Quiz con retroalimentación                                                      |
| D4  | Material de estudio del estudiante (`StudyResource`)                            |
| D5  | Respuestas ancladas al material, con cita de archivo y página                   |

### Etapa E — Colaboración (solo con tracción)

Cursos compartidos **solo si hay evidencia de uso**. Compartido: fechas oficiales, evaluaciones, porcentajes, horario general. Privado: notas, recordatorios, estado, bloques de estudio y estimaciones. Requiere roles, propuestas, moderación e historial: por eso es una etapa posterior. No se construye ni se anticipa en el modelo de datos.

### Prerrequisitos técnicos identificados

Surgieron del análisis del código y se decidirán al iniciar la etapa correspondiente; no forman parte del orden aprobado:

- No hay pantalla para editar el periodo (el `PATCH` de la API ya existe): importar horarios, syllabus y calendarios depende de las fechas del periodo.
- `RequireAuth` redirige a `/login` sin conservar el destino: A5 lo necesita para no perder el texto compartido si la sesión expiró.

## Decisiones clave

El detalle y el motivo de cada una están en [decisions.md](decisions.md) (D15–D22).

### Flujo de A1 (fusionado en el PR #18)

Antes de A1 el Schedule Import no creaba asignaturas: solo asignaba una clase a una asignatura existente (coincidencia exacta) y cada clase confirmada se creaba con su propio `POST /api/schedule`. El flujo implementado es:

```
Horario → interpretación → asignaturas detectadas → asignaturas faltantes propuestas
→ vista previa → confirmación → creación de Subject → creación de ScheduleBlock
```

Usa una confirmación **en lote y transaccional** (`POST /api/schedule-import/confirm`): crea las asignaturas y los bloques en una sola transacción, con las mismas reglas de los servicios existentes. Detalle y decisiones: [schedule-import.md](schedule-import.md), D16 en [decisions.md](decisions.md).

### Syllabus después del modelo de notas

El syllabus puede detectar porcentajes, pero hoy **no existe** una estructura donde persistirlos. Por eso: B1/B2 primero, A6 después.

### Decisión: ICS

- **Actualización (A4-0b, A4.1):** la comparación con los RFC ([normative-validation.md](spikes/a4-calendar-feed/normative-validation.md)) concluyó que el feed **aún no está justificado** frente a «Añadir al calendario»: depende por completo del refresco del cliente (horas, sin control del estudiante), exige token, ruta pública y migración, y nadie ha pedido que se actualice solo. Por eso A4 se divide: **A4.1 «Añadir al calendario»** (un `.ics` por actividad, con sesión, sin token ni migración; [calendar-export.md](calendar-export.md)) y **A4.2 feed sincronizado, diferido** hasta que estudiantes reales lo pidan y clientes reales muestren un refresco aceptable. A4.2 reutilizaría el serializador de A4.1.
- **Feed `.ics` (A4.2, diferido):** entregaría alcance sin scheduler, sin riesgo SSRF y sin guardar credenciales de un LMS. Token de alta entropía (solo se guardaría su hash), revocable y regenerable; quien tenga la URL puede leer el calendario, y así se avisa al usuario.
- **Importación manual de archivo `.ics` después:** estructura información sin conexión externa.
- **Suscripción por URL diferida:** riesgos de SSRF, tokens de LMS dentro de las URL, redirects, DNS rebinding y necesidad de cifrado en reposo. **No se implementa A3 ahora.**
- **Notificaciones:** el feed _permite integrar eventos con calendarios externos; el comportamiento de las notificaciones depende del cliente._ No se promete que el feed garantice notificaciones. Google Calendar, Apple Calendar y Outlook deben validarse con un spike real antes de prometer comportamiento alguno (refresco, alarmas, experiencia móvil).

### Decisión: asistencia

Registrar **solo excepciones** (`ABSENT`, `CANCELLED`) sobre las ocurrencias que ya expande la agenda; no se obliga a marcar «asistí» en cada clase. El límite de faltas es configurable por asignatura: no se asume ningún porcentaje universal. Lenguaje matemático, no disciplinario.

### Decisión: Attention

**No se repondera el puntaje actual** con esfuerzo. Cuando llegue la Etapa C, el esfuerzo estimado y el tiempo disponible entran primero como anotaciones, indicador de riesgo y desempate **dentro del mismo tier**, para no romper la propiedad vigente del puntaje (un tier más urgente siempre gana) sin evidencia.

### Decisión: IA

**IA asistiva, no autoridad del sistema.** Puede explicar, resumir, generar preguntas, dar retroalimentación y proponer planes. **No** modifica en silencio fechas, notas, porcentajes, estado, agenda, recordatorios ni la persistencia: lo crítico lo calcula y guarda el código determinista tras la confirmación del estudiante.

- **IA opcional:** el sistema completo debe funcionar sin proveedor. Con `AI_PROVIDER` sin definir, la IA queda desactivada. (Solo se documenta: no hay variables ni código todavía.)
- Las claves viven solo en el backend; el frontend nunca habla con el proveedor. Consentimiento explícito y minimización de datos; el material subido se trata como datos, no como instrucciones; las salidas estructuradas se validan con esquemas; límites de uso y coste.

### Decisión: RAG

Si algún día se implementa: **primero búsqueda de texto completo de PostgreSQL**, sin `pgvector`. Solo se evaluarán vectores si datos reales demuestran un recall insuficiente.

### Decisión: privacidad

Antes de un piloto con datos reales harán falta **aviso, autorización y revisión independiente**. Existirá un documento de privacidad cuando haya contenido revisado; **no se redacta una política legal ficticia** y no se afirma cumplimiento de ninguna norma (p. ej. Ley 1581): requiere revisión independiente. La IA cambia la premisa actual de «todo se procesa localmente» (D4, D8): cada etapa debe actualizar esa documentación.

## Piloto controlado y autónomo

**Piloto controlado.** Puede hacerse con acompañamiento manual (el equipo presente o remoto, datos cargados y observados en vivo). No requiere todavía telemetría completa. Permite observar el onboarding, registrar fricción, recopilar fixtures anonimizados y entrevistar.

**Piloto autónomo** (los estudiantes usan la aplicación por su cuenta durante semanas). Requiere:

- despliegue con HTTPS (también necesario para instalar la PWA, la cookie `__Host-` y el Share Target);
- restablecimiento de contraseña (en un piloto cerrado puede ser una operación del administrador);
- medición mínima (cómo se creó cada actividad, retención por día) sin guardar contenido;
- privacidad (aviso, autorización, revisión independiente).

Métricas a observar (sin afirmar que ya se cumplen): tiempo de registro a «mi semestre está organizado» (meta deseable: menos de 10 minutos), porcentaje de actividades por método de captura (manual, Captura rápida, Bandeja, importación de horario, futuros syllabus y `.ics`), retención en los días 1, 3, 7 y 14, y fallos reales (horarios, syllabus, frases y formatos que fallan, convertidos en fixtures anonimizados). Entrevistas: qué dio pereza, qué se ingresó a mano, qué se usaba antes, qué función se usó o se ignoró, qué hizo volver o abandonar, qué información debería aparecer sola.

## Spikes previos

Tres investigaciones de bajo costo, antes de construir producto:

1. **Calendarios.** Google Calendar, Apple Calendar y Outlook: importación y suscripción, latencia de refresco, `VALARM` y experiencia móvil. Protocolo, fixtures y estado (A4-0 y A4-0b; Apple Calendar en iPhone probado con QA real; Google, Outlook y Android sin probar): [docs/spikes/a4-calendar-feed](spikes/a4-calendar-feed/README.md). Lo implementado (A4.1): [calendar-export.md](calendar-export.md).
2. **Datos reales.** Recolectar, anonimizados, ~10 horarios, ~10 syllabus y ~5 archivos `.ics` como línea base. **No se agregan al repositorio sin anonimización explícita.**
3. **Notas.** El modelo se validó contra 3 sistemas reales documentados ([grades-validation.md](grades-validation.md); GO provisional). **Sigue pendiente**, antes de cerrar la UX: probar «¿cuánto necesito sacar?» con 3 estudiantes (lenguaje, formato de entrada, aviso de redondeo).

## Cálculo de notas: ejemplo aprobado

La aritmética es determinista (nunca IA). Farmacología: corte 1 = 30 % con 3.4, corte 2 = 30 % con 2.8, corte 3 = 40 % pendiente.

- Acumulado: 0.30 × 3.4 + 0.30 × 2.8 = 1.86.
- **Objetivo 3.0:** (3.0 − 1.86) / 0.40 = **2.85** necesario en el corte restante.
- **Objetivo 4.5:** (4.5 − 1.86) / 0.40 = **6.6**, **imposible** si la escala máxima es 5.0.

**Decisión ([D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones)):** el redondeo es solo de presentación y nunca afecta la comparación con la nota aprobatoria; «necesito» se muestra redondeado hacia arriba. **Redondeo:** las instituciones lo aplican distinto (hallazgo de la validación proxy); la comparación exacta es un límite conocido. La escala sale de la configuración, no del código; los ejemplos con 0.0–5.0 son ilustrativos y no se documentan como universales.

## Modelo de datos futuro

**PROPOSED — NOT IMPLEMENTED.** Propuesta para discutir al iniciar cada etapa; no hay migraciones ni cambios en el schema de Prisma. Los nombres y la forma final se deciden tras revisar el modelo vigente ([data-model.md](data-model.md)).

| Entidad o campo                                    | Etapa | Propósito propuesto                                                                                                                                                                         |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Activity.createdVia`                              | 0     | Método de captura de cada actividad (sin contenido)                                                                                                                                         |
| `UserActivityDay`                                  | 0     | Días con actividad por usuario, para retención                                                                                                                                              |
| `CalendarFeed`                                     | A     | Token del feed (solo su hash), creación y revocación                                                                                                                                        |
| `Activity.externalUid`                             | A     | Evitar duplicados al reimportar un `.ics`                                                                                                                                                   |
| `GradingComponent`                                 | B     | **Reemplazado por [D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones):** `GradingProfile`, `GradingPeriod` y `Evaluation` (diseño aprobado, no implementado) |
| `AcademicPeriod.gradeMin`, `gradeMax`, `gradePass` | B     | **Reemplazado por [D36](decisions.md#d36-modelo-de-calificaciones-por-periodo-cortes-y-evaluaciones):** la escala vive en `GradingProfile` (1:1 con el periodo), en milésimas               |
| `Subject.absenceLimitPercent`                      | B     | Límite de faltas configurable                                                                                                                                                               |
| `OccurrenceMark`                                   | B     | Excepciones (`ABSENT`, `CANCELLED`) por clase y fecha                                                                                                                                       |
| `Activity.actualMinutes`                           | C     | Tiempo real que tomó una actividad                                                                                                                                                          |
| `Activity.estimatedMinutes`                        | C     | Estimación manual opcional (decisión pendiente, ver riesgos de arranque)                                                                                                                    |
| `User.dayStart`, `User.dayEnd`                     | C     | Ventana diaria para calcular huecos                                                                                                                                                         |
| `ScheduleBlock.activityId`                         | C     | Vincular un bloque de estudio con su actividad                                                                                                                                              |
| `AiConsent`, `AiUsage`                             | D     | Consentimiento y uso (latencia, tokens), sin contenido                                                                                                                                      |
| `StudyResource`, `ResourceChunk`                   | D     | Material del estudiante y sus fragmentos para búsqueda                                                                                                                                      |

## Seguridad y privacidad por integración

No se relaja ningún control vigente (CSRF, esquemas estrictos, propiedad con el mismo 404, `no-store`, CSP, sesiones seguras, `NetworkOnly` del service worker, límites de subida). Cada integración suma riesgos que se evalúan en su etapa: SSRF para URL de calendario, privacidad, coste e inyección de prompt para IA, agotamiento de recursos en subidas, autorización en cursos compartidos y token no adivinable en el feed. Antes de un despliegue público abierto: política de privacidad, consentimiento, retención, eliminación de cuenta, aviso del procesamiento con IA y recuperación de contraseña.

## Versionado

`v1.0.0-rc.1` y `v1.0.0-rc.2` no se modifican ni se mueven. Propuesta indicativa (**decide el mantenedor en cada caso**): serie `1.1.x` para la Etapa A, `1.2.x` para la B, `1.3.x` para la C y `1.4.x` para la D, con candidatos previos. Un tag solo se crea tras fusionar y validar `main`. PR-00 no cambia ninguna versión.

## Qué no construir todavía

Suscripción por URL (A3), push, resumen diario por correo o SMS, `pgvector`, DOCX, voz, streaming, cursos compartidos, predicciones de notas o «porcentaje de preparación», integraciones por API con un LMS, lectura de correo, un chat de IA genérico, cronómetros, aprendizaje de hábitos más allá de la mediana y gamificación.

## Riesgos de alcance

Tratar este roadmap como un plan único (cada etapa tiene su compuerta y se detiene); añadir «un campo más» sin pasar la regla de producto; ampliar parsers sin fixtures reales; reponderar Attention por impulso; usar IA para tapar lo que un parser no resuelve (entraría detrás del mismo contrato de propuesta, no en su lugar); infraestructura prematura (scheduler, correo, vectores); y bajar la guardia en seguridad por velocidad.
