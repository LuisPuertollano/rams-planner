# ADR-0047 — La tarea se parte en las entregas que pide la Checkliste

**Estado:** aceptada · **Fecha:** 2026-09-20 · **Principios:** P1, P2, P4, P6

## Contexto

ADR-0046 dejó la Checkliste **declarada**: qué documento se pide en qué puertas,
con qué nombre de madurez y con qué parte del esfuerzo. Y dijo explícitamente
que no movía ninguna fecha. Esto es lo que la mueve.

Mientras la Checkliste sólo está declarada no sirve para planificar. La tarea
«Redactar el FMECA» sigue siendo **una** tarea con **una** fecha objetivo —la de
RD— y el borrador que hay que enseñar en RP, ocho semanas antes, no existe en el
plan. Nadie tiene reservadas esas horas y nadie tiene esa fecha. Es exactamente
el riesgo que las Checklisten querían evitar, reproducido dentro de la
herramienta.

## Decisión

**Partir la tarea en una tarea por entrega**, encadenadas fin-comienzo, cada una
con su puerta y su trozo del esfuerzo. La tarea madre pasa a ser paquete —un
paquete no se estima, agrega (ADR-0039)— y nace una tabla `node_delivery` que
dice, de cada tarea, de qué documento es entrega, en qué puerta, con qué madurez
y si es la final.

Es hermana de `node_activity` y va **un nivel por encima**: primero se parte en
entregas, y cada entrega se puede partir después en su cadena de crear y
revisar. Al revés no significa nada: «crear el preliminar» y «crear el final» no
son dos pasos de una cadena, son dos entregas.

### Por qué la puerta vive en la entrega y no se deduce

`planGateDeadlines` sacaba la puerta del entregable. Si siguiera haciéndolo, las
tres entregas del Safety Case tendrían las tres la fecha de PES y partir no
habría servido de nada. Ahora `node_delivery` trae `gate` y
`weeks_before_gate` propios y **mandan sobre los del documento**.

Podrían deducirse volviendo a leer `document_gate` y emparejando por posición.
No se hace: la fecha objetivo es lo que se mira todos los lunes, y un dato que
hay que recalcular para leerlo no es un dato — es una consulta que algún día
devuelve otra cosa porque el catálogo cambió debajo.

### Lo que hace que el entregable siga funcionando

| | va a |
|---|---|
| el `node_document` | la entrega **final** — es a lo que espera el documento siguiente |
| lo que esperaba **a** la tarea | la **primera** entrega |
| lo que esperaba **por** la tarea | la entrega **final** |

Es la misma convención de ADR-0039, y por lo mismo: la matriz de documentos y
las dependencias entre entregables tienen que seguir dando el mismo grafo
después de partir.

### Las asignaciones se COPIAN, y aquí nos separamos de las subactividades

Partir en subactividades **muda** la asignación al paso de entrada y deja los
demás sin cubrir a propósito: quien crea no es quien revisa, y la herramienta no
inventa a nadie.

Aquí no. El borrador y la versión final del FMECA son el **mismo trabajo de la
misma persona en dos momentos**. Copiar la asignación a todas las entregas no es
una comodidad: es lo único correcto.

Se midió lo que costaba equivocarse. Mudando a la primera entrega, sobre los
datos de demostración:

| | minutos repartidos |
|---|---|
| antes de partir | 98 880 |
| mudando a la primera | **51 576** |
| copiando a todas | 98 880 |

El 47 % del trabajo desaparecía. Y no quedaba pendiente de asignar, que sería
visible: **desaparecía del reparto**, porque una asignación sin trabajo
declarado saca su trabajo de la duración de su tarea, y su tarea pasaba a ser el
borrador. Ninguna prueba fallaba. Lo caza ahora una, en
`delivery-split.integration.test.ts`, que comprueba que la persona sigue en
todas sus entregas y que los días suman los de la tarea original.

La ventana de la asignación (`window_from`/`window_to`) **no** se copia: una
ventana que acotaba la tarea entera no dice nada de un trozo suyo, y arrastrarla
dejaría fuera a las entregas tardías.

## Alternativas descartadas

**Una fila de catálogo por versión.** Descartada en ADR-0046 y por lo mismo:
tres FMECA que mantener en vez de uno.

**Dependencias a varios niveles, sin partir.** Dejar la tarea entera y colgarle
varias fechas objetivo. Es más barato de escribir y no resuelve nada: las horas
del borrador siguen sin estar reservadas en marzo, y el reparto —que es para lo
que existe la herramienta— sigue poniéndolas todas en mayo.

**Repartir a partes iguales cuando la Checkliste no dice porcentajes.** Sería la
herramienta estimando. Si el reparto no está declarado, no se parte, y se dice
por qué (`sin-entregas-previas`).

**Partir automáticamente al importar.** Partir cambia la estructura del plan y
muda asignaciones y dependencias. Se propone, se enseña entero y se aplica
cuando alguien lo acepta, con casilla por tarea. Mismo trato que las
subactividades y que la matriz.

## Coste aceptado

- El plan **crece**: ×1,5 en los datos de demostración, y ×3 en el portafolio
  real. Está medido y el motor lo aguanta — el reparto escala con el **trabajo**,
  no con el número de tareas (168 616 → 171 089 casillas al triplicar).
- Partir es **difícil de deshacer**: no hay un «juntar las entregas». Por eso la
  previsualización enseña las cuentas de antes y después en grande, y el botón de
  aplicar se desactiva si no cuadran.
- Nueve motivos de descarte que mantener. Es el precio de que la pantalla diga
  **por qué no** en lugar de callarse.
