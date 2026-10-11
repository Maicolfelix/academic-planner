# Motor de atención: "¿Qué hago ahora?" (Fase 9)

## Objetivo

Responder, con reglas transparentes: **¿cuál de mis actividades abiertas merece más atención en este momento?** El sistema orienta ("Actividad que requiere mayor atención", "Te sugerimos revisar…"); el estudiante decide. Nunca dice "debes hacer esto".

Es **determinístico, reproducible, testeable y explicable**: con las mismas entradas y el mismo `now` devuelve siempre lo mismo, y cada sugerencia viene con razones en lenguaje humano. No hay caja negra.

## Qué NO es

- No usa IA, modelos de lenguaje, APIs externas ni aprendizaje automático. Las razones salen de **plantillas fijas**.
- No predice notas, rendimiento, estrés ni dificultad, y no mide al estudiante. No usa historial, hábitos, horas de estudio ni calificaciones.
- No usa recordatorios, carga semanal ni horarios (`ScheduleBlock`): son sistemas separados.
- No guarda nada: ni `attentionScore` en `Activity` ni historial de sugerencias. Se recalcula en cada lectura.

## Variables (solo cuatro)

1. **Radar** (Fase 8): categoría por tiempo real restante. El motor importa `calculateRadarStatus`; no repite la regla.
2. **Priority** (la fija el estudiante): `HIGH` / `MEDIUM` / `LOW`.
3. **Status**: solo participan `PENDING` e `IN_PROGRESS`. `COMPLETED` nunca.
4. **Tiempo exacto hasta `dueAt`**: solo como desempate dentro de la misma puntuación (sin componente continuo; ver más abajo).

Ámbito: actividades **abiertas** del **periodo actual** del usuario.

## Fórmula

```
score = peso del nivel + peso de prioridad + bono de "en proceso"
```

| Nivel (Radar)                               | Peso |
| ------------------------------------------- | ---- |
| `OVERDUE` (vencida hace **≤ 7 días**)       | 60   |
| `IMMEDIATE` (< 24 h)                        | 50   |
| `UPCOMING` (24 h – 72 h)                    | 40   |
| `PLANNABLE` (72 h – 7 días)                 | 30   |
| `OVERDUE_STALE` (vencida hace **> 7 días**) | 20   |
| `UNDER_CONTROL` (> 7 días)                  | 10   |

| Prioridad | Peso |
| --------- | ---- |
| `HIGH`    | 9    |
| `MEDIUM`  | 5    |
| `LOW`     | 1    |

| Estado        | Bono |
| ------------- | ---- |
| `IN_PROGRESS` | +1   |
| `PENDING`     | 0    |

El score es un detalle interno: **no se muestra** al estudiante ni se devuelve en la API. Solo aparece en tests y en este documento.

## Por qué estos pesos

Se analizaron los valores propuestos (Radar 50/40/30/20/10, prioridad 9/5/1, bono +2) con un barrido de **todas** las combinaciones de nivel, prioridad y estado:

| Variante                                                 | Brecha entre niveles | Mayor aporte de prioridad + estado | Resultado                                                                                    |
| -------------------------------------------------------- | -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Radar 50/40/30/20/10, 9/5/1, bono **+2**                 | 10                   | 10                                 | 0 cruces, **4 empates exactos** entre niveles distintos (se resolvían solo por el desempate) |
| Radar 50/40/30/20/10, 9/5/1, bono **+1**                 | 10                   | 9                                  | 0 cruces, 0 empates                                                                          |
| Final: 6 niveles (60/50/40/30/20/10), 9/5/1, bono **+1** | 10                   | 9                                  | 0 cruces, 0 empates                                                                          |

Decisiones:

