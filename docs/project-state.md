# Estado del proyecto: Academic Planner

Estado **actual y compacto**. Para entender el sistema: [system-overview.md](system-overview.md) y [architecture.md](architecture.md). Para continuar el trabajo: [CLAUDE.md](../CLAUDE.md) y [development.md](development.md). Historia por fase: [phase-history.md](phase-history.md). Actualízalo al cerrar cada fase.

## Ciclo actual

- **Current release:** `v1.0.0-rc.2` (pre-release publicado; `v1.0.0-rc.1` y `v1.0.0-rc.2` son inmutables).
- **Current work:** ciclo de producto post-RC (automatización de entrada y asistencia académica), en planificación: [roadmap-post-rc.md](roadmap-post-rc.md). Este ciclo **no es una Fase 21**; avanza por etapas y PR pequeños, y cada etapa necesita aprobación explícita.
- **A1 — Schedule Import crea las asignaturas faltantes:** **fusionado** (PR #18, merge `00f63ac`; sin cambio de versión ni tag). La importación propone las asignaturas que no existen y, al confirmar, las crea junto con las clases en una transacción todo-o-nada (`POST /api/schedule-import/confirm`). Detalle: [schedule-import.md](schedule-import.md), [decisions.md](decisions.md#d16-confirmación-en-lote-en-la-importación-de-horario-y-enmienda-de-d5).
- **A4-0 / A4-0b — spike del calendario:** **fusionado** (PR #20, merge `6c9a673`). Solo documentación y herramientas: verificación de los RFC, validación independiente y comparación feed vs «Añadir al calendario» ([spikes/a4-calendar-feed](spikes/a4-calendar-feed/README.md)). Clientes reales y estudiantes: sin probar.
- **UX1-3 — Actividades + Asignaturas:** implementada en su PR (rama `feat/ux1-activities-subjects`), **pendiente de QA real en iPhone** (no DONE): `ActivityCard` con una acción primaria («Completar», tonal) y las secundarias en un menú accesible, estado como píldora sobre el `select` nativo, `RadarBadge` sin emojis, filtros en una fila que se desplaza y panel «Más filtros» propio, Actividades en dos columnas y Asignaturas en tres desde 1024 px, tarjetas de asignatura con monograma y color; deuda `slate-*` del área 21 → 0 ([detalle](ux-accessibility.md#actividades-y-asignaturas-ux1-3)). Sin cambios de datos, endpoints ni lógica; sin dependencias nuevas. **UX2a no se inicia sin aprobación explícita.**
- **UX1-2 / UX1-2.5 / UX1-2.75 — Home, identidad visual «Pulso Ambiental»:** **fusionadas (PR #24) y aprobadas por el mantenedor en un iPhone real con Safari** (HTTP en red local; PWA y HTTPS sin probar; [ux-accessibility.md](ux-accessibility.md#validación-en-dispositivo-real-ux1-2--ux1-25--ux1-275)); se espera refinamiento visual futuro (tarjetas de actividad, formularios, Agenda y Asignaturas siguen más «de sistema»). Detalle de UX1-2: paleta propia (fondo suave, primario índigo, acento teal), jerarquía de superficies, héroe «¿Qué hago ahora?», Home reorganizado y más compacto (Radar en fichas, contadores y progreso visuales), movimiento sutil con `prefers-reduced-motion` ([ux-accessibility.md](ux-accessibility.md#identidad-visual-y-movimiento-ux1-2)). Sin cambios de datos, endpoints ni lógica. Pasada **UX1-2.75** («Pulso Ambiental»: luz ambiental con tono por estado, Home en dos columnas en escritorio, Radar vivo, superficies con sistema; [detalle](ux-accessibility.md#experiencia-ambiental-inteligente-ux1-275)) y pasada **UX1-2.5** en el mismo PR (#24): héroe con personalidad, marca deslizante en la barra inferior, filtro de estado segmentado, selector de días con rebote, confirmación al finalizar, `EmptyState` y marcador de carga; solo CSS, sin dependencias nuevas ([detalle](ux-accessibility.md#movimiento-y-personalidad-ux1-25)). **UX1-3 (Actividades + Asignaturas) está LISTO pero no iniciado** y **no se inicia sin aprobación explícita** ([roadmap](roadmap-post-rc.md#ux1-3-actividades--asignaturas)). Deuda de pruebas: `MASTER` depende de la hora ([TEST-REL-1](roadmap-post-rc.md#deuda-de-fiabilidad-de-pruebas-test-rel-1-futura-no-iniciada)).
- **UX1-1 — shell y navegación:** fusionada (PR #23) y **validada en un iPhone real con Safari** (HTTP en red local; PWA y HTTPS sin probar; [ux-accessibility.md](ux-accessibility.md#validación-en-dispositivo-real-ux1-1)): navegación principal de cuatro destinos (barra inferior en teléfono y tableta, superior desde 1024 px, con área segura de iPhone), «Cerrar sesión» en la barra superior fuera de la navegación, iconos SVG en línea y `PageHeader`; Home y el contenido de las pantallas no se rediseñaron ([ux-accessibility.md](ux-accessibility.md#navegación-y-estructura)). El siguiente paso, **UX1-2** (Home + identidad visual + movimiento, con la [dirección visual](roadmap-post-rc.md#dirección-visual-para-ux1-2) del mantenedor), **no se inicia sin aprobación explícita**.
- **UX1-0 — base visual:** fusionada (PR #22, merge `39f8505`) (rama `feat/ux1-visual-foundation`): tokens de diseño y primitivas `Button`, `Card`, `Badge`, sin rediseñar pantallas ([ux-accessibility.md](ux-accessibility.md#sistema-visual-ux1-0)). El siguiente paso aprobado, UX1-1 (shell y navegación), **no se inicia sin aprobación explícita**.
- **A4.1 — Añadir al calendario:** **fusionado (PR #21, merge `ff1ca2c`) con QA real en iPhone + Safari + Apple Calendar** ([manual-qa.md](spikes/a4-calendar-export/manual-qa.md)); Android, Google Calendar, Outlook y la PWA instalada siguen sin probar. Descarga un `.ics` por actividad, sin feed, token ni migración ([calendar-export.md](calendar-export.md), [D23](decisions.md#d23-añadir-al-calendario-antes-que-el-feed-sincronizado)). **A4.2 (feed sincronizado) está diferido** hasta que haya evidencia.
- **Next implementation target:** el siguiente del [roadmap](roadmap-post-rc.md) (A5, Web Share Target) **no se inicia sin aprobación explícita.**
- Salvo A1, lo demás del roadmap no existe todavía; lo descrito abajo es el estado del RC más A1.

## Fase actual (RC)

- **Estado: Release Candidate `1.0.0-rc.2`** (corrección de la importación de horario sobre rc.1). Roadmap completo (Fases 0–20); `v1.0.0-rc.1` está publicado como pre-release y no se modifica. Código de rc.1 congelado desde `main` `151f6b31`; rc.2 añade solo la corrección de rangos compactos y ruido de escala.
- **No existe una Fase 21.** Cualquier trabajo nuevo (correcciones, versión final, nuevas funciones) requiere un alcance explícito del usuario; nunca se avanza por iniciativa propia. El nuevo ciclo está en [roadmap-post-rc.md](roadmap-post-rc.md).
- El tag `v1.0.0-rc.2` se creó después de fusionar el PR del candidato y está publicado como pre-release ([release-notes-1.0.0-rc.2.md](release-notes-1.0.0-rc.2.md)). Fases 0–19 aprobadas y fusionadas. Tags: `phase-12-complete`, `phase-18-complete`, `v1.0.0-rc.1`, `v1.0.0-rc.2`.
- **Validaciones externas pendientes:** dispositivos iOS/Android reales, HTTPS y proxy reales, despliegue de prueba, decisión de licencia. Ver [final-checklist.md](final-checklist.md).
- Documentos del candidato: [release-notes-1.0.0-rc.2.md](release-notes-1.0.0-rc.2.md) (vigente), [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md), [release-manifest.md](release-manifest.md) y [release-validation.md](release-validation.md) (de rc.1, históricos).

## Producto en una línea

PWA universitaria que **busca facilitar** la organización académica: asignaturas, actividades, agenda, recordatorios internos, Radar académico, «¿Qué hago ahora?», progreso y carga semanal, y tres vías que **proponen sin guardar** (Captura rápida, Bandeja académica, Importación de horario). Principio: «Organizarse no debe convertirse en otra tarea.» No usa IA generativa ni servicios de terceros.

## Arquitectura (resumen; detalle en [architecture.md](architecture.md))

Monorepo npm workspaces: `apps/api` (Express 5, Prisma 7, PostgreSQL 17), `apps/web` (React 19, Vite 8, Tailwind 4, TanStack Query), `packages/core` (reglas puras y Zod compartidos), `e2e` (Playwright). API por capas ruta → controlador → servicio → repositorio (siempre con `userId`) → Prisma. Un recurso ajeno responde el mismo 404. Instantes UTC + `User.timezone`; «vencida», Radar, Atención, progreso y carga **se derivan**, nunca se guardan. Modelo de datos: [data-model.md](data-model.md). API: [api.md](api.md). Decisiones: [decisions.md](decisions.md).

Documentos por módulo: [auth](auth.md), [academic](academic.md), [activities](activities.md), [dashboard](dashboard.md), [schedule](schedule.md), [reminders](reminders.md), [radar](radar.md), [attention-engine](attention-engine.md), [progress-and-workload](progress-and-workload.md), [quick-capture](quick-capture.md), [academic-inbox](academic-inbox.md), [schedule-import](schedule-import.md), [pwa](pwa.md), [ux-accessibility](ux-accessibility.md), [security](security.md), [demo](demo.md).

## Totales de tests (rc.2 + A1 + A4.1 + UX1-0 + UX1-1 + UX1-2 + UX1-2.5)

Vitest: core 869, API 845, web 194 (**1908**). Playwright: 374 por pasada (361 se ejecutan y 13 se omiten a propósito según el viewport: teclado solo en escritorio, tamaño táctil y barra inferior solo en móvil). `MASTER` (`system-validation.spec.ts`) depende de la hora: corrido un jueves antes de las 8 a. m. (Bogotá) falla porque el «Quiz» de la Bandeja («el jueves a las 8 a. m.») supera a «Taller express»; se reprodujo en `d23f8b6`, sin los cambios de UX1-2.5, y pasó en las últimas pasadas completas (8 oct 2026) por la hora, más 9 de seguridad en navegador (`npm run test:security:browser`, configuración aparte). `npm audit`: 4 altas (cadena del CLI de Prisma). Detalle: [testing.md](testing.md), [system-validation.md](system-validation.md).

## Riesgos y limitaciones vigentes

Lista completa en [limitations.md](limitations.md). Lo esencial:

- **Sin validar:** dispositivos iOS/Android reales, HTTPS y proxy reales, despliegue y carga. La lista previa a publicar está en [final-checklist.md](final-checklist.md).
- **Dependencias:** `npm audit` = 4 altas, todas de la cadena del **CLI** `prisma@7.10.0` (`@prisma/config` → `deepmerge-ts`, y `mysql2`): no alcanzables (configuración propia; nunca se conecta a MySQL). El arreglo que propone npm es retroceder a `prisma@6.19.3`; se rechazó. La versión más reciente (`8.0.0-rc.20`) es un candidato, no estable. Pendiente: pasar a la siguiente estable que la corrija. Nunca `npm audit fix --force`.
- **Dependencias (actualización posterior al RC):** la base de avisos añadió `shell-quote` (**crítica**) vía `concurrently`, una herramienta solo de desarrollo; `npm audit` = 6 (4 altas + 2 críticas) y con `--omit=dev` siguen las 4 altas de Prisma. Sin cambios ni `--force` ([security.md](security.md#15-dependencias-npm-audit)).
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
