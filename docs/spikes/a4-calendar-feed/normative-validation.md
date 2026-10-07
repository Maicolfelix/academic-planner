# A4-0b: validación normativa y decisión «feed» vs «Añadir al calendario»

> **Estado: investigación y decisión de diseño. No es código de producto y no implementa A4.** No toca Prisma, API, web, `packages/core` de producto, dependencias, versión ni tags. Lo que dice cada **RFC** se verificó contra el texto del RFC (rfc-editor.org: RFC 5545, RFC 7986 y RFC 5546); lo que dicen los **proveedores** (Google, Apple, Microsoft) **no** se verificó en clientes reales y se marca como tal. Fixtures, herramientas y protocolo: [README.md](README.md); resultados: [results.md](results.md).

## 1. Fuentes normativas usadas

| Fuente                                                                                    | Para qué                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| RFC 5545 (iCalendar), §3.1, §3.3.11, §3.6.6, §3.7.2, §3.8.2.2/.4/.7, §3.8.4.7, §3.8.7.2–4 | Formato de líneas, texto, alarmas, `METHOD`, fechas, `TRANSP`, `UID`, `DTSTAMP`, `SEQUENCE`         |
| RFC 7986 (nuevas propiedades), §5.3 (`UID`) y §5.7 (`REFRESH-INTERVAL`)                   | Forma recomendada del `UID` y significado exacto de `REFRESH-INTERVAL`                              |
| RFC 5546 (iTIP), §3.2.1 (`PUBLISH` de un `VEVENT`)                                        | Qué exige `METHOD:PUBLISH` (decide si el feed lo emite)                                             |
| Documentación de proveedores y fuentes secundarias sobre refresco                         | Solo contexto. **No verificado en clientes reales**; no sustenta ninguna decisión de este documento |

## 2. Propiedad por propiedad

«Decisión A4» es la decisión de diseño provisional del roadmap; la última columna dice si el RFC la **confirma**, la **cambia** o no la decide.