1. **El bono de "en proceso" baja a +1.** Con +2, una `LOW` pendiente de un nivel empataba exactamente con una `HIGH` en proceso del nivel menos urgente. Con +1 el nivel gana siempre y por construcción, sin depender del desempate.
2. **La urgencia temporal domina.** La brecha entre niveles (10) es mayor que cualquier ayuda de prioridad + estado (9 = `HIGH` + en proceso − `LOW`). Así, una `HIGH` que vence en 20 días **nunca** supera a una `LOW` que vence en 2 horas ni a una vencida. La prioridad ordena **dentro** del nivel, nunca lo sustituye.
3. **El bono es pequeño a propósito** (menor que cualquier salto de prioridad, que es de 4 o más): "ya empezada" desempata, pero una prioridad mayor sigue ganando.
4. Un test comprueba este invariante a partir de las constantes y otro recorre todas las combinaciones, de modo que cambiar un peso sin pensar rompe la suite.

## Vencidas

Las vencidas **participan**: una vencida puede merecer más atención que una futura. Para que una olvidada durante meses no domine siempre:

- El nivel `OVERDUE` tiene un peso **finito** (60): el score no crece con los días de atraso.
- Una actividad vencida hace **más de 7 días** (estricto: exactamente 7 sigue siendo reciente) pasa al nivel `OVERDUE_STALE` (20). Sigue siendo candidata y, para el Radar, sigue siendo `OVERDUE`, pero queda **por debajo de todo lo que vence en los próximos 7 días** y por encima de lo que vence en más de una semana.
- Entre vencidas del mismo nivel, la más atrasada va primero (igual que el Dashboard).
- Si solo hay vencidas, se sugiere igualmente una, con lenguaje neutral: "Tienes actividades vencidas. Esta es la que actualmente requiere mayor atención."

## Desempates (orden total)

1. Mayor score.
2. `dueAt` más cercano.
3. `IN_PROGRESS` antes que `PENDING`.
4. Mayor prioridad.
5. `createdAt` más antiguo.
6. `id` (último recurso estable).

Con los pesos actuales los pasos 3 y 4 ya están dentro del score (solo deciden si se fuerza un empate de score en un test); se conservan para que la regla siga completa si un peso cambia. El servicio **siempre** aplica este comparador: nunca hereda el orden de PostgreSQL.

## Sin componente de tiempo continuo

El Radar ya captura la urgencia temporal y `dueAt` desempata. No se añadió una fórmula continua para mantener el motor sencillo y explicable. Limitación asumida: dentro de un mismo nivel el score decide antes que la fecha (ver escenario 6).

## Razones (plantillas fijas)

| Condición              | Razón                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `OVERDUE`              | "Esta actividad ya está vencida." y, a continuación, "Venció ayer." / "Venció hace N días." |
| `IMMEDIATE`            | "Vence en menos de 24 horas."                                                               |
| `UPCOMING`             | "Vence en los próximos 3 días."                                                             |
| `PLANNABLE`            | "Vence durante esta semana."                                                                |
| `UNDER_CONTROL`        | "La fecha límite aún está a más de una semana."                                             |
| `priority = HIGH`      | "Tiene prioridad alta."                                                                     |
| `status = IN_PROGRESS` | "Ya comenzaste esta actividad."                                                             |

`MEDIUM` y `LOW` no son razones (decir "prioridad baja" no es un motivo para sugerir). La zona horaria solo afecta al texto "Venció …" (calendario del perfil); la categoría y el orden no dependen de ella.

## API y UI

