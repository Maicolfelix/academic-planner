# Registro de decisiones

Decisiones de diseño que condicionan el resto del sistema, con su motivo y lo que se aceptó a cambio. No es un ADR formal por cada cosa: solo lo que un desarrollador nuevo o un evaluador preguntaría. El análisis original (Fase 0) se conserva como documento histórico en [ARCHITECTURE_PLAN_v1.md](../ARCHITECTURE_PLAN_v1.md); donde difiere, **manda el código** y este registro.

## D1. PostgreSQL

- **Decisión:** PostgreSQL 17, ejecutado con Docker Compose (puerto host 5433), con Prisma como acceso.
- **Por qué:** el dominio es relacional (usuario → periodo → asignatura → actividad → recordatorio) y necesita **invariantes en la base de datos**, no solo en la aplicación: índices únicos parciales («un periodo actual por usuario», «un AUTO por offset») y `CHECK` (`COMPLETED` ⇔ `completedAt`, `endAt > startAt`). Docker hace el entorno reproducible en cualquier máquina.
- **A cambio:** hace falta Docker (o un PostgreSQL propio) para desarrollar y para las pruebas de API, que usan una base real y no simulacros.

## D2. Sesiones en base de datos, no JWT

- **Decisión:** el navegador recibe una cookie `HttpOnly` con un token aleatorio de 256 bits; la base guarda solo su SHA-256 y la fecha de expiración.
- **Por qué:** se puede **revocar** una sesión de inmediato (cerrar sesión, iniciar sesión de nuevo, tope de 20 por usuario), no hay token legible por JavaScript y no hay secretos de firma que rotar. Un JWT no se puede invalidar sin una lista aparte, que sería otra tabla de sesiones.
- **A cambio:** una consulta por petición autenticada, y una duración fija de 7 días (sin renovación ni cierre por inactividad; ver [limitations.md](limitations.md)).

## D3. La zona horaria del usuario es la autoridad

- **Decisión:** los instantes se guardan en UTC y `User.timezone` (por defecto `America/Bogota`) decide qué es «hoy», qué semana es y en qué día vence una actividad sin hora. Toda esa lógica vive en `packages/core/src/time.ts` y `calendar.ts`; la interfaz nunca hace matemática de zonas.
- **Por qué:** un estudiante en una zona y un navegador en otra deben ver el mismo día; las pruebas con el navegador en `Asia/Tokyo` y perfil Bogotá lo comprueban. Las clases semanales repiten la hora de pared cada 7 días de calendario, no cada 168 horas.
- **A cambio:** hoy no hay pantalla para cambiar la zona del perfil.

## D4. Sin IA generativa

