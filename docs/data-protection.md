# Registro de tratamientos y evaluación de impacto (DPIA)

Documento de apoyo a [hardening-soc2-iso27701.md](hardening-soc2-iso27701.md) (ISO 27701 y SOC 2 Privacidad). Se deriva del esquema real ([schema.prisma](../apps/api/prisma/schema.prisma), [data-model.md](data-model.md)). No es asesoría legal.

## 1. Registro de tratamientos (RAT)

El responsable es quien opere el servicio (`[POR COMPLETAR]`, ver [privacy-notice.md](privacy-notice.md)). Hoy no hay un tratamiento delegado a terceros.

| Tabla / lugar                                   | Datos personales                                 | Finalidad                        | Base                         | Destinatarios         | Retención                                        |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------- | ---------------------------- | --------------------- | ------------------------------------------------ |
| `User`                                          | nombre, correo, hash de contraseña, zona horaria | Identidad y autenticación        | Autorización del titular     | Ninguno               | Mientras exista la cuenta                        |
| `UserProfile`                                   | uso principal, programa, estado del asistente    | Personalización (opcional)       | Autorización del titular     | Ninguno               | Mientras exista la cuenta                        |
| `Session`                                       | hash del token, fechas de uso                    | Mantener la sesión               | Ejecución del servicio       | Ninguno               | 7 días fijos; purga automática                   |
| `StudyTrack`, `AcademicPeriod`, `Subject`       | formación, periodos, asignaturas                 | Planeación académica             | Autorización del titular     | Ninguno               | Mientras exista la cuenta                        |
| `Activity`, `Reminder`, `ScheduleBlock`         | tareas, fechas, clases y horarios                | Planeación académica             | Autorización del titular     | Ninguno               | Mientras exista la cuenta                        |
| `GradingProfile`, `GradingPeriod`, `Evaluation` | notas, cortes y pesos                            | Seguimiento de notas informativo | Autorización del titular     | Ninguno               | Mientras exista la cuenta                        |
| `localStorage` del navegador (borradores)       | texto de captura en curso                        | No perder lo escrito             | Función solicitada           | Ninguno               | Caduca; solo en el dispositivo                   |
| Copias de seguridad                             | todo lo anterior                                 | Recuperación                     | Interés legítimo / seguridad | Proveedor (si lo hay) | `[POR COMPLETAR]`                                |
| Memoria del proceso durante una importación     | imagen/PDF y texto OCR                           | Proponer actividades o clases    | Función solicitada           | Ninguno               | Solo durante la solicitud; no se escribe a disco |

## 2. Evaluación de impacto (DPIA) resumida

**Descripción.** App de planeación académica. Trata datos de identidad y de organización personal del estudiante. Sin IA, sin analítica y sin terceros.

**Necesidad y proporcionalidad.** Cada dato se usa para una función visible. El perfil es opcional y omitible. El texto y los archivos importados no se conservan. Se recoge lo mínimo.

**Riesgos para los titulares y mitigación:**

| Riesgo                                             | Probabilidad | Impacto | Mitigación existente                                           | Pendiente                                     |
| -------------------------------------------------- | ------------ | ------- | -------------------------------------------------------------- | --------------------------------------------- |
| Acceso a datos de otro usuario                     | Baja         | Medio   | Filtro por `userId`, mismo 404, matriz de pruebas de propiedad | —                                             |
| Robo de cuenta (relleno de credenciales)           | Media        | Medio   | Argon2id, límite de intentos, respuestas idénticas             | Sin MFA ni recuperación de contraseña         |
| Fuga de la base o de una copia                     | Baja         | Alto    | Solo hashes de contraseña; copias con acceso restringido       | Cifrado en reposo depende del proveedor       |
| Datos de menores de edad                           | Media        | Alto    | Datos de baja sensibilidad; sin contacto, ubicación ni pagos   | Autorización del representante (ver aviso §7) |
| Conservación indefinida de cuentas abandonadas     | Alta         | Bajo    | —                                                              | Política de inactividad (aviso §5)            |
| Titular no puede ejercer sus derechos por sí mismo | Alta         | Medio   | Solicitud manual al responsable                                | Exportar y eliminar desde la app (nivel 3)    |

**Conclusión.** Riesgo **bajo a medio** y proporcionado, dado que no se tratan datos sensibles (salud, financieros, biométricos, ubicación) ni se comparten con terceros. Las brechas relevantes son de **ejercicio de derechos** y de **retención**, listadas en el plan de [hardening-soc2-iso27701.md §4](hardening-soc2-iso27701.md#4-plan-de-endurecimiento-priorizado). Revisar esta evaluación si se añade IA, analítica, notificaciones push, un proveedor externo o un registro público abierto.
