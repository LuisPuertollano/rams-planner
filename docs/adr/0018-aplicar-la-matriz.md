# ADR-0018 — Aplicar la matriz de documentos a un proyecto

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1, P2, P4

## Contexto

[ADR-0016](0016-documentos-y-precedencias.md) dejó declarada la convención del
equipo: qué entregables existen y cuál es condición necesaria de cuál. Y dejó
escrito lo que faltaba — aplicarla a un proyecto de verdad.

Una matriz que no se aplica es un póster. El trabajo que ahorra sólo aparece
cuando de «la tarea 6 entrega el FMECA» y «el Hazard Log es condición del
FMECA» sale, sin teclear nada, la dependencia entre la tarea 3 y la tarea 6.

## Decisión

Una función pura, `planDocumentDependencies`, en `@planner/scheduler`, y dos
rutas: una que enseña lo que haría y otra que lo hace.

### La propuesta se enseña antes de escribirse

`GET /api/projects/:id/documents/plan` no escribe nada. Devuelve tres listas:

- lo que **se crearía**, cada dependencia con la casilla de la matriz que la
  justifica (P4: un número —o un enlace— que no se explica no vale);
- lo que **no**, con el motivo: `ya-existe`, `misma-tarea` o
  `crearia-un-ciclo`, y en el último caso el camino concreto que ya existe;
- los **huecos**: documentos que la matriz nombra y que ninguna tarea del
  proyecto entrega.

Una función que crea veinte dependencias y las cuenta después no se usa dos
veces. Se puede además desmarcar lo que no cuadre antes de aplicar.

### La propuesta se recalcula al aplicar

`POST /api/projects/:id/documents/apply` **no** se cree la lista que trae el
navegador: vuelve a calcularla contra la base. Entre mirar y aceptar, otro ha
podido mover el plan. Del cliente se respeta sólo lo que haya excluido a mano,
identificado por las dos tareas.

Es la misma razón por la que toda escritura recalcula: un plan editado que
sigue enseñando las fechas de antes es peor que no editarlo.

### Los ciclos se descartan, uno a uno, y se dicen

La matriz señala los ciclos pero no los impide (ADR-0016), y el plan puede
traer ya dependencias tecleadas a mano. Así que el aplicador no puede dar por
hecho que el grafo de partida esté limpio.

Cada candidata se mira contra el grafo **tal y como va quedando**: se acepta si
la sucesora no alcanza ya a la predecesora, y en cuanto se acepta pasa a contar
para las siguientes. La pregunta es de alcanzabilidad, no de orden topológico,
y por eso funciona igual sobre un plan que ya viniera con un ciclo: se descarta
lo que lo empeoraría y se deja lo demás.

Una prueba basada en propiedades lo fija: si el plan de partida no tenía ciclo,
el de después tampoco, sea cual sea la matriz que se le eche.

### El orden de la propuesta es determinista

Las reglas se recorren ordenadas, y las tareas de cada documento también (P2).
Mismas entradas, misma propuesta, siempre — incluido *cuál* de dos candidatas
que se excluyen entre sí sobrevive. Sin eso, aplicar la misma matriz dos veces
podría dar dos planes distintos y ninguno de los dos se podría defender.

### Dependencias fin-comienzo, sin desfase

La matriz dice el **orden**, no cuánto se espera. Poner un margen que nadie ha
declarado sería inventarse el plan. Si hace falta uno, se pone después a mano,
como cualquier otra dependencia.

## Alternativas descartadas

**Aplicar sin previsualizar, y deshacer si no gusta.** El historial permite ver
qué se creó, pero deshacer veinte dependencias una a una no es una alternativa
real a no crearlas.

**Romper los ciclos automáticamente.** Es la tentación obvia y es la misma que
ya se descartó para el grafo del plan (`graph.ts`): un enlace roto en silencio
produce un plan que nadie puede explicar. Se descarta la arista nueva, que es
la que aún no existe.

**Guardar de dónde salió cada dependencia**, para poder retirarlas juntas. Es
una columna más en `dependency` y una promesa que habría que mantener cuando
alguien edite esa dependencia a mano. Una dependencia creada por la matriz es
una dependencia como cualquier otra; se quita como cualquier otra.

**Aplicar a varios proyectos de una vez.** La propuesta hay que mirarla, y una
propuesta de seis proyectos no la mira nadie.

## Coste aceptado

- El producto cartesiano crece: si cinco tareas entregan A y cuatro entregan B,
  una sola cruz produce veinte dependencias. Es correcto —cada una de las
  cuatro necesita las cinco— pero hay que verlo antes de aceptarlo, que es
  justo para lo que está la previsualización.
- La comprobación de ciclos es una búsqueda por candidata. Con los tamaños de
  un plan de verdad no se nota, y a cambio el motivo del descarte se puede
  enseñar con el camino entero.
- Los huecos se enumeran pero no se arreglan: la herramienta no inventa tareas.
  Dice qué falta y quien planifica decide.
