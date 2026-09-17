# ADR-0025 — CI construye la imagen y la arranca

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** —

## Contexto

Esto no es una decisión de diseño: es la respuesta a una avería, y se escribe
porque el siguiente que se pregunte «¿por qué CI tarda un minuto más?» merece
saberlo.

Al crear `packages/report` en [ADR-0019](0019-informes.md) no se añadió a las
dos listas del `Dockerfile`. La imagen salió sin ese paquete y el contenedor se
moría al arrancar:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@planner/report'
  imported from /app/packages/api/dist/report-routes.js
```

Lo que duele es **todo lo que pasó en verde por encima**: el lint, los tipos,
las cuatro reglas de `tools/`, cuatrocientas y pico pruebas, las migraciones,
las invariantes de la base, y hasta el paso que aplica las migraciones sobre una
instalación con datos viejos. Nada de eso podía cazarlo: **todas las pruebas
corren en el workspace**, donde el enlace de pnpm existe porque lo crea
`pnpm-workspace.yaml`. La imagen es el único sitio donde la lista del
`Dockerfile` importa, y CI no la construía nunca.

Entre el `merge` y el descubrimiento pasó un día entero, con la única
instalación que hay arrancando y muriéndose en cada despliegue.

## Decisión

**Dos cosas, y hacen falta las dos.**

### 1. Un trabajo de CI que construye la imagen y la arranca

```yaml
- run: docker compose up -d --build --wait
- run: curl -fsS http://127.0.0.1:45678/api/health
- run: curl -fsS http://127.0.0.1:45678/ | grep -q 'id="root"'
```

`--wait` es lo que hace el trabajo: espera a los healthchecks y **falla si un
contenedor se sale**, que es exactamente lo que pasó. Las tres peticiones
comprueban lo que la imagen promete y ninguna prueba del workspace puede: que la
API responde, que la interfaz compilada se sirve desde el mismo contenedor, y
que la API contesta con su catálogo.

Y volcar `docker compose logs` cuando falla. Sin eso, un fallo aquí sólo diría
«no arrancó» y habría que reproducirlo a mano; con eso, el `ERR_MODULE_NOT_FOUND`
está en el propio fallo de CI, que es donde alguien lo va a leer.

### 2. Una regla que compara las dos listas con el disco

`pnpm check:docker`, en `tools/` junto a las otras cuatro. Lee las carpetas de
`packages/` y las dos listas del `Dockerfile`, y comprueba en los dos sentidos.

Es redundante con el trabajo de arriba **a propósito**, y por dos razones. Tarda
milisegundos en vez de dos minutos, así que salta en el `pnpm verify` de quien
escribe el código y no veinte minutos después. Y dice **qué** falta y **dónde
ponerlo**, mientras que el contenedor sólo dice que se murió.

La otra mitad de la redundancia también importa: la regla caza el paquete que
falta, pero no cazaría una dependencia de producción sin declarar, ni un
`entrypoint.sh` roto, ni un `WEB_ROOT` mal puesto. Para eso hace falta arrancar.

## Alternativas descartadas

**Dejar de enumerar los paquetes en el `Dockerfile`** y copiar el árbol entero.
Es lo que quita el problema de raíz, y cuesta la caché: los `package.json` se
copian solos y antes del `pnpm install --prod` precisamente para que esa
instalación —lo más lento de la imagen— sólo se repita cuando cambia una
dependencia, no cuando cambia una línea de código. `COPY --parents` de BuildKit
lo resolvería sin perder nada, pero ata la imagen a una versión de BuildKit
reciente para ahorrar una regla de veinte líneas.

**`COPY packages/*/package.json ./packages/`** no vale: Docker aplana los
directorios y los ocho ficheros se sobreescriben en uno.

**Sólo la regla, sin arrancar el contenedor.** Habría cazado *esta* avería y
ninguna de su familia. El agujero no era la lista: era que nadie arrancaba la
imagen antes que el usuario.

## Coste aceptado

- CI tarda algo más de un minuto extra. Es el trabajo que corre en paralelo con
  los otros dos, así que el reloj de pared sube menos que eso.
- El trabajo del contenedor necesita Docker en el runner. `ubuntu-latest` lo
  trae; un runner propio sin Docker dejaría este trabajo en rojo y habría que
  decidir qué hacer entonces.
