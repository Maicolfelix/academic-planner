# Demo local y datos de demostración (Fase 18)

> **SOLO DESARROLLO / DEMOSTRACIÓN.** Las credenciales de este documento son sintéticas, locales y públicas. No las uses en un despliegue público ni con datos reales.

El seed demo crea, con un solo comando, un estudiante ficticio con un semestre completo para presentar el proyecto. **Es infraestructura de demostración, no lógica de negocio**: ninguna regla del producto depende de que se haya ejecutado, no hay «modo demo», ni login automático, ni datos escritos en el frontend. La demo inicia sesión como cualquier estudiante (RF01) y los datos entran por los mismos servicios que usa la API.

## Preparación

```bash
npm ci
cp .env.example .env              # PowerShell: Copy-Item .env.example .env
npm run db:up
npm run db:deploy
npm run db:seed:demo -- --allow-demo
npm run dev
```

Abre http://localhost:5173/login.

El mismo comando funciona igual en cmd, PowerShell y bash: el permiso va **en la línea de comandos** (`--allow-demo`), no en una variable de entorno (que se escribe distinto en cada shell y podría quedar activada por olvido en un `.env`). El `--` antes del flag es de npm: separa sus opciones de las del script.

## Credenciales (ficticias)

| Campo      | Valor                        |
| ---------- | ---------------------------- |
| Correo     | `demo@academicplanner.local` |
| Contraseña | `DemoAcademic2026!`          |
| Zona       | America/Bogota               |

## Qué hace el comando y qué no

- **Nunca se ejecuta solo:** ni con `npm install`, ni `npm run dev`, ni `db:deploy`, ni al arrancar en producción. Solo existe como este comando explícito.
- **Dos candados, ambos obligatorios:** `NODE_ENV` distinto de `production` (el flag **no** puede anularlo) y el flag `--allow-demo`. Sin flag responde «Demo seed is disabled…» y sale con código 2; en producción sale con código 2 aunque lleve el flag. Un error de BD sale con código 1; el éxito, con 0.
- **Muestra dónde va a escribir** (`NODE_ENV` y `host:puerto/base`), nunca la URL completa ni credenciales.
- **Solo toca al usuario demo**, identificado por su correo fijo (no por el nombre). Nunca borra otros usuarios, sus datos ni sus sesiones, y nunca hace `DROP`/`TRUNCATE`.
- Siempre cierra la conexión (`finally`) y tarda unos 0,8 s.

## Idempotencia y restablecimiento

Ejecutarlo de nuevo **regenera** el dataset: busca al usuario demo por su correo (mismo `id`), borra únicamente sus periodos, asignaturas, agenda, actividades, recordatorios y sesiones (en orden de claves foráneas, todo filtrado por su `userId`) y lo vuelve a crear. No duplica nada.

- Si durante una presentación cambiaste datos: `npm run db:seed:demo -- --allow-demo` y listo.
- **Después de restablecer, vuelve a iniciar sesión**: el restablecimiento revoca las sesiones del demo a propósito, para que un navegador abierto no quede en un estado extraño.
- Los demás usuarios y sus sesiones no se tocan. Si falla a mitad, el demo queda a medias (nunca otros usuarios) y volver a ejecutarlo lo repara.
- Si no quieres que quede nada: el dataset vive solo en la BD que apunte `DATABASE_URL`; `docker compose down -v` la elimina entera.

## Qué contiene

Todas las fechas son **relativas al momento de ejecutarlo** (una sola lectura de «ahora»), calculadas en la zona del usuario con los mismos helpers del producto. El periodo empieza el lunes de hace cinco semanas y dura 17 semanas, así que la demo sigue siendo útil dentro de un año.

| Pieza             | Contenido                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Periodo           | «Semestre demo AAAA-I/II», actual, ~12 semanas por delante                                                                                                                               |
| Asignaturas (6)   | Redes de Computadores, Bases de Datos, Bioestadística, Epidemiología, Programación Web, Seguridad Informática (colores de la paleta; algunas con profesor/descripción)                   |
| Agenda (6 clases) | Lun 8–10 Redes · Lun 14–16 Bioestadística · Mar 10–12 Bases · Mié 8–10 Epidemiología · Jue 14–16 Programación Web · Vie 10–12 Seguridad. Semanales hasta fin del periodo, sin conflictos |
| Actividades (15)  | 7 tipos, 3 prioridades, 3 estados; títulos naturales; algunas con descripción                                                                                                            |

Cobertura del Radar (por duración real restante): **1 vencida · 2 atención inmediata · 2 próximas · 3 planificables · 3 bajo control**, más 4 finalizadas. Progreso general **27 %** (4 de 15): Redes 2/4, Bases 1/3, Bioestadística 1/3, Epidemiología 0/2, Programación Web 0/2, Seguridad 0/1. Hay 3 actividades en proceso.

**«¿Qué hago ahora?»** recomienda **Parcial 1 de Redes** (prioridad alta, vence en unas 6 horas), por las reglas reales, sin puntajes escritos a mano. Nota de diseño: el motor pone cualquier vencida de **menos de 7 días** por encima de todo (es su regla), así que la única vencida del dataset lleva 9 días de retraso: sigue visible en el Radar y en Vencidas, pero no le quita el primer lugar al parcial.

