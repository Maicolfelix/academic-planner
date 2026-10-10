# UX, accesibilidad y responsive (Fase 15)

Principio de la fase: **pulir, no reinventar**. No hubo reglas de negocio nuevas ni cambios en Radar, Atención, recordatorios, progreso, carga, parser, OCR, recurrencia, propiedad ni autenticación. Esta es una auditoría **orientada a WCAG 2.1 AA** (lo automatizable más revisión manual); **no es una certificación**.

## Objetivos

- Que la app se sienta simple, rápida, académica, sin alarmismo.
- Que se pueda usar con el teclado, con lector de pantalla, con el dedo (360 px) y con zoom/texto grande.
- Que nada que el estudiante escribió se pierda por accidente.

## Navegación y estructura

- **Navegación principal** (UX1-1; `nav "Principal"`, **un solo** landmark): **Inicio, Actividades, Agenda, Asignaturas**, cada una con icono y texto. Es la jerarquía **primaria**; la **secundaria** se alcanza desde la pantalla donde tiene sentido (Radar, Progreso y Bandeja desde Inicio; Importar horario desde la Agenda) y no entra en la barra. Si el piloto muestra que cuesta encontrarlas, el siguiente paso sería una entrada «Más», no ampliar la barra.
- **Barra superior** (`banner`): marca («Academic Planner» con su icono, texto, no enlace) y «**Cerrar sesión**» al extremo, **fuera** del landmark de navegación. El final de la barra queda libre para el avatar y la campana, que llegarán con sus funciones; hoy no se muestra ningún control falso.
- **Teléfono y tableta (< 1024 px)**: la navegación es una **barra fija abajo** (alcance del pulgar), con icono sobre el texto, 56 px de alto y relleno por `env(safe-area-inset-bottom)` para no chocar con el indicador de inicio del iPhone (`viewport-fit=cover` ya estaba). El contenido deja `pb-24` para que lo último no quede tapado; los diálogos nativos (`showModal`) quedan por encima de la barra. **Escritorio (≥ 1024 px)**: la misma navegación se coloca en la barra superior (solo cambia el CSS), con el icono al lado del texto; a 768 px la fila no cabía (marca + 4 destinos + cerrar sesión), por eso el corte es `lg` y no `md`.
- **Sección activa**: `aria-current="page"` (lo pone `NavLink`), texto más grueso y, además del color, una **barra superior** en el teléfono o **fondo + subrayado** en escritorio. Agenda queda activa también en «Importar horario» (cuelga de ella).
- **Insignia de recordatorios**: «🔔 N» dentro del enlace Inicio, solo cuando hay recordatorios vencidos.
- **Iconos**: SVG en línea (`components/ui/icons.tsx`), siempre `aria-hidden` junto a un texto. Se descartó `lucide-react` por ahora: son cinco formas, una dependencia más no se justifica; cuando el conjunto pase de una docena (notificaciones, perfil…) conviene reevaluarlo.
- **`PageHeader`** (`components/ui/PageHeader.tsx`): título (el `h1`), línea opcional y acción principal; reemplaza un bloque repetido en Actividades, Asignaturas (y quedan por migrar Agenda, Importar horario, Home, Progreso y Radar). No hay `IconButton` todavía: no existe ninguna acción solo con icono.
- **Los enlaces de navegación no son una lista** (`ul`/`li`): varias pantallas y pruebas cuentan sus propios elementos de lista (tarjetas) y la navegación ya es un landmark.
- **Reflow**: pantallas verificadas sin desbordamiento horizontal a **320**, 360, 768 y 1366 px (UX1-1 añadió una comprobación a 1024 px: la barra superior cabe en una fila, y a 768 px se usa la barra inferior).
- **Ancho de página**: una columna de lectura (`max-w-3xl`) en la mayoría de las pantallas; la Agenda semanal (siete columnas legibles) y, desde UX1-2.75, el Home (dos columnas desde 1024 px) usan `max-w-6xl`.
- **Landmarks**: `banner` (cabecera), `nav`, `main#contenido`. Enlace **«Saltar al contenido»** como primera parada del teclado.
- **Un solo `h1` por pantalla** y un **título de documento** distinto por pantalla («Agenda · Academic Planner»).
- **Nombre del producto**: «Academic Planner» en todas partes (antes había «Planificador Académico» en el login).
- **Ruta inexistente**: página «No encontramos esa página» con «Volver al inicio» (antes redirigía en silencio).
- **Error inesperado de renderizado**: `ErrorBoundary` global con mensaje amable (el error se registra en consola, no se oculta).

### Validación en dispositivo real (UX1-1)

QA del mantenedor en un **iPhone real con Safari**, con la app servida por HTTP en la red local (**no** PWA instalada, **no** HTTPS). Resultados observados:

| Qué                                                         | Resultado                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barra inferior (4 destinos, fija, ruta activa distinguible) | **PASS**: sin desbordes ni controles cortados                                                                                                                   |
| Área segura de iOS                                          | **PASS observado en iPhone real**: indicador de inicio visible, barra por encima, sin solapamiento grave. No se midió el valor de `env(safe-area-inset-bottom)` |
| Contenido largo (Inicio desplazado hacia abajo)             | **PASS**: la barra fija no impide leer ni se solapa con las tarjetas                                                                                            |
| Actividades                                                 | **PASS**: título, filtros, tarjetas, acciones y estado activo; nada bloqueado por la barra                                                                      |
| Agenda                                                      | **PASS**: encabezado, botones, selector de días, estados vacíos y estado activo                                                                                 |
| PWA instalada, HTTPS                                        | **NOT TESTED**                                                                                                                                                  |

La observación respalda la implementación actual (`viewport-fit=cover`, relleno inferior de la barra y `pb-24` del contenido); no se ajustó ningún número. Android, otros iPhone y tabletas siguen sin probarse.

## Breakpoints

Solo tres, los de Tailwind: **640 px** (`sm`: filtros en una fila), **768 px** (`md`) y **1024 px** (`lg`: la navegación pasa de la barra inferior a la superior, y la cuadrícula semanal de la Agenda; por debajo se usa la lista diaria — a 768 px las clases que se cruzan quedaban ilegibles).

## Identidad visual y movimiento (UX1-2)

Principios **premium/smooth** (no una copia de ninguna interfaz): más aire, capas en vez de cajas con bordes duros, sombras suaves, radios coherentes, color con intención, movimiento corto. Una guía mínima, aplicable a Actividades, Asignaturas y Agenda en UX1-3/UX1-4:

