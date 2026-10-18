# Spikes técnicos de las siguientes fases (sin implementar)

> **Solo preparación.** Ningún diseño está elegido, no hay código funcional y nada de esto está autorizado: cada tema necesita la decisión del mantenedor. Para cada uno: arquitectura actual relevante, dependencias, riesgos, contratos posibles, preguntas para el mantenedor y una propuesta de PR pequeños. Estado de base: `main` sin el PR #46 (B3, Captura inteligente de notas, en revisión).

## 1. Radar con notas

- **Hoy:** el Radar (`packages/core/src/radar.ts`, `radarService`) lee **solo** el plazo, el estado y el instante actual de una `Activity` abierta; es derivado, no guarda nada y no es prioridad ni puntaje. Una nota (`Evaluation.scoreMilli`) vive en otra tabla y una actividad tiene 0..N evaluaciones.
- **Dependencias:** modelo de notas B1/B2 (en `main`), B3 (en revisión) para que las notas lleguen con poco esfuerzo; semántica multi-estudio del Radar (`readCurrentPeriods`).
- **Riesgos:** mezclar «tiempo que queda» con «cuánto vale» cambia la semántica del Radar (hoy puramente temporal); las notas no existen para actividades sin evaluación; peso del corte vs. peso dentro del corte; no afirmar impacto académico.
- **Contratos posibles (sin elegir):** (a) el Radar sigue temporal y solo **muestra** una etiqueta de peso cuando la actividad está enlazada a una evaluación (`GET /api/radar` añade `evaluation?: { name, cutName, weightInFinalBp }`); (b) un Radar de notas aparte (otra sección), sin tocar el temporal.
- **Preguntas al mantenedor:** ¿el peso debe cambiar el orden o solo informar? ¿se muestra el peso como porcentaje de la nota final? ¿una actividad sin evaluación se queda igual?
- **PR pequeños propuestos:** (1) contrato de lectura del peso (core + API, sin UI); (2) etiqueta en `RadarCard`; (3) pruebas multi-estudio.

## 2. Progreso con notas

- **Hoy:** el Progreso (`progressService`) cuenta actividades por estado y por asignatura/periodo; las actividades generales cuentan en el progreso general. La nota acumulada ya se calcula **al leer** en `GET /api/subjects/:id/grades` (`gradingMath`, BigInt).
- **Dependencias:** B1/B2 en `main`; convención de redondeo solo de presentación (nunca se compara con la aprobatoria).
- **Riesgos:** dos «progresos» distintos (actividades hechas vs. nota) pueden confundir; periodos sin escala o sin cortes; asignaturas con cortes distintos; notas parciales presentadas como definitivas.
- **Contratos posibles:** `GET /api/progress` añade por asignatura `grade?: { accumulated, ofMax, cutsGraded, cutsTotal, definedWeight }` reutilizando `summarizeSubjectGrade`; sin juicios textuales (D36).
- **Preguntas:** ¿va en la misma pantalla o en una pestaña? ¿qué se muestra con pesos incompletos (estimación marcada)? ¿y con varios estudios?
- **PR pequeños:** (1) contrato core+API de lectura; (2) fila de nota en `SubjectProgressList`; (3) estados vacíos y multi-estudio.

## 3. A2 — importación de `.ics`

- **Hoy:** solo exportación por actividad (`icalendar.ts`, A4.1). La importación de horarios ya sigue CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR con `POST /api/schedule-import/confirm` (todo o nada, sin guardar el archivo).
- **Dependencias:** un parser RFC 5545 propio o una librería (decisión de dependencia); reutilizar la revisión de la importación de horario; zona horaria (`User.timezone`) y `RRULE` semanal.
- **Riesgos:** `VTIMEZONE` y recurrencias complejas (`BYDAY` múltiple, `EXDATE`), eventos de día completo, archivos grandes u hostiles (límites como en el OCR), NUL/caracteres de control, duplicados con la Agenda.
- **Contratos posibles:** `POST /api/ics-import/parse` (multipart, con límites) → propuestas de bloques/actividades; confirmación con el endpoint existente (`blocks`/`items`) sin endpoint nuevo de escritura.
- **Preguntas:** ¿clases (bloques) o fechas límite (actividades) o ambas? ¿qué hacer con eventos que no encajan? ¿hay un calendario universitario real de muestra?
- **PR pequeños:** (1) spike de parser con casos reales (como `docs/spikes/a4-calendar-*`); (2) `parse` determinista con pruebas; (3) UI de revisión reutilizada.

## 4. A5 — Web Share Target

- **Hoy:** PWA con `manifest` y service worker que solo precachea el shell; `/api/*` es `NetworkOnly`. La Bandeja y la Captura rápida ya aceptan texto y guardan borradores locales.
- **Dependencias:** **HTTPS real** e instalación de la PWA (sin ellas no se puede probar); `share_target` en el manifiesto; una ruta de entrada que **no** cree nada sin confirmación.
- **Riesgos:** privacidad de lo compartido (no guardar fuera del borrador local); iOS/Safari no soporta Web Share Target; el contenido debe pasar por el flujo de revisión; la CSP y `originCheck` no deben relajarse.
- **Contratos posibles:** `share_target: { action: '/inbox/share', method: 'GET', params: { text } }` → la página precarga la Bandeja con el texto; sin endpoint nuevo.
- **Preguntas:** ¿Bandeja o Captura rápida? ¿solo Android/Chrome (iOS no lo soporta)? ¿hay despliegue con HTTPS antes?
- **PR pequeños:** (1) manifiesto + ruta de precarga detrás de una bandera; (2) pruebas con el service worker; (3) QA en dispositivo real.

## 5. Pixel Companion v1 y personaje ambiental

- **Hoy:** Home con «Pulso Ambiental» (luz y tono por estado, `AmbientTone.tsx`), movimiento sutil que respeta `prefers-reduced-motion`; sin sprites ni personaje.
- **Dónde podría integrarse (solo inspección):** el héroe «¿Qué hago ahora?» y `AmbientTone` del Inicio; estados derivados que ya existen (vencida, inmediata, sin pendientes) sin guardar nada.
- **Dependencias:** **dirección visual del mantenedor** (estilo, paleta, tamaño, personalización); decisión de assets (SVG o sprite sheet) y presupuesto de peso; accesibilidad (decorativo con `aria-hidden`, nunca la única fuente de información).
- **Riesgos:** gamificación que contradiga «organizarse no debe convertirse en otra tarea»; tono con culpa (el motor de atención es neutral); rendimiento y movimiento reducido; cualquier «estado emocional» afirma un impacto no medido.
- **Preguntas:** ¿decorativo o con interacción? ¿qué estados? ¿personalizable? ¿animación o estático? Nada se implementa sin esto.
- **PR pequeños (cuando haya dirección):** (1) contrato de estados derivados; (2) un sprite estático sin animación; (3) animación con `prefers-reduced-motion`.

## 6. QA de release

- **Hoy:** QA real únicamente en iPhone + Safari (HTTP, red local). Ver la auditoría de preparación para release (documento aparte, en su propio PR).
- **Falta:** despliegue de prueba con HTTPS y proxy reales (cookie `__Host-`, HSTS, `TRUST_PROXY`, límites de frecuencia), PWA instalada, Android, Google Calendar y Outlook para el `.ics`, lista de verificación actualizada.
- **Preguntas:** ¿dónde se despliega? ¿qué dispositivos hay disponibles? ¿cuándo se decide el siguiente candidato?
- **PR pequeños:** (1) reescribir `final-checklist.md`; (2) guion de QA por dispositivo; (3) evidencia enlazada tras cada prueba real.