**Recordatorios:** los automáticos los genera la regla real (se simula que las actividades se registraron en los días previos, así que los que ya vencieron son el resultado honesto de la regla); las completadas no tienen ninguno pendiente; los de la vencida ya figuran como vistos (si no, el panel repetiría «venció hace 9 días»); hay uno **manual** (2 días antes de la presentación, 8:00) y **2 vencidos** en el panel (Parcial 1 y la tarea de formularios).

No se guarda nada derivado (categoría del Radar, atención, progreso, carga): todo se calcula al leer. La Captura rápida y la Bandeja no tienen historial, así que no hay nada que sembrar; la importación de horario se demuestra con un archivo sintético.

## Recorrido sugerido (8–12 minutos)

**Historia:** «Soy un estudiante con seis materias y varios compromisos esta semana. Veamos cómo la app reduce la fricción de organizarme.»

| #   | Momento                  | Qué mostrar y qué decir                                                                                                                                                                                           | Fase |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Inicio de sesión         | Entrar con la cuenta demo. Es autenticación real: sesión en el servidor y cookie `HttpOnly`.                                                                                                                      | F2   |
| 2   | Dashboard                | Panorama: recordatorios, resumen, clases de hoy, próximas entregas.                                                                                                                                               | F5   |
| 3   | ¿Qué hago ahora?         | **Parcial 1 de Redes**, con sus razones. No usa IA: es un algoritmo determinístico que considera urgencia, prioridad y estado, y siempre explica por qué.                                                         | F9   |
| 4   | Radar                    | Cinco bandas. No «predice»: **clasifica según el tiempo restante**.                                                                                                                                               | F8   |
| 5   | Agenda                   | La semana de clases; agregar o editar un bloque; avisa de choques sin impedirlos.                                                                                                                                 | F6   |
| 6   | Actividades              | Filtros, estados, edición; una vencida «derivada» (no se guarda).                                                                                                                                                 | F4   |
| 7   | Captura rápida           | Escribir en vivo `parcial seguridad martes 10am` → vista previa → **no confirmar** (o confirmar y restablecer después). Nada se crea hasta confirmar.                                                             | F11  |
| 8   | Bandeja académica        | Pegar: «Buenas tardes. El jueves tendremos quiz de Bases de Datos a las 8 a. m. y el viernes deben entregar un taller de Bioestadística.» → dos propuestas revisables.                                            | F12  |
| 9   | Importar horario (OCR)   | Subir una imagen sintética de horario (el fixture de las pruebas de la Fase 14). PDF con texto → extracción nativa; imagen o escaneo → OCR local. No promete lectura perfecta: siempre hay vista previa editable. | F14  |
| 10  | Progreso y carga semanal | Progreso por asignatura (una con 50 %, otras en 0 %) y carga de la semana; solo describe lo registrado, sin juicios.                                                                                              | F10  |
| 11  | PWA                      | Instalación si el navegador la ofrece (no es el centro de la demo). Sin conexión carga el shell; los datos requieren conexión.                                                                                    | F13  |

Trazabilidad: Dashboard → F5/F7/F8/F9/F10 · Quick Capture → F11 · Inbox → F12 · PWA → F13 · OCR → F14 · UX/accesibilidad → F15 · seguridad → F16.

### Qué NO modificar antes de mostrar

- No finalices **Parcial 1 de Redes** si quieres empezar enseñando «¿Qué hago ahora?»: pasaría a recomendar otra.
- No borres actividades ni cambies fechas antes de enseñar el Radar y el progreso.
- Si lo hiciste, restablece: `npm run db:seed:demo -- --allow-demo` y vuelve a iniciar sesión.

### Antes de cada presentación

Ejecuta el restablecimiento (arriba) **el mismo día**: el dataset se calcula respecto a «ahora», así que hechos como «vence en 6 horas» son ciertos solo al ejecutarlo y se desplazan con las horas.

## Límites conocidos (decirlos con naturalidad)

- El OCR puede requerir revisión: por eso siempre hay vista previa editable.
- No hay sincronización con calendarios externos.
- Sin conexión solo carga el shell: no hay CRUD sin conexión.
- No hay IA generativa: todo es determinístico y explicable.
- Pendiente validar en dispositivos móviles físicos (iOS/Android); lo medido es emulación a 360, 768 y 1366 px.
- La demo prueba que el sistema **funciona**; no afirma ningún efecto sobre el rendimiento académico de nadie.

## Pruebas

`apps/api/src/demo/demoSeed.test.ts` (BD de test, nunca la de desarrollo): guardas, comando real con códigos de salida, primera y segunda ejecución, restablecimiento, preservación de otros usuarios, fallo a mitad, inicio de sesión real, Radar, Atención, Progreso, Carga, Dashboard, Agenda, recordatorios, propiedad, y cinco fechas de borde (lunes 00:01, domingo 23:59, fin de mes, fin de año, 29 de febrero). `e2e/demo-seed.spec.ts`: el recorrido en el navegador (360 y 1366 px) con axe y sin desbordes. Ninguna otra prueba depende del seed.