- **Paleta** (valores en `:root`, sin dark mode todavía pero tokenizada): fondo frío y suave `#F3F4FA` con superficies blancas encima; **primario** índigo profundo `#1F2670` (tinta del texto y de los botones, y superficie del único héroe de una pantalla); **acento** teal vivo `#0D9488` solo para relleno y marcas (progreso, lugar actual en la navegación), con `accent-ink` `#0F5651` para texto; tonos semánticos suaves (peligro, aviso, éxito, información) siempre con texto. Los colores de **asignatura** no cambian y no son parte del sistema. El contraste de cada par está en `ui.test.tsx` (texto ≥ 4,5:1 o 7:1, bordes de campo y acento ≥ 3:1).
- **Superficies:** fondo → superficie (tarjeta blanca con sombra suave) → héroe (primario). Los bordes son tenues (`--border`); la separación viene del espacio y del tono. **Radios:** controles 8 px, superficies 14 px, héroe 20 px, píldoras redondas. **Sombras:** `shadow-card` (reposo), `shadow-hero`, `shadow-floating` (diálogos).
- **Acento con mesura:** relleno del progreso, raya del lugar actual en la barra inferior y enlaces secundarios (`accent-ink`). No va en botones ni fondos.
- **Escala neutra transitoria:** `slate-*` (que las pantallas aún usan literalmente) se re-tiñó al mismo índigo frío en `@theme` para que lo migrado y lo no migrado compartan identidad. `slate-900` es el primario. Se elimina al migrar el último literal.
- **Estado del Radar** en el Home: un punto redondo diseñado (`RadarDot`) **más** el nombre en texto, no emojis; en el héroe, una pastilla con punto y palabra.
- **Movimiento** (solo CSS, sin librerías): `animate-rise` (aparecer subiendo 8 px, una vez, 220 ms) en el saludo y el héroe; `animate-fill` (el relleno del progreso crece una vez, 600 ms, con `transform`); respuesta al toque `active:scale-[0.98]` en botones, contadores y fichas del Radar; transiciones de color y fondo de 120 ms. Nada permanente, rebotando ni dependiente del scroll; no hay `backdrop-filter` ni API experimentales (Safari).
- **`prefers-reduced-motion: reduce`:** transiciones y animaciones duran 0,01 ms y **sin retraso**: la barra de progreso aparece en su valor y el contenido, en su sitio. Probado en e2e.

## Movimiento y personalidad (UX1-2.5)

Segunda pasada sobre UX1-2, en el mismo PR: darle vida a lo que ya existe sin añadir pantallas, datos ni lógica. **Decisión de dependencias: no se añadió ninguna.** El CSS (transiciones, `@keyframes`, un par de medidas con `ResizeObserver`) cubre todo lo que se pidió; una librería de animación habría sumado peso al paquete sin resolver nada que el CSS no resolviera. Tampoco se añadió una librería de iconos: hay menos de diez SVG en línea.

- **Lenguaje de movimiento** (tokens en `index.css`): duraciones `fast` 120 ms / `normal` 220 ms / `slow` 600 ms; curvas `standard` (cambios de estado), `enter` (aparecer y llenar) y `spring` (un pequeño rebote, solo donde el estudiante acaba de elegir algo). Reglas: solo `transform` y `opacity` (una prueba lo verifica); respuesta al toque `active:scale-[0.97–0.99]` según el tamaño del control; entradas escalonadas dentro de ¼ de segundo y solo en cabecera, héroe y primer grupo; **en bucle solo** el marcador de carga (UX1-2.5); desde UX1-2.75 también la categoría ambiental A (ver más abajo), siempre `motion-safe` y lenta.
- **Relleno de animaciones:** las de una sola vez usan `backwards` (no `both`): con `both` el estado final queda fijado y anula el hover, el _press_ y la sombra en reposo. Excepción: el destello del progreso.
- **Profundidad** (tres niveles): `shadow-card` en reposo → `shadow-lift` al pasar/tocar → `shadow-hero`/`shadow-floating` (héroe y diálogos). El degradado `--gradient-hero` solo está en el héroe.
- **Héroe con personalidad:** degradado índigo sutil, resplandor radial y dos formas decorativas (`aria-hidden`, `pointer-events-none`, detrás del texto); un halo por estado (peligro ×2, información, aviso, éxito); una sola onda (`animate-beacon`) y solo en «Vencida» e «Inmediata»; partes que entran en escalera y flecha del botón que se desplaza al pasar.
- **Barra inferior:** una marca (`data-nav-indicator`) que **se desliza** (`translateX(índice × 100%)`) al destino activo; fuera de los cuatro destinos (p. ej. Radar) se oculta. Los cuatro destinos, las etiquetas, el área segura y los 44 px no cambian.
- **Filtro de estado de Actividades** (adelanto, no UX1-3): control segmentado con una píldora blanca que **se desliza** hasta el botón elegido (medida con `useSlidingIndicator`; sigue al botón si el contenedor salta de fila). Siguen siendo botones con `aria-pressed`; la píldora es decoración. **Selector de días de la Agenda:** el día elegido crece con un pequeño rebote (propiedad `scale`).
- **Progreso, contadores, Radar:** el relleno crece con `enter` y lleva un destello único; el valor exacto y `aria-valuenow` están desde el primer render (nada cuenta hacia arriba). Los contadores se tiñen cuando tienen algo que mostrar (en cero quedan neutros y legibles) y se elevan al pasar; el punto del Radar tiene un halo del color de su estado.
- **Finalizar una actividad:** `useJustCompleted` marca la tarjeta durante un instante (`data-just-completed`, tinte y pequeño _pop_ de la insignia) solo cuando el estado cambia a «Finalizada» en esa pantalla; el texto «Finalizada» es lo que lo dice.
- **`EmptyState`:** un estado vacío reutilizable (ilustración decorativa, título, línea y siguiente paso) usado en Home, Actividades y Asignaturas. **`HomeSkeleton`:** marcador de carga con la forma del Home (una región `status` con el texto «Cargando tu panel…»; los bloques, `aria-hidden`).
- **Movimiento reducido:** además de duraciones de 0,01 ms y sin retraso, `animation-iteration-count: 1` para que un bucle no parpadee. Las marcas (barra, filtro) saltan en vez de deslizarse. Probado en e2e.
- **Safari:** sin `backdrop-filter`, sin desenfoques pesados, sin APIs experimentales; solo propiedades compuestas en la GPU. **Validado en un iPhone real (ver la sección siguiente); PWA y HTTPS sin probar.**

