# Endurecimiento guiado por SOC 2 e ISO/IEC 27701

Este documento es un **análisis de brechas (gap analysis)**: compara lo que el proyecto ya hace con los criterios de SOC 2 (Trust Services Criteria) y con los controles de privacidad de ISO/IEC 27701, y deja una lista priorizada de lo que falta.

**No es una certificación ni una auditoría.** SOC 2 lo emite un contador público independiente sobre una organización que opera controles durante un periodo; ISO 27701 se certifica sobre un sistema de gestión (SGSI/SGPI) de una organización. Un proyecto de grado sin operación ni hosting no puede obtener ninguno de los dos. Lo que sí puede hacer es **diseñar y evidenciar controles alineados** con esos marcos. La fuente de verdad sigue siendo código → pruebas → documentos; las evidencias de abajo apuntan a ellos. Estado de la revisión: 2026-11-02, sobre `v1.1.0`.

Controles técnicos ya detallados: [security.md](security.md). Despliegue y respaldo: [deployment.md](deployment.md), [backup-restore.md](backup-restore.md).

## 1. Resumen

| Marco                                   | Cubierto                                                                                        | Parcial                                                        | Sin cubrir                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| SOC 2 Seguridad (CC)                    | Acceso lógico, cifrado de contraseñas, sesiones, validación, cabeceras, pruebas, cambios por PR | Monitoreo, respuesta a incidentes, gestión de vulnerabilidades | Integración continua, revisiones de acceso, registro de auditoría   |
| SOC 2 Disponibilidad (A)                | Copia y restauración ensayadas en local                                                         | Sin alojamiento ni monitoreo                                   | SLA, continuidad, capacidad                                         |
| SOC 2 Confidencialidad (C)              | Aislamiento entre usuarios, `no-store`, sin secretos versionados                                | Retención y disposición                                        | —                                                                   |
| SOC 2 Integridad del procesamiento (PI) | Propuesta → confirmación, transacciones todo o nada, restricciones en BD                        | —                                                              | —                                                                   |
| SOC 2 Privacidad (P)                    | Minimización (no se guarda el texto ni el archivo importado)                                    | Aviso de privacidad, consentimiento                            | Acceso/exportación, eliminación de cuenta, registro de tratamientos |
| ISO 27701 (controlador)                 | Minimización, limitación de la finalidad, privacidad por diseño                                 | Transparencia, base legal                                      | Derechos del titular, retención, notificación de brechas, RAT/DPIA  |

## 2. SOC 2: criterios de servicio

### Seguridad (CC1–CC9)

