# ADR-0045 — Nivelar sin rehacer el reparto entero

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Principios:** P2, P5

## Contexto

ADR-0041 dejó una frase escrita a propósito, para que no se olvidara: *«el
reparto y la nivelación **no se han medido** a esta escala — sólo el cálculo»*.
Se han medido. Sobre la cartera real del equipo, 1 805 tareas:

| | |
|---|---|
| Cálculo | 1,15 s |
| Reparto | 1,5 s |
| **Nivelación** | **366 s, y termina rindiéndose** |

Seis minutos para agotar sus 400 iteraciones y devolver *«se agotaron las 400
iteraciones»* con 834 sobrecargas en pie. No es que fuera lenta de usar: es que
no se podía usar.

El perfil dice exactamente dónde se iba:

| | por iteración |
|---|---|
| `schedulePlan` | 50 ms |
| `computeWorkload` | **703 ms** |
| de ellos, `computeCapacity` | 105 ms |

Y una medida más, que es la que da la solución: **retrasar una tarea mueve tres
de mil ochocientas** —mediana; p90 veintinueve, máximo cincuenta y nueve—. El
bucle rehacía el reparto de 1 683 asignaciones y 168 616 celdas para cambiar el
0,5 %, cuatrocientas veces seguidas.

## Decisión

**Un índice de carga parcheable dentro de la nivelación.** Se reparte una vez;
después, en cada vuelta, se restan las celdas de los nodos que se han movido, se
vuelven a repartir **esos** y se suman.

Tres cosas dejan de repetirse:

- **La capacidad.** No depende del plan —sale del calendario y de la jornada de
  cada persona—, así que se calcula una vez. Eran 105 ms por vuelta para dar
  siempre lo mismo.
- **El reparto de lo que no se ha movido.** Es el grueso: de 1 683 asignaciones
  se rehacen las de tres nodos.
- **La agregación por (recurso, día).** `firstConflict` la reconstruía desde las
  168 616 celdas en cada llamada; ahora la lee, porque el índice ya la mantiene.

### Lo que impide que esto desvíe el resultado

Es una optimización del núcleo, y el contrato de la nivelación es que sea
**reproducible**. Dos costuras la sostienen, y las dos son estructurales, no
buena voluntad:

1. **Las celdas las produce la misma función por los dos caminos.** El reparto
   de una asignación se extrajo a `cellsForAssignment`, y la llaman tanto el
   reparto completo como el índice. No hay una segunda implementación que se
   pueda desviar de la primera.
2. **El reparto que se devuelve lo hace `computeWorkload`, entero, una vez y al
   final.** El índice sólo sirve para decidir qué tarea cede. Lo que sale de
   nivelar está producido por el mismo código que antes.

Y una prueba de propiedad con planes generados comprueba lo que queda: que el
plan nivelado coincide, celda a celda, con repartir desde cero usando los
retrasos que la nivelación eligió.

### Un detalle que cuesta una tarde si se pasa por alto

Al quitar las celdas de un nodo, un día puede quedarse **sin nada**. Si se
quedara en el mapa con cero minutos en vez de borrarse, `firstConflict` lo
recorrería para siempre buscando un conflicto que ya no está. Se borra, y hay
una prueba que lo fija.

## Lo que cuesta ahora, medido

| | antes | ahora | |
|---|---|---|---|
| Cartera real (1 805 tareas) | 366 s | **34,3 s** | **×10,7** |
| La misma triplicada (4 385) | 385 s | **57,4 s** | ×6,7 |
| Por iteración | 844 ms | **86 ms** | |

Y el resultado **no se mueve**: mismas 1 206 hallazgos, mismas 368 tareas
retrasadas, mismas 168 618 celdas, mismo hallazgo final. La nivelación hace lo
mismo que hacía; lo hace diez veces más rápido.

## Lo que la medición encontró y no es un fallo

**Esta cartera no se puede nivelar**, y eso no lo arregla ningún tope. Con el
tope en 3 000 iteraciones el bucle para solo en la **1 407** con
`fuera-del-horizonte`: el retraso que haría falta se sale del horizonte del
cálculo. Y las 800 iteraciones extra entre 400 y 1 200 compraron **trece**
tareas retrasadas más.

Nivelar sólo sabe **mover** trabajo. Si el equipo está por debajo de lo que el
plan pide, no hay sitio al que moverlo, y eso ya lo dicen las 834 sobrecargas.
Por eso el tope se queda en 400: subirlo cuesta tres veces y media y no converge
igual.

## Alternativas descartadas

**Reprogramar sólo lo que se mueve** (`schedulePlan` incremental). Era mi primera
hipótesis y el perfil la descartó: son 50 ms de 844. Habría tocado el scheduler,
que es el código más delicado del motor, para ganar un 6 %.

**Cachear sólo la capacidad.** Barato y correcto, y es una décima parte del
problema: 105 ms de 844.

**Subir el tope de iteraciones.** Medido arriba: no converge, cuesta el triple.

**Parar antes cuando deje de mejorar.** Se ve tentador —trece tareas en
ochocientas vueltas— y cambia lo que la nivelación devuelve. Es otra decisión, y
merece hablarse en vez de colarse dentro de una optimización.

## Consecuencias

La nivelación se puede usar. Treinta y cuatro segundos no es interactivo, pero
es un botón que alguien pulsa y espera, no una tarea de fondo.

Y queda dicho dónde está ahora el techo: con el reparto fuera del bucle,
`schedulePlan` pasa a ser el **58 %** de los 86 ms que queda por iteración. Si
algún día treinta y cuatro segundos son demasiados, ahí es donde hay que mirar
—y ya no antes de medir—.
