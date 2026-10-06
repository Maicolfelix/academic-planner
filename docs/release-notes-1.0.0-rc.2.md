# Academic Planner 1.0.0-rc.2 — notas de la versión

**Release Candidate 2.** Candidato para entrega y evaluación académica. **No es una certificación para producción pública**: dispositivos móviles reales y un despliegue real con HTTPS y proxy siguen sin validar. Tag: `v1.0.0-rc.2`, sobre el commit de `main` que resulta de fusionar el PR de este candidato (el SHA se asigna al fusionar). Esta versión **reemplaza a `1.0.0-rc.1`**, que no se modifica ni se mueve ([notas de rc.1](release-notes-1.0.0-rc.1.md)).

## Qué cambia respecto a rc.1

Es una **corrección de un solo defecto** en la importación de horario; no hay funciones nuevas (la congelación de funcionalidades continúa).

### Importación de horario: rangos compactos y ruido de escala

Al probar con un calendario visual real, un bloque como `1900-2030 ZISXA-Proyectos II REMOTO Proyecto` salía con inicio 12:00 y sin hora de fin, y la escala de horas del calendario (`1pm 2pm 3pm …`) aparecía como una clase falsa. El OCR **sí** leía los rangos; fallaba el intérprete. Ahora:

- Reconoce rangos compactos de 24 horas `HHMM-HHMM` (`1900-2030` → 19:00–20:30, `1400-1615`, `0800-0930`, `900-1030`) con guion, raya corta, raya larga o signo menos. Es conservador: no toma por horas `2560-2700`, `1965-2030`, años (`2019-2024`) ni aulas (`207-215`).
- Un rango válido tiene prioridad: las demás horas sueltas del bloque no lo reemplazan ni quedan en el título, y «Texto leído» ya no incluye la etiqueta de la escala.
- Descarta como escala del calendario el texto con cuatro o más horas aisladas y ninguna palabra de tres letras o más (también con deslices del OCR como `lpm`). Un título con números (`Proyecto 2`) no se ve afectado.

Con el mismo calendario sintético y OCR real: antes, miércoles 16:00 sin fin y sábado 12:00–16:00; ahora, miércoles 19:00–20:30 y sábado 14:00–16:15, exactamente 2 clases. No cambia el OCR, la coincidencia de asignaturas (sigue sin asignarse nada que no sea una coincidencia exacta; lo dudoso se pregunta), las reglas de negocio ni la interfaz. Detalle: [schedule-import.md](schedule-import.md).

El importador sigue siendo **asistido**: el OCR puede equivocarse (p. ej. leyó `A707` por `A207`, y la tarjeta conserva su aviso de poca claridad), un número de aula puede quedar al final del título y la revisión humana de la vista previa sigue siendo obligatoria.

## Qué incluye

Todo lo de [rc.1](release-notes-1.0.0-rc.1.md): RF01–RF09 (autenticación, asignaturas, actividades, filtros, agenda con aviso de solapes, recordatorios internos, progreso, aislamiento por usuario y PWA instalable) y las extensiones (Radar académico, «¿Qué hago ahora?», carga semanal, Captura rápida, Bandeja académica e Importación de horario con OCR local), más los datos de demostración y la documentación final. Sin IA generativa ni servicios de terceros.

## Requisitos y cómo ejecutarlo

Node.js ≥ 22.18 (probado con 24.19), npm ≥ 10, Docker Desktop (PostgreSQL 17, puerto del host 5433) y un navegador moderno.

```bash
git clone https://github.com/Maicolfelix/academic-planner.git && cd academic-planner && git checkout v1.0.0-rc.2
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up
npm run db:deploy
npm run dev                 # http://localhost:5173
```

Demostración (solo desarrollo): `npm run db:seed:demo -- --allow-demo` ([demo.md](demo.md)). Producción local de prueba: [deployment.md](deployment.md).

## Pruebas realizadas para esta corrección

- **Pruebas nuevas:** +29 unitarias (rangos compactos y sus rechazos, prioridad del rango, escala, título con número, las cadenas exactas del caso real), +4 de integración con OCR real y +1 de navegador (360 y 1366 px). Se hicieron _mutation checks_ de las tres reglas nuevas y se revirtieron.
- **Totales:** Vitest **1618** (core 795, API 786, web 37); Playwright **260** por pasada (256 pasan, 4 omitidas a propósito); seguridad de la API 155 y seguridad en navegador 9.
- **Tres pasadas completas consecutivas** de Playwright sobre el commit de la corrección (256 pasan, 0 fallan, 0 `ERR_CONNECTION_REFUSED`), y validación posterior a la fusión sobre `main` (lint, formato, tipos, build, `docs:check`, `security:scan` y `test:security` en verde).
- Reproducción por la interfaz real a 1366 y 360 px con un calendario sintético equivalente al caso reportado.

«Validado mediante pruebas automatizadas, de integración y de extremo a extremo» no equivale a «sin errores».

## Seguridad conocida

Endurecimiento de seguridad con pruebas automatizadas orientadas a seguridad; **no** es una prueba de penetración ni una garantía ([security.md](security.md)).

- **`npm audit` = 6 (4 altas + 2 críticas).** Las 4 altas son las de siempre, de la cadena del CLI de Prisma (`@prisma/config` → `deepmerge-ts`, y `mysql2`), y siguen apareciendo con `npm audit --omit=dev`; no hay una versión estable posterior de Prisma que las corrija. Las **2 críticas son nuevas desde rc.1**: la base de avisos de npm añadió `shell-quote` (vía `concurrently`), una herramienta **solo de desarrollo** usada por los scripts `dev` y `dev:e2e` con comandos fijos, que no se instala con `--omit=dev`. No hubo cambios de dependencias en esta versión y no se usó `npm audit fix --force`.
- Límites de frecuencia en memoria y por proceso; el registro revela si un correo ya existe; sin verificación de correo, recuperación de contraseña ni MFA; sesión de duración fija de 7 días.

## Limitaciones conocidas

Las de rc.1 siguen vigentes ([limitations.md](limitations.md)): iOS y Android físicos sin probar; HTTPS y proxy reales sin validar y sin despliegue; la interfaz no gestiona el periodo ni la zona horaria tras el onboarding; los intérpretes de texto solo entienden los fraseos previstos, en español; humo de rendimiento solo en una máquina de desarrollo; accesibilidad evaluada con herramientas y teclado, **no certificada**; `MaxListenersExceededWarning` en las pruebas de API (ruido de `supertest`); y el repositorio **no incluye archivo de licencia** (decisión pendiente del propietario).

## Pendiente antes de una versión final

Ver [final-checklist.md](final-checklist.md): pruebas en iOS y Android físicos, validación de HTTPS y proxy reales y un despliegue de prueba, actualizar Prisma cuando exista una versión estable que corrija la cadena del CLI (y revisar el aviso de `shell-quote`), decisión de licencia, prueba de carga si se espera uso concurrente, y almacén compartido de límites si hay más de una instancia. Un `v1.0.0` final **no** forma parte de este candidato.
