# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). La versión sigue [SemVer](https://semver.org/lang/es/); las versiones actuales son **candidatos a versión** (`1.0.0-rc.1`, `1.0.0-rc.2`). Resumen por fase: [docs/phase-history.md](docs/phase-history.md). Notas de los candidatos: [rc.1](docs/release-notes-1.0.0-rc.1.md) · [rc.2](docs/release-notes-1.0.0-rc.2.md).

## Unreleased

### Added

- **Activities and Subjects in Pulso Ambiental (UX1-3).** Activity cards read in the order a student thinks (what, when, how urgent, what to do) with ONE primary action, "Completar" (the same change as choosing "Finalizada"; a tonal button), "Editar" within reach and "Añadir al calendario" / "Eliminar" in an accessible "Más acciones" menu (keyboard, focus return, 44 px items; delete still asks for confirmation); the state control stays a native select, dressed as the state; the Radar mark is a dot and a word instead of an emoji; the type becomes quiet metadata; the subject's color is a thin rail, a dot and a faint wash. The state filters are one row that scrolls sideways on a phone, "Más filtros" is its own disclosure with a soft panel, Activities use two columns and Subjects three from 1024 px, and subject cards get a monogram tile and the subject's color. No `slate-*` left in the touched area (21 → 0). No data, endpoint, route or business-rule change; no new dependency; needs a real-iPhone check before it is called done.
- **Intelligent ambient experience (UX1-2.75, "Pulso Ambiental").** Same PR as UX1-2. A faint ambient light behind every screen whose hue follows the state of the semester (derived only from data the Home already has); a Home that uses a wide screen (two asymmetric columns from 1024 px, DOM in reading order) with more air at the top; a hero whose surface follows the state, with a drifting orb, a soft grid and a five-node timeline rail; a living Radar (a proportional spectrum with an occasional passing light, state-tinted tiles, rings that breathe out of step and more slowly the calmer the state); the four counters as one editorial strip; a progress ring that draws itself and a done tint at 100 %; a pill-track desktop navigation with a sliding highlight and a lit phone capsule; a constellation empty state; a surface system on `Card`. Ambient loops are always `motion-safe` (they never start with reduced motion), transform/opacity only, no dependency. "Próxima entrega" no longer flashes as a card before collapsing into a line. No data, endpoint, route or business-rule change; approved by the maintainer on a real iPhone (Safari, HTTP on the local network; PWA and HTTPS not tested), with further visual refinement expected.
- **Motion and personality pass (UX1-2.5).** Same PR as UX1-2. The Home hero gets depth and character (a subtle gradient, a state-colored glow, decorative shapes hidden from assistive tech, a staggered entrance and a single ripple only for overdue/immediate activities); the phone bar's active mark slides between destinations; the Activities state filter becomes a segmented control with a sliding highlight and the Agenda day selector answers with a small spring; progress, counters and Radar marks respond; marking an activity as finished confirms it for a moment; a reusable `EmptyState` and a Home loading placeholder. Everything is CSS (no new dependency), moves only `transform`/`opacity`, and collapses under `prefers-reduced-motion`. No data, endpoint, route or business-rule change; approved by the maintainer on a real iPhone (Safari, HTTP on the local network; PWA and HTTPS not tested), with further visual refinement expected.
- **Home redesign and visual identity (UX1-2).** A palette of its own (soft cool background with white surfaces, deep indigo primary, teal accent used sparingly), softer surfaces and radii, and subtle motion: a one-time entrance, a progress bar that fills once and a press response on buttons and tiles, all collapsing under `prefers-reduced-motion`. The Home now answers "what do I do now?" first (a hero for «¿Qué hago ahora?»), then "how am I doing?" (counters, progress, capture) and "what comes next?" (a compact Radar, deliveries, the week). The Radar summary uses a designed mark plus the category name instead of emoji. «Próxima entrega» becomes one quiet line when the hero already shows that activity. The neutral colors used across the app were re-tinted to the new palette, so Activities, Subjects and Agenda change color but not structure. No data, endpoint, route or business-rule change.
- **App shell and navigation (UX1-1).** The four daily destinations (Inicio, Actividades, Agenda, Asignaturas) are now a bottom bar with icons on phones and tablets (it respects the iPhone safe area) and move into the top bar from 1024 px; the current place is marked by `aria-current`, a heavier label and a bar or underline, not color alone. «Cerrar sesión» stays in the top bar, outside the navigation. Brand mark, inline SVG icons and a `PageHeader` used by Activities and Subjects. No route, screen content or business logic changed; Home is untouched. See [docs/ux-accessibility.md](docs/ux-accessibility.md).
- **Visual foundation (UX1-0).** Design tokens (semantic color roles, radius, shadow, type and motion foundations as CSS variables behind Tailwind's `@theme`) and three small primitives, `Button`, `Card` and `Badge`, used by the Subjects and Activities screens, the delete dialog, the dialog surface and «Cerrar sesión». One consistent visible focus ring for every keyboard-focusable control. The current look is kept on purpose; no screen was redesigned. See [docs/ux-accessibility.md](docs/ux-accessibility.md#sistema-visual-ux1-0).
- **Añadir al calendario (A4.1).** Each activity has an «Añadir al calendario» button that downloads that activity as an `.ics` file (`GET /api/activities/:id/calendar.ics`, session required, foreign or missing activity = the same 404). No-time activities are all-day events on the user's local day; timed ones are a 15-minute block that ends at the due time. The file contains only the title, the subject name and the dates (no description, reminders, user data, `METHOD`, `VALARM`, `SEQUENCE` or refresh hints), has an opaque stable `UID`, and the same activity always exports the same bytes. The title is treated as untrusted text (no CRLF/property injection, folded at 75 octets). It is a snapshot: no feed, token, sync or migration; the synchronised feed (A4.2) is deferred. Verified on a real iPhone (Safari + Apple Calendar: opens the calendar directly, all-day and timed events correct, a second import did not create a duplicate); not tested on Google Calendar, Outlook, Android, Windows or macOS with a real interface, or the installed PWA. See [docs/calendar-export.md](docs/calendar-export.md).
- Calendar spike documentation (A4-0, A4-0b): RFC verification, independent validation and the feed vs add-to-calendar comparison under [docs/spikes/a4-calendar-feed](docs/spikes/a4-calendar-feed/README.md).

### Changed

- Schedule Import can propose and create missing subjects after explicit confirmation (A1). The preview marks each class as **Existente**, **Nueva — se creará al importar** or **Revisar**; confirming is one request, `POST /api/schedule-import/confirm`, that creates the new subjects and the classes in a single all-or-nothing transaction (same Schedule rules as the manual form; duplicates are refused with `409`; concurrent confirmations are serialised per user). A subject that nobody matches no longer blocks a class. `multipart` is now accepted only on `/api/schedule-import/parse`. See [docs/schedule-import.md](docs/schedule-import.md). Classes whose different institutional codes clean to the same name are never merged into one subject without an explicit confirmation.

- Planning: reopened product scope for the post-RC automation and academic-assistance cycle ([docs/roadmap-post-rc.md](docs/roadmap-post-rc.md)). Documentation only: no code, dependency, schema, endpoint or version changes.

Sin cambios de código después de `1.0.0-rc.2`. Cualquier trabajo nuevo requiere un alcance explícito del propietario del proyecto.

## 1.0.0-rc.2 — Release Candidate 2 (2026-10-06)

Corrección de un defecto de la importación de horario encontrado al probar con un calendario visual real; sin funciones nuevas (la congelación de funcionalidades continúa). Reemplaza a `1.0.0-rc.1`, que no se modifica. Notas: [docs/release-notes-1.0.0-rc.2.md](docs/release-notes-1.0.0-rc.2.md).

### Fixed

- Schedule import now recognizes compact 24-hour time ranges such as `1900-2030` (19:00–20:30), `1400-1615` and `0800-0930`. A valid range takes priority over isolated times in the same block, which also no longer end up in the title.
- Schedule import filters calendar-axis time labels (`1pm 2pm 3pm …`) that previously could replace the real hours of a class or create a false proposal.
- Compact ranges are conservative: invalid times (`2560-2700`, `1965-2030`), years (`2019-2024`) and room numbers (`207-215`) are not read as hours.
- «Texto leído» de la vista previa ya no incluye la etiqueta de la escala del calendario cuando la celda trae su propia hora.

### Cambios del candidato

- Versión `1.0.0-rc.2` coherente en la raíz y los tres workspaces y en `package-lock.json` (sin cambios de dependencias).
- Notas de la versión de rc.2 y estado del proyecto actualizado.

### Known

- `npm audit` ahora reporta 6 (4 altas + 2 críticas): la base de avisos añadió `shell-quote` (crítica) vía `concurrently`, una herramienta solo de desarrollo; con `--omit=dev` siguen las 4 altas de Prisma. Sin cambios de dependencias.

## 1.0.0-rc.1 — Release Candidate (2026-10-06)

Congelación de funcionalidades (_feature freeze_): esta versión no añade funciones; valida y prepara el sistema construido en las Fases 1–19. **No es una certificación para producción pública**: dispositivos móviles reales y un despliegue real con HTTPS y proxy siguen sin validar ([docs/limitations.md](docs/limitations.md)).

### Core

- Autenticación con sesiones en servidor (Argon2id, token del que solo se guarda el hash, cookie `HttpOnly`; `__Host-` y `Secure` bajo HTTPS).
- Periodo académico (uno actual por usuario) y asignaturas.
- Actividades (tipo, prioridad, estado, fecha y hora opcional) con filtros combinables.
- Agenda con clases semanales y aviso (no bloqueo) de solapes.
- Recordatorios internos automáticos por tipo de actividad y manuales.
- Aislamiento por usuario: un recurso ajeno responde el mismo 404 que uno inexistente.

### Planning

- Radar académico (cinco categorías por tiempo restante).
- «¿Qué hago ahora?» (determinístico y explicable, sin IA).
- Progreso general y por asignatura, y carga semanal (descriptivos).
- Dashboard derivado de los datos reales.

### Capture

- Captura rápida: una frase → una actividad propuesta.
- Bandeja académica: un mensaje → hasta 10 actividades propuestas.
- Las dos proponen y solo guardan al confirmar.

### Platform

- PWA instalable (el shell abre sin conexión; `/api/*` siempre por red).
- Importación de horario (imagen o PDF) con OCR local y vista previa editable.

### Quality

- Accesibilidad evaluada con axe y pruebas de teclado (orientada a WCAG 2.1 AA; no certificada).
- Endurecimiento de seguridad y pruebas de seguridad automatizadas (matriz IDOR, CSRF, CSP, límites, subidas).
- Validación de extremo a extremo de un semestre completo, con fallos de red inyectados.
- Datos de demostración reproducibles (`npm run db:seed:demo -- --allow-demo`).
- Documentación final con índice, y `npm run docs:check`.

### Cambios del candidato

- Versión `1.0.0-rc.1` coherente en la raíz y los tres workspaces (`@planner/core`, `@planner/api`, `@planner/web`) y en `package-lock.json`.
- Documentos del candidato: notas de la versión, manifiesto y evidencia de validación.
- Estado del proyecto, `CLAUDE.md` y la lista final actualizados al candidato.

### Corregido durante el desarrollo reciente

- `test:browser` no arrancaba sin la base de test (Fase 18).
- Escáner de seguridad que fallaba en un clon limpio por una URL falsa de prueba (Fase 17).
- Carreras de tests que cerraban sesión con peticiones en vuelo (Fases 17 y 18).
- Test de Agenda en móvil que solo pasaba los lunes (Fase 19).

### Conocido

`npm audit`: 4 vulnerabilidades altas en la cadena del CLI de Prisma (no alcanzables en tiempo de ejecución según el análisis actual; sin versión estable posterior que las corrija). Límites de frecuencia en memoria; el registro revela si un correo existe; sin verificación de correo, recuperación de contraseña ni MFA; sesión fija de 7 días. `MaxListenersExceededWarning` en las pruebas de API (ruido de Supertest). Ver [docs/limitations.md](docs/limitations.md) y [docs/security.md](docs/security.md).
