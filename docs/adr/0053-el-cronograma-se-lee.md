# ADR-0053 — El cronograma se lee

**Estado:** aceptada · **Fecha:** 2026-09-22 · **Principios:** P1, P4

## Contexto

La comparativa C1 dejaba esta fila en ámbar:

> **Gantt visual** · libro 🟢 408 columnas diarias, 4 925 filas · planner 🟡
> *hay cronograma, más pobre*

El cronograma metía la cartera entera en el 100 % del ancho. Con la cartera real
—36 proyectos, 6 222 tareas, de 2026 a 2031— cada tarea salía como una raya de
dos píxeles. Servía para decir «hay trabajo» y para nada más: ni se leía una
fecha, ni se veía qué espera a qué, ni dónde caen las puertas.

## Decisión

La escala pasa a ser **píxeles por día** y el lienzo se desplaza, que es lo que
hace el libro con sus 408 columnas diarias. Tres niveles —día, semana, mes— y
todo lo demás se calcula a partir de ese único número, así que no hay dos
sistemas de coordenadas que puedan separarse.

Encima van las cuatro cosas que convierten un dibujo en una herramienta de
decidir:

| | qué contesta |
|---|---|
| **flechas** | ¿por qué esto empieza en junio? |
| **puertas** | ¿qué tareas cruzan la CGR? |
| **holgura** | ¿cuánto puedo retrasar esto sin romper nada? |
| **avance** | ¿cuánto lleva hecho la barra que estoy mirando? |

Y dos decisiones de forma que no son de estilo:

- **Las puertas cruzan las filas de SU proyecto y sólo las suyas.** Una línea de
  lado a lado pondría la puerta de un proyecto encima de las tareas del de al
  lado, que es el error que más confunde de un cronograma de cartera.
- **La holgura se dibuja a rayas y no maciza.** No es trabajo, es sitio libre.
- **La columna de nombres se queda pegada a la izquierda.** Sin eso,
  desplazarse a junio deja las barras sin nombre.

### La cartera arranca plegada

Con 6 222 tareas el cronograma pintaba 6 256 filas y 4 760 flechas de golpe y
tardaba cerca de cuatro segundos en aparecer. Y no servía de nada: nadie mira
seis mil barras a la vez, se abre el proyecto que interesa.

Por encima de 200 tareas arranca plegado. Abrir un proyecto de 217 filas cuesta
**106 ms**. Y una fila plegada **no está vacía**: trae la barra del proyecto, de
su primera tarea a la última, que es lo que de verdad se mira de una cartera —
quién empieza cuándo y quién se solapa con quién.

La holgura se dibuja desde `late_finish`, que sale a la interfaz por primera vez
aquí. En minutos laborables no se puede convertir a días de calendario sin el
calendario de la tarea, así que dibujarla desde `total_slack_minutes` habría
sido una aproximación; desde la fecha es exacta.

## Consecuencias

### Dos fallos del motor que sólo se vieron dibujando

Los dos vienen de ADR-0051, la tarea que dura una fase, y ninguno se veía en las
pruebas ni leyendo el código. Se vieron porque el cronograma los pinta.

**1. La gestión de cada proyecto salía en rojo.** Una tarea continua tiene
holgura cero —su ventana está clavada entre dos puertas—, así que `isCritical`
la daba por crítica. Pero crítica significa «si esto se retrasa, se retrasa el
plan», y una tarea continua no se puede retrasar. Metía la gestión de todos los
proyectos en el camino crítico y en el filtro de «sólo lo crítico», que es
justo donde alguien va a buscar lo que sí puede mover.

**2. Y el peor: el camino crítico desaparecía.** El fin calculado de un proyecto
es el mayor fin de sus tareas, y una tarea continua que va del arranque a la
puesta en servicio lo estiraba meses más allá del último trabajo. Con ese fin,
todas las demás tareas salían con holgura de sobra y **el proyecto se quedaba
sin camino crítico**. En silencio.

Una tarea continua ya no cuenta para el fin del proyecto: su fecha de fin no es
un resultado, es una declaración. En la demostración, las tareas críticas pasan
de 6 a 11 — las cinco que faltaban son la cadena real que estaba escondida.

### Lo que NO se hace

- **No entra una librería de Gantt.** Los componentes comerciales traen su
  propio modelo de datos y su propio motor, y eso reintroduce justo la mezcla
  entre lo declarado y lo derivado que el sistema prohíbe. Aquí las barras son
  una proyección de `task_result` y nada más.
- **No se arrastran las barras.** Mover una barra con el ratón escribiría una
  fecha, y las fechas las calcula el motor (P1). Lo que se toca es lo declarado,
  y eso se toca en el plan.
- **No se virtualizan las filas.** Plegar resuelve el caso real con veinte
  líneas de código; virtualizar son doscientas y un scroll que se pelea con las
  flechas. Si algún día un solo proyecto tiene tres mil tareas, se revisará.