| Propiedad            | Qué dice el estándar                                                                                                                                                                                                                                                           | Obligatoria / opcional                             | Efecto sobre la decisión provisional de A4                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DTSTAMP`            | §3.8.7.2: en UTC. Sin `METHOD` es la fecha en que la información del componente se revisó por última vez y el RFC lo declara **equivalente a `LAST-MODIFIED`**; con `METHOD` es la creación de esa instancia del objeto (cambiaría en cada consulta)                           | **MUST** en cada `VEVENT`                          | **Confirma**: sin `METHOD`, `DTSTAMP` = `LAST-MODIFIED` = máximo de los `updatedAt` implicados es válido y determinista                                                                                                   |
| `LAST-MODIFIED`      | §3.8.7.3: UTC, fecha de la última revisión en el almacén                                                                                                                                                                                                                       | Opcional (y redundante con `DTSTAMP` sin `METHOD`) | **Confirma** que puede emitirse con el mismo valor; no hay obligación. Se deja por si un cliente usa una y no la otra (no verificado), costo: una línea                                                                   |
| `METHOD`             | §3.7.2: opcional en el objeto. RFC 5546 §3.2.1: un `VEVENT` con `METHOD:PUBLISH` **debe** llevar `ORGANIZER`. Sin `METHOD` el objeto es una descripción de calendario, sin semántica de planificación (invitaciones, respuestas)                                               | Opcional                                           | **Confirma «no emitir `METHOD`»**: `PUBLISH` obligaría a inventar un `ORGANIZER` (dato personal) y a cambiar el significado de `DTSTAMP`. Tolerancia de los clientes a su ausencia: ver §9                                |
| `SEQUENCE`           | §3.8.7.4: número de revisión que incrementa el **organizador** ante cambios «significativos»; nace del flujo de invitaciones (iTIP ordena por `SEQUENCE` y desempata por `DTSTAMP`). Sin `ORGANIZER`/`ATTENDEE` el estándar no lo exige                                        | Opcional (0 si falta)                              | **No decide**: el RFC no obliga y no dice cómo reaccionan los clientes en suscripción. Decisión provisional: omitir. Solo lo cierra una prueba con clientes reales                                                        |
| `DTSTART`            | §3.8.2.4: obligatoria en un `VEVENT` sin `METHOD`                                                                                                                                                                                                                              | **MUST** (sin `METHOD`)                            | **Confirma**: todos los eventos tienen inicio                                                                                                                                                                             |
| `DTEND`              | §3.8.2.2: **debe ser posterior** a `DTSTART`; con `VALUE=DATE` es **no inclusivo** (un evento de un día termina al día siguiente)                                                                                                                                              | Opcional (alternativa: `DURATION`)                 | **Confirma** el bloque de 15 min que termina en `dueAt` (válido) y el día completo `DTEND` = día siguiente. Si faltara `DTEND`, el evento tendría duración cero: sin evidencia de cómo lo pintan los clientes → no usarlo |
| `VALUE=DATE`         | §3.3.4/§3.8.2.4: fecha sin hora, sin zona; es el tipo correcto para «sin hora» (la semántica de la app: vence al final del día local)                                                                                                                                          | n/a                                                | **Confirma**: actividad sin hora = día completo con `DATE`, sin inventar hora                                                                                                                                             |
| `TRANSP`             | §3.8.2.7: `OPAQUE` (por defecto) bloquea el tiempo en disponibilidad; `TRANSPARENT` no                                                                                                                                                                                         | Opcional                                           | **Confirma**: actividades `TRANSPARENT` (no «ocupan» al estudiante); clases con el valor por defecto                                                                                                                      |
| `UID`                | §3.8.4.7: único y **persistente** para el mismo evento. RFC 7986 §5.3: debe ser un valor **opaco** (se recomienda UUID), **sin** dominio, nombre de host ni datos del usuario                                                                                                  | **MUST**                                           | **Cambia** el fixture: el spike usaba `…@academic-planner` (dominio); ahora los UID son opacos. Para A4-1: `activity-<uuid>` y `class-<uuid del bloque>-<aaaammdd>`                                                       |
| Plegado a 75 octetos | §3.1: **SHOULD**: las líneas no pasan de 75 octetos (sin contar el CRLF); se pliega con CRLF + espacio y **no** debe partir una secuencia UTF-8 multibyte                                                                                                                      | SHOULD                                             | **Confirma** la regla (octetos, no caracteres; entre caracteres). Contrato ejecutable en `serializer-cases.mjs`                                                                                                           |
| Escape de `TEXT`     | §3.3.11: `\\`, `\;`, `\,` y `\n`; `:` y `"` **no** se escapan; los caracteres de control (salvo TAB) no son válidos                                                                                                                                                            | MUST (formato)                                     | **Confirma** y añade una regla del contrato: CR/LF → `\n`, caracteres de control eliminados (evita inyección de componentes)                                                                                              |
| `VALARM`             | §3.6.6: `ACTION` y `TRIGGER` obligatorios; `DISPLAY` exige `DESCRIPTION`; un `TRIGGER` absoluto debe estar en UTC. El estándar **no** garantiza que un cliente muestre alarmas de un calendario suscrito                                                                       | Opcional                                           | **No decide**. Sigue provisional «no incluir»: los recordatorios son de la app (`Reminder`), no habría una sola fuente de verdad y duplicaría avisos. Sin evidencia de clientes                                           |
| `REFRESH-INTERVAL`   | RFC 7986 §5.7: sugiere el intervalo **mínimo** entre consultas de un cliente. **No** sirve para pedir refresco más rápido; por riesgo de abuso el RFC pide a los clientes que **avisen al usuario y le dejen alargarlo** si es menor que ~1 día (consideraciones de seguridad) | Opcional (estándar, de 2016)                       | **Cambia** la lectura del spike: los `PT10M` de las variantes «con pistas» **no pueden acelerar nada**. Un valor útil como pista sería ≥ 1 día, es decir, **más lento**. No hay motivo para emitirlo en el MVP            |
| `X-PUBLISHED-TTL`    | **No es estándar** (prefijo `X-`). Extensión informal de algunos clientes de Microsoft/Apple; ningún RFC la define                                                                                                                                                             | No estándar                                        | **Cambia**: se **quita del MVP**. Sin evidencia de que ningún cliente la respete, no se justifica una línea no estándar en un feed. Solo queda en las variantes del spike para medirla                                    |

