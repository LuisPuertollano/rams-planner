# ADR-0023 — Capacidad neta, compromiso y línea base de referencia

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1, P2, P4, P5

## Contexto

Estas tres cosas salen de leer **PlaTo**, la herramienta en Excel con la que se
planifica hoy el departamento: dos ficheros, trece hojas de datos y 480 KB de
VBA en cuarenta y seis módulos. No se copia su estructura —planifica en cubos
mensuales porque es Excel, y nuestro reparto diario es más riguroso— sino tres
datos que tiene y nosotros no, cada uno para una pregunta que la herramienta no
sabía contestar.

## Decisión

### 1. La capacidad se planifica en neto, y el bruto se guarda al lado

El calendario dice que alguien tiene ocho horas y el plan las repartía enteras.
De esas ocho, una parte no llega nunca a una tarea del plan —reuniones de
departamento, formación, revisar lo de otro, el correo— y otra parte hay que
guardarla para lo que todavía no se sabe: la baja de un día que nadie declaró
porque nadie la vio venir.

Planificar contra el bruto sobrecompromete de forma sistemática, y el hueco **no
se ve como sobrecarga**: se ve como retrasos, tres meses después.

La fórmula es la de PlaTo, con la cuenta hecha en enteros:

```
bruto = calendario ∩ disponibilidad ∩ ausencias
neto  = bruto × (1 − indirecto) × (1 − reserva)
```

**Dos factores y no uno**, porque son dos cosas distintas: `indirect_bp` es
trabajo que *pasa*, conocido y repetido, y lo sabe quien lleva al equipo;
`reserve_bp` es sitio que se *guarda* para lo que no ha pasado, y es una
decisión de riesgo, no una medida. En PlaTo son las columnas `Indirect` (4 %) y
`Sick` (3 %) de la hoja de plantilla, y también allí están separadas.

**Se multiplican, no se suman**, y el orden es parte del contrato: cada paso
redondea a minutos enteros (P5), así que `480 × 0,96 × 0,97 = 447` y
`480 × 0,89 = 427` son números distintos y hay que elegir uno. Se elige el que
compone, porque el segundo factor se aplica sobre lo que dejó el primero.

**Los factores van después de las ausencias.** Quien está de vacaciones tampoco
va a reuniones.

**El bruto se guarda en la ejecución**, en `resource_capacity_timephased`, y no
se recalcula al mirarlo. Es lo que hace que la resta se pueda enseñar (P4): sin
él, «7,4 h» es un número que nadie puede comprobar, y volver a calcularlo desde
el calendario de hoy daría otro resultado en cuanto alguien cambie un festivo.
Una ejecución se explica con lo que ella misma vio.

**Cero por defecto**, y no es pereza: es P2. Una migración que cambiase la
capacidad de todo el mundo dejaría todas las ejecuciones guardadas sin poder
reproducirse. Un recurso sin factores declarados ni pasa por la aritmética:
devuelve el bruto, byte a byte como antes de que esto existiera.

Lo que PlaTo tiene y aquí **no** hace falta es su tercer factor, los treinta
días de vacaciones repartidos a `30/12` por mes. Eso es lo que hace su modo
«plano» porque no tiene un calendario de ausencias; nosotros las declaramos una
a una y ya salen del bruto. Su modo «calendario» hace exactamente lo que hacemos
nosotros.

### 2. El compromiso del proyecto: tres niveles, no ocho

Sumar las horas de una oferta a las de un contrato firmado y llamar plan al
total es la forma más rápida de que el plan no sirva para decidir. Son la misma
unidad y no son la misma obligación.

`commitment` es `firme`, `probable` o `posible`, y el informe **reparte los
minutos del periodo entre los tres**. Mil horas de las que novecientas están
contratadas es un plan; mil de las que cuatrocientas son ofertas es una apuesta,
y el total es el mismo número.

