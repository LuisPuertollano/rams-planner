# ADR-0039 — Partir la tarea en su cadena, sin mover el total

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P4, P5, P7

## Contexto

ADR-0037 dejó el catálogo declarado —qué subactividades tiene cada entregable,
con qué rol y cuántos minutos— y dijo en voz alta lo que no hacía: partir la
tarea del plan. Esto es eso, y es el cambio que de verdad mueve el plan.

Dos hechos del modelo lo fijan casi todo, y conviene decirlos antes que
cualquier diseño:

**La invariante W2: un `task` no puede tener hijos.** Así que partir no es un
`INSERT`. La tarea pasa a ser `work_package`, su fila `task` desaparece —un
contenedor no se estima, agrega— y nacen sus hijos. Por el camino hay que mudar
lo que colgaba de ella.

**`actual_entry.node_id` apunta al nodo.** Una tarea con horas fichadas que pase
a contenedor deja esas horas en un nodo que el informe por tarea (ADR-0034) ya
no mira, porque sólo cuenta hojas. Desaparecerían sin que nadie lo note, que es
la única cosa que esta herramienta no hace.

## Decisión

**Una operación de previsualizar y aceptar, como la matriz de documentos.** La
función que decide es pura y no escribe nada; devuelve lo que haría y el motivo
de cada descarte. Aquí pesa más que en la matriz: la matriz **añade**
dependencias, esto **reestructura el plan**.

### Se reparte la magnitud que la tarea declara

Encontrado mirando la pantalla, que es exactamente para lo que se mira: la
primera versión repartía `work_declared_minutes`, y **en un plan de verdad casi
ninguna tarea lo declara**. Las tareas de este modelo son `fixed_duration`: el
tamaño lo lleva la duración y el trabajo se deriva de ella. La propuesta salía
vacía con trece tareas descartadas por «no declara trabajo».

Así que se reparte la que la tarea tenga: el trabajo declarado cuando lo hay, y
si no la duración. El hijo nace con la misma magnitud que su madre —meter el
trozo en la otra casilla dejaría la tarea en cero— y la pantalla dice cuál de
las dos está repartiendo.

### El total del proyecto no se mueve. Ésta es la decisión.

El reparto usa la **proporción** del catálogo, no sus minutos absolutos:

```
tarea: 40 h declaradas        catálogo: crear 40 h · revisar 10 h  (4:1)
                        ↓
  Crear     32 h              Revisar 1     8 h
```

La tarea traía 40 h porque alguien las estimó para este proyecto. El catálogo
dice en qué proporción se reparte el trabajo, no cuánto cuesta este proyecto.
Usar sus minutos tal cual sería más simple y haría que **partir una tarea
cambiara el esfuerzo del proyecto**: la herramienta pisando la estimación de una
persona sin que nadie se lo haya pedido.

El reparto es entero y suma exacto —el resto va al escalón más grande, con orden
estable para el empate— y la pantalla enseña las dos cifras, antes y después,
antes de dejar aplicar. Si no coinciden, el botón no se pulsa.

### A dónde va cada cosa

| | va a |
|---|---|
| Las asignaciones | la **puerta de entrada** (quien estaba asignado estaba haciéndola) |
| El entregable | la **puerta que cierra** (es a lo que espera el siguiente documento) |
| Lo que esperaba a la tarea | su puerta de entrada |
| Lo que esperaba por la tarea | su puerta que cierra |

A los pasos que no son la entrada **no se les inventa una persona**: el catálogo
declara un rol, y un rol no es nadie. Se quedan sin asignar, que es lo que la
pantalla tiene que enseñar para que alguien lo mire.

Y de ahí sale el efecto que justificaba todo esto: el siguiente documento deja
de esperar a que termine todo lo del anterior para esperar a que esté
**revisado**. Es lo que hace el libro del equipo en 299 de sus enlaces.

### Lo que no se toca, y por qué

Nueve motivos, cada uno con su frase en la pantalla:

| código | por qué |
|---|---|
| `con-horas-reales` | lo de arriba: esas horas desaparecerían |
| `es-subactividad` | ver abajo; sin él no tiene fondo |
| `ya-partida` | volver a partirla partiría los trozos |
| `varios-entregables` | cuál de las dos cadenas manda no lo decide la herramienta |
| `catalogo-sin-minutos` | sin proporción, repartir a partes iguales sería estimar |
| `sin-subactividades` | partir en un trozo es no partir |
| `sin-entregable`, `sin-tamano`, `no-es-tarea` | no hay nada de donde partir |

## Una avería que encontró la prueba de idempotencia

La primera versión entraba en recursión sin fondo, y no se veía leyendo el
código. La puerta que cierra **hereda el entregable**; por tanto el hijo
«Revisar 1» entrega el FMECA; por tanto el catálogo del FMECA dice que tiene dos
subactividades; por tanto se propone partir «Revisar 1» en su propio «Crear» y
«Revisar 1». Y ésos otra vez.

Lo cazó la prueba de que aplicar dos veces no hace nada, que es exactamente para
lo que estaba. El arreglo es el motivo `es-subactividad`: partir una
subactividad en las subactividades del mismo entregable no significa nada.

## Alternativas descartadas

**Usar los minutos absolutos del catálogo.** Arriba. Es la alternativa real y
la que cambia el número del proyecto.

**No tocar el árbol y expandir sólo dentro del motor**, como una descomposición
derivada. Ocuparía cero y rompe lo único que hacía falta: no se puede asignar a
una persona a la revisión, que es el punto entero.

**Permitir partir una tarea con horas reales, moviéndolas al hijo `create`.**
Suena razonable y es adivinar: las horas fichadas contra «el FMECA» pueden ser
de quien lo escribió o de quien lo revisó, y la herramienta no lo sabe. Mejor
decir que no se toca.

**Dejar la asignación colgando del contenedor.** El esquema lo aguanta y el
motor no: la carga nace de las asignaciones de las hojas.

**Repartir a partes iguales cuando el catálogo no trae minutos.** Sería la
herramienta estimando. Se dice y se deja sin partir.

## Consecuencias

Es la primera operación de la herramienta que **cambia de qué tareas se compone
un plan**, y por eso pide `plan.estructura` y no `plan.editar`: quien puede
cambiarle un número a una tarea no tiene por qué poder cambiar cuáles hay.

Queda escrito lo que **no** trae, y es lo siguiente que pedirá quien lo use:
**no hay deshacer**. `node_activity` guarda qué nodo nació de qué expansión
precisamente para poder recogerla, pero la operación inversa no está escrita.
Mientras tanto, la red es la de siempre: una línea base creada antes de partir
conserva el plan como estaba.

Y una consecuencia cosmética que se ve en cuanto se aplica: **las duraciones
salen fraccionarias**. Repartir 4 800 minutos en cuatro a uno da 3 491 y 1 309,
que en días son 7,2729 y 2,7270. Redondear a días enteros sería más bonito y
rompería lo único que este ADR promete —que la suma sea exacta—, así que los
minutos mandan y el día es lo derivado.

Y algo más que hay que decir claro porque se pierde: **la restricción y la
fecha límite de la tarea desaparecen al partirla**. Viven en la fila `task`, y
esa fila se borra porque un contenedor no la puede tener. Los hijos nacen `asap`
y encadenados, y es el motor quien los coloca; si la tarea tenía un
`must_finish_on` o un `deadline`, hay que volver a ponerlo en la puerta que
corresponda —normalmente la que cierra—. Lo que sí se conserva es el calendario:
partir una tarea no puede cambiar en qué días se cuenta su trabajo.
