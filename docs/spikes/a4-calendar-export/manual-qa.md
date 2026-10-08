# A4.1: QA manual del flujo «Añadir al calendario»

> **Estado: probado en un dispositivo real (iPhone + Safari + Apple Calendar); el resto de las plataformas sigue NOT TESTED.** El agente que preparó esta guía no tiene teléfonos ni cuentas de calendario: el resultado de iPhone lo aportó el mantenedor y se registra tal como lo describió. Lo que no está en [Resultados reales](#resultados-reales-registrados) ni en la tabla de [lo probado](#qué-está-probado-y-qué-no) está **NOT TESTED**: no se inventó ningún resultado. Función: [calendar-export.md](../../calendar-export.md). PR: [#21](https://github.com/Maicolfelix/academic-planner/pull/21).

# Resultados reales registrados

## iPhone + Safari + Apple Calendar (probado por el mantenedor)

**Condiciones:** iPhone real, **Safari normal** (no PWA instalada), Academic Planner abierto por `http://<IP-DEL-PC>:5173` desde la misma red local, sin HTTPS, cuenta de prueba. Versión de iOS y modelo: **no registrados**.

| Caso                                              | Resultado  | Lo observado                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sin hora («Taller de bioestadística»)          | **PASS**   | Al pulsar «Añadir al calendario», Safari/iOS abrió **directamente** la interfaz de Calendario, sin buscar el archivo en Descargas/Archivos. Mostró título, asignatura («Base de datos SQL - NOSQL»), fecha y evento de **día completo**; con «Add To Calendar» el evento apareció en Apple Calendar. |
| 2. Misma actividad por segunda vez                | **PASS**   | iOS **no permitió crear visualmente otro evento igual**: reconoció el evento existente y mostró opciones del evento ya guardado (p. ej. eliminar). **No se observó un segundo evento.**                                                                                                              |
| 3. Con hora («Entrega proyecto», 11:59 p. m.)     | **PASS**   | iOS mostró **11:44 p. m. → 11:59 p. m.** el mismo día, sin cruzar a la fecha siguiente; título y asignatura correctos.                                                                                                                                                                               |
| 4. Parcial («Parcial de redes», 8:30 a. m.)       | **PASS**   | iOS mostró **8:15 a. m. → 8:30 a. m.**, igual que la semántica técnica actual (bloque de 15 minutos que termina en `dueAt`). El mantenedor lo considera **aceptable para A4.1**; no se cambia el modelo.                                                                                             |
| 5. Texto del botón                                | **PASS**   | El botón llevó directamente al calendario, sin obligar a abrir Descargas ni Archivos: **«Añadir al calendario» describe la experiencia en esta plataforma.** No se cambia el copy.                                                                                                                   |
| Actividad modificada (caso 5 de la guía completa) | NOT TESTED | No se probó.                                                                                                                                                                                                                                                                                         |
| PWA instalada                                     | NOT TESTED | **NOT TESTED — PWA REQUIRES HTTPS** (no hay HTTPS real). No bloquea el cierre de A4.1.                                                                                                                                                                                                               |

**Alcance de la evidencia.** Confirmado solo para **iPhone + Safari + Apple Calendar**: día completo, actividad con hora, segunda importación sin duplicado observado, texto comprensible y flujo directo al calendario. Que el `UID` estable ayude a reconocer la misma actividad **se observó únicamente en Apple Calendar**; no se generaliza a Google Calendar, Outlook ni a otros navegadores. **No confirmado:** Android, Chrome móvil, Windows con interfaz real, macOS, Google Calendar, Outlook y PWA instalada. En esta prueba no se anotó de forma explícita que la descripción privada no apareciera; la pantalla mostró título, asignatura y fecha.

# QUICK QA — 10 MINUTOS

Lo mínimo para decidir el PR #21. Datos de prueba en [Datos de prueba](#datos-de-prueba-crear-en-la-app) (una actividad **sin hora** y una **con hora**). Anotar lo que se **ve**, no lo que se espera; lo que no se pruebe se deja en `NOT TESTED`. No hace falta que Google, Apple y Outlook se comporten igual.

## Plataforma 1: Windows + Edge o Chrome

1. Abrir Academic Planner con una cuenta de prueba y entrar a **Actividades**.
2. Crear o usar una actividad **sin hora**.
3. Pulsar **«Añadir al calendario»** y registrar:
   - ¿se descarga? ¿qué aviso muestra el navegador?
   - ¿se puede abrir fácilmente (un clic desde el aviso de descargas)?
   - ¿qué aplicación ofrece el sistema para abrirlo?
   - ¿el evento queda correcto (día, título «Título — Asignatura», sin descripción)?
4. Repetir con una actividad **con hora**.
5. Importar **la misma actividad dos veces** (descargar de nuevo y abrir otra vez) y anotar: **reemplaza / duplica / pregunta / otra cosa**.

## Plataforma 2: móvil real

Preferencia: **Android + Chrome** o **iPhone + Safari**. Repetir: actividad sin hora, actividad con hora y la misma actividad dos veces. Registrar sobre todo:

- ¿la persona entiende qué hacer con el archivo, sin que se lo expliquen?
- ¿el navegador lo abre u ofrece añadirlo al calendario?
- ¿queda perdido en Descargas/Archivos?

## PWA instalada

Si hay una PWA instalada, repetir **al menos un caso** desde ella (la prueba de pestaña del navegador es la principal). Si **no** hay HTTPS ni PWA disponible, escribir **`NOT TESTED — PWA REQUIRES HTTPS`**; eso **no** bloquea el QA del navegador normal.

## Conclusión sobre el texto del botón (solo registrar; no se cambia todavía)

- Si tras el clic el sistema **ofrece de inmediato abrir o importar** el evento → «Añadir al calendario» puede mantenerse.
- Si tras el clic **solo se descarga** un archivo y hay que **buscarlo a mano** → recomendar «Descargar evento de calendario».

## Parcial a las 8:30

Preguntar a quien probó: _«Si un parcial está registrado a las 8:30, ¿esperabas que empezara a las 8:30?»_ y anotar la respuesta tal cual. **No se toca el modelo.**

## Resultados (tabla simple)

Valores: `PASS` / `FAIL` / `NOT TESTED`, con una observación breve.

| Plataforma    | Navegador     | Descarga                        | Importación fácil | Duplicado al repetir | Copy correcto | Resultado  |
| ------------- | ------------- | ------------------------------- | ----------------- | -------------------- | ------------- | ---------- |
| Windows       | Edge o Chrome | NOT TESTED                      | NOT TESTED        | NOT TESTED           | NOT TESTED    | NOT TESTED |
| Android       | Chrome        | NOT TESTED                      | NOT TESTED        | NOT TESTED           | NOT TESTED    | NOT TESTED |
| iPhone        | Safari        | PASS                            | PASS              | PASS                 | PASS          | PASS       |
| PWA instalada | (la que haya) | NOT TESTED — PWA REQUIRES HTTPS | NOT TESTED        | NOT TESTED           | NOT TESTED    | NOT TESTED |

iPhone + Safari: el sistema abre el calendario directamente; la segunda importación reconoció el evento existente (no se observó duplicado), válido solo para Apple Calendar. Las demás filas siguen sin probarse. «Duplicado al repetir»: escribir `PASS` si reemplaza o pregunta, `FAIL` si duplica de forma que estorbe, y la descripción en observaciones.

## Qué enviar de vuelta

1. La tabla de arriba rellenada (plataforma, navegador y **versión**).
2. Para cada plataforma: qué ocurrió al pulsar el botón, con una captura de pantalla si se puede **sin datos personales**.
3. La respuesta sobre el parcial a las 8:30.
4. La conclusión sobre el texto del botón («mantener» o «Descargar evento de calendario») y por qué.
5. Cualquier cosa que se haya visto rara (hora desplazada, evento en dos días, descripción presente, datos que no deberían aparecer).

---

# Guía completa

## Qué se quiere saber

El archivo `.ics` ya está validado (ical.js, iCalendar Validator v1.22, 1768 pruebas, 3 pasadas de Playwright). Lo que falta separar y medir es lo que ocurre **después** de la descarga:

1. generación del `.ics` (cubierto);
2. descarga en el navegador (cubierto en Chromium/Edge, no en móviles reales);
3. **apertura o importación por el sistema operativo y la app de calendario** (sin probar);
4. **qué pasa al importar dos veces** lo mismo o lo modificado (sin probar).

## Flujo actual (solo lectura del código; no se cambió)

`ActivityCard` (botón) → `useMutation` → `downloadActivityCalendar(id)` (`api/activities.ts`) → `apiDownload(path)` (`api/client.ts`) → `saveFile(blob, filename)` (`lib/saveFile.ts`).

| Pregunta                    | Respuesta (según el código)                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Usa `fetch`?               | Sí: `fetch(path, { credentials: 'include' })`, GET con la cookie de sesión.                                                                                                                                                                 |
| ¿Crea un `Blob`?            | Sí: `res.blob()` de la respuesta `200` (`text/calendar; charset=utf-8`). Si la respuesta no es `ok` no hay archivo: se lanza `ApiRequestError` y la tarjeta muestra un `role="alert"`.                                                      |
| ¿Crea un object URL?        | Sí: `URL.createObjectURL(blob)`.                                                                                                                                                                                                            |
| ¿Crea un `<a download>`?    | Sí: un `<a>` con `href` = object URL y `download` = nombre; se añade al `body`, se hace `click()` y se quita.                                                                                                                               |
| ¿Revoca la URL?             | Sí, a los **10 s** (`setTimeout`), no de inmediato.                                                                                                                                                                                         |
| ¿Qué nombre usa?            | `academic-planner-activity.ics`, constante de `@planner/core` (`CALENDAR_EXPORT_FILENAME`), fija. En este flujo manda el atributo `download`; el `Content-Disposition` del servidor lleva el mismo nombre pero el navegador no lo usa aquí. |
| ¿Navega al endpoint?        | **No.** La página no cambia de URL: solo descarga. El estudiante se queda en `/activities`.                                                                                                                                                 |
| ¿Diferencias desktop/móvil? | **El código es el mismo** en todas las plataformas. Las diferencias vienen del navegador y del sistema operativo (ver abajo); son **hipótesis** hasta probarlas.                                                                            |

### Hipótesis derivadas del mecanismo (sin verificar en dispositivo)

- **Escritorio (Chromium/Edge/Firefox):** el archivo cae en «Descargas» y el navegador muestra su aviso de descarga; abrirlo depende de la asociación `.ics` del sistema. En la máquina de desarrollo de esta sesión, `.ics` está asociado a un manejador de Outlook/Correo y Calendario de Windows (se leyó el registro; **no se abrió nada**). Es información, no una prueba.
- **Android (Chrome):** probablemente aparece la notificación de descarga y «Abrir» delega en la app que declare `text/calendar`. Podría quedarse solo en «Descargas» si no hay una app asociada.
- **iOS (Safari):** el atributo `download` sobre un blob se admite en versiones recientes; el archivo suele ir a «Descargas»/Archivos y la vista previa del `.ics` suele ofrecer añadirlo al calendario. **Incierto.**
- **PWA instalada (modo independiente, sobre todo iOS):** las descargas con blob dentro de una PWA instalada son una zona de problemas conocidos (el archivo se abre en una vista sin forma clara de volver, o no se descarga). **Probar siempre las dos variantes:** pestaña del navegador y PWA instalada.

## Qué está probado y qué no

| Qué                                                                                                       | Estado                       | Evidencia                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| El `.ics` se genera y es válido (día completo, con hora, 23:59, hostil, Unicode)                          | TESTED                       | ical.js 2.2.1 + iCalendar Validator v1.22; pruebas de core y API                                                                                |
| El botón descarga con el nombre `academic-planner-activity.ics` y el contenido esperado                   | TESTED                       | Playwright con Edge (Chromium): evento `download` real en escritorio 1366 px y en emulación de Pixel 5 a 360 px (**emulación, no un teléfono**) |
| Estado de error con reintento; axe; sin desborde a 360 y 1366 px                                          | TESTED                       | `e2e/calendar-export.spec.ts`                                                                                                                   |
| La descarga en Windows + Chrome/Edge **con interfaz real** y su aviso                                     | NOT TESTED                   | Las pruebas son automáticas (sin ventana de descargas)                                                                                          |
| iPhone + Safari + Apple Calendar: descarga, apertura directa, día completo, con hora, segunda importación | TESTED                       | QA real del mantenedor (ver [Resultados reales](#resultados-reales-registrados)); no es PWA y no hay HTTPS                                      |
| Apertura/importación en cualquier otra app de calendario                                                  | NOT TESTED                   | Sin cuentas ni dispositivos en la sesión                                                                                                        |
| Android + Chrome, macOS + Safari                                                                          | NOT TESTED                   | Sin dispositivos                                                                                                                                |
| PWA instalada                                                                                             | NOT TESTED                   | **NOT TESTED — PWA REQUIRES HTTPS**                                                                                                             |
| Importar dos veces lo mismo                                                                               | TESTED (solo Apple Calendar) | Sin duplicado observado en iPhone. **No se generaliza a otros clientes.**                                                                       |
| Importar una actividad modificada                                                                         | NOT TESTED                   | Sin probar en ninguna plataforma.                                                                                                               |

## Preparación (para quien prueba)

No hace falta un teléfono conectado al entorno de desarrollo si ya existe una instalación accesible; si no, esta es una vía **no probada en esta sesión** para llegar desde un teléfono en la misma red Wi-Fi:

1. En el PC: `npm run db:up && npm run db:deploy`.
2. Averiguar la IP local del PC (la llamaremos `<IP-DEL-PC>`) y permitir los puertos 5173 y 3000 en el cortafuegos de Windows **solo para red privada**.
3. Arrancar con el origen exacto del teléfono (la API rechaza orígenes que no estén en `CORS_ORIGIN`; nunca `*`):

   ```powershell
   $env:WEB_HOST = '0.0.0.0'
   $env:CORS_ORIGIN = 'http://<IP-DEL-PC>:5173'
   npm run dev
   ```

4. En el teléfono abrir `http://<IP-DEL-PC>:5173`. Esto es HTTP sin cifrar en una red local: usar **datos de prueba** (correo ficticio, contraseña que no uses en otro sitio). El service worker y «instalar como app» **no funcionan con `npm run dev`**, y la PWA instalada exige HTTPS real, que esta guía no resuelve (en ese caso: `NOT TESTED — PWA REQUIRES HTTPS`).
5. Al terminar: detener el proceso (`taskkill /PID <npm> /T /F`, ver [CLAUDE.md](../../../CLAUDE.md)), comprobar con `netstat` que nada escucha y `docker compose stop`.

### Datos de prueba (crear en la app)

Crear una cuenta de prueba, un periodo que incluya las fechas, y estas asignaturas y actividades. `D` = un viernes al menos una semana después de hoy.

| Actividad                | Asignatura     | Fecha           | Hora       | Tipo    | Descripción               |
| ------------------------ | -------------- | --------------- | ---------- | ------- | ------------------------- |
| Taller de Bioestadística | Bioestadística | `D`             | —          | Tarea   | _(poner «texto privado»)_ |
| Entrega proyecto         | Bases de Datos | `D`             | 23:59      | Tarea   | —                         |
| Parcial de Redes         | Redes          | miércoles `D-2` | 8:30 a. m. | Parcial | —                         |

## Escenarios

Anotar para cada uno **qué se vio**, no lo que se esperaba. La zona horaria del dispositivo debería ser la de Bogotá (UTC-5); si no lo es, las horas se desplazan y hay que anotarlo.

### Caso 1: actividad sin hora («Taller de Bioestadística»)

Esperado: evento de **día completo** el viernes `D`; título «Taller de Bioestadística — Bioestadística»; **sin descripción** (el «texto privado» no aparece); sin correo ni nombre del usuario.

### Caso 2: actividad con hora («Entrega proyecto», 23:59)

Esperado: bloque **11:44–11:59 p. m.** del viernes `D`; **un solo día** (no aparece también el sábado).

### Caso 3: parcial («Parcial de Redes», 8:30)

Esperado técnico actual: bloque **8:15–8:30 a. m.**. Registrar además la respuesta a: _«Si pusiste 8:30 para un parcial, ¿esperabas que empezara a esa hora?»_. **No se cambia el modelo.**

### Caso 4: la misma actividad dos veces

Descargar y abrir/importar «Taller de Bioestadística» dos veces **sin cambiar nada**. Anotar: duplica / reemplaza / pregunta / otra cosa. **No se asume que el `UID` fuerce una actualización.**

### Caso 5: actividad modificada

1. Descargar e importar «Entrega proyecto».
2. En Academic Planner, cambiar el título (p. ej. «Entrega proyecto final») **o** la fecha.
3. Descargar de nuevo e importar.

Anotar: reemplaza el anterior / duplica / pregunta / otra cosa.

### Observaciones comunes (todos los casos)

- ¿Qué se ve al pulsar el botón (aviso, hoja de compartir, nada)?
- ¿Cuántos toques/clics hasta tener el evento en el calendario? ¿Hubo que abrir «Archivos» o «Descargas» a mano?
- ¿Qué app se abrió? ¿Pidió elegir calendario o cuenta?
- Si se probó como PWA instalada: ¿se pudo volver a la app?

## Matriz para rellenar

Una fila por plataforma y navegador (y una más para la PWA instalada si aplica). Escribir `NOT TESTED` en lo que no se pruebe.

| Plataforma                             | Navegador           | Acción al pulsar                                   | Archivo descargado                          | Opción de abrir calendario        | Evento importado           | Segunda importación                                    | Observaciones                            |
| -------------------------------------- | ------------------- | -------------------------------------------------- | ------------------------------------------- | --------------------------------- | -------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Windows (versión: …)                   | Chrome (versión: …) | NOT TESTED                                         | NOT TESTED                                  | NOT TESTED                        | NOT TESTED                 | NOT TESTED                                             |                                          |
| Windows (versión: …)                   | Edge (versión: …)   | NOT TESTED                                         | NOT TESTED                                  | NOT TESTED                        | NOT TESTED                 | NOT TESTED                                             |                                          |
| Android (versión y modelo: …)          | Chrome (versión: …) | NOT TESTED                                         | NOT TESTED                                  | NOT TESTED                        | NOT TESTED                 | NOT TESTED                                             |                                          |
| iOS (versión y modelo: no registrados) | Safari              | Safari abre directamente la interfaz de Calendario | Sin buscar el archivo en Descargas/Archivos | Sí, inmediata («Add To Calendar») | Correcto en Apple Calendar | Reconoció el evento existente; sin duplicado observado | Safari normal, HTTP en red local; no PWA |
| macOS (versión: …)                     | Safari              | NOT TESTED                                         | NOT TESTED                                  | NOT TESTED                        | NOT TESTED                 | NOT TESTED                                             |                                          |
| iOS / Android                          | PWA instalada       | NOT TESTED                                         | NOT TESTED                                  | NOT TESTED                        | NOT TESTED                 | NOT TESTED                                             |                                          |

Resultados por caso (rellenar con lo observado; `OK` / `FALLA` / `NOT TESTED` + una frase):

| Caso                                 | Windows    | Android    | iOS                                                                                    | macOS      |
| ------------------------------------ | ---------- | ---------- | -------------------------------------------------------------------------------------- | ---------- |
| 1. Sin hora: día completo correcto   | NOT TESTED | NOT TESTED | OK (iPhone + Safari)                                                                   | NOT TESTED |
| 1. Sin descripción ni datos privados | NOT TESTED | NOT TESTED | NOT TESTED (la pantalla mostró título, asignatura y fecha; no se anotó la descripción) | NOT TESTED |
| 2. 23:44–23:59 en un solo día        | NOT TESTED | NOT TESTED | OK (iPhone + Safari)                                                                   | NOT TESTED |
| 3. Parcial 8:15–8:30                 | NOT TESTED | NOT TESTED | OK (iPhone + Safari); aceptable según el mantenedor                                    | NOT TESTED |
| 4. Misma actividad dos veces         | NOT TESTED | NOT TESTED | OK: sin duplicado observado (Apple Calendar)                                           | NOT TESTED |
| 5. Actividad modificada              | NOT TESTED | NOT TESTED | NOT TESTED                                                                             | NOT TESTED |

## Mini prueba de producto (por persona, no es un estudio)

Hacer solo estas cinco preguntas, tras dejarla usar el botón sin explicarle nada, y anotar sus palabras:

| #   | Pregunta                                                             | Respuesta  |
| --- | -------------------------------------------------------------------- | ---------- |
| 1   | «¿Te quedó claro qué iba a pasar al pulsar Añadir al calendario?»    | NOT TESTED |
| 2   | «¿Pudiste tenerlo en tu calendario sin que te explicaran cómo?»      | NOT TESTED |
| 3   | «Para un parcial a las 8:30, ¿8:30 significa inicio o fecha límite?» | NOT TESTED |
| 4   | «¿Te molestaría tener que hacer esto una vez por actividad?»         | NOT TESTED |
| 5   | «¿Preferirías que después se actualizara solo?»                      | NOT TESTED |

## Nombre del botón

Hoy el texto es **«Añadir al calendario»**, pero el botón **solo descarga** un archivo; añadirlo depende de que el navegador y el sistema operativo lo ofrezcan. Si en las pruebas el estudiante tiene que abrir «Archivos» o «Descargas» a mano e importar, el nombre promete más de lo que ocurre y habría que considerar **«Descargar evento de calendario»** (o similar). **No se cambia el texto sin evidencia.** Criterio para decidirlo, por plataforma:

| Si, tras pulsar…                                                   | Entonces el nombre actual…                |
| ------------------------------------------------------------------ | ----------------------------------------- |
| …el sistema ofrece añadirlo al calendario con un toque             | es razonable                              |
| …el archivo se descarga y hay que abrirlo desde Descargas/Archivos | es engañoso en esa plataforma             |
| …no se descarga o se abre una vista sin salida (PWA)               | es un defecto del mecanismo, no del texto |

## Alternativas de implementación (solo comparación; **no implementar sin evidencia**)

Se activan solo si la prueba demuestra una UX mala. Todo lo de las columnas de plataforma es **hipótesis sin verificar**.

| Opción                                                                 | Escritorio                         | Android                                             | iOS                                                  | Auth/cookie                                                 | Accesibilidad / seguridad                                                         | Complejidad                                 |
| ---------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| **A.** `fetch` + `Blob` + `<a download>` (actual)                      | Descarga normal                    | Descarga con notificación                           | Descarga a Archivos; PWA incierta                    | Cookie de sesión; errores controlados (alerta, reintento)   | Botón nativo; sin navegar; el error se ve                                         | Ya hecho                                    |
| **B.** Navegar al endpoint (`location.href` / `window.open`)           | Descarga por `Content-Disposition` | Igual; el navegador gestiona el archivo             | Puede abrir el `.ics` en la vista del sistema        | Cookie `SameSite=Lax` viaja en navegación de nivel superior | Un error sería una página JSON que **reemplaza** la app; peor control             | Muy baja                                    |
| **C.** `<a href="/api/.../calendar.ics">` (enlace)                     | Igual que B                        | Igual que B                                         | Igual que B                                          | Igual que B                                                 | Enlace real y semántico; sin estado de carga ni error propio                      | Muy baja; pierde el manejo de errores       |
| **D.** Web Share API con archivo (`navigator.share({ files })`)        | Soporte irregular                  | Hoja de compartir: puede incluir apps de calendario | Hoja de compartir con «Añadir al calendario» posible | Igual que A (hay que obtener el blob)                       | Requiere gesto del usuario y HTTPS; si no se soporta hay que caer en A            | Media; dos caminos y detección de capacidad |
| **E.** Enlace de «añadir a Google Calendar» (`render?action=TEMPLATE`) | Abre Google                        | Abre Google                                         | Abre Google                                          | No usa la sesión                                            | **Descartada:** manda título y fechas por URL a un tercero y solo sirve a una app | —                                           |

Sin _user-agent sniffing_ salvo evidencia extrema. Cualquier cambio del mecanismo de descarga **se reporta primero y espera aprobación**.

## Decisión de fusión del PR #21

El PR #21 puede considerarse **candidato a fusión** si se cumplen **todos** estos puntos:

| Gate | Condición                                                                                     | Estado                                                                     |
| ---- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A    | La generación y la descarga funcionan                                                         | **PASS** (automático en Chromium/Edge y real en iPhone + Safari)           |
| B    | Al menos una plataforma real permite llegar al calendario de forma comprensible               | **PASS** (iPhone + Safari + Apple Calendar: abre directo el calendario)    |
| C    | Se prueba al menos un móvil real                                                              | **PASS** (iPhone real)                                                     |
| D    | La segunda importación tiene un comportamiento conocido (reemplaza, duplica, pregunta u otro) | **PASS** (Apple Calendar: sin duplicado observado; solo en esa plataforma) |
| E    | No aparece un problema grave de privacidad o de UX                                            | **PASS** (sin problema grave reportado)                                    |
| PWA  | PWA instalada                                                                                 | **NOT TESTED — PWA REQUIRES HTTPS** (no bloquea)                           |

No se exige que Google, Apple y Outlook se comporten igual, ni que la segunda importación sea «buena»: basta con que se **conozca** y que no invalide el MVP. Esta guía **no promete compatibilidad** con ninguna aplicación de calendario. Los gates A a E quedaron cerrados con la prueba real de iPhone. Lo no probado (Android, Google Calendar, Outlook, Windows con interfaz real, macOS, PWA) **no bloquea** A4.1, pero **tampoco** queda confirmado.
