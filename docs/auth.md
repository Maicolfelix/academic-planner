# Autenticación y seguridad de sesión (Fase 2)

## Estrategia

Sesiones **server-side** en PostgreSQL.

1. `register` / `login` generan un token de 32 bytes con `crypto.randomBytes` (CSPRNG, base64url).
2. La cookie `academic_planner_session` lleva el token. La BD guarda solo `SHA-256(token)` en `Session.tokenHash`.
   SHA-256 basta (y es lo correcto) porque el token ya tiene 256 bits de entropía; no hace falta un hash lento.
3. Cada request autenticado: cookie → hash → `Session` → comprobar `expiresAt` → `User`.
4. `logout` **borra la fila** `Session`: el token deja de existir en el servidor, aunque alguien conserve la cookie.
5. Cada login emite un token nuevo (sin fijación de sesión). Borrar un usuario borra sus sesiones (`ON DELETE CASCADE`).

| Decisión               | Valor                                       | Motivo                                                                                        |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| IDs                    | UUID v4 (`@db.Uuid`)                        | No enumerables (base para evitar IDOR), tipo nativo de 16 bytes                               |
| Hash de contraseña     | Argon2id, m=64 MiB, t=3, p=1                | Recomendado por OWASP; parámetros explícitos para que un cambio de default no debilite hashes |
| Duración de sesión     | 7 días fijos                                | Evita re-login diario sin dejar una cookie robada válida indefinidamente                      |
| Política de contraseña | 8–128 caracteres, sin reglas de composición | Longitud sobre complejidad (NIST SP 800-63B); 128 solo acota el coste de hashing              |
| Email                  | `trim` + minúsculas, índice único           | Un solo formato almacenado; la unicidad la garantiza la BD (también ante carreras)            |

## Cookie

`academic_planner_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` y `Secure` cuando `NODE_ENV=production`.
JavaScript no puede leerla (HttpOnly) y el frontend no guarda nada en `localStorage`/`sessionStorage`.

## Endpoints

| Método y ruta             | Resultado                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/auth/register` | 201 `{user}` + cookie. 400 `VALIDATION_ERROR`, 409 `EMAIL_ALREADY_EXISTS`, 429 `RATE_LIMITED` |
| `POST /api/auth/login`    | 200 `{user}` + cookie. 401 `INVALID_CREDENTIALS` (mensaje genérico), 400, 429                 |
| `POST /api/auth/logout`   | 204, revoca la sesión y limpia la cookie (idempotente)                                        |
| `GET /api/auth/me`        | 200 `{user}` o 401 `UNAUTHENTICATED`                                                          |

`user` = `{id, name, email, timezone, createdAt}`. Nunca se devuelve `passwordHash`.
El login no distingue "correo inexistente" de "contraseña incorrecta" (mismo código, mensaje y tiempo aproximado: para un correo
desconocido se ejecuta una verificación Argon2 contra un hash ficticio).

Rutas protegidas: `requireAuth` deja el usuario en `req.auth`; los handlers lo leen con `authOf(req)` (tipado, sin casts).

## CSRF: qué protege y qué no

Controles: `SameSite=Lax` + verificación de origen en métodos mutativos (`POST/PUT/PATCH/DELETE` bajo `/api`):

- `Origin` presente → debe estar en `CORS_ORIGIN`.
- Sin `Origin` pero con `Sec-Fetch-Site` → debe ser `same-origin` o `none`.
- Sin ninguno → cliente no-navegador (curl, tests): se permite, porque un navegador no puede producir esa petición.

Protege contra: formularios/`fetch` desde otros sitios que intenten usar la cookie de la víctima.

Limitaciones:

- No es un token CSRF sincronizado: confía en que el navegador envíe `Origin`/`Sec-Fetch-Site` (todos los navegadores actuales lo hacen).
- `SameSite=Lax` no protege contra otro origen _same-site_ (subdominios). Mientras `CORS_ORIGIN` sea solo la app, no aplica.
- Los métodos `GET` no se verifican: **nunca** deben tener efectos secundarios.
- En producción `CORS_ORIGIN` debe contener el origen público exacto de la app.

## Rate limiting

`express-rate-limit`, en memoria, por IP:

| Ruta                  | Límite                                | Cuenta                                                           |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `POST /auth/login`    | 10 / 15 min (`LOGIN_RATE_LIMIT_MAX`)  | solo respuestas fallidas (los logins correctos no consumen cupo) |
| `POST /auth/register` | 20 / hora (`REGISTER_RATE_LIMIT_MAX`) | todas                                                            |

Exceso → 429 `RATE_LIMITED`. Los tests inyectan sus propios límites; Playwright arranca la API con límites altos.

Limitaciones conocidas: el contador vive en memoria (se reinicia con el proceso y no se comparte entre instancias);
es por IP, no por cuenta (no frena ataques distribuidos); tras un proxy inverso hace falta configurar `trust proxy`
para ver la IP real. Revisar en la Fase 16 y en el despliegue.

## Base de datos de pruebas

- `TEST_DATABASE_URL` (por defecto `academic_planner_test`, mismo servidor Docker). **Debe terminar en `_test`** y ser distinta de `DATABASE_URL`;
  si no, los tests se niegan a ejecutar (`apps/api/test/testDb.ts`).
- Antes de cada ejecución de Vitest (`globalSetup`) y de Playwright (`e2e/globalSetup.ts`): se crea la BD si no existe,
  se aplican las migraciones (`prisma migrate deploy` apuntando a la BD de test) y, en Playwright, se vacían las tablas.
- Cada test de integración vacía todas las tablas (`TRUNCATE … CASCADE`, protegido por una comprobación de `current_database()`).
- Los tests usan PostgreSQL real, sin mocks de Prisma. Los archivos de test corren en serie porque comparten BD.
- Playwright arranca **su propio** `npm run dev` apuntando a la BD de test; la BD de desarrollo no se toca.
