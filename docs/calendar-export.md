# Añadir al calendario (A4.1)

El estudiante descarga **una actividad** como archivo `.ics` y deja que su navegador o sistema operativo decida con qué aplicación de calendario abrirlo. Es una **instantánea**: no hay feed, token, sincronización, OAuth ni API de Google. Decisión y alcance: [decisions.md](decisions.md#d23-añadir-al-calendario-antes-que-el-feed-sincronizado). La investigación que lo respalda (RFC, validadores, comparación con el feed): [spikes/a4-calendar-feed](spikes/a4-calendar-feed/normative-validation.md).

## Qué hace

- Botón **«Añadir al calendario»** en cada tarjeta de [Actividades](activities.md) (un clic, sin pantalla nueva ni preguntas).
- `GET /api/activities/:id/calendar.ics` (sesión obligatoria) responde un `.ics` con `Content-Type: text/calendar; charset=utf-8` y `Content-Disposition: attachment; filename="academic-planner-activity.ics"`. El nombre del archivo es **fijo**: nunca se construye con el título.
- Solo exporta la actividad que el estudiante eligió. Clases, bloques de estudio, varias actividades a la vez, recordatorios y `VALARM` **no** entran.
- Una actividad **completada** también se puede exportar: es una acción manual, no un feed de pendientes.

## Representación del tiempo

Se mantiene el modelo actual: `Activity.dueAt` + `hasTime`. No se reinterpreta por tipo.

| Actividad                  | Evento                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sin hora (`hasTime` false) | Día completo en el **día local** del usuario (`DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` el día siguiente). No se escribe 23:59 |
| Con hora                   | Bloque de **15 minutos que termina en `dueAt`**, en UTC. Un parcial a las 8:30 se ve 8:15–8:30                                |

**Limitación documentada:** el bloque de 15 minutos es una forma de dibujar el **instante conocido**, no afirma que un examen dure 15 minutos ni que empiece a las 8:15. Un parcial, un quiz o una presentación cuya `dueAt` es la hora de **inicio** se ven desplazados. El modelo no distingue «fecha límite» de «hora del evento»; esa distinción es deuda de dominio (opciones en [normative-validation.md](spikes/a4-calendar-feed/normative-validation.md#10-deuda-del-modelo-de-tiempo-activitydueat)) y no se resuelve aquí.

## Subconjunto de iCalendar (RFC 5545)

`VCALENDAR` (`VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`) con un `VEVENT`: `UID`, `DTSTAMP`, `LAST-MODIFIED`, `DTSTART`, `DTEND`, `SUMMARY`, `TRANSP:TRANSPARENT`.

**No se escribe:** `METHOD` (RFC 5546 §3.2.1 exigiría `ORGANIZER`), `VALARM`, `SEQUENCE`, `REFRESH-INTERVAL` (es un intervalo mínimo, no acelera nada), `X-PUBLISHED-TTL` (no estándar), `RRULE`, `VTIMEZONE`, `DESCRIPTION`, prioridad, estado, tipo, nombre o correo del usuario.

- **`UID`:** `activity-<id de la actividad>`. Opaco y estable (RFC 7986 §5.3: sin dominio, correo ni datos del usuario). Editar el título, la fecha o la asignatura no cambia quién es el evento.
- **`DTSTAMP` = `LAST-MODIFIED`:** el mayor de `Activity.updatedAt` y `Subject.updatedAt` (el nombre de la asignatura va en el título), a segundos. Sin `METHOD` ambos son equivalentes (RFC 5545 §3.8.7.2). **Nunca la hora de la exportación:** la misma actividad sin cambios produce exactamente los mismos bytes. Dos ediciones dentro del mismo segundo comparten sello.
- **`SUMMARY`:** `Título — Asignatura`; en una actividad **sin asignatura** (F1) es solo el `Título`: no se escribe «Sin asignatura» ni «General» en el calendario del estudiante, y el servicio ni siquiera consulta la asignatura. Decisión de privacidad: es información que el estudiante ya ve en la tarjeta, el archivo va a su propio dispositivo y sin la asignatura «Taller» o «Entrega» no se distinguirían en un calendario. Es el único dato académico además del título y las fechas.
- **El título es texto no confiable** (viene del estudiante o de una importación): se normaliza (CR, LF y CRLF → un salto `\n`; caracteres de control eliminados; sustituto UTF-16 suelto → U+FFFD), se escapa (`\` `;` `,` y saltos; `:` y `"` no) y se pliega a 75 **octetos** entre caracteres (nunca dentro de una secuencia UTF-8 ni dejando una línea terminada en espacio). Un título no puede cerrar su línea ni abrir `BEGIN:VEVENT`, `ATTENDEE` o `DESCRIPTION`. Implementación y pruebas: [`packages/core/src/icalendar.ts`](../packages/core/src/icalendar.ts), `icalendar.test.ts`.

## Validación

- **Pruebas:** core (40, con _mutation checks_ sobre CR, escapes, plegado, controles, sustituto, sello, día completo, bloque, `UID` y `METHOD`: 12 de 12 detectados), API (10 en `calendarExport.test.ts` más las matrices de propiedad y de sesión anónima), web (`apiDownload`) y navegador (`e2e/calendar-export.spec.ts`: día completo, con hora, título hostil, error con reintento, axe, 360 y 1366 px).
- **Independiente (2026-10-07):** cinco archivos generados con el código real (día completo, con hora, 23:59, título hostil y Unicode largo) se leyeron de vuelta con **ical.js 2.2.1** (instalado fuera del repositorio; no es una dependencia) y se pasaron por **iCalendar Validator v1.22 (icalendar.org)**: sin errores en los cinco. El validador cuenta 2 bytes menos que el archivo (el CRLF final); no afecta al resultado. Datos sintéticos.

## Validación en dispositivo real

QA manual del mantenedor (detalle en [manual-qa.md](spikes/a4-calendar-export/manual-qa.md)): **iPhone real, Safari, Apple Calendar**, abriendo la app por HTTP en red local (no PWA instalada).

- Al pulsar «Añadir al calendario», iOS abrió directamente la interfaz de Calendario; no hubo que buscar el archivo en Descargas ni Archivos.
- Sin hora: evento de día completo con título, asignatura y fecha correctos. Con hora (23:59): 11:44–11:59 p. m. el mismo día. Parcial a las 8:30: 8:15–8:30 a. m., como indica la semántica actual, y el mantenedor lo considera aceptable.
- Segunda importación de la misma actividad: iOS reconoció el evento existente y no se observó un segundo evento. **Solo se observó en Apple Calendar**; no se generaliza a otros clientes.
- **No probado:** Android, Chrome móvil, Windows con interfaz real, macOS, Google Calendar, Outlook, una actividad modificada y la PWA instalada (**NOT TESTED — PWA REQUIRES HTTPS**).

## Qué NO se afirma

- **No se probó en Google Calendar ni Outlook, ni en Android, Windows con interfaz real o macOS** (Apple Calendar en iPhone sí, ver arriba). Qué app abre el archivo, si lo ofrece añadir o solo lo guarda, y si volver a descargar la misma actividad **reemplaza** el evento por su `UID` o lo **duplica** dependen del navegador, del sistema operativo y del cliente. Pendiente de pruebas con clientes y estudiantes reales.
- Que el archivo sea válido para un validador no garantiza cómo lo pinta cada cliente.
- Es una instantánea: si la actividad cambia después, el calendario **no** se entera. Descargarla de nuevo es la forma de actualizarla.

## Deuda y trabajo futuro

- Distinguir fecha límite de hora de evento (campos explícitos), antes de cambiar la representación de exámenes.
- **A4.2 — feed sincronizado: diferido** hasta que haya evidencia (estudiantes que pidan que se actualice solo y clientes reales con un refresco aceptable). Reutilizaría este mismo serializador; añadiría token, endpoint público y migración.
