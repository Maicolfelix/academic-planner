# Importador de calendarios `.ics` (A2)

**Estado: DONE (PR #56 fusionado).** QA real funcional en dispositivo aprobada por el mantenedor (entorno local/de desarrollo por red local, HTTP; **no** es QA de release ni valida HTTPS, la PWA instalada, producción, a estudiantes ni compatibilidad con cualquier `.ics`). Solo se soporta el subconjunto descrito abajo.

Un archivo `.ics` (Google Calendar, Outlook, calendarios de universidad u otros) se convierte en **propuestas** que el estudiante revisa y confirma **una sola vez**. Flujo: CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR. **Subir un `.ics` no crea nada.**

## Qué hace

- `POST /api/ics-import/parse` (`multipart/form-data`, campo `file`, en memoria): lee el archivo y devuelve propuestas. **No guarda el archivo ni su texto**, no crea datos.
- `POST /api/ics-import/confirm` (JSON): crea, **todo o nada** y en una transacción con bloqueo por usuario, lo que el estudiante dejó marcado. Reutiliza `ActivityService` y `ScheduleService` (mismas reglas que el formulario manual).
- Pantalla `/calendar/import-ics`, con la entrada «Importar calendario (.ics)» en la Agenda (junto a «Importar horario»). Muestra el nombre del archivo y los eventos entendidos, **nunca el `.ics` en bruto**. Por evento: casilla, tipo (Actividad / Clase-horario / No importar), título, asignatura, hora de fin (clases), qué hacer con fechas excluidas, y «Quitar».

## Subconjunto soportado (exacto)

No se afirma compatibilidad con «cualquier `.ics`». Se soporta:

| Evento del archivo                                                                                       | Propuesta                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VEVENT` único con hora                                                                                  | **Actividad** con fecha y hora (tipo inferido del título; el estudiante lo corrige)                                                                     |
| `VEVENT` único de **día completo** (`VALUE=DATE`)                                                        | **Actividad** con esa fecha y **sin hora** (la fecha nunca se desplaza por UTC)                                                                         |
| `RRULE:FREQ=WEEKLY` con `INTERVAL=1`, `BYDAY` (uno o varios días) y `UNTIL` o `COUNT` (≤ 260) opcionales | **Clases semanales** (`ScheduleBlock`); con varios días se expande un bloque por día; sin `UNTIL`/`COUNT` se repite hasta el fin del periodo y se avisa |
| Cualquier otra cosa                                                                                      | **No soportado**: se explica el motivo y no se puede marcar                                                                                             |

No soportado (con motivo visible): fecha de inicio inválida, evento cancelado (`STATUS:CANCELLED`), `RECURRENCE-ID` (instancia modificada), `RDATE`, frecuencias distintas de semanal (diaria, mensual, anual), `INTERVAL` distinto de 1, otras partes de la regla (`BYMONTH`, `BYSETPOS`, `BYMONTHDAY`…), `BYDAY` con ordinal («1MO»), `COUNT` > 260, eventos de día completo que se repiten, y bloques que cruzan la medianoche.

**Zona horaria:** `TZID` (con su `VTIMEZONE` si lo trae, o IANA), UTC (`Z`) y «flotante» (se interpreta en la zona del usuario). El motor trabaja en hora local del estudiante.

**Sin `DTEND`:** no se inventa. Una actividad no la necesita; una **clase** sin hora de fin queda «Por revisar» y el estudiante la escribe.

**Fechas excluidas (`EXDATE`):** Academic Planner no guarda excepciones. Nunca se ignoran en silencio: el estudiante elige _importar toda la serie_, _importar solo la primera clase_ (sin repetición) o _no importar_.

**Duplicados:** el mismo `UID` repetido dentro del archivo y una copia de lo que ya está en la Agenda se marcan y quedan **desmarcados**; el estudiante decide. No hay columna nueva en la base de datos.

**Límites:** 1 MB, 500 eventos, archivo vacío / sin `BEGIN:VCALENDAR` / binario / con NUL o caracteres de control se **rechazan** (nunca se sanean en silencio).

**Todo lo marcado o nada:** si alguna fila marcada (y no «No importar») sigue sin resolver (falta asignatura de una clase, hora de fin, título o decidir las fechas excluidas), el botón queda deshabilitado como «Resolver antes de importar» y **no se envía nada**; la revisión nunca descarta en silencio la fila inconclusa para importar el resto. Las filas desmarcadas, en «No importar» o con `EXDATE` → «No importar este evento» no bloquean.

**Asignatura de una actividad:** es opcional, pero «todavía no elegí» y «sin asignatura» son respuestas distintas. Si el nombre es ambiguo entre estudios, la actividad pide elegir (bloquea) hasta que el estudiante escoja una candidata o **«Importar sin asignatura»** (`subjectId` nulo). Una clase siempre necesita asignatura y no ofrece esa opción.

## Asignaturas y varios estudios

El emparejamiento es determinista (el mismo de la Captura rápida). Ve las asignaturas de **todos los periodos actuales y activos** del estudiante. Si el nombre coincide con asignaturas de varios estudios («Ciberseguridad» en Ingeniería y en un Diplomado) la propuesta queda **por revisar** y el selector ofrece **solo esas** opciones, con el nombre del estudio. Una asignatura desconocida **nunca se sustituye ni se crea**: la actividad queda sin asignatura (F1) y la clase pide elegir una. Cada elemento pertenece al periodo **de su asignatura**; nunca se asume HOME. El cliente envía `subjectId`; **el servidor verifica** que sea del usuario y de un periodo actual y deriva el periodo (misma respuesta 404 que cualquier recurso ajeno).

## Dependencia

`ical.js@2.2.1` (MPL-2.0), solo en `apps/api`: analizador mantenido de RFC 5545 (plegado de líneas, escapes, `VTIMEZONE`, `RRULE`). Las reglas de clasificación son funciones puras en `packages/core/src/icsImport.ts`. `npm audit` y `npm audit --omit=dev`: 0 vulnerabilidades.

## Pruebas

Núcleo (`icsImport.test.ts`), adaptador del analizador (`apps/api/src/ics/parseIcs.test.ts`), API (`apps/api/src/ics/icsImport.test.ts` + matrices de seguridad), web (`apps/web/src/icsImport/icsImport.test.tsx`) y `e2e/ics-import.spec.ts` (clase semanal de los martes 7:00–9:00, parcial con hora, entrega de día completo, una sola confirmación, aparición en la Agenda, ambigüedad entre dos estudios, 360/768/1366 px y axe).
