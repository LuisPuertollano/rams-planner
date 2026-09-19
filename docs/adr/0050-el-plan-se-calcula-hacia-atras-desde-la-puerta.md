# ADR-0050 — El plan se calcula hacia atrás, desde la puerta

**Estado:** aceptada · **Fecha:** 2026-09-21 · **Principios:** P2, P4, P6

## Contexto

La comparativa C1 puso veinte capacidades del libro TrRAMS frente al planner y
dejó una fila en rojo por encima de todas las demás:

> **Planificar hacia atrás desde una puerta** · libro 🟢 · planner 🔴
> *No es una función que falte: es otra forma de pensar el plan.*

Y tenía razón en el fondo y se quedó corta en el precio. Decía «varias
sesiones», y lo era **antes** de ADR-0042 y ADR-0047. Después no: para entonces
la fecha de cada puerta estaba en `project_gate`, las semanas de antelación en
el catálogo, y `planGateDeadlines` ya escribía la fecha objetivo de cada tarea
en `task.deadline`. Todo el dato estaba puesto. Sólo servía para avisar.

Y esa es la diferencia que importa. Un proyecto RAMS no se planifica desde el
arranque: la revisión de diseño cae el día que cae y no la mueve nadie. La
pregunta no es «¿cuándo termino?» sino **«¿cuándo tengo que empezar para
llegar?»**, y responderla a toro pasado —cuando el plan ya dice que terminas
tarde— no sirve de nada.

## Decisión

**Un modo por proyecto**, `project.schedule_mode`:

| | pregunta que responde |
|---|---|
| `adelante` | ¿cuándo termina esto si empiezo ya? |
| `atras` | ¿cuándo tengo que empezar para llegar? |

Va por proyecto y no por instalación porque **conviven**: una oferta se
planifica hacia delante para saber qué se promete, y un proyecto en marcha hacia
atrás para saber si su puerta sigue siendo alcanzable.

### Planificar hacia atrás es anclar en otro sitio, y nada más

El paso atrás ya existía. Es el de toda la vida, el que da la holgura: el motor
hace CPM completo desde el primer día. Lo que hacía era anclarse en **el fin
calculado de cada proyecto**, así que la holgura medía «cuánto puedo retrasar
esto sin retrasar el proyecto».

Con la fecha de la puerta como ancla mide otra cosa, y es la que se mira los
lunes: **«cuánto puedo retrasar esto sin perder la certificación»**.

Dos intentos hicieron falta, y el primero no movía nada:

1. **Acotar** el fin calculado con la puerta (`min` de los dos). No mueve una
   sola tarea: el fin de un proyecto que llega con holgura cae **antes** que su
   puerta, así que ganaba siempre.
2. **Sustituirlo.** La puerta es lo que tira de la tarea hacia el futuro; lo
   único que puede traerla de vuelta son sus sucesores. Y una tarea sin puerta
   propia se deja arrastrar por sus sucesores **también hacia el futuro**, que
   es lo que hace que la cadena entera se pegue detrás de la puerta en vez de
   quedarse clavada al arranque.

### El hallazgo es el producto

`GATE_UNREACHABLE`. No dice «llegas tarde» sino **«para llegar habrías tenido
que empezar el 27 de noviembre, y lo más pronto que puedes es el 29 de
diciembre: faltan 21 días laborables»**.

Hacia delante eso no se puede decir, y no por falta de ganas: con el ancla en el
propio fin calculado, la holgura **nunca** es negativa. El aviso de siempre
—`DEADLINE_MISSED`— dice que el plan termina después de la fecha objetivo, que
es la misma noticia cuando ya no se puede hacer nada. Éste la da antes y en los
términos en los que sí se puede: alcance, gente o fecha de la puerta.

### «Al menos», cuando la cuenta se topa

El inicio necesario se calcula restando duración, y esa resta se topa contra el
principio del horizonte. Cuando llega ahí, el número real es **mayor** que el
que sale.

Un aviso que dice «faltan 40 días» cuando faltan ciento veinte es peor que no
decir ninguno, porque alguien planifica con él. Así que cuando la cuenta se
topa, el hallazgo dice «faltan **al menos** 40 días» y lo marca en su payload.
Se dice lo que se sabe.

## Lo que se midió

Sobre la cartera real —34 proyectos, 6 222 tareas, 2 244 fechas objetivo
puestas desde las puertas—:

| | tiempo | qué sale |
|---|---|---|
| `adelante` | 0,6 s | 272 × `DEADLINE_MISSED` |
| `atras` | 0,6 s | 1 972 × `GATE_UNREACHABLE` |

**El mismo tiempo**, porque el paso atrás ya se hacía: lo único que cambia es
dónde empieza. Y la diferencia en lo que sale no es de cantidad sino de clase:
272 avisos de que algo termina tarde, contra 1 972 que dicen cuánto y desde
cuándo.

### Nivelar sobre un plan hacia atrás cuesta puertas, y se ve

Esto no estaba en el diseño: salió de probarlo. Nivelar funciona **retrasando**
tareas, y en un proyecto hacia atrás retrasar es empujar hacia la puerta. Si el
retraso se pasa, la puerta deja de ser alcanzable.

Lo correcto no es impedirlo —nivelar propone, no decide— sino que **se vea**. Y
se ve, porque el plan nivelado se vuelve a calcular con los retrasos puestos, la
holgura contra la puerta se va a negativo y sale el hallazgo. Medido sobre los
datos de demostración con las puertas fechadas:

| | hallazgos |
|---|---|
| sin nivelar | ninguna puerta rota |
| nivelado | **2 × `GATE_UNREACHABLE`**, tras retrasar 6 tareas |

Que es exactamente lo que hay que saber antes de aceptar una nivelación: cuánto
margen de certificación cuesta deshacer las sobrecargas.

## Alternativas descartadas

**Un segundo motor.** Es lo que hace el libro: `CalcPredecessorEngine` son
4 963 líneas que conviven con el cálculo hacia delante. Aquí habría sido
duplicar el planificador y sus pruebas para cambiar una línea de anclaje.

**Un modo por instalación.** Más simple y falso: la misma cartera tiene ofertas
y proyectos en marcha, y no se planifican igual.

**Tres modos, como el libro** (Forward, Backward, Smart). El tercero es
«backward nivelado», y el planner ya nivela sobre cualquier plan calculado: con
`atras` puesto, nivelar da exactamente eso sin un modo más que mantener.

## Coste aceptado

- **Un proyecto hacia atrás sin fechas objetivo no cambia nada**, porque no hay
  dónde anclar. Es lo correcto —inventarle una puerta sería inventarse un
  compromiso— pero se puede activar el modo y no ver ninguna diferencia. La
  pantalla lo dice.
- La holgura **significa dos cosas distintas** según el modo. Es inevitable: es
  la misma cuenta contra otro ancla. Está escrito en el panel del proyecto, al
  lado del selector, y en el manual.