## 3. `METHOD`, `DTSTAMP` y `LAST-MODIFIED` con los `updatedAt` existentes

- **`METHOD` ausente** (y `Content-Type: text/calendar; charset=utf-8` sin parámetro `method`, coherente con eso).
- **`DTSTAMP` = `LAST-MODIFIED` = `max(updatedAt)` de los registros que forman el evento.** El RFC los declara equivalentes sin `METHOD`, así que no se viola nada.
  - Actividad: `max(Activity.updatedAt, Subject.updatedAt)` (el nombre de la asignatura va en el título).
  - Clase: `max(ScheduleBlock.updatedAt, Subject.updatedAt)`.
  - Nunca la hora actual: la salida **sigue siendo determinista** (misma base de datos ⇒ mismos bytes ⇒ `ETag` estable, `304` posible) y un evento sin cambios no parece modificado.
- Límite conocido: no hay marcas por campo; un cambio en la asignatura marca como modificados todos sus eventos. Es inofensivo (el evento se vuelve a leer, nada más).
- Truncar a segundos al serializar (`updatedAt` tiene milisegundos; `DATE-TIME` de iCalendar no). `dueAt` sin hora = `23:59:59.999` local: al formatear a UTC se trunca a `23:59:59`; para un deadline con bloque de 15 min, `DTEND` = `dueAt` truncado.

## 4. Pistas de refresco: estándar vs extensión

| Pista                           | Naturaleza                                                              | Veredicto para el MVP                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `REFRESH-INTERVAL` (RFC 7986)   | **Estándar**, pero define un **mínimo**; no acelera                     | **No emitir.** Un valor «largo» ralentiza sin ganancia; uno corto lo ignoran por diseño                                                   |
| `X-PUBLISHED-TTL`               | **Extensión no estándar**                                               | **No emitir.** Sin justificación                                                                                                          |
| `ETag` / `Last-Modified` (HTTP) | No es iCalendar; solo ayuda al cliente que hace consultas condicionales | Sin evidencia de que algún cliente las use: **no se decide aquí** (el `ETag` estable es posible porque la salida es determinista; ver §3) |

Contexto de proveedores (**no verificado en clientes reales; solo documentación o fuentes secundarias**): Outlook.com declara una frecuencia del orden de unas 3 horas y reconoce que puede superar las 24 h; Google se cita (fuentes secundarias) con un refresco del orden de hasta ~12 h y **sin refresco manual**; Apple permite elegir la frecuencia de «actualización automática» por calendario suscrito. Conclusión práctica: el estudiante **no controla ni la app controla** cuándo se verá un cambio en un feed. Esa dependencia es el argumento central de la comparación de §7.

## 5. Segunda validación independiente

| Herramienta                                                               | Archivos                                    | Resultado                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **iCalendar Validator v1.22** (icalendar.org, Z Content), contra RFC 5545 | `spike-v1.ics`                              | 96 líneas, 9 eventos: **sin errores**                                                                                   |
|                                                                           | `spike-v2.ics`                              | 98 líneas, 9 eventos: **sin errores**                                                                                   |
|                                                                           | `spike-robustness.ics`                      | 144 líneas, 16 eventos: **sin errores**                                                                                 |
|                                                                           | control negativo (archivo roto a propósito) | **4 errores** detectados (fin de línea LF, `BEGIN`/`END` desbalanceados, falta `DTSTAMP`, `DTEND` anterior a `DTSTART`) |

