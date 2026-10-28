# One image recipe for both apps: `docker build --target api .` and `docker build --target web .`
# (used by deploy/docker-compose.yml). Node 24 and pnpm 12, as in .nvmrc and package.json.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The web app bakes the API address in at build time (NEXT_PUBLIC_*).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEMO_LOGIN=off
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_DEMO_LOGIN=$NEXT_PUBLIC_DEMO_LOGIN
RUN pnpm --filter @leadpilot/shared build \
 && pnpm --filter api db:generate \
 && pnpm --filter api build \
 && pnpm --filter web build

FROM build AS api
ENV NODE_ENV=production
EXPOSE 3001
# Migrations first (safe to run on every start), then the API and its queue workers.
CMD ["sh", "-c", "pnpm --filter api db:deploy && node apps/api/dist/main"]

FROM build AS web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
