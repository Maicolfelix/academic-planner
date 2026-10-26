# syntax=docker/dockerfile:1
#
# Academic Planner: one image, one origin. The Node process serves /api AND the built web app (WEB_DIST_DIR), so a
# reverse proxy / platform only has to terminate TLS and forward to it. Provider-neutral: nothing here knows a host.
#
#   docker build -t academic-planner .                              # the web process (default target: runtime)
#   docker build --target migrate -t academic-planner-migrate .     # the schema deployment step (a job, not the web process)
#
# Secrets (DATABASE_URL…) are NEVER baked in: they are passed at run time. Migrations are NOT run when the web process
# starts; `migrate` is a separate, explicit step. See docs/deployment.md.

ARG NODE_VERSION=24

# ── base: Node on Debian (glibc: the native modules ship prebuilt binaries for it) plus the two things Prisma and TLS need ──
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update  && apt-get install -y --no-install-recommends openssl ca-certificates  && rm -rf /var/lib/apt/lists/*

# ── build: all dependencies, compile core + API + web ──────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY . .
# `npm ci` runs the root postinstall (builds @planner/core and generates the Prisma client); native modules (argon2,
# @napi-rs/canvas) are installed here, for THIS operating system, never copied from the host.
RUN npm ci && npm run build

# ── migrate: the explicit schema step (`prisma migrate deploy`), with the CLI and the migrations ───────────────────
FROM build AS migrate
USER node
CMD ["npm", "run", "db:deploy"]

# ── prod-deps: only what the web process needs ─────────────────────────────────────────────────────────────────────
FROM build AS prod-deps
RUN npm prune --omit=dev \
 && mkdir -p /out/packages/core /out/apps/api /out/apps/web \
 && cp -a node_modules package.json /out/ \
 && cp -a packages/core/package.json packages/core/dist /out/packages/core/ \
 && cp -a apps/api/package.json apps/api/dist /out/apps/api/ \
 && if [ -d apps/api/node_modules ]; then cp -a apps/api/node_modules /out/apps/api/; fi \
 && cp -a apps/web/dist /out/apps/web/

# ── runtime: the web process (default target) ──────────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
# The image DECLARES production and where the built web app is (a path inside the image, not a host path); the code never
# assumes either. CORS_ORIGIN (the exact public origin) and DATABASE_URL have no default: the process refuses to start
# without them. The platform may inject PORT; API_PORT wins if both are set; neither -> 3000.
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist
COPY --from=prod-deps /out/ ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/api/dist/server.js"]