- 2026-10-07; datos **sintéticos** subidos a un servicio de terceros; ningún dato real.
- La copia de `spike-robustness.ics` enviada se verificó **byte a byte** (SHA-256 igual al archivo del repositorio); el validador informa 4209 bytes frente a 4211 en disco (diferencia de 2 bytes en su recuento, no investigada; no afecta al resultado). Un primer envío con una copia tecleada a mano **se descartó** por no ser idéntica al archivo.
- Primera validación (local): `validate.mjs` con **ical.js 2.2.1** (instalado fuera del repositorio, no es dependencia): sin errores ni avisos en los cinco archivos; controles negativos (incluidos dos serializadores ingenuos: escape sin CR/control y plegado por bytes) fallan como se espera (13 y 14 errores).
- **No sustituye a un cliente real.** Que un validador acepte un archivo no dice cómo lo muestra Google, Apple u Outlook.

## 6. Unicode, plegado e inyección: el contrato del serializador

Fixture `spike-robustness.ics` (16 casos sintéticos) y reglas en [serializer-cases.mjs](serializer-cases.mjs). Todas se leen de vuelta **exactamente** con un parser independiente y ningún caso inyecta componentes ni propiedades.

| Caso                                   | Qué demuestra                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specials`, `colon-quotes`             | `,` `;` `\` se escapan; `:` y `"` **no**                                                                                                                    |
| `escape-lookalikes`                    | Un título que contiene `\n` literal o `\,` se escapa de nuevo: no se convierte en salto de línea                                                            |
| `newline-lf`, `lone-cr`                | LF y CR sueltos se vuelven `\n`; nunca un CR crudo                                                                                                          |
| `crlf-injection`, `property-injection` | Un título con CRLF **no** puede terminar la línea ni abrir `BEGIN:VEVENT`, `ATTENDEE`, `DESCRIPTION`                                                        |
| `control-chars`, `tab`                 | Caracteres de control eliminados; TAB se conserva                                                                                                           |
| `accents`, `cjk`, `rtl-mixed`          | UTF-8 multibyte y texto de derecha a izquierda íntegros                                                                                                     |
| `emoji-boundary`                       | Un emoji de 4 octetos justo en el límite de 75: el pliegue lo deja entero                                                                                   |
| `combining-marks`                      | El RFC permite plegar entre letra base y marca combinante; el fixture lo hace y se lee de vuelta bien. **Preferible no partirlo**, pero **no** es requisito |
| `very-long`                            | Muchos pliegues, varios justo tras un espacio: ninguna línea física termina en espacio                                                                      |
| `lone-surrogate`                       | Un sustituto UTF-16 suelto se reemplaza por U+FFFD (si no, los bytes y el recuento discrepan)                                                               |

Hallazgos: (1) la primera versión del generador dejaba pasar un CR crudo: **es el tipo de fallo que el contrato existe para evitar**; (2) plegar por caracteres en vez de octetos o por bytes sin mirar UTF-8 produce líneas > 75 octetos o UTF-8 inválido (los dos controles ingenuos lo demuestran); (3) los títulos vienen del estudiante y de la importación: **son entrada no confiable**.

## 7. Opción A (feed por URL) vs Opción B («Añadir al calendario»)

Opción A: el estudiante suscribe su calendario a una URL con un token secreto. Opción B: un botón genera un archivo `.ics` (con las actividades pendientes y, si las elige, las clases) y el calendario lo importa; **sin URL pública, sin token**.