- **Decisión:** Captura rápida, Bandeja académica e Importación de horario usan **reglas determinísticas** (diccionarios, expresiones regulares, reglas de fechas) y OCR clásico; ningún modelo de lenguaje.
- **Por qué:** _determinismo_ (la misma entrada da siempre la misma propuesta y se puede probar con fechas fijas), _privacidad_ (el texto y los archivos del estudiante no salen del servidor de la aplicación), _reproducibilidad_ (la demostración y las pruebas no dependen de un servicio externo ni de su coste), _interpretabilidad_ (cada campo trae su certeza —`EXACT`, `LIKELY`, `AMBIGUOUS`, `MISSING`— y cada recomendación sus razones) y _control del alcance_.
- **A cambio:** solo entiende fraseos que las reglas prevén (español) y el OCR puede equivocarse; por eso siempre hay revisión humana ([limitations.md](limitations.md)).
- **Ciclo post-RC:** la Etapa D contempla una IA asistiva opcional ([D21](#d21-ia-asistiva-opcional-y-no-autoritativa)); esta decisión describe el RC y no cambia hasta que se apruebe e implemente.

## D5. Proponer antes de guardar (Capturar → Interpretar → Confirmar)

- **Decisión:** los tres flujos de interpretación **solo proponen**; confirmar llama a los endpoints normales (`POST /api/activities`, `POST /api/schedule`). No existe un camino de creación propio, no se guarda el texto ni el archivo, y nunca se crea una asignatura sin que exista.
- **Por qué:** una interpretación equivocada guardada en silencio es peor que una pregunta; y reutilizar los endpoints normales significa que recordatorios, Radar y validaciones se comportan igual que en la creación manual.
- **Ciclo post-RC:** la invariante se precisa como «proponer, confirmar y crear únicamente después de confirmación explícita» ([D16](#d16-confirmación-en-lote-en-la-importación-de-horario-y-enmienda-de-d5)). Lo descrito arriba sigue siendo el comportamiento real del código.

## D6. PWA con offline limitado

- **Decisión:** el service worker precachea solo el shell estático; **toda** petición a `/api/*` va por red (`NetworkOnly`). No hay escrituras offline, colas, sincronización en segundo plano ni Web Push. La actualización pregunta y nunca recarga sola.
- **Por qué:** guardar respuestas privadas en la caché del navegador es un riesgo (otra persona con el mismo equipo), y el offline completo exige resolución de conflictos que está fuera del alcance. Se prefiere decir «sin conexión» a fingir éxito.

## D7. No persistir datos derivados

- **Decisión:** «vencida», categoría del Radar, puntaje de Atención, progreso y carga semanal se calculan al leer, con un reloj inyectable.
- **Por qué:** no caducan, no hace falta ningún trabajo programado y no pueden contradecir a los datos de los que salen. Las reglas son funciones puras fáciles de probar.
- **A cambio:** más cálculo por lectura (medido: milisegundos con 500 actividades; ver [testing.md](testing.md#pruebas-de-humo-de-rendimiento)).

## D8. OCR local

- **Decisión:** `tesseract.js` (modelo español incluido en `@tesseract.js-data/spa`) y `unpdf` corren en el servidor; no se llama a ninguna API de visión. Un PDF con texto se lee primero de forma nativa; solo las imágenes y los PDF escaneados pasan por OCR.
- **Por qué:** privacidad (un horario puede identificar a la persona) y coste cero. El archivo vive solo en memoria durante la solicitud.

## D9. Límites de frecuencia en memoria (instancia única)

- **Decisión:** `express-rate-limit` con almacén en memoria, por IP.
- **Por qué:** es suficiente para una sola instancia y no añade infraestructura (Redis).
- **A cambio (limitación aceptada):** los contadores son por proceso y se reinician con el servidor; con varias instancias haría falta un almacén compartido ([deployment.md](deployment.md)).

## D10. Reglas puras compartidas en `packages/core`

- **Decisión:** las reglas de dominio y los esquemas Zod viven en un paquete sin dependencias de servidor ni de interfaz, usado por ambos lados.
- **Por qué:** una sola definición de cada regla (Radar, «hoy», progreso, parsers) y validación idéntica en cliente y servidor. En el navegador Zod corre en modo `jitless` porque la CSP prohíbe `new Function`.

## D11. Recurrencia propia y simple

- **Decisión:** una clase semanal es una fila con `recurrenceType = WEEKLY` y `recurrenceUntil`; las ocurrencias se expanden al leer, solo para el rango pedido. No se usa RRULE.
- **Por qué:** el caso de uso es «cada semana hasta fin de periodo»; RRULE añadiría dependencias y casos (excepciones, posiciones) que no se van a usar.

## D12. Propiedad: el mismo 404 y esquemas estrictos

- **Decisión:** un recurso de otro usuario responde exactamente como uno inexistente; los cuerpos son `strictObject` y el dueño sale siempre de la sesión.
- **Por qué:** una respuesta distinta confirmaría que el recurso existe (enumeración). Una matriz de pruebas recorre todo recurso con id y comprueba que la base no cambia.

## D13. Seed demo como infraestructura, con dos candados

- **Decisión:** `npm run db:seed:demo -- --allow-demo`; rechaza si `NODE_ENV=production` aunque lleve el flag, y sin el flag. Usa los servicios reales y solo toca al usuario demo.
- **Por qué:** la demostración debe poder repetirse sin riesgo; un flag de línea de comandos funciona igual en cmd, PowerShell y bash y no puede quedar activado por olvido en un `.env`. Ver [demo.md](demo.md).

## D14. Monorepo con npm workspaces

- **Decisión:** `apps/api`, `apps/web`, `packages/core`, `e2e` en un solo repositorio.
- **Por qué:** `core` se comparte sin publicarlo, un solo `npm ci` y un solo conjunto de comprobaciones (lint, formato, tipos, pruebas) para todo.

## Decisiones del ciclo post-RC (planificación)

D15–D22 pertenecen al ciclo de producto posterior a `v1.0.0-rc.2` ([roadmap-post-rc.md](roadmap-post-rc.md)). **Son decisiones de diseño aprobadas para planificar; ninguna está implementada.** Mientras no lo estén, manda el código y D1–D14 describen el sistema real. Todo trabajo de código requiere aprobación explícita del propietario.

## D15. Reabrir el alcance con un ciclo post-RC por etapas

- **Decisión:** el roadmap original (Fases 0–20) queda cerrado y no se crea una Fase 21. El trabajo nuevo se organiza en etapas (0 y A–E) y PR pequeños, cada etapa con una compuerta de aprobación. Regla de producto: _cada función debe eliminar más trabajo del que añade_.
- **Por qué:** el RC es técnicamente sólido pero exige demasiado trabajo manual al estudiante y solo lo alcanza si abre la aplicación. Reabrir el alcance de forma explícita evita avanzar por iniciativa propia y evita que «más funciones» sustituya a «menos trabajo».
- **A cambio:** más documentación de gobierno y ninguna función nueva hasta que cada etapa se apruebe. `v1.0.0-rc.1` y `v1.0.0-rc.2` siguen inmutables.

## D16. Confirmación en lote en la importación de horario (y enmienda de D5)

- **Decisión:** la invariante «proponer, no crear» pasa a **«proponer, confirmar y crear únicamente después de confirmación explícita»**. **A1 (fusionado, PR #18):** la importación de horario propone también las asignaturas faltantes y, al confirmar, crea asignaturas y clases en **una sola transacción** (`POST /api/schedule-import/confirm`). Esto reemplaza el comportamiento anterior (un `POST /api/schedule` por clase, con éxito parcial y sin crear asignaturas).
- **Todo o nada** (decisión de A1): si alguna clase se rechaza no se guarda nada y se responden todas las rechazadas con su `clientId`. Se descartó conservar el éxito parcial porque deja asignaturas sin clase y un horario a medias que el estudiante no sabe cómo completar; no se encontró una razón técnica (los servicios no abren transacciones propias y sus repositorios aceptan el cliente de la transacción) ni de producto que lo exija.
- **Frontera de la transacción:** bloqueo asesor por usuario → periodo actual → asignaturas (`INSERT … ON CONFLICT DO NOTHING` sobre `(periodId, nameKey)`) → clases con el **mismo** `ScheduleService`, sin reescribir sus reglas. Un duplicado (clase igual ya en la agenda o repetida en el lote) se rechaza con 409: es un cambio de comportamiento respecto al formulario, que solo avisaba.
- **Carreras:** el bloqueo serializa las confirmaciones de un usuario (un doble envío no duplica clases, que no tienen restricción única); `ON CONFLICT DO NOTHING` protege frente a una asignatura creada por otra ruta sin ese bloqueo. Probado con solicitudes simultáneas reales y con mutaciones (sin bloqueo y con `INSERT` simple las pruebas fallan).
- **Duplicado = misma clase en las mismas fechas:** se rechaza (409) una clase con la misma asignatura, día y horas que una serie existente **cuyas fechas se cruzan**; un solape parcial sigue siendo solo aviso y dos series de la misma clase en fechas disjuntas conviven. Se acotó tras la revisión crítica de A1 (la primera versión ignoraba las fechas y podía bloquear una serie legítima).
- **Espera acotada:** el bloqueo por usuario se espera como máximo 10 s (`429 IMPORT_IN_PROGRESS`) y la transacción admite 30 s: sin ello una confirmación en cola retiene una conexión del pool y el límite por defecto de Prisma (5 s) fallaría con 40 clases sobre una base remota.
- **Color:** una asignatura creada por la importación toma el primer color de la paleta existente que el periodo no use (helper de ~8 líneas; el alta normal no cambia). Decisión revertible a `DEFAULT_SUBJECT_COLOR` borrando ese helper.
- **Criterio para futuras heurísticas de nombres:** no se añade ninguna regla nueva de limpieza (modalidad como `REMOTO`/`VIRTUAL`/`PRESENCIAL`, aulas, texto repetido, otros códigos) sin **fixtures reales anonimizados** que la justifiquen; la regla del código inicial se apoya en una sola muestra y por eso es mínima. Fuera de eso, el nombre propuesto se deja editable.
- **Identidades que la limpieza podría fusionar:** quitar el código institucional del inicio de un nombre puede igualar nombres de clases con códigos distintos. Se conserva el código quitado como evidencia de revisión (`sourcePrefix`, sin persistirlo ni migración); la vista previa pide una decisión explícita («misma asignatura» o cambiar el nombre) y el servidor rechaza el lote que declara códigos contradictorios sin `mergeConfirmed`. Límite aceptado: sin el texto del OCR el servidor no puede exigir que el cliente declare los códigos, y un cliente manipulado puede omitir `sourcePrefix`. **No es un problema de autorización ni de aislamiento**: el estudiante solo puede afectar la interpretación de sus propios datos y el servidor no pretende conservar el OCR como fuente de autoridad.
- **Por qué:** obligar a crear las asignaturas a mano antes de importar es justo el trabajo que la importación debería quitar. Crear asignaturas y bloques por separado dejaría estados a medias si algo falla; la transacción lo evita.
- **A cambio:** un endpoint de creación con regla propia (más superficie: entra en las matrices de origen y de propiedad) que debe reutilizar las reglas de los servicios existentes y resistir el doble envío. Sigue sin guardarse el texto ni el archivo.

## D17. Feed `.ics` antes que suscripciones remotas

- **Decisión:** primero un feed/exportación `.ics` personal; después la importación manual de un archivo `.ics`; la suscripción por URL queda **diferida**. El feed se protegería con un token de alta entropía (en la base de datos, solo su hash), revocable y regenerable; quien tenga la URL puede leer el calendario.
- **Por qué:** el feed da alcance sin planificador de tareas, sin riesgo SSRF y sin custodiar credenciales de un LMS. La suscripción por URL abre SSRF, redirects, DNS rebinding y URL de LMS que contienen un token propio (exigiría cifrado en reposo, que hoy no existe).
- **Lenguaje:** el feed _permite integrar eventos con calendarios externos; el comportamiento de las notificaciones depende del cliente_. No se promete que garantice notificaciones; Google, Apple y Outlook se validan con un spike real antes de afirmar nada.
- **Relación con D11:** no se introduce RRULE como modelo de recurrencia; una propuesta a evaluar es que el feed emita las ocurrencias ya expandidas.

## D18. Modelo de notas antes de la importación de syllabus

- **Decisión:** B1/B2 (notas por cortes y «¿cuánto necesito sacar?») se implementan **antes** que A6 (syllabus).
- **Por qué:** un syllabus puede revelar porcentajes, pero hoy no existe dónde guardarlos; importarlo antes descartaría su dato más valioso o forzaría un parche. Además el cálculo es aritmética determinista, barata y sin dependencias externas.
- **A cambio:** el syllabus llega más tarde. Escala, nota mínima y redondeo son decisiones pendientes (se validan con estudiantes); no se asume una escala universal.

## D19. Asistencia por excepciones

- **Decisión:** se registran solo las excepciones (`ABSENT`, `CANCELLED`) sobre las ocurrencias que ya expande la agenda; no se marca «asistí» en cada clase. El límite de faltas es configurable por asignatura.
- **Por qué:** marcar cada clase sería otra tarea y contradice «organizarse no debe convertirse en otra tarea». No existe una entidad de ocurrencias (se expanden al leer, D11), así que las excepciones requerirán una tabla propia.
- **A cambio:** hay que definir qué pasa con las marcas si se edita una serie, y el criterio de conteo (por clases o por horas) depende del reglamento. Lenguaje matemático, no disciplinario.

## D20. Anotaciones de Attention antes de cambiar el puntaje

- **Decisión:** no se repondera el puntaje de Atención con esfuerzo. Esfuerzo estimado y tiempo disponible entrarán primero como anotaciones, indicador de riesgo y desempate dentro del mismo tier.
- **Por qué:** el puntaje tiene una propiedad probada (los tiers están separados por más que cualquier ajuste de prioridad o estado, así que el más urgente siempre gana) y un tono neutral. Romperla sin evidencia de que mejora la recomendación sería un riesgo gratuito. Ver [attention-engine.md](attention-engine.md).

## D21. IA asistiva, opcional y no autoritativa

- **Decisión:** si se añade IA (Etapa D), será **asistiva**: explica, resume, genera preguntas, da retroalimentación y propone planes. No modifica en silencio fechas, notas, porcentajes, estado, agenda, recordatorios ni persistencia: lo crítico lo calcula y guarda el código determinista tras la confirmación. Todo el sistema debe funcionar sin proveedor: con `AI_PROVIDER` sin definir, la IA queda desactivada (solo documentado, sin variables ni código).
- **Por qué:** una IA que decide fechas o notas no se puede probar ni explicar. Las claves solo viven en el backend; hacen falta consentimiento explícito, minimización de datos, tratar el material como datos (no instrucciones), validar las salidas con esquemas y limitar el coste.
- **A cambio:** esto cambia la premisa de privacidad de D4 y D8 («todo se procesa localmente»): requerirá aviso, autorización y revisión independiente antes de usarla con datos reales. **D4 sigue vigente para el RC.**

## D22. Búsqueda de texto completo antes que vectores

- **Decisión:** si algún día se implementa recuperación sobre el material del estudiante, se empieza con la búsqueda de texto completo de PostgreSQL. No se usa `pgvector` inicialmente.
- **Por qué:** con pocos documentos por usuario basta y no cambia la infraestructura. Solo se evaluarán vectores si datos reales demuestran un recall insuficiente.

## D23. Añadir al calendario antes que el feed sincronizado

- **Decisión:** A4 se divide. **A4.1** permite descargar **una actividad** como `.ics` (`GET /api/activities/:id/calendar.ics`, con sesión). **A4.2**, el feed sincronizado de D17, queda **diferido** hasta que haya evidencia que lo justifique. Enmienda a D17: el feed ya no es «lo primero».
- **Por qué:** el spike A4-0b ([normative-validation.md](spikes/a4-calendar-feed/normative-validation.md)) comparó ambos. El feed depende por completo del refresco del cliente (horas, a veces sin refresco manual, fuera del control de la app y del estudiante), añade un token de larga vida, una ruta pública fuera de la sesión y una migración, y no hay pruebas de clientes reales ni estudiantes que pidan la actualización automática. El archivo cubre el caso básico con un endpoint autenticado y el mismo serializador, sin superficie nueva de privacidad.
- **Serializador (`packages/core/src/icalendar.ts`):** subconjunto mínimo; sin `METHOD`, `VALARM`, `SEQUENCE`, `REFRESH-INTERVAL`, `X-PUBLISHED-TTL`, `RRULE` ni `VTIMEZONE`; `UID` opaco y estable; `DTSTAMP` = `LAST-MODIFIED` = el mayor `updatedAt` (nunca la hora de exportación, salida determinista); título tratado como texto no confiable (normalizar, escapar, plegar a 75 octetos). Tiempo: sin hora = día completo local; con hora = bloque de 15 minutos que termina en `dueAt`. Sin regla por tipo.
- **A cambio:** es una instantánea (no se actualiza sola), el bloque de 15 minutos distorsiona exámenes cuya `dueAt` es la hora de inicio (deuda: distinguir fecha límite de hora de evento), y **no se afirma compatibilidad** más allá de lo probado: iPhone + Safari + Apple Calendar (QA real del mantenedor); Google Calendar, Outlook, Android, Windows con interfaz real, macOS y la PWA instalada no se probaron. Reabrir A4.2 requiere estudiantes que lo pidan y clientes reales con un refresco aceptable.
- Detalle: [calendar-export.md](calendar-export.md).

## D24. Captura inteligente: confirmación en lote atómica, revisión compartida y borradores locales

- **Decisión:** Captura rápida y Bandeja usan **un** motor (`parseCaptureProposals`, con una capa de discurso que resuelve menciones y referencias), **una** revisión (`CaptureReview`) y **una** confirmación (`POST /api/capture/confirm`), que crea **todo lo marcado o nada** en una transacción y reutiliza `ActivityService.create` (no hay una segunda implementación de la creación de actividades). Lo escrito y lo decidido se conserva como **borrador en `localStorage`** (por usuario, 7 días, versionado, validado), también en los formularios de actividad.
- **Por qué:** el estudiante no debe repetir lo que ya escribió (varias fechas, varias actividades, una hora dada después) ni perderlo por cambiar de página, recargar o porque Safari reconstruya la pestaña. La atomicidad evita estados a medias («2 creadas, 1 pendiente») y el bloqueo por usuario más el rechazo de copias exactas evitan duplicados por doble envío.
- **Borradores locales y no en el servidor:** son pequeños, deben poder volcarse de forma síncrona al ocultar la página y no justifican una tabla, una API ni una sincronización; no son una cola sin conexión. `sessionStorage` no sobrevive a la reconstrucción de la pestaña e IndexedDB es asíncrono donde más duele.
- **A cambio:** el borrador no se sincroniza entre dispositivos y queda en el navegador hasta guardarse, descartarse o caducar; las referencias son reglas del español, no comprensión: lo que no encaja se pregunta. Una referencia con varios candidatos no se resuelve: se ofrece el dato a cada uno.
- **PR #29 (F1-2a):** la creación inline de asignatura se absorbe en esta entrega (la rama parte de la de #29), sin dos flujos de «crear asignatura».
- **Ampliación del PR #31:** (1) **Lo escrito no se pierde:** un salto de línea es continuación blanda, no una frontera; una hora, fecha o contexto escrito que no llega a ninguna actividad pasa a `NEEDS_REVIEW` con un bloqueo específico (`UNRESOLVED_*`) y el valor se **ofrece**, nunca se aplica; lo opcional ausente no pregunta nada. (2) **Límite 50** (era 10): medido (≈ 40 ms interpretar, ≈ 60 ms renderizar, ≈ 42 KB de borrador, ≈ 0,4 s confirmar), sin virtualizar; más de 50 se rechaza sin perder el texto. (3) **Descripción opcional** reutilizando `Activity.description` (extracción determinística solo con señales claras, nunca inventada; ofrecida si es ambigua; ≤ 2000). (4) **Héroe del Inicio por fecha límite:** `attention.upcoming` (hasta 5) en lugar de una sola recomendación por puntaje; el puntaje y `recommendation` no cambian. Por qué por fecha: el estudiante pidió ver _lo próximo_; qué es _lo más importante_ seguía siendo una decisión de un puntaje interno que el hero no explica.
- **Segunda corrección del PR #31 (QA en PC):** (1) la puntuación es una **señal débil**, no una frontera: se suaviza dentro de construcciones reconocibles por dos hechos sintácticos (después de una palabra que no puede terminar una cláusula; antes de «de»/«del»/un número que cuenta la palabra anterior) y no con excepciones por frase; (2) el **título conserva las palabras y su orden** y un conector solo se quita si lo que enlazaba fue consumido; un nombre de asignatura solo ofrecido deja el título completo y guarda el corto en `title.withoutSubject`; (3) el **carrusel** tiene una sola autoridad (la intención `activeId`) y el scroll solo la proyecta, con un `goTo` que reemplaza al anterior, la diapositiva visible leída de un `IntersectionObserver` y la tira recolocada tras un cambio de ancho. Medido con 360 variantes del QA (C = D = E = 0) y ~1900 exhaustivas (sin D ni E).
- **Tercera corrección del PR #31 (QA real):** (1) una cantidad anunciada («tengo 3 actividades») es una **expectativa que se compara**, nunca texto de un título ni una orden de inventar: si no coincide se avisa con la frase exacta y nada queda marcado; (2) una asignatura se elige solo con evidencia **distintiva** (una palabra genérica compartida no basta: se pregunta); (3) la palabra de tipo del título es la del estudiante; (4) «Añadir al calendario» sale del menú (descubribilidad) y la Agenda proyecta las actividades abiertas **sin duplicarlas** (misma consulta por rango, mismo formulario), ocultando las completadas y marcando las vencidas.
- Detalle: [capture-proposals.md](capture-proposals.md), [drafts.md](drafts.md).

## D25. Recurrencia semanal: una confirmación, bloques por día y rangos de horas leídos con horario de clases

- **Decisión (F1-2e):** lo que se repite cada semana («Tengo Ciberseguridad todos los martes y jueves de 6 pm a 8 pm») se propone en la **misma** revisión como una tarjeta «Horario semanal» y se crea con la **misma** confirmación en lote (`POST /api/capture/confirm` ahora acepta `blocks`), no con un endpoint nuevo ni un segundo envío: una actividad y un horario en un texto son **una** transacción todo-o-nada. Cada día de la semana es **un** `ScheduleBlock` semanal (el modelo de F1 ya es una fila por serie); una actividad que se repite («un quiz todos los viernes») **no** se persiste ni se vuelve clase: se explica.
- **Por qué:** el estudiante no debe organizar la aplicación (organizar no es otra tarea) ni hacer dos revisiones/envíos para una frase. Reutilizar `ScheduleService.create` ligado a la transacción conserva las reglas (periodo, propiedad, validaciones) sin duplicarlas; el servidor decide primera fecha, fin (el del periodo) y periodo.
- **Una hora final no se inventa:** si no hay rango, se pregunta una sola vez («¿Hasta qué hora?», una respuesta sirve a todos los días del grupo). Los rangos se leen en el mismo modelo temporal (`PlannedTime.end`).
- **Rangos sin a. m./p. m.:** «de X a Y» con dos horas desnudas se lee con horario de clases (7–11 mañana; 12 y 1–6 tarde/noche; «de 7 a 9» = 07:00–09:00, «de 6 a 8» = 18:00–20:00), siempre `LIKELY` y **visible escrito** en la tarjeta; una sola hora sigue siendo la pregunta a. m./p. m. Solo aplica entre dos horas unidas por «de … a …».
- **Duplicados:** un bloque semanal igual a uno ya existente se **reutiliza** (`reusedBlocks`), no se rechaza como las actividades, porque reescribir el horario es normal y no debe dar un error; así un reintento no duplica.
- **A cambio:** más de 21 bloques semanales en un texto se rechazan (`TOO_MANY_PROPOSALS`); `until` no es editable (siempre el fin del periodo); la serie se une por texto, no por semántica (si el estudiante escribe dos veces la misma clase con horas distintas, son dos bloques y la agenda avisa del cruce); sin QA real en un dispositivo hasta que el mantenedor la dé.
- Detalle: [capture-proposals.md](capture-proposals.md#recurrencia-semanal-f1-2e), [schedule.md](schedule.md).

## D26. Perfil educativo separado del usuario

- **Decisión (P0-1):** el contexto de producto del usuario vive en una tabla 1:1 `UserProfile`, no en `User`. `User` sigue siendo identidad y autenticación (la usa cada petición); el perfil crece sin tocarla (más adelante: configuración del avatar, valores por omisión de notas…). La fila siempre existe: el registro la crea con el usuario (`user.create` con `profile: { create: {} }`, una sola transacción) y la migración la creó para cada usuario existente (`NOT_STARTED`, todo `NULL`, sin inferir nada y sin tocar otras tablas).
- **`primaryUse` no es un rol:** describe qué dice la persona que hace con la app (`UNIVERSITY_STUDENT`, `SCHOOL_STUDENT`, `OTHER_STUDENT`, `TEACHER`, `PERSONAL`) y **no autoriza nada**; no existe `role` ni equivalente. Una prueba rastrea las fuentes para que ninguna regla de la API lea `primaryUse` (solo el perfil mismo) ni compare `programKey`/`programName` con un literal.
- **`programName` es la autoridad y `programKey` un auxiliar:** el nombre (1–80 caracteres, sin NUL) es lo que se muestra y se guarda. `programKey` apunta, opcionalmente, a un catálogo **pequeño y versionado** en `@planner/core` (no una tabla, no la red; búsqueda con `normalizeNameKey`) y nunca gobierna comportamiento. Si hay clave, el servidor deriva el nombre canónico (el cliente no puede mezclar `medicina` con `Derecho`); un programa propio tiene `programKey = null`; ambos `null` lo borran. La base lo refuerza con `CHECK` (nombre de 1 a 80 caracteres; una clave exige nombre).
- **`onboardingStatus` es solo un dato:** `NOT_STARTED` (nunca respondió), `IN_PROGRESS`, `COMPLETED` (terminó a propósito), `SKIPPED` (siguió sin completar; se puede reabrir). Pasos válidos: `NOT_STARTED → IN_PROGRESS | SKIPPED`, `IN_PROGRESS → COMPLETED | SKIPPED`, `SKIPPED | COMPLETED → IN_PROGRESS`; el cliente nunca pide `NOT_STARTED`. Ningún estado bloquea iniciar sesión ni redirige.
- **El invariante no se repara en una petición:** `UserProfile` es obligatorio; solo el registro y la migración lo crean. `GET`/`PATCH /api/profile` **nunca** crean ni reparan una fila: `GET` no escribe nada, y si el usuario autenticado no tiene perfil es una violación interna del invariante, que responde `500 PROFILE_INVARIANT_BROKEN` (mensaje genérico, sin detalles; el servidor registra el error) en lugar de ocultarla con una auto-reparación silenciosa. Una prueba demuestra que `GET` no cambia el número de filas (ni `updatedAt`) con perfil o sin él.
- **Compatibilidad:** `publicUserSchema`, `register`, `login` y `me` no cambian (`{ user }`): la app no depende todavía del contexto educativo. El perfil se lee y escribe con `GET`/`PATCH /api/profile` (sin id en la URL; el dueño sale de la sesión).
- **A cambio:** una tabla más y una segunda petición cuando haga falta el perfil; el catálogo es pequeño a propósito (lo demás es texto libre); el estado no se adelanta solo al responder (quien lo use lo pide explícitamente).
- **No incluye (P0 posterior, con su aprobación):** interfaz de onboarding, semestre/grado, `Subject.educationContext`, creación de asignaturas en lote, ajustes, notas, avatar.
- Detalle: [data-model.md](data-model.md#userprofile), [api.md](api.md).

## D27. El nivel de estudio vive en el periodo académico

- **Decisión (P0-2):** el nivel actual de estudio (semestre, grado, año de un curso) se guarda en `AcademicPeriod` (`studyLevel` entero nullable **o** `studyLevelNote` texto corto nullable), no en `UserProfile`. Se extienden los contratos que ya existen (`POST` y `PATCH /api/periods`); no hay endpoint nuevo.
- **Por qué en el periodo:** el nivel cambia con cada periodo («2026-2, semestre 4» y después «2027-1, semestre 5»; «Año escolar 2026, grado 10»). En el perfil quedaría desactualizado y habría que mantenerlo a mano; en el periodo es parte de lo que ese periodo fue.
- **Genérico, sin columnas por tipo:** no hay `semester`, `grade` ni `schoolYear`: un solo dato de dominio; la interfaz decide la palabra según `primaryUse`. El dominio no consulta el perfil ni impone «universidad = 1–10»: el rango técnico 1–99 solo evita basura, y 11 o 12 niveles son válidos.
- **Número o nota, nunca los dos:** `studyLevelNote` (1–40 caracteres, recortado, sin NUL; en blanco = ninguno) cubre «Otro» y estructuras que un número no describe. Un `CHECK` de base de datos refuerza el rango, el largo de la nota y la exclusividad. Al editar: un número fija el nivel y borra la nota, una nota fija la nota y borra el nivel, `null` borra ese campo; el cliente no tiene que mandar dos `null`.
- **Compatibilidad:** los periodos existentes quedan con ambos campos en `NULL` (no se infiere nada ni se toca otra tabla); la respuesta del periodo (también la que viaja en Inicio, Progreso, Atención, Captura e Importación) siempre incluye los dos campos. El flujo actual de onboarding (nombre y fechas) no cambia.
- **Siguiente periodo (solo documentado):** una interfaz futura podrá **sugerir** `studyLevel + 1` al crear el periodo siguiente; el backend nunca lo calcula ni lo copia automáticamente.
- **A cambio:** el número no dice qué es (la etiqueta depende de quien lo muestre); sin interfaz todavía, nadie lo escribe desde la web.
- Detalle: [academic.md](academic.md#nivel-de-estudio-del-periodo-p0-2), [data-model.md](data-model.md).

## D28. El contexto educativo de una asignatura

- **Decisión (P0-3):** `Subject.educationContext` (`UNIVERSITY`, `SCHOOL`, `OTHER_ACADEMIC`, nullable) describe de qué tipo de estudio viene la asignatura. **No existe `PERSONAL`:** una asignatura es estudio estructurado; lo personal son actividades sin asignatura. Es un concepto distinto de `UserProfile.primaryUse` (un usuario universitario puede tener «Curso de Inglés» como `OTHER_ACADEMIC`).
- **`NULL` = no especificado:** los datos antiguos no permiten inferir nada, así que ninguna asignatura existente se rellena (ni desde el perfil ni desde el nombre) y `NULL` nunca se lee como uno de los tres valores.
- **`primaryUse` solo es el valor por omisión de las asignaturas NUEVAS:** `primaryUseToEducationContext` (función pura en `@planner/core`) lo deriva (`UNIVERSITY_STUDENT` → `UNIVERSITY`, `SCHOOL_STUDENT` → `SCHOOL`, el resto → `OTHER_ACADEMIC`, sin respuesta → `null`). Una creación explícita puede enviar `educationContext` (también `null`) y se respeta; cambiar `primaryUse` después **no muta** las asignaturas existentes.
- **Un solo camino de creación:** un `subjectMaterializer` decide el contexto y crea-si-no-existe, y lo usan el formulario manual (también el inline y el sembrado demo), Captura rápida, Bandeja, la importación de horario y el lote de onboarding. Lee el perfil (nunca lo crea ni lo repara: sin perfil, el fallo de invariante ya existente) y no mira nunca el nombre de la asignatura; una prueba de fuentes lo vigila. Hallazgo durante la implementación: una instancia de larga vida no debe guardar en caché el valor por omisión (un cambio posterior de `primaryUse` no se vería); solo las instancias de una transacción lo leen una vez.
- **`PATCH /api/subjects/:id`** fija, cambia o borra el contexto (sin tocar el periodo).
- **No es «calificable»:** `educationContext` ≠ `gradingEnabled`. `UNIVERSITY` o `SCHOOL` no implican notas; B1/B2 decidirán qué asignaturas participan en el cálculo, con su propia configuración. No se añade ningún campo de notas.
- **Lote (`POST /api/subjects/batch`):** nombres solamente (1–30), periodo siempre el actual, un solo contexto opcional para todo el lote, reutiliza las existentes sin error, orden de entrada conservado, colores asignados uno tras otro, una transacción y un bloqueo por usuario.
- **El sembrado demo no cambia:** su perfil sigue vacío (`NOT_STARTED`, sin `primaryUse`), así que sus asignaturas quedan con contexto `NULL`, como las de cualquier cuenta anterior; fijarlo a `UNIVERSITY_STUDENT` se decidirá cuando exista la interfaz que lo pregunta (P0-4).
- **A cambio:** el contexto de las asignaturas antiguas se resolverá después (por el asistente o desde la edición); los reportes que lo usen tendrán que tratar `NULL` como desconocido.
- Detalle: [academic.md](academic.md#contexto-educativo-de-la-asignatura-p0-3), [data-model.md](data-model.md).

## D29. Onboarding P0-4a: una pregunta por pantalla, derivado del servidor

- **Decisión:** el registro navega **explícitamente** a `/onboarding` (antes: Inicio → `RequirePeriod` → `/onboarding`). El asistente de esta primera parte tiene dos pantallas: (1) «¿Para qué quieres usar Academic Planner?» y (2) el periodo actual. Es corto, omitible y reanudable; la ruta `/onboarding` está fuera de `RequirePeriod` (sin bucle).
- **El servidor es la fuente de verdad:** elegir un uso hace **un** `PATCH /api/profile` con `primaryUse` y `onboardingStatus: IN_PROGRESS` (un paso válido desde cualquier estado, sin endpoint nuevo); omitir hace `PATCH { onboardingStatus: SKIPPED }`. La selección visual local solo conserva lo tocado si el guardado falla (alerta con «Toca una opción para intentarlo de nuevo»); nunca es la autoridad.
- **El paso se deriva, no se cuenta:** sin periodo actual, la pregunta si no hay `primaryUse` y no se omitió, y si no el periodo; con periodo, la pregunta solo si falta `primaryUse` (también tras omitir: omitir no prohíbe volver) y si no, nada que preguntar. No hay contador rígido de pasos: cerrar el navegador y volver continúa en el primer paso realmente pendiente.
- **Omitir no omite el periodo:** el periodo sigue siendo obligatorio por arquitectura (actividades, asignaturas y agenda cuelgan de él), así que omitir el perfil lleva directo al periodo; nunca al Inicio sin periodo. El periodo de uso personal tampoco se oculta ni se disimula («Mi planificación»; el texto dice que lo demás se organiza dentro de un periodo).
- **Quien ya usa la app no es expulsado:** ninguna guarda mira el estado del perfil; el inicio de sesión sigue yendo al Inicio y solo un periodo faltante manda a `/onboarding`, como siempre. Un estudiante con periodo puede abrir `/onboarding` a mano: ve la pregunta (si falta), no se crea ni se cambia ningún periodo y, al terminar o omitir, va al Inicio.
- **Palabras, no dominio:** el título del periodo cambia con el uso («Tu semestre actual», «Tu periodo escolar», «Tu periodo de estudio», «Tu planificación actual», «Tu periodo actual»); el periodo es el mismo para todos. Las fechas nunca se adivinan (no existe una regla segura); el nombre se ofrece (`suggestPeriodName`, o «Mi planificación» para el uso personal).
- **Al terminar el periodo (P0-4a; sustituido por D30):** iba a `/subjects` y el estado quedaba `IN_PROGRESS` (opción A, porque vendrían más pasos). Desde P0-4b el asistente continúa con los pasos opcionales y termina en una pantalla final que marca `COMPLETED` ([D30](#d30-onboarding-completo-pasos-opcionales-derivados-y-completed-significa-terminé)).
- **Accesibilidad:** las opciones son botones reales (`aria-pressed`, marca «Elegida» con texto, ≥ 44 px; un botón y no un radio para que moverse con el teclado nunca guarde una elección por accidente), un solo `h1` que recibe el foco al cambiar de paso, errores con `role="alert"`, y un indicador discreto «Perfil · Periodo» (`aria-current="step"`) que solo nombra los pasos que existen.
- **Pruebas:** `completeOnboarding` (helper e2e) es el único lugar que conoce los pasos (omite la pregunta y llena el periodo): los ~30 specs que solo necesitan un usuario con periodo no cambiaron.
- **A cambio:** un toque más (la pregunta) para quien solo quiere entrar (omitirla es un botón); sin carrera, semestre/grado, materias rápidas ni importación (P0-4b); sin QA real en iPhone hasta cerrar el asistente.
- Detalle: [ux-accessibility.md](ux-accessibility.md#onboarding-p0-4a-y-p0-4b), [academic.md](academic.md).

## D30. Onboarding completo: pasos opcionales derivados y «COMPLETED» significa «terminé»

- **Decisión (P0-4b):** el asistente de D29 se completa con los pasos opcionales de cada uso y una pantalla final. Flujos: **universidad** = uso → periodo → carrera/programa → semestre → materias → final; **colegio** = uso → periodo → grado → materias → final; **otro tipo de estudio** = uso → periodo → programa/curso → materias → final; **docente** = uso → periodo → materias o cursos que imparte → final; **personal** = uso → periodo → final. Todo opcional salvo el periodo (la app cuelga de él) y todo con «Omitir» o «Hacerlo después».
- **El paso se deriva, no se cuenta:** el siguiente paso es el primero que falta según el uso, a partir de lo que el servidor ya tiene (perfil, periodo actual y su nivel) y de lo que se decidió en esta sesión. No se guarda un `currentStep` ni se añaden banderas al perfil. Un paso opcional omitido (o una lista de materias confirmada) se anota en un **borrador local** (`onboarding`, la infraestructura de borradores existente: por usuario, versionado, 7 días) junto con los nombres de materias aún sin crear; así recargar no vuelve a preguntar lo omitido. El borrador se borra al terminar. Reentrar con un perfil `COMPLETED` **no persigue** los opcionales vacíos: `COMPLETED` significa «terminé el asistente», no «todos los campos tienen valor»; cambiarlos después es de Ajustes (UX2a).
- **Estados:** durante el flujo `IN_PROGRESS`. Los dos botones finales marcan `COMPLETED` (si hay una respuesta, pasando por `IN_PROGRESS` cuando venía de `NOT_STARTED` o `SKIPPED`) **antes** de salir. Quien **omitió el perfil** (no hay uso) termina el flujo —periodo y pantalla final— **sin cambiar** el estado: sigue `SKIPPED` (no insistir). Quien ya tiene periodo y lo abre a mano (usuario existente) puede completar todo sin que se cree ni cambie un periodo; si lo abandona, sigue usando la app.
- **Carrera o programa:** buscador **sin red** sobre el catálogo de `@planner/core` (`searchPrograms`: sin mayúsculas ni tildes, todas las palabras escritas; no vuelca el catálogo si no se escribió nada), como lista de botones (no un combobox mal anunciado). Elegir una opción envía `programKey` (el servidor deriva el nombre); «Mi carrera no aparece» da un texto libre (`programName`, sin clave). Para «otro tipo de estudio» el texto libre es lo principal y el catálogo solo sugiere.
- **Nivel:** semestre (1–10) o grado (1–11) y «Otro» (un número hasta 99 **o** una descripción corta), guardado con el `PATCH /api/periods/:id` existente **en el periodo actual** (y la semántica número ↔ texto ya definida en D27). **«Otro tipo de estudio» no pregunta nivel:** sería una pregunta sin significado claro («¿nivel de qué?») que alarga el flujo; si hiciera falta, se añade con evidencia.
- **Materias rápidas:** un campo, Enter agrega una ficha (recortada, sin duplicados por `normalizeNameKey`, máximo 30, cada una con su botón «Quitar <nombre>» de 44 px); sin profesor, color, descripción ni tipo (el servidor asigna colores y deriva el contexto: D28). Una sola confirmación = **un** `POST /api/subjects/batch`. Las materias que el periodo ya tiene se **muestran como ya agregadas** (no se reescriben ni entran en el lote); las antiguas con `educationContext = NULL` **no se tocan**: solo las nuevas reciben el valor derivado.
- **Pantalla final:** pequeña, sin celebración: «Listo para empezar», un resumen simple de lo creado, «Puedes cambiar todo esto después.» y dos salidas: **«Importar mi horario»** (marca `COMPLETED` y abre `/calendar/import`; no importa nada por sí sola; las materias creadas ya existen y el emparejamiento las reutiliza) e **«Ir al Inicio»** (marca `COMPLETED`, borra el borrador y va a `/dashboard`, ya no a `/subjects`).
- **«Atrás»:** vuelve al paso anterior del mismo uso sin perder lo guardado (los datos salen del servidor; las fichas sin crear, del borrador). Desde un paso anterior ya respondido, «omitir» solo sigue adelante.
- **Aviso en el Inicio («Completa tu perfil»):** una línea discreta con un enlace a `/onboarding` (sin modal ni aviso repetido): `NOT_STARTED` → «Completa tu perfil»; `IN_PROGRESS` → «Continúa configurando tu perfil»; `SKIPPED` y `COMPLETED` → nada (SKIPPED significa «no insistas»). Nunca bloquea.
- **Demo:** el usuario demo queda con `primaryUse = UNIVERSITY_STUDENT` y `onboardingStatus = COMPLETED` (es un estudiante universitario que ya terminó: abre directo en la app sin aviso y sus asignaturas nacen `UNIVERSITY`); determinista, solo toca al demo, sin programa ni nivel inventados. Reemplaza la decisión de D28 de dejarlo vacío.
- **Hallazgo durante la implementación:** una prueba de navegador mostró que salir hacia el Inicio antes de que el `PATCH` a `COMPLETED` terminara dejaba el aviso «Continúa configurando tu perfil» mostrándose con datos viejos (la lectura del Inicio podía cruzarse con la escritura). Ahora se guarda `COMPLETED` y **después** se sale.
- **A cambio:** más pantallas para quien quiere hacerlo todo (cada una omitible); el catálogo es pequeño (el texto libre cubre el resto); `COMPLETED` no garantiza datos (los consumidores futuros deben tratar los vacíos como desconocidos); sin QA real en iPhone hasta que el mantenedor la haga.
- Detalle: [ux-accessibility.md](ux-accessibility.md#onboarding-p0-4a-y-p0-4b), [academic.md](academic.md).
