# ADR-0033 — Las pruebas de integración recogen lo que ensucian

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P2, P7

## Contexto

Los ficheros de integración comparten **una** base de datos —así se decidió, y
por eso `fileParallelism` se apaga cuando hay `DATABASE_URL`—. Cada cálculo que
hacen deja unas **110 000 filas** en `resource_capacity_timephased`, y nadie las
borraba nunca.

Medido en este contenedor: la base de pruebas llegó a **1,8 millones de filas**
en una tarde de trabajo, con 175 ejecuciones guardadas y una sola línea base
entre todas ellas. La factura llega despacio y por la puerta de atrás: el
fichero de permisos tardaba 7,6 s con la base recién migrada y 9,1 s con esos
1,8 millones dentro. Sobre una base de desarrollo de semanas, alguna prueba
acaba pasándose del plazo de vitest, y lo que se ve entonces es un fallo rojo
que parece del código y es basura acumulada.

Es el peor tipo de fallo: el que aparece en la máquina de uno y no en CI, donde
la base nace limpia en cada ejecución.

## Decisión

**Cada fichero de integración borra las ejecuciones que nacieron mientras él
corría.** Marca el instante al arrancar y en su `afterAll` llama a
`deleteRunsSince`, que arrastra por cascada las celdas, los hallazgos y las
derivaciones.

Funciona porque no hay dos ficheros calculando a la vez: la misma decisión de
`fileParallelism` que obligaba a compartir base es la que hace que «lo que
apareció desde que arranqué» sea exactamente lo mío.

Resultado medido: la suite entera pasa de dejar 110 510 filas por ejecución a
dejar **cero**.

### Una ejecución congelada no se borra

`baseline` apunta a su ejecución con `ON DELETE NO ACTION`, y aquí se respeta
con una condición explícita en vez de dejar que la base grite. Una línea base es
la foto contra la que se compara; borrarla no es limpiar, es perder la
referencia. La prueba que lo fija existe por eso.

### En producción no limpia nadie

`deleteRunsSince` no se llama desde ninguna ruta ni desde la CLI. Una ejecución
es historial, y **cuánto historial se guarda no es una tarea de mantenimiento:
es una decisión de quien usa la herramienta.** Queda anotado como pregunta
abierta, no resuelto por la puerta de atrás.

### Y el plazo, elegido en vez de heredado

Los 5 s de serie de vitest son para una prueba en memoria. Una de integración
hace logins de verdad —el hash de la contraseña es deliberadamente lento— y
recalcula planes enteros contra PostgreSQL: la más lenta ronda el segundo con la
base recién migrada, y en un runner cargado eso deja un margen de cinco veces,
que es poco. Cuando hay `DATABASE_URL`, el plazo pasa a 30 s.

**No tapa nada.** No se consiguió reproducir aquí ninguna prueba suelta pasando
de 5 s; lo que sí se reprodujo y se arregla es el crecimiento que lleva hasta
ahí. El plazo es un presupuesto elegido para el trabajo que esas pruebas hacen.

## Alternativas descartadas

**Una base por fichero.** Lo correcto en abstracto y caro de verdad: cada
fichero tendría que migrar la suya, y la suite pasaría de medio minuto a
varios. El problema no era el aislamiento —ya lo hay, vía `fileParallelism`—
sino la basura.

**Subir el plazo y ya.** Compra tiempo y no arregla nada: con la base creciendo
sin límite, el siguiente número también se queda corto.

**Borrar por prefijo del código de proyecto.** Frágil y parcial: las ejecuciones
cuelgan del escenario, no del proyecto, y son ellas las que pesan.

## Consecuencias

Una base de desarrollo deja de engordar sola, y con ella desaparece la clase de
fallo que sólo le pasa a quien lleva tiempo con el proyecto abierto.

Queda abierta y anotada la pregunta que este ADR no contesta: **en una
instalación de verdad, ¿cuánto historial de ejecuciones se guarda?** Hoy, todo.
