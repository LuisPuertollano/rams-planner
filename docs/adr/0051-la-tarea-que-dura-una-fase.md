# ADR-0051 — La tarea que dura una fase

**Estado:** aceptada · **Fecha:** 2026-09-22 · **Principios:** P2, P4, P5

## Contexto

La comparativa C1 dejó cuatro filas sin cerrar después de ADR-0050, y sólo una
seguía en rojo:

> **Paquetes de trabajo repetitivos** · libro 🟢 fases de WP repetitivos, con
> rollup de grupos · planner 🔴 **no existe el concepto**

El rollup ya estaba —`aggregate()` agrega cada contenedor desde sus hijas desde
el primer día—, así que lo que faltaba era la otra mitad, y era la importante.

Hay trabajo que **no es un entregable**. «Gestión del proyecto», «seguimiento
RAM mensual», «soporte durante la garantía»: no terminan un día, ocupan una fase
entera, en paralelo con todo lo demás y a baja intensidad.

El planner sólo sabía hacer lo contrario. Se declara el trabajo, el motor lo
divide por la dedicación y saca una duración; 240 h de gestión se convertían en
mes y medio seguido de una persona a jornada completa, encadenado detrás de su
predecesora. La curva de carga salía con la gestión apilada en un bloque y el
resto del proyecto vacío — y **la curva es lo que alguien mira para decidir si
contrata**.

El libro del equipo lleva desde su v28 haciéndolo bien, y la autopsia de su
intento anterior dice exactamente por qué: *«la ventana viene de las PUERTAS, se
comparte EN PARALELO entre las filas del WP, y el encadenado C → R1 se suprime
para ellas»*. Sus números: 264 filas tratadas, 16 156 h re-ancladas, 14
inversiones de fecha a cero.

## Decisión

Una tarea puede declarar **dos anclas** en vez de una duración:

```
task.span_from = 'arranque'   ->  project.status_start
task.span_from = 'IQA'        ->  la fecha de esa puerta EN ESTE proyecto
task.span_to   = 'FQA'        ->  ídem
```

Las dos columnas van juntas o no van — media ventana no es una ventana, y lo
exige un `CHECK`, no sólo el importador.

### La ecuación se lee al revés, y en eso está todo

La ecuación fundamental no cambia: `trabajo = duración × dedicación`. Lo que
cambia es cuál de las tres magnitudes queda anclada.

| | manda | sale |
|---|---|---|
| una tarea normal | el trabajo y la dedicación | **la duración** |
| una tarea continua | el trabajo y **la fase** | **la dedicación** |

Que es exactamente la pregunta que alguien se hace de verdad con la gestión de
un proyecto: no «¿cuánto dura?» —dura lo que dure el proyecto— sino **«¿a qué
porcentaje tengo que llevar a esta persona para que quepa?»**.

La intensidad puede pasar del 100 %. Eso significa que el trabajo declarado no
cabe en la fase, y es un dato, no un error: quien lo lea decide si mete a otra
persona o mueve la puerta. Redondearlo a la baja lo escondería.

### Nada la mueve salvo las puertas

Ni sus predecesoras, ni una restricción, ni la nivelación. Es deliberado y es la
mitad del asunto: la gestión de un proyecto no espera a que termine nada, y
retrasarla «para descargar a alguien» la sacaría de la fase que la define. Lo
que se descarga es otra cosa.

Su holgura sale cero por la misma razón: no hay nada que decidir. Si aparece en
el camino crítico de otra, lo que hay que mover es la puerta.

### Cuando las anclas no cuadran, el plan sale igual

Dos hallazgos, los dos con la tarea calculada **como una tarea normal** detrás:

| código | cuándo | gravedad |
|---|---|---|
| `SPAN_ANCHOR_MISSING` | una de las dos puertas no tiene fecha en este proyecto | aviso |
| `SPAN_INVERTED` | la de fin cae antes que la de inicio | error |

Una puerta sin fecha es **un dato que falta, no un plan que no se puede
calcular**. Y es el primer día de cualquiera: la tarea se declara antes que las
fechas de las puertas. El plan sale, con la fecha que sale, y el aviso al lado
nombrando la puerta que hay que ir a poner.

## Consecuencias

### Lo que arregla de paso: el trabajo de una asignación

`cellsForAssignment` repartía `duración × dedicación`. Ahora reparte **el
trabajo de la tarea entre sus asignaciones, en proporción a la dedicación de
cada una**.

Para una tarea normal las dos cuentas dan exactamente lo mismo —la duración sale
del trabajo dividido entre la dedicación, así que al multiplicar otra vez se
cancela—, y las 33 pruebas de reparto que ya había lo confirman sin tocar una
línea. Donde deja de dar lo mismo es aquí: `duración × dedicación` habría puesto
a una persona a jornada completa durante los siete meses de la fase por haber
declarado 240 h de gestión.

Dicho de otro modo: la fórmula de siempre era un caso particular de ésta, y la
tarea continua es lo que hizo falta para verlo.

### Medido sobre la demostración

240 h de «Gestión del proyecto RAMS», del arranque a la puesta en servicio:

| mes | 03/26 | 04/26 | 05/26 | 06/26 | 07/26 | 08/26 |
|---|---|---|---|---|---|---|
| horas | 48,6 | 44,0 | 39,6 | 46,2 | 50,6 | 11,0 |

Antes habrían sido 240 h en un bloque de mes y medio y cero el resto.

### Lo que NO se hace

- **No se inventa un fallback de fecha.** El libro, con FQA vacío en 25 de sus
  36 proyectos, asume «IQA + 2 años». Eso es higiene de sus datos, no una regla:
  aquí la puerta sin fecha se dice y se arregla en la ficha del proyecto.
- **No se cierra el rollup de grupos**, porque ya estaba: `aggregate()` toma el
  primer inicio y el último fin de las hijas desde ADR-0004.
- **No se reparte por meses naturales.** El reparto es el de siempre —el perfil
  de la asignación sobre los días laborables—, sólo que ahora sobre la fase
  entera. Un contorno `flat` sobre siete meses ya es el goteo que hacía falta.

## Cómo se declara

En el CSV del plan, tres columnas nuevas y opcionales:

```
proyecto;tarea;dias;horas;desde;hasta;predecesoras
P1;Gestión del proyecto;0;240;arranque;PES;
```

Y en la interfaz, la tarjeta «Dura una fase entera» del panel de edición, que
ofrece las puertas declaradas de **ese** proyecto en vez de dejar escribir
cualquier cosa.
