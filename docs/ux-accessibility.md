# UX, accesibilidad y responsive (Fase 15)

Principio de la fase: **pulir, no reinventar**. No hubo reglas de negocio nuevas ni cambios en Radar, Atención, recordatorios, progreso, carga, parser, OCR, recurrencia, propiedad ni autenticación. Esta es una auditoría **orientada a WCAG 2.1 AA** (lo automatizable más revisión manual); **no es una certificación**.

## Objetivos

- Que la app se sienta simple, rápida, académica, sin alarmismo.
- Que se pueda usar con el teclado, con lector de pantalla, con el dedo (360 px) y con zoom/texto grande.
- Que nada que el estudiante escribió se pierda por accidente.

## Navegación y estructura

- **Navegación principal** (`nav "Principal"`): Inicio, Asignaturas, Actividades, Agenda, más «Cerrar sesión». Radar, Progreso, Bandeja y Importar horario se alcanzan desde el Dashboard y la Agenda: no se llenó la barra.
- **Sección activa**: fondo + subrayado (no solo color) y `aria-current="page"`.
- **Móvil (360 px)**: dos filas — marca y «Cerrar sesión» arriba, las cuatro secciones repartidas por igual debajo (`grid auto-fit`, se parte en más filas si el texto crece). Sin menú hamburguesa.
- **Reflow**: pantallas verificadas sin desbordamiento horizontal a **320**, 360, 768 y 1366 px.
- **Ancho de página**: una columna de lectura (`max-w-3xl`) en todas las pantallas; solo la Agenda semanal usa `max-w-6xl` porque necesita siete columnas legibles.
- **Landmarks**: `banner` (cabecera), `nav`, `main#contenido`. Enlace **«Saltar al contenido»** como primera parada del teclado.
- **Un solo `h1` por pantalla** y un **título de documento** distinto por pantalla («Agenda · Academic Planner»).
- **Nombre del producto**: «Academic Planner» en todas partes (antes había «Planificador Académico» en el login).
- **Ruta inexistente**: página «No encontramos esa página» con «Volver al inicio» (antes redirigía en silencio).
- **Error inesperado de renderizado**: `ErrorBoundary` global con mensaje amable (el error se registra en consola, no se oculta).

## Breakpoints

Solo tres, los de Tailwind: **640 px** (`sm`: filtros en una fila), **768 px** (`md`: navegación en una fila) y **1024 px** (cuadrícula semanal de la Agenda; por debajo se usa la lista diaria — a 768 px las clases que se cruzan quedaban ilegibles).

## Dashboard

Jerarquía: saludo → recordatorios (cuando hay) → **¿Qué hago ahora?** → **Captura rápida** (+ acceso a la Bandeja) → resumen → Radar → próxima entrega → clases de hoy → entregas → semana → progreso. «Próxima entrega» pasó a una tarjeta de borde fino para no competir con la recomendación. A 360 px la página mide ≈ 3180 px; no se eliminó información.

## Formularios y diálogos

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
- No hay interfaz para cambiar la zona horaria ni para gestionar periodos (funcionalidad nueva, fuera de esta fase).
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
