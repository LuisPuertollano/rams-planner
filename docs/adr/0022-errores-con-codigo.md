# ADR-0022 — Los errores de la API, con código

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1

## Contexto

Último trozo de [ADR-0017](0017-cuatro-idiomas.md), y el más incómodo de los
tres. Los hallazgos ([ADR-0020](0020-hallazgos-traducidos.md)) y el catálogo de
permisos ([ADR-0021](0021-permisos-traducidos.md)) ya tenían un código estable:
sólo había que escribir las frases. Los errores no lo tenían.

De los treinta y siete sitios en que la API responde con un error, **veintiuno
mandaban una frase suelta y nada más**:

```ts
return reply.status(422).send({ error: 'Un documento no se espera a sí mismo.' })
```

Lo único que llegaba a la interfaz era texto castellano. No hay forma de
traducir eso: para poder decirlo en alemán hay que saber *qué* pasó, y una
cadena no lo dice. Así que esto es más refactor que traducción.

Y había un caso peor que el de no tener código: **tener el equivocado**. Tres
caminos del guardián respondían `code: 'SIN_PERMISO'` para un fallo de
configuración —una ruta sin permiso declarado, un permiso fuera del catálogo, un
proyecto que no se pudo resolver—. Quien lo lee entiende «te falta un permiso»,
y lo que pasa es que a la ruta le falta el suyo. Son dos conversaciones
distintas con quien administra.

## Decisión

**Un catálogo de códigos en la API y un solo sitio por el que salen.**
`packages/api/src/errors.ts` declara `ERROR_CODES` —treinta y seis— y expone
`fallar(reply, status, code, mensaje)`. Ninguna ruta vuelve a escribir un
`reply.status(...).send({ error })`.

El orden de los argumentos es el orden de importancia: el código primero. La
frase castellana va detrás porque es el **respaldo**, no el contenido.

La interfaz escribe la frase desde el código, y cae en tres escalones:

1. El código está en el diccionario → la frase en el idioma de quien mira.
2. Es un error de la API con un código que esta versión no conoce → la frase
   castellana que mandó el servidor. Dice la verdad aunque no sea su idioma.
3. No hubo respuesta —la red, el navegador— → la frase de respaldo que pone
   quien llama, que sí está traducida.

El tercer escalón arregla algo que no era de traducción: antes se enseñaba
`cause.message`, y el `message` de un fallo de red es `Failed to fetch`. Inglés
del navegador, en medio de una pantalla en alemán, y sin decir nada.

### El permiso denegado se reconstruye en la interfaz

Era el error mejor escrito de todos —dice qué falta y **dónde**, que es la mitad
que más se pregunta— y por eso era el más difícil de mover. El servidor manda
ahora `permiso`, `etiqueta` y `donde`, y la interfaz monta la frase con la
etiqueta ya traducida, que existe desde ADR-0021.

El `donde` es un discriminante con tres valores —`toda-la-herramienta`,
`este-proyecto`, `sin-mas`— porque son tres frases distintas y **cuál toca lo
sabe el servidor**. Mandar el alcance en crudo y que la interfaz deduzca la
frase habría puesto la decisión de autorización en dos sitios.

### Un código por situación, no por código de PostgreSQL

`describeDbError` vivía dos veces, en `plan-routes` y en `resources-routes`,
casi igual pero no: el mismo `23503` significa «una referencia que se ha
perdido» al guardar una tarea y «el calendario no existe» al guardar una
persona. Dos copias de un `switch` sobre los mismos códigos es fácil de
arreglar a medias.

Ahora es una función con un `ambito`, que es exactamente la variable que
explicaba la diferencia. Y tiene prueba propia, porque es la única parte de
`errors.ts` con decisiones.

### La regla comprueba dos cosas, y la segunda es la que importa

`pnpm check:errores`, en `tools/`, junto a las otras dos y por la misma razón.
Comprueba que no falte ni sobre una frase, en los dos sentidos. Y comprueba
algo más: **que ninguna ruta se escriba su propia frase por detrás**, buscando
un `.send(` con una clave `error:` en cualquier fichero de la API.

Traducir los veintiún errores que había fue trabajo de una tarde. Lo que cuesta
es que el número veintidós no vuelva a nacer como una frase suelta, que es
exactamente como nacieron los veintiuno.

### Tres fallos que sólo aparecen cuando se mira

Dar código a los errores obligó a probarlos uno a uno, y tres no hacían lo que
decían.

**El manejador global de errores no corría nunca.** Estaba al final de
`buildServer`, después de registrar las rutas, y en Fastify cada ruta se queda
con el manejador que hubiera en su contexto al registrarla. El resultado: un
error del motor salía con el 500 de serie —`Internal Server Error`, sin `code`—
y el `code` del calendario que se suponía que viajaba al cliente no viajaba. Se
registra ahora antes que las rutas.

**Una URL mal escrita decía «avisa a quien administra».** El comodín de
`fastify-static` recoge todo lo que no encajó antes, `/api/lo-que-sea` incluido,
así que el guardián lo veía como una ruta declarada —`/*`— sin permiso, y
respondía el 403 de configuración. El `ENDPOINT_DESCONOCIDO` que había para
esto era código muerto. Ahora el plugin se registra con `wildcard: false` y el
guardián deja pasar lo que no tiene ruta declarada: no abre nada, porque no hay
manejador al que llegar.

**Un formulario mal relleno devolvía el volcado JSON de Zod**, con sus `path` y
sus códigos internos. Ahora es `DATOS_INVALIDOS` con la lista de campos y qué
le pasa a cada uno.

## Alternativas descartadas

**Un código por código de PostgreSQL** (`PG_23503`) en vez de por situación.
Traslada a la interfaz la pregunta «¿y esto qué significa aquí?», que es justo
lo que el servidor sabe y ella no.

**Dejar que la interfaz enseñe siempre el `message` del servidor** y traducir
sólo lo nuevo. Es lo que había, y su resultado es una pantalla en alemán con un
párrafo en castellano cada vez que algo va mal. Un error es lo último que
debería no entenderse.

**Negociar el idioma en el servidor** (`Accept-Language`). Ya se descartó en
ADR-0017 para los hallazgos y aquí vale igual: mete el idioma de quien pregunta
en el sitio donde se decide si una petición pasa.

## Coste aceptado

- Un error nuevo obliga a tocar el catálogo y cuatro diccionarios. Lo obliga CI,
  y la regla dice qué falta y dónde ponerlo.
- El manejador global de `build-server.ts` sigue mandando un error sin pasar por
  `fallar`, a propósito: reenvía un código que no acuñó él —del calendario o del
  motor— y por tanto no está en este catálogo. Es uno de los dos ficheros
  exentos de la regla, y el otro es `errors.ts`.
- **Los errores del calendario no se traducen todavía.** Tienen código estable
  (`CALENDAR_CYCLE`, `OUT_OF_HORIZON`, …) y llegan al cliente, así que el
  segundo escalón los enseña en castellano. Traducirlos pide el mismo trabajo de
  payload que los hallazgos, y sus frases son diagnósticos interpolados de una
  definición de calendario mal hecha, no errores de una pantalla. Es otro
  trabajo, no éste.
