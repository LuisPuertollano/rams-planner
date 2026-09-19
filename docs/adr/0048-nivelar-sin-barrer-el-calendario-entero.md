# ADR-0048 — Nivelar sin recorrer el calendario entero en cada vuelta

**Estado:** aceptada · **Fecha:** 2026-09-20 · **Principios:** P2, P5

## Contexto

ADR-0045 dejó la nivelación en 34 s sobre la cartera de entonces: 1 805 tareas y
168 616 celdas. ADR-0047 cambió el tamaño del problema. Partir cada tarea en las
entregas que pide la Checkliste multiplica el plan por 1,5, y sobre la cartera
real del departamento —34 proyectos instanciados desde la plantilla— eso son
6 222 tareas y 295 630 celdas.

A esa escala la nivelación volvía a durar **211 s**. El perfil no señalaba al
reparto, que ADR-0045 ya había arreglado, sino a dos sitios nuevos:

| | del tiempo |
|---|---|
| `firstConflict` | 19,4 % |
| `toEpochDay` | 12,8 % |
| `capacityOf` | 8,4 % |
| `schedulePlan` | 9,3 % |

Sólo el último es trabajo que hay que hacer.

## Decisión

### `firstConflict` busca el mínimo, no ordena la lista

Recorría **todos** los días de todas las personas y, por cada uno sobrecargado,
montaba un objeto con su `Math.max(...valores)` y su `[...claves].sort()`.
Después ordenaba la lista entera. Y se quedaba con el primero.

Con 27 personas y cuatro años de horizonte son decenas de miles de días
recorridos en cada una de las mil y pico vueltas, y de todo lo que construía
usaba uno.

Ahora se busca el mínimo en una pasada, con el mismo criterio —día y, en empate,
recurso—, y las cuentas caras se hacen **sobre el que gana**. Coger el primero
de una lista ordenada y buscar el mínimo con ese mismo orden son la misma cosa,
así que el resultado no cambia.

### La clave del índice se guarda ya partida

El índice de carga va en un `Map` con clave `recurso|día`. `firstConflict` la
partía con `split` y después `capacityOf` la volvía a juntar con una plantilla
de cadena, dos veces por día y por vuelta. El recurso, el día y la capacidad
—que no depende del plan, como ya decía ADR-0045— se guardan ahora **en el
propio cubo**, donde se crea, y se leen sin construir ni una cadena.

### `toEpochDay` lee las cifras, no corta la cadena

Tres `slice` y tres `Number` por llamada, millones de llamadas, y cada corte una
cadena que el recolector barre después. Se leen con `charCodeAt`. Se puede
porque `CalendarDate` es un tipo de marca: sólo `calendarDate()` lo construye y
ahí se valida el formato.

## Lo que se midió

Misma base, mismas 300 iteraciones, misma huella de salida:

| | segundos |
|---|---|
| antes | 48,9 |
| `firstConflict` + la clave partida | 27,6 |
| y `toEpochDay` | **22,4** |

**×2,18, y la salida es la misma bit a bit**: los retrasos, las 295 630 celdas y
los hallazgos dan el mismo SHA-256 en las tres medidas. Eso no es un detalle de
la prueba, es el criterio: una nivelación que va más rápida y propone otra cosa
no es más rápida, es otra función (P2).

## Alternativas descartadas

**Memorizar `toEpochDay` en un `Map` de módulo.** Más rápido todavía y una fuga
de memoria en un servidor que vive meses. Leer las cifras no guarda nada.

**Un montículo con los días sobrecargados, ordenado.** Sería O(log n) en lugar
de O(n) por vuelta. Pero la carga cambia debajo en cada iteración —parchear el
índice mueve decenas de días— y mantener el montículo coherente cuesta más
código del que ahorra tiempo. La pasada lineal sin asignar memoria ya saca lo
que hacía falta.

**Rendirse antes.** Sobre esta cartera la nivelación **no converge**: 27 personas
no pueden con 1 970 266 minutos de trabajo, y eso no es un fallo del algoritmo
sino el dato. Pero lo que devuelve cuando se rinde —qué días no caben y de
quién— es justamente lo que hay que enseñarle a quien planifica, así que llegar
antes a esa respuesta vale.

## Coste aceptado

- `CargaPorDia` guarda tres campos que se podrían recalcular. Es redundancia a
  propósito y está dicho en el código.
- `toEpochDay` deja de dar `NaN` ante una cadena torcida y pasa a dar un número
  cualquiera. Lo sostiene el tipo de marca, y una prueba comprueba las dos
  formas de leer la fecha **día a día** entre 1900 y 2200: 109 574 días, no una
  muestra.
