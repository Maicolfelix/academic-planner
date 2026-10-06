# Lista de verificación final (antes de publicar)

Marca solo lo que **se comprobó de verdad** y deja el resto sin marcar. «Hecho» significa ejecutado y verificado, con la evidencia enlazada. Esta lista no la completa nadie por optimismo: los puntos abiertos son las limitaciones reales del proyecto ([limitations.md](limitations.md)).

Estado del **Release Candidate `1.0.0-rc.1`** (Fase 20). Cada ítem hecho se comprobó con evidencia enlazada en [release-validation.md](release-validation.md).

## Reproducibilidad

- [x] **Instalación limpia** siguiendo solo el README (clon nuevo, `docker compose down -v`, `npm ci`, `.env`, `db:up`, `db:deploy`, lint, formato, tipos, pruebas, build, Playwright). Hecha en las Fases 17, 18 y 19 ([system-validation.md](system-validation.md)).
- [x] **Migraciones** aplicadas desde cero sin errores (6 migraciones).
- [x] **Base de test** se crea y migra sola, también para Playwright.
- [x] **Datos de demostración:** `npm run db:seed:demo -- --allow-demo` crea el dataset, se puede repetir y el login demo funciona ([demo.md](demo.md)).

## Calidad

- [x] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build` sin errores.
- [x] **Pruebas Vitest** (core, API con PostgreSQL real, web) en verde ([testing.md](testing.md)).
- [x] **Playwright** completo (360 y 1366 px), sin fallos; las pruebas omitidas lo son a propósito.
- [x] **Seguridad:** `npm run security:scan`, `npm run test:security` y `npm run test:security:browser` en verde.
- [x] **Auditoría revisada:** `npm audit` = 4 altas de la cadena del CLI de Prisma, analizadas y aceptadas (no alcanzables en tiempo de ejecución); sin `--force` ([security.md](security.md#15-dependencias-npm-audit)).
- [x] **Documentación:** índice, arquitectura, modelo de datos, API, requisitos, decisiones, limitaciones, despliegue, desarrollo, `npm run docs:check` en verde.

## Pendiente (sin marcar a propósito)

- [ ] **Pruebas en dispositivos reales** iOS y Android (instalación de la PWA, teclado virtual, cámara y archivos).
- [ ] **HTTPS y proxy inverso reales** validados (cookie `__Host-`, HSTS, `TRUST_PROXY`, límites de frecuencia tras el proxy).
- [ ] **Despliegue de prueba** en un servidor real con la guía de [deployment.md](deployment.md).
- [ ] **Actualizar Prisma** a la siguiente versión estable que corrija la cadena del CLI marcada por `npm audit` (hoy no hay una estable posterior a la instalada) y repetir la auditoría.
- [ ] **Decidir la licencia.** El repositorio no tiene archivo `LICENSE`; sin una licencia explícita, el código no concede permisos de uso. Es una decisión del propietario.
- [ ] **Prueba de carga** si se espera uso concurrente real (hoy solo hay pruebas de humo).
- [ ] **Almacén compartido para los límites de frecuencia** si se ejecuta más de una instancia.
- [ ] **Corrección de las limitaciones de cuentas** que se consideren necesarias para un servicio público: verificación de correo, recuperación de contraseña, MFA.
- [x] **Notas y manifiesto del candidato** preparados ([release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md), [release-manifest.md](release-manifest.md)).
- [ ] **Etiqueta `v1.0.0-rc.1`** y GitHub Release (pre-release): se crean **después de fusionar** el PR del candidato, por el propietario.
- [ ] **Versión final `v1.0.0`:** no forma parte de este candidato; requiere cerrar los pendientes de arriba.

## Antes de cada demostración

- [ ] Ejecutar el seed el mismo día y volver a iniciar sesión ([demo.md](demo.md)).
- [ ] Confirmar que la cuenta demo **no** existe en ninguna base pública.
