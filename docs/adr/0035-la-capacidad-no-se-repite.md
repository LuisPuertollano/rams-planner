# ADR-0035 — Se guarda todo el historial, pero la capacidad no se escribe dos veces

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P2, P3, P5

## Contexto

ADR-0033 dejó la pregunta abierta: en una instalación de verdad, ¿cuánto
historial de ejecuciones se guarda? **La respuesta es: todo.** Una ejecución
tiene que poder reproducirse dentro de dos años, y para eso la capacidad contra
la que se calculó tiene que estar entera, día a día.

Guardar todo cuesta, así que lo primero fue medir cuánto. Con **una sola**
ejecución de los datos de demostración —seis personas—:

| Tabla | Tamaño | Filas |
|---|---|---|
| `resource_capacity_timephased` | **1 024 kB** | 6 018 |
| `change_event` | 296 kB | 397 |
| `assignment_timephased_2026` | 88 kB | 237 |
| `derivation` | 88 kB | 87 |
| `finding` | 64 kB | 13 |

Una tabla se lleva el 70 %, y no es una sorpresa: son las personas por los días
del horizonte. Con veinticuatro personas y cinco años son unas 44 000 filas y
7,6 MB **por cálculo**. A cinco cálculos al día, 12 GB al año.

Entonces apareció el dato que decide el diseño. Tres cálculos seguidos, sin
tocar ningún calendario:

```
huella                             filas   ejecución
04c9fc4a6d4a35c18b319061445d7c17    6018   52de9bc1…
04c9fc4a6d4a35c18b319061445d7c17    6018   87378417…
04c9fc4a6d4a35c18b319061445d7c17    6018   98cd4254…
```

La misma huella tres veces. **No es que ocupe mucho: es que es la misma copia,
tres veces.**

Y tiene una explicación exacta: **la capacidad no depende del plan**. Sale del
calendario de la persona, de sus ausencias y de sus factores de indirecto y
reserva (ADR-0023). Mover una tarea recalcula el plan entero y no mueve ni un
minuto de capacidad.

## Decisión

**El bloque de capacidad se guarda por su contenido.** Un `capacity_set`
identificado por la huella de sus celdas, y cada ejecución apuntando al suyo. Si
ya existe un bloque con esa huella, la ejecución apunta al que hay y no se
escribe ni una celda; en cuanto alguien toca un calendario, la huella cambia y
nace un bloque nuevo.

Es exactamente lo que `calculation_run.input_hash` ya hacía con la instantánea
del plan, aplicado a la capacidad.

### No se pierde nada, y se gana una lectura

Medido en la base de demostración, seis cálculos sin tocar calendarios y dos
más después de meter quince días de vacaciones:

| | |
|---|---|
| Ejecuciones | 8 |
| Bloques | **2** |
| Celdas guardadas | 12 025 |
| Celdas que ve la herramienta | 48 138 |

Los dos bloques tienen 6 018 y 6 007 celdas: la diferencia son los once días
laborables de las vacaciones. Cada ejecución sigue viendo su capacidad entera,
incluida la de julio de quien todavía no las había pedido.

Y aparece algo que antes no se veía: **cuándo cambió la capacidad**. Dos bloques
significan un cambio de calendario entre medias, y está fechado.

### La vista conserva la forma de siempre

`resource_capacity_timephased` sigue existiendo, ahora como vista sobre el
bloque de la ejecución. Las tres consultas que la leían —`readUtilization`,
`readCapacityInPeriod` y el informe— **no se han tocado**, y las dos vistas del
esquema inicial que colgaban de ella se recrean idénticas. Quien pregunta por la
capacidad de una ejecución sigue preguntando igual.

### La huella se calcula en SQL

En la base y no en TypeScript, con la misma expresión en el escritor y en la
migración que mudó los bloques viejos. Dos definiciones de «la misma capacidad»
serían la forma segura de que una ejecución vieja y una nueva idénticas acabaran
con dos bloques en vez de compartir uno.

### El bloque compartido no puede colgar de una ejecución

Y por eso no hay borrado en cascada: borrar una ejecución se llevaría por
delante la capacidad de las otras cinco que comparten su bloque.
`deleteRunsSince` recoge después los bloques que ya no mira nadie, y hay una
prueba para cada mitad de esa frase.

### Una ejecución sin capacidad no apunta a ningún bloque

`capacity_set_id` se queda nulo. Un bloque vacío compartido por todas las
ejecuciones sin capacidad sería más uniforme y diría que tienen capacidad; no la
tienen.

## Alternativas descartadas

**No guardar la capacidad y recalcularla al leer.** Ocuparía cero y rompería lo
único que este ADR tenía que proteger: si el calendario cambió desde entonces,
la ejecución de hace dos años ya no se reproduce. Es la opción que contradice la
decisión.

**Comprimir por tramos consecutivos** (una fila por racha de días con el mismo
valor). Medido sobre los datos reales: **factor 4,4**, porque el fin de semana
corta toda racha a cinco días. Para ganar 4× habría que reescribir las tres
consultas de lectura con uniones por rango. Mal cambio.

**Un blob comprimido por ejecución.** El más pequeño y el que rompe todo lo
demás: deja de poderse consultar en SQL, y con ello la explicación de cada
número (P4) y las tres lecturas.

**Deduplicar también `assignment_timephased`.** Esa sí depende del plan, así que
cambia en cuanto cambia lo que se está planificando. Y es pequeña: 88 kB frente
a 1 024 kB en la misma medición. La medida dice que no.

**Borrar historial viejo.** Es lo que D-HIST descartó: se guarda todo.

## Consecuencias

En el caso normal —recalcular sin tocar un calendario— una ejecución pasa de
costar unos 7,6 MB a costar una fila. En una base mixta con veinticuatro
ejecuciones de todo tipo, la migración dejó 12 037 celdas guardadas donde antes
había 48 138: **4×**, y sin perder ninguna.

Las cifras de la herramienta no se mueven ni un minuto: el informe de los datos
de demostración sigue diciendo 5 987 h de capacidad y 1 648 h comprometidas,
antes y después.

Queda anotado lo que este ADR **no** resuelve: si algún día el horizonte crece a
quince años y el equipo a cincuenta personas, un solo bloque son 180 000 celdas.
Seguirá siendo uno solo mientras nadie toque un calendario, pero el día que se
toquen a menudo habrá que volver a medir.
