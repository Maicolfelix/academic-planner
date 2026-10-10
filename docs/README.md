# Documentación de Academic Planner

Índice de toda la documentación. Cada documento tiene un propósito distinto; aquí no se repite su contenido. Si algo contradice al código, **el código manda** y el documento se corrige (orden de confianza: código → pruebas → documentos).

## Por dónde empezar

| Si eres…                         | Lee                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docente o evaluador              | [system-overview.md](system-overview.md) → [requirements.md](requirements.md) → [system-validation.md](system-validation.md) → [limitations.md](limitations.md) |
| Desarrollador nuevo              | [README principal](../README.md) → [development.md](development.md) → [architecture.md](architecture.md) → [testing.md](testing.md)                             |
| Quien va a presentar el proyecto | [demo.md](demo.md)                                                                                                                                              |
| Quien va a desplegarlo           | [deployment.md](deployment.md) → [security.md](security.md) → [final-checklist.md](final-checklist.md)                                                          |
| Una sesión nueva de Claude       | [CLAUDE.md](../CLAUDE.md) → [project-state.md](project-state.md) → [roadmap-post-rc.md](roadmap-post-rc.md)                                                     |

## Visión general y arquitectura

| Documento                                | Contenido                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| [system-overview.md](system-overview.md) | Qué es el sistema, para quién, qué hace y cómo, sin leer código                            |
| [architecture.md](architecture.md)       | Stack real, monorepo, capas, dominio compartido, flujos y diagramas                        |
| [data-model.md](data-model.md)           | Entidades, relaciones, campos importantes, restricciones y datos derivados                 |
| [api.md](api.md)                         | Inventario de endpoints, formato de errores y códigos de estado                            |
| [domain-rules.md](domain-rules.md)       | Reglas exactas: tiempo, Radar, Atención, progreso, carga, recordatorios, agenda, propiedad |
| [decisions.md](decisions.md)             | Decisiones clave y su motivo                                                               |
| [requirements.md](requirements.md)       | RF01–RF09, extensiones y requisitos no funcionales, trazados a código y pruebas            |

## Módulos funcionales

| Documento                                            | Módulo                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [auth.md](auth.md)                                   | Autenticación, sesiones, cookie, CSRF                                         |
| [academic.md](academic.md)                           | Periodos académicos y asignaturas                                             |
| [activities.md](activities.md)                       | Actividades                                                                   |
| [calendar-export.md](calendar-export.md)             | Añadir al calendario (`.ics`)                                                 |
| [dashboard.md](dashboard.md)                         | Pantalla de inicio                                                            |
| [schedule.md](schedule.md)                           | Agenda, recurrencia y solapes                                                 |
| [reminders.md](reminders.md)                         | Recordatorios internos                                                        |
| [radar.md](radar.md)                                 | Radar académico                                                               |
| [attention-engine.md](attention-engine.md)           | «¿Qué hago ahora?»                                                            |
| [progress-and-workload.md](progress-and-workload.md) | Progreso y carga semanal                                                      |
| [quick-capture.md](quick-capture.md)                 | Captura rápida                                                                |
| [academic-inbox.md](academic-inbox.md)               | Bandeja académica                                                             |
| [capture-proposals.md](capture-proposals.md)         | Captura inteligente: motor, confirmación en lote y revisión (F1-2b → F1-2cdp) |
| [drafts.md](drafts.md)                               | Borradores persistentes (captura y formularios de actividad)                  |
| [schedule-import.md](schedule-import.md)             | Importación de horario (OCR)                                                  |
| [pwa.md](pwa.md)                                     | PWA instalable                                                                |
| [ux-accessibility.md](ux-accessibility.md)           | UX, accesibilidad y diseño adaptable                                          |

## Calidad, seguridad y operación

| Documento                                    | Contenido                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| [security.md](security.md)                   | Modelo de amenazas, controles, hallazgos de dependencias y limitaciones              |
| [testing.md](testing.md)                     | Capas de prueba, cifras, base de test, cómo ejecutar, humo de rendimiento            |
| [system-validation.md](system-validation.md) | Validación integral (Fase 17): matriz de escenarios, evidencia, registro de defectos |
| [deployment.md](deployment.md)               | Requisitos de producción, variables de entorno, `TRUST_PROXY`, base de datos         |
| [development.md](development.md)             | Entorno, scripts, migraciones, Playwright y problemas comunes                        |
| [limitations.md](limitations.md)             | Limitaciones conocidas, lo no validado y lo que no se afirma                         |
| [final-checklist.md](final-checklist.md)     | Lista de verificación antes de publicar (lo pendiente queda sin marcar)              |

## Demostración y estado del proyecto

| Documento                                                  | Contenido                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [demo.md](demo.md)                                         | Datos de demostración, credenciales sintéticas y guion                    |
| [project-state.md](project-state.md)                       | Estado actual compacto, riesgos y comandos                                |
| [roadmap-post-rc.md](roadmap-post-rc.md)                   | Ciclo de producto post-RC: visión, etapas, decisiones (planificación)     |
| [phase-history.md](phase-history.md)                       | Resumen de las fases 0–20                                                 |
| [release-notes-1.0.0-rc.2.md](release-notes-1.0.0-rc.2.md) | Notas del Release Candidate 2 (vigente): qué corrige, límites, pendientes |
| [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md) | Notas del Release Candidate: qué incluye, límites, pendientes             |
| [release-manifest.md](release-manifest.md)                 | Ficha técnica del candidato: versión, requisitos, migraciones, etiquetado |
| [release-validation.md](release-validation.md)             | Evidencia de la validación del candidato                                  |
| [../CHANGELOG.md](../CHANGELOG.md)                         | Cambios (candidatos rc.1 y rc.2; sin v1.0.0 final)                        |
| [../ARCHITECTURE_PLAN_v1.md](../ARCHITECTURE_PLAN_v1.md)   | Plan original de la Fase 0 (documento histórico)                          |

## Terminología

Se usan siempre los mismos nombres: **Academic Planner**, **asignatura**, **actividad**, **agenda**, **periodo académico**, **recordatorio**, **Radar académico**, **¿Qué hago ahora?**, **carga semanal**, **progreso**, **Captura rápida**, **Bandeja académica**, **Importación de horario**. Los nombres de enumeraciones y campos (`EXAM`, `dueAt`, `UNDER_CONTROL`…) se dejan en inglés tal como están en el código.

## Mantener la documentación

`npm run docs:check` comprueba enlaces relativos (y sus encabezados), archivos referenciados y scripts de npm mencionados; `npm run test:docs` prueba el propio verificador. No sabe si una frase es verdadera: al cambiar un comportamiento, actualiza el documento que lo describe.
