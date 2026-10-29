# Prueba con usuarios

Protocolo **opcional** (trabajo futuro) para validar con estudiantes si Academic Planner cumple su propósito. El proyecto de grado no lo exige; lo que sí se hizo es una [evaluación funcional por un experto](expert-evaluation.md), que no lo sustituye. **Es un instrumento, no un resultado:** hasta que se aplique, el proyecto no tiene validación con usuarios (ver [limitaciones](limitations.md)). Los resultados que se obtengan se registran en un documento aparte y **no** se extrapolan a rendimiento, estrés ni notas: el software no mide eso.

## 1. Qué se quiere saber

| Pregunta                                                                                           | Cómo se responde                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| ¿Un estudiante nuevo logra usar las funciones principales sin ayuda?                               | Tareas guiadas: éxito, tiempo, errores     |
| ¿Se percibe fácil de usar?                                                                         | Cuestionario SUS (10 preguntas)            |
| ¿Cumple la visión: «la aplicación organiza lo que el estudiante ya recibe» y no le da más trabajo? | Preguntas propias (sección 6) y entrevista |
| ¿Qué falla, confunde o falta?                                                                      | Observación y comentarios abiertos         |

## 2. Participantes

- **Meta:** 5 a 8 estudiantes universitarios (con 5 ya aparece la mayoría de los problemas de uso; más da más confianza, no otro tipo de evidencia).
- **Perfil:** estudian actualmente, usan un teléfono, y **no** participaron en el desarrollo. Conviene mezclar carreras y semestres.
- **Quién no:** compañeros que ya vieron la aplicación por dentro.

## 3. Preparación

1. **Acceso.** Una de dos:
   - Red local: `WEB_HOST=0.0.0.0` y `CORS_ORIGIN=http://localhost:5173,http://<IP-de-tu-PC>:5173` con `npm run dev`; los participantes deben estar en el mismo wifi y la PC encendida.
   - Despliegue temporal con HTTPS (ver [deployment](deployment.md)): permite probar la PWA instalada.
2. **Cuentas.** Cada participante crea la suya (parte de la prueba). Al terminar se borran sus datos (sección 8).
3. **Material para las tareas**, preparado antes:
   - Un mensaje de texto de ejemplo con dos actividades y días distintos (puede ser el de la sección 5, tarea 2).
   - Una captura o un `.ics` de un horario de ejemplo (no el real del participante).
4. **Hoja de registro** por participante (sección 7) y, si el participante acepta, grabación de pantalla sin audio ni rostro.

## 4. Sesión (30 a 40 min)

1. **Bienvenida (3 min).** «Estamos probando la aplicación, no a ti. Si algo no se entiende, el problema es de la aplicación. Piensa en voz alta. No te voy a ayudar salvo que lo pidas.»
2. **Consentimiento** (sección 8) y **preguntas previas** (sección 6.A).
3. **Tareas** (20 a 25 min), una a la vez, leídas en voz alta. El facilitador solo observa y anota.
4. **Cuestionarios** SUS y preguntas propias (5 min).
5. **Entrevista corta** (5 min).

Reglas del facilitador: no explicar la interfaz, no señalar con el dedo, y si el participante se atasca más de 2 minutos, ofrecer una pista y anotarlo como «con ayuda».

## 5. Tareas

Cada tarea se anota como: **Éxito** (sin ayuda), **Con ayuda**, o **Fracaso**; más el tiempo y los errores observados.

| #   | Tarea que se le lee al participante                                                                                                                                                        | Qué se observa                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1   | «Crea tu cuenta y deja listo tu semestre.»                                                                                                                                                 | Registro y onboarding: ¿entiende cada pregunta?                         |
| 2   | «Tu profesor te escribió: "Tengo dos actividades, una el martes y la otra el jueves; la del martes es sobre redes y la del jueves es práctica con Kali Linux". Guárdalo en la aplicación.» | Captura rápida: ¿revisa la propuesta antes de confirmar? ¿Corrige algo? |
| 3   | «Agrega a la aplicación tu horario de clases» (con la captura o el `.ics` de ejemplo).                                                                                                     | Importación de horario: ¿entiende la revisión y confirma?               |
| 4   | «Quieres saber qué te conviene hacer ahora. Encuéntralo y marca que ya empezaste esa actividad.»                                                                                           | Inicio, «¿Qué hago ahora?», cambio de estado                            |
| 5   | «Mira qué tienes esta semana y añade una de las actividades al calendario de tu teléfono.»                                                                                                 | Agenda y «Añadir al calendario»                                         |
| 6   | «Una actividad cambió de fecha para dentro de dos semanas. Edítala.»                                                                                                                       | Edición y selector de fecha (mes y año)                                 |
| 7   | (Opcional) «Registra que sacaste 4,0 en el primer parcial de una asignatura.»                                                                                                              | Notas                                                                   |

## 6. Cuestionarios

### A. Antes de usarla (contexto)

