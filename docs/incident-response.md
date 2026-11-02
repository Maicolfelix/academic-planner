# Plan de respuesta a incidentes y de notificación de brechas

Procedimiento mínimo para quien opere el servicio (SOC 2 CC7.3–7.5, ISO 27701). El proyecto no tiene guardia ni monitoreo continuo: este plan define **qué hacer** cuando alguien detecta o reporta un problema. Los campos `[POR COMPLETAR]` los define el responsable del servicio.

## 1. Qué es un incidente

Un evento que afecta la confidencialidad, integridad o disponibilidad de los datos o del servicio. Ejemplos: acceso a datos de otro usuario, base o copia de seguridad expuesta, secreto filtrado, cuenta comprometida, sitio caído o datos corruptos, dependencia con vulnerabilidad explotable.

## 2. Roles

| Rol                       | Quién                             | Hace                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------ |
| Responsable del incidente | El mantenedor (`[POR COMPLETAR]`) | Decide, coordina y deja el registro                    |
| Contacto de privacidad    | `[POR COMPLETAR]`                 | Evalúa si hay datos personales y avisa a los titulares |

## 3. Severidad

| Nivel | Criterio                                                                 | Primera respuesta  |
| ----- | ------------------------------------------------------------------------ | ------------------ |
| Alta  | Datos personales expuestos o accedidos sin permiso; secreto filtrado     | Inmediata          |
| Media | Vulnerabilidad explotable sin evidencia de uso; caída prolongada         | Mismo día          |
| Baja  | Hallazgo sin ruta explotable (p. ej. aviso de herramienta de desarrollo) | Siguiente revisión |

## 4. Pasos

1. **Detectar y registrar.** Quién avisó, cuándo, qué se vio. Fuentes: reporte según [SECURITY.md](../SECURITY.md), alerta de Dependabot o del CI, comportamiento anómalo, aviso del proveedor.
2. **Contener.** Lo más pequeño que detenga el daño: cerrar la ruta afectada o poner el servicio en mantenimiento; **rotar** secretos expuestos (`DATABASE_URL`, credenciales del proveedor); para cuentas comprometidas, **borrar sus filas de `Session`** (cierra todas sus sesiones); si hubo exposición de la base, restringir el acceso de red.
3. **Evaluar.** Qué datos, de cuántas personas, desde cuándo, y si hay evidencia de acceso real. Conservar los registros del servidor (no contienen datos personales).
4. **Erradicar y recuperar.** Corregir la causa en un PR (con una prueba que falle sin la corrección), desplegar y, si hubo corrupción, restaurar según [backup-restore.md](backup-restore.md).
5. **Notificar** (ver §5) si hay datos personales afectados.
6. **Aprender.** Escribir una nota breve (qué pasó, causa, qué cambia) y, si corresponde, actualizar [security.md](security.md) y las pruebas.

## 5. Notificación de brechas

Si se confirma o es probable que se hayan expuesto datos personales:

| A quién                          | Cuándo                                                                                                                                                                         | Qué debe decir                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Titulares afectados              | Sin demora injustificada, `[POR COMPLETAR: p. ej. 72 h desde la confirmación]`                                                                                                 | Qué datos, qué pasó, qué hacer (p. ej. cambiar contraseña), cómo contactar |
| Autoridad de protección de datos | En Colombia, la Superintendencia de Industria y Comercio (SIC) exige reportar incidentes de seguridad sobre bases de datos registradas; confirmar con asesoría legal si aplica | Naturaleza, datos y número de titulares, medidas tomadas                   |
| Proveedor / encargados           | Si el incidente toca su infraestructura                                                                                                                                        | Detalle técnico                                                            |

El mensaje es factual y neutral: sin minimizar ni especular.

## 6. Objetivos de recuperación

Ver [backup-restore.md](backup-restore.md#objetivos-de-recuperación): RTO y RPO propuestos.

## 7. Simulacro

Antes de operar con usuarios reales, hacer un simulacro de papel: «se filtró `DATABASE_URL`». Recorrer los pasos 1–6 y anotar qué faltó. No se ha hecho (`PENDIENTE`).