| Criterio                                   | Estado   | Evidencia / brecha                                                                                                                                                                                                                              |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC5 Actividades de control                 | Cubierto | Reglas en servidor y en PostgreSQL ([security.md §14](security.md#14-base-de-datos)).                                                                                                                                                           |
| CC6.1 Acceso lógico                        | Cubierto | Sesión de 256 bits con solo su hash en BD, cookie `HttpOnly`/`__Host-`, `userId` en cada repositorio, mismo 404 ante recurso ajeno (`ownership.security.test.ts`).                                                                              |
| CC6.1 Contraseñas                          | Cubierto | Argon2id con parámetros explícitos, política 8–128 sin recorte, hash de relleno contra enumeración.                                                                                                                                             |
| CC6.2/6.3 Alta, baja y revisión de accesos | Parcial  | Alta por registro. **No hay baja de cuenta ni lista de sesiones revocables por el usuario**, ni revisión periódica de accesos de la infraestructura (no hay infraestructura).                                                                   |
| CC6.6 Frontera del sistema                 | Cubierto | CORS exacto, verificación de origen, CSP real, límites de frecuencia, `TRUST_PROXY` numérico.                                                                                                                                                   |
| CC6.7 Transmisión de datos                 | Parcial  | HSTS y cookie `Secure` bajo HTTPS; **HTTPS solo temporal** (túnel), sin alojamiento permanente.                                                                                                                                                 |
| CC6.8 Software malicioso                   | Parcial  | `security:scan` y subida con límites y firma real; sin antivirus (los archivos no se guardan).                                                                                                                                                  |
| CC7.1 Detección de vulnerabilidades        | Parcial  | `npm audit` manual. **No hay Dependabot ni análisis automático.** `npm audit` hoy: 21 (2 bajas, 19 moderadas), todas de desarrollo; `--omit=dev` = 0.                                                                                           |
| CC7.2 Monitoreo de anomalías               | Brecha   | Los registros no contienen datos personales (bien), pero **no hay registro de eventos de seguridad** (inicios de sesión fallidos, cambios de cuenta) ni alertas.                                                                                |
| CC7.3–7.5 Incidentes                       | Brecha   | **No hay plan de respuesta a incidentes** documentado.                                                                                                                                                                                          |
| CC8.1 Gestión de cambios                   | Parcial  | Un PR por cambio, pruebas y revisión antes de fusionar, tags inmutables ([CLAUDE.md](../CLAUDE.md)). **No hay integración continua**: las pruebas se corren a mano. No hay `CODEOWNERS` ni protección de rama verificable desde el repositorio. |
| CC9 Mitigación de riesgos / proveedores    | Parcial  | Sin servicios externos en tiempo de ejecución (reduce el riesgo de terceros). Falta un inventario formal de dependencias y una política de actualización.                                                                                       |

### Disponibilidad (A1)

Copia con `pg_dump` y restauración ensayadas en local ([backup-restore.md](backup-restore.md)). Sin alojamiento, sin monitoreo de disponibilidad y sin objetivos de recuperación (RTO/RPO) escritos.

### Confidencialidad (C1)

Aislamiento entre usuarios probado en matriz, `Cache-Control: no-store`, service worker que nunca guarda `/api/*`, sin secretos en el historial (revisado). Brecha: **no hay política de retención ni de disposición** de datos (cuánto se conservan las sesiones expiradas, las cuentas inactivas o las copias de seguridad).

### Integridad del procesamiento (PI1)

Es el punto más fuerte del diseño: nada se persiste sin propuesta y confirmación, los lotes son todo o nada, las escrituras concurrentes se serializan y las invariantes críticas están en la base de datos con `CHECK` e índices parciales.

### Privacidad (P1–P8)

Ver §3: SOC 2 Privacidad y ISO 27701 comparten casi todas las brechas.

## 3. ISO/IEC 27701: privacidad (el sistema como controlador)

| Control (resumen)                   | Estado     | Evidencia / brecha                                                                                                                                                                                                |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limitación de la finalidad          | Cubierto   | Los datos se usan solo para planear el semestre del propio usuario. No hay analítica ni terceros.                                                                                                                 |
| Minimización de datos               | Cubierto   | El texto y el archivo importados no se guardan; el `.ics` solo lleva título, asignatura y fechas; el perfil es opcional y omitible.                                                                               |
| Privacidad por diseño y por defecto | Cubierto   | Sin IA ni envío a servicios externos; el OCR corre en la propia aplicación; las cuentas nuevas no crean estudios ni perfil sin acción del usuario.                                                                |
| Transparencia (aviso de privacidad) | **Brecha** | **No existe un aviso de privacidad dentro de la aplicación** que diga qué se guarda, para qué, por cuánto tiempo y quién es el responsable.                                                                       |
| Consentimiento / base legal         | **Brecha** | El registro no pide aceptar términos ni aviso. En Colombia aplica la Ley 1581 de 2012 (autorización del titular); esto es una referencia, no asesoría legal.                                                      |
| Derecho de acceso y portabilidad    | **Brecha** | **No hay exportación de los datos propios** (JSON/CSV). El `.ics` es por actividad, no un volcado.                                                                                                                |
| Derecho de rectificación            | Parcial    | Se pueden editar actividades, asignaturas, periodos y perfil; **no el correo, el nombre de usuario, la contraseña ni la zona horaria**.                                                                           |
| Derecho de supresión                | **Brecha** | **No hay eliminación de cuenta** (explícitamente fuera de alcance hoy). La BD ya borra en cascada sesiones y datos al eliminar un usuario, pero no hay camino para pedirlo.                                       |
| Retención y disposición             | **Brecha** | Sin plazos definidos. Las cuentas inactivas se conservan indefinidamente.                                                                                                                                         |
| Registro de tratamientos (RAT)      | **Brecha** | No hay inventario formal de qué datos personales existen, dónde y con qué finalidad. [data-model.md](data-model.md) es la base para construirlo.                                                                  |
| Evaluación de impacto (DPIA)        | **Brecha** | No hecha. Es proporcional hacerla corta: los datos son bajos en sensibilidad (no hay datos de salud, financieros ni de menores recogidos a propósito; ojo: **un estudiante de colegio puede ser menor de edad**). |
| Notificación de brechas             | **Brecha** | Sin procedimiento (a quién avisar, en cuánto tiempo).                                                                                                                                                             |
| Transferencias y encargados         | Cubierto   | No hay encargados ni transferencias en ejecución. Si se aloja en un proveedor, pasa a ser un encargado y requiere contrato.                                                                                       |

## 4. Plan de endurecimiento priorizado

Cada ítem es una **propuesta**; ninguno se implementa sin que lo apruebes (las funciones de producto ya están declaradas fuera de alcance en [CLAUDE.md](../CLAUDE.md)).

### Nivel 1: documentación y procesos (HECHO, 2026-11-02)

1. Aviso de privacidad y retención: [privacy-notice.md](privacy-notice.md) (plantilla; los campos `[POR COMPLETAR]` los define quien opere el servicio). **Aún no está dentro de la aplicación.**
2. Registro de tratamientos y DPIA corta: [data-protection.md](data-protection.md).
3. Plan de respuesta a incidentes y de notificación de brechas: [incident-response.md](incident-response.md) (simulacro pendiente).
4. [SECURITY.md](../SECURITY.md) con cómo reportar una vulnerabilidad.
5. Objetivos de recuperación (RTO/RPO) propuestos: [backup-restore.md](backup-restore.md#objetivos-de-recuperación).

### Nivel 2: automatización del repositorio (HECHO, 2026-11-02)

6. Integración continua: [.github/workflows/ci.yml](../.github/workflows/ci.yml) corre lint, formato, tipos, pruebas con PostgreSQL 17, build, `security:scan`, `docs:check` y `npm audit --omit=dev` en cada PR y en `main`. **Aún no se ha ejecutado en GitHub**: se valida con el primer PR que la incluya.
7. [Dependabot](../.github/dependabot.yml) semanal para npm y GitHub Actions.
8. [CODEOWNERS](../.github/CODEOWNERS). **Protección de la rama `main` (revisión y verificación `verify` obligatorias): es un ajuste de GitHub, no un archivo del repositorio; queda por activar** en _Settings → Branches_ cuando el CI haya corrido una vez.

### Nivel 3: funciones de producto (requieren tu aprobación explícita)

9. **Exportar mis datos** (JSON), sin dependencias nuevas.
10. **Eliminar mi cuenta** con confirmación; la base ya sabe borrar en cascada.
11. **Sesiones activas con revocación** y **editar contraseña/correo**.
12. **Registro de eventos de seguridad** (inicio de sesión, fallos, cambio de contraseña) sin datos personales en el texto.
13. **Aceptación del aviso de privacidad en el registro**, con fecha de versión aceptada.

### Fuera de este plan

Verificación de correo, recuperación de contraseña, MFA y CAPTCHA siguen fuera de alcance; serían imprescindibles antes de abrir un registro público.

## 5. Cómo presentarlo en la tesis

Es un análisis de brechas contra dos marcos reconocidos, con evidencia por criterio y un plan priorizado. Para un proyecto sin operación, lo defendible es decir: **los controles técnicos están implementados y probados; los procedimientos de organización (incidentes, retención, derechos del titular) se documentan como trabajo para quien opere el servicio**. No afirmes cumplimiento ni certificación.
