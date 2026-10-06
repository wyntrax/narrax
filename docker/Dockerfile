# One image for the API, the worker and the migration job. The command picks which one runs (see docker-compose.prod.example.yml).
# The code runs with tsx straight from the TypeScript source, as in development: there is no separate build step in this repo.
# The image is therefore larger than a compiled one. A compiled build is a possible later change.
#
# NOT BUILT OR RUN when this was written (no Docker in the build environment). Build it once and check /health before relying on it.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# .dockerignore keeps .env files, node_modules and git history out of the image. Secrets are passed at run time, never baked in.
COPY . .

# Dev dependencies are needed at run time: tsx runs the TypeScript, and the prisma CLI runs migrations.
RUN npm ci --include=dev --no-audit --no-fund \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --schema packages/database/prisma/schema.prisma \
 && chown -R node:node /app

ENV NODE_ENV=production
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "apps/api/src/server.ts"]
