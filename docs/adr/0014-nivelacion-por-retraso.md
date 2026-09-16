# ADR-0014 · La nivelación empuja fechas, y dice cuándo eso no basta

**Estado:** aceptada · **Fecha:** 2026-09-16 · **Refina:** [ADR-0009](0009-nivelacion-heuristica-opcional.md)

## Contexto

Al implementar la nivelación aparecieron tres cosas que el diseño no había
previsto, y las tres eran del mundo real, no del código.

## Decisiones

**1. Una ejecución propia, no una columna.** Nivelar produce su propia
`calculation_run`. Se compara con la anterior en la vista que ya existe, y así
se ve exactamente qué ha costado que el plan quepa. El plan que quieres y el
plan que cabe conviven sin pisarse.

**2. La elección se fija por día en conflicto, no por recurso.** La primera
versión retrasaba un día por iteración y elegía candidato en cada vuelta: dos
tareas solapadas se perseguían sin converger nunca. Fijarla sólo al recurso era
peor: empujaba la misma tarea para siempre. Atada al par (recurso, día), y
empujando más allá del bloque de sobrecarga entero, converge en unas pocas
iteraciones —cinco, en los datos de demostración.

**3. Hay sobrecargas que ningún retraso arregla.** Si una sola asignación ya
pide más horas de las que la persona tiene ese día —porque está al 60 %, o
porque su jornada es de 35 h y la tarea se estimó en días de 8—, moverla de
fecha no cambia nada. Se detecta, se dice con precisión («pide 9,9 h y la
persona tiene 8,0 h») y se sigue nivelando el resto. Antes de esto, el
algoritmo empujaba esa tarea dos años y se rendía.

## Coste aceptado

La heurística recalcula el plan entero en cada iteración. Con los datos de
demostración son 205 ms; con planes mucho mayores habría que hacerla
incremental. Se prefiere así mientras sea rápida: un algoritmo que reutiliza el
motor completo no puede divergir de él.
