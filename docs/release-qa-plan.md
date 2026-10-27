# Plan de QA en dispositivos reales (release gate)

> **Estado: plan, sin ejecutar.** Nada de este documento es evidencia. Cada celda se llena con lo que de verdad se probó, en qué dispositivo, con qué commit y qué pasó. Se ejecuta en RG-3 sobre el HTTPS **temporal** de una sesión con Docker local y Cloudflare Quick Tunnel ([procedimiento, matriz de evidencia y criterios](rg3-procedure.md)); no hay alojamiento permanente; hasta entonces la única QA real fue funcional, en un iPhone con Safari por HTTP de red local, y no cubre P9.
>
> **Por qué HTTPS:** la PWA instalada, el service worker, la cookie `__Host-` y el Share Target lo exigen. Sobre HTTP de red local no se puede instalar ni compartir; por eso esa QA anterior no los valida.

## Matriz mínima

| Dispositivo  | Modo                                           | Qué se valida                                                                   | Share Target                                                                                                                                                |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone real  | Safari, HTTPS                                  | Todos los flujos de abajo                                                       | No aplica                                                                                                                                                   |
| iPhone real  | PWA instalada («Agregar a pantalla de inicio») | Todos los flujos de abajo, abrir desde el icono, teclado virtual, actualización | **No se espera**: Safari/iOS no es destino de compartir (ver [share-target.md](share-target.md#soporte-del-share-target-y-diferencia-con-el-web-share-api)) |
| Android real | Chrome, HTTPS                                  | Todos los flujos de abajo                                                       | No aplica (sin instalar no es destino)                                                                                                                      |
| Android real | PWA instalada (Chrome/WebAPK)                  | Todos los flujos de abajo, abrir desde el icono, teclado virtual, actualización | **Sí: se valida el Share Target real**                                                                                                                      |

**iOS no necesita que Academic Planner aparezca en la hoja de compartir.** Que iOS no pueda recibir compartidos no es un defecto de la aplicación ni bloquea la QA de iPhone. (Safari sí puede **compartir** hacia otras apps; la limitación es ser **destino**.)

## Flujos mínimos (en cada celda con dispositivo)

Para cada uno: resultado (✅/❌/n.a.), notas y, si falla, un enlace al defecto.

1. **Registro** y mensajes de error de validación.
2. **Login y logout**; que la sesión persista al cerrar y reabrir; que tras cerrar sesión «Atrás» no muestre datos privados.
3. **Onboarding** completo (uso, periodo, pasos opcionales, pantalla final).
4. **Home:** saludo, Pixel Companion, «¿Qué hago ahora?» sin desbordes ni cortes, Radar, Progreso, contadores.
5. **P9-1, héroe accionable:** «Completar» y «Empezar» desde el Inicio; que la siguiente recomendación aparezca sola; error con la red cortada (sin éxito falso, el botón vuelve a habilitarse); un toque es una sola petición.
6. **Primer uso (P9-2):** cuenta nueva sin asignaturas («Importar mi horario», «Interpretar un mensaje», añadir a mano) y con asignaturas sin actividades («Captura rápida», «Importar calendario .ics», añadir a mano); que cada camino abra lo que promete.
7. **Actividades:** crear, editar, cambiar de estado, «Añadir al calendario», filtros y recordatorios.
8. **Captura rápida:** una y varias actividades, día compartido, asignatura ausente o ambigua, confirmación.
9. **Bandeja académica:** pegar un mensaje, revisar y confirmar.
10. **Horario:** crear clases, importar una captura o PDF (OCR) y confirmar; la Agenda.
11. **Importación `.ics`:** un archivo de Google Calendar, uno de Outlook y uno universitario (los dos primeros solo si hay cuenta); eventos únicos y semanales, y lo no soportado explicado.
12. **Notas:** configurar la escala y los cortes de una materia, registrar una nota y Captura de notas.
13. **Radar y Progreso**, incluida la línea de notas.
14. **Mis estudios:** crear un segundo estudio, archivar y restaurar, hacer principal.
15. **Transición de periodo:** con Medicina (2026-1 actual) y un Diplomado (Cohorte A actual), crear 2026-2 para Medicina y hacerlo actual; comprobar que 2026-1 se conserva y que el Diplomado sigue actual.

## Comprobaciones transversales

- Teclado virtual: que no tape el campo activo ni el botón de enviar; zonas seguras (muescas) en modo instalado.
- Sin desbordes a 360 px reales; controles táctiles cómodos.
- Sin conexión: el shell abre y avisa; las acciones fallan con un mensaje, nunca con éxito falso.
- Actualización: publicar una versión nueva y comprobar el aviso «Nueva versión disponible» (nunca recarga sola).
- Cookie de sesión: sobrevive a cerrar la PWA; se pierde al cerrar sesión.

## Share Target en Android (PWA instalada)

1. Instalar la PWA desde Chrome sobre HTTPS e iniciar sesión (con al menos una asignatura: si no, la caja de Captura rápida no se muestra y lo compartido espera 10 minutos).
2. En otra app (WhatsApp, el navegador, el correo), compartir un texto como «parcial de redes el martes a las 10 am».
3. Elegir **Academic Planner** en el menú de compartir.
4. Comprobar: se abre la Captura rápida con el texto precargado y enfocada; la URL ya no lleva los parámetros; **no se creó nada** hasta pulsar «Interpretar» y confirmar.
5. Repetir con: sesión cerrada (debe pedir iniciar sesión y volver con lo compartido), un borrador existente (pregunta «Usar lo compartido» / «Mantener mi borrador»), un enlace `http(s)` compartido desde el navegador, y un texto muy largo (aviso de recorte).
6. Registrar el navegador, la versión de Android y el resultado.

## Registro de evidencia (se llena durante la ejecución)

| Fecha      | Commit/versión                             | Dispositivo y SO                                          | Navegador/PWA                                       | Flujos probados                                                                     | Resultado                                                                | Defectos          |
| ---------- | ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| 2026-10-27 | `7e0ffae` (código de producto = `4253a78`) | iPhone y dos Android (modelos y versiones no registrados) | Safari y Chrome sobre HTTPS temporal; PWA instalada | Recorridos principales, instalación de la PWA, sin conexión, Share Target (Android) | PASS (declarado por el mantenedor; ver [rg3-results.md](rg3-results.md)) | Ninguno reportado |

Un defecto BLOCKER o HIGH abierto impide etiquetar `v1.0.0`. Lo que se pruebe y falle se corrige en su propio PR y se repite la celda afectada sobre el nuevo candidato.
