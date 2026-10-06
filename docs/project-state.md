# Estado del proyecto: Academic Planner

Estado **actual y compacto**. Para entender el sistema: [system-overview.md](system-overview.md) y [architecture.md](architecture.md). Para continuar el trabajo: [CLAUDE.md](../CLAUDE.md) y [development.md](development.md). Historia por fase: [phase-history.md](phase-history.md). Actualízalo al cerrar cada fase.

## Fase actual

- **Última fase completada y aprobada: Fase 19 (documentación final)**, rama `docs/phase-19-final-documentation`, PR pendiente de fusionar por el usuario. Base: `main` `a4b9920` (Fase 18 fusionada, PR #10). Checkpoint: tag `phase-18-complete`.
- **Siguiente: Fase 20 (candidato a versión), sin empezar.** Solo se implementa cuando el usuario entregue su prompt; nunca se avanza por iniciativa propia.
- Fases 0–18 aprobadas y fusionadas en `main`. Sin versiones publicadas ([CHANGELOG.md](../CHANGELOG.md)).

## Producto en una línea

PWA universitaria que **busca facilitar** la organización académica: asignaturas, actividades, agenda, recordatorios internos, Radar académico, «¿Qué hago ahora?», progreso y carga semanal, y tres vías que **proponen sin guardar** (Captura rápida, Bandeja académica, Importación de horario). Principio: «Organizarse no debe convertirse en otra tarea.» No usa IA generativa ni servicios de terceros.

## Arquitectura (resumen; detalle en [architecture.md](architecture.md))

Monorepo npm workspaces: `apps/api` (Express 5, Prisma 7, PostgreSQL 17), `apps/web` (React 19, Vite 8, Tailwind 4, TanStack Query), `packages/core` (reglas puras y Zod compartidos), `e2e` (Playwright). API por capas ruta → controlador → servicio → repositorio (siempre con `userId`) → Prisma. Un recurso ajeno responde el mismo 404. Instantes UTC + `User.timezone`; «vencida», Radar, Atención, progreso y carga **se derivan**, nunca se guardan. Modelo de datos: [data-model.md](data-model.md). API: [api.md](api.md). Decisiones: [decisions.md](decisions.md).

Documentos por módulo: [auth](auth.md), [academic](academic.md), [activities](activities.md), [dashboard](dashboard.md), [schedule](schedule.md), [reminders](reminders.md), [radar](radar.md), [attention-engine](attention-engine.md), [progress-and-workload](progress-and-workload.md), [quick-capture](quick-capture.md), [academic-inbox](academic-inbox.md), [schedule-import](schedule-import.md), [pwa](pwa.md), [ux-accessibility](ux-accessibility.md), [security](security.md), [demo](demo.md).

## Totales de tests (Fase 19)

Vitest: core 766, API 782, web 37 (**1585**). Playwright: 258 por pasada (254 se ejecutan y 4 se omiten a propósito según el viewport: teclado solo en escritorio, tamaño táctil solo en móvil), más 9 de seguridad en navegador (`npm run test:security:browser`, configuración aparte). `npm audit`: 4 altas (cadena del CLI de Prisma). Detalle: [testing.md](testing.md), [system-validation.md](system-validation.md).

## Riesgos y limitaciones vigentes

Lista completa en [limitations.md](limitations.md). Lo esencial:

- **Sin validar:** dispositivos iOS/Android reales, HTTPS y proxy reales, despliegue y carga. La lista previa a publicar está en [final-checklist.md](final-checklist.md).
- **Dependencias:** `npm audit` = 4 altas, todas de la cadena del **CLI** `prisma@7.10.0` (`@prisma/config` → `deepmerge-ts`, y `mysql2`): no alcanzables (configuración propia; nunca se conecta a MySQL). El arreglo que propone npm es retroceder a `prisma@6.19.3`; se rechazó. La versión más reciente (`8.0.0-rc.20`) es un candidato, no estable. Pendiente: pasar a la siguiente estable que la corrija. Nunca `npm audit fix --force`.
- **Seguridad:** límites de frecuencia en memoria y por proceso; el registro revela si un correo existe; sin verificación de correo, recuperación de contraseña ni MFA; sesión fija de 7 días ([security.md](security.md)).
- **Interfaz:** no hay pantalla para editar el periodo ni la zona horaria después del onboarding.
- **Recordatorios:** un AUTO eliminado no vuelve hasta que cambie la fecha, el tipo o el estado; los desfases son minutos absolutos; `/api/reminders/due` solo cubre el periodo actual.
- **Pruebas (Fase 19):** un test de Fase 15 («times use one 12-hour style») dependía del día de la semana: el sembrado pone las clases en lunes y a 360 px la Agenda muestra solo «hoy», así que fallaba cualquier otro día (nunca se había visto porque las pasadas anteriores cayeron en lunes). Corregido eligiendo el lunes explícitamente; 3 pasadas completas verdes después (254 pasan + 4 omitidas, ≈ 7,3 min).
- **Pruebas:** `MaxListenersExceededWarning` de Node con Supertest (P17-04), sin efecto funcional. Una falla intermitente no se arregla repitiendo: se guarda la traza.
- **E2E (historial):** `ERR_CONNECTION_REFUSED` intermitente tuvo como causa verificada que `vite preview` con `host: localhost` escucha solo en IPv6; el stack e2e usa `WEB_HOST=::`. No reapareció tras ese cambio en numerosas pasadas completas. Si reaparece, guardar la traza y ver qué URL se rechaza.
- **Entorno:** una `npm run dev` huérfana ensucia `test:browser` y la BD de desarrollo ([development.md](development.md#problemas-comunes)).
- Sin archivo de licencia (decisión del propietario).

## Comandos de validación

Requisitos: Node ≥ 22.18 (probado 24.19), Docker Desktop corriendo.

```bash
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
npm ci
npm run db:up            # PostgreSQL en :5433
npm run db:deploy        # migraciones a la BD de desarrollo
npm run lint
npm run format:check
npm run typecheck        # compila core, tipos de todos los workspaces y e2e
npm test                 # Vitest (core, api, web); crea y migra academic_planner_test
npm run build
npm run test:security
PW_CHANNEL=msedge npm run test:browser   # levanta su propio stack `dev:e2e`; antes, nada escuchando en :3000/:5173
npm run docs:check
```

Verificación de instalación limpia: `docker compose down -v` (desde la carpeta que creó el contenedor), borrar `node_modules`, `dist`, `apps/api/src/generated`, `test-results` y `.env`, y repetir la secuencia. Comprobar también que no hay deriva de esquema (`prisma migrate diff … --exit-code`) y que la BD de desarrollo queda sin filas tras los tests.

## Cómo trabajar una fase

1. Leer el prompt de la fase y limitarse a ese alcance.
2. Implementar por capas con pruebas (núcleo, API con BD real, web, Playwright); probar propiedad (IDOR), concurrencia y zona horaria; hacer _mutation checks_ y revertirlos.
3. Ejecutar la validación completa desde instalación limpia.
4. Entregar el informe estructurado terminado en `FASE N APROBADA` o `FASE N BLOQUEADA`.
5. Commit, push y PR solo si la fase queda aprobada; el PR no se fusiona sin orden del usuario.

## Estrategia de ramas y PR

Una rama por fase (`feat/phase-N-…`, `test/…`, `docs/…`) desde `main`, un commit por fase y un PR por fase que el usuario autoriza fusionar (merge commit). Tras fusionar se puede etiquetar un checkpoint (`phase-12-complete`, `phase-18-complete`). `main` es la fuente persistente del proyecto.
