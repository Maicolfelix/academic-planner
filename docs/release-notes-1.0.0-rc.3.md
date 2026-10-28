# Academic Planner 1.0.0-rc.3 — notas de la versión

**Release Candidate 3.** Candidato para la **beta cerrada** de `v1.0.0` y para entrega y evaluación académica. **No es una certificación para producción pública**: no existe un alojamiento persistente (HTTPS y proxy reales se validaron de forma **temporal**) y la QA en dispositivos físicos es una declaración del mantenedor sin evidencia formal. Tag: `v1.0.0-rc.3`, que se crea **después** de fusionar el PR de este candidato, desde `main` y con autorización (hasta entonces el tag no existe). `v1.0.0` **no** existe.

## Qué cambia respecto a rc.2

rc.2 corrigió un defecto de la importación de horario. Desde entonces se ejecutó el ciclo de producto post-RC y el release gate. En cifras, desde `v1.0.0-rc.2`: **230 commits** en `main` y **9 migraciones nuevas** (15 en total). El detalle por etapa está en el [CHANGELOG](../CHANGELOG.md) y en [project-state.md](project-state.md); aquí, el resumen:

- **Perfil educativo y onboarding** (P0): perfil separado del usuario, nivel de estudio por periodo, contexto educativo de la asignatura y un asistente de registro de una pregunta por pantalla, siempre omitible.
- **Varios estudios** (P0.5): `StudyTrack`, periodos que pertenecen a un estudio, resumen global de todos los periodos actuales y «Mis estudios».
- **Notas** (B1–B3 y lectura en Radar y Progreso): escala por periodo, cortes por materia, notas con aritmética exacta, Captura inteligente de notas y contexto de nota en el Radar y el Progreso (informativo, sin cambiar el orden del Radar).
- **Captura inteligente** (F1): actividades sin asignatura, creación inline de asignatura, captura múltiple con confirmación en lote, recurrencia semanal, borradores persistentes y agenda unificada.
- **Entradas nuevas:** importación de horario que crea las asignaturas faltantes (A1), importador universal `.ics` (A2), «Añadir al calendario» por actividad (A4.1) y compartir texto hacia la Captura rápida desde Android (A5, Web Share Target).
- **Experiencia y diseño** (UX1, P8, P9): identidad visual «Pulso Ambiental», navegación inferior, formularios y diálogos nuevos, Pixel Companion v1, héroe accionable, primer uso guiado y transición de periodo comprensible.
- **Seguridad y dependencias:** guarda de cobertura de rutas, endurecimiento de texto persistido, aislamiento de bases de prueba y parches de dependencias; `npm audit` en 0.
- **Despliegue y validación** (RG-1…RG-3): configuración de producción explícita, imagen Docker, migraciones como paso aparte, humo de producción, validación desde base vacía, ensayo de respaldo y restauración y humo por HTTPS real temporal.

**RG-4 (este candidato) no añade nada de eso:** solo sube la versión a `1.0.0-rc.3` y documenta. Sin funciones nuevas, sin cambios visuales, sin migraciones y sin cambios de dependencias.

## Qué incluye

Todo lo de [rc.2](release-notes-1.0.0-rc.2.md) y [rc.1](release-notes-1.0.0-rc.1.md) (RF01–RF09 y sus extensiones) más lo anterior. Estado vigente en [project-state.md](project-state.md).

## Requisitos y cómo ejecutarlo

Node.js ≥ 22.18 (probado con 24.19), npm ≥ 10, Docker Desktop (PostgreSQL 17, puerto del host 5433) y un navegador moderno.

```bash
git clone https://github.com/Maicolfelix/academic-planner.git && cd academic-planner && git checkout v1.0.0-rc.3   # el tag existe solo después de fusionar este candidato
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up
npm run db:deploy
npm run dev                 # http://localhost:5173
```

Demostración (solo desarrollo): `npm run db:seed:demo -- --allow-demo` ([demo.md](demo.md)). Producción local de prueba y despliegue: [deployment.md](deployment.md).

## Validación realizada (RG-3, sobre `main` `4253a78`)

Resultados completos en [rg3-results.md](rg3-results.md). «Validado mediante pruebas automatizadas, de integración y de extremo a extremo» no equivale a «sin errores».

- **Vitest 3683** (core 1405, API 1578, web 700); **Playwright completo: 892 registradas, 877 pasan, 0 fallan y 15 omitidas a propósito** (`--workers=2`, Edge); seguridad de la API **273** y seguridad en navegador **9**.
- **Base vacía:** `npm run validate:fresh-db` 15/15 (15 migraciones, sin deriva inesperada, humo, OCR, reinicio y SIGTERM).
- **Respaldo y restauración** (PostgreSQL 17 local desechable, `pg_restore --exit-on-error`): recuentos e ids idénticos, relaciones y notas intactas, `db:deploy` sin cambios, salud y login contra la restaurada.
- **HTTPS temporal real** (Docker local + Cloudflare Quick Tunnel): humo `--full` **36 pasan, 0 fallan, 0 n/a**; cookie `__Host-`, `Secure`, HSTS, CSP y CORS exacto; `TRUST_PROXY=1` medido solo para esa topología; aislamiento entre usuarios, cierre de sesión, persistencia tras reiniciar y límite de intentos sin evasión por `X-Forwarded-For`.
- **Dispositivos reales:** un iPhone (Safari) y dos Android (Chrome), con PWA instalada, modo standalone, sin conexión y Share Target, **ejecutados y declarados por el mantenedor**. **Evidencia formal incompleta** (sin capturas, modelos ni versiones) y **aceptada por el mantenedor** para este proyecto: `OWNER_ACCEPTED / DECLARED_PASS`. No se probó el aviso de actualización de la PWA. Esa excepción no es un precedente.

## Seguridad conocida

Endurecimiento de seguridad con pruebas automatizadas orientadas a seguridad; **no** es una prueba de penetración ni una garantía ([security.md](security.md)).

- **`npm audit` = 0** (también con `--omit=dev`), con parches compatibles del lockfile; nunca `--force`.
- Límites de frecuencia en memoria y por proceso (v1: una sola instancia); el registro revela si un correo ya existe; sin verificación de correo, recuperación de contraseña ni MFA (no bloquean la beta cerrada; sí un servicio con registro público abierto); sesión de duración fija de 7 días.

## Limitaciones conocidas

Las de [limitations.md](limitations.md). En particular: **no hay alojamiento persistente** ni copias de un proveedor; el HTTPS y el proxy se validaron solo de forma temporal; la QA en dispositivos carece de evidencia formal; no hay QA con estudiantes; los intérpretes de texto solo entienden los fraseos previstos, en español; la importación de horario es asistida y exige revisión humana; sin notificaciones fuera de la app ni modo sin conexión para datos. Licencia pendiente (decisión del propietario).

## Pendiente antes de `v1.0.0`

Ver [final-checklist.md](final-checklist.md). `v1.0.0` solo se etiqueta si este candidato pasa el gate **sin cambios** y con autorización expresa. Fuera de alcance de este candidato: un alojamiento persistente, la decisión de licencia y cualquier función nueva.
