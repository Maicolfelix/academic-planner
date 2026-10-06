# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). La versión sigue [SemVer](https://semver.org/lang/es/); la primera es un **candidato a versión** (`1.0.0-rc.1`). Resumen por fase: [docs/phase-history.md](docs/phase-history.md). Notas completas del candidato: [docs/release-notes-1.0.0-rc.1.md](docs/release-notes-1.0.0-rc.1.md).

## Unreleased

### Fixed

- Schedule import now recognizes compact 24-hour time ranges such as `1900-2030` (19:00–20:30), `1400-1615` and `0800-0930`. A valid range takes priority over isolated times in the same block, which also no longer end up in the title.
- Schedule import filters calendar-axis time labels (`1pm 2pm 3pm …`) that previously could replace the real hours of a class or create a false proposal.
- Compact ranges are conservative: invalid times (`2560-2700`, `1965-2030`), years (`2019-2024`) and room numbers (`207-215`) are not read as hours.

### Known

- `npm audit` ahora reporta 6 (4 altas + 2 críticas): la base de avisos añadió `shell-quote` (crítica) vía `concurrently`, una herramienta solo de desarrollo; con `--omit=dev` siguen las 4 altas de Prisma. Sin cambios de dependencias.

Corrección posterior al candidato `1.0.0-rc.1` (que no se modifica): no cambia versiones ni crea etiquetas; cualquier nueva versión (`rc.2`) requiere un alcance explícito del propietario.

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
