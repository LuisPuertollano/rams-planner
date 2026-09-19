# ADR-0046 — La Checkliste pide el mismo documento varias veces, y cada vez más maduro

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Principios:** P1, P2, P6

## Contexto

ADR-0027 metió en la ficha del entregable a qué puerta va y cuántas semanas
antes; ADR-0042 lo convirtió en fecha objetivo. Las dos daban por hecho lo
mismo: que un entregable **se entrega una vez**.

No es así. Las Checklisten oficiales piden el mismo documento en varias
versiones preliminares, en puertas anteriores, como prueba de madurez del
proyecto y para bajar el riesgo. Y no es una excepción de unos pocos: es
sistemático, y **triplica el plan**.

El catálogo del propio equipo ya lo contenía, disfrazado de otra cosa:

| | Puerta | |
|---|---|---|
| `PMAR` · Pre**l**iminary Maintainability Analysis Report | PGR | el borrador |
| `MaPrR` · Maintainability Prediction Report | CGR | el final |
| `RDemP` (as **Designed**) → (as **Certified**) → `RDemR` **Final** | — · GFV · FQA | tres madureces |

Cuatro filas de catálogo que son **dos documentos**.

## Decisión

**La madurez no es una propiedad del documento: es del par (documento, puerta),
y quien la declara es la Checkliste.** Una tabla `document_gate` con las
entregas **previas**; la final se queda donde estaba, en `document_type.gate`,
así que un catálogo sin ninguna fila se comporta exactamente como antes.

### Por qué no una fila de catálogo por versión

Es la salida evidente y está medida, sobre el catálogo real de 88 filas:

| | filas de catálogo | matriz |
|---|---|---|
| Una fila por versión | 88 → **240** | 7 744 → **57 600** casillas |
| (documento × puerta) | **88** | **7 744** |

Con 240 filas hay tres FMECA que mantener en lugar de uno, y se desincronizan al
segundo mes: se renombra uno, se le cambia el rol a otro. Con la tabla, el FMECA
sigue siendo **un** documento; lo que hay son tres momentos en que se lo piden.

Y hay una ganancia que no es de tamaño: la Checkliste **es lo que cambia** de un
cliente a otro. Separarla del catálogo es lo que permite que el catálogo no
cambie cuando cambia la Checkliste.

### El esfuerzo se reparte, no se multiplica

Cada entrega previa lleva su **parte** del esfuerzo del documento, en puntos
básicos, y lo que no se llevan las previas es lo que cuesta la final. El total
del documento se sigue declarando **una vez**, en `standard_minutes`.

Es la misma regla que ADR-0039 —partir reparte, no vuelve a estimar— y por el
mismo motivo: si cada versión trajera su esfuerzo absoluto, declarar una
Checkliste cambiaría el tamaño del proyecto sin que nadie lo pidiera.

El reparto es entero y suma exacto: el resto de la división va a la entrega
final, que es la que más pesa. Ni un minuto se pierde (P5).

### Una columna con lista, no cinco columnas

La cadena de subactividades usa cinco columnas fijas porque las casillas son
cinco y punto (ADR-0044). Aquí el número **no está acotado** —una Checkliste
puede pedir una versión preliminar o cuatro—, así que es una columna con lista,
como `espera_a`: `PGR:preliminar:30:4|IGR:as designed:20:6`.

La exportación escribe lo que la importación lee, como el resto del catálogo.

### Lo que se comprueba, y que avisa sin impedir

Cuatro cosas, todas sin mirar ningún proyecto, porque el catálogo es de todos:

- **Las previas se llevan todo el esfuerzo.** Entonces la final sale gratis, que
  es otra forma de decir que el reparto está mal.
- **Hay entregas previas y no hay puerta final.** Previa ¿a qué?
- **Una entrega «previa» va a la misma puerta que la final.** No es previa a nada.
- **Un hito o una fase declaran borradores.** Un hito es un instante y una fase
  agrupa; ninguno se va madurando.

Avisan, no impiden. Una Checkliste a medio declarar es el estado normal el
primer día, y una herramienta que se niega a guardarla es una herramienta que no
se usa. Y dos cosas sí las impide el esquema, porque no son estados a medias
sino contradicciones: una entrega que se lleva el 100 %, y dos entregas del
mismo documento a la misma puerta.

## Lo que esto todavía NO hace

**No mueve ni una fecha.** El motor sigue poniendo una fecha objetivo por
entregable, la de su puerta final. Partir la tarea en sus entregas —una por
madurez, cada una con su parte del esfuerzo y su fecha— es la decisión
siguiente, y tiene la maquinaria esperándola: es lo mismo que ADR-0039 hace con
la cadena de subactividades, un nivel más arriba.

Se separa a propósito, por lo mismo que ADR-0027 separó declarar la puerta de
usarla: el dato tiene que existir y poder mirarse antes de que cambie cifras.

## Alternativas descartadas

**Una fila de catálogo por versión.** Medido arriba: 240 filas y una matriz de
57 600 casillas para mantener tres FMECA en vez de uno.

**Meter la madurez en `document_type` con un `borrador_de`** que apunte al
documento final. Fue mi primera propuesta, y estaba dimensionada para «algunos
documentos llevan borrador». Cuando es la Checkliste la que lo pide para todos,
sigue siendo una fila por versión con otro nombre.

**Que el motor decida si un borrador «satisface» una precedencia del final.** Es
una decisión **por arista** —el catálogo real tiene unas 150— y una regla lista
que lo adivine es como se estropea un modelo. Se nombra la fila que se quiere.

**Guardar el esfuerzo absoluto de cada versión.** Declarar una Checkliste
cambiaría el tamaño del proyecto. El total se declara una vez.

## Consecuencias

La Checkliste se puede declarar y se ve: la pantalla del catálogo enseña «PGR
30 % › IGR 20 % › **CGR** 50 %» por entregable, que dice de un vistazo en
cuántos sitios lo piden y que los porcentajes cubren el documento entero.

Queda apuntado lo que no se ha medido: **el efecto en el plan**, porque todavía
no lo tiene. Cuando las entregas se conviertan en tareas, el plan se triplica —y
eso sí está medido: el motor lo traga (1,15 → 1,4 s) y nivelar pasa de 34 a 57 s
(ADR-0045).

*(Los ejemplos de este ADR, de la plantilla del fichero y de las pruebas son
inventados.)*
