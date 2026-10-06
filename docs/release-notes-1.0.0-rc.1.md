# Academic Planner 1.0.0-rc.1 — notas de la versión

**Release Candidate 1.** Candidato para entrega y evaluación académica. **No es una certificación para producción pública**: faltan validaciones externas descritas más abajo. Tag propuesto: `v1.0.0-rc.1` (se crea **después** de fusionar el PR; ver [release-manifest.md](release-manifest.md)). Evidencia de validación: [release-validation.md](release-validation.md).

## Qué es

Academic Planner es una aplicación web progresiva (PWA) para **organizar asignaturas, actividades, agenda y progreso académico** de un estudiante universitario. Busca facilitar la planificación: centraliza la información, calcula qué requiere atención primero y reduce los pasos operativos para registrar compromisos. Todo el procesamiento ocurre en el servidor de la aplicación, sin IA generativa ni servicios de terceros. Principio de diseño: «Organizarse no debe convertirse en otra tarea.»

Este candidato **congela las funcionalidades** (_feature freeze_): no añade funciones; valida, documenta y empaqueta lo construido en las Fases 1–19. El software no ha medido efectos sobre el rendimiento ni el bienestar académico; las pruebas demuestran que **funciona como se describe**.

## Qué incluye

**Alcance original (RF01–RF09)** — evidencia en [requirements.md](requirements.md):

- Autenticación (registro, inicio y cierre de sesión), asignaturas y actividades, filtros, agenda con aviso de solapes, recordatorios internos, seguimiento del progreso, aislamiento de datos por usuario y PWA instalable.

**Extensiones desarrolladas** (no eran requisitos originales):

- Radar académico, «¿Qué hago ahora?», carga semanal, Captura rápida, Bandeja académica e Importación de horario (OCR local).
- Datos de demostración reproducibles.

**Calidad:** accesibilidad evaluada con axe y pruebas de teclado; endurecimiento de seguridad con pruebas automatizadas; validación de extremo a extremo de un semestre completo; documentación final con verificador (`npm run docs:check`).

### Fuera de alcance (a propósito)

Sin sincronización con calendarios externos, sin notificaciones push/correo/SMS, sin IA generativa, sin aplicación nativa, sin modo sin conexión para datos (el shell abre sin red; los datos requieren conexión), sin verificación de correo, recuperación de contraseña ni MFA.

## Requisitos

- Node.js ≥ 22.18 (probado con 24.19) y npm ≥ 10.
- Docker Desktop (PostgreSQL 17 con Docker Compose; puerto del host 5433) o un PostgreSQL 17 propio.
- Navegador moderno (probado con Chromium/Edge). Red solo para `npm ci`; en ejecución la aplicación solo necesita el servidor y PostgreSQL.

## Cómo ejecutarlo

```bash
git clone <repositorio> && cd academic-planner
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up
npm run db:deploy
npm run dev                 # http://localhost:5173
```

Producción local de prueba (la API sirve la app en el mismo origen): [deployment.md](deployment.md). Guía de desarrollo y problemas comunes: [development.md](development.md).

### Demostración

```bash
npm run db:seed:demo -- --allow-demo     # estudiante ficticio con un semestre completo (solo desarrollo)
```

Credenciales sintéticas y recorrido de presentación en [demo.md](demo.md). La cuenta demo no debe existir en un despliegue público; el comando se niega con `NODE_ENV=production`.

## Pruebas realizadas

Cifras exactas, comandos y commit en [release-validation.md](release-validation.md). En resumen: lint, formato, tipos, build, 1585 pruebas Vitest (núcleo, API con PostgreSQL real, interfaz), 258 ejecuciones de Playwright por pasada a 360 y 1366 px (254 pasan y 4 se omiten a propósito) repetidas **cinco veces consecutivas** sobre el mismo commit, seguridad (API y navegador) y escaneo de secretos, axe y teclado, validación de instalación desde cero, arranque tipo producción y recorrido manual con los datos de demostración. «Validado mediante pruebas automatizadas, de integración y de extremo a extremo» no equivale a «sin errores».

## Seguridad conocida

Se realizó un **endurecimiento de seguridad** con pruebas automatizadas orientadas a seguridad; **no** es una prueba de penetración ni una garantía. Detalle y controles: [security.md](security.md). Riesgos aceptados en este candidato:

- `npm audit`: **4 vulnerabilidades altas** en la cadena del CLI de Prisma (`@prisma/config` → `deepmerge-ts`, y `mysql2`); no alcanzables en tiempo de ejecución según el análisis actual. No existe una versión estable posterior de Prisma que las corrija (`latest` es `8.0.0-rc.20`, un candidato). No se usa `npm audit fix --force`.
- Límites de frecuencia **en memoria y por proceso** (una sola instancia).
- El registro revela si un correo ya existe.
- Sin verificación de correo, recuperación de contraseña ni MFA; sesión de duración fija de 7 días.

## Limitaciones conocidas

Lista completa en [limitations.md](limitations.md). Las principales:

- **Dispositivos móviles reales (iOS y Android) sin probar.** Lo medido es emulación a 360, 768 y 1366 px.
- **HTTPS y proxy inverso reales sin validar**, y sin despliegue real.
- La interfaz no gestiona el periodo ni la zona horaria después del onboarding.
- La importación de horario es **asistida**: el OCR puede equivocarse y exige revisar la vista previa.
- Captura rápida y Bandeja académica solo entienden los fraseos previstos, en español.
- Medidas de rendimiento: **pruebas de humo en una máquina de desarrollo**, no pruebas de carga ni un SLA.
- Accesibilidad: evaluada con herramientas y teclado; **no está certificada**.
- `MaxListenersExceededWarning` en las pruebas de API (ruido de `supertest`; no afecta al producto).
- El repositorio **no incluye archivo de licencia** (decisión pendiente del propietario).

## Pendiente antes de una versión final

Ver [final-checklist.md](final-checklist.md). Sin marcar a propósito: pruebas en iOS y Android físicos; validación de HTTPS y proxy reales y despliegue de prueba; actualización de Prisma cuando exista una versión estable que corrija la cadena del CLI; decisión de licencia; prueba de carga si se espera uso concurrente; almacén compartido de límites si hay más de una instancia; verificación de correo, recuperación de contraseña y MFA si el servicio será público. Un `v1.0.0` final **no** forma parte de este candidato.

## Registro de hallazgos del candidato

Ver [release-validation.md](release-validation.md#registro-de-hallazgos): sin BLOCKER ni HIGH abiertos al aprobar este candidato.
