# Una sola imagen: la API sirve también la interfaz compilada. Un contenedor,
# un origen, cero configuración de CORS para quien lo levanta.

# --- Compilación -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig*.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build && pnpm --filter @planner/web build

# --- Ejecución ---------------------------------------------------------------
# Instalación limpia de sólo producción en vez de `pnpm prune --prod`: prune
# pregunta de forma interactiva y en un build sin TTY eso es una bomba de
# relojería. Además baja node_modules de 198 MB a 37 MB.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && addgroup -S planner && adduser -S planner -G planner

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json      ./packages/domain/
COPY packages/calendar/package.json    ./packages/calendar/
COPY packages/explain/package.json     ./packages/explain/
COPY packages/scheduler/package.json   ./packages/scheduler/
COPY packages/workload/package.json    ./packages/workload/
COPY packages/persistence/package.json ./packages/persistence/
COPY packages/report/package.json      ./packages/report/
COPY packages/api/package.json         ./packages/api/
COPY packages/web/package.json         ./packages/web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /app/packages/domain/dist      ./packages/domain/dist
COPY --from=build /app/packages/calendar/dist    ./packages/calendar/dist
COPY --from=build /app/packages/explain/dist     ./packages/explain/dist
COPY --from=build /app/packages/scheduler/dist   ./packages/scheduler/dist
COPY --from=build /app/packages/workload/dist    ./packages/workload/dist
COPY --from=build /app/packages/persistence/dist ./packages/persistence/dist
COPY --from=build /app/packages/report/dist      ./packages/report/dist
COPY --from=build /app/packages/api/dist         ./packages/api/dist
COPY --from=build /app/packages/web/dist         ./packages/web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# El `sed` quita los retornos de carro. `.gitattributes` ya fuerza LF, pero esta
# línea cuesta nada y evita que un checkout hecho antes de existir ese fichero,
# o un editor despistado, deje la imagen sin arrancar por un `\r` en el shebang.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && chown -R planner:planner /app
USER planner

EXPOSE 45678
ENV WEB_ROOT=/app/packages/web/dist
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
