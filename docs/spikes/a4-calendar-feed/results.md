# A4-0: resultados del spike

> **Estado: clientes reales NOT TESTED.** Lo que sí se ejecutó (validación, servidor local) está en [la sección final](#verificaciones-locales-sí-ejecutadas). Ninguna celda de cliente se llenó sin haberla probado. Protocolo y fixtures: [README.md](README.md).

Leyenda: `NOT TESTED` = no se probó en esta sesión (instrucciones exactas en el README); al completar cada celda escribir qué se vio, en qué dispositivo y versión, y la hora si es una medición.

## Resultados por cliente

Anotar aquí **dónde** se probó cada columna (ejemplo: «Google: calendar.google.com en Chrome + Pixel 8, Android 15»): `Google: NOT TESTED` · `Apple: NOT TESTED` · `Outlook: NOT TESTED`.

| #   | Prueba                          | Google     | Apple      | Outlook    |
| --- | ------------------------------- | ---------- | ---------- | ---------- |
| 1   | Subscription accepted           | NOT TESTED | NOT TESTED | NOT TESTED |
| 2   | Correct timezone                | NOT TESTED | NOT TESTED | NOT TESTED |
| 3   | Correct all-day date            | NOT TESTED | NOT TESTED | NOT TESTED |
| 4   | 23:59 deadline stays on one day | NOT TESTED | NOT TESTED | NOT TESTED |
| 5   | Class time correct              | NOT TESTED | NOT TESTED | NOT TESTED |
| 6   | Unicode correct                 | NOT TESTED | NOT TESTED | NOT TESTED |
| 7   | Long line correct               | NOT TESTED | NOT TESTED | NOT TESTED |
| 8   | Relative VALARM                 | NOT TESTED | NOT TESTED | NOT TESTED |
| 9   | Absolute VALARM                 | NOT TESTED | NOT TESTED | NOT TESTED |
| 10  | V2 title update                 | NOT TESTED | NOT TESTED | NOT TESTED |
| 11  | V2 time update                  | NOT TESTED | NOT TESTED | NOT TESTED |
| 12  | V2 deletion                     | NOT TESTED | NOT TESTED | NOT TESTED |
| 13  | New event appears               | NOT TESTED | NOT TESTED | NOT TESTED |
| 14  | No duplicate after update       | NOT TESTED | NOT TESTED | NOT TESTED |
| 15  | Refresh latency                 | NOT TESTED | NOT TESTED | NOT TESTED |
| 16  | Manual refresh available        | NOT TESTED | NOT TESTED | NOT TESTED |
| 17  | REFRESH-INTERVAL respected      | NOT TESTED | NOT TESTED | NOT TESTED |
| 18  | X-PUBLISHED-TTL respected       | NOT TESTED | NOT TESTED | NOT TESTED |
| 19  | Need for SEQUENCE               | NOT TESTED | NOT TESTED | NOT TESTED |
| 20  | Observations                    | NOT TESTED | NOT TESTED | NOT TESTED |

Notas para las filas que se confunden:

- **6 y 7:** la lectura de vuelta con un parser independiente ya es exacta (ver abajo), pero eso **no** dice nada sobre cómo lo muestra cada cliente.
- **10 y 11:** v2 cambia cada cosa con y sin `SEQUENCE` (ver el [README](README.md#qué-cambia-de-v1-a-v2)); anotar cuáles se reflejaron.
- **17 y 18:** compararlas contra la suscripción `-nohints`; con `serve.mjs` el registro dice cuándo consultó el cliente.
- **19:** conclusión solo si hay una diferencia observada entre los eventos con y sin `SEQUENCE`.

## Mediciones de refresco

Completar con **horas exactas** y duraciones aproximadas («12 min», «1 h 20 min»); si al terminar la sesión no se reflejó: «> 2 h+ y aún no actualizado». Sin adjetivos.

| Cliente / dispositivo | Suscrito (hora) | v2 publicada (hora exacta) | Cambio de título | Cambio de hora | Baja       | Alta       | Primera consulta tras v2 (registro del servidor) | Refresco manual |
| --------------------- | --------------- | -------------------------- | ---------------- | -------------- | ---------- | ---------- | ------------------------------------------------ | --------------- |
| Google                | NOT TESTED      | NOT TESTED                 | NOT TESTED       | NOT TESTED     | NOT TESTED | NOT TESTED | NOT TESTED                                       | NOT TESTED      |
| Apple                 | NOT TESTED      | NOT TESTED                 | NOT TESTED       | NOT TESTED     | NOT TESTED | NOT TESTED | NOT TESTED                                       | NOT TESTED      |
| Outlook               | NOT TESTED      | NOT TESTED                 | NOT TESTED       | NOT TESTED     | NOT TESTED | NOT TESTED | NOT TESTED                                       | NOT TESTED      |

## VALARM (por separado, por condición y dispositivo)

No generalizar a partir de un solo dispositivo: escribir el dispositivo exacto en cada celda.

| Cliente / dispositivo | Alarma relativa, notificaciones del calendario activadas | Relativa, desactivadas | Absoluta, activadas | Absoluta, desactivadas |
| --------------------- | -------------------------------------------------------- | ---------------------- | ------------------- | ---------------------- |
| Google (escritorio)   | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |
| Google (móvil)        | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |
| Apple (macOS)         | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |
| Apple (iPhone)        | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |
| Outlook (web)         | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |
| Outlook (móvil)       | NOT TESTED                                               | NOT TESTED             | NOT TESTED          | NOT TESTED             |

## Semántica del deadline (observación visual)

«Parcial de Redes» con `dueAt` 08:30, representado como 08:15–08:30; comparar con «Entrega Proyecto» 23:44–23:59. Pegar una captura por cliente y responder: ¿resulta visualmente natural? ¿parece que el parcial empieza a las 8:15? ¿se prefiere un bloque que empiece a las 8:30?

| Cliente | ¿Natural?  | Observación escrita | ¿Qué preferiría quien lo mira? |
| ------- | ---------- | ------------------- | ------------------------------ |
| Google  | NOT TESTED | NOT TESTED          | NOT TESTED                     |
| Apple   | NOT TESTED | NOT TESTED          | NOT TESTED                     |
| Outlook | NOT TESTED | NOT TESTED          | NOT TESTED                     |

## Microprueba con estudiantes

Preguntas y ejemplos en el [README](README.md#microprueba-con-estudiantes-preparada-sin-estudiantes-disponibles-en-esta-sesión). **Sin estudiantes disponibles en esta sesión: cuestionario preparado, 0 respuestas.**

| Estudiante | 1. A / B / depende | 2. ¿Clases ya en otro calendario? | 3. Completada: A (desaparece) / B (historial) | 4. Enlace de una sola vez: Sí / No | Comentario |
| ---------- | ------------------ | --------------------------------- | --------------------------------------------- | ---------------------------------- | ---------- |
| 1          | NOT TESTED         | NOT TESTED                        | NOT TESTED                                    | NOT TESTED                         |            |
| 2          | NOT TESTED         | NOT TESTED                        | NOT TESTED                                    | NOT TESTED                         |            |
| 3          | NOT TESTED         | NOT TESTED                        | NOT TESTED                                    | NOT TESTED                         |            |

## Verificaciones locales (sí ejecutadas)

Estas **sí se ejecutaron** (2026-10-07, Windows, Node 24.19). No sustituyen a los clientes reales.

### Fixtures

- Generados por [generate.mjs](generate.mjs); regenerar da **exactamente los mismos bytes** (comparado por SHA-256).
- Fin de línea CRLF preservado en git (`*.ics -text`).
- Cambios v1 → v2 verificados por UID: **cambiados** 4 (`entrega`, `parcial`, `taller`, `class-redes-20261019`), **byte-idénticos** 4 (`class-redes-20261026`, `alarm-relative`, `alarm-absolute`, `long-title`), **eliminado** 1 (`unicode`), **añadido** 1 (`new-in-v2`).
- Las variantes `-nohints` no contienen `REFRESH-INTERVAL` ni `X-PUBLISHED-TTL` y sus eventos son idénticos a los de v1.

### Validación independiente

Herramienta: [validate.mjs](validate.mjs) con **ical.js 2.2.1** (instalado fuera del repositorio, no es una dependencia del proyecto) más reglas estructurales propias de RFC 5545.

| Archivo        | Eventos leídos por ical.js | Errores | Avisos  |
| -------------- | -------------------------- | ------- | ------- |
| `spike-v1.ics` | 9                          | ninguno | ninguno |
| `spike-v2.ics` | 9                          | ninguno | ninguno |

- Lectura de vuelta **exacta** (comparación de cadenas) del título largo y del título con `ñ á é í ó ú ¿? , ; \` (escapes `\,` `\;` `\\` correctos); 3 líneas plegadas en v1, ninguna con más de 75 octetos.
- Instantes UTC correctos: la entrega de las 23:59 Bogotá es `2026-10-24T04:59:00Z`; la clase 08:00–10:00 es 13:00–15:00Z; el evento de día completo es `DATE` 2026-10-22 → 2026-10-23.
- **Controles negativos** (el validador debe fallar con archivos rotos): fin de línea LF → falla; línea de 142 octetos → falla; `DTEND` anterior a `DTSTART` → falla; UTF-8 inválido → falla; falta `DTSTAMP` → falla (5 de 5).
- **No ejecutado:** un validador RFC de terceros (por ejemplo el de icalendar.org): exige subir el archivo a un servicio externo; pendiente, manual. `ical.js` es un parser, no un validador RFC completo.

### Servidor del spike (localhost)

Probado con `curl` contra [serve.mjs](serve.mjs): `Content-Type: text/calendar; charset=utf-8`; `Content-Disposition: inline`; `Cache-Control: no-store`; `ETag` y `Last-Modified`; `304` ante `If-None-Match`; `/switch/v2` cambia la versión servida e imprime la hora; `/feed-nohints.ics` sirve la variante sin pistas; ruta inexistente → 404; cada petición queda registrada con hora, agente y cabeceras condicionales. **No** se expuso a Internet.

## Conclusión del estado del spike

**Incompleto:** el protocolo, los fixtures, la validación local y el cuestionario están hechos; faltan los tres clientes reales (y un validador RFC de terceros) y la microprueba con estudiantes. Las [puertas de decisión](README.md#puertas-de-decisión-de-a4-1) siguen abiertas.
