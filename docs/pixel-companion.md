# Pixel Companion v1 (P8)

**Estado: EN REVISIÓN (IN REVIEW).** Implementado y probado de forma automática; **sin QA real** en dispositivo. No se afirma validación con estudiantes ni que el personaje ayude a nadie: es una pieza visual de acompañamiento.

Un pequeño personaje de pixel-art **propio** de Academic Planner vive en el Inicio, junto al saludo, y dice **una frase corta y neutra** sobre el momento académico. Acompaña: **no juzga, no manipula, no castiga y no crea presión**. «Organizarse no debe convertirse en otra tarea»: no hay nada que cuidar, completar ni mantener.

## Qué es y qué no es

- Decoración **más** texto. El dibujo es un SVG con `aria-hidden` (el texto ya dice todo); no es un botón, ni un enlace, ni se puede enfocar, y no guarda nada.
- **Derivado y sin estado**: se calcula al leer, con lo que el Inicio ya tiene. **Sin backend, sin Prisma, sin migración, sin API, sin analítica, sin persistencia, sin peticiones de red, sin dependencias nuevas.**
- **No hay gamificación**: ni niveles, XP, rachas, monedas, corazones, energía, hambre, tienda, logros, recompensas diarias ni clasificaciones. El personaje no es una obligación.
- **No describe a la persona**: el estado describe el **momento académico** (qué hay cerca), nunca cómo está el estudiante. **Las notas no lo modifican** y el porcentaje de progreso tampoco: el Radar y las notas siguen siendo informativos y temporales.

## Estados (4 en V1)

Función pura `deriveCompanionState` (`apps/web/src/companion/companionState.ts`), determinista (sin `Math.random`, sin reloj propio: solo conteos que el servidor ya normalizó). Prioridad, gana la primera regla:

| Estado    | Cuándo                                                                                | Frase                                       |
| --------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `BUSY`    | dos o más cosas apremiantes (vencidas o que vencen hoy)                               | «Hay varias cosas cerca. Vamos por partes.» |
| `FOCUSED` | exactamente una cosa apremiante: un siguiente paso claro                              | «Una cosa a la vez.»                        |
| `CALM`    | nada apremia: sin actividades registradas todavía, o hay cosas planeadas más adelante | «Todo en orden por ahora.»                  |
| `REST`    | nada apremia y no hay nada próximo (día tranquilo)                                    | «Hoy se ve tranquilo.»                      |

Entrada (`CompanionContext`): `overdueCount` (vencidas), `immediateCount` (vencen hoy), `nextItemExists`, `hasActivities`. Valores inesperados (negativos, `NaN`, texto) cuentan como cero. Sin datos, `CALM`.

**`CELEBRATE` no está en V1.** Necesita una señal de «recién completado» y el Inicio no la tiene sin inventar marcas de tiempo o añadir un campo al servidor; derivarlo del porcentaje total lo volvería permanente. Queda documentado como trabajo futuro: si algún día existe esa señal real, podría añadirse con un uso conservador. Hasta entonces, 4 estados.

**Frase contextual:** en `FOCUSED` y `CALM` puede añadirse «Lo próximo es tu {título}.» solo cuando ese elemento está claro (la única cosa apremiante, o la próxima entrega). **Nunca una fecha** (para no contradecir una tarjeta) y nunca una urgencia inventada. En `BUSY` y `REST` no nombra nada: las tarjetas de abajo ya lo hacen.

**Revisión de textos:** sin culpa, miedo, comparación social, urgencia falsa, antropomorfismo excesivo ni lenguaje infantil; sin exclamaciones. Hay una prueba que lo vigila.

## Arte y movimiento

- Personaje original, cuadrícula lógica de 24 × 24, dibujado con SVG propio (un `path` por color, `shape-rendering: crispEdges`); sin imágenes, sin canvas, sin hojas de sprites. El cuerpo, la mochila y los pies son compartidos; cada estado cambia solo la cara (ojos, cejas, boca) y, en `BUSY`, unas hojas sueltas.
- Colores: **solo los tokens de la aplicación** (`primary`, `accent`, `accent-soft`, `info`, `surface`). No hay modo oscuro todavía y no se inventó uno; al usar tokens, no lo impide.
- Movimiento CSS mínimo y en píxeles lógicos: `CALM` respira un píxel, `FOCUSED` parpadea de vez en cuando, `BUSY` se mueve un píxel, `REST` está quieto. **Todas las animaciones van con `motion-safe:`** y, con `prefers-reduced-motion: reduce`, además, la regla global de `index.css` termina cualquier animación al instante: queda una imagen quieta. El mensaje nunca depende del movimiento.

## Dónde vive

En la cabecera del Inicio, bajo el saludo y el periodo, como una pequeña unidad (un contenedor tenue con el color `accent-soft`, borde suave y radio moderado, sin sombra, que mide lo que su contenido) alineada con el saludo: el personaje mide 64 px en teléfono, 72 px en tableta y 96 px en escritorio, y la frase principal va en tamaño de cuerpo con la segunda más discreta; solo si el estudiante ya tiene asignaturas. No es fijo, no flota y no tapa nada: el Radar y la Captura rápida no se desplazan de forma agresiva (en teléfono añade una fila compacta).

## Pruebas

`companionState.test.ts` (prioridad, `CALM`/`REST`, límites, valores defensivos, determinismo, copy sin culpa ni presión, solo cuenta lo que el Inicio ya tiene), `PixelCompanion.test.tsx` (cada estado, SVG decorativo oculto, sin interacción, `motion-safe`, tokens, caída segura) y `e2e/companion.spec.ts` (tranquilo, día quieto, una cosa, varias cosas, sin asignaturas; 360/390/768/1366 px sin desborde, sin solaparse con el Radar ni la Captura rápida; movimiento reducido sin animaciones en marcha, y movimiento normal con animación).
