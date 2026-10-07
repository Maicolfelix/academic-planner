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

- **Decisión:** la invariante «proponer, no crear» pasa a **«proponer, confirmar y crear únicamente después de confirmación explícita»**. **A1 (implementado, pendiente de revisión):** la importación de horario propone también las asignaturas faltantes y, al confirmar, crea asignaturas y clases en **una sola transacción** (`POST /api/schedule-import/confirm`). Esto reemplaza el comportamiento anterior (un `POST /api/schedule` por clase, con éxito parcial y sin crear asignaturas).
- **Todo o nada** (decisión de A1): si alguna clase se rechaza no se guarda nada y se responden todas las rechazadas con su `clientId`. Se descartó conservar el éxito parcial porque deja asignaturas sin clase y un horario a medias que el estudiante no sabe cómo completar; no se encontró una razón técnica (los servicios no abren transacciones propias y sus repositorios aceptan el cliente de la transacción) ni de producto que lo exija.
- **Frontera de la transacción:** bloqueo asesor por usuario → periodo actual → asignaturas (`INSERT … ON CONFLICT DO NOTHING` sobre `(periodId, nameKey)`) → clases con el **mismo** `ScheduleService`, sin reescribir sus reglas. Un duplicado (clase igual ya en la agenda o repetida en el lote) se rechaza con 409: es un cambio de comportamiento respecto al formulario, que solo avisaba.
- **Carreras:** el bloqueo serializa las confirmaciones de un usuario (un doble envío no duplica clases, que no tienen restricción única); `ON CONFLICT DO NOTHING` protege frente a una asignatura creada por otra ruta sin ese bloqueo. Probado con solicitudes simultáneas reales y con mutaciones (sin bloqueo y con `INSERT` simple las pruebas fallan).
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
