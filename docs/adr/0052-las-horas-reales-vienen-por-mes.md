# ADR-0052 — Las horas reales vienen por mes, y hay que conciliarlas

**Estado:** aceptada · **Fecha:** 2026-09-22 · **Principios:** P1, P2, P5

## Contexto

La comparativa C1 dejaba esta fila en ámbar:

> **Horas reales** · libro 🟢 de SAP CATS, repartidas, trazadas y conciliadas
> (12 587 filas) · planner 🟡 *se importan por CSV y van al informe; el reparto
> y la conciliación no existen*

El ámbar se quedaba corto. `actual_entry` tiene la clave (tarea, persona, día,
origen), y eso **supone un dato que el sistema de fichaje no tiene**: contra qué
tarea se trabajó. SAP CATS —y cualquier otro— sabe «Ana imputó 38,5 h al
proyecto CBTC en abril» y ahí se acaba. La tarea no está y no se puede adivinar.

Así que el importador de horas del planner sólo servía si alguien rellenaba la
columna `tarea` a mano, fila a fila, para las 12 587 filas del export. Es decir:
no servía.

El libro del equipo resolvió esto hace años y con tres piezas:

| | qué es |
|---|---|
| `CATS export` | lo que dice el sistema: persona, proyecto, mes, horas |
| `Actuals_Declaration` | lo que declara la persona: «de mis horas de abril en CBTC, el 60 % fue al FMECA» |
| `Declaration_CHECK` | la matriz persona × mes que dice si eso cuadra |

## Decisión

Las dos primeras entran como tablas —son dato declarado (P1)— y la tercera se
calcula, porque es derivada.

```
actual_month  (persona, proyecto, mes) -> minutos
actual_split  (persona, proyecto, mes, tarea) -> puntos básicos
```

Las horas por tarea salen de multiplicar una por la otra, con
`distributeInteger` para que la suma de las partes sea exactamente el total
aunque no divida (P5).

### El invariante: ningún minuto se pierde por el camino

Es de lo que va toda la funcionalidad, y está comprobado con `fast-check` sobre
cuatrocientos juegos de datos:

```
minutosQueEntran === minutosRepartidos + minutosEnUnDescuadre
```

Cada minuto que entra **o cae en una tarea o sale nombrado en un descuadre**.
No hay una tercera opción, y por eso el informe no puede enseñar menos gasto del
real sin que la conciliación lo diga.

### Un reparto que no suma 100 % no se aplica a medias

Es la decisión que más se nota, y el motivo no es el que parece.

La primera versión de esta ADR decía que aplicarlo «pondría el 60 % de las horas
en las tareas y perdería el otro 40 % en silencio». Es falso, y lo demostró un
experimento: `distributeInteger` reparte el total **en proporción** a los pesos,
así que una declaración que sólo cubre el 60 % no dejaría nada fuera — le daría
a esa tarea **las horas enteras del mes**.

O sea que el fallo no sería perder horas: sería **imputarle al FMECA las horas
que se fueron a algo que nadie declaró**. Peor, porque un total que cuadra no
levanta ninguna sospecha.

El mes se queda fuera entero y se dice cuánto falta y cuánto hay declarado. Y
hay una prueba que fija ese comportamiento de `distributeInteger`, para que el
día que cambie haya que volver a justificar esta regla en vez de descubrirlo en
un informe.

### Los cuatro descuadres son cuatro, porque tienen cuatro arreglos

| motivo | cuándo | cómo se arregla |
|---|---|---|
| `sin-declarar` | hay horas y nadie ha dicho en qué se fueron | esa persona declara su mes |
| `no-suma-cien` | la declaración no llega o se pasa del 100 % | corregir los porcentajes |
| `sin-horas` | se declara un mes que nadie fichó | casi siempre el mes o el proyecto equivocado |
| `dos-caminos` | ese mes tiene horas por las **dos** vías | quedarse con una |

El último es el que no se ve venir. Un proyecto puede tener parte diario por
tarea y otro el export mensual, y los dos son legítimos; lo que no vale es
sumarlos para el mismo mes del mismo proyecto, porque contaría el trabajo dos
veces. El reparto recibe las claves que ya tienen parte diario y las deja fuera
con su motivo — así las dos listas son **disjuntas por construcción** y no hay
que confiar en que nadie se equivoque.

### La matriz, y por qué no una lista

`Declaration_CHECK` es una matriz persona × mes y aquí también, por lo mismo que
el mapa de calor: treinta personas por doce meses son trescientas sesenta
casillas, y lo que hace falta ver de un vistazo es **en qué mes de quién** hay
que entrar. Una lista de trescientos sesenta renglones ordenada por nada que le
importe a nadie no se lee.

Cada casilla enseña el peor motivo que tenga; el detalle, con el proyecto y el
arreglo, sale al pincharla.

## Consecuencias

- `readAllActualsInPeriod` es lo que el informe mira: la unión del parte diario
  y del reparto mensual. Existe con nombre propio para que ninguna pantalla se
  quede mirando sólo una de las dos vías.
- Dos importaciones nuevas (`monthly` y `splits`) y no una con dos formas: las
  escribe gente distinta en momentos distintos, y juntarlas obligaría a que una
  esperase a la otra.
- La declaración se **reemplaza** entera por mes, no se suma. Un 60/40 que pasa
  a ser 100 % en una tarea tiene que perder la fila del 40 %, o la suma daría
  140 % y el mes se quedaría sin repartir sin que nadie hubiera tocado ese mes.
- Una fila de `actual_month` **es el total del mes**, no un apunte: volver a
  cargar marzo deja marzo como diga el fichero, no el doble. Es lo contrario que
  `actual_entry`, donde dos apuntes del mismo día se suman porque son dos ratos
  de trabajo.
- Los datos de demostración traen un descuadre de cada clase. Una pantalla de
  conciliación vacía no enseña nada, y lo que hay que entender de ella es
  justamente lo que pasa cuando algo **no** cuadra — que es la situación normal
  el día que alguien conecta su export.

### Lo que NO se hace

- **No se reparte el mes en días.** El dato llega por mes y repartirlo entre los
  días laborables inventaría un detalle que nadie declaró. El reparto se queda a
  la granularidad que entró, que es la regla que ya tenía `actual_entry`
  escrita: «agregar se puede después; inventar el detalle que no vino, no».
- **No se toca SAP.** Lo que el libro tiene de integración no porta: aquí entra
  un CSV, que es lo que cualquiera puede exportar de cualquier sistema.
- **No hay un permiso nuevo.** La conciliación usa `reales.ver`, porque enseña
  el mismo dato que el informe visto de otra manera. Un permiso aparte dejaría
  que alguien sin ver las horas dedujera cuántas son mirando los descuadres.
