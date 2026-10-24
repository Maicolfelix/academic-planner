# Auditoría técnica de preparación para release (octubre 2026)

> Solo **auditoría**: no se implementó nada, no se publicó nada y **no se afirma** validación real de HTTPS, instalación de la PWA, Android, Google Calendar, Outlook, App Store ni producción. Base: `main` en `e76cdfa` (sin el PR #46). Estados: `READY` (verificado en código/pruebas locales), `NOT_READY`, `NEEDS_OWNER` (decisión del mantenedor), `NEEDS_REAL_DEVICE` (solo se valida en un dispositivo/servidor real).

| Área                                                | Estado                             | Evidencia / hallazgo                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build de producción                                 | READY                              | `npm run build` limpio; `dist` sin _source maps_ (0 `.map`); `index.html`, `manifest.webmanifest`, `sw.js`, iconos 192/512/maskable y `apple-touch-icon`.                                |
| Manifiesto PWA                                      | READY (estructura)                 | `display: standalone`, `scope: /`, `start_url: /`, `id: /`, `lang: es`, iconos `any` y `maskable`. Instalación real: ver NEEDS_REAL_DEVICE.                                              |
| Service worker                                      | READY                              | `NetworkOnly` para `/api/*`; `navigateFallbackDenylist` excluye `/api/`; solo precachea el shell (`globPatterns`); la actualización no recarga sola. Sin datos offline (por diseño).     |
| Rutas PWA                                           | READY                              | Fallback a `/index.html` para navegación; la API no cae en el fallback.                                                                                                                  |
| CSP                                                 | READY                              | `default-src 'self'`, `connect-src 'self'`, sin `unsafe-inline`/`unsafe-eval`; `npm run test:security:browser`: 9 de 9 en la topología de producción (un solo origen).                   |
| Seguridad de rutas                                  | READY                              | `npm run test:security` (224) + guardas de cobertura; `security:scan` sin hallazgos. (PR #51 deriva la cobertura de rutas.)                                                              |
| Cookies en producción                               | READY (código) / NEEDS_REAL_DEVICE | `__Host-` bajo HTTPS cubierto por pruebas con `secureCookies`; **no probado tras HTTPS real**.                                                                                           |
| `TRUST_PROXY`, `CORS_ORIGIN`, `WEB_DIST_DIR`        | READY (docs y validación)          | `docs/deployment.md` y `.env.example` los describen; `*` y `true` se rechazan. Comportamiento tras un proxy real: sin validar.                                                           |
| Variables de entorno                                | NEEDS_OWNER                        | `.env.example` no lista `NODE_ENV=production`/`WEB_DIST_DIR` como activos (están comentados o en `deployment.md`); decidir si se añade un `.env.production.example`.                     |
| Dependencias                                        | READY                              | `npm audit` = 0 en el PR #50 (lockfile); en `main` aún figuran 4 altas + 2 críticas no alcanzables.                                                                                      |
| Lista de verificación                               | NOT_READY (docs desfasadas)        | `final-checklist.md` dice «6 migraciones» (hay 14 en `main`) y «`npm audit` = 4 altas» (cambia con el PR #50); está escrita para `rc.2`. Reescribirla al decidir el siguiente candidato. |
| Release/tag                                         | NEEDS_OWNER                        | No hay `v1.0.0` final ni Release; la versión de cada entrega la decide el mantenedor.                                                                                                    |
| QA en dispositivo                                   | NEEDS_REAL_DEVICE                  | iPhone + Safari (HTTP, red local) aprobado en varias etapas; **sin probar**: PWA instalada, HTTPS, Android, Google Calendar, Outlook.                                                    |
| Despliegue de prueba                                | NEEDS_OWNER                        | Ningún servidor real; hosting, dominio y proxy por decidir.                                                                                                                              |
| Recuperación de contraseña / verificación de correo | NOT_READY                          | Sin implementar y marcado «antes de un despliegue público abierto» en el roadmap.                                                                                                        |

## Qué falta para un candidato (sin decidirlo)

1. Fusionar (o descartar) los PR abiertos; en particular #46 (B3, sin QA real).
2. Despliegue de prueba con HTTPS y proxy reales y repetir el humo de producción allí.
3. QA en dispositivos reales (instalación de la PWA, Android).
4. Actualizar `final-checklist.md` y las notas de release con la evidencia nueva.
5. Decidir recuperación de contraseña/verificación de correo antes de abrir el registro al público.
