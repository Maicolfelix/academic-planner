# Limitaciones conocidas

Lista central y honesta de lo que el sistema **no** hace o no se ha comprobado. Cada punto se verificó contra el código o las pruebas en la Fase 19. Los riesgos de seguridad con más detalle están en [security.md](security.md#17-limitaciones-conocidas).

## Lo que aún no está validado

| Tema                                    | Estado                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispositivos reales (iOS / Android)** | **No probados.** Lo medido es emulación a 360, 768 y 1366 px en Edge/Chromium. La instalación de la PWA, el teclado virtual y la cámara/archivos en móviles físicos siguen pendientes.                                  |
| **HTTPS y proxy inverso reales**        | **No validados.** Solo se probó la topología local de producción (la API sirviendo la app en el puerto 4300, sin HTTPS). Cookie `__Host-`, HSTS y `TRUST_PROXY` están implementados pero sin probar tras un proxy real. |
| **Despliegue**                          | No se ha desplegado en ningún servidor. [deployment.md](deployment.md) describe los requisitos, no una experiencia.                                                                                                     |
| **Carga y escala**                      | Solo hay pruebas de humo (500 actividades, una cuenta, máquina de desarrollo). No hay pruebas de carga, ni número de usuarios soportado, ni SLA.                                                                        |
| **Navegadores**                         | Probado con Chromium/Edge. La PWA y el service worker varían entre navegadores; no se afirma soporte universal.                                                                                                         |

## Limitaciones funcionales

- **Sin gestión del periodo en la interfaz.** El periodo se crea en el onboarding; la API permite editarlo y eliminarlo, pero no hay pantalla. Un usuario trabaja con un periodo actual.
- **Sin pantalla de perfil:** no se puede cambiar la zona horaria (`User.timezone`, por defecto `America/Bogota`), el nombre ni la contraseña.
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

- Sin verificación de correo, recuperación de contraseña, MFA, OAuth, roles ni eliminación de cuenta.
- El registro revela si un correo ya existe (409), a diferencia del inicio de sesión.
- Sesión de duración fija de 7 días (sin renovación ni cierre por inactividad) y sin lista de sesiones activas.
- Límites de frecuencia **en memoria y por proceso**: se reinician con el servidor y no se comparten entre instancias.
- `npm audit`: 4 vulnerabilidades altas en la cadena del **CLI** de Prisma (no alcanzables en tiempo de ejecución según el análisis actual). Ver [security.md](security.md#15-dependencias-npm-audit).
- No se hizo prueba de penetración ni revisión de la infraestructura de despliegue.
- La cuenta demo (contraseña pública) **no debe existir** en un despliegue público ([demo.md](demo.md)).

## Intérpretes de texto (Captura rápida y Bandeja académica)

- Solo **español** y solo los fraseos que las reglas prevén; no «entienden» lenguaje libre.
- **Captura rápida admite una actividad a la vez**; la detección de varias en una frase no es perfecta. Hasta 300 caracteres.
- **Bandeja académica:** hasta 5000 caracteres y **10 propuestas** por mensaje. Puede proponer algo incompleto (queda marcado) y sugiere duplicados, pero no los decide.
- Nunca inventan una asignatura: una ambigua o ausente se pregunta.
- Sin alias propios de asignaturas.

## Importación de horario (OCR)

- Es una **importación asistida**, no un reconocimiento automático perfecto: el OCR puede equivocarse (rotación, baja resolución, tablas complejas, celdas combinadas); la revisión humana de la vista previa es obligatoria y nada se crea sin confirmar.
- Idioma de OCR: español (modelo `@tesseract.js-data/spa`, variante `4.0.0_best_int`).
- Límites: 10 MB, 5 páginas, 25 megapíxeles, 40 propuestas, 60 s, una importación a la vez por usuario y 10 por IP cada 10 minutos.
- Solo propone **clases** (no actividades); cada clase se confirma una a una.

## Pruebas y herramientas

- `MaxListenersExceededWarning` (11 listeners en `Server`) al ejecutar las pruebas de API con Supertest: ruido de las pruebas, sin efecto funcional ni en el servidor (registrado como P17-04; **sigue presente** en la Fase 19).
- Una `npm run dev` huérfana (el vigilante `node --watch` vuelve a levantar la API) contamina `test:browser`; ver [development.md](development.md#problemas-comunes).
- Los archivos de importación de prueba son sintéticos; no se usaron horarios reales.

## Fuera de alcance (no implementado a propósito)

Verificación de correo, recuperación de contraseña, MFA, OAuth, roles, eliminación de cuenta, CAPTCHA externo, Web Push, correo, SMS, IA (incluida visión), sincronización offline completa, integración con calendarios externos, duración estimada, dificultad y recomendaciones basadas en hábitos.

## Lo que este proyecto no afirma

El software **no ha medido** efectos sobre el rendimiento académico, el estrés, el bienestar ni la deserción, y no debe presentarse como si los tuviera. Está diseñado para facilitar la organización (centraliza información, reduce pasos operativos y apoya la planificación), y las pruebas demuestran que **funciona como se describe**, no que produzca esos resultados.
