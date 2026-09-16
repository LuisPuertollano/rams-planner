#!/bin/sh
set -e

# El esquema ya lo aplicó el job `migrate`. Aquí sólo se siembra la demo, y sólo
# si la base está vacía: `seed-demo` no toca nada si ya hay proyectos.
if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Comprobando los datos de demostración…"
  node /app/packages/api/dist/cli.js seed-demo
fi

exec node /app/packages/api/dist/server.js
