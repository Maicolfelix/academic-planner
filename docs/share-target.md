# Compartir hacia la Captura rápida (A5, Web Share Target)

**Estado: DONE (PR #57 fusionado).** QA funcional manual a través de `/share` en el entorno local de desarrollo (HTTP). **La validación real del Share Target desde el menú «Compartir» del sistema operativo, con la PWA instalada, queda diferida a P12.** No se afirma HTTPS, producción, soporte universal de navegador/SO ni validación con estudiantes. Solo texto, título y enlace: no hay archivos ni imágenes.

Desde otra aplicación (WhatsApp, el navegador, el correo, Classroom…) el estudiante comparte **texto, título y/o un enlace** con Academic Planner y se abre la **Captura rápida** con ese contenido ya escrito. Flujo: COMPARTIR → CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR. **Compartir nunca crea nada**: el estudiante ve la caja, puede editarla, interpretar o cancelar, y todo lo demás es la Captura rápida de siempre (sin segundo intérprete ni segunda pantalla).

## Alcance (MVP)

- Solo **texto, título y URL**. **Sin archivos ni imágenes.** Método `GET` (sin `multipart`, sin endpoint nuevo de API).
- `manifest.share_target`: `action: /share`, `method: GET`, `params: { title, text, url }`.
- **Depende del navegador, del sistema operativo y de tener la PWA instalada.** No se promete fuera de una PWA instalada ni en todos los navegadores. Probar `/share?text=…` a mano en un navegador **no** es la QA real del menú «Compartir» del sistema: esa validación queda para una instalación PWA con HTTPS (P12).

## Cómo funciona

1. `/share` (ruta de la propia PWA, **fuera** del guardia de sesión) lee `title`, `text` y `url`, compone el texto (`composeSharedText`, función pura de `packages/core/src/shareTarget.ts`) y lo guarda **solo en la pestaña** (`sessionStorage`, clave `academic-planner:shared-capture`: texto, avisos, `receivedAt`, `source`).
2. Navega con `replace` a `/dashboard`: el contenido compartido **ya no está en la barra de direcciones ni en el historial**.
3. Si no hay sesión, el guardia manda a `/login` y, tras entrar, el estudiante llega a `/dashboard` con lo compartido todavía disponible (**10 minutos**).
4. La Captura rápida lee lo compartido y lo precarga con foco, escribiéndolo **de inmediato como un borrador normal**; solo **después de esa escritura** lo retira de la pestaña. «Una sola vez» significa una **entrega efectiva** (nunca se retira antes de que el borrador sea duradero): si algo interrumpe el traspaso (un remontaje, una recarga, un almacenamiento que falla), lo compartido sigue disponible hasta sus 10 minutos, y una vez entregado recargar no lo reinyecta. Si ya había un **borrador**, no lo sobrescribe: pregunta «Tienes un borrador en Captura rápida» con **Usar lo compartido** / **Mantener mi borrador**; hasta que el estudiante decida, lo compartido sigue esperando (recargar vuelve a preguntar), y al decidir se retira. Los avisos (recorte, enlace omitido) se muestran al usar lo compartido.

Lo compartido **no se envía al servidor** hasta que el estudiante pulse «Interpretar» (el flujo normal), no se guarda en la base de datos y no se registra. El texto precargado se conserva después como cualquier borrador local de la Captura rápida.

## Composición del texto

`título` (solo si no está ya en el texto), `texto`, `enlace` (solo si el texto no lo trae ya; Android suele poner el enlace dentro del texto), una parte por línea. Se normalizan los saltos de línea y se quitan los caracteres de control; tildes, ñ, emoji y saltos de línea llegan intactos.

**Límites explícitos** (nunca se recorta en silencio; se avisa): título 200, texto 5000, URL 2048 y el texto final no excede el límite de la Captura rápida (5000). Si algo se corta, la Captura muestra «Lo compartido era muy largo y se recortó…». Una URL demasiado larga se omite (un enlace cortado es un enlace equivocado).

**Enlaces:** solo `http` y `https`. Cualquier otra cosa (`javascript:`, `data:`, esquemas propios, texto que no es una URL) **no se transporta** y se avisa («Se omitió un enlace que no era http ni https»). El contenido se muestra siempre como texto en el `<textarea>`; nunca como HTML.

## `returnTo` seguro (sesión caducada o ausente)

`RequireAuth` ahora recuerda la ruta a la que se quería ir y el login vuelve a ella. `safeReturnTo` (núcleo) acepta **solo rutas internas** de la aplicación y rechaza URL absolutas, `//host`, `javascript:`, `data:`, barras invertidas, caracteres de control y variantes codificadas: sin redirección abierta. Está cubierto con pruebas.

## Lo que no hace

Archivos, imágenes, `POST`/`multipart`, creación automática de actividades o notas, compartir hacia la Bandeja, soporte sin conexión para la API (`/api/*` sigue siendo `NetworkOnly`). Si el estudiante aún no tiene asignaturas, la Captura rápida del Inicio no se muestra y lo compartido espera hasta que caduque (10 minutos).

## Pruebas

Núcleo (`shareTarget.test.ts`: composición, límites, URL insegura, Unicode, `returnTo`), web (`share/sharedCapture.test.ts`: un solo uso, caducidad, carga corrupta, almacenamiento bloqueado) y `e2e/share-target.spec.ts` (sesión iniciada y no iniciada, borrador existente, aviso de vacío, enlace inseguro, XSS como texto, Unicode y codificación mal formada, caducidad, límite, manifiesto y 360/768/1366 px).
