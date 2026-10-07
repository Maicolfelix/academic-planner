# A4-0: spike de clientes de calendario para el feed `.ics`

> **Estado: protocolo y herramientas listos; resultados de los clientes reales: NOT TESTED.** Esto es documentación y herramientas de prueba, **no código de producto**: A4 no está implementado y este spike no toca Prisma, API, web, `packages/core` de producto, dependencias ni versión. Los resultados que no se probaron de verdad están marcados `NOT TESTED` en [results.md](results.md): no se inventó ninguno.

## Para qué sirve

Antes de escribir el feed `.ics` de A4 ([diseño en el roadmap](../../roadmap-post-rc.md)) hay que saber cómo se comportan de verdad Google Calendar, Apple Calendar y Outlook con un feed como el que A4 publicaría: cómo muestran un deadline, si respetan alarmas y pistas de refresco, cuánto tardan en reflejar una actualización o una baja y si hace falta `SEQUENCE`. Con esa evidencia se deciden las puertas de [decisión](#puertas-de-decisión-de-a4-1) y recién entonces se escribe A4-1.

## Archivos

| Archivo                                        | Qué es                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [spike-v1.ics](spike-v1.ics)                   | Feed sintético, versión 1 (9 eventos). Fechas fijas de octubre de 2026                                                                           |
| [spike-v2.ics](spike-v2.ics)                   | Versión 2: mismos UID, con cambios, una baja y un alta (ver [tabla](#qué-cambia-de-v1-a-v2))                                                     |
| `spike-v1-nohints.ics`, `spike-v2-nohints.ics` | Las mismas versiones **sin** `REFRESH-INTERVAL` ni `X-PUBLISHED-TTL`, para separar el efecto de las pistas del refresco por defecto del cliente  |
| [generate.mjs](generate.mjs)                   | Genera los cuatro archivos (y otras fechas, p. ej. alarmas a 50 min de «ahora»). Serializador desechable: A4-1 escribirá el real                 |
| [serve.mjs](serve.mjs)                         | Servidor estático mínimo que **registra cada petición** (hora exacta, agente, `If-None-Match`…) para medir el refresco también del lado servidor |
| [validate.mjs](validate.mjs)                   | Validador: parsea con `ical.js` (implementación independiente) y comprueba reglas estructurales de RFC 5545                                      |
| [results.md](results.md)                       | Tabla de resultados (la que hay que completar) y lo que ya se verificó localmente                                                                |

Los `.ics` conservan fin de línea CRLF (RFC 5545): un `.gitattributes` local (`*.ics -text`) impide que git los normalice a LF.

## Qué contiene el feed de prueba (v1)

Todo es sintético; las horas «Bogotá» son UTC-5.

| #   | Evento (UID)                          | Representación                                                                      | Qué observa                                                    |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `spike-activity-entrega` (vie 23-oct) | **Termina** en `dueAt`: 23:44–23:59 Bogotá (04:44–04:59Z del sábado)                | Que no cruce de día (el 23:59 es lo más frecuente en entregas) |
| 2   | `spike-activity-parcial` (mié 21-oct) | Parcial con `dueAt` 08:30 **tratado como deadline** (semántica actual): 08:15–08:30 | Si «se siente incorrecto» (el parcial empieza a las 8:30)      |
| 3   | `spike-activity-taller` (jue 22-oct)  | Día completo: `DTSTART;VALUE=DATE:20261022`, `DTEND;VALUE=DATE:20261023`            | Que caiga en el día correcto, sin hora inventada               |
| 4   | `spike-class-redes-20261019` (lun)    | Clase 08:00–10:00 Bogotá (13:00–15:00Z)                                             | Hora correcta en la zona del dispositivo                       |
| 5   | `spike-class-redes-20261026` (lun)    | Segunda ocurrencia, UID individual por fecha                                        | Identidad estable de cada ocurrencia                           |
| 6   | `spike-unicode`                       | Título con `ñ á é í ó ú ¿? , ; \`, escapados (`\,` `\;` `\\`)                       | Texto íntegro                                                  |
| 7   | `spike-long-title`                    | Título largo con caracteres de varios bytes: se pliega a 75 **octetos**             | Que ningún carácter se parta al plegar                         |
| 8   | `spike-alarm-relative`                | `VALARM` `TRIGGER:-PT30M`                                                           | Alarma relativa                                                |
| 9   | `spike-alarm-absolute`                | `VALARM` `TRIGGER;VALUE=DATE-TIME:…Z`                                               | Alarma absoluta                                                |

Decisiones deliberadas del fixture (a confirmar o descartar con los resultados): sin `METHOD` (ver [DTSTAMP](#dtstamp-last-modified-y-sequence-rfc-5545)); eventos de actividad `TRANSP:TRANSPARENT`; `DTSTAMP` y `LAST-MODIFIED` fijos y deterministas; ningún evento lleva `DESCRIPTION` (datos mínimos); `X-WR-CALNAME`; y, solo en las versiones con pistas, `REFRESH-INTERVAL;VALUE=DURATION:PT10M` y `X-PUBLISHED-TTL:PT10M` (10 minutos a propósito, para distinguirlo del refresco por defecto, que suele ser de horas).

Las alarmas están fijadas el viernes 23 de octubre de 2026 (para que existan sin depender de «ahora»). **Para probar que realmente suenan**, regenera con alarmas próximas:

```bash
node docs/spikes/a4-calendar-feed/generate.mjs --alarms-in 50 --out <carpeta-temporal>
node docs/spikes/a4-calendar-feed/generate.mjs --alarms-in 50 --no-hints --suffix -nohints --out <carpeta-temporal>
```

(el evento de alarma relativa empieza a los 50 minutos y la alarma suena a los 20; la absoluta, 20 minutos después).

## Qué cambia de v1 a v2

`UID` iguales en los eventos que sobreviven. Cada cambio se hace **dos veces** (con y sin `SEQUENCE`) para saber si hace falta:

| Evento                                             | Cambio en v2                                                                                           | `SEQUENCE` |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- |
| `spike-activity-entrega`                           | **Hora**: ahora termina a las 23:30 (antes 23:59)                                                      | no cambia  |
| `spike-activity-parcial`                           | **Hora**: 09:15–09:30 (antes 08:15–08:30)                                                              | `1`        |
| `spike-activity-taller`                            | **Título**: «… (título cambiado en v2)»                                                                | no cambia  |
| `spike-class-redes-20261019`                       | **Título**: «… (aula cambiada en v2)»                                                                  | `1`        |
| `spike-unicode`                                    | **Eliminado**                                                                                          | n/a        |
| `spike-new-in-v2`                                  | **Nuevo** (mié 21-oct 15:00–16:00 Bogotá)                                                              | n/a        |
| el resto (clase del 26-oct, alarmas, título largo) | **Idénticos byte a byte**; `DTSTAMP`/`LAST-MODIFIED` de los modificados pasan a `2026-10-07T18:00:00Z` | n/a        |

Si los eventos con y sin `SEQUENCE` se actualizan igual, `SEQUENCE` no hace falta; si solo se actualizan los que lo llevan, sí (y habría que distinguir título de hora: por eso hay dos de cada).

## Entorno del spike

**Lo que se ejecutó en esta sesión (verificado):** generación de los fixtures, validación con `ical.js` 2.2.1 y comprobaciones estructurales (incluidos controles negativos), y el servidor `serve.mjs` en `localhost` (cabeceras, `ETag`, `304`, cambio de versión, 404). Detalle en [results.md](results.md).

**Lo que no se pudo ejecutar:** ningún cliente real (Google, Apple, Outlook): no hay cuentas ni dispositivos conectados a esta sesión y el repositorio es privado, así que tampoco hay una URL HTTPS pública donde suscribirse. Se dejan las instrucciones exactas abajo. Para validar con un validador RFC de terceros (p. ej. el de icalendar.org) hay que subir el archivo a un servicio externo: no se hizo; son datos sintéticos y se puede hacer manualmente.

### Cómo servirlo por HTTPS público

Los tres clientes necesitan una URL accesible desde sus servidores (Google y Microsoft consultan desde la nube; no llegan a `localhost`). Opciones (elegir una y **anotarla en results.md**); el contenido es sintético, pero no pongas credenciales en ningún lado:

1. **Servidor local + túnel**: `node docs/spikes/a4-calendar-feed/serve.mjs --port 8080` y un túnel HTTPS temporal (por ejemplo Cloudflare Quick Tunnel: `cloudflared tunnel --url http://127.0.0.1:8080`). Ventaja: el registro del servidor mide cuándo consulta cada cliente, con hora exacta. La URL a suscribir es `https://<túnel>/feed.ics` (y `/feed-nohints.ics`). Para publicar v2: abrir `https://<túnel>/switch/v2` y **anotar la hora que imprime el servidor**.
2. **Alojamiento estático de prueba** (gist secreto, un bucket o similar) con los `.ics`: para publicar v2 hay que reemplazar el contenido en la misma URL y anotar la hora; no hay registro de consultas.

El servidor responde `Content-Type: text/calendar; charset=utf-8`; con (1) también `ETag`/`Last-Modified` y `304` (`--no-conditional` lo desactiva para ver si el cliente depende de ello).

## Protocolo manual (por cliente y dispositivo)

Repetir en **Google Calendar** (web, y Android si hay), **Apple Calendar** (iPhone y/o macOS) y **Outlook** (outlook.com o Microsoft 365 en web, y móvil si hay). Usar cuentas de prueba. Los pasos de menú pueden variar con la versión del cliente.

1. **Suscribir** por URL, no importar el archivo: Google: _Otros calendarios → Desde URL_ (en la web; el móvil lo sincroniza); Apple: iPhone _Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito_ / macOS _Archivo → Nueva suscripción de calendario_ (elegir la frecuencia automática o la menor y anotar cuál); Outlook: _Añadir calendario → Suscribirse desde la web_. Anotar la hora exacta (`feed.ics` con pistas; `feed-nohints.ics` en otra suscripción).
2. **Observar y fotografiar** (fila 2–9 de la tabla): zona horaria (cambiar la zona del dispositivo a otra, p. ej. Tokio, y comprobar que el instante se conserva y el evento de día completo sigue en su día), día completo, el evento de las 23:59 en un solo día, la clase a las 8:00, texto con tildes y símbolos, el título largo íntegro, y que los eventos de actividad **no** aparezcan como «ocupado».
3. **Deadline:** mirar el «Parcial de Redes» 08:15–08:30 en vista de día/semana y anotar **por escrito** si resulta natural o confuso (ver [semántica](#semántica-del-deadline-qué-observar)).
4. **Alarmas** (regenerar con `--alarms-in 50`): ver [VALARM](#valarm-por-separado).
5. **Publicar v2** y apuntar la **hora exacta**. Tomar nota de cuándo el cliente refleja (a) el cambio de título, (b) el cambio de hora, (c) la baja y (d) el alta. Registrar la **duración aproximada** («12 min», «1 h 20 min»), nunca «rápido». Si al terminar la sesión no se ha reflejado: escribir «> 2 h+ y aún no actualizado»; no esperar indefinidamente.
6. **Duplicados e identidad:** tras v2, comprobar que ningún evento modificado aparece dos veces y que los idénticos no cambiaron. Comparar los cambios **con y sin** `SEQUENCE`.
7. **Refresco manual:** anotar si el cliente permite forzarlo y cómo.
8. **Pistas:** comparar la suscripción con pistas (`PT10M`) y la `-nohints`: ¿alguna se actualiza en ~10 minutos? Con `serve.mjs`, el registro lo dice sin ambigüedad.

### VALARM por separado

Probar la alarma **relativa** y la **absoluta** por separado, y cada una en cada condición que exista en ese cliente: notificaciones del calendario suscrito **activadas** y **desactivadas**, y **escritorio** y **móvil**. Registrar para cada celda `suena`/`no suena` y el dispositivo exacto. **No generalizar** («Google soporta/no soporta») a partir de un solo dispositivo: escribir «Google web + Pixel X: no sonó con notificaciones activadas», no «Google no soporta».

### Semántica del deadline: qué observar

El «Parcial de Redes» con `dueAt` 08:30 se representa como un bloque 08:15–08:30 (el deadline **termina** en `dueAt`). No se cambia el modelo en este spike: solo se registra la sensación. Preguntas para quien mira el calendario: ¿se entiende que el parcial es a las 8:30? ¿parece que empieza a las 8:15? ¿habría preferido ver un bloque que **empieza** a las 8:30? Se compara con la «Entrega Proyecto» 23:44–23:59 (que sí es un deadline).

## Validación independiente

```bash
npm install --prefix <carpeta temporal fuera del repositorio> ical.js   # NO es una dependencia del proyecto
node docs/spikes/a4-calendar-feed/validate.mjs --lib <esa carpeta> docs/spikes/a4-calendar-feed/spike-v1.ics docs/spikes/a4-calendar-feed/spike-v2.ics
```

Lo que hace: parsea con `ical.js` (independiente del generador) y lee los eventos de vuelta; y exige CRLF, líneas ≤ 75 octetos, UTF-8 válido, `BEGIN/END` balanceados, `UID` y `DTSTAMP` únicos/presentes, `DTEND` posterior a `DTSTART`. **No es un validador RFC completo**: es un parser independiente más reglas estructurales propias. El resultado (y sus controles negativos) está en [results.md](results.md). Pendiente, manual: pasar los archivos por un validador RFC de terceros y anotar errores y avisos. **No se corrige una incompatibilidad solo porque un cliente la tolere.**

## Microprueba con estudiantes (preparada; sin estudiantes disponibles en esta sesión)

No es investigación científica: una comprobación pequeña de producto con al menos 3 estudiantes. Mostrar los dos ejemplos y anotar las respuestas en [results.md](results.md#microprueba-con-estudiantes).

**Ejemplo Feed A** (entregas, parciales y actividades):

| Fecha                  | Evento                            |
| ---------------------- | --------------------------------- |
| mié 21-oct 8:30        | Parcial de Redes                  |
| jue 22-oct (día)       | Taller de Bioestadística          |
| vie 23-oct 11:59 p. m. | Entrega Proyecto (Bases de Datos) |

**Ejemplo Feed B** (lo anterior **más las clases**): además, lunes 8:00–10:00 «Redes de Computadores» cada semana del semestre (≈ 100 eventos más en el calendario).

Preguntas:

1. «¿Cuál preferirías tener en el calendario del celular?» **A** / **B** / **depende / configurable**.
2. «¿Ya tienes tus clases en otro calendario?» Sí / No (¿cuál?).
3. «Cuando marcas una actividad como completada, ¿preferirías que: **A.** desaparezca del calendario; **B.** permanezca visible como historial?» (Decide si el feed omite las completadas.)
4. «El enlace se muestra una sola vez. Si quieres usarlo después en otro dispositivo, tendrías que regenerarlo y las suscripciones anteriores dejarían de actualizar. ¿Te parece aceptable?» **Sí** / **No**. Si varios estudiantes dicen **No**, hay que proponer una alternativa para A4-2 (por ejemplo, guardar el token cifrado para poder mostrarlo de nuevo, o un enlace por dispositivo); **no se implementa en este spike**.
5. (Opcional) «¿Usas el calendario del celular para organizar tus cosas de la universidad hoy? ¿Qué usas?»

## DTSTAMP, LAST-MODIFIED y SEQUENCE (RFC 5545)

Investigación documental, previa a A4-1; **no se implementa nada**. Lo siguiente es lo que dice el RFC según el conocimiento del autor del spike (a verificar contra el texto del RFC antes de implementar):

- **`DTSTAMP`** (RFC 5545 §3.8.7.2): obligatorio en cada `VEVENT`, en UTC. Su significado **depende de `METHOD`**: si el objeto especifica `METHOD`, es la fecha de **creación de esa instancia del objeto iCalendar**; si **no** especifica `METHOD`, es la fecha en que la información del componente **se revisó por última vez** en el almacén de calendarios.
- **`LAST-MODIFIED`** (§3.8.7.3): opcional; la fecha de la última revisión del componente en el almacén (análogo a la fecha de modificación de un archivo).
- **`SEQUENCE`** (§3.8.7.4): número de revisión; se incrementa ante cambios «significativos» (nacido en iTIP, RFC 5546, para ordenar actualizaciones de invitaciones; `DTSTAMP` desempata). En un feed de solo lectura que el cliente reemplaza entero es probable que no importe, pero **eso es lo que el spike debe medir**.
- **`REFRESH-INTERVAL`** (RFC 7986 §5.7): intervalo mínimo sugerido entre consultas; **`X-PUBLISHED-TTL`** es una extensión informal (Microsoft/Apple). Que un cliente las respete es justo lo que se prueba.

**Implicación para A4:** no asumir `DTSTAMP == LAST-MODIFIED` por costumbre. Con `METHOD:PUBLISH`, el RFC pediría que `DTSTAMP` fuera la hora de **generación** del feed, que cambia en cada consulta y haría que todo parezca modificado y que la salida deje de ser determinista. Sin `METHOD` (y sin el parámetro `method` en el `Content-Type`, coherente con `text/calendar; charset=utf-8`), `DTSTAMP` es la última revisión y puede ser igual a `LAST-MODIFIED` **sin violar el RFC**. Los timestamps reales que existen: `Activity.updatedAt`, `ScheduleBlock.updatedAt` y `Subject.updatedAt` (el nombre de la asignatura va en el título); no hay marcas por campo. Decisión **provisional** para A4-1 (sujeta a los resultados): sin `METHOD`; `LAST-MODIFIED` = máximo de los `updatedAt` implicados; `DTSTAMP` = el mismo valor; nunca la hora actual. Si algún cliente exige `METHOD` o ignora las actualizaciones sin `SEQUENCE`, se revisa.

## Puertas de decisión de A4-1

A4-1 **no empieza** hasta responder estas nueve preguntas. Estado actual (todas abiertas: faltan los resultados de los clientes y la microprueba):

| #   | Pregunta                                                       | Recomendación provisional (de diseño, no de evidencia)                         | Qué evidencia la cierra                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | ¿El deadline termina en `dueAt` o se representa de otra forma? | Bloque corto que **termina** en `dueAt`                                        | Observación visual de las filas 1–2 en los tres clientes           |
| 2   | ¿Cómo se tratan `EXAM`/`QUIZ`/`PRESENTATION`?                  | Igual que el resto por ahora; **candidato**: inicio en `dueAt` para esos tipos | ¿Se siente incorrecto 08:15–08:30? + respuesta de estudiantes      |
| 3   | ¿El feed incluye `CLASS` por defecto?                          | Sí, con opción de excluirlas si hay duplicación                                | Microprueba (preguntas 1 y 2)                                      |
| 4   | ¿Las actividades completadas desaparecen?                      | Sí (omitirlas)                                                                 | Microprueba (pregunta 3) + latencia de baja medida                 |
| 5   | ¿`VALARM` entra o no?                                          | No por ahora                                                                   | Resultados de alarmas relativa y absoluta por cliente/dispositivo  |
| 6   | ¿Hace falta `SEQUENCE`?                                        | No                                                                             | Eventos de v2 con y sin `SEQUENCE`                                 |
| 7   | ¿`REFRESH-INTERVAL` aporta algo?                               | Solo emitirlo si algún cliente lo respeta                                      | Suscripción con pistas frente a `-nohints` (registro del servidor) |
| 8   | ¿Un token por usuario es aceptable?                            | Sí, mientras la microprueba (pregunta 4) no diga lo contrario                  | Microprueba (pregunta 4)                                           |
| 9   | ¿Cómo se generan `DTSTAMP` y `LAST-MODIFIED`?                  | Sin `METHOD`; ambos desde `updatedAt`, nunca la hora actual                    | Investigación RFC (arriba) + que ningún cliente falle sin `METHOD` |

## Cambios respecto a la recomendación inicial de A4

- **A4-2 empieza sin `lastFetchedAt`**: no se añade la escritura de seguimiento salvo que este spike demuestre una necesidad concreta. Un feed consultado cada pocos minutos por muchos clientes no debería escribir en la base de datos en cada petición.
- `DTSTAMP`/`LAST-MODIFIED`: ya no se da por hecho que sean iguales; ver arriba.

## Qué no es

No es A2 (importar `.ics`), ni A3 (suscribirse a una URL externa), ni hay SSRF, planificador, credenciales de LMS, OAuth ni notificaciones push. El servidor del spike no forma parte de Academic Planner y no se despliega.
