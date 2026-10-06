# Evidencia de validación del candidato 1.0.0-rc.1

Resultados de la validación del **Release Candidate 1**. No copia registros completos: resume cada comprobación con su comando, resultado y commit. Ficha técnica: [release-manifest.md](release-manifest.md). Notas: [release-notes-1.0.0-rc.1.md](release-notes-1.0.0-rc.1.md). Pendientes: [final-checklist.md](final-checklist.md).

> **Estado de este documento:** esqueleto del commit del candidato. Los resultados de las secciones marcadas «_se registra_» se completan en un commit posterior que **solo modifica documentación** (se demuestra con `git diff --stat` entre ambos commits).

## Commits

| Qué                                               | Commit                                                  |
| ------------------------------------------------- | ------------------------------------------------------- |
| Congelación de código (`main`, Fase 19 fusionada) | `151f6b31c44611babc427f743dc499b717deade0`              |
| Commit del candidato (código y versiones)         | _se registra_                                           |
| Commit con la evidencia (solo documentación)      | _se registra_                                           |
| Commit final del release                          | Se asigna después de fusionar el PR; no se inventa aquí |

## Línea base (sobre la congelación `151f6b31`)

Todo en verde antes de tocar nada: `npm ci` (61 s), `lint`, `format:check`, `typecheck`, `npm test` (1585 pruebas), `build`, `docs:check`, `security:scan`, `test:security` (155), Playwright completo (254 pasan + 4 omitidas, 7,1 min) y `test:security:browser` (9). `git status` limpio, puertos libres.

## Matriz final de comprobaciones

_se registra_

## Instalación limpia (solo con el README)

_se registra_

## Arranque tipo producción

_se registra_

## Humo funcional, demo y recorrido manual

_se registra_

## Cinco pasadas consecutivas de Playwright

_se registra_

## Auditoría, Prisma y secretos

| Comprobación            | Resultado                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit`             | 4 altas (cadena del CLI de Prisma). Sin cambios respecto a la Fase 16. No se usó `--force`                                                                                 |
| Prisma                  | Instalada 7.10.0 = última estable; el tag `latest` es `8.0.0-rc.20` (candidato). No se actualiza; riesgo aceptado                                                          |
| `npm run security:scan` | Limpio                                                                                                                                                                     |
| Secretos versionados    | Solo `.env.example` está versionado (sin secretos); `.env` no; sin claves, tokens ni cookies; la contraseña de la demo es sintética y local                                |
| Archivos grandes        | El mayor es `package-lock.json` (432 kB); sin binarios, modelos, videos ni capturas versionados; el modelo OCR (`@tesseract.js-data/spa`) viene de npm, no del repositorio |
| Lockfile                | Diferencia limitada a las versiones de los cuatro paquetes y los rangos de `@planner/core`; sin actualizaciones de dependencias                                            |
| SBOM                    | `npm sbom --sbom-format spdx --sbom-type application`: 751 paquetes y 1560 relaciones; sin rutas ni datos personales; no se versiona                                       |

## `MaxListenersExceededWarning` (P17-04)

Sigue ocurriendo (14 avisos en una corrida completa de las pruebas de API). **Causa conocida:** con `--trace-warnings` el origen es `supertest` (`Test.end` registra un listener `once` en el servidor por cada solicitud) cuando una prueba lanza más de 10 solicitudes concurrentes sobre la misma aplicación. No hay código del producto en la traza; es ruido del arnés de pruebas, sin efecto en la aplicación. Clasificación: BAJA, documentado; no se refactoriza en un candidato.

## Registro de hallazgos

| ID     | Severidad | Descripción                                                        | Estado                    | Impacto en el release |
| ------ | --------- | ------------------------------------------------------------------ | ------------------------- | --------------------- |
| P17-04 | BAJA      | `MaxListenersExceededWarning` de `supertest` en las pruebas de API | Documentado, sin corregir | Ninguno               |

_Se completa con los hallazgos de esta validación (si los hay)._

**BLOCKER abiertos: 0 · HIGH abiertos: 0** (se confirma al cerrar la validación).

## Revisión visual y limitaciones de la validación

_se registra_
