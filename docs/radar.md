# Radar académico (Fase 8)

## Objetivo

Convertir la fecha límite de cada actividad **abierta** en una categoría visual sencilla, para que el estudiante vea de un vistazo cuáles compromisos necesitan más atención **temporal**. Es 100 % determinístico y explicable: _"si faltan menos de 24 horas, se clasifica como Atención inmediata"_.

El Radar solo mira cuatro cosas: la fecha límite, el estado de la actividad, el instante actual y (solo para el texto) la zona horaria. **No** predice notas ni rendimiento, **no** mide estrés ni dificultad, **no** usa IA y **no** decide qué hacer primero (eso es una fase posterior).

## Categorías y límites

`restante = dueAt − ahora` (instantes absolutos, en milisegundos).

| Categoría       | Etiqueta              | Condición (actividad abierta)            |
| --------------- | --------------------- | ---------------------------------------- |
| `OVERDUE`       | 🔴 Vencida            | `restante < 0`                           |
| `IMMEDIATE`     | 🔴 Atención inmediata | `0 ≤ restante < 24 h`                    |
| `UPCOMING`      | 🟠 Próxima            | `24 h ≤ restante ≤ 72 h`                 |
| `PLANNABLE`     | 🟡 Planificable       | `72 h < restante ≤ 7 días`               |
| `UNDER_CONTROL` | 🟢 Bajo control       | `restante > 7 días`                      |
| _(ninguna)_     | —                     | `COMPLETED`: no tiene categoría (`null`) |

Reglas de borde, sin zonas ambiguas (cada instante cae en exactamente una categoría):

| Caso                       | Resultado                                                     |
| -------------------------- | ------------------------------------------------------------- |
| vencida por 1 ms           | `OVERDUE`                                                     |
| exactamente `dueAt`        | `IMMEDIATE` (coherente con `isOverdue`, que usa `<` estricto) |
| 23 h 59 min 59 s restantes | `IMMEDIATE`                                                   |
| 24 h exactas / 24 h + 1 ms | `UPCOMING`                                                    |
| 72 h exactas               | `UPCOMING`                                                    |
| 72 h + 1 ms                | `PLANNABLE`                                                   |
| 7 días exactos             | `PLANNABLE`                                                   |
| 7 días + 1 ms              | `UNDER_CONTROL`                                               |

> Desviación mínima de la especificación: `IMMEDIATE` pedía "tiempo restante > 0". Con `> 0`, el instante exacto `restante = 0` no pertenecería a ninguna categoría (no es vencida porque `isOverdue` usa `<`). Se resolvió con `≥ 0`, de modo que no queda ningún hueco.

## Regla única (fuente de verdad)

`packages/core/src/radar.ts`:

- `calculateRadarStatus(activity, now)` → `RadarStatus | null`. No recibe zona horaria: no puede depender de ella.
- `radarDueRange(status, now)` → rango de `dueAt` equivalente, para filtrar en la base de datos. Un test del core comprueba que ambas representaciones coinciden en cada límite (±1 ms) y que no hay huecos ni solapes.
- `radarExplanation(activity, now, timeZone)` → texto corto.
- `RADAR_LABELS`, `RADAR_GROUP_LABELS`, `RADAR_SYMBOLS`, `RADAR_GROUP_LIMIT` y los esquemas Zod de la respuesta.

La API, el Dashboard y `ActivityCard` **no repiten la regla**: la importan.

## Por qué no se guarda

La categoría cambia sola con el tiempo (`BAJO CONTROL → PLANIFICABLE → PRÓXIMA → INMEDIATA → VENCIDA`) sin ninguna escritura ni job. Una columna `radarStatus` quedaría desactualizada al minuto siguiente. Por eso no existe en `Activity`: se calcula en cada lectura, igual que "vencida".

## Duración real vs. etiquetas de calendario

La **categoría** usa duración real, no días de calendario: 23 h restantes son `IMMEDIATE` aunque la fecha diga "mañana". Las etiquetas humanas ("vence hoy", "vence mañana", `dueRelativeLabel`) son otro concepto y se mantienen aparte.

El **texto** del Radar (`radarExplanation`):

- `IMMEDIATE`: tiempo real restante ("Vence en 5 horas", "Vence en 35 minutos"), porque "hoy/mañana" contradiría la categoría.
- Resto: la etiqueta de calendario de siempre (`dueRelativeLabel`: "Vence mañana", "Vence en 5 días", "Venció hace 2 días"), así una tarjeta nunca dice dos cosas distintas.

## Zona horaria

`dueAt` ya está en UTC. La categoría depende solo del instante: el mismo `dueAt` y el mismo `now` dan la misma categoría con cualquier zona de perfil o del navegador. La zona solo afecta al texto de calendario fuera de las últimas 24 h.

## Radar ≠ prioridad ≠ estado ≠ recordatorio

