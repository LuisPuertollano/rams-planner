# ADR-0026 — Las horas reales, y por qué no entran en el motor

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1, P2, P3, P5

## Contexto

Es el trozo grande que quedaba de PlaTo. La herramienta sabía decir qué está
comprometido y contra qué capacidad; no sabía decir **si eso se parece a lo que
está pasando**. La tabla `actual_entry` estaba en el esquema desde el primer día
y nadie la escribía ni la leía.

## Decisión

### Los reales **no** entran en el motor

Es la decisión que lo define, y todo lo demás sale de ella.

El trabajo del planificador es decir **cuándo puede pasar** el trabajo. Lo que
ya pasó no cambia esa respuesta. Meter las horas en la instantánea obligaría a
recalcular el plan entero para ver una hora fichada, y cambiaría el hash de
entrada —el que dice si dos ejecuciones son la misma— sin que ninguna fecha se
moviera. Una ejecución dejaría de ser reproducible por un motivo que no tiene
nada que ver con el plan.

Así que van al **informe**, que es donde ya se cruzan carga y capacidad y donde
alguien mira de verdad. El informe no recalcula: lee la ejecución que ya hay y
le suma una lista más.

Consecuencia práctica, y es buena: cargar un parte de horas no invalida el plan
que hay en pantalla. Por eso el botón de importar horas, al contrario que el del
plan, no pide recargar nada.

### El avance declarado sigue siendo otra cosa

`task.percent_complete_bp` es un dato declarado (P1): alguien dice «esto va por
la mitad». Las horas reales son otro dato declarado distinto: alguien fichó
siete horas y media el martes. La tentación es derivar el primero del segundo
—«ha gastado el 60 % de las horas, luego va al 60 %»— y es justo lo que no se
hace: gastar horas no es avanzar, y confundirlos convierte un proyecto que se
está pasando de presupuesto en uno que va estupendamente.

### El grano es el del parte: persona, tarea, día

Porque es el que llega, y porque agregar se puede después; inventar el detalle
que no vino, no. La clave única es **(tarea, persona, día, origen)**, y el
origen está ahí a propósito: una hora estimada y una fichada del mismo día no se
pisan, porque no son el mismo dato.

Volver a cargar el mismo fichero **corrige** en vez de duplicar (`ON CONFLICT
... DO UPDATE`). Es lo que alguien espera cuando repite una importación porque
no sabe si la primera fue.

Y dentro de un mismo fichero, dos apuntes del mismo día se **suman**: son dos
ratos de trabajo, no una corrección. Hace falta además por un motivo mecánico
que sólo se ve contra la base: `DO UPDATE` aborta el `INSERT` entero si dos
filas del mismo lote chocan entre sí, y un parte de horas trae eso
constantemente. Está en `mergeActuals`, con su prueba.

### Nada se crea al importar

La importación del plan sí crea personas que no existen, y tiene sentido: ahí se
está declarando el plan y crear es el trabajo. Aquí se está contando lo que
pasó. Una persona inventada desde un parte de horas aparecería con horas, sin
calendario y sin tarifa, y nadie sabría de dónde salió. El proyecto, la tarea y
la persona tienen que existir, y si no existen el fichero se rechaza entero con
el número de fila y el nombre que no cuadra.

### El trabajo fuera de plan **se cuenta y se dice**, no se inventa

Es la idea que merecía copiarse de PlaTo, y la parte que no.

PlaTo, ante horas que no tienen línea de plan, **crea una**: el entregable
«Unplanned with Actuals». Setecientas nueve de sus tres mil doscientas filas son
eso, o sea que el problema es real y grande. Pero escribir plan en nombre de
nadie rompe P1: los datos declarados los declara una persona.

Aquí esas horas se cargan contra la tarea que traen, y el informe cuenta cuántas
cayeron en un proyecto y un mes **donde nadie había planificado nada** y lo dice
en el resumen. Amarillo mientras es una parte pequeña; rojo cuando pasa de la
cuarta parte de lo fichado, porque entonces lo que está mal no es el parte, es
el plan.

### La comparación lleva su fecha pegada

`actualsThrough` —el último mes con horas— va en el resumen y no como adorno:
sin él, un plan de seis meses frente a dos meses de partes parece un proyecto
que va sobradísimo. Es el error de lectura más fácil de cometer con este dato y
la frase lo desactiva antes de que ocurra.

### Dos permisos, no uno

- **`reales.ver`** (por proyecto) — las horas dicen **quién trabajó en qué**, y
  eso no se deduce del plan. Sin el permiso, la lista no llega: no llega a cero.
  El informe lo dice, igual que con los costes y con el reparto por persona.
- **`reales.registrar`** (global) — un fichero de horas trae todos los proyectos
  a la vez, así que quien lo carga tiene que poder escribir en todos. Concederlo
  «sobre un proyecto» sería una promesa que la ruta no puede cumplir.

La migración concede `reales.ver` a los tres roles de arranque, por la misma
razón que `informes.ver`; `reales.registrar` sólo a quien ya tenía `importar`.

## Alternativas descartadas

**Meter los reales en la instantánea del motor.** Ver arriba: rompe la
reproducibilidad de la ejecución por un dato que no mueve ninguna fecha.

**Derivar el avance de las horas gastadas.** Gastar no es avanzar.

**Crear la tarea que falta al importar,** como hace PlaTo. Rompe P1 y, peor,
esconde el problema: la línea aparece sola y ya nadie se pregunta por qué el
trabajo no estaba planificado.

**Un `POST` por apunte en vez de un CSV.** El parte de horas sale de otro
sistema en bloque. Una ruta que acepta uno obliga a trescientas peticiones y a
inventar qué hacer cuando la número doscientas falla.

## Coste aceptado

- **Para cargar horas, la tarea tiene que existir en el plan.** Es la
  consecuencia de no inventar plan, y es una fricción de verdad: quien fichó
  contra algo que nadie planificó tiene que crearlo antes. A cambio, lo crea una
  persona y con nombre.
- **Más de 24 h en una fila se rechaza; repartidas entre tareas, sólo se avisa.**
  Lo primero es la columna equivocada casi siempre; lo segundo puede ser un
  apunte duplicado y puede no serlo, y rechazar un parte entero por una sospecha
  es peor que cargarlo diciéndolo.
- **La cabecera de las tablas del informe sigue en castellano en los cuatro
  idiomas.** La columna nueva sí se traduce, así que en alemán la fila dice
  «Mes / Comprometido / **Erfasst** / Capacidad». Queda feo y queda a la vista a
  propósito: son 45 literales repartidos por once ficheros, no son de esta
  función, y merecen su propio cambio —con una regla en `tools/` que impida que
  vuelvan, como las otras cinco—.
- El informe cruza plan y realidad **por proyecto y mes**, no por tarea. Es el
  grano al que ya trabajaba; bajar a la tarea es otro cambio.