PlaTo tiene ocho tipos —`FIRM`, `FORECAST`, `TENDER`, `EXTRA`, `R&D`,
`SUSTAINING`, `SIMULATION`, `IND`— y ahí está el error que no se copia:
**mezcla dos ejes**. `FIRM` y `TENDER` hablan de confianza; `R&D` y
`SUSTAINING`, de tipo de trabajo. Una lista que mezcla los dos ya no se puede
sumar, porque no se sabe si un proyecto de I+D está comprometido o no. Si además
hace falta distinguir el tipo de trabajo, es otro campo.

No cambia el motor: un proyecto `posible` se calcula igual y genera la misma
carga. Lo que cambia es que el informe puede decir de qué está hecho ese total.

### 3. La línea base de referencia es del proyecto

Congelar una línea base ya se podía. Lo que faltaba era decir **cuál** es la de
referencia de cada proyecto. Sin eso, «frente a la línea base» obliga a elegir a
mano cada vez, y dos personas comparan contra fotos distintas sin enterarse.

Es por proyecto, como el `Current_Baseline` de PlaTo, porque cada proyecto
congela en su propio momento —su revisión, su hito contractual— y la línea base
del de al lado no le dice nada.

## Alternativas descartadas

**Un solo factor de corrección** en vez de dos. Ahorra una columna y pierde la
pregunta: cuando el número no cuadra, hay que saber si sobra reserva o sobran
reuniones, y son dos conversaciones con dos personas distintas.

**Aplicar los factores al leer** en vez de al calcular. Dejaría la capacidad de
una ejecución dependiendo de lo que hoy diga la ficha del recurso, y entonces un
informe de hace dos años cambiaría de números al abrirlo. Rompe P2 y P4 a la vez.

**Un factor global de la instalación.** El tiempo indirecto de quien coordina no
es el de quien no coordina, y PlaTo lo tiene por persona con razón. Un valor
global se queda mal en los dos extremos.

**Copiar los ocho tipos de proyecto de PlaTo.** Ver arriba: mezclan confianza
con tipo de trabajo, y esa lista ya no se puede sumar.

## Coste aceptado

- **Nadie ve nada hasta que lo declara.** Es el precio de no tocar lo ya
  calculado, y se paga a gusto.
- El bruto en `resource_capacity_timephased` es **nulo en lo ya calculado**, y
  no se rellena. Es la tabla más grande de la base —una fila por persona y día
  de cada ejecución— y un `UPDATE` completo la bloquea entera: en la base de
  desarrollo de aquí, veintiséis millones de filas y **dos minutos y veintidós
  segundos** de bloqueo exclusivo para un cambio que debería ser sólo de
  metadatos. Se midió antes de decidir. Nulo además dice la verdad mejor que un
  número: esas ejecuciones no anotaron un bruto, y quien lee decide qué hacer
  con el hueco —lo que hacen los dos sitios que lo leen es tratarlo igual al
  neto, que es exactamente lo que vieron—.
- **El estado del proyecto (`activo` / `inactivo` / `archivado`) se queda
  fuera.** PlaTo lo tiene y hace falta, pero a diferencia de los tres de aquí
  **cambia el motor**: un proyecto archivado no debería generar carga, y eso es
  tocar la instantánea del planificador. Es su propio trabajo, con su propia
  decisión sobre qué pasa con lo ya calculado.
- Queda pendiente el trozo grande de PlaTo: los **reales**. El esquema ya tiene
  `actual_entry` desde el principio y no lo usa nadie, así que hay cimientos.
  La idea que merece copiarse de allí es la reacción a lo que no estaba
  planificado: cuando llegan horas a una persona y una cuenta que nadie
  planificó, PlaTo **crea la línea sola** con el entregable «Unplanned with
  Actuals». Setecientas nueve de sus tres mil doscientas filas son eso, es decir
  el plan enseñando dónde se está trabajando fuera de plan.
