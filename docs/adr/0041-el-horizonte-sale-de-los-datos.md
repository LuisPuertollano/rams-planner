# ADR-0041 — El horizonte sale de los datos, y las particiones se crean solas

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P2, P3, P5

## Contexto

ADR-0040 metió planes de verdad y dejó escrito el primer límite que el planner
encontró: **el horizonte de cuatro años no cabía para 16 de los 34 proyectos
reales**. El motor los rechazaba con `OUT_OF_HORIZON` y no había forma de
calcular nada.

La causa es que el horizonte es **global** —uno para toda la instalación— y era
fijo:

```ts
const from = addDays(calendarDate(earliest ?? '2026-01-01'), -31)
return { from, to: addDays(from, 365 * 4) }
```

Con una cartera que va de 2023 a 2037 eso son catorce años, no cuatro. Cuatro
años bastaban para los datos de demostración y para nada más.

## Decisión

**El horizonte se calcula a partir de los datos declarados.** Tres entradas,
todas disponibles **antes** de programar —que es la pega de verdad, porque el
calendario se compila sobre el horizonte y por tanto el horizonte no puede
depender del resultado—:

| entrada | qué aporta |
|---|---|
| `project.status_start` | dónde empieza todo |
| `constraint_date` y `deadline` | lo que alguien ató a una fecha |
| la **cadena más larga de duraciones declaradas** | cota superior de lo que el motor pedirá |

La cadena más larga sale del grafo de dependencias con un recorrido recursivo en
SQL: es el peor caso —todo en fila— y por tanto una cota superior segura, sin
programar nada.

Sobre eso: **un año de margen, un suelo de cuatro años y un techo de
veinticinco.**

- **El suelo** está para que esto no encoja nada de lo que ya funcionaba.
- **El techo** está porque el horizonte multiplica la tabla de capacidad: son
  las personas por los días laborables del tramo. Un fichero mal importado con
  una fecha de 2199 no puede llevarse la base por delante. Si el techo llega a
  apretar, el motor dirá `OUT_OF_HORIZON` como siempre — mejor un error que se
  entiende que una tabla de diez gigas que nadie pidió.

### Y el recorrido lleva tope de saltos

El esquema **no impide** un ciclo de dependencias: se avisa, no se prohíbe
(ADR-0016). Un recorrido recursivo sobre un grafo con un ciclo no termina nunca.
Mil eslabones es más profundo que cualquier plan de verdad, y hay una prueba que
mete un ciclo y comprueba que el cálculo del horizonte termina.

## La avería que esto destapó

Ampliar el horizonte hacia atrás rompió la escritura:

```
no partition of relation "assignment_timephased" found for row
```

`assignment_timephased` está **particionada por año**. El esquema inicial dejó
sembradas 2024–2035 y una función, `ensure_assignment_timephased_partition`,
cuyo comentario dice literalmente *«la llama el worker al ampliar el
horizonte»*.

**No la llamaba nadie.** Mientras el horizonte fueron cuatro años fijos desde
2026 la siembra bastaba y el agujero no se veía; en cuanto el horizonte alcanzó
2023 —hay proyectos que arrancaron entonces—, saltó. Ahora la llama el cálculo,
para cada año del tramo, antes de escribir. Es idempotente y barato.

## Lo que cuesta, medido

El libro entero del equipo, importado de una vez en una base limpia:

| | |
|---|---|
| Proyectos · fases · tareas | 36 · 119 · **1 686** |
| Dependencias · personas creadas | 1 240 · 27 |
| Horizonte resuelto | 2025-12 → 2038 (**12,3 años**) |
| Cálculo | 1 805 tareas, **168 616 celdas**, 822 hallazgos |
| Tiempo | **1,5 s** |
| Base entera | **63 MB** |

De esos 63 MB, `capacity_cell` son 14 MB — **un solo bloque** compartido por
todas las ejecuciones gracias a ADR-0035. Sin aquella deduplicación, ampliar el
horizonte a doce años habría multiplicado esa tabla por cada cálculo, y esta
decisión habría sido cara en vez de barata. Las dos van juntas.

## Alternativas descartadas

**Subir el número fijo a quince años.** Es lo más corto de escribir y vuelve a
fallar el día que alguien tenga un proyecto de 2015: el problema no era el
número, era que fuera fijo. Y castiga a quien planifica seis meses con doce años
de capacidad que nadie mira.

**Un horizonte por proyecto.** Sería lo correcto si los proyectos no
compartieran personas — y las comparten, que es el motivo entero de esta
herramienta. La capacidad de alguien en marzo es la misma para todos sus
proyectos.

**Usar la suma de todas las duraciones** en vez de la cadena más larga. También
es cota superior y mucho peor: con 1 686 tareas daría siglos.

**Hacerlo configurable en una pantalla.** Un ajuste que nadie sabe poner es un
ajuste que se queda mal puesto. Sale del dato; si algún día hace falta forzarlo,
esa es otra decisión.

## Consecuencias

El planner traga la cartera real entera, que es la primera vez que puede
decirse. Y queda apuntado lo que **no** se ha mirado: con 168 616 celdas y 1 805
tareas el cálculo tarda 1,5 s, pero **el reparto y la nivelación no se han
medido a esta escala** — sólo el cálculo. El día que alguien nivele los 36
proyectos de golpe, habrá que volver a medir.

Y una cosa más que ahora es visible y antes no: **822 hallazgos** en la cartera
real. No se han mirado uno a uno; son la siguiente pregunta, no ésta.
