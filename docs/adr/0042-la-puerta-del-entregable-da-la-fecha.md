# ADR-0042 — La puerta del entregable le pone fecha objetivo a la tarea

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Principios:** P1, P2, P4

## Contexto

ADR-0027 metió en la ficha del entregable a qué puerta de certificación va
(`gate`) y cuántas semanas antes tiene que estar terminado
(`weeks_before_gate`), y dejó escrito, en sus propias palabras, que el motor no
lo usaba: *«meter ya la regla de las semanas en el motor cambia las fechas de
todo. Es otra decisión.»* Han pasado quince decisiones y el dato sigue ahí sin
hacer nada: se ve en la ficha y no produce ni un número.

La regla viene del DocFlowChart del equipo, que coloca cada entregable a su
distancia de la puerta. La hoja la resuelve en una celda:

```
MIN(techo; MAX(fecha_de_la_puerta − 7 × semanas; suelo)) + suelo_del_predecesor
```

Y al catálogo le faltaba **la mitad del dato**: cuándo cae cada puerta. Eso no
es del catálogo. El mismo FMECA va a la misma revisión de diseño en todos los
proyectos, y esa revisión cae un día distinto en cada uno.

## Decisión

**Una tabla `project_gate` con las fechas de las puertas de cada proyecto, y de
cruzarla con el catálogo sale la fecha objetivo de la tarea que entrega el
documento.**

De la fórmula de la hoja entra **sólo el corazón**, `fecha_de_la_puerta − 7 ×
semanas`. Los otros tres términos existen porque una celda de Excel tiene que
dar un día sí o sí: no hay nadie detrás que programe, así que la celda se
recorta sola para no salirse del proyecto y se suma a su predecesora para no
adelantarla.

Aquí sí hay alguien detrás:

- **El `+ suelo_del_predecesor` ya lo hace el motor**, que empuja por las
  dependencias desde ADR-0009. Portarlo sería calcularlo dos veces y que las dos
  cuentas se contradijeran el día que alguien cambie un enlace.
- **El recorte se sustituye por decirlo.** Si la cuenta cae antes de que el
  proyecto arranque, no se mueve al arranque: se enseña y no se pone, con el
  motivo `antes-del-arranque`. Un objetivo recortado se cumple siempre y no
  avisa de nada, que es lo contrario de para lo que existe.

### Objetivo, no empujón

Lo que se escribe es `task.deadline`, que en este modelo es **blando** desde el
esquema inicial: no mueve la tarea, genera el hallazgo `DEADLINE_MISSED` cuando
el plan no llega.

Es lo que dice una puerta de certificación —«esto tiene que estar el día 14»— y
deja que el motor siga siendo quien decide cuándo cabe. La alternativa, escribir
un `finish_no_later_than`, convertiría la herramienta en una lista de fechas que
se cumplen por decreto: el plan dejaría de poder estar mal, que es justamente lo
que hace falta ver.

Y tiene una consecuencia práctica que decidió el diseño: **no hubo que tocar el
motor**. El aviso, su traducción a cuatro idiomas y su sitio en la pantalla de
hoy ya existían. Esta decisión sólo llena un campo que ya se miraba.

### Se propone, no se impone

Misma forma que las subactividades (ADR-0039) y la matriz: una pantalla enseña
lo que haría, con la cuenta entera de cada fila —«RD el 2026-05-22, menos 2
semanas»— y el motivo de cada descarte, y se puede desmarcar lo que no cuadre.
La propuesta se vuelve a calcular al aplicar en vez de creerse la que trajo el
navegador.

Los descartes son los de siempre, y uno se lleva un aviso aparte: **`RF`, `IQA`
o la que sea, cuando el catálogo la pide y el proyecto no la ha fechado**, sale
por su nombre y en grande. Es el que más se va a ver el primer día, y se arregla
escribiendo una fecha arriba, no tocando el catálogo.

### Sin semanas declaradas se lee «en la puerta»

`weeks_before_gate` puede venir sin declarar, y el catálogo que se extrajo del
DocFlowChart viene así **entero**: las cajas del diagrama dicen a qué puerta va
cada entregable, no cuántas semanas antes. Sin declarar se lee como cero, el día
de la puerta.

Es una **lectura, no un dato**, y por eso las semanas usadas viajan en la
propuesta: quien la mira ve el cero y puede corregir la ficha. Descartar todo lo
que no trae semanas habría dejado la regla sin usar justo el día que se enchufa
el catálogo de verdad.

### «CGR» y «cgr» no pueden convivir

Las puertas casan con el catálogo **por su nombre**. Dos filas que sólo se
diferencian en las mayúsculas harían que la mitad de los entregables encontraran
fecha y la otra mitad no, sin que nada lo dijera. Un índice único sobre
`upper(btrim(gate))` lo impide en la base, y el cruce normaliza igual. Se
prohíbe donde se puede, en vez de adivinar después.

## Lo que se vio al mirarlo funcionando

Tres cosas, y las tres salieron de tener la pantalla delante y no del código:

**Los datos de demostración no declaraban ni una puerta.** ADR-0027 añadió las
columnas y la demostración nunca las usó, así que la regla habría sido invisible
el primer día. Ahora el catálogo de demostración va a cuatro puertas inventadas
—RP, RD, RF y PES— y cada proyecto trae las suyas.

**Y las fechas que inventé para esas puertas eran demasiado holgadas.** Todo el
plan cabía con meses de sobra y el aviso no saltaba nunca, que es tanto como no
tenerlo. Las cuatro fechas están ahora puestas **contra lo que el motor
calcula**: la asignación de SIL no llega a su revisión de diseño por cuatro días
y el informe SIL 2 se pasa de largo la suya. Dos avisos de verdad en una
demostración que antes daba cero.

**Y un descuido de texto:** para una tarea que ya tenía su objetivo, la pantalla
decía «habría sido el 2026-05-08» de una fecha que ya estaba puesta. Un
condicional donde iba un presente.

## Alternativas descartadas

**Guardar las fechas de las puertas en el catálogo.** Es donde vive el nombre de
la puerta, así que es la tentación inmediata. Y es lo mismo que decir que todos
los proyectos certifican el mismo día.

**Un `finish_no_later_than` en vez de un objetivo.** Arriba: el plan dejaría de
poder estar mal.

**Recortar la fecha al arranque, como la hoja.** Un objetivo que se cumple
siempre es ruido con forma de dato.

**Elegir una puerta cuando la tarea entrega dos documentos.** Cuál manda no lo
decide la herramienta; se enseña y decide una persona.

**Un permiso nuevo.** `plan.editar` ya dice literalmente «fechas objetivo de una
tarea que ya existe», que es todo lo que esto escribe. Inventar
`puertas.gestionar` habría sido una fila más en una pantalla de permisos que ya
tiene bastantes.

## Consecuencias

La regla del DocFlowChart está en la herramienta y llega hasta el aviso, que era
el punto: la cartera del equipo trae ochenta entregables con su puerta escrita y
hasta hoy esa columna no producía nada.

Queda apuntado lo que **no** hace. El objetivo se pone **por tarea y una vez**:
si alguien mueve la puerta, hay que volver a previsualizar y aplicar. Recalcular
los objetivos solos en cada cálculo sería pisar sin avisar una fecha que alguien
pudo tocar a mano, y eso es otra decisión.

*(Las puertas de la demostración —RP, RD, RF, PES— y sus fechas son inventadas.)*
