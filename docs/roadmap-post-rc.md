# Roadmap del ciclo post-RC

> **Estado: planificación. Nada de lo descrito aquí está implementado.** Este documento define un nuevo ciclo de producto posterior a `v1.0.0-rc.2`. El código y las pruebas siguen siendo la fuente de verdad de lo que el sistema hace hoy ([project-state.md](project-state.md), [limitations.md](limitations.md)). Cada elemento de este roadmap necesita **aprobación explícita del propietario** antes de implementarse; este documento no autoriza ninguno.

## Contexto

- El roadmap técnico original (Fases 0–20) está **cerrado**. `v1.0.0-rc.1` y `v1.0.0-rc.2` están publicados como pre-releases y son **inmutables** ([notas de rc.2](release-notes-1.0.0-rc.2.md), [rc.1](release-notes-1.0.0-rc.1.md)).
- **No existe una Fase 21.** Lo que sigue es un ciclo de producto distinto, organizado en **etapas** y **PR pequeños**, no en fases numeradas.
- Cada etapa pasa por: análisis, arquitectura, contratos, pruebas, implementación, validación y documentación, y **termina con una compuerta**: al cerrarla se detiene el trabajo y se espera aprobación explícita para la siguiente.
- Antes de explorar el repositorio se usa Graphify para ubicar módulos; después se lee el código. La fuente de verdad sigue siendo código → pruebas → documentos. `graphify-out/` es un artefacto local y no se versiona.

## Visión

> Academic Planner convierte horarios, planes de curso, calendarios y mensajes académicos en un semestre organizado, ayuda al estudiante a decidir qué hacer y le da herramientas para hacerlo.

Principios centrales:

- **Academic Planner no debe pedirle al estudiante que organice la aplicación; la aplicación debe organizar lo que el estudiante ya recibe.**
- **Organizarse no debe convertirse en otra tarea.**

**Regla de producto: cada nueva función debe eliminar más trabajo del que añade.** Si una función exige demasiada configuración manual, se cuestiona antes de implementarla. No se optimiza para «tener más funciones».

Paradigma de toda entrada de datos: **CAPTURAR → INTERPRETAR → PROPONER → CONFIRMAR.** Nunca «entrada → persistencia silenciosa».

## Los cuatro pilares

1. **Entrada casi cero.** Aprovechar lo que el estudiante ya recibe: horarios, planes de curso (syllabus), mensajes, calendarios `.ics`, contenido compartido y, eventualmente, LMS o correo.
2. **Alcance real.** Llegar al estudiante fuera de la pantalla principal. Primera estrategia: feed/exportación `.ics`. Resumen diario, push u otros canales solo si se justifican después.
3. **Decidir y hacer.** Pasar de «qué tengo» a «qué me conviene hacer» y luego a «cómo puedo hacerlo»: esfuerzo personal, huecos, bloques de estudio, Attention enriquecido y asistencia con IA.
4. **Contexto universitario.** Lo que las aplicaciones genéricas no entienden: notas, cortes, porcentajes, «cuánto necesito sacar», faltas, syllabus y horarios académicos.

## Orden aprobado

### Preparación