- `GET /api/attention` (sesión; sin parámetros; `Cache-Control: no-store`): `{ generatedAt, period, recommendation, alternatives, upcoming }`. `recommendation` es `null` si no hay actividades abiertas. `alternatives` trae hasta 2 más (3 candidatas en total). Cada elemento: `activity` (con su asignatura), `radarStatus` y `reasons`. `upcoming` (nuevo) trae las hasta 5 actividades abiertas **con la fecha límite más cercana** (`dueAt` ascendente; empate: la más antigua y luego el id; una vencida hace más de una semana no entra; vacío si solo quedan olvidadas, y entonces el héroe vuelve a `recommendation`): es lo que recorre el carrusel del Inicio, y su primer ítem es lo que antes mostraba el héroe. **No incluye el score.** El ranking por score (`recommendation`/`alternatives`) sigue siendo el invariante del motor; solo cambió el orden con que el Inicio muestra las actividades. Por qué 5: se ve la semana que viene sin convertir el héroe en una lista (la lista completa está en Actividades) y los puntos siguen siendo un control que se puede tocar. 2 consultas (periodo actual + actividades abiertas) y el ranking se hace en memoria.
- Dashboard: tarjeta **"¿Qué hago ahora?"** tras el resumen: una sola sugerencia, insignias (Radar, prioridad, estado), fecha, "¿Por qué esta?" con las razones como lista y el enlace "Ver actividad", que abre esa actividad en el formulario de edición (`/activities?edit=<id>`; no hay página nueva). Las alternativas se devuelven en la API pero **no** se muestran todavía.
- Tono: "Actividad que requiere mayor atención.", "Todo está bajo control. Si quieres avanzar, podrías continuar con:", "No tienes actividades pendientes en este momento."
- Actualización: `['attention']` se re-lee cada 60 s (`staleTime` 30 s) y se invalida con cualquier mutación de actividades (crear, editar prioridad/estado/fecha, completar, eliminar). Los recordatorios no influyen.

## Escenarios numéricos

Con "ahora" fijo. Todos están cubiertos por tests de core y de API.

1. **`LOW` en 2 h vs `HIGH` en 10 días.** A: `IMMEDIATE` 50 + 1 = **51**. B: `UNDER_CONTROL` 10 + 9 = **19**. Gana A: la prioridad alta no compensa una fecha lejana.
2. **`LOW` a 3 días vs `HIGH` a 2 días** (ambas `UPCOMING`; 72 h exactas siguen siendo `UPCOMING`). A: 40 + 1 = **41**. B: 40 + 9 = **49**. Gana B: dentro del nivel decide la prioridad.
3. **`HIGH` en 12 h pendiente vs `HIGH` en 13 h en proceso.** A: 50 + 9 + 0 = **59**. B: 50 + 9 + 1 = **60**. Gana B (ya empezada), aunque vence una hora después: el score decide antes que la fecha. Es el comportamiento documentado de un bono pequeño.
4. **Vencida ayer (`LOW`) vs `IMMEDIATE` `HIGH` en proceso.** A: 60 + 1 = **61**. B: 50 + 9 + 1 = **60**. Gana A: una vencida reciente va primero incluso frente al mejor caso del nivel siguiente.
5. **Vencida hace 30 días (`HIGH`, en proceso) vs `LOW` que vence en 1 hora.** A: `OVERDUE_STALE` 20 + 9 + 1 = **30**. B: 50 + 1 = **51**. Gana B: una actividad olvidada no domina; A queda como alternativa.
6. **Límite del nivel:** una `HIGH` que vence en 23 h (50 + 9 = **59**) se sugiere antes que una `LOW` que vence en 1 h (50 + 1 = **51**), ambas `IMMEDIATE`. Es la consecuencia de no usar un componente continuo; la `LOW` aparece como alternativa.
7. **Vencida hace 7 días exactos vs 7 días + 1 ms (`MEDIUM`).** 60 + 5 = **65** frente a 20 + 5 = **25**.

## Limitaciones

- Dentro de un nivel el score (prioridad y estado) pesa más que unas horas de diferencia (escenarios 3 y 6).
- No conoce cuánto tarda cada actividad ni su dificultad (no se pide ese dato al estudiante) ni la carga de la semana.
- La prioridad es la que el estudiante puso; si no la ajusta, todas son `MEDIUM` y decide el Radar y la fecha.
- Depende del reloj del servidor para la sugerencia y del reloj del dispositivo para el texto de las tarjetas; un dispositivo desfasado puede mostrar textos distintos unos minutos.

## Por qué no mide rendimiento

El motor solo ordena **tiempo restante, prioridad y estado**. No sabe si una actividad es difícil, ni cuánto sabe el estudiante, ni cómo le ha ido: por eso no puede (ni pretende) predecir resultados. Es una ayuda para ver qué atender primero, no una evaluación.