| Criterio                       | A. Feed por URL con token                                                                                                                                                                            | B. Descargar `.ics` («Añadir al calendario»)                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Esfuerzo                       | Tabla/columna de token (migración), endpoint público sin sesión, limitador de frecuencia, `ETag`/`304`, rotación y revocación, UI de enlace, pruebas de seguridad y e2e                              | Un serializador (el mismo contrato) y un endpoint **autenticado** GET con la sesión; un botón. Una fracción del trabajo                                  |
| Seguridad                      | Un secreto en la URL (aparece en historiales, registros de proxies, cabeceras); ruta fuera de la sesión: nuevo punto de ataque (enumeración, fuerza bruta) y nueva fila en las matrices de seguridad | Mismo modelo de sesión y `originCheck` que el resto; no hay credencial de larga vida                                                                     |
| Privacidad                     | Google/Microsoft consultan la URL **desde la nube, de forma continua**; el estudiante no ve cuándo ni quién tiene el enlace                                                                          | El archivo va al dispositivo del estudiante, una vez; luego es del calendario del estudiante                                                             |
| UX                             | Se configura una vez y se actualiza solo… cuando el cliente decide consultar (horas); sin refresco manual en algunos; perder el enlace obliga a regenerarlo                                          | Un clic, resultado inmediato, pero **instantánea**: no se actualiza; repetir la importación puede duplicar o reemplazar según el cliente (no verificado) |
| Valor                          | Alto si el calendario externo es el centro de la vida del estudiante                                                                                                                                 | Moderado, pero cubre el caso básico («quiero esto en mi calendario») sin pedirle gestionar nada                                                          |
| Dependencia del refresco       | **Total** y fuera de control de la app y del estudiante                                                                                                                                              | **Ninguna**                                                                                                                                              |
| Móvil                          | Suscribir por URL en iOS/Android es un trámite de ajustes (no verificado en dispositivos)                                                                                                            | Abrir el archivo ofrece añadirlo (no verificado en dispositivos)                                                                                         |
| Paradigma CAPTURAR→…→CONFIRMAR | El estudiante «configura una integración»: es trabajo adicional                                                                                                                                      | El estudiante **elige y confirma** qué exporta; más cercano a «organizarse no debe ser otra tarea»                                                       |

## 8. Estrategia híbrida

1. **MVP: «Añadir al calendario»** (B). Reutiliza íntegramente el contrato del serializador; `UID` estables hacen que reimportar sea reemplazo y no duplicado donde el cliente lo respete (**no verificado**).
2. **Opcional, después, con evidencia**: el feed (A) añade un token y un endpoint **sobre el mismo serializador**; no se pierde trabajo.
3. **Condición para pasar de B a A**: estudiantes reales que pidan «que se actualice solo» **y** una prueba de clientes reales que muestre un refresco aceptable. Ninguna de las dos existe hoy.

Hoy **no hay evidencia** (ni de clientes ni de estudiantes) que justifique A sobre B.

## 9. Actividades completadas

| Opción                     | En el feed (A)                                                                                                        | En «Añadir al calendario» (B)                                                     | Sorpresa                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Omitir** las completadas | El evento desaparece en la siguiente consulta del cliente (horas después: queda «pendiente» en el calendario un rato) | No se ofrecen; la instantánea ya exportada **no** se corrige al completarla       | El calendario = «lo que falta»; coincide con el Radar. Una vez exportada, queda desfasada (inevitable) |
| **Conservar** (historial)  | Hay que marcar el estado dentro del evento (p. ej. un prefijo en el título): el estado se vuelve texto del título     | Igual; además el estudiante vería entregas ya hechas mezcladas con las pendientes | El calendario crece con lo ya hecho; la app ya muestra el progreso, que es descriptivo y suyo          |

Recomendación **provisional**: **omitir** (el calendario es una agenda, no un historial; coherente con «derivado, no guardado»). Marcar una actividad como completada actualiza su `updatedAt`, así que el feed lo reflejaría; en B la desviación es inherente a una instantánea. **Sin evidencia de estudiantes** (microprueba, pregunta 3, 0 respuestas): estado `NEEDS USER TEST`.

## 10. Deuda del modelo de tiempo: `Activity.dueAt`

