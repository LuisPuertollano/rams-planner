# ADR-0034 — El informe baja al grano de la tarea, sin derivar el avance de las horas

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P5

## Contexto

ADR-0026 trajo las horas reales y dejó escrito su coste aceptado:

> El informe cruza plan y realidad **por proyecto y mes**, no por tarea. Es el
> grano al que ya trabajaba; bajar a la tarea es otro cambio.

Este es ese cambio. El dato nunca faltó: la clave de `actual_entry` es (tarea,
persona, día, origen) y `readActualsInPeriod` ya devolvía el `node_id`. Lo que
pasaba es que `ReportActualCell` no lo declaraba, así que el informe lo tiraba
al agregar y la comparación se quedaba en «el proyecto CBTC-L3 lleva 168 h
fichadas de 1.648 planificadas», que es cierto y no señala nada.

## Decisión

El informe gana una sección: **las tareas donde lo gastado y lo avanzado no se
parecen**, peor primero.

Es la única comparación que el grano de proyecto y mes no puede hacer. Con el
caso real que la provocó:

| Tarea | Trabajo declarado | Fichado | Gastado | Avance | Hueco |
|---|---|---|---|---|---|
| Revisión de concepto | nadie lo declaró | 8 h | — | 0 % | sin plan que medir |
| Análisis funcional FMECA | 120 h | 90 h | 75 % | 30 % | **45 %** |
| Hazard Log inicial | 80 h | 60 h | 75 % | 60 % | 15 % |
| Plan RAMS | 40 h | 10 h | 25 % | 100 % | −75 % |

La segunda fila es el motivo de todo esto: tres cuartas partes de las horas
gastadas contra un trabajo que dice ir por el 30 %. Al grano de proyecto y mes
eso está dentro de un «168 de 1.648» que no dice nada.

### Y sigue sin derivarse el avance de las horas

Es lo que ADR-0026 protegía y aquí se respeta al pie de la letra. `spentBp` y
`percentCompleteBp` son **dos datos declarados por personas distintas** —alguien
dijo «va por la mitad», alguien fichó siete horas y media— y la tabla los pone
uno al lado del otro sin que ninguno corrija al otro. `gapBp` es su resta, no
una corrección: la cuarta fila sigue diciendo 100 % de avance con el 25 % de las
horas, y nadie la desmiente.

Lo que significa un hueco lo decide quien mira, y la pantalla lo dice con esas
palabras.

### Tres decisiones que la aritmética obliga a tomar

**Sólo las tareas con horas fichadas.** Una tarea sin horas no tiene hueco:
tiene un plan y nada con qué compararlo, que es otra pantalla.

**Sólo las hojas.** Una fase o un paquete agregan el trabajo de sus hijas, así
que su `workMinutes` no es trabajo suyo y la proporción saldría deformada. Un
hito **sí** entra: se ficha contra él y puede costar horas —una puerta de
revisión cuesta las horas de su propia reunión, como ya dijo ADR-0028—.

**Las tareas sin trabajo declarado van primero, y sin proporción.** `spentBp` es
`null`, no cero: un cero diría «no se ha gastado nada», que es falso. Y van
primero porque son el caso que más merece mirarse — horas contra un plan que
nadie declaró. Es el mismo problema que `unplannedActualMinutes` cuenta por
proyecto y mes, ahora con nombre y apellidos.

### Quince filas

Una lista de ochenta no se mira. El corte es el mismo criterio que ya usan los
riesgos y los hallazgos.

## Alternativas descartadas

**Derivar el avance de las horas gastadas.** Descartado en ADR-0026 y descartado
aquí otra vez: gastar no es avanzar, y confundirlos convierte un proyecto que se
está pasando de presupuesto en uno que va estupendamente.

**Un umbral que marque «esta tarea va mal».** El hueco que importa depende del
trabajo: un 15 % en una tarea de 400 h es más grave que un 60 % en una de 8 h. La
tabla ordena y colorea el signo; poner un número sería inventarse un criterio
que nadie ha pedido.

**Un hallazgo del motor.** Los reales no entran en el motor —ADR-0026— y esto no
cambia esa decisión: la comparación vive en el informe, que es donde ya se cruza
todo lo demás y que no recalcula nada.

## Consecuencias

Once pruebas nuevas, y las que más valen son las que fijan lo que **no** hace:
que el avance llega entero aunque las horas digan otra cosa, que una fase no
entra, y que una tarea sin plan declarado no recibe un cero disfrazado.

Queda pendiente y anotado: la tabla enseña el hueco, no propone nada. Si algún
día hay que actuar sobre él —avisar, replanificar, marcar la tarea—, eso empieza
por decidir qué significa un hueco, y eso no lo decide el código.
