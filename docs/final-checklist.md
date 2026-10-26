# Lista de verificación final (antes de publicar `v1.0.0`)

Se escribió de nuevo para el estado **actual**: `main` en `57090dd` (P9 completo, 2026-10-25). Marca solo lo que **se comprobó de verdad después de P9**, con la evidencia indicada; todo lo demás queda sin marcar. Esta lista no la completa nadie por optimismo: los puntos abiertos son las limitaciones reales ([limitations.md](limitations.md)) y cada uno aparece con su estado en la [auditoría de preparación](release-readiness-audit.md).

**Alcance de v1:** **beta cerrada** ([política](release-readiness-audit.md#política-de-acceso-para-v1-decisión-provisional)). **Candidato:** `v1.0.0-rc.3` (preproducción, PWA real y dispositivos); `v1.0.0` solo si ese candidato pasa sin cambios. Las versiones siguen en `1.0.0-rc.2` y **no se ha creado ningún tag nuevo**: el cambio de versión es RG-4, con autorización.

Evidencia «gate de RG-2» = la tanda de este PR sobre su último commit; «gate de #68» = la tanda secuencial del PR #68 sobre `9b522c1` (lo último de P9), repetida en parte sobre `main` `57090dd` tras fusionarlo.

## 1. Reproducibilidad

- [x] **Instalación completa** (`npm ci`) y **compilación** (`npm run build`) sin errores: gate de #68 y `main` tras el merge.
- [x] **`npm ci --omit=dev`** verificado en un clon desechable de `57090dd`: termina con código 0 (273 paquetes, 0 vulnerabilidades, 48 s). **Esa instalación no compila**: `npm run build` de la API y de la web falla sin las dependencias de desarrollo (`@types/*`, `vite`, `vite-plugin-pwa`). Detalle y flujo correcto: [deployment.md](deployment.md#instalar-y-compilar).
- [x] **La imagen Docker se construye desde cero** (RG-2): `npm ci` y `npm run build` dentro de la imagen, con los módulos nativos instalados para su sistema operativo; `docker build` de los objetivos `runtime` y `migrate`.
- [ ] **Instalación limpia siguiendo solo el README**, en un clon nuevo, sobre el commit candidato (última documentada: `rc.1`).

## 2. Migraciones

- [x] **15 migraciones** lineales presentes; `prisma migrate status` en la base de desarrollo: «Database schema is up to date!» (revisión de 2026-10-25).
- [x] **Validación desde una base vacía** con las 15 (RG-2, `npm run validate:fresh-db`, PostgreSQL 17 desechable en Docker): las 15 se aplican, `prisma migrate status` al día, sin deriva inesperada, 15 filas terminadas, arranque en producción, humo completo (registro, periodo, materia, actividad, completarla), datos persistentes tras reiniciar el proceso web y la base. **Pendiente repetirlo en el PostgreSQL de preproducción.**
- [x] **Sin deriva inesperada de esquema** (`prisma migrate diff`, RG-2): la **única** diferencia es la FK manual `Evaluation → Activity` (`ON DELETE SET NULL ("activityId")`), **revisada y aceptada por el mantenedor**; cualquier otra bloquea `npm run validate:fresh-db` ([detalle](deployment.md#deriva-del-esquema-conocida-e-intencional)). `schema.prisma` y la base no son idénticos por diseño.

## 3. Calidad

- [x] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm run docs:check`, `npm run security:scan` y `git diff --check`: gate de #68.
- [x] **Vitest** en verde tras RG-2: core 1405, API 1578, web 700.
- [x] **Playwright dirigido** de P9 en verde: 206 pasan y 2 se omiten a propósito (`period-transition`, `my-studies`, `home-period`, `multi-study-read`, `dashboard`, `home`, `companion`, `first-use-home`, `attention-actions`, `home-carousel`, `onboarding-study`).
- [ ] **Playwright COMPLETO** (892 pruebas en 44 archivos, 360 y 1366 px) con `--workers=2` sobre el commit candidato. **No se ha corrido completo después de P9**; es obligatorio para el release gate.
- [x] `npm run test:docs` (incluye las pruebas de las utilidades del humo).

## 4. Seguridad

- [x] `npm audit` = 0 y `npm audit --omit=dev` = 0 en `main` tras #68.
- [x] `npm run security:scan`, `npm run test:security` (273 pruebas) y `npm run test:security:browser` (9 de 9) tras RG-2.
- [ ] Cookie `__Host-`, HSTS y `Secure` verificados **en un navegador sobre HTTPS** (hoy solo hay pruebas de API).
- [ ] `TRUST_PROXY` y `CORS_ORIGIN` verificados tras un proxy real.
- [ ] **Decisión sobre cuentas** registrada: beta cerrada (recuperación de contraseña, verificación de correo y MFA no bloquean) o implementarlas antes de abrir el registro público.

## 5. Despliegue

- [x] **Configuración de producción** (RG-2): con `NODE_ENV=production` el proceso no arranca sin `CORS_ORIGIN` ni `WEB_DIST_DIR`; `NODE_ENV` nunca se asume; `API_PORT` › `PORT` › 3000; tabla de variables en [deployment.md](deployment.md#variables-de-entorno).
- [x] **Artefacto de despliegue** (RG-2): `Dockerfile` multi-etapa y `.dockerignore`; imagen construida y validada en local (usuario no root, sin secretos en las capas, `HEALTHCHECK` sano, `SIGTERM` limpio, argon2, `@napi-rs/canvas` y OCR en el contenedor); migraciones como paso aparte (objetivo `migrate`). **No se publicó ninguna imagen.**
- [ ] **Preproducción con HTTPS** desplegada con la guía de [deployment.md](deployment.md) y **una sola instancia**.
- [ ] Decisiones del mantenedor tomadas: proveedor, dominio y TLS, PostgreSQL gestionado.

## 6. PWA

- [x] Manifest, service worker, precache, `/api` como `NetworkOnly` y modo sin conexión comprobados en e2e local (`e2e/pwa.spec.ts`).
- [ ] **PWA instalada sobre HTTPS** en un dispositivo real y su actualización.
- [ ] **Share Target real en Android** (PWA instalada). iOS **no** es destino de compartir: no se espera ([share-target.md](share-target.md#soporte-del-share-target-y-diferencia-con-el-web-share-api)).

## 7. Dispositivos reales

- [ ] iPhone: Safari por HTTPS y PWA instalada ([release-qa-plan.md](release-qa-plan.md)).
- [ ] Android: Chrome por HTTPS y PWA instalada, con el Share Target.
- [ ] Sin defectos BLOCKER ni HIGH abiertos de esa QA.

## 8. Respaldo y restauración

- [ ] Copias automáticas del proveedor activas.
- [ ] **Ensayo de restauración** con una copia real y evidencia ([backup-restore.md](backup-restore.md)).

## 9. Smoke de producción

- [x] Script de humo **independiente de la base de pruebas** y parametrizado por `BASE_URL` (RG-2, `npm run smoke`): 27 comprobaciones pasan y 3 (HTTPS) son `n/a` contra el contenedor local por HTTP.
- [ ] Humo verde sobre la preproducción con HTTPS: salud, cabeceras, registro, onboarding, una actividad, una captura, cierre de sesión.

## 10. Metadatos del release

- [ ] **Notas de versión** de `rc.3` y de `v1.0.0` (qué cambió desde `rc.2`: 209 commits y 9 migraciones).
- [ ] **Subir las versiones a `1.0.0-rc.3`** y etiquetar `v1.0.0-rc.3` (pre-release): solo en RG-4, con autorización, después de fusionar y desde `main`.
- [ ] **Licencia decidida** (no existe `LICENSE`; no bloquea una beta privada, sí una distribución pública).
- [ ] **`v1.0.0`:** solo si `rc.3` pasa el gate sin cambios y con autorización expresa.
- [x] `v1.0.0-rc.1` y `v1.0.0-rc.2` publicados como pre-release (inmutables).

## Fuera de esta lista (no bloquean la beta cerrada)

Prueba de carga, almacén compartido para los límites de frecuencia (v1 usa una instancia), CI, logs estructurados y monitoreo, y la detección de migraciones pendientes en la salud.

## Antes de cada demostración

- [ ] Ejecutar el seed el mismo día y volver a iniciar sesión ([demo.md](demo.md)).
- [ ] Confirmar que la cuenta demo **no** existe en ninguna base pública.
