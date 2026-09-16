#!/bin/sh
set -e

# En la imagen la aplicación vive en /app. APP_ROOT permite ejecutar este mismo
# guion fuera del contenedor, que es la única forma de probarlo de verdad.
APP_ROOT="${APP_ROOT:-/app}"

# El esquema ya lo aplicó el job `migrate`. Aquí sólo se siembra la demo, y sólo
# si la base está vacía: `seed-demo` no toca nada si ya hay proyectos.
if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Comprobando los datos de demostración…"
  node "$APP_ROOT/packages/api/dist/cli.js" seed-demo
fi

exec node "$APP_ROOT/packages/api/dist/server.js"
