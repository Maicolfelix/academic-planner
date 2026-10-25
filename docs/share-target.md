# Compartir hacia la Captura rápida (A5, Web Share Target)

**Estado: DONE (PR #57 fusionado).** QA funcional manual a través de `/share` en el entorno local de desarrollo (HTTP). **La validación real del Share Target desde el menú «Compartir» del sistema operativo, con la PWA instalada, es parte del release gate** (prueba en un Android real: [release-qa-plan.md](release-qa-plan.md#share-target-en-android-pwa-instalada)); hasta entonces **no está validado**. No se afirma HTTPS, producción, soporte universal de navegador/SO ni validación con estudiantes. Solo texto, título y enlace: no hay archivos ni imágenes.

Desde otra aplicación (WhatsApp, el navegador, el correo, Classroom…) el estudiante comparte **texto, título y/o un enlace** con Academic Planner y se abre la **Captura rápida** con ese contenido ya escrito. Flujo: COMPARTIR → CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR. **Compartir nunca crea nada**: el estudiante ve la caja, puede editarla, interpretar o cancelar, y todo lo demás es la Captura rápida de siempre (sin segundo intérprete ni segunda pantalla).

## Alcance (MVP)

- Solo **texto, título y URL**. **Sin archivos ni imágenes.** Método `GET` (sin `multipart`, sin endpoint nuevo de API).
- `manifest.share_target`: `action: /share`, `method: GET`, `params: { title, text, url }`.
- **Depende del navegador, del sistema operativo y de tener la PWA instalada.** No se promete fuera de una PWA instalada ni en todos los navegadores. Probar `/share?text=…` a mano en un navegador **no** es la QA real del menú «Compartir» del sistema: esa validación queda para una instalación PWA con HTTPS (release gate, ver [release-qa-plan.md](release-qa-plan.md)).

## Soporte del Share Target y diferencia con el Web Share API

**Son dos cosas distintas.** El **Web Share API** (`navigator.share`) sirve para **compartir desde** una página hacia otras apps; Academic Planner **no lo usa** (no hay botón de compartir), y Safari/iOS sí pueden compartir. El **Web Share Target** es lo contrario: que la PWA aparezca como **destino** en el menú «Compartir» del sistema. Es lo único que implementa A5.

| Plataforma                                     | ¿Academic Planner puede ser destino de compartir? | Notas                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Android con Chromium (WebAPK)**              | **Sí**, con la PWA **instalada**                  | Es el caso que se valida con un dispositivo real. En Android la URL suele llegar dentro del campo `text` (el código ya lo contempla).                                                                      |
| **ChromeOS**                                   | **Sí**, con la PWA instalada                      | No es un objetivo de la QA de v1.                                                                                                                                                                          |
| **Safari / iOS**                               | **No** como destino                               | Limitación de la plataforma, no un defecto. En un iPhone la app no aparece en la hoja de compartir; **la QA de iOS no lo espera ni lo exige**. Reconfirmar en la tabla de compatibilidad de MDN al probar. |
| Chromium de escritorio (Windows, macOS, Linux) | Sin verificar                                     | Chrome 89 anunció soporte en escritorio para Windows y ChromeOS; no es un objetivo de v1 y no se afirma.                                                                                                   |

**Siempre exige instalar la PWA:** el navegador registra el destino en el sistema operativo al instalar, y sin instalar la app no aparece. Requiere además HTTPS (service worker e instalación). MDN marca `share_target` como **experimental** y de «disponibilidad limitada»: no es una característica universal.

Fuentes técnicas (consultadas el 2026-10-25; la documentación de web.dev es antigua, hay que revisar el estado actual al probar):

- [Receiving shared data with the Web Share Target API (web.dev)](https://web.dev/web-share-target/)
- [OS Integration, Web Share Target (web.dev, Learn PWA)](https://web.dev/learn/pwa/os-integration/)
- [`share_target`, referencia del manifest (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
- [New in Chrome 89 (Chrome for Developers)](https://developer.chrome.com/blog/new-in-chrome-89)

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
