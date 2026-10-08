# Dashboard académico (Fase 5)

El Dashboard (`/dashboard`, "Inicio") responde en pocos segundos: qué tengo pendiente, qué vence pronto, qué está vencido, qué terminé,
qué mirar primero y cómo voy en el periodo actual. **No guarda nada propio**: todo se deriva en cada petición de `User`, `AcademicPeriod`, `Subject` y `Activity`.

## Endpoint: `GET /api/dashboard`

Sin parámetros. El usuario, su zona horaria y el periodo salen de la sesión (periodo = el actual del usuario); un `userId` o `periodId` en la query se **ignora**
(hay tests de integración y de navegador que lo comprueban). Respuesta `{ dashboard }` validada con un esquema Zod compartido (`dashboardSchema` en `@planner/core`):

| Campo                      | Contenido                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generatedAt`, `localDate` | instante de la respuesta y la fecha de hoy **en la zona del usuario** (`YYYY-MM-DD`)                                                              |
| `greeting`                 | "Buenos días" / "Buenas tardes" / "Buenas noches"                                                                                                 |
| `period`                   | periodo actual (`null` si aún no hay: la app lo manda a onboarding, y el endpoint no falla)                                                       |
| `subjectCount`             | asignaturas del periodo actual                                                                                                                    |
| `summary`                  | `total`, `pending`, `inProgress`, `completed`, `overdue` (solo periodo actual)                                                                    |
| `progress`                 | `completed`, `total`, `percent`                                                                                                                   |
| `nextDue`                  | primera actividad abierta y aún no vencida, por fecha (de `today` o `upcoming`)                                                                   |
| `today`                    | abiertas, aún no vencidas, que vencen en el día local de hoy                                                                                      |
| `upcoming`                 | abiertas que vencen después de hoy, la más próxima primero, **máximo 5**                                                                          |
| `overdue`                  | abiertas y vencidas, la más atrasada primero, **máximo 10** (el total real va en `summary.overdue`)                                               |
| `classesToday`             | _(Fase 6)_ clases (`type = CLASS`) de hoy en el día local del usuario, del periodo actual, por hora, **máximo 5**; ver [schedule.md](schedule.md) |

Cada actividad de las listas lleva `subject: { id, name, color }` (unida en la misma consulta). La respuesta es `Cache-Control: no-store`.

## Reglas de cálculo

- **Abierta** = `status != COMPLETED`. **Vencida** = abierta y `dueAt < now` (misma regla estricta que `isOverdue`; en el instante exacto del límite aún no).
- **Las tres listas no se solapan**: una actividad es vencida, de hoy o próxima, nunca dos. Una de hoy cuya hora ya pasó (vencía hoy a las 10:00 y son las 14:00)
  está en `overdue` ("Venció hoy"), no en `today`. La UI además no repite `nextDue` dentro de `today`/`upcoming`.
- **Orden de vencidas**: la más atrasada primero (`dueAt` ascendente). Es la más crítica y la más fácil de olvidar; con tope de 10 y un enlace a la lista completa filtrada.
- **`nextDue`**: solo por fecha (la primera de `today` ∪ `upcoming`). No hay scoring ni recomendación: eso llega con "¿Qué hago ahora?" (Fase 9).
- **Progreso** (`calculateProgress`): `finalizadas / total × 100`, redondeado al entero más cercano (1/3 → 33, 2/3 → 67, 18/25 → 72), y sin total → 0.
  Para no exagerar: **100 solo si todo está finalizado** (199/200 muestra 99) y **0 solo si no hay ninguna finalizada** (1/300 muestra 1).
  Se llama "Progreso de actividades" y la tarjeta aclara que mide solo lo registrado: no es rendimiento, notas ni conocimiento.

## Zona horaria y "hoy"

"Hoy" es el día local del usuario (`User.timezone`), no el UTC ni el del navegador. El servicio calcula `localDate` con `toLocalParts(now, tz)` y el fin del día con `localDayBounds`;
`today` = `[now, fin del día local]`. `now` se inyecta (`clock` de `createApp`), así que los tests fijan el reloj. Casos verificados: Asia/Tokyo (UTC+9, donde ya es "mañana" en UTC),
America/Los_Angeles (UTC−7, donde aún es "ayer" en UTC) y el cambio de día a la medianoche local.

## Saludo: una sola ubicación

La regla vive en **una función de `@planner/core`** (`greetingForTime`: 05:00–11:59 días, 12:00–18:59 tardes, resto noches, sobre el reloj del perfil del usuario).
La ejecuta **el backend** y envía el texto en `greeting`; el frontend solo lo muestra (`{greeting}, {nombre}`), así que no existe la regla duplicada ni depende de la hora del dispositivo.
Las etiquetas "Vence hoy / mañana / en 3 días" salen de otra función pura (`dueRelativeLabel`, basada en días de calendario locales) y solo describen la fecha: no son un Radar.

## Consultas (rendimiento)

Una petición ejecuta **9 consultas** (8 hasta la Fase 5; la Fase 6 añadió las clases de hoy), constantes sin importar cuántas actividades haya:

1. sesión (con su usuario en un solo `JOIN`) — autenticación;
2. periodo actual;
   3–9. en paralelo: conteo de asignaturas, **un** `GROUP BY` para los conteos por estado, conteo de vencidas, las tres listas (cada una con su asignatura unida por `JOIN`) y los **bloques `CLASS` candidatos de hoy** (las reglas semanales se expanden en memoria solo para hoy).

No hay N+1 (ninguna consulta por tarjeta ni por fila). Para obtener los `JOIN` se activó `relationLoadStrategy: 'join'` (`previewFeatures = ["relationJoins"]` en el generador de Prisma):
sin él, Prisma hacía una consulta extra por cada `include` (12 consultas en total). Un test cuenta las consultas con 3 y con 153 actividades y exige que sean las mismas;
medido en desarrollo: **~18 ms** con 153 actividades, incluida la autenticación.

## Frontend

- `useDashboard()` (TanStack Query, clave `['dashboard']`). Toda mutación que puede cambiarlo la invalida: crear/editar/borrar/cambiar estado de una actividad, crear/editar/borrar una asignatura y crear un periodo.
  Al volver desde Actividades se ve el dato nuevo sin F5.
- Jerarquía **vigente en UX1-2** (ver [ux-accessibility.md](ux-accessibility.md#identidad-visual-y-movimiento-ux1-2)): saludo y periodo → recordatorios → **¿Qué hago ahora?** (héroe) → clases de hoy → vencidas → para hoy → contadores → progreso → Captura rápida → Radar (fichas compactas) → próxima entrega → próximas entregas → semana. Lo siguiente es la jerarquía **anterior**, conservada como referencia de contenido: saludo y periodo → resumen (4 contadores compactos, cada uno enlaza a su lista filtrada) → **Próxima entrega** → Vencidas → Para hoy → Próximas entregas → Progreso (barra CSS, `role="progressbar"` con `aria-valuenow` y texto) → accesos rápidos.
  Una sola `h1`, el resto `h2`. Los indicadores llevan texto y símbolo, nunca solo color. Secciones vacías (Vencidas, Para hoy, Próximas) no se muestran.
- Estados: cargando, error con "Reintentar", sin periodo (el guard de onboarding sigue activo), sin asignaturas ("Aún no tienes asignaturas." → "Agregar asignatura") y con asignaturas pero sin actividades
  ("Todavía no tienes actividades registradas." → "Agregar actividad"): nunca una pared de ceros.
- Accesos rápidos ("Nueva actividad", "Nueva asignatura") **no duplican formularios**: navegan a `/activities?action=create` y `/subjects?action=create`; esas páginas abren su formulario existente y quitan el parámetro de la URL.
