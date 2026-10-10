# Borradores persistentes

Lo que el estudiante escribe o decide y todavía no guardó **no se pierde**: sobrevive a cerrar un diálogo, cambiar de página, recargar y a que Safari en el teléfono mate o reconstruya la pestaña. Es una comodidad de **este navegador**, no una sincronización: nada va al servidor, nada se reenvía y un borrador **nunca crea nada por sí mismo**. No es una cola sin conexión (no hay _background sync_ ni reproducción de mutaciones).

## Qué se conserva

| Borrador                               | Clave (`scope`)                  | Contenido                                                                                                                                         |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Captura rápida / Bandeja               | `capture-quick`, `capture-inbox` | el texto; y, ya interpretado, las propuestas con lo decidido: marcas, respuestas compartidas, cambios individuales, asignaturas nuevas por crear  |
| Formulario de **crear** actividad      | `activity-create:<periodo>`      | título, asignatura (o «sin asignatura»), fecha, hora, tipo, prioridad, descripción y, si estaba abierto, el nombre tecleado en «Nueva asignatura» |
| Formulario de **editar** una actividad | `activity-edit:<actividad>`      | los mismos campos y el `updatedAt` de la actividad cuando empezó la edición                                                                       |

No se conserva lo transitorio (cargando, errores, foco, animaciones). Crear y editar son borradores **distintos**: el de crear es por usuario y periodo, el de editar por actividad.

Volver a la captura **no reinterpreta** el texto: muestra las mismas propuestas con las respuestas ya dadas («Retomé lo que tenías sin terminar»). Una asignatura nueva escrita en el creador inline o elegida en la revisión se guarda **solo como nombre**: no se crea hasta guardar la actividad o confirmar el lote.

## Cuándo se elimina

Solo cuando: la actividad se guarda; el lote se confirma (y solo lo creado: lo que el estudiante dejó sin marcar sigue en la revisión y en su borrador); el estudiante **descarta** explícitamente («Descartar borrador», «Descartar»); o caduca. **No** se elimina por navegar, cerrar el diálogo (Escape, fuera del cuadro, «Cancelar») ni recargar. Un formulario que sigue como se abrió (o sin nada escrito) no deja borrador. Como cerrar no pierde nada, estos formularios ya no preguntan «¿descartar cambios?».

Para que se vea que existe, la página de Actividades ofrece «Tienes una actividad sin terminar: «…» · Retomar · Descartar borrador».

## Dónde y cómo se guarda

`localStorage`, por decisión: los borradores son pequeños (un formulario, o hasta diez propuestas); es **síncrono** (se puede volcar desde `pagehide`, donde una escritura asíncrona puede no terminar) y sobrevive a la recarga. `sessionStorage` no sobrevive a que Safari reconstruya la pestaña; IndexedDB no aporta nada a este tamaño y es asíncrono justo donde duele. No hay API de borradores en el servidor.

Entrada: `academic-planner:draft:v1:<userId>:<scope>` → `{ version, updatedAt, payload }`.

- **Aislado por usuario:** la clave lleva el id; la cuenta B nunca ve el borrador de la A en el mismo navegador (y la A lo recupera al volver). **No** se guarda correo, token, CSRF ni nada de la sesión.
- **Caducidad (TTL) de 7 días** desde la última escritura: al leer, un borrador caducado se borra; al entrar a la aplicación se barren los caducados del usuario.
- **Versión y forma:** `version` del formato y, en la captura, la versión del motor (`CAPTURE_ENGINE_VERSION`). JSON corrupto, versión distinta o una forma que ya no valida (Zod) se **descarta**, no se repara; la aplicación sigue funcionando.
- **Almacenamiento bloqueado o lleno** (ventana privada, cuota): la aplicación funciona sin borradores; ninguna lectura ni escritura lanza error.
- **Varias pestañas:** gana la última escritura (cada escritura reemplaza la entrada completa: no se corrompe); los avisos de «tienes algo sin terminar» se actualizan con el evento `storage`. Sin colaboración en tiempo real.
- Se escribe **un instante después del último cambio** (no por tecla) y de inmediato al ocultar la página o desmontar el componente.

### Conflicto al editar

Si la actividad cambió en el servidor desde que se empezó el borrador (su `updatedAt` ya no es el guardado), el borrador **no se aplica en silencio**: el formulario pregunta «¿Qué versión quieres?» (**Usar mi borrador** / **Usar la versión actual**). Si no cambió, se restaura sin preguntar.

### Privacidad

El borrador de captura incluye el texto que el estudiante pegó (por ejemplo un mensaje de un profesor). Queda en el navegador de ese dispositivo hasta guardarse, descartarse o caducar a los 7 días, también después de cerrar sesión (la clave lleva su id: nadie más que esa cuenta lo lee). En un equipo compartido, usar «Descartar» antes de salir lo borra al instante.

## Pruebas

Unitarias: `apps/web/src/lib/drafts.test.ts` (ida y vuelta, aislamiento por usuario y por alcance, caducidad, corrupto, versión, forma, almacenamiento lleno o bloqueado, barrido) y `apps/web/src/capture/reviewModel.test.ts` (el borrador de la captura conserva las decisiones). End-to-end: `e2e/capture.spec.ts` (11–18: navegar y volver, recargar, cerrar el diálogo, guardar y confirmar elimina, dos cuentas, corrupto/caducado).
