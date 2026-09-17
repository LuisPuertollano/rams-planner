# ADR-0024 — El estado del proyecto, y el enlace que se queda colgando

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1, P2, P3, P4

## Contexto

El tercero de los datos que [ADR-0023](0023-capacidad-neta-y-compromiso.md) vio
en PlaTo y dejó fuera a propósito, por una razón que sigue siendo la buena: a
diferencia del compromiso y de la línea base de referencia —que son de
lectura— **éste cambia el motor**.

## Decisión

`project.status` es `activo`, `inactivo` o `archivado`. Sólo `activo` entra en
el cálculo.

- `activo` — se calcula y consume capacidad. Lo de siempre.
- `inactivo` — declarado y en pausa: no hay presupuesto todavía, o está parado
  esperando algo.
- `archivado` — terminado o muerto. Se guarda por su historia y no vuelve.

Los dos últimos salen igual del cálculo, y la diferencia es de **intención, no
de motor**: «va a volver» y «se acabó» son dos cosas distintas para quien mira
la lista, aunque el planificador las trate igual. Es la razón de que sean dos
estados y no un `is_active`, y es lo que tiene PlaTo.

### Lo ya calculado no se toca

Una ejecución es inmutable (P3). El proyecto que se archiva hoy sigue teniendo
su carga en la ejecución de ayer, porque ayer estaba dentro: desaparece de la
siguiente, no de la anterior, y un informe viejo sigue enseñándolo, que es la
verdad de aquella foto.

No hace falta migración de datos para eso. Sale gratis de los principios.

### El filtro, en una constante

```sql
p.deleted_at IS NULL AND NOT p.is_template AND p.status = 'activo'
```

En un sitio y no repetido cinco veces, porque cinco copias de un predicado son
cinco sitios donde olvidarse de uno. Y es donde se lee la regla entera de una
vez: una plantilla es un molde y no se calcula; un proyecto en pausa o
archivado está declarado y tampoco.

### Un enlace que cruza a lo archivado **se dice**

Es la parte que importa, y la que casi se cuela.

La consulta de dependencias filtraba **sólo por el proyecto de la sucesora**.
Un enlace cuya predecesora vivía en una plantilla llegaba al motor apuntando a
un nodo que no existía, y el orden topológico se lo saltaba en silencio
(`graph.ts` descarta el enlace si falta un extremo). La sucesora se adelantaba
sola, sin nada que lo explicara.

Con las plantillas eso era raro, porque un molde no suele tener enlaces hacia
fuera. Con los proyectos archivados pasa de raro a corriente: se archiva el
proyecto terminado del que otro dependía. Medido en los datos de demostración:
la tarea que esperaba se adelantó **cinco meses y medio**, del 16 de septiembre
al 30 de marzo, y antes de esto no había ni una línea que lo dijera.

Así que los enlaces que no se pueden aplicar ya no se descartan al cargar: van
en la instantánea, en una lista aparte, y el motor los convierte en un hallazgo
`DEPENDENCY_OUT_OF_PLAN` **antes de calcular**, porque lo que viene después son
las fechas que salen sin ese enlace (P4).

El «por qué» viaja con el enlace y no se deduce en el motor: el planificador
sabe que le falta un nodo, no que el proyecto de enfrente está archivado. Eso lo
sabe quien cargó los datos, y sin ello la frase no se puede escribir.

La tarea que el hallazgo nombra es la que **sí** está en el plan, porque es la
que alguien va a mirar cuando sus fechas cambien.

### Un proyecto fuera del plan se marca, no desaparece

En la pantalla del plan, un proyecto sin tareas calculadas se ve como un
proyecto vacío. Lleva su etiqueta —`inactivo`, `archivado`— junto a la de
`plantilla`, por la misma razón que ésa existe: sin ella, nadie sabe por qué no
tiene fechas.

## Alternativas descartadas

**Un `is_active` booleano.** Pierde la diferencia entre pausa y final, que es lo
que se quiere saber al mirar la lista.

**Emitir el hallazgo dentro de `graph.ts`,** donde ocurre el descarte. Es un
ayudante topológico puro sin sumidero de hallazgos, y ahí no se sabe el motivo.
Meterlo obligaría a pasarle media instantánea a una función que sólo ordena.

**Filtrar del informe los proyectos que no están activos.** Haría que el informe
de una ejecución vieja mintiera sobre sí misma: esa ejecución **sí** incluía el
proyecto. Ver el coste aceptado.

## Coste aceptado

- **Un proyecto archivado sigue saliendo en el informe, con ceros.** El informe
  lista los proyectos de hoy, no los que cubrió la ejecución, así que uno sin
  datos en esa ejecución aparece a cero —lo mismo que ya le pasa a un proyecto
  vacío—. Arreglarlo de verdad pide que la ejecución registre qué proyectos
  cubrió, que el esquema no guarda todavía. Filtrar por el estado de hoy sería
  más rápido y sería mentir sobre el pasado.
- El aviso del enlace colgando sale **en cada cálculo** mientras el enlace
  exista. Es correcto —sigue sin aplicarse— y puede cansar. La salida es
  borrar el enlace, que es lo que corresponde si el proyecto no va a volver.
- **Dos frases castellanas iban con el UTF-8 leído como latin-1**, una de ellas
  ya mergeada en ADR-0023: `'estÃ¡'` donde debía decir `'está'`. Compila, pasa
  todas las reglas, y sólo se ve leyendo la pantalla en el idioma que nadie
  miró. Arregladas, y con una prueba que lo caza: `Ã` y `Â` no aparecen nunca en
  los cuatro idiomas, así que su presencia es siempre el síntoma.
- Quedan los **reales**, que sigue siendo el trozo grande de PlaTo.
