# ADR-0027 — La ficha del entregable, y un catálogo que se puede tocar

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P5, P6

## Contexto

[ADR-0016](0016-documentos-y-precedencias.md) declaró el catálogo de
entregables y su matriz, y lo dejó **vacío a propósito**: los entregables son
los del equipo que instala esto, no los que se le ocurran a quien escribe el
código. La decisión sigue siendo la buena, pero dejaba dos cosas sin resolver
que sólo se ven cuando llega un catálogo de verdad.

El primero llegó: **79 entregables y 129 dependencias**, extraídos de la
herramienta de Excel con la que un equipo RAMS planifica hoy. Y con él, los dos
problemas:

**Uno: la ficha era demasiado pobre.** Un `document_type` era un código, un
nombre y una descripción. El catálogo real trae además, por cada entregable,
a qué puerta de certificación va, cuántas semanas antes de esa puerta tiene que
estar terminado, el esfuerzo típico, la disciplina y el código con el que se
ficha. Sin sitio donde ponerlo, importar el catálogo es importar una lista de
nombres: la mitad de lo que hace útil el catálogo se queda fuera.

**Dos: la pantalla no aguantaba.** La rejilla funciona con nueve documentos.
Con setenta y nueve son **6.241 casillas**, y la pantalla llevaba además un
botón de borrar por documento —setenta y nueve botones en una fila—, otro de
renombrar, y una edición a base de tres `window.prompt` encadenados. No es que
fuera incómoda: es que a esa escala marcar la casilla correcta deja de ser
trabajo y pasa a ser puntería.

## Decisión

### La ficha: cinco campos más, todos declarados y todos opcionales

`kind` (documento, hito o fase), `discipline`, `gate`, `weeks_before_gate`,
`standard_minutes` y `task_code`. Todo es dato **declarado** (P1): lo escribe
una persona y el motor no lo corrige. Todo es opcional, así que un equipo que
sólo quiere nombres y flechas sigue pudiendo.

`standard_minutes` y no `standard_hours`, por P5: el minuto es la unidad. La
pantalla habla en horas y convierte al escribir.

**`weeks_before_gate` entra como dato y el motor no lo usa.** Es la regla del
DocFlowChart de la herramienta de la que salió el catálogo —`MIN(techo,
MAX(fecha_de_la_puerta − 7 × semanas, suelo))`— y meterla en el motor es otro
cambio, con su propia decisión y su propio riesgo. Guardar el dato ahora cuesta
una columna; volver a pedirlo dentro de un mes cuesta que alguien lo teclee otra
vez.

### Un hito **sí** puede traer esfuerzo

Se escribió la regla contraria —un hito es un instante, luego no tiene
esfuerzo—, con su `CHECK` en el esquema y su comprobación en el importador. El
primer catálogo real la desmintió en la primera pasada: sus nueve puertas de
revisión traen 16 h cada una, que son las de la propia reunión de revisión.

La regla se retiró. Queda escrito porque es el tipo de error que se repite: una
regla que suena bien, que nadie del dominio ha confirmado, y que rechaza datos
correctos.

### El catálogo entra y sale por CSV

`POST /api/documents/import` y `GET /api/documents/export.csv`, con las **mismas
columnas** en los dos sentidos. Exportar, corregir en la hoja de cálculo y
volver a importar es el camino corto para tocar ochenta filas, y sólo funciona
si el fichero que sale es el que entra.

Tres reglas del importador, y las tres importan:

- **El código manda.** Una fila cuyo código ya existe actualiza ese entregable.
  Cargar dos veces el mismo fichero deja el catálogo igual que cargarlo una vez.
- **`espera_a` es la lista completa de lo que espera esa fila**, no una
  añadidura: lo que no venga se borra. Es lo que hace que volver a cargar un
  fichero corregido corrija de verdad. Y sólo afecta a las filas que el fichero
  nombra, así que un fichero parcial no toca el resto. La distinción que lo
  sostiene: **columna vacía** dice «no espera a nadie» y borra; **columna
  ausente** dice «no digo nada de esto» y no toca.