| Paso                | Contenido                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ |
| PR-00               | Este PR: documentación e invariantes del nuevo ciclo (sin código)                          |
| Piloto listo/spikes | Los tres spikes de [más abajo](#spikes-previos) y, para el piloto autónomo, sus requisitos |

### Etapa 0 — Validación / piloto

Descubrir qué problemas importan de verdad antes de construir mucho. Ver [Piloto controlado y autónomo](#piloto-controlado-y-autónomo). No se afirma que la aplicación mejore notas, reduzca estrés, mejore el rendimiento o aumente la retención: el software no lo ha medido.

### Etapa A — Automatización de entrada (apunta a la serie `1.1.x`)

| Id  | Objetivo                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Schedule Import crea las asignaturas faltantes al confirmar (**fusionado**, PR #18)                                                                                                |
| A4  | Integración con calendario externo: **A4.1** «Añadir al calendario» (`.ics` por actividad; implementado en su PR); **A4.2** feed sincronizado (**diferido** hasta tener evidencia) |
| A5  | Web Share Target (compartir texto desde otras aplicaciones hacia la Bandeja o Captura rápida)                                                                                      |
| A2  | Importación de un archivo `.ics`                                                                                                                                                   |
| A3  | Suscripción por URL a un calendario externo: **diferida** (ver [decisión](#decisión-ics))                                                                                          |

### Etapa B — Contexto universitario (`1.2.x`)

| Id    | Objetivo                                                                    |
| ----- | --------------------------------------------------------------------------- |
| B1/B2 | Notas por cortes/evaluaciones y «¿cuánto necesito sacar?» (aritmética pura) |
| A6    | Importación de syllabus (**después** del modelo de notas)                   |
| B4    | Faltas / asistencia (solo excepciones)                                      |
| B5    | Semana cargada, con hechos y sin juicios                                    |

### Etapa C — Planificación personal (`1.3.x`)

| Id  | Objetivo                                                                      |
| --- | ----------------------------------------------------------------------------- |
| C1  | Esfuerzo real: «¿cuánto te tomó?», opcional                                   |
| C2  | Mediana personal por tipo de actividad                                        |
| C4  | Huecos disponibles en la agenda                                               |
| C5  | Bloques de estudio propuestos (el estudiante confirma)                        |
| C6  | Factibilidad de la semana («semana realista»)                                 |
| C3  | Attention enriquecido (como anotaciones, ver [decisión](#decisión-attention)) |

### Etapa D — Asistente académico con IA (`1.4.x`)

| Id  | Objetivo                                                                        |
| --- | ------------------------------------------------------------------------------- |
| D0  | Infraestructura de IA: interfaz de proveedor, consentimiento, límites, registro |
| D1  | «Prepararme»: explicar, plan de estudio, dentro de una actividad                |
| D2  | Quiz con retroalimentación                                                      |
| D4  | Material de estudio del estudiante (`StudyResource`)                            |
| D5  | Respuestas ancladas al material, con cita de archivo y página                   |

### Etapa E — Colaboración (solo con tracción)

Cursos compartidos **solo si hay evidencia de uso**. Compartido: fechas oficiales, evaluaciones, porcentajes, horario general. Privado: notas, recordatorios, estado, bloques de estudio y estimaciones. Requiere roles, propuestas, moderación e historial: por eso es una etapa posterior. No se construye ni se anticipa en el modelo de datos.

### Prerrequisitos técnicos identificados

Surgieron del análisis del código y se decidirán al iniciar la etapa correspondiente; no forman parte del orden aprobado:

- No hay pantalla para editar el periodo (el `PATCH` de la API ya existe): importar horarios, syllabus y calendarios depende de las fechas del periodo.
- `RequireAuth` redirige a `/login` sin conservar el destino: A5 lo necesita para no perder el texto compartido si la sesión expiró.

## Decisiones clave

El detalle y el motivo de cada una están en [decisions.md](decisions.md) (D15–D22).

### Flujo de A1 (fusionado en el PR #18)

Antes de A1 el Schedule Import no creaba asignaturas: solo asignaba una clase a una asignatura existente (coincidencia exacta) y cada clase confirmada se creaba con su propio `POST /api/schedule`. El flujo implementado es:

```
Horario → interpretación → asignaturas detectadas → asignaturas faltantes propuestas
→ vista previa → confirmación → creación de Subject → creación de ScheduleBlock
```

Usa una confirmación **en lote y transaccional** (`POST /api/schedule-import/confirm`): crea las asignaturas y los bloques en una sola transacción, con las mismas reglas de los servicios existentes. Detalle y decisiones: [schedule-import.md](schedule-import.md), D16 en [decisions.md](decisions.md).

### Syllabus después del modelo de notas

El syllabus puede detectar porcentajes, pero hoy **no existe** una estructura donde persistirlos. Por eso: B1/B2 primero, A6 después.

### Decisión: ICS

- **Actualización (A4-0b, A4.1):** la comparación con los RFC ([normative-validation.md](spikes/a4-calendar-feed/normative-validation.md)) concluyó que el feed **aún no está justificado** frente a «Añadir al calendario»: depende por completo del refresco del cliente (horas, sin control del estudiante), exige token, ruta pública y migración, y nadie ha pedido que se actualice solo. Por eso A4 se divide: **A4.1 «Añadir al calendario»** (un `.ics` por actividad, con sesión, sin token ni migración; [calendar-export.md](calendar-export.md)) y **A4.2 feed sincronizado, diferido** hasta que estudiantes reales lo pidan y clientes reales muestren un refresco aceptable. A4.2 reutilizaría el serializador de A4.1.
- **Feed `.ics` (A4.2, diferido):** entregaría alcance sin scheduler, sin riesgo SSRF y sin guardar credenciales de un LMS. Token de alta entropía (solo se guardaría su hash), revocable y regenerable; quien tenga la URL puede leer el calendario, y así se avisa al usuario.
- **Importación manual de archivo `.ics` después:** estructura información sin conexión externa.
- **Suscripción por URL diferida:** riesgos de SSRF, tokens de LMS dentro de las URL, redirects, DNS rebinding y necesidad de cifrado en reposo. **No se implementa A3 ahora.**
- **Notificaciones:** el feed _permite integrar eventos con calendarios externos; el comportamiento de las notificaciones depende del cliente._ No se promete que el feed garantice notificaciones. Google Calendar, Apple Calendar y Outlook deben validarse con un spike real antes de prometer comportamiento alguno (refresco, alarmas, experiencia móvil).

### Decisión: asistencia

Registrar **solo excepciones** (`ABSENT`, `CANCELLED`) sobre las ocurrencias que ya expande la agenda; no se obliga a marcar «asistí» en cada clase. El límite de faltas es configurable por asignatura: no se asume ningún porcentaje universal. Lenguaje matemático, no disciplinario.

### Decisión: Attention

**No se repondera el puntaje actual** con esfuerzo. Cuando llegue la Etapa C, el esfuerzo estimado y el tiempo disponible entran primero como anotaciones, indicador de riesgo y desempate **dentro del mismo tier**, para no romper la propiedad vigente del puntaje (un tier más urgente siempre gana) sin evidencia.

### Decisión: IA

**IA asistiva, no autoridad del sistema.** Puede explicar, resumir, generar preguntas, dar retroalimentación y proponer planes. **No** modifica en silencio fechas, notas, porcentajes, estado, agenda, recordatorios ni la persistencia: lo crítico lo calcula y guarda el código determinista tras la confirmación del estudiante.

- **IA opcional:** el sistema completo debe funcionar sin proveedor. Con `AI_PROVIDER` sin definir, la IA queda desactivada. (Solo se documenta: no hay variables ni código todavía.)
- Las claves viven solo en el backend; el frontend nunca habla con el proveedor. Consentimiento explícito y minimización de datos; el material subido se trata como datos, no como instrucciones; las salidas estructuradas se validan con esquemas; límites de uso y coste.

### Decisión: RAG

Si algún día se implementa: **primero búsqueda de texto completo de PostgreSQL**, sin `pgvector`. Solo se evaluarán vectores si datos reales demuestran un recall insuficiente.

### Decisión: privacidad

Antes de un piloto con datos reales harán falta **aviso, autorización y revisión independiente**. Existirá un documento de privacidad cuando haya contenido revisado; **no se redacta una política legal ficticia** y no se afirma cumplimiento de ninguna norma (p. ej. Ley 1581): requiere revisión independiente. La IA cambia la premisa actual de «todo se procesa localmente» (D4, D8): cada etapa debe actualizar esa documentación.

## Piloto controlado y autónomo

**Piloto controlado.** Puede hacerse con acompañamiento manual (el equipo presente o remoto, datos cargados y observados en vivo). No requiere todavía telemetría completa. Permite observar el onboarding, registrar fricción, recopilar fixtures anonimizados y entrevistar.

**Piloto autónomo** (los estudiantes usan la aplicación por su cuenta durante semanas). Requiere:

- despliegue con HTTPS (también necesario para instalar la PWA, la cookie `__Host-` y el Share Target);
- restablecimiento de contraseña (en un piloto cerrado puede ser una operación del administrador);
- medición mínima (cómo se creó cada actividad, retención por día) sin guardar contenido;
- privacidad (aviso, autorización, revisión independiente).

Métricas a observar (sin afirmar que ya se cumplen): tiempo de registro a «mi semestre está organizado» (meta deseable: menos de 10 minutos), porcentaje de actividades por método de captura (manual, Captura rápida, Bandeja, importación de horario, futuros syllabus y `.ics`), retención en los días 1, 3, 7 y 14, y fallos reales (horarios, syllabus, frases y formatos que fallan, convertidos en fixtures anonimizados). Entrevistas: qué dio pereza, qué se ingresó a mano, qué se usaba antes, qué función se usó o se ignoró, qué hizo volver o abandonar, qué información debería aparecer sola.

## Spikes previos

Tres investigaciones de bajo costo, antes de construir producto:

1. **Calendarios.** Google Calendar, Apple Calendar y Outlook: importación y suscripción, latencia de refresco, `VALARM` y experiencia móvil. Protocolo, fixtures y estado (A4-0 y A4-0b; Google/Apple/Outlook sin probar en clientes reales): [docs/spikes/a4-calendar-feed](spikes/a4-calendar-feed/README.md). Lo implementado (A4.1): [calendar-export.md](calendar-export.md).
2. **Datos reales.** Recolectar, anonimizados, ~10 horarios, ~10 syllabus y ~5 archivos `.ics` como línea base. **No se agregan al repositorio sin anonimización explícita.**
3. **Notas.** Probar «¿cuánto necesito sacar?» con 3 estudiantes en una hoja de cálculo o prototipo; preguntar escala, cortes, pesos y reglas de redondeo.

## Cálculo de notas: ejemplo aprobado

La aritmética es determinista (nunca IA). Farmacología: corte 1 = 30 % con 3.4, corte 2 = 30 % con 2.8, corte 3 = 40 % pendiente.

- Acumulado: 0.30 × 3.4 + 0.30 × 2.8 = 1.86.
- **Objetivo 3.0:** (3.0 − 1.86) / 0.40 = **2.85** necesario en el corte restante.
- **Objetivo 4.5:** (4.5 − 1.86) / 0.40 = **6.6**, **imposible** si la escala máxima es 5.0.

**Decisión pendiente:** reglas institucionales de redondeo, escala y nota mínima. La escala sale de la configuración, no del código; los ejemplos con 0.0–5.0 son ilustrativos y no se documentan como universales.

## Modelo de datos futuro

**PROPOSED — NOT IMPLEMENTED.** Propuesta para discutir al iniciar cada etapa; no hay migraciones ni cambios en el schema de Prisma. Los nombres y la forma final se deciden tras revisar el modelo vigente ([data-model.md](data-model.md)).

| Entidad o campo                                    | Etapa | Propósito propuesto                                                      |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| `Activity.createdVia`                              | 0     | Método de captura de cada actividad (sin contenido)                      |
| `UserActivityDay`                                  | 0     | Días con actividad por usuario, para retención                           |
| `CalendarFeed`                                     | A     | Token del feed (solo su hash), creación y revocación                     |
| `Activity.externalUid`                             | A     | Evitar duplicados al reimportar un `.ics`                                |
| `GradingComponent`                                 | B     | Cortes y evaluaciones con peso y nota                                    |
| `AcademicPeriod.gradeMin`, `gradeMax`, `gradePass` | B     | Escala de notas configurable                                             |
| `Subject.absenceLimitPercent`                      | B     | Límite de faltas configurable                                            |
| `OccurrenceMark`                                   | B     | Excepciones (`ABSENT`, `CANCELLED`) por clase y fecha                    |
| `Activity.actualMinutes`                           | C     | Tiempo real que tomó una actividad                                       |
| `Activity.estimatedMinutes`                        | C     | Estimación manual opcional (decisión pendiente, ver riesgos de arranque) |
| `User.dayStart`, `User.dayEnd`                     | C     | Ventana diaria para calcular huecos                                      |
| `ScheduleBlock.activityId`                         | C     | Vincular un bloque de estudio con su actividad                           |
| `AiConsent`, `AiUsage`                             | D     | Consentimiento y uso (latencia, tokens), sin contenido                   |
| `StudyResource`, `ResourceChunk`                   | D     | Material del estudiante y sus fragmentos para búsqueda                   |

## Seguridad y privacidad por integración

No se relaja ningún control vigente (CSRF, esquemas estrictos, propiedad con el mismo 404, `no-store`, CSP, sesiones seguras, `NetworkOnly` del service worker, límites de subida). Cada integración suma riesgos que se evalúan en su etapa: SSRF para URL de calendario, privacidad, coste e inyección de prompt para IA, agotamiento de recursos en subidas, autorización en cursos compartidos y token no adivinable en el feed. Antes de un despliegue público abierto: política de privacidad, consentimiento, retención, eliminación de cuenta, aviso del procesamiento con IA y recuperación de contraseña.

## Versionado

`v1.0.0-rc.1` y `v1.0.0-rc.2` no se modifican ni se mueven. Propuesta indicativa (**decide el mantenedor en cada caso**): serie `1.1.x` para la Etapa A, `1.2.x` para la B, `1.3.x` para la C y `1.4.x` para la D, con candidatos previos. Un tag solo se crea tras fusionar y validar `main`. PR-00 no cambia ninguna versión.

## Qué no construir todavía

Suscripción por URL (A3), push, resumen diario por correo o SMS, `pgvector`, DOCX, voz, streaming, cursos compartidos, predicciones de notas o «porcentaje de preparación», integraciones por API con un LMS, lectura de correo, un chat de IA genérico, cronómetros, aprendizaje de hábitos más allá de la mediana y gamificación.

## Riesgos de alcance

Tratar este roadmap como un plan único (cada etapa tiene su compuerta y se detiene); añadir «un campo más» sin pasar la regla de producto; ampliar parsers sin fixtures reales; reponderar Attention por impulso; usar IA para tapar lo que un parser no resuelve (entraría detrás del mismo contrato de propuesta, no en su lugar); infraestructura prematura (scheduler, correo, vectores); y bajar la guardia en seguridad por velocidad.
