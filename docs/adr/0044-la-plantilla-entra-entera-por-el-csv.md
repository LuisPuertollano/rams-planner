# ADR-0044 — La plantilla entra entera por el CSV, con sus entregables y su cadena

**Estado:** aceptada · **Fecha:** 2026-09-19 · **Principios:** P1, P2, P6

## Contexto

Una plantilla en esta herramienta no es un modelo aparte: es un proyecto marcado
como tal, con su árbol, sus duraciones y sus dependencias, que no se calcula. Esa
decisión está tomada desde la migración que la introdujo y sigue siendo buena.

Lo que no estaba resuelto es **cómo se mete una**. La que trae la herramienta de
serie —`PLANTILLA-RAMS`, treinta y un nodos— la escribí yo en una migración, y
por eso es un punto de partida razonable y de nadie. La plantilla de verdad de un
departamento es otra cosa: la del equipo son **114 filas en cuatro fases, con 55
entregables, 100 dependencias y doce puertas**, y hasta hoy no había forma de
traerla que no fuera teclearla.

Tres cosas lo impedían, y las tres son del CSV:

| | |
|---|---|
| El CSV de plan no sabía decir «esto es una plantilla» | así que sólo se podían importar proyectos de verdad |
| El CSV de plan no sabía decir **qué entregable produce una tarea** | así que un plan importado quedaba desconectado del catálogo |
| El CSV de catálogo no sabía llevar la **cadena** C/R1/R2/R3/S | así que las subactividades había que teclearlas entregable a entregable |

## Decisión

**Tres columnas nuevas, y ninguna tabla.**

### `plantilla` en el CSV de plan

Un «sí» —o «yes», «ja», «oui», «x», «1»— y el proyecto entra como molde. Se
declara por proyecto, no por fila: basta ponerlo en una y vale para todas.

Y arrastra una consecuencia que el esquema ya imponía: **una plantilla no lleva
personas**, y hay un disparador que lo hace cumplir. Un fichero exportado de un
proyecto real y marcado como molde trae la columna `recurso` rellena, así que la
importación **avisa y las deja fuera** en vez de reventar. Rechazar el fichero
entero sería castigar exactamente el camino que alguien va a seguir.

### `entregable` en el CSV de plan

El código del entregable que produce la tarea. Es la columna más pequeña de las
tres y la que más cambia lo que se puede hacer después: de esa conexión cuelgan
**las dos cosas que se construyeron encima** —partir la tarea en su cadena
(ADR-0039) y la fecha objetivo de su puerta (ADR-0042)—, y sin ella ninguna de
las dos llegaba nunca a un plan que hubiera entrado por la puerta que todo el
mundo usa.

Un código que no está en el catálogo no aborta nada: se enumeran al final. Es el
descarte que más se va a ver, porque lo normal es importar el plan antes que el
catálogo, y rechazar el fichero obligaría a rehacerlo.

### Las cinco casillas de la cadena en el CSV de catálogo

`crear`, `revisar_1`, `revisar_2`, `revisar_3`, `soportar`. Una columna por
casilla, igual que el ciclo de firma y por el mismo motivo: son las cinco que la
pantalla enseña, así que se leen de un vistazo y se rellenan en una hoja de
cálculo sin aprenderse una sintaxis.

Cada una se escribe `rol:horas` y, cuando hace falta, `rol:horas:firma`, con la
firma nombrada como su propia columna —`Ing. Sistemas:4:verificador_1`—. Ese
tercer trozo es lo que permite avisar de *una firma que cuesta horas y que
ninguna subactividad hace*, que si no se pierde sin que nadie lo note.

Y **la exportación escribe exactamente lo que la importación lee**. No es un
adorno: el CSV exportado es la mejor plantilla que existe, porque ya lleva dentro
el catálogo de quien lo descarga.

## Lo que el dato real corrigió

**Las horas de la cadena eran obligatorias, y el primer catálogo de verdad lo
desmintió en la primera fila.** El razonamiento era bueno —partir una tarea
reparte en la *proporción* del catálogo (ADR-0039), y sin minutos no hay
proporción— y la regla, mala: un **hito** trae su rol y no trae horas, y el
esquema permite `standard_minutes` nulo justamente por eso. La versión estricta
rechazaba un catálogo correcto entero.

Ahora entran, y lo que importa se dice en vez de imponerse: un aviso al terminar
nombra las cadenas que no tienen horas y por tanto no sirven para partir. El
descarte `catalogo-sin-minutos` ya estaba ahí desde ADR-0039 para cuando alguien
lo intente.

**Y un hito no lleva cadena.** Lo dijo la propia herramienta: las doce puertas de
la plantilla real entraron con una subactividad de soporte cada una y la pantalla
las marcó con `ACTIVITY_ON_CONTAINER` —un hito es un instante, no se crea ni se
revisa (ADR-0037)—. El esfuerzo de una puerta **sí** existe y son las 16 h de su
propia reunión; viaja en la columna `horas`, que es donde el modelo lo admite.
Esto no cambió el código: cambió el fichero, y lo cambió porque la herramienta
avisó.

## Alternativas descartadas

**Meter la plantilla real en una migración**, como está la de serie. Es lo más
directo y es justo lo que este proyecto lleva tres decisiones evitando: el libro
del equipo y su contenido **no entran en el repositorio** (ADR-0027, ADR-0040).
La plantilla no lleva personas, pero sí las fases, los entregables y las
duraciones de un departamento concreto. El código es público; el contenido es de
quien lo instala, y entra como dato.

**Una columna `subactividades` con toda la cadena dentro** —`C:Ing:30|R1:Otro:4`—.
Una columna menos y una sintaxis más. Las cinco casillas ya existen en la
pantalla y en el ciclo de firma; inventar una sexta forma de decir lo mismo es
como se llega a tres formas.

**Filas extra en el catálogo para las subactividades.** Rompe «una fila, un
entregable», que es lo que hace que el fichero se pueda mirar en Excel.

**Deducir la plantilla de que no haya personas.** Un proyecto real recién
planificado tampoco las tiene todavía, y se convertiría en molde sin que nadie lo
pidiera.

**Un tipo de importación aparte para plantillas.** Una plantilla es un proyecto;
dos puertas para la misma cosa se desincronizan a la tercera columna.

## Consecuencias

La plantilla del departamento entra entera y comprobada contra una base limpia:
**114 tareas, cuatro fases, 12 hitos, 100 dependencias y 55 entregables
enlazados, sin un solo aviso**; y su catálogo, **55 entregables, 51 precedencias
y 82 subactividades** con su rol y sus horas. Nada de eso está en el repositorio.

La plantilla de serie se queda donde está. Es el punto de partida de quien instala
esto sin tener un libro detrás, y ahora convive con las que cada equipo traiga.

Y queda apuntado lo que **no** hace: el CSV de plan sigue diciendo «hito» con un
cero en `dias`, que es una convención cómoda y ajena a cómo lo dice cualquier otra
herramienta. Al convertir un Gantt de verdad, las puertas traían dos días —lo que
dura su reunión— y habrían entrado como tareas de dos días si el conversor no
hubiera mirado el **tipo** de la fila en vez de su duración. El planner no se
entera de esa diferencia, y algún día habrá que decidir si le importa.

*(Los ejemplos de este ADR, de la plantilla del fichero y de las pruebas son
inventados.)*
