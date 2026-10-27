# Limitaciones conocidas

Lista central y honesta de lo que el sistema **no** hace o no se ha comprobado. Se revisó contra el código y las pruebas de `main` en `1267657` (P9 completo y RG-1 fusionado) y contra la evidencia de RG-2 (PR #70; 2026-10-26). Los riesgos de seguridad con más detalle están en [security.md](security.md#17-limitaciones-conocidas); el estado de cada elemento del release está en [release-readiness-audit.md](release-readiness-audit.md).

## Lo que aún no está validado

| Tema                                    | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Despliegue real**                     | **No existe ningún alojamiento persistente.** Railway quedó **bloqueado** (exige cuenta; el presupuesto es $0). HTTPS y proxy se validaron el 2026-10-26 con un **túnel temporal de Cloudflare** sobre Docker local ([evidencia](deployment.md#validación-https-gratuita-rg-2b-docker-local--cloudflare-quick-tunnel)): sirve como prueba, no como servicio.                                                                                                          |
| **HTTPS, proxy y cookie `__Host-`**     | **Validados por cabeceras sobre HTTPS real** en el túnel temporal (humo `--full` 36/0/0, cookie `__Host-`, HSTS, CORS exacto, `TRUST_PROXY=1` medido tras Cloudflare). **Sin validar:** un navegador real sobre HTTPS, un alojamiento persistente y un proveedor distinto (Railway no documenta su proxy: habría que volver a medir).                                                                                                                                 |
| **PWA instalada**                       | El mantenedor **declaró** haberla instalado y usado en un iPhone (Safari) y dos Android (Chrome) sobre HTTPS temporal (RG-3, 2026-10-27), pero **sin capturas, modelos ni versiones**: no cumple el estándar de evidencia. Sin probar el aviso de actualización. [Resultados](rg3-results.md)                                                                                                                                                                         |
| **Web Share Target en Android**         | El mantenedor **declaró** haberlo probado en Android reales (RG-3, 2026-10-27); **sin evidencia ni corroboración independiente**. Safari/iOS no puede ser destino de compartir (limitación de la plataforma) y no se exige.                                                                                                                                                                                                                                           |
| **Dispositivos reales (iOS / Android)** | QA ejecutada por el mantenedor en RG-3 (iPhone con Safari y dos Android con Chrome, HTTPS temporal) pero **declarada y con evidencia incompleta** (sin capturas, modelos ni versiones). Sin QA con estudiantes ni sobre un alojamiento persistente.                                                                                                                                                                                                                   |
| **Migraciones desde una base vacía**    | Las **15 migraciones** se validaron desde una base vacía en **local** (RG-2, PostgreSQL 17 desechable en Docker) sin deriva inesperada; **no hay un PostgreSQL persistente de preproducción donde repetirlo**. `schema.prisma` y la base migrada no son idénticos por diseño: `prisma migrate diff` muestra una diferencia **conocida y aceptada** (la FK manual `Evaluation → Activity`) ([deployment.md](deployment.md#deriva-del-esquema-conocida-e-intencional)). |
| **Suite Playwright completa tras P9**   | Corrida completa verde en RG-3 (2026-10-27, `4253a78`): 877 pasan, 0 fallan, 15 omitidas a propósito. Hay que repetirla si cambia el código.                                                                                                                                                                                                                                                                                                                          |
| **Respaldo y restauración**             | Ensayado en RG-3 en un PostgreSQL 17 **local desechable** (integridad, relaciones y notas, login contra la restaurada); **no hay copias automáticas de un proveedor** ni base persistente. Ver [rg3-results.md](rg3-results.md).                                                                                                                                                                                                                                      |
| **Carga y escala**                      | Solo hay pruebas de humo (500 actividades, una cuenta, máquina de desarrollo). No hay pruebas de carga, ni número de usuarios soportado, ni SLA.                                                                                                                                                                                                                                                                                                                      |
| **Navegadores**                         | Probado con Chromium/Edge (y, en etapas anteriores, Safari en iPhone por HTTP). La PWA y el service worker varían entre navegadores; no se afirma soporte universal.                                                                                                                                                                                                                                                                                                  |

### Web Share API y Web Share Target no son lo mismo

- **Web Share API** (compartir **desde** una página hacia otras apps): Safari y iOS sí pueden compartir. Academic Planner **no** usa ese API; no hay botón de compartir.
- **Web Share Target** (ser **destino** del menú «Compartir» del sistema): es lo que implementa A5. **Safari/iOS no lo soporta como destino**, así que en un iPhone Academic Planner no aparecerá en la hoja de compartir: es una limitación de la plataforma, no un defecto. Funciona (según la documentación técnica) en **Android con Chromium/WebAPK** y en **ChromeOS**, y **solo con la PWA instalada**. Detalle y fuentes: [share-target.md](share-target.md#soporte-del-share-target-y-diferencia-con-el-web-share-api).

## Limitaciones funcionales

- **Periodos:** se editan y se cambian desde **Mis estudios → Periodos** (nombre, fechas y nivel; crear el siguiente; marcar otro como actual). **No hay estado «cerrado»** para un periodo: cambiar de semestre es cambiar el periodo actual **de ese estudio** y el anterior se conserva. **No hay eliminación de periodos en la interfaz.** Un plan anterior sin estudio debe convertirse en estudio («Convertir en estudio») para administrar sus periodos desde ahí.
- **Sin pantalla de perfil:**
  - **Nombre:** no se puede cambiar.
  - **Contraseña:** no se puede cambiar ni recuperar.
  - **Zona horaria:** sin interfaz (`User.timezone`, por defecto `America/Bogota`).
- **Sin sincronización con calendarios externos**, sin notificaciones push, correo ni SMS. Los recordatorios solo aparecen **dentro** de la aplicación, al abrirla.
- **Sin aplicación nativa:** es una PWA.
- **Sin modo sin conexión para datos.** Sin red abre el shell y avisa; consultar o escribir datos requiere conexión. No hay escrituras offline ni cola.
- **Un solo idioma:** la interfaz y los intérpretes están en español (Colombia).
- **Sin modo oscuro.**
- **Sin estimación de duración, dificultad ni recomendaciones basadas en hábitos.** El Radar y «¿Qué hago ahora?» usan solo plazo, prioridad y estado.
- **Recordatorios:** un recordatorio AUTO eliminado por el estudiante no vuelve hasta que cambie la fecha, el tipo o el estado de la actividad; los desfases son minutos absolutos («1 día antes» = 24 h reales); `/api/reminders/due` solo cubre el periodo actual.
- **El Radar** lista como máximo 10 actividades por categoría (el conteo siempre es real).
- **Progreso y carga son descriptivos:** sin ponderar, y la carga no mide estrés, dificultad ni rendimiento.

## Limitaciones de seguridad y cuentas

**Alcance de v1:** `v1.0.0` se valida como **beta cerrada** ([release-readiness-audit.md](release-readiness-audit.md#política-de-acceso-para-v1-decisión-provisional)). Las tres primeras líneas de abajo **no bloquean la beta cerrada** pero **sí bloquean ofrecer el servicio con registro público abierto**.

- **Sin verificación de correo.**
- **Sin recuperación de contraseña** (ni cambio de contraseña dentro de la aplicación).
- **Sin MFA**, OAuth, roles ni eliminación de cuenta.
- El registro revela si un correo ya existe (409), a diferencia del inicio de sesión.
- Sesión de duración fija de 7 días (sin renovación ni cierre por inactividad) y sin lista de sesiones activas. Las sesiones vencidas solo se borran al usarse; no hay tarea de purga.
- Límites de frecuencia **en memoria y por proceso**: se reinician con el servidor y no se comparten entre instancias, así que v1 se despliega con **una sola instancia**.
- `npm audit`: **0 vulnerabilidades** (con y sin `--omit=dev`) en `main` tras P9. Ver [security.md](security.md#15-dependencias-npm-audit) para el historial.
- No se hizo prueba de penetración ni revisión de la infraestructura de despliegue.
- La cuenta demo (contraseña pública) **no debe existir** en un despliegue público ([demo.md](demo.md)).
- **Licencia:** no hay archivo `LICENSE` (decisión pendiente del propietario). Para una beta privada no bloquea; antes de cualquier distribución pública debe decidirse.

## Intérpretes de texto (Captura rápida y Bandeja académica)

- Solo **español** y solo los fraseos que las reglas prevén; no «entienden» lenguaje libre.
- **Captura rápida** y **Bandeja académica** (hasta 5000 caracteres cada una) comparten un motor que lee varias actividades, listas de días y horas, cantidades («dos tareas») y referencias hacia atrás («el parcial es a las 7», «las dos tareas…»); hasta **50 propuestas** por texto (más: se pide dividir el mensaje; el texto no se pierde), nunca recortado en silencio. No es lenguaje libre: lo que no reconoce queda como una pregunta o un campo vacío, y las referencias solo se resuelven hacia atrás y contra menciones del mismo tipo («cada uno», «los anteriores» y «los otros» fuera de una lista de días no se interpretan). Puede proponer algo incompleto (queda marcado) y sugiere duplicados, pero no los decide.
- **Borradores:** viven en `localStorage` de **ese navegador** (no se sincronizan entre dispositivos), caducan a los 7 días y se conservan al cerrar sesión (solo los lee esa cuenta); en un equipo compartido conviene «Descartar» antes de salir. No son una cola sin conexión: sin conexión no se interpreta ni se crea nada.
- Las rutas anteriores `/api/quick-capture/parse` y `/api/academic-inbox/parse` se conservan por compatibilidad sin uso en la interfaz.
- Un NUL en el título de una clase de la Agenda sigue siendo aceptado por el esquema y rechazado por la base de datos con un 500 genérico (hallazgo de F1-2cdp; los títulos y descripciones de actividad y los nombres de asignatura y periodo ya lo rechazan con un mensaje).
- Nunca inventan una asignatura: una ambigua o ausente se pregunta.
- Sin alias propios de asignaturas.

## Importación de horario (OCR)

- Es una **importación asistida**, no un reconocimiento automático perfecto: el OCR puede equivocarse (rotación, baja resolución, tablas complejas, celdas combinadas); la revisión humana de la vista previa es obligatoria y nada se crea sin confirmar.
- Idioma de OCR: español (modelo `@tesseract.js-data/spa`, variante `4.0.0_best_int`).
- Límites: 10 MB, 5 páginas, 25 megapíxeles, 40 propuestas, 60 s, una importación a la vez por usuario y 10 por IP cada 10 minutos.
- Solo propone **clases** (no actividades); cada clase se confirma una a una.

## Pruebas y herramientas

- `MaxListenersExceededWarning` (11 listeners en `Server`) al ejecutar las pruebas de API: **ruido del arnés**, sin efecto funcional ni en el servidor. Causa confirmada con `--trace-warnings`: `supertest` (`Test.end`) registra un listener por solicitud cuando una prueba lanza más de 10 solicitudes concurrentes sobre la misma aplicación; no hay código del producto en la traza. Sigue presente en el candidato `1.0.0-rc.1` (BAJA, P17-04); no se refactoriza en un candidato.
- Una `npm run dev` huérfana (el vigilante `node --watch` vuelve a levantar la API) contamina `test:browser`; ver [development.md](development.md#problemas-comunes).
- Los archivos de importación de prueba son sintéticos; no se usaron horarios reales.

## Fuera de alcance (no implementado a propósito)

Verificación de correo, recuperación de contraseña, MFA, OAuth, roles, eliminación de cuenta, CAPTCHA externo, Web Push, correo, SMS, IA (incluida visión), sincronización offline completa, integración con calendarios externos, duración estimada, dificultad y recomendaciones basadas en hábitos.

## Lo que este proyecto no afirma

El software **no ha medido** efectos sobre el rendimiento académico, el estrés, el bienestar ni la deserción, y no debe presentarse como si los tuviera. Está diseñado para facilitar la organización (centraliza información, reduce pasos operativos y apoya la planificación), y las pruebas demuestran que **funciona como se describe**, no que produzca esos resultados.