1. ¿Cómo organizas hoy tus actividades? (nada / notas del teléfono / calendario / agenda en papel / otra app / otra)
2. ¿Cuántas veces en el último semestre se te pasó una entrega o un parcial? (0 / 1 / 2 a 3 / más de 3)
3. ¿Dónde recibes la información de tus clases? (marca todas: WhatsApp / correo / plataforma de la universidad / PDF o foto del horario / en clase / otra)

### B. Después de usarla: SUS

Escala de 1 («Totalmente en desacuerdo») a 5 («Totalmente de acuerdo»).

1. Creo que me gustaría usar este sistema con frecuencia.
2. Encontré el sistema innecesariamente complejo.
3. Pensé que el sistema era fácil de usar.
4. Creo que necesitaría el apoyo de un técnico para poder usar este sistema.
5. Encontré que las diversas funciones del sistema estaban bien integradas.
6. Pensé que había demasiada inconsistencia en este sistema.
7. Imagino que la mayoría de las personas aprenderían a usar este sistema muy rápidamente.
8. Encontré el sistema muy incómodo de usar.
9. Me sentí muy seguro/a usando el sistema.
10. Necesité aprender muchas cosas antes de poder continuar con el sistema.

**Puntaje.** Para cada ítem impar, resta 1 a la respuesta; para cada par, resta la respuesta a 5. Suma los diez valores y multiplica por 2,5 (resultado de 0 a 100). Por convención, 68 es el promedio de referencia de la literatura; es una comparación orientativa, no una norma. Con 5 a 8 personas se reporta el promedio **y** el rango, y se aclara que la muestra es pequeña.

### C. Preguntas propias (escala 1 a 5, igual que SUS)

1. La aplicación entendió lo que le escribí sin que tuviera que reorganizarlo yo.
2. Revisar lo que la aplicación proponía antes de guardarlo me dio tranquilidad.
3. Usar la aplicación me costó menos esfuerzo que organizar mis pendientes como lo hago hoy.
4. Después de usarla, sé qué me conviene hacer primero.
5. Seguiría usándola si estuviera disponible.

### D. Entrevista (abiertas)

1. ¿Qué fue lo más fácil? ¿Y lo más confuso?
2. ¿Hubo un momento en que no supiste qué hacer? ¿Cuál?
3. ¿Qué te faltó?
4. ¿Qué cambiarías primero?
5. ¿Se lo recomendarías a un compañero? ¿Por qué?

## 7. Hoja de registro (una por participante)

```
Código: P__    Fecha: __/__/____    Dispositivo: ________    Navegador: ________

Tarea | Éxito / Con ayuda / Fracaso | Tiempo (min:s) | Errores | Observaciones
  1   |                             |                |         |
  2   |                             |                |         |
  3   |                             |                |         |
  4   |                             |                |         |
  5   |                             |                |         |
  6   |                             |                |         |
  7   |                             |                |         |

SUS (1..10): __ __ __ __ __ __ __ __ __ __     Puntaje: ___
Propias (1..5): __ __ __ __ __
Citas textuales y problemas:
```

Usa códigos (P1, P2…), nunca nombres.

## 8. Ética y datos

- **Consentimiento informado, por escrito o verbal registrado:** qué se hace, que es voluntario, que puede parar cuando quiera y que no se evalúa a la persona.
- **No se piden datos reales.** El participante puede usar un correo cualquiera y ejemplos inventados; la captura o el `.ics` son de ejemplo.
- **Qué se guarda:** la hoja de registro con código, y la grabación solo si aceptó. Nada que identifique a la persona.
- **Al terminar,** se borran las cuentas de prueba de la base (solo las de los participantes) y las grabaciones, tras extraer lo necesario.
- Si la universidad exige un comité de ética o un formato de consentimiento propio, **ese formato prevalece** sobre este.

## 9. Análisis y cómo reportarlo

1. **Tareas:** tabla de éxito, con ayuda y fracaso por tarea, con tiempo promedio. Una tarea con menos de 80 % de éxito sin ayuda es un hallazgo de usabilidad.
2. **SUS y preguntas propias:** promedio y rango, con n.
3. **Problemas:** lista priorizada por severidad (bloquea la tarea / confunde pero se resuelve / cosmético) y por cuántos participantes lo sufrieron. Cada hallazgo se marca como «corregido», «documentado» o «descartado», con la razón.
4. **Redacción honesta:** «con una muestra de n estudiantes, X de Y completaron la tarea sin ayuda y el puntaje SUS fue Z». No afirmar que mejora notas, reduce estrés o aumenta el rendimiento: no se midió.
5. **Limitaciones** a declarar: muestra pequeña y no aleatoria, una sola sesión (no mide uso sostenido), participantes que conocen al autor.

## 10. Ronda de corrección (opcional, recomendable)

Tras la primera tanda de 3 a 5 participantes, corrige los problemas bloqueantes y repite con 2 o 3 personas nuevas. Reportar «antes» y «después» es una evidencia más fuerte que una sola medición.
