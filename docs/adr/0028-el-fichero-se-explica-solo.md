# ADR-0028 — El fichero que se pide se explica antes de pedirlo

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P6

## Contexto

Hay tres importaciones por CSV: el plan, el parte de horas y el catálogo de
entregables. Las tres funcionaban. Y las tres fallaban en lo mismo, dicho por
quien se topó con ello:

> «¿Me das plantillas de cómo esperas que te mande la información? El CSV puede
> tener mil formas y no sé lo que esperas.»

Tenía razón, y de tres maneras distintas:

- **El botón «Plantilla» no decía que fuera la respuesta a esa pregunta.**
  Estaba al lado del de importar, con una palabra, sin explicar qué traía.
- **La plantilla no explicaba ninguna columna.** Traía una cabecera y dos o tres
  filas de ejemplo. Para saber si `dedicacion` era un porcentaje o una fracción,
  o si `fecha` admitía `02/03/2026`, había que leer el código.
- **En el parte de horas, el enlace a la plantilla sólo aparecía dentro del
  panel de resultados**, o sea **después** de importar. Justo cuando ya no
  sirve.

Y por debajo de los tres, el mismo problema de fondo: el contrato —qué columnas
hay, cuáles hacen falta, qué significa cada una— estaba **sólo en el parser**, y
el parser no habla con nadie hasta que algo falla.

## Decisión

### El contrato vive en un sitio, y de ahí salen las dos cosas que lo cuentan

`packages/api/src/import-specs.ts`: por cada importación, su título, su resumen,
sus reglas, y por cada columna el nombre, si hace falta, qué es y **un ejemplo
de verdad** —un valor que se copia y funciona, no un `<texto>`—.

De ahí salen:

- **La plantilla descargable**, con el manual dentro del propio fichero.
- **La tabla de la pantalla**, que la interfaz **pide a la API**
  (`GET /api/import/:tipo/formato`) en vez de llevar su propia copia. Una copia
  se queda vieja el día que alguien añade una columna al parser; esto no puede.

Es el mismo razonamiento que ADR-0020 y ADR-0022: el servidor manda lo estable
y quien lo enseña escribe la frase.

### El CSV admite comentarios

Una línea cuya primera celda empieza por `#` no es un dato. Es lo que permite
que el manual viaje dentro del fichero, y que **las filas de ejemplo vayan
comentadas**.

Eso último importa más de lo que parece. Si el ejemplo fuera una fila normal,
quien rellenara la plantilla sin fijarse se encontraría tres entregables
inventados dentro de su catálogo, y descubrirlo cuesta bastante más que
evitarlo. Comentado, el ejemplo se ve, se copia y no entra; para probarlo, se le
quita un carácter.

El detector de separador tuvo que aprender lo mismo: mira la primera línea que
**no** sea un comentario. Con el manual delante, una línea de prosa sin puntos y
coma habría hecho elegir la coma, y el fichero entero se habría leído como una
sola columna.

### Pulsar «Importar» abre una explicación, no un selector de ficheros

El panel enseña, por ese orden: qué hace la importación, las reglas que conviene
saber antes de rellenar nada, la tabla de columnas con su ejemplo, los botones
de descarga, y **sólo entonces** el de elegir el fichero.

Donde ya hay datos, se ofrece además **exportar lo que hay**, que es la mejor
plantilla que existe: trae las columnas reales con los valores reales. Exportar,
corregir en la hoja de cálculo y volver a importar es el camino corto para tocar
ochenta filas, y por eso la exportación del catálogo usa las columnas del
contrato de importación y no una lista propia.

### La plantilla pasa su propio importador, y hay una prueba que lo exige

Veinte pruebas sobre las tres plantillas: que la cabecera lleve todas las
columnas en su orden, que el manual explique cada una y cada regla, que **tal
cual se descarga no importe nada**, que quitando las almohadillas se lea entera
y con cada valor en su columna, y que cada columna obligatoria traiga un valor
en el primer ejemplo.

La prueba que las sostiene todas es la penúltima: descargar, descomentar y
subir tiene que funcionar. Una plantilla que no pasa su propio importador es
peor que no tener plantilla, porque manda a alguien a buscar un error que no es
suyo.

## Alternativas descartadas

**Escribir la tabla de columnas en la interfaz.** Es una copia, y las copias se
separan. El día que alguien añada una columna al parser, la pantalla mentiría
sobre lo que hace falta.

**Filas de ejemplo sin comentar.** Más cómodo de probar y con una trampa: los
ejemplos acaban dentro de los datos de alguien.

**Un asistente que mapee las columnas del fichero de quien importa.** Es la
solución grande, y es otra herramienta: detectar que su columna «Aufwand» es
nuestra `horas` pide una pantalla de correspondencias con su propia memoria.
Antes de eso conviene saber si hace falta; con el contrato a la vista, puede que
no.

**Traducir la plantilla descargable.** Sería un `?idioma=` en la ruta y cuatro
versiones de cada manual. Ver el coste aceptado.

## Coste aceptado

- **Un valor que empiece por `#` en la primera columna se pierde.** En las tres
  importaciones esa columna es un código de proyecto o de entregable, donde `#`
  no aparece. Es el precio de que la plantilla pueda traer su manual, y se paga
  a sabiendas.
- **El texto del contrato está sólo en castellano.** La interfaz ya lo pide por
  clave (`importar.<tipo>.col.<columna>`) y cae al texto del servidor cuando no
  la tiene, así que traducirlo es añadir claves y nada más: ni una línea de
  componente. Pero hoy, en alemán, la tabla de columnas se lee en castellano. Va
  con la deuda que apuntó ADR-0026.
- **Las rutas de las plantillas se movieron** a `/api/import/:tipo/plantilla.csv`
  para que las tres vivan en el mismo sitio. Las anteriores desaparecen; la
  herramienta tiene una sola instalación y un día de vida.
- **El panel carga el contrato al abrirse.** Es una petición pequeña y sólo
  cuando alguien va a importar, pero es una petición: sin red, el panel se queda
  en «Cargando…» y lo dice.
