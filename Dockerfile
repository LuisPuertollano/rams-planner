# Una sola imagen: la API sirve también la interfaz compilada. Un contenedor,
# un origen, cero configuración de CORS para quien lo levanta.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig*.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @planner/web build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S planner && adduser -S planner -G planner

COPY --from=build --chown=planner:planner /app/node_modules ./node_modules
COPY --from=build --chown=planner:planner /app/packages ./packages
COPY --from=build --chown=planner:planner /app/package.json ./package.json
COPY --chown=planner:planner docker/entrypoint.sh /usr/local/bin/entrypoint.sh

USER planner
EXPOSE 45678
ENV WEB_ROOT=/app/packages/web/dist
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
