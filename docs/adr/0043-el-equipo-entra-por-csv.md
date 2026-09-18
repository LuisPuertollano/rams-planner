# ADR-0043 — El equipo entra por CSV, y el fichero decide qué permiso hace falta

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Principios:** P1, P2, P6

## Contexto

ADR-0040 metió el plan del equipo entero por el CSV y dejó escrita su deuda:
*«las personas entran **por su nombre del libro**, con jornada estándar y sin
tarifa»*. Lo que no se dijo entonces, porque no se miró, es que **no había forma
de arreglarlo en bloque**.

La herramienta sabe dar de alta a una persona: de una en una, en un formulario.
`POST /api/resources` crea una. Un departamento de veintisiete personas con su
jornada, su calendario, sus competencias y su tarifa son veintisiete altas más
una edición por competencia más una por tarifa: ciento y pico formularios para
poner al día algo que ya existe en una hoja de cálculo.

Y el planner importa por CSV el plan, el parte de horas y el catálogo de
entregables. Lo único que **no** se podía importar era lo que sostiene todo lo
demás: quién hay y cuánto puede trabajar.

## Decisión

**Una cuarta importación, `POST /api/team/import`.** Una fila por persona:

```
codigo;nombre;calendario;jornada;indirecto;reserva;alta;baja;competencias;tarifa;tarifa_desde;tarifa_hasta
```

Tres reglas heredadas del catálogo de entregables, porque son las que hacen que
volver a cargar un fichero corregido corrija de verdad:

- **El código manda.** Una fila cuyo código ya existe actualiza a esa persona.
  Cargar dos veces el mismo fichero deja el equipo igual que cargarlo una vez.
- **`competencias` es la lista completa** de esa persona, no una añadidura: lo
  que no venga en la casilla se le quita. Y la **columna ausente** no dice nada
  y no toca nada, que es distinto de la columna vacía.
- **Cualquier error deja el fichero fuera entero.** No hay importaciones a
  medias.

### Las tarifas se añaden; es la excepción, y tiene motivo

Una tarifa no es un dato de la persona: es **un tramo de su historia**, con
fecha de principio y de fin. Aplicarle la regla de «la lista completa» —borrar
las anteriores para dejar la del fichero— reescribiría el coste de lo que ya
pasó, que es lo único de esta herramienta que no se puede volver a calcular.

Así que se añaden. Una tarifa idéntica a otra que ya está no se duplica; una que
pisa un tramo existente con otro importe **se avisa y no se mete**, porque cuál
de las dos vale es una decisión de una persona. El `EXCLUDE` del esquema ya
impedía dos tarifas solapadas; lo que faltaba era decir qué pasa cuando salta.

### El fichero decide qué permiso hace falta

La ruta pide `equipo.editar`. Si el fichero **trae tarifas**, se exige además
`tarifas.editar`, y eso se comprueba dentro de la ruta mirando el fichero.

Lo que cobra alguien no es lo mismo que su jornada, y `tarifas.editar` existe
precisamente porque el planner ya distingue las dos cosas: la pantalla del
equipo se ve entera menos las tarifas. Dejar que el importe entrara por la
puerta del equipo habría colado el dato más sensible de la herramienta por el
permiso más repartido, y sin que nadie lo notara — que es la forma en que estos
agujeros se abren de verdad.

Un fichero sin esa columna no necesita el segundo permiso, así que quien sólo
mantiene el equipo sigue pudiendo mantenerlo.

### El nivel de competencia es obligatorio

`FMECA:4`, de 1 a 5. Una competencia sin nivel **se rechaza** en vez de recibir
uno por defecto: ponerle un 3 a quien no lo declara sería la herramienta
opinando sobre lo que alguien sabe hacer, que es justo el dato que se estaba
importando. Y de ese nivel depende a quién propone el reparto.

Las competencias que no existan **se crean**, y se cuentan en el resumen. Es lo
mismo que hace el catálogo de entregables, y la alternativa —rechazar el fichero
hasta que alguien dé de alta las nueve competencias a mano— convierte una
importación en dos trabajos.

### Y recalcula al terminar

Es la diferencia con el catálogo de documentos, que no recalcula nada. Cambiar
una jornada, un calendario o una tarifa **cambia la capacidad y el coste**:
dejar en pantalla el plan anterior sería mentir. Es la misma regla que ya seguía
el resto de la ficha del equipo.

## Lo que se vio al mirarlo funcionando

**La pantalla de Importaciones decía «sólo el plan recalcula».** Era verdad con
tres importaciones y dejó de serlo con la cuarta, en los cuatro idiomas. Una
frase que envejece en silencio.

**Y el ejemplo de la columna `calendario` decía `BW`**, que no es el código de
ningún calendario de ninguna instalación —son `base_bw`, `base_de`—. La ficha de
cada columna pide «un valor de verdad, no un `<texto>`: se copia y funciona», y
ése no funcionaba.

## Alternativas descartadas

**Un conversor fuera de la aplicación**, como `tools/gantt-a-plan.mjs`. Aquel
existe porque el Gantt es la forma de **un** libro concreto; el equipo no tiene
forma ajena que traducir — es el modelo de persona de la propia herramienta, y
ése es un contrato público como el CSV de plan.

**Sacar las columnas de la hoja `Settings` del libro del equipo.** Es la
tentación, porque el dato está ahí. Y ese bloque mezcla la plantilla con un
cálculo de edades y de fecha de jubilación: fechas de nacimiento. Un importador
que copie esa forma acaba pidiendo esos datos. El CSV sale del modelo de la
herramienta y quien rellena decide qué pone.

**Meter también las ausencias y los periodos de disponibilidad.** Son varias
filas por persona y romperían «una fila, una persona». Tienen su propia forma y
serán su propia decisión.

**Reemplazar las tarifas en vez de añadirlas.** Arriba: reescribe el coste de lo
que ya pasó.

**Un permiso nuevo, `equipo.importar`.** Importar no es una capacidad distinta
de editar; es editar más deprisa. Lo que sí es distinto es la tarifa, y para eso
ya había permiso.

## Consecuencias

La deuda de ADR-0040 se puede pagar: las personas que entraron por su nombre del
libro, con jornada estándar y sin tarifa, se corrigen con un fichero en vez de
con ciento y pico formularios.

Queda apuntado lo que **no** trae, para que no se descubra a mitad de un
fichero: las ausencias, los periodos de disponibilidad y la moneda de la tarifa
—que se queda en la de por defecto—. Y que dar de baja a alguien se hace
poniéndole fecha en `baja`, no quitándolo del fichero: una fila que desaparece
no borra a nadie, porque un fichero parcial no puede vaciar el equipo.

*(Todos los ejemplos de este ADR, de la plantilla y de las pruebas son
inventados. El libro del equipo lleva personas reales y no entra en el
repositorio.)*
