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

## D5. Proponer antes de guardar (Capturar → Interpretar → Confirmar)

- **Decisión:** los tres flujos de interpretación **solo proponen**; confirmar llama a los endpoints normales (`POST /api/activities`, `POST /api/schedule`). No existe un camino de creación propio, no se guarda el texto ni el archivo, y nunca se crea una asignatura sin que exista.
- **Por qué:** una interpretación equivocada guardada en silencio es peor que una pregunta; y reutilizar los endpoints normales significa que recordatorios, Radar y validaciones se comportan igual que en la creación manual.

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
