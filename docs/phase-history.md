# Historial de fases

El proyecto se construyó por **fases estrictas**: solo se implementa la fase que el usuario entrega y cada una se aprueba tras lint, formato, tipos, pruebas, build, migraciones, verificación en navegador y sin defectos bloqueantes. Aquí hay una o dos líneas por fase; el estado actual está en [project-state.md](project-state.md) y las decisiones en [decisions.md](decisions.md). Las referencias (commit o PR) son las que quedaron en `main`.

| Fase | Tema                           | Qué se hizo                                                                                                                  | Referencia  |
| ---: | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
|    0 | Análisis y decisiones          | Monorepo, PostgreSQL, sesiones propias, zona horaria. Plan original en [ARCHITECTURE_PLAN_v1.md](../ARCHITECTURE_PLAN_v1.md) | —           |
|    1 | Foundation                     | Monorepo npm workspaces, API Express, web React/Vite, Prisma, herramientas, Playwright                                       | `f542f5e`   |
|    2 | Autenticación                  | Registro, inicio y cierre de sesión; sesiones en servidor; Argon2id                                                          | `095c12c`   |
|    3 | Periodos y asignaturas         | CRUD con propiedad por usuario, un periodo actual, onboarding                                                                | `da5eda9`   |
|  4–5 | Actividades y Dashboard        | Actividades (tipo, prioridad, estado, fechas, filtros) y pantalla de inicio derivada                                         | `6501bd9`   |
|    6 | Agenda                         | Bloques, recurrencia semanal, aviso de solapes                                                                               | `7a031fb`   |
|    7 | Recordatorios                  | Recordatorios internos automáticos y manuales para actividades                                                               | `404a032`   |
|    8 | Radar académico                | Categorías derivadas por tiempo restante                                                                                     | `c0698c0`   |
|    9 | ¿Qué hago ahora?               | Motor de atención determinístico y explicable                                                                                | `b7c7874`   |
|   10 | Progreso y carga               | Progreso por asignatura y carga semanal, descriptivos                                                                        | PR #2       |
|   11 | Captura rápida                 | Parser determinístico de frases cortas con vista previa                                                                      | PR #3       |
|   12 | Bandeja académica              | Mensajes largos a 0–10 propuestas revisables                                                                                 | PR #4       |
|   13 | PWA                            | Manifest, service worker (solo el shell), instalación, aviso de actualización                                                | PR #5       |
|   14 | Importación de horario         | Imagen/PDF con OCR local, vista previa editable                                                                              | PR #6       |
|   15 | UX, accesibilidad y responsive | Pulido transversal, axe, diálogos, 404, sesión expirada, horas de 12 h                                                       | PR #7       |
|   16 | Seguridad                      | Sesiones y cookie endurecidas, CSRF, matriz IDOR, CSP, límites, subidas, errores genéricos                                   | PR #8       |
|   17 | Validación integral            | Escenario de un semestre completo, coherencia entre módulos, fallos inyectados, humo de rendimiento, instalación limpia      | PR #9       |
|   18 | Datos de demostración          | `db:seed:demo` reproducible y seguro; guion de presentación; la base de test se crea sola para Playwright                    | PR #10      |
|   19 | Documentación final            | Índice, arquitectura, modelo de datos, API, requisitos, pruebas, despliegue, limitaciones, decisiones, `docs:check`          | (esta fase) |

## Pendiente

**Fase 20: candidato a versión (Release Candidate).** No iniciada. Las validaciones que siguen abiertas antes de cualquier publicación están en [final-checklist.md](final-checklist.md).