- **El orden del fichero es el orden del ciclo de vida.** Un catálogo RAMS viene
  ordenado por puertas, y perder ese orden obliga a reconstruirlo a ojo.

Un ciclo **no** aborta la importación: se avisa, con la ruta entera. Es la misma
decisión que ADR-0016 tomó para la pantalla, y por el mismo motivo; pero aquí se
dice en el resumen, porque nadie va a repasar ochenta filas buscando la casilla
roja.

### La pantalla: lista primero, rejilla cuando cabe

Dos formas de mirar lo mismo, y la elección no es estética.

**Lista** — una fila por entregable, con su ficha y con sus predecesores
escritos con todas las letras. Los predecesores salen como códigos y no como una
cuenta: «espera a S-SAP y a S-SSPHA» se verifica de un vistazo, «espera a 2» no
dice nada.

**Matriz** — la rejilla de siempre, y **respeta el filtro**. Eso es lo que la
salva: filtrar a la disciplina Safety devuelve dieciséis filas, que es una
rejilla que se puede usar. Por encima de treinta entregables ya no se abre sola,
y cuando se abre con más, lo dice.

Y tres cosas que se retiran:

- La fila de setenta y nueve botones de borrar, sustituida por una ✕ en cada
  fila.
- La cadena de `window.prompt`, sustituida por un formulario. Con nueve campos,
  tres diálogos seguidos son una prueba de memoria y no dejan corregir el
  segundo sin volver a escribir el primero.
- Casilla a casilla como única forma de tocar la matriz. Ahora el editor de una
  ficha lleva la lista de «espera a», que es la fila de la matriz escrita de
  otra forma, y se guarda de una vez
  (`PUT /api/documents/:id/predecessors`).

### El filtro es la pieza, no el adorno

Texto, tipo, disciplina y puerta. Sin él, ochenta filas son una lista que nadie
recorre, y con él la rejilla vuelve a ser usable. Es lo que hace posible todo lo
demás de esta decisión.

## Alternativas descartadas

**Dejar la ficha como estaba e importar sólo nombres y flechas.** Es la mitad
del catálogo. El esfuerzo estándar y las semanas antes de la puerta son
justamente lo que convierte una lista de documentos en algo con lo que se puede
planificar.

**Una enumeración para la disciplina y para la puerta.** Cada equipo tiene las
suyas, y una enumeración obligaría a migrar la base para añadir una. Texto
libre, y el filtro se construye de lo que haya.

**Meter ya la regla de las semanas en el motor.** Cambia las fechas de todo. Es
una decisión aparte, y el dato guardado es lo que permite tomarla más adelante
sin volver a pedir nada.

**Paginar la rejilla.** Una matriz paginada no es una matriz: lo que se mira en
ella es precisamente el cruce entre lejanos. Filtrar conserva esa propiedad
dentro del subconjunto; paginar la destruye.

## Coste aceptado

- **La cabecera de las tablas del informe sigue en castellano duro.** Esta
  pantalla —la de documentos, incluida la de aplicar la matriz— queda traducida
  entera en los cuatro idiomas, porque media pantalla sin traducir era peor que
  el coste de terminarla. El resto de la aplicación sigue con la deuda que
  apuntó [ADR-0026](0026-las-horas-reales.md), y merece su propio cambio con una
  regla en `tools/` que impida que vuelva.
- **El catálogo que provocó esto no está en el repositorio.** Sale de la
  herramienta interna de un equipo, con sus códigos de tarea y sus puertas.
  Aquí va la maquinaria —el esquema, el importador, la plantilla y la pantalla—
  y el catálogo viaja como fichero.
- **`weeks_before_gate` es un dato que hoy no hace nada.** Se ve en la ficha y
  se exporta, y nada más. Dice que no lo usa el motor, y eso es mejor que
  parecer que sí.
- **Un catálogo grande sigue cargando entero de una vez.** Ochenta filas y
  ciento treinta enlaces es una respuesta pequeña; con mil entregables habría
  que paginar la lista, y entonces el filtro tendría que irse al servidor.
