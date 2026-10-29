# Academic Planner 1.1.0 — notas de la versión

**`v1.1.0` es la versión del proyecto universitario que incluye todo lo hecho después de [`v1.0.0`](release-notes-1.0.0.md):** el pulido visual con el Pixel Companion, una captura más inteligente, un selector de fecha propio con meses y años, la lectura de tablas con bordes negros en la importación de horario y la documentación para presentar el trabajo. Sigue siendo una **beta cerrada**, no una certificación para producción pública: no existe un alojamiento persistente (HTTPS real solo se validó de forma temporal), la QA en dispositivos físicos fue declarada por el mantenedor con evidencia formal incompleta, **no hay licencia** (decisión del mantenedor; no existe `LICENSE`) y **no se hizo una prueba con estudiantes**.

> **El tag `v1.1.0` (anotado, inmutable) se crea sobre `main`, en el merge del PR que introduce estas notas, solo con la autorización expresa del mantenedor.** Hasta entonces esta versión no está publicada. `v1.0.0` y las versiones anteriores no se tocan.

## Qué cambia respecto a v1.0.0

34 commits y 10 PR (#77 a #86). **Sin migraciones nuevas (siguen siendo 15), sin dependencias nuevas ni actualizadas** (`package.json` y `package-lock.json` solo cambian de versión) y sin cambios de endpoints.

| PR      | Qué trae                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #77     | Documentación: registro del tag y del release `v1.0.0`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| #78–#80 | **Pixel Companion C1–C3.** El personaje tiene vida propia (C1), te acompaña por la app (C2) y se aplica un pulido estético a toda la aplicación (C3): iconos de píxeles, escenas para los estados vacíos, diálogos, tarjetas, Inicio de sesión y Registro con la misma identidad, panel de recordatorios nuevo y una tarjeta de logro con el compañero celebrando al completar una actividad. Solo presentación; las reglas no cambian.                                                                                                                                                     |
| #81     | **Icono de la app** con el compañero (C4): iconos de la PWA y favicon nuevos, con los mismos colores del manifest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| #82     | **Captura más inteligente (C5).** Entiende días anunciados primero y descritos después («tengo dos actividades, una el martes y otra el jueves; la del martes es sobre redes…»), plazos relativos («en dos semanas», «en 3 días»), listas de la próxima semana, correcciones («se cambió para el viernes en vez del jueves»), frases de oídas («el profe dijo que…») y más palabras de actividad (práctica, laboratorio, informe…). Sigue siendo determinista: **sin IA**, y nada se guarda sin que el estudiante revise y confirme. Detalle: [capture-proposals.md](capture-proposals.md). |
| #83     | **Selector de fecha propio con cuadrículas.** Tocar el mes abre los 12 meses y tocar el año abre una cuadrícula de años; es el componente de todos los campos de fecha.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| #84     | **Teclado en esas cuadrículas** (el foco entra y las flechas, Inicio y Fin se mueven) y la [evaluación funcional por un experto](expert-evaluation.md) con el protocolo opcional de [prueba con usuarios](user-validation.md).                                                                                                                                                                                                                                                                                                                                                              |
| #85     | **Esqueleto de la [memoria del trabajo de grado](memoria-tesis.md)** con capturas de pantalla de la cuenta de demostración.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| #86     | **Importación de horario con tablas de bordes negros gruesos:** antes daban 0 clases; ahora las líneas largas y delgadas se borran antes del OCR. Más los documentos de estado al día. Detalle: [schedule-import.md](schedule-import.md#líneas-de-tabla).                                                                                                                                                                                                                                                                                                                                   |

## Requisitos y cómo ejecutarlo

Node.js ≥ 22.18 (probado con 24.19), npm ≥ 10, Docker Desktop (PostgreSQL 17, puerto del host 5433) y un navegador moderno.

```bash
git clone https://github.com/Maicolfelix/academic-planner.git && cd academic-planner && git checkout v1.1.0
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:up
npm run db:deploy
npm run dev                 # http://localhost:5173
```

Demostración (solo desarrollo): `npm run db:seed:demo -- --allow-demo` ([demo.md](demo.md)). Producción local de prueba: [deployment.md](deployment.md).

## Validación realizada (2026-10-29, sobre `main` antes de la versión)

«Validado mediante pruebas automatizadas y de navegador» no equivale a «sin errores».

- **Vitest: 3734** (core 1419, API 1586, web 729). Lint, tipos, formato y revisión de enlaces de la documentación en verde.
- **Playwright, suite completa** (Edge, 4 trabajadores, 56 minutos): **918 registradas, 891 pasan, 12 fallan y 15 se omiten a propósito.** Las 12 fallan por **timeouts de 30 s bajo carga** (10) o por una aserción (2: `companion-roams` y `onboarding-study`, la segunda solo en la pantalla de teléfono), y **pasan las 12 al correrlas solas** con un trabajador. **No** se repitió el resultado limpio de RG-3 (877/0 sobre `4253a78`): no se investigó la causa de fondo de esos timeouts y no se descarta que parte venga de cambios de esta versión.
- **PWA sobre HTTPS real** (túnel temporal de Cloudflare con una base desechable): humo `--full` **36 pasan, 0 fallan, 0 n/a**; cookie `__Host-` con `Secure`, `HttpOnly` y `SameSite=Lax`, HSTS y CSP; service worker activo con 38 recursos precacheados; el navegador solo rechaza la instalación por `in-incognito` (el modo de la automatización); sin conexión la app abre, avisa y no muestra datos. 60 pruebas de PWA y de compartir hacia la app pasan en Edge. El aviso de actualización se comprobó con una versión vieja y una nueva.
- **Instalación en teléfonos y Share Target:** probados por el mantenedor, sin evidencia formal (sin capturas, modelos ni versiones).
- **Evaluación funcional por un experto:** [expert-evaluation.md](expert-evaluation.md) (9 funciones; **no** es una prueba con usuarios).

## Seguridad conocida

Sin cambios de superficie: ninguna ruta nueva y ninguna dependencia nueva. **`npm audit --omit=dev` = 0.** `npm audit` reporta 4 hallazgos de severidad baja, solo de desarrollo (GHSA-gcqx-w48m-w2h4, `deepmerge` vía `vite-plugin-pwa`), aceptados por el mantenedor y sin `--force` ([limitations.md](limitations.md)). No es una prueba de penetración ni una garantía ([security.md](security.md)).

## Limitaciones conocidas

Las de [limitations.md](limitations.md). En particular:

- **Sin alojamiento persistente**; HTTPS y proxy validados solo de forma temporal.
- **Sin prueba con estudiantes** y sin licencia.
- **El OCR** se probó con imágenes sintéticas, no con horarios reales de universidades; una celda puede salir con ruido y por eso la revisión es obligatoria.
- **`npm run dev`:** la primera petición tras arrancar puede responder 502 porque `node --watch` reinicia la API; no se resolvió y queda documentado con una alternativa ([development.md](development.md)). No afecta a producción.
- Límites de frecuencia en memoria (una sola instancia); el registro revela si un correo ya existe; sin verificación de correo, recuperación de contraseña ni MFA.

## Fuera de alcance de esta versión

Un alojamiento persistente, la decisión de licencia, la evidencia formal de la QA en dispositivos, la prueba con estudiantes y cualquier función nueva.
