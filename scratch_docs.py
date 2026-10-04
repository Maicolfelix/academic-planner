def sub(p, a, b):
    s = open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    with open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s.replace(a, b, 1))

ps = 'docs/project-state.md'
sub(ps, "- **Última fase completada y aprobada: Fase 9 (¿Qué hago ahora?).**\n- **Siguiente: Fase 10, sin empezar.**",
    "- **Última fase completada y aprobada: Fase 10 (Progreso y carga semanal)** (PR #2, pendiente de fusionar en `main` por el usuario).\n- **Siguiente: Fase 11, sin empezar.**")
sub(ps, "| 9    | ¿Qué hago ahora?: motor de atención determinístico y explicable              | ver `git log` |",
    "| 9    | ¿Qué hago ahora?: motor de atención determinístico y explicable              | `b7c7874` |\n| 10   | Progreso por asignatura y carga semanal (descriptivas)                       | PR #2 |")
sub(ps, "Documentos por área: [auth](auth.md)",
    "- **Progreso y carga (Fase 10):** `packages/core/src/insights.ts`. Progreso = la regla del Dashboard, por asignatura, alfabético, sin ponderar; \"Sin actividades registradas\" en vez de 0 %. Carga semanal lunes-domingo en la zona del perfil: actividades por el día local de `dueAt` (cualquier estado; una vencida de otra semana no cuenta) + ocurrencias de la agenda (reutiliza `expandBlock`), `scheduledMinutes` reales (una actividad es 1 compromiso y 0 horas), día con más compromisos (compromisos → minutos → día más temprano), sin niveles alta/baja. `GET /api/progress` y `GET /api/workload?week=` (solo periodo actual, consultas constantes). Detalle en [progress-and-workload.md](progress-and-workload.md).\n\nDocumentos por área: [auth](auth.md)")
sub(ps, "[attention-engine](attention-engine.md).", "[attention-engine](attention-engine.md), [progress-and-workload](progress-and-workload.md).")
sub(ps, "## Totales de tests (tras la Fase 9)", "## Totales de tests (tras la Fase 10)")
sub(ps, "Vitest: core 345, API 418, web 28 (791). Playwright: 94", "Vitest: core 385, API 471, web 28 (884). Playwright: 104")
sub(ps, "- El stack e2e (`npm run dev:e2e`)",
    "- **Problema conocido sin causa raíz (e2e):** en la Fase 10 una pasada completa de Playwright falló una vez (`dashboard.spec`, al final del test) con `net::ERR_CONNECTION_REFUSED`: un error de transporte, no una aserción sobre la app. En el stack con el servidor de desarrollo de Vite hubo varios casos (reproducido el mecanismo con 800 conexiones simultáneas); con `vite preview` apareció 1 vez en 11 pasadas completas y no se reprodujo en 8 pasadas completas seguidas ni en 80 repeticiones del test aislado, así que no se pudo capturar su traza. Si reaparece: guardar la traza de ese fallo, ver qué URL rechaza la conexión y no limitarse a repetir hasta que salga verde.\n- El stack e2e (`npm run dev:e2e`)")

cm = 'CLAUDE.md'
sub(cm, "- Fase actual: **9 aprobada. Fase 10 sin empezar**", "- Fase actual: **10 aprobada. Fase 11 sin empezar**")
sub(cm, "- Atención (Fase 9):",
    "- Progreso y carga (Fase 10): descriptivos, derivados y nunca guardados (`packages/core/src/insights.ts`). Progreso por asignatura = la regla del Dashboard, alfabético y sin ponderar; carga semanal lunes-domingo en la zona del perfil, reutilizando `expandBlock` de la agenda; una actividad es 1 compromiso y 0 horas; sin niveles de carga ni lenguaje de juicio (\"sobrecargado\", \"deberías\").\n- Atención (Fase 9):")
print('ok')
