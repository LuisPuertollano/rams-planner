# ADR-0055 — El historial guarda lo que cambia

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** P7

## Contexto

El historial crecía más de lo que se creía. En la cartera real, `change_event`
ocupa **17 MB con 28 252 eventos**, y cada restauración de una copia de
seguridad le añade unos 11 MB de golpe.

Antes de tocar nada, tres medidas:

| | eventos | JSONB | qué son |
|---|---|---|---|
| `insert` | 22 540 | 7,5 MB | importaciones y restauraciones |
| `update` | 4 862 | 3,3 MB | lo que alguien edita a mano |
| `delete` | 850 | 0,3 MB | bajas |

Y la que decide el diseño: **la media de columnas que cambian de verdad en un
UPDATE es 1,00**. Para anotar «alguien cambió la duración de esta tarea» se
escribían las dos filas completas, las quince columnas dos veces: **810 bytes
por un número**.

## Decisión

Un UPDATE guarda **sólo las claves cuyo valor cambia**, con su antes y su
después. Un INSERT y un DELETE siguen guardando la fila entera.

```
antes   {"node_id":"…","task_type":"fixed_duration", …15 columnas…}
        {"node_id":"…","task_type":"fixed_duration", …15 columnas…}

ahora   {"duration_minutes": 2414}
        {"duration_minutes": 2415}
```

No se pierde nada de lo que el historial contesta —quién cambió qué, cuándo y
por qué—. La pantalla del registro ya calculaba ese mismo diff al leer y tiraba
el resto; lo único que desaparece es la copia de las columnas que nadie tocó,
que tampoco servía para reconstruir la fila: eso siempre ha exigido recorrer el
historial entero desde el principio.

El INSERT y el DELETE se quedan como estaban a propósito: en un alta la fila
entera **es** el cambio, y en una baja es lo que se pierde. Reducirlos sería
borrar información, no comprimirla.

### Medido

| | antes | después | |
|---|---|---|---|
| 300 ediciones de una columna | 243 kB | **22 kB** | 11× |
| los 4 862 UPDATE de la cartera real | 3,3 MB | **0,39 MB** | 88 % |

## Consecuencias

### Lo que se midió y NO sirve

**Comprimir la columna con la compresión de PostgreSQL no ahorra un solo
byte.** Una fila de `change_event` ocupa unos 800 bytes y el umbral de TOAST
son 2 kB: estas filas nunca llegan a comprimirse. `SET STORAGE MAIN` habría
sido una migración que no hace nada, y sólo se supo midiendo.

Quitar las claves nulas (`jsonb_strip_nulls`) ahorra entre el 0 % y el 30 %
según la tabla, un 17 % de media. Se descarta: cambia «la columna estaba a
nulo» por «la columna no está», que no es lo mismo, a cambio de poco.

### Había DOS disparadores, no uno

`task` tiene el suyo porque su clave es `node_id` y no `id`. La primera versión
de este cambio sólo tocó el genérico, y **las tareas —la tabla que más pesa—
siguieron guardando la fila entera**. No se vio leyendo el código: se vio
midiendo, porque las cifras no bajaron.

El diff vive ahora en una función, `cambios_de`, que usan los dos. Escribir la
misma cuenta dos veces es la forma segura de que un día digan cosas distintas.

### Lo que esto NO arregla: la restauración

Las restauraciones son INSERT, y un INSERT guarda la fila entera porque tiene
que hacerlo. De los 11 MB que añade una restauración, esto no quita casi nada.

Ese caso tiene una solución mejor y **no se hace aquí porque no es una decisión
técnica**: si la restauración hiciera *upsert* en vez de vaciar y volver a
insertar, las filas que no cambian no producirían ningún evento —el disparador
ya se calla cuando `OLD = NEW`— y restaurar una copia reciente costaría
prácticamente cero. A cambio, hay que reescribir la operación más destructiva
de la herramienta. Queda propuesto, no hecho.

### La vuelta atrás

`migrate:down` deja los dos disparadores como estaban. Los eventos ya escritos
**no se tocan** —son append-only (P7)—, así que una base revertida tiene un
historial con las dos formas. Se distinguen solas: un evento reducido trae
menos claves que la tabla.
