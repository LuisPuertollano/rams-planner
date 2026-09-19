# ADR-0054 — La escala del tiempo se elige

**Estado:** aceptada · **Fecha:** 2026-09-22 · **Principios:** P2, P4

## Contexto

Era la última fila ámbar de la comparativa C1:

> **Métricas por año y por mes** · libro 🟢 182 columnas de 2020 a 2033 ·
> planner 🟡 *informe por mes dentro del periodo pedido*

La matriz de carga, el mapa de saturación y la tabla del informe estaban
clavados al mes. Con la cartera real —34 proyectos de 2026 a 2031— eso son
**setenta y una columnas**, y una tabla de setenta y una columnas no se lee: no
se puede comparar un año con otro porque no caben dos a la vista.

La pregunta que no se podía contestar es la que se hace un jefe de
departamento: *«¿cuánto tiene comprometido esta persona en 2029?»*.

## Decisión

Tres escalas —**mes, trimestre, año**— en las tres pantallas que enseñan una
rejilla de tiempo: Carga, Saturación y la tabla del informe.

### Se agrupa en el navegador, no en el servidor

Las celdas siguen llegando por mes y se suman aquí. No es un atajo: **un año es
la suma de sus meses**, así que agrupar en el navegador da exactamente lo mismo
que volver a preguntar, sin una segunda petición y sin dos implementaciones de
la misma cuenta que puedan separarse.

El servidor ya sabía agrupar por trimestre, y estuve a punto de añadirle el año.
No lo tiene: con la exportación fijada al mes —a propósito, ver abajo— ese
`year` no lo habría llamado nadie.

### La saturación no se suma: se recalcula

Es la única cuenta que puede mentir sin que se note, y por eso está aislada en
una función con su propia prueba.

La saturación de un año **no** es la media de las de sus meses. Un agosto en el
que casi nadie trabaja tiene poca capacidad y poco trabajo; promediarlo con un
marzo entero le da el mismo peso a los dos. La cuenta correcta es el trabajo
del año dividido entre la capacidad del año:

| | agosto | marzo | media de los dos | lo correcto |
|---|---|---|---|---|
| trabajo | 200 | 1 000 | | 1 200 |
| capacidad | 100 | 10 000 | | 10 100 |
| saturación | 200 % | 10 % | **105 %** | **12 %** |

La media da un número que parece razonable y está diez veces mal.

### Los huecos se rellenan

Un año sin trabajo entre dos que sí tienen sale como columna vacía. El hueco es
el dato: en una cartera, el año en el que no hay nada comprometido es
exactamente lo que hay que ver.

## Consecuencias

- Las tarjetas de arriba —«saturación del equipo: media de los meses con
  trabajo», «personas sobrecargadas: en al menos un mes»— **siguen siendo
  mensuales** y siguen diciendo «mes». Son del encabezado de la aplicación, no
  de la pantalla, y cambiar su significado al tocar la escala de una tabla
  sería una sorpresa desagradable.
- Las pistas de las pestañas dejan de prometer «cada mes»: ahora dicen «en la
  escala que elijas», porque si no la pantalla contradice a su propio título.
- **La exportación sigue siendo mensual**, y es deliberado: el mes es el dato
  fino. Un año se suma desde los meses en cualquier hoja de cálculo; de un año
  no se pueden sacar los meses.
- El trimestre se escribe `2026-T2` porque así lo escribe PostgreSQL con
  `to_char(…, 'YYYY-"T"Q')` y así saldría de una exportación. La `T` es de
  «trimestre» y en las otras tres lenguas no significa nada, así que **la letra
  se traduce al enseñarla y la clave se deja en paz**.

### Lo que NO se hace

- **No se añade el día ni la semana.** El servidor sabe agruparlos y no se
  ofrecen: una matriz de carga por días son mil columnas y ninguna pregunta que
  alguien se haga de verdad.
- **No se guarda la escala elegida.** Es una forma de mirar, no una
  preferencia; quien entra a la pantalla la ve como la vería cualquiera, y eso
  hace que dos personas que hablan del mismo número estén mirando lo mismo.