`Activity.dueAt` mezcla dos significados: **fecha límite** (una entrega, «antes de») y **hora del evento** (un parcial a las 8:30, «a partir de»). La app lo trata siempre como fecha límite (reglas de Radar, Atención y recordatorios). Un calendario necesita saber cuál es para pintar el bloque. Se **mantiene como deuda** y A4 no la resuelve.

| Opción                                                                   | Representación en `.ics`                                              | Impacto                                                                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Todo es deadline                                                  | Bloque corto que **termina** en `dueAt`, `TRANSPARENT`                | Sin cambios en el modelo. Un parcial de las 8:30 se ve 8:15–8:30 (confuso: parece empezar a las 8:15). **No inventa duración**                  |
| **B.** Regla por tipo (`EXAM`/`QUIZ`/`PRESENTATION` empiezan en `dueAt`) | Bloque que **empieza** en `dueAt` para esos tipos                     | Sin migración, pero hay que inventar una duración (la app no tiene «duración estimada»; está fuera de alcance) o usar un bloque corto simbólico |
| **C.** Campos explícitos `eventAt` / `dueAt`                             | Evento real con inicio (y fin si se conoce) o deadline, según el dato | **Correcto**, pero migración, UI de captura y revisión de Radar/Atención/recordatorios; es producto nuevo, no A4                                |

Recomendación para el MVP: **A** (consistente, no inventa datos) con la deuda documentada; **C** es lo correcto cuando haya evidencia de que el estudiante necesita la distinción. La sensación visual (¿parece que el parcial empieza a las 8:15?) sigue `NEEDS USER TEST`.

## 11. Modelo de token (solo aplica si se hace el feed)

| Criterio  | Un token por usuario                                                                          | Varios tokens con nombre (por dispositivo/cliente)                             |
| --------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Esfuerzo  | Una columna hasheada (como las sesiones) y «regenerar»                                        | Tabla, UI de lista, nombres, revocación individual, límites                    |
| Seguridad | Una fuga obliga a rotar y se corta **todo**                                                   | Una fuga se revoca sin afectar al resto                                        |
| UX        | Se muestra una sola vez; perder el enlace = regenerar y volver a suscribir todos los clientes | Se puede revocar uno; más cosas que gestionar (tarea extra para el estudiante) |
| Evidencia | Microprueba pregunta 4: 0 respuestas                                                          | Ídem                                                                           |

Recomendación para el MVP **si hay feed**: **un token por usuario**, almacenado con hash (como las sesiones), mostrado una vez, «regenerar» revoca el anterior. Los tokens múltiples se añaden si los estudiantes lo piden. **Con la Opción B no hay token**: el problema desaparece.

## 12. Higiene del PR #20

| Revisión                                                           | Resultado                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Scripts reproducibles                                              | `generate.mjs` es determinista (SHA-256 igual al regenerar); `validate.mjs` exige `--lib` a una carpeta de `ical.js` fuera del repositorio |
| Dependencias nuevas / `package.json` / lockfile                    | **Ninguna**; `ical.js` no se añade al proyecto                                                                                             |
| URLs privadas, tokens, rutas locales (`C:\Users…`), correos reales | Ninguno (se comprobó con búsqueda en la carpeta del spike); los datos son sintéticos (`example.test` en un caso de prueba)                 |
| Código de producto tocado                                          | Ninguno (solo `docs/spikes/a4-calendar-feed/` y enlaces de documentación)                                                                  |
| Fin de línea de los `.ics`                                         | CRLF conservado (`*.ics -text whitespace=cr-at-eol`)                                                                                       |
| Servidor del spike                                                 | Solo `localhost`; no se expuso a Internet                                                                                                  |

## 13. Tabla de decisiones

`CONFIRMED` = confirmada contra el texto del RFC · `PROVISIONAL` = decisión de diseño razonable sin evidencia que la cierre · `NEEDS REAL CLIENT` = solo la cierra una prueba en Google/Apple/Outlook · `NEEDS USER TEST` = solo la cierran estudiantes.

