# Respaldo y restauración de PostgreSQL (procedimiento mínimo)

> **Estado: procedimiento documentado, NO ensayado.** No hay scripts, planificador ni software de respaldo propios: el proyecto no los implementa ni se crea un _scheduler_ nuevo. Esto es lo mínimo para una base PostgreSQL **persistente** (la de producción o preproducción). El **ensayo de restauración** con evidencia es un requisito del release gate (RG-3): hasta que se haga, la restauración no está validada. Como no hay base persistente, RG-3 lo ensaya con una base PostgreSQL 17 local, nueva y desechable ([paso a paso](rg3-procedure.md#6-respaldo-y-restauración-postgresql-17-local-aislado)); eso valida el procedimiento, no las copias de un proveedor.

## Qué se protege

La base de datos es el único estado: cuentas, sesiones, periodos, estudios, asignaturas, actividades, agenda, notas y recordatorios. La aplicación no guarda archivos ni los textos o imágenes que se interpretan (la importación y las capturas no se almacenan). Las variables de entorno y los secretos **no** están en la base y se resguardan aparte.

## En producción

1. **Copias automáticas del proveedor de PostgreSQL** (con retención y restauración a un punto en el tiempo si el proveedor la ofrece). Es la protección principal y la decisión del proveedor la toma el mantenedor.
2. **Copias lógicas adicionales** con `pg_dump`, antes de cada despliegue que incluya una migración y de forma periódica según lo que se acuerde.
3. **Guardar las copias fuera del servidor de la base** y con acceso restringido: contienen datos personales (correos y hashes de contraseña). Cifrarlas en reposo si el medio no lo hace.

## Copia (backup)

```bash
# formato personalizado: comprimido y restaurable por partes con pg_restore
pg_dump --format=custom --no-owner --file "planner-$(date +%F).dump" "$DATABASE_URL"
```

- Usa un `pg_dump` de la **misma versión mayor o superior** que el servidor (PostgreSQL 17).
- No pongas la contraseña en la línea de comandos ni en el historial: usa `PGPASSWORD`/`~/.pgpass` o la variable de entorno de la plataforma.
- Anota la versión de la aplicación (commit/tag) que estaba desplegada: el esquema de la copia corresponde a sus migraciones.

## Ensayo de restauración (obligatorio antes del release, repetir tras cambios mayores de esquema)

**Nunca restaures sobre la base de producción para probar.** Siempre sobre una base vacía y desechable.

```bash
# 1. una base vacía y desechable
createdb planner_restore_test

# 2. restaurar la copia
pg_restore --no-owner --dbname planner_restore_test "planner-AAAA-MM-DD.dump"

# 3. el esquema coincide con las migraciones del commit desplegado
DATABASE_URL=postgresql://…/planner_restore_test npm run db:deploy   # no debe aplicar nada nuevo
```

4. **Arrancar la aplicación** apuntando a esa base (`DATABASE_URL` de la base desechable, el resto de la configuración de preproducción).
5. **Salud:** `curl -i http://localhost:3000/api/health` debe dar `200` con `"database":"up"`.
6. **Humo mínimo:** iniciar sesión con una cuenta conocida de la copia, abrir el Inicio, ver una actividad y una asignatura, y crear una actividad nueva. Comparar los recuentos de tablas clave (`User`, `Activity`, `Subject`) entre la base de origen y la restaurada.
7. **Registrar la evidencia** (fecha, tamaño de la copia, duración de la restauración, versión del servidor y resultado) y borrar la base desechable (`dropdb planner_restore_test`).

## Criterio

El respaldo cuenta como validado solo si el ensayo completo (pasos 1 a 7) se hizo con una copia **real** de preproducción y quedó la evidencia. Una copia que nunca se restauró no es una copia.

## Fuera de alcance

Sin replicación ni conmutación por error, sin respaldo continuo propio, sin retención automatizada por el proyecto y sin monitoreo de las copias: son decisiones del proveedor elegido.
