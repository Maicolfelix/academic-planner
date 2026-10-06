# Manifiesto del candidato 1.0.0-rc.1

Ficha técnica del **Release Candidate 1**. Es un candidato para entrega y evaluación académica, **no** una versión final ni una certificación para producción pública. Notas: [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md). Evidencia: [release-validation.md](release-validation.md). Pendientes: [final-checklist.md](final-checklist.md).

## Identificación

| Campo                    | Valor                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producto                 | Academic Planner (PWA de planeación académica)                                                                                                                  |
| Versión                  | `1.0.0-rc.1` (raíz y los tres workspaces `@planner/core`, `@planner/api`, `@planner/web`, y `package-lock.json`)                                                |
| Etiqueta propuesta       | `v1.0.0-rc.1` (anotada; **solo después de fusionar el PR**, sobre el commit resultante de `main`)                                                               |
| Título del release       | Academic Planner v1.0.0-rc.1 (marcar como **Pre-release**)                                                                                                      |
| Rama del candidato       | `release/phase-20-rc`                                                                                                                                           |
| Congelación de código    | `151f6b31c44611babc427f743dc499b717deade0` (`main` tras fusionar la Fase 19): desde ahí solo cambian la versión, documentos del candidato y estado del proyecto |
| Commit final del release | **Se asigna después de la fusión** (el commit de `main` que recibirá la etiqueta). No se inventa aquí                                                           |
| Licencia                 | Sin archivo de licencia (decisión pendiente del propietario)                                                                                                    |

## Requisitos de ejecución

| Componente         | Requisito                                                                               |
| ------------------ | --------------------------------------------------------------------------------------- |
| Node.js            | ≥ 22.18 (`engines`); probado con 24.19; `.nvmrc` = 24                                   |
| npm                | ≥ 10 (probado con 10.8)                                                                 |
| Base de datos      | PostgreSQL 17 (Docker Compose, puerto host 5433)                                        |
| Red                | Solo el registro de npm durante `npm ci`; en ejecución, solo la aplicación y PostgreSQL |
| Servicios externos | Ninguno (sin IA, sin API de OCR, sin correo, sin proveedores de notificaciones)         |

## Migraciones

Seis migraciones en `apps/api/prisma/migrations/`, aplicadas en orden con `npm run db:deploy` sobre una base vacía y sin SQL manual:

1. `init`
2. `auth_user_session_drop_app_metadata`
3. `academic_periods_and_subjects`
4. `activities`
5. `schedule_blocks`
6. `reminders`

No hay migraciones de reversa (_rollback_): antes de actualizar una base con datos, **respáldala** (ver [deployment.md](deployment.md)). Este candidato no añade migraciones.

## Cifras de pruebas

Valores finales y comandos en [release-validation.md](release-validation.md).

| Suite                                        | Resultado esperado                                |
| -------------------------------------------- | ------------------------------------------------- |
| Vitest (núcleo / API / interfaz)             | 766 / 782 / 37 = **1585**                         |
| Seguridad de la API (dentro de las 782)      | 155                                               |
| Playwright (360 y 1366 px)                   | 258 por pasada: 254 pasan, 4 omitidas a propósito |
| Seguridad en navegador (puerto 4300)         | 9                                                 |
| Verificador de documentación                 | `docs:check` sin hallazgos; `test:docs` 5/5       |
| Pasadas completas consecutivas de Playwright | 5, sobre el mismo commit                          |

## Dependencias y auditoría

| Tema        | Estado                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit` | **4 altas** (cadena del CLI de Prisma: `@prisma/config` → `deepmerge-ts`, y `mysql2`); no alcanzables en tiempo de ejecución. Aceptado; nunca `npm audit fix --force` |
| Prisma      | 7.10.0 instalada = última estable; `latest` es `8.0.0-rc.20` (candidato, no se adopta)                                                                                |
| Bloqueo     | `package-lock.json` versionado; es la base de la reproducibilidad (`npm ci`)                                                                                          |
| SBOM        | Se genera con `npm sbom --sbom-format spdx --sbom-type application` (npm ≥ 10.8). No se versiona (≈ 1 MB, se regenera); se adjunta al release cuando se publique      |

## Artefactos

- **Código fuente:** el tag y los archivos que GitHub genera (`.zip` / `.tar.gz`) bastan: es una aplicación web que se construye desde el código con `npm ci` y `npm run build`.
- **No se publica** un paquete de compilación, ni `node_modules`, ni bases de datos, ni `.env`: un zip de `dist/` sería engañoso porque la aplicación necesita Node, Prisma, PostgreSQL y variables de entorno.
- Sin artefactos binarios propios: no hay sumas de verificación que publicar. Si se adjunta el SBOM, registrar su SHA-256.

## Estado de la documentación

Índice en [docs/README.md](README.md). `npm run docs:check` verifica enlaces, archivos referenciados y scripts mencionados. Las referencias a estado (README, `CLAUDE.md`, `project-state.md`, lista final) describen un **Release Candidate**: no existe una «Fase 21» ni una versión final.

## Etiquetar (solo después de fusionar el PR)

```bash
git checkout main
git pull --ff-only
git tag -a v1.0.0-rc.1 -m "Academic Planner 1.0.0 Release Candidate 1"
git push origin v1.0.0-rc.1
```

Después, crear un GitHub Release **Pre-release** con título «Academic Planner v1.0.0-rc.1» y el texto de [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md). No se ejecuta nada de esto dentro de la Fase 20.
