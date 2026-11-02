# Aviso de privacidad y política de retención

> **Plantilla para quien opere el servicio.** El proyecto no tiene hoy un servicio público ni un responsable legal. Quien despliegue Academic Planner con usuarios reales debe completar los campos marcados con `[POR COMPLETAR]`, validar el texto con asesoría legal (en Colombia, Ley 1581 de 2012 y Decreto 1377 de 2013 como referencia) y publicarlo dentro de la aplicación. Este documento describe lo que el **software hace**, verificado contra el código y el esquema de datos; no es asesoría legal.

## 1. Quién es el responsable

`[POR COMPLETAR: nombre o razón social del responsable, correo de contacto de privacidad]`

## 2. Qué datos se guardan y para qué

| Dato                                                                                         | Para qué                                     | Cuándo se pide                                |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| Nombre, correo y contraseña (solo su hash Argon2id)                                          | Crear la cuenta e iniciar sesión             | Al registrarte                                |
| Zona horaria                                                                                 | Mostrar y calcular fechas y horas            | Al registrarte (por defecto `America/Bogota`) |
| Uso principal, programa o carrera, estado del asistente inicial                              | Personalizar etiquetas y sugerencias         | Opcional, en el asistente inicial             |
| Estudios, periodos, asignaturas, actividades, clases (agenda), recordatorios, notas y cortes | Planear tu semestre; es la función de la app | Cuando tú los creas o confirmas               |
| Sesión (hash del token, fecha de creación, último uso, vencimiento)                          | Mantener tu sesión iniciada hasta 7 días     | Al iniciar sesión                             |

## 3. Qué NO se guarda

- **El texto que pegas ni el archivo que subes** para importar un horario o crear actividades: se interpretan en el momento y se descartan. Solo se guarda lo que **tú confirmas** después de revisar la propuesta.
- Contraseñas en claro, tokens de sesión en claro, ni datos de pago, salud o ubicación.
- **Los borradores** de captura se guardan solo en tu navegador (`localStorage`) y caducan; no llegan al servidor.

## 4. Con quién se comparte

Con nadie. La aplicación no usa analítica, publicidad, inteligencia artificial ni servicios externos para procesar tus datos; el reconocimiento de texto de imágenes lo hace el propio servidor de la aplicación. Si el responsable aloja el servicio en un proveedor, ese proveedor actúa como encargado y debe figurar aquí: `[POR COMPLETAR]`.

## 5. Cuánto tiempo se conservan

| Dato                               | Plazo                                                                                                  | Cómo se cumple hoy                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Sesiones                           | 7 días fijos; las vencidas se borran al usarse y se purgan al iniciar sesión                           | Automático (código)                                                  |
| Datos de la cuenta y de planeación | Mientras la cuenta exista                                                                              | La base borra en cascada todo lo del usuario si la cuenta se elimina |
| Cuentas inactivas                  | `[POR COMPLETAR: p. ej. eliminar tras 24 meses sin uso]`                                               | **Manual**: aún no hay un proceso automático                         |
| Copias de seguridad                | `[POR COMPLETAR: p. ej. 30 días]`; al borrar una cuenta, sus datos salen de las copias al rotar        | Depende del proveedor ([backup-restore.md](backup-restore.md))       |
| Registros del servidor             | Sin datos personales (no incluyen contraseñas, tokens, textos ni archivos); rotación `[POR COMPLETAR]` | Código + configuración del despliegue                                |

## 6. Tus derechos y cómo ejercerlos

Conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización.

| Derecho                | Estado actual del software                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rectificación          | Puedes editar tus estudios, periodos, asignaturas, actividades y perfil. El correo, el nombre de usuario, la contraseña y la zona horaria **no** tienen pantalla de edición. |
| Acceso y portabilidad  | **No hay exportación de datos.** Se atiende por solicitud al responsable (consulta a la base).                                                                               |
| Supresión de la cuenta | **No hay botón.** Se atiende por solicitud al responsable; la base ya borra en cascada todos los datos del usuario.                                                          |
| Cerrar una sesión      | Sí, desde «Cerrar sesión» (se destruye en el servidor).                                                                                                                      |

Solicitudes: `[POR COMPLETAR: canal]`, con respuesta en `[POR COMPLETAR: plazo, p. ej. 15 días hábiles]`.

## 7. Menores de edad

El asistente permite elegir «estudiante de colegio», así que puede haber menores. Si el servicio los admite, el responsable debe pedir la autorización de su representante legal y tratar sus datos con especial cuidado. `[POR COMPLETAR]`

## 8. Seguridad

Resumen de las medidas: contraseñas con Argon2id, sesiones con cookie `HttpOnly`, aislamiento estricto entre usuarios, cabeceras de seguridad y límites de frecuencia. Detalle y limitaciones reales: [security.md](security.md). Ante una brecha, ver [incident-response.md](incident-response.md).

## 9. Cambios a este aviso

`[POR COMPLETAR: versión y fecha]`. Un cambio sustancial debe comunicarse dentro de la aplicación.