- **Prioridad:** una actividad `LOW` que vence en 2 h es `IMMEDIATE`; una `HIGH` que vence en 10 días es `UNDER_CONTROL`. No hay fórmula `urgencia + prioridad` (es de una fase posterior).
- **Estado:** `PENDING` e `IN_PROGRESS` participan; `COMPLETED` no tiene categoría. `OVERDUE` es una condición del Radar, nunca un valor de `status`.
- **Recordatorios:** independientes. Una actividad puede ser `IMMEDIATE` sin tener ningún recordatorio vencido; el Radar no los lee.
- **Progreso:** la fórmula no cambia; el Radar no la afecta.

## API

`GET /api/radar` (sesión; sin parámetros; `Cache-Control: no-store`). El usuario y el periodo actual salen de la sesión.

```json
{
  "radar": {
    "generatedAt": "...",
    "period": {},
    "summary": { "overdue": 2, "immediate": 1, "upcoming": 3, "plannable": 4, "underControl": 7 },
    "groups": {
      "overdue": [],
      "immediate": [],
      "upcoming": [],
      "plannable": [],
      "underControl": []
    }
  }
}
```

- Solo actividades **abiertas** del **periodo actual** del usuario; sin periodo, ceros y listas vacías.
- Cada grupo está ordenado por `dueAt` ascendente; en `overdue` eso significa **la más atrasada primero** (igual que el Dashboard).
- Máximo `RADAR_GROUP_LIMIT = 10` por grupo; `summary` siempre trae el conteo real. Si hay más, la UI muestra "+ N más" con enlace a Actividades filtradas.
- Rendimiento: 2 consultas (periodo actual + actividades abiertas con su asignatura en un `JOIN`), sin importar cuántas actividades haya; la clasificación se hace en memoria con la regla del core. Medido con 200 actividades: ver el informe de la fase.

### Filtro en Actividades

`GET /api/activities?radar=OVERDUE|IMMEDIATE|UPCOMING|PLANNABLE|UNDER_CONTROL`. Lo resuelve el backend (`radarDueRange` + `status != COMPLETED`), no el navegador. Se combina con los demás filtros (AND). Un valor desconocido, o `COMPLETED`, da 400.

### Por qué no va en el DTO de `Activity`

Se evaluaron dos opciones: (A) añadir `radarStatus` al DTO o (B) calcularlo donde se necesite. Se eligió **B**: el DTO es un instante congelado y la categoría caduca; el navegador la calcula con la misma función del core y el reloj de la página (`useNow`, cada minuto), por lo que la tarjeta cambia sin recargar. Así tampoco hay dos cálculos que puedan discrepar. La `ActivityCard` ya hacía lo mismo con `isOverdue`.

## Interfaz

- **Dashboard:** tarjeta compacta "Radar académico": lista vertical con las cinco categorías (símbolo + texto + conteo). Cada fila enlaza a `/activities?radar=…`. Enlace "Ver el Radar completo".
- **`/radar`:** vista agrupada (solo grupos con actividades), con "+ N más". Se llega desde el Dashboard; **no** se añadió a la barra de navegación para no llenarla.
- **`ActivityCard`:** insignia Radar en actividades abiertas (reemplaza a la antigua insignia "Vencida", que ahora es la categoría `OVERDUE`) y el texto "Vence en 5 horas". Nada en las finalizadas. Estado, prioridad y tipo se mantienen.
- **Accesibilidad:** el color es un apoyo; cada categoría tiene texto, símbolo decorativo (`aria-hidden`) y etiqueta. Fondos tenues, borde y texto oscuro (sin texto amarillo claro sobre blanco). Todo es accesible por teclado; encabezados h1/h2 correctos; objetivos táctiles ≥ 44 px.

## Actualización periódica

Sin WebSocket ni polling por segundo. `useRadar`: `refetchInterval` de 60 s y `staleTime` de 30 s; las mutaciones de actividades invalidan `['radar']`. Las tarjetas recalculan con el reloj de la página cada minuto. Limitación: si el reloj del dispositivo está desfasado respecto al servidor, la tarjeta y el resumen pueden discrepar unos minutos (igual que ya ocurría con "Vencida").

## Ejemplos

Con "ahora" = lunes 12:00 (Bogotá):

| Actividad vence       | restante     | Categoría          | Texto             |
| --------------------- | ------------ | ------------------ | ----------------- |
| lunes 10:00           | −2 h         | Vencida            | Venció hoy        |
| martes 11:00          | 23 h         | Atención inmediata | Vence en 23 horas |
| martes 12:00          | 24 h         | Próxima            | Vence mañana      |
| jueves 12:00          | 72 h         | Próxima            | Vence en 3 días   |
| jueves 12:01          | 72 h 1 min   | Planificable       | Vence en 3 días   |
| lunes siguiente 12:00 | 7 días       | Planificable       | Vence en 7 días   |
| lunes siguiente 12:01 | 7 días 1 min | Bajo control       | Vence en 7 días   |
