# Changelog

Todavía **no hay versiones publicadas**: el proyecto no usa números de versión ni etiquetas de lanzamiento (`package.json` declara `0.1.0` solo como valor técnico). La primera versión corresponde a la Fase 20 (candidato a versión). Resumen por fase en [docs/phase-history.md](docs/phase-history.md).

## Unreleased

### Añadido

- Fases 1–10: monorepo, autenticación con sesiones en servidor, periodos y asignaturas, actividades, Dashboard, agenda con recurrencia semanal y aviso de solapes, recordatorios internos, Radar académico, «¿Qué hago ahora?», progreso y carga semanal.
- Fases 11–14: Captura rápida, Bandeja académica, PWA instalable e Importación de horario (OCR local).
- Fases 15–16: pulido de UX y accesibilidad (evaluado con axe y pruebas de teclado) y endurecimiento de seguridad.
- Fase 17: validación integral del sistema (escenario de un semestre completo, coherencia entre módulos, fallos inyectados, humo de rendimiento).
- Fase 18: datos de demostración reproducibles (`npm run db:seed:demo -- --allow-demo`).
- Fase 19: documentación final (índice, arquitectura, modelo de datos, API, requisitos, pruebas, despliegue, desarrollo, limitaciones, decisiones, lista final) y `npm run docs:check`.

### Corregido

- `test:browser` no arrancaba sin la base de test (Fase 18).
- Escáner de seguridad que fallaba en un clon limpio por una URL falsa de prueba (Fase 17).
- Carreras de tests que cerraban sesión con peticiones en vuelo (Fases 17 y 18).
- Test de Agenda en móvil que solo pasaba los lunes (Fase 19).

### Conocido

`npm audit`: 4 vulnerabilidades altas en la cadena del CLI de Prisma (no alcanzables en tiempo de ejecución), pendientes de una versión estable que las corrija. Dispositivos móviles reales, HTTPS y proxy reales sin validar. Ver [docs/limitations.md](docs/limitations.md).
