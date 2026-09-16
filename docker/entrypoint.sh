#!/bin/sh
set -e

# En la imagen la aplicación vive en /app. APP_ROOT permite ejecutar este mismo
# guion fuera del contenedor, que es la única forma de probarlo de verdad.
APP_ROOT="${APP_ROOT:-/app}"

echo "RAMS Planner: arrancando desde $APP_ROOT"

# El esquema ya lo aplicó el job `migrate`. Aquí sólo se siembra la demo, y sólo
# si la base está vacía: `seed-demo` no toca nada si ya hay proyectos.
#
# Si la siembra falla, se dice y se sigue. Es un juego de datos de ejemplo: que
# se caiga no es razón para dejar la herramienta sin arrancar, y un contenedor
# muerto explica mucho peor lo que ha pasado que una herramienta vacía con un
# aviso en el log.
if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "RAMS Planner: comprobando los datos de demostración…"
  if ! node "$APP_ROOT/packages/api/dist/cli.js" seed-demo; then
    echo "RAMS Planner: la siembra de demostración ha fallado. Se arranca igual," >&2
    echo "              con la base como esté. Mira el error de aquí arriba." >&2
  fi
fi

echo "RAMS Planner: sirviendo en el puerto ${PORT:-45678}"
exec node "$APP_ROOT/packages/api/dist/server.js"