| Decisión                                                              | Evidencia                                                                                  | Estado            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| No emitir `METHOD`                                                    | RFC 5545 §3.7.2; RFC 5546 §3.2.1 (`PUBLISH` exige `ORGANIZER`)                             | CONFIRMED         |
| `DTSTAMP` = máx. `updatedAt` (nunca la hora actual)                   | RFC 5545 §3.8.7.2 (equivale a `LAST-MODIFIED` sin `METHOD`)                                | CONFIRMED         |
| `LAST-MODIFIED` = igual a `DTSTAMP`                                   | RFC 5545 §3.8.7.3 (opcional); si algún cliente lo necesita, no verificado                  | PROVISIONAL       |
| `SEQUENCE` omitido                                                    | RFC 5545 §3.8.7.4 no lo exige; reacción de clientes sin medir                              | NEEDS REAL CLIENT |
| `VALARM` no incluido                                                  | RFC 5545 §3.6.6 lo permite; la app ya tiene `Reminder`; sin evidencia de clientes          | PROVISIONAL       |
| `REFRESH-INTERVAL` no emitido                                         | RFC 7986 §5.7: es un mínimo, no acelera                                                    | CONFIRMED         |
| `X-PUBLISHED-TTL` no emitido                                          | No estándar; sin evidencia de uso                                                          | CONFIRMED         |
| `UID` opaco y persistente (`activity-<uuid>`, `class-<uuid>-<fecha>`) | RFC 5545 §3.8.4.7; RFC 7986 §5.3                                                           | CONFIRMED         |
| `TEXT`, plegado a 75 octetos, anti-inyección                          | RFC 5545 §3.3.11 y §3.1; `serializer-cases.mjs` (16 casos) + dos validadores               | CONFIRMED         |
| Actividades completadas: omitir                                       | Análisis de §9; microprueba sin respuestas                                                 | NEEDS USER TEST   |
| Clases incluidas en el feed/archivo                                   | Microprueba (preguntas 1 y 2) sin respuestas                                               | NEEDS USER TEST   |
| Deadline = bloque de 15 min que termina en `dueAt`                    | RFC válido (§3.8.2.2); cómo lo pintan los clientes y si resulta natural, sin ver           | NEEDS USER TEST   |
| Un token por usuario                                                  | Análisis de §11; microprueba pregunta 4 sin respuestas (y sin sentido si no hay feed)      | NEEDS USER TEST   |
| Feed (A) frente a «Añadir al calendario» (B)                          | §7: B es más simple y no depende del refresco; nadie ha pedido la actualización automática | NEEDS USER TEST   |

## 14. Puerta de A4-1

`A4-1 solo puede diseñarse si (1) las decisiones del RFC están confirmadas, (2) el contrato del serializador está claro y (3) el feed sigue justificado frente a la alternativa más simple.`

1. **Decisiones del RFC: confirmadas** (METHOD, DTSTAMP, UID, texto, plegado, fechas, `REFRESH-INTERVAL`, `X-PUBLISHED-TTL`). Las que dependen de clientes reales (`SEQUENCE`, tolerancia a la ausencia de `METHOD`, `VALARM`) siguen abiertas, pero ya no bloquean el serializador.
2. **Contrato del serializador: claro y ejecutable** (`serializer-cases.mjs`, 16 casos, dos validadores, controles negativos).
3. **Feed frente a «Añadir al calendario»: sigue sin justificarse.** B cubre el caso básico con una fracción del esfuerzo, sin token, sin ruta pública y sin depender del refresco de terceros; no hay evidencia de clientes ni de estudiantes que muestre que A aporta algo que B no.

**Resultado: NO-GO para el feed (A4-1 tal como se diseñó).** Cambiar el alcance a «Añadir al calendario» (B) sobre el mismo serializador es una **propuesta** que necesita la aprobación del usuario; no se implementa.