## Experiencia ambiental inteligente (UX1-2.75)

**Concepto: «Pulso Ambiental» (_Ambient Pulse_).** UX1-2.5 dio vida a las piezas, pero la app seguía sintiéndose estática y «de sistema»: superficies blancas iguales, fondo plano, escritorio como un móvil ampliado, un Radar inmóvil. La dirección nueva es que el Planner **vigila el semestre y su luz lo refleja**, sin fingir IA (no hay texto «analizando», «IA» ni «inteligente»; la sensación sale de priorización, contexto, jerarquía y movimiento). Todo es derivado de datos que ya existen; no hay estado nuevo, endpoints ni lógica.

- **Luz ambiental (fondo):** tres halos grandes y tenues (índigo, teal, violeta; `radial-gradient`, sin imagen, sin `blur`) detrás de **toda** pantalla, en el `AppShell`, **quietos a propósito** (cada órbita se desvanece sola con su degradado radial y termina dentro de su caja). Su tono sigue el estado del semestre mediante `data-ambient` en `<body>` (lo pone el Home mientras está en pantalla y lo quita al salir) y reglas CSS de atributo: _urgent_ (hay vencidas o el héroe es «Vencida»/«Inmediata»; cálido), _calm_ (planificable o bajo control; teal/cielo), _done_ (100 % de progreso con algo que terminar; verde) y _neutral_. La función pura es `ambientTone` (probada); fuera del Home la luz es neutral.
- **Superficies con sistema** (`Card`, un solo componente): `solid` (blanca en reposo), `soft` (apoyo), `tinted` (viva: Radar, progreso), `success` (meta cumplida), `accent` (borde encendido y brillo al escribir: donde se actúa, la Captura rápida), `dashed` (vacío) y el héroe (degradado profundo, fuera de `Card`).
- **Escritorio (≥ 1024 px):** el Home usa 6xl y dos columnas asimétricas (`minmax(0,1fr)` + 19–25 rem): a la izquierda «¿qué hago ahora?» (héroe, clases, vencidas, hoy) y debajo «lo que viene»; a la derecha «¿cómo voy?» (contadores, progreso, Captura, Radar). **El DOM sigue el orden de lectura del móvil** (héroe → cómo voy → lo que viene): solo la rejilla lo mueve, así teclado y lector de pantalla nunca discrepan de lo que se ve. Más aire arriba: barra más alta (`lg:py-3`) y `pt-10` en el contenido, con un ritmo (`gap-7`) coherente. Móvil y tableta siguen lineales.
- **Héroe:** su degradado cambia con el estado (índigo profundo para urgente/vencida/próxima; índigo → teal profundo para planificable/bajo control), con una órbita de luz del color del estado que deriva muy despacio, una rejilla suave que se desvanece, un anillo y un **riel de tiempo**: cinco nodos (los cinco estados del Radar) con el actual encendido y respirando. Todo decorativo (`aria-hidden`, sin captura de toques, detrás del texto o en el flujo junto al botón). La marca del estado respira un anillo con el ritmo de su gravedad.
- **Radar vivo:** el resumen del Home es un **espectro** (una tira con un segmento por categoría, tan ancho como su conteo, que se dibuja una vez y por la que pasa una luz tenue de vez en cuando) más cinco fichas-enlace, que se tiñen con el tono de su estado cuando tienen algo y se apagan en cero. Cada punto con algo que mostrar **respira un anillo** con periodo propio según su gravedad (4,5 s vencidas … 10 s bajo control), con retraso distinto: nunca sincronizados, casi todo el ciclo en reposo. El nombre y el número siguen siendo texto; en escritorio las fichas son filas.
- **Métricas editoriales:** los cuatro contadores son **una tira**, no cuatro cajas: numeral grande con color propio cuando hay algo, barra fina con su proporción del total (decorativa) y etiqueta de texto; «Vencidas» tiñe su celda solo si hay. Cuatro columnas en tableta, 2×2 en móvil y en la columna lateral.
- **Progreso:** anillo que se dibuja una vez (SVG, solo `stroke-dasharray`), barra con degradado, destello único y, al 100 %, la tarjeta toma el tono de logro. El valor exacto, `aria-valuenow` y `aria-valuetext` están desde el primer render.
- **Navegación:** en el teléfono, la cápsula del lugar actual es un índigo con sombra suave y una raya con brillo se desliza arriba; en escritorio, la navegación es una **pista en píldora** con un resalte blanco que se desliza (`data-nav-pill`, medido con `useSlidingIndicator`). Cuatro destinos, etiquetas, área segura, 44 px y `aria-current` no cambian. La barra superior gana una línea de luz inferior.
- **Estados vacíos:** `EmptyState` ahora es una pequeña constelación (tres nodos orbitan despacio y un anillo sale de la pieza central de vez en cuando). Captura rápida: borde encendido, icono y brillo al enfocar.
- **Actividades y Agenda:** reciben la luz ambiental, la navegación nueva y el filtro/selector de días de UX1-2.5; **no** se rediseñaron sus tarjetas (eso es UX1-3).
- **Sin revelado por scroll:** se evaluó `IntersectionObserver` y se descartó: añade estado y un flujo nuevo de pruebas para un beneficio que la entrada escalonada de la primera pantalla y el movimiento ambiental ya dan; las secciones por debajo del pliegue no se ocultan hasta verlas.
- **«Próxima entrega»** espera la respuesta de «¿Qué hago ahora?» antes de pintarse (si no, aparecía como tarjeta y se encogía a una línea).

**Taxonomía de movimiento** (la que cualquier animación nueva debe declarar):

| Categoría                | Qué es                                | Reglas                                                                                                                                                            | Ejemplos                                                                                                                                    |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — ambiental**        | Lenta, discreta, sin información      | Siempre `motion-safe:` (con movimiento reducido **nunca arranca**); solo `transform`/`opacity`; ciclos ≥ 4 s con largo reposo; jamás sincronizadas ni sobre texto | `drift` (la órbita de luz del héroe), `halo` (anillo de un punto del Radar), `scan` (luz sobre el espectro), `node` (riel), `orbit` (vacío) |
| **B — interacción**      | Rápida y visible, responde a un gesto | 120–220 ms; transform/color/sombra; con movimiento reducido es instantánea                                                                                        | pulsar (`active:scale`), elevar al pasar, resalte deslizante de la navegación y del filtro, rebote del día                                  |
| **C — cambio de estado** | Clara y breve, una vez                | `rise`, `pop`, `fill`, `ring`, `beacon`, `complete`; relleno `backwards`; con movimiento reducido llega a su valor sin retraso                                    | entrada del héroe, relleno del progreso, confirmación al finalizar                                                                          |

