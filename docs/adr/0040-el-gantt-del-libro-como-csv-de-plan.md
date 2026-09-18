# ADR-0040 — El Gantt del libro entra por el CSV de plan, y se dice lo que se pierde

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P4

## Contexto

Hasta ahora el planner sólo se ha probado contra datos de demostración: seis
personas, nueve entregables, trece tareas. El equipo tiene en paralelo un libro
de Excel con **36 proyectos y 4 910 filas de Gantt**, que es el plan de verdad.
Mientras no entre ahí, no se sabe si el motor aguanta lo real.

D-CONV quedó decidida —«sí voy a planificar a todo mi departamento», lo que hace
del libro un paso hacia el planner y no un destino—, así que mover el plan en esa
dirección deja de ser una apuesta.

## Decisión

**Un conversor, `tools/gantt-a-plan.mjs`, que come la hoja `Gantt` exportada a
CSV desde Excel y escupe el CSV de plan del planner.**

Dos cosas del enunciado importan más que el código:

**Come CSV, no `.xlsm`.** El libro lleva proyectos y personas reales y **no entra
en el repositorio jamás**: el conversor es código, el fichero se queda en la
máquina de quien convierte. Y leer `.xlsm` pediría una dependencia nueva para
algo que se usa de uvas a peras, cuando el planner habla CSV de punta a punta.

**Las columnas se buscan por su nombre de cabecera.** La hoja tiene doce filas de
preámbulo, columnas ocultas y cabeceras con saltos de línea dentro
(`Work\ndays`). Contar posiciones se rompe el día que alguien inserta una
columna.

### El nombre de cada tarea es lo que decide si esto funciona

El CSV cita las predecesoras **por nombre**, así que dos tareas de un proyecto no
pueden llamarse igual. Y en el Gantt un documento aparece varias veces —una por
subactividad— y algunas actividades se repiten de verdad: «(S) Safety Management
· S» sale **una vez por año**.

Medido: con sólo `descripción · subactividad` hay **73 choques que afectan a 363
filas**. Añadir la fase apenas los baja a 69, porque los repetidos están dentro
de la misma fase.

Así que el nombre baja escalones sólo cuando hace falta:

| | ejemplo | filas |
|---|---|---|
| 1. descripción · subactividad | `(S) Safety-CbC · C` | 1 176 |
| 2. + el mes de inicio | `(S) Safety Management · S · 2024-06` | 254 |
| 3. + un contador | `(S) Design Review · C (3)` | 256 |

**Cero choques.** Y como la predecesora se resuelve por el `d.id` de la fila y no
por su texto, las dos puntas usan el mismo nombre generado: el enlace cuadra
aunque el nombre se haya desempatado.

### Lo que se pierde se cuenta, no se disimula

El CSV de plan expresa menos que el Gantt. El conversor escribe un parte por la
salida de errores con **lo que ha dejado por el camino**:

- **Los enlaces SS y FF se descartan.** El CSV sólo sabe decir fin-comienzo. Un
  SS convertido a FS no es una traducción: hace esperar a algo que iba en
  paralelo y **alarga el plan importado** sin que nadie lo pida. Quitar una
  restricción se ve y se corrige; inventarse una, no. Son 172 SS en el libro
  entero.
- **Los desfases**, porque el CSV no tiene columna de `lag`.
- **Las horas**, porque el CSV lleva duración y el planner deriva el trabajo de
  ella.
- **Y un aviso que no es una pérdida sino una trampa**: una tarea con cero días
  se convierte en **hito** al importar. Son 222 en el libro, y si no son hitos
  hay que darles duración antes.

### Sólo se ancla lo que no tiene predecesora

Las cabezas de cadena llevan su fecha de inicio del libro en `no_antes_de`; el
resto las coloca el motor. Anclar cada tarea a su fecha del Gantt dejaría las
dependencias de adorno y convertiría el plan en una lista de fechas que no
reaccionan a nada.

Hace falta además por un motivo prosaico que costó encontrar: el importador saca
la fecha de arranque del proyecto de la **menor `no_antes_de` del fichero**. La
primera versión no escribía ninguna, y **todo proyecto importado empezaba hoy**:
la estructura entraba bien y las fechas se perdían enteras.

## Lo que aparece al meter lo real, que es para lo que se hace esto

**El horizonte de cuatro años se queda corto para la mitad de los proyectos.** El
motor lo fija en `inicio del proyecto más temprano − 31 días` más cuatro años.
De los 34 proyectos del libro con fechas, **16 no caben**: los planes de este
equipo duran entre cinco y ocho años, con actividades de acompañamiento que se
estiran años enteros —«(R) RAM Monitoring Report» son 34,8 h repartidas en 522
días—.

No se toca aquí. Ampliar el horizonte multiplica la tabla más grande de la base
(ADR-0035) y es una decisión con su propia medición. Queda escrito porque es el
primer límite real que el planner encuentra, y no se habría visto nunca con los
datos de demostración.

## Alternativas descartadas

**Leer el `.xlsm` directamente.** Una dependencia nueva, y un conversor que
pediría tener el libro a mano en cualquier máquina donde corriera.

**Convertir SS a FS.** Arriba: alarga el plan y parece una opinión de la
herramienta.

**Numerar todas las tareas repetidas** en vez de usar el mes. `(S) Safety
Management · S (7)` no le dice nada a nadie; `· 2024-06` sí, y son la mitad de
los desempates.

**Meter los 36 proyectos de golpe.** Se puede —y sale— pero rara vez es lo que
se quiere, así que hay un `--proyecto` que filtra por parte del nombre.

**Volcar el conversor dentro de la aplicación**, como una importación más. El
Gantt es la forma de **un** libro concreto; el CSV de plan es un contrato
público. Meter el formato de una hoja ajena dentro de la herramienta la ataría a
él.

## Consecuencias

Comprobado de punta a punta contra el libro real, en local y sin que salga nada:
las 4 910 filas dan **1 686 tareas e hitos vivos** (2 966 canceladas fuera) y
1 240 dependencias. Un proyecto real importado en una base limpia entra con sus
**24 tareas, 19 dependencias, 24 asignaciones y 8 personas creadas**, y el motor
lo calcula: 27 tareas, 251 celdas y 6 hallazgos.

Y queda una deuda que se ve desde aquí: las personas entran **por su nombre del
libro**, con jornada estándar y sin tarifa, y algunas de esas casillas no llevan
una persona sino un papel por cubrir o un organismo externo. Revisarlas es
trabajo de quien importa, y la importación ya lo avisa una por una.

*(Los ejemplos de este ADR y las filas de las pruebas son inventados. El libro
lleva proyectos y personas reales y no entra en el repositorio.)*