Además, `breathe` (carga) es el único bucle que no es ambiental. **Movimiento reducido:** las de categoría A no existen (`motion-safe`); el resto colapsa a 0,01 ms sin retraso y con `animation-iteration-count: 1`. Una prueba unitaria exige que todo uso de un bucle ambiental sea `motion-safe:` y otra fija la lista de bucles permitidos. **Rendimiento:** sin `backdrop-filter`, desenfoques ni `mask-image` sobre contenido animado ; sin `scale` en la deriva. **Medido:** mover las tres órbitas del fondo duplicaba el tiempo de una misma tanda de pruebas de navegador (≈ 4,0 min frente a 2,8 min con el fondo quieto y 2,1 min con movimiento reducido) y provocó timeouts, así que el fondo no se anima; quitar además la órbita del héroe no cambió el tiempo, y se conserva; los bucles son transform/opacity en pocos elementos (tres órbitas, un puñado de anillos); `stroke-dasharray` solo en un SVG pequeño y una vez. **Safari:** máscaras con prefijo `-webkit-`, sin `:has()`, sin API experimental. Validación en iPhone real: ver [más abajo](#validación-en-dispositivo-real-ux1-2--ux1-25--ux1-275).

### Validación en dispositivo real (UX1-2 / UX1-2.5 / UX1-2.75)

**Plataforma:** iPhone real con Safari, la app servida por IP local, HTTP, misma red (**no** PWA instalada, **no** HTTPS), sobre la rama del PR #24 (`9e14910`). No se registraron modelo, versión de iOS ni mediciones de fluidez.

**Observado por el mantenedor:**

- la identidad visual («Pulso Ambiental») fue aprobada;
- la experiencia ambiental fue aceptada;
- la navegación fue utilizable;
- el Home fue aceptado visualmente;
- no se reportó ningún bloqueante.

**Decisión del mantenedor (textual):** «Me gustó como quedó, ya podemos continuar» y «Lo mejoraremos más adelante igualmente». Queda **aprobado para la fase actual**; no es un veredicto de acabado final. No se probó: PWA instalada, HTTPS, Android, otros iPhone ni tabletas.

**Deuda visual que se conserva (esperada, no bloqueante):** la identidad está aceptada pero el refinamiento continuará. Siguen «administrativas» las tarjetas de actividad, los formularios y los diálogos; la Agenda sigue relativamente plana; Asignaturas aún necesita su tratamiento (UX1-3). El pulido visual puede continuar mientras avanza el roadmap funcional.

## Actividades y Asignaturas (UX1-3)

Lleva «Pulso Ambiental» a las dos pantallas que seguían sintiéndose administrativas. **Solo presentación:** mismos datos, mismas rutas, misma API, mismos estados y mismas reglas; el endpoint, la descarga y el texto de «Añadir al calendario» no cambiaron. Estado: **DONE**, aprobado en un iPhone real (ver [la validación](#validación-en-dispositivo-real-ux1-3)).

**Antes (lo que generaba sensación de sistema).** _Actividades:_ cada tarjeta era una barra de color de 8 px y cuatro píldoras (Radar con **emoji**, estado, prioridad y tipo) más un `select` de estado y tres botones (Editar, Añadir al calendario, Eliminar) en dos filas de controles; los filtros eran un control segmentado que se partía en dos líneas y un `<details>` «Más filtros» con aspecto de HTML; una sola columna de 768 px aunque hubiera ancho. _Asignaturas:_ una fila CRUD (barra de color, nombre, profesor, descripción y dos botones) en una rejilla de dos columnas de ancho estrecho.

**Tarjeta de actividad (`ActivityCard`).** Se lee en el orden en que se piensa: **qué** (título, con su estado a la derecha), **cuándo** (asignatura con su color y plazo, con el tiempo restante en negrita), **qué tan urgente** (marca del Radar y prioridad; el tipo pasa a metadato en texto discreto) y **qué hacer**.

- **Una acción primaria: «Completar».** Hace exactamente lo mismo que elegir «Finalizada» en el control de estado (`onStatusChange('COMPLETED')`): no es un flujo nuevo. Se eligió sobre «Editar» porque marcar algo como hecho es lo que el estudiante más repite y porque ya tenía su confirmación (`useJustCompleted`). Es un botón **tonal** (acento suave), no un bloque oscuro: una lista de doce botones sólidos serían doce cosas gritando. Una actividad finalizada no tiene acción primaria y descansa sobre una superficie más quieta (`soft`).
- **Secundarias:** «Editar» queda a la vista (ghost, con icono); «Añadir al calendario» y «Eliminar» viven en un menú **«Más acciones: _título_»**. Eliminar sigue pidiendo la confirmación de siempre (con «Cancelar» como foco inicial) y en el menú se distingue por color, icono y palabra.
- **Control de estado:** sigue siendo un `<select>` nativo (el mejor selector en cualquier teléfono y el accesible), con el mismo nombre («Cambiar estado de _título_») y los mismos tres estados, pero vestido como el propio estado: píldora con símbolo (○ ◐ ✓), palabra y tono. Se descartaron los chips/segmentado por tarjeta: tres botones por tarjeta repetirían el problema.
- **Confirmación al completar:** se conserva `useJustCompleted` y se mejora: un check que aparece junto al título, la píldora de estado que «salta» y el tinte de éxito breve; sin confeti y sin retrasar la actualización real.
- **Radar sin emojis:** `RadarBadge` ahora es un `RadarDot` compacto (halo de 3 px) más el nombre, con el mismo tono que las fichas del Home; «Vencidas» conserva el rojo sólido. **Estático**: una lista puede tener decenas.
- **Color de asignatura:** una raya fina e inset (no una losa), un punto junto al nombre y un lavado muy tenue en la esquina. Las tarjetas **urgentes** (vencida o inmediata) tienen un borde rojo suave; las demás no varían.

**Menú de acciones (`ActionMenu`, sin librería).** Botón real con `aria-haspopup="menu"` y `aria-expanded`; Enter, Espacio y ↓ lo abren y llevan el foco al primer elemento (↑ al último); dentro, flechas, Inicio y Fin; Escape lo cierra y devuelve el foco al botón; Tab lo cierra; un clic fuera lo cierra; al elegir un elemento el foco vuelve primero al botón (así el diálogo que se abre lo recupera al cerrarse). Se abre hacia arriba si abajo no cabe (la barra del teléfono). Los elementos miden 44 px y conservan su nombre accesible («Eliminar _título_», «Añadir al calendario: _título_»).

**Filtros.** El control segmentado de UX1-2.5 queda como diseño definitivo: **una sola fila** que en el teléfono se desplaza horizontalmente (y lleva el estado elegido a la vista; ver abajo) y desde 640 px se ajusta a su contenido; sigue siendo `aria-pressed` con el resalte que se desliza. «Más filtros» deja de ser `<details>`: es un botón-píldora con `aria-expanded`/`aria-controls`, el icono de filtros, cuántos hay activos y un panel `soft` con los `select` nativos agrupados (en pantallas anchas el panel está siempre visible). Se abre solo si llegas con filtros aplicados.

**Escritorio.** Actividades y Asignaturas pasan a ancho 6xl: las tarjetas de actividad en **dos columnas** desde 1024 px y las asignaturas en **tres**; ya no es una columna móvil centrada.

**Asignaturas (`SubjectCard`).** Un espacio, no una fila: un monograma (iniciales) sobre el color de la asignatura, un lavado del color en la esquina y una órbita tenue, el profesor (con icono) y la descripción si existen, y dos acciones compactas. Solo datos que la asignatura ya tiene (sin conteos ni consultas nuevas). Color en dosis moderada: el texto del monograma es **blanco** si alcanza 3:1 (es texto grande en negrita) y tinta oscura en los colores claros (amarillo, naranja). Movimiento solo B (respuesta al puntero): sin ningún bucle.

**Rendimiento (medido, Edge sin GPU, 12 actividades).** Ningún movimiento ambiental dentro de las tarjetas. Altura de la página de Actividades, antes → después: 390 px 3843 → 3125 (−19 %), 320 px 4255 → 3249 (−24 %), 430 px 3815 → 3125, 768 px 3013 → 3127 (+4 %: ahí sigue siendo una columna), 1024–1440 px 2999 → 1769 (−41 %, dos columnas). Desplazamiento de 12 tarjetas a 390 px: fotogramas de 6,9 ms de media y 8,5 ms como máximo (antes, 10,5 ms): no se degrada. Las tarjetas de **Asignaturas son más altas** en el teléfono (102 → 142 px): es el precio de que tengan identidad.

**Iconos.** UX1-3 añade ocho (check, lápiz, calendario+, papelera, más, chevron, usuario, filtros): **13 en total**. Se reevaluó `lucide-react` y **no se añadió**: son 13 formas de una a tres líneas cada una, sin versión que mantener ni dependencia que auditar; se vuelve a decidir al pasar de unos 20 o si hace falta un icono complejo.

**Deuda `slate-*`.** En el área tocada (Actividades, Asignaturas, sus diálogos y `SelectField`): **21 → 0** literales, migrados a tokens (los botones de los diálogos ahora usan `Button`). En todo `apps/web/src`: **146 → 126** líneas.

**Lo que atrapó una prueba:** llevar el estado elegido a la vista con `scrollIntoView` movía el punto de partida de Tab del navegador, y la primera parada del teclado dejaba de ser «Saltar al contenido». Ahora se desplaza solo la fila (`scrollTo`).

**Sigue sintiéndose administrativo:** los formularios y diálogos (Agregar/Editar actividad y asignatura, con sus `<details>` «Más opciones»), la Agenda semanal y el panel de recordatorios del diálogo de edición.

### Validación en dispositivo real (UX1-3)

**Plataforma:** iPhone real con Safari, la app servida por HTTP en la red local (**no** PWA instalada, **no** HTTPS), sobre la rama del PR #25 (`88b5b60`) y con el dataset demo del proyecto (6 asignaturas, 15 actividades en los tres estados). No se registraron modelo, versión de iOS ni mediciones de fluidez.

**Observado por el mantenedor:**

- el rediseño visual de Actividades fue aprobado;
- el rediseño visual de Asignaturas fue aprobado;
- «Pulso Ambiental» sigue coherente entre pantallas;
- no se reportó ningún bloqueante visual;
- el mantenedor aprobó continuar.

**Decisión del mantenedor (textual):** «me gusta cómo se ve a nivel visual». Queda **aprobado para la fase actual**, no como veredicto de acabado final. El comentario fue visual: no se registró un recorrido detallado de cada control en el dispositivo (la verificación funcional es la de las pruebas automáticas). No se probó: PWA instalada, HTTPS, Android, Chrome móvil, otros iPhone ni un lector de pantalla real.

**Límites que se conservan (no bloqueantes):**

- «Añadir al calendario» ahora está dentro de «Más acciones»; **su descubribilidad queda como deuda de uso real**, no se movió de nuevo;
- los formularios y diálogos siguen más «de sistema»;
- la Agenda sigue necesitando trabajo visual;
- los `select` nativos se conservan a propósito (el mejor control en el teléfono y el accesible);
- las tarjetas de asignatura son más altas en el teléfono (102 → 142 px);
- PWA instalada, HTTPS y Android siguen sin probarse.

## Dashboard

Jerarquía (UX1-2), en el orden en que el estudiante pregunta: **¿qué hago ahora?** → **¿cómo voy?** → **¿qué viene?**. Saludo y periodo → recordatorios (cuando hay) → **¿Qué hago ahora?** (el héroe) → clases de hoy → vencidas → para hoy → contadores → progreso → **Captura rápida** (+ acceso a la Bandeja) → Radar → próxima entrega → próximas entregas → semana → accesos rápidos. Captura bajó de la segunda posición: quien entra a saber qué hacer ve primero eso. Cuando el héroe ya muestra la próxima entrega, «Próxima entrega» es una sola línea tenue y no una segunda tarjeta (la región sigue existiendo).

## Formularios y diálogos (UX1-4)

Cierra la deuda visual que quedaba tras UX1-3. **Solo presentación:** mismas reglas de validación y esquemas, mismos endpoints, mismos campos y mismos nombres accesibles. Estado: **implementado en su PR, pendiente de QA real en iPhone** (no está DONE hasta entonces).

**Inventario.** _A, modales:_ Agregar/Editar actividad, Agregar/Editar asignatura, Agregar/Editar bloque de la agenda (con su aviso de choques), los tres diálogos de eliminar y la pregunta «¿descartar cambios?» del `Modal`. _B, página completa:_ Inicio de sesión, Registro, Onboarding, Bandeja e Importar horario (heredan el nuevo aspecto de los campos porque usan `FormField`/`SelectField`; **no se rediseñaron**; solo se miró una captura a 390 px del Registro con errores y de la Bandeja). _C, en línea:_ el editor de recordatorios (dentro de Editar actividad), Captura rápida y las propuestas de la Bandeja y de la importación.

**Lo que se sentía «CRUD»:** campos con borde `slate` duro y contorno negro, un `<details>` «Más opciones» como una caja sin identidad, errores sin icono, los recordatorios como un bloque pegado con botones crudos, botones de cada pie escritos a mano (con el orden y los colores a criterio de cada formulario) y un `Modal` sin entrada, con `amber/slate` literales.

**Lenguaje de campo** (`components/ui/fieldStyles.ts`). Controles **nativos** (input, textarea, select, selector de fecha y de hora) con otro aspecto: relleno tonal suave, borde que sigue leyéndose a 3:1, foco con contorno de acento y un resplandor tenue (nunca una raya negra fina), error con borde y fondo de peligro **más** un icono y la frase junto al campo (`aria-invalid` y `aria-describedby` como antes), pista que solo se enlaza mientras se ve (cede ante el error), y estados `required` (anunciado a la tecnología asistiva; no se dibuja nada) y `disabled`. `SelectField` sigue siendo un `<select>` nativo (Safari del iPhone abre su selector de siempre): solo cambia la flecha, que ahora es un chevron propio (decoración, no captura toques), y un placeholder sin elegir se lee como tal.

**Primitivas nuevas** (`components/ui/form.tsx`, cuatro y pequeñas; ninguna sabe de campos ni de validación): `FieldError` (la frase con su icono, en `FormField`, `SelectField` y la paleta de color), `FormError` (el error de todo el formulario, `role="alert"`, en los formularios, las confirmaciones y los recordatorios), `Disclosure` (el «Más opciones» de Actividad y de Asignatura) y `FormActions` (el pie, siete usos). **No** se creó `FormSection`, `FieldGroup`, un motor de formularios ni nada dirigido por esquemas: cada formulario agrupa distinto y no había repetición real.

**«Más opciones».** Sigue siendo un `<details>` y un `<summary>` nativos (teclado, lector de pantalla y búsqueda en la página gratis), ahora una fila de 44 px sobre una superficie suave, con un chevron que gira y un contenido que entra subiendo una vez (no se pinta mientras está cerrado, así que la animación ocurre al abrir). `open` solo fija el estado inicial: se abre solo si el estudiante ya tiene algo dentro.

**Modal.** Superficie blanca con una raya de acento fina arriba (decoración), velo índigo sin desenfoque, entrada de 220 ms (aparece y sube 12 px con una escala de 0,98) y cierre inmediato (se desmonta); en reducido todo es instantáneo. Ancho de hasta 31 rem; si el formulario es más alto que la pantalla, se desplaza **dentro**. **En el teléfono se conserva centrado con margen por los cuatro lados.** Se evaluó una hoja pegada al borde inferior y se descartó: el contrato de las pruebas exige un hueco bajo el diálogo (nunca a ras del indicador de inicio) y no se podía comprobar el teclado real de iOS en esta sesión. La pregunta de descartar usa ahora tokens y `Button`.

**Acciones.** Un pie común: «Cancelar» **antes** de la acción primaria, ambos a la derecha; un atajo destructivo («Eliminar» en el editor de bloques) a la izquierda y aparte; en el teléfono los dos botones comparten fila como objetivos anchos. **Pie fijo (sticky) en el teléfono: no se adoptó.** Habría que verificar que no tapa campos con el teclado virtual de iOS, algo que esta sesión no podía hacer; los formularios, ya agrupados, son cortos y el pie queda a un desplazamiento.

**Validación.** Sin cambios de reglas ni de esquemas. No se añadió un resumen de errores: los formularios son cortos y cada error está junto a su campo, con icono y texto.

**Actividad.** Título, asignatura y fecha (y, al editar, el estado junto a la fecha) a la vista; hora, tipo, prioridad y descripción en «Más opciones» (tipo y prioridad en una fila desde 640 px). Los **recordatorios** son una sección de la misma superficie (suave), con su título a la izquierda y «+ Agregar recordatorio» a la derecha, filas compactas y el editor que entra subiendo; mismas opciones, misma lógica y mismos endpoints.

**Asignatura.** Una **vista previa viva** junto al nombre: el mosaico de la tarjeta (color elegido e iniciales del nombre; decoración). La paleta cerrada sigue siendo un grupo de botones de radio reales (las flechas mueven la elección) con el **nombre** de cada color para un lector de pantalla, ahora de 40 px, con anillo y check en el elegido y foco visible.

**Bloque de la agenda.** Tipo y asignatura en una fila, «Repetir semanalmente» como una fila tonal completamente tocable (el checkbox es real), día/fecha, horas y «Hasta», y los avisos (aviso de edición semanal y choques) con tokens. No se tocó la recurrencia, las ocurrencias ni la zona horaria.

**Eliminar.** Los tres diálogos (actividad, asignatura, bloque) preguntan igual: «Cancelar» primero y con el foco, después «Eliminar» en peligro.

**Movimiento y rendimiento.** Solo interacción (foco, desplegar, abrir): ningún bucle, ningún desenfoque. **Teclado:** Escape, Tab dentro del diálogo, devolución del foco y la pregunta de descartar siguen como antes y tienen pruebas.

**Deuda `slate-*`.** En el alcance (campos, `Modal`, formularios de actividad, asignatura y bloque, recordatorios y los tres diálogos de eliminar): **20 → 0** literales `slate-*` y **45 → 0** de cualquier paleta cruda (red, amber, green…). En todo `apps/web/src`: 126 → 108 líneas. Iconos: 14 (se añade el triángulo de alerta).

**Lo que atrapó una prueba:** añadir `relative` al `<dialog>` anuló su `position: fixed` nativo (lo que lo centra) y un diálogo más alto que la pantalla se salía por arriba (hasta −177 px); el diálogo modal ya está posicionado, así que se quitó y una prueba lo vigila.

**Sigue sintiéndose de sistema:** Inicio de sesión, Registro, Onboarding, Bandeja e Importar horario (sus tarjetas y botones propios), las vistas previas de Captura rápida y la Agenda semanal. **No probado:** el teclado virtual real de iOS (solo se comprobó el comportamiento con viewports estrechos), PWA instalada y HTTPS.

## Actividades sin asignatura (F1-1)

**Fusionado (PR #28), DONE:** QA real en un iPhone con Safari (HTTP en la red local) **aprobada para la fase actual** por el mantenedor: se validaron visualmente y en la interacción principal (Omitir asignatura → Sin asignatura → Elegir asignatura); **no** consta un recorrido funcional exhaustivo (PWA y HTTPS sin probar). Los textos aprobados: acción «Omitir asignatura», estado «Sin asignatura», regreso «Elegir asignatura», filtro «Sin asignatura». Reglas de interfaz:

- **Botones reales** (`<button type="button">`, `min-h-11` = 44 px, nombre accesible = su texto visible; el contenido que cambia es texto visible, sin `aria-live`). Orden de tabulación natural: el selector y, justo después, «Omitir asignatura». Al pulsar, el foco pasa al botón «Elegir asignatura» (y al revés, al selector): ningún control desaparece con el foco encima. El estado es un grupo con nombre («Asignatura») cuyo texto dice «Sin asignatura»; el punto neutro es decoración (`aria-hidden`).
- **Movimiento:** el cambio entre el selector y el estado usa la entrada `animate-rise` existente (corta, categoría C) y **solo cuando el estudiante lo pide**, no al abrir el formulario; con `prefers-reduced-motion` es instantáneo.
- **Diseño:** sin primitivas nuevas ni literales de paleta nuevos: `FormField`/`SelectField`/`Button`/`FIELD_LABEL` y los tokens existentes (`accent-ink`, `border-border-strong`, `text-muted-foreground`); el gris neutro de «sin asignatura» es la constante `NO_SUBJECT_COLOR` que ya usaban tres sitios. A 320 px la fila del estado envuelve («Elegir asignatura» pasa debajo) sin desbordar.
- **Medido** (navegador, 320/390/430/768/1024/1366/1440 px): sin desbordes horizontales, botones de 44 px, tarjeta, filtros y Home con el respaldo; axe (WCAG 2 A/AA) limpio en ambos modos del formulario y en Home.
- **Qué NO hace:** no cambia Captura rápida ni Bandeja (siguen exigiendo asignatura al confirmar: F1-2), ni el seed demo, ni el backend.

## Formularios y diálogos (reglas generales)

- Todo campo tiene `label` asociado; los errores van junto al campo (`aria-describedby`, `aria-invalid`); los opcionales dicen «(opcional)».
- Alto mínimo de 44 px en botones, `select`, `input` y `summary` (probado en el viewport móvil en todas las pantallas).
- Botones de envío desactivados con texto de progreso («Guardando…», «Creando…», «Procesando…») para evitar doble envío.
- Si una petición falla, **lo escrito se conserva** (actividad, asignatura, agenda, recordatorio, Captura rápida, Bandeja, vista previa de importación).
- **Cambios sin guardar** (decisión): en cuanto el estudiante escribe o elige algo dentro de un diálogo, **Escape y el clic fuera NO cierran**: preguntan «Tienes cambios sin guardar. ¿Quieres descartarlos?» con «Seguir editando» (respuesta por defecto, con el foco) y «Descartar cambios». El botón «Cancelar» del formulario sí cierra directamente (es una decisión explícita) y un diálogo sin campos (confirmar eliminación) se cierra como antes; en ese «Cancelar» es el botón enfocado. «Cambió» = hubo un evento `input`/`change` dentro (simple y uniforme; escribir y deshacer también pregunta).
- Foco: al abrir un diálogo va dentro; al cerrar vuelve a quien lo abrió (o al contenido de la página si ese botón ya no existe). Mientras hay un diálogo abierto la página de fondo no se desplaza; un diálogo más alto que la pantalla se desplaza por dentro.

## Estados: carga, vacío, error y actualización en segundo plano

- Cada pantalla que espera al servidor muestra un texto de carga; las páginas secundarias se descargan al visitarlas (`Cargando…`).
- Los estados vacíos explican qué falta y ofrecen el siguiente paso (no hay «pared de ceros»).
- **Un refresco que falla no borra lo que ya se ve**: `QueryError` muestra una nota discreta («No pudimos actualizar esta información; ves lo último que se cargó. Reintentar»). Solo si no hay datos aparece la alerta roja con el motivo y «Reintentar».
- Sin conexión: aviso arriba, en el flujo normal (no tapa la navegación); consultas y acciones fallan con mensaje claro en vez de quedarse esperando.
- **Sesión caducada**: si el servidor responde 401 estando con sesión, se redirige **una vez** al login con «Tu sesión expiró. Inicia sesión nuevamente.»

## Presentación de fechas y horas (decisión)

- **Horas: 12 horas con a. m./p. m.** en todo el producto (`2:00–4:00 p. m.`, `8:00–10:00 a. m.`; el sufijo se escribe una vez si ambos extremos lo comparten). Antes las entregas usaban 12 h y las clases 24 h. Los campos `<input type="time">` siguen el idioma del navegador.
- **Fechas**: «lun, 5 oct 2026» para fechas límite y `05/10/2026` (día/mes/año, formato colombiano) para periodos y rangos. Zona horaria: siempre la del perfil (sin cambios).

## Sistema visual (UX1-0)

Base para las pantallas siguientes; **no rediseña ninguna pantalla** (Home, Agenda, Radar, Bandeja y acceso siguen como estaban).

- **Tokens** en `apps/web/src/index.css`: roles semánticos (`background`, `surface`, `surface-elevated`, `foreground`, `muted-foreground`, `border`, `primary`, `secondary`, `accent`, `danger`, `warning`, `success`, `info`) como variables CSS en `:root`, expuestas a Tailwind con `@theme inline`. Se usa `bg-primary`, nunca `bg-slate-900`. Los valores actuales **reproducen la identidad de antes a propósito** (tinta sobre blanco); cambiar la paleta o añadir un tema oscuro es redefinir esas variables, sin tocar componentes. `accent` está reservado y aún no lo usa nada. Los colores de **asignatura** (la paleta fija de `packages/core`) no forman parte del sistema.
- **Radios:** `rounded-control` (botones y campos), `rounded-surface` (tarjetas y diálogos), `rounded-full` (píldoras). **Sombras:** `shadow-card` y `shadow-floating`. **Tipografía** (fuente del sistema, sin fuentes externas): `text-page-title`, `text-section-title`, `text-card-title`; el cuerpo es el tamaño por defecto y lo secundario `text-sm`. **Movimiento:** `--duration-fast`/`--duration-normal` y `ease-standard`; `prefers-reduced-motion` ya anula transiciones y animaciones.
- **Foco:** una regla base (`:where`, en la capa `base`) da a todo lo enfocable por teclado un anillo de 2 px del color `--ring` (el mismo del primer plano): los `focus-visible:` ya existentes siguen ganando y nada de lo anterior cambia.
- **Primitivas** (`apps/web/src/components/ui/`): `Button` (`primary`, `secondary`, `ghost`, `danger`; `md`/`sm`; siempre ≥ 44 px; `type="button"` por defecto) con `buttonStyles()` para un enlace que debe verse como botón; `Card` (solo superficie; `solid` o `dashed` para estados vacíos); `Badge` (tonos `neutral`, `info`, `success`, `warning`, `danger`, `critical`; el significado nunca depende solo del color). Migrados como muestra: Asignaturas, Actividades (tarjeta, estados vacíos, insignias, diálogo de borrar), «Cerrar sesión» y la superficie de `Modal`. El resto se migra al tocar cada pantalla (UX1-1 en adelante). Pruebas: `components/ui/ui.test.tsx` (incluye el contraste de los pares de color).

## Contraste y color

Auditoría automática con **axe-core** (`@axe-core/playwright`, etiquetas WCAG 2.0/2.1 A y AA, incluye contraste): **0 violaciones** en todas las pantallas con una cuenta cargada (nombres largos, todas las bandas del Radar, clases que se cruzan), en el login/registro y en los estados con diálogo, errores de validación, pregunta de descarte, Bandeja con propuestas y vista previa de importación. El color nunca es la única señal (símbolo + texto en Radar, estados y avisos). Axe no detecta todo: revisión manual aparte.

## Movimiento y táctil

No hay animaciones decorativas; aun así `prefers-reduced-motion` elimina transiciones y desplazamientos suaves. Nada depende de `hover`. Zoom: la maquetación no usa alturas fijas para texto; se probó el reflow a 320 px (equivale a 400 % de zoom de 1280 px).

## Rendimiento

Rutas secundarias con carga diferida (`React.lazy`), precacheadas por el service worker (siguen abriendo sin conexión una vez usadas). Paquete principal: **799,1 kB (223,2 kB gzip) → 529,1 kB (154,4 kB gzip)** más un fragmento compartido de React de 164,2 kB (50,5 kB gzip); el resto son fragmentos de 3–26 kB por pantalla. Tesseract, `unpdf` y `@napi-rs/canvas` **no** están en el paquete web (solo en la API).

## Verificación

- `e2e/ux-accessibility.spec.ts` (360 y 1366 px): axe en estados representativos, landmarks/`h1`/título, nombre y copia en español limpia, hora en un solo estilo, jerarquía del Dashboard, enlace de salto, teclado (login → navegación → crear actividad → cerrar diálogos → filtros; Bandeja), foco y descarte de diálogos, diálogo en pantalla baja, desbordamiento con contenido largo y a 320/768 px, tamaño de toques, 404, sesión expirada, refresco fallido sin perder datos, guardado fallido sin perder lo escrito, Bandeja con 10 propuestas.
- **Comprobaciones negativas** (se provocó la regresión y los tests fallaron): etiqueta de campo rota, contenido más ancho que la pantalla, foco sin devolver tras un diálogo, diálogo con texto que se cierra solo, enlace de salto oculto, refresco fallido que reemplaza los datos, botón de login bajo 44 px, sesión expirada sin manejar, horas en 24 h otra vez, aviso sin conexión flotando sobre la navegación.
- **Actualización de la PWA (prueba manual real, ejecutada)**: se sirvió la compilación A, la página registró su service worker (controlando), se escribió un correo en el formulario, se compiló la B encima y se pidió `registration.update()`. Resultado: aparece «Nueva versión disponible.» con «Actualizar ahora» y «Más tarde»; **6 s después la página no se había recargado** (el texto escrito y una marca en `window` seguían intactos); «Más tarde» oculta el aviso sin recargar; tras recargar a mano el aviso se ofrece de nuevo (el worker nuevo sigue esperando); «Actualizar ahora» recarga, muestra la versión B y el aviso desaparece.
- Revisión visual con capturas reales a 360, 768 y 1366 px de Dashboard, Asignaturas, Actividades, Agenda, Radar, Progreso, Bandeja e Importar horario (se revisaron y corrigieron: cuadrícula ilegible a 768 px, filtros que ocupaban medio pantallazo en móvil, cabecera de tres filas, horas en dos estilos).

## Limitaciones conocidas

- Sin dispositivo móvil real: ver la lista siguiente (pendiente).
- No hay interfaz para cambiar la zona horaria ni para gestionar periodos (funcionalidad que no existe; ver [limitations.md](limitations.md)).
- Los selectores de archivo y de hora usan el control nativo del navegador (su apariencia y textos los decide el navegador).
- Axe cubre lo automatizable; no se probó con un lector de pantalla real.
- El preguntar al descartar también salta si el estudiante escribe y luego deshace.

## Lista manual para dispositivos reales (PENDIENTE: no se ha ejecutado en un dispositivo)

**Android + Chrome** (con la app servida por HTTPS o `localhost` por túnel/USB):

1. Abrir la app y comprobar que Chrome ofrece instalarla («Instalar Academic Planner» en el Dashboard o menú ⋮ → Instalar).
2. Instalar; abrir desde el icono: debe abrir sin barra del navegador (standalone) con el icono propio.
3. Iniciar sesión; el teclado no tapa el campo activo y el botón sigue alcanzable.
4. Dashboard: desplazar de arriba abajo; la cabecera y «Cerrar sesión» se ven completas, sin recortes.
5. Crear una actividad con el teclado en pantalla; tocar fuera del diálogo con texto escrito → pregunta antes de descartar.
6. Agenda: cambiar de día con los chips; leer horas en 12 h; abrir un bloque.
7. Modo avión: abre el shell con el aviso «Sin conexión»; una acción falla con mensaje claro; al volver la red se recupera.
8. Con una versión nueva publicada: aviso «Nueva versión disponible»; «Más tarde» no recarga.
9. Girar el teléfono: sin desbordamiento horizontal.

**iPhone + Safari** (HTTPS):

1. Safari → Compartir → Agregar a pantalla de inicio; confirmar la ayuda «En Safari, usa Compartir…» en el Dashboard.
2. Abrir desde el icono: pantalla completa; **zonas seguras** (muesca y barra inferior) sin contenido tapado.
3. Mismos pasos 3–9 de Android; además: el selector de fecha/hora nativo, y subir una foto del horario desde la cámara/galería en «Importar horario».
