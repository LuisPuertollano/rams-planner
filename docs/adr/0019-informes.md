# ADR-0019 — Informes: un resumen que se pueda pegar en un correo

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P1, P2, P3, P4

## Contexto

La herramienta contesta bien preguntas concretas —¿quién se pasa en mayo?, ¿qué
tarea mueve esta fecha?— pero no contestaba la que se hace una vez al mes: **¿en
qué estamos?** Para eso había que abrir cinco pestañas, apuntar cifras a mano y
escribirlas en un correo, que es exactamente la tarea que la herramienta existe
para quitar.

Y hay una segunda pregunta detrás: *¿en qué estamos **en este periodo**?* La
carga y el plan se ven enteros; un informe de cierre de trimestre no.

## Decisión

Un paquete del núcleo, `@planner/report`, con una función pura `buildReport`, y
una sola ruta de lectura, `GET /api/report`.

### El resumen no trae frases hechas

`buildReport` devuelve el TLDR como una lista de puntos **sin texto**: un
`kind`, sus cifras en su unidad de siempre (minutos, puntos básicos, céntimos) y
las etiquetas que las acompañan. La frase la construye quien la enseña.

Es lo que permite que el resumen esté en los cuatro idiomas sin tocar el
servidor, y lo que evita el problema que ADR-0017 dejó abierto: un servidor que
devuelve prosa no se puede traducir. Los ocho puntos posibles están en el
diccionario, con `%s`, como cualquier otro texto de la interfaz.

### El informe no calcula: resume una ejecución

Se sirve de un `calculation_run` concreto y lo devuelve con la respuesta (P3).
No recalcula al abrirlo. Dos personas que miran el mismo informe están mirando
los mismos números, y un informe archivado se puede reproducir: mismo `runId` y
mismo periodo, mismo informe byte a byte (P2).

### El periodo por defecto es todo lo que hay

Ni «este trimestre» ni «los próximos seis meses»: el primer y el último día con
trabajo de la ejecución. Cualquier otro valor por defecto sería una opinión
metida de contrabando en un número que después alguien cita. Los atajos están en
la interfaz, donde elegirlos es un acto consciente.

### La capacidad es la de quien trabaja en esos proyectos

La decisión menos obvia y la que más cambia lo que se lee. Con la capacidad del
equipo entero, un informe de un solo proyecto dice «el 1 % de la capacidad»:
cierto, e inútil. Con la de las personas que trabajan en él, dice qué parte de
su tiempo se lleva, que es la pregunta.

No es la verdad completa —esas personas también trabajan en otros sitios— y por
eso la sección **Por persona** enseña la saturación total de cada una y su peor
mes. El aviso va escrito debajo de la cifra, no en una nota al pie.

### El avance se pondera por trabajo, no por tareas

Diez fichas de una hora terminadas y una de mil horas sin empezar no son un
91 % de avance. Son un 1 %. Contar tareas es la forma más rápida de escribir un
informe que miente sin que nadie mienta.

### La saturación de una persona es la de su peor mes

Un 200 % en mayo y un 20 % en junio dan un 110 % de media que no le pasa a nadie
en ningún momento. El informe enseña las dos cosas y el resumen cita la peor,
con el mes y el nombre.

### Lo que no se puede ver no llega, y se dice

Sin `costes.ver` los importes salen del servidor a cero y la respuesta trae
`costsHidden`. Sin `carga.ver` no viaja el reparto por persona y trae
`peopleHidden`. En los dos casos la interfaz lo dice con todas las letras: «no
es que cuesten cero», «no es que nadie vaya pasado». Un cero sin explicación es
peor que un hueco, porque se cita.

Los proyectos se recortan a los visibles **antes** de mirar los que se han
pedido: al revés, pedir un proyecto ajeno confirmaría que existe.

### `informes.ver` es un permiso nuevo, con pantalla propia

Podría haberse colgado de `plan.ver`. Se separa porque un informe es lo que sale
de la herramienta hacia fuera —a un correo, a un comité, a un cliente— y quién
puede sacarlo es una decisión distinta de quién puede mirar el plan por dentro.
Una migración se lo concede a los tres roles de arranque, que ya podían ver el
plan; a los roles que haya creado el equipo, la hoja de permisos.

## Alternativas descartadas

**Generar un PDF en el servidor.** Añade una dependencia pesada, una plantilla
que mantener y un formato que nadie puede editar. La página se imprime con
`@media print` y el resumen se copia al portapapeles en dos líneas de código.

**Un informe programado que llegue por correo.** Hace falta un servidor de
correo, una cola y decidir a quién. Antes de automatizar el envío conviene que
alguien lea unos cuantos a mano y diga qué falta.

**Guardar los informes generados.** No hace falta: el `runId` y el periodo los
reproducen. Guardar el resultado sería duplicar un dato derivado, que es justo
lo que P1 separa.

**Que el cliente mande la fecha de hoy.** «Lo que debería estar terminado»
dependería del reloj del navegador. La pone el servidor.

## Coste aceptado

- El informe lee la ejecución entera y filtra en memoria lo que no es carga.
  Con un plan de verdad son unos cientos de filas; si algún día no lo fueran,
  el sitio donde arreglarlo es la consulta, no la función pura.
- Las cabeceras de las tablas de detalle siguen en castellano en los cuatro
  idiomas, como el resto de las tablas de la herramienta. El resumen —que es lo
  que se copia y se cita— sí está traducido entero. Queda pendiente lo mismo
  que dejó pendiente ADR-0017.
- Los tres primeros puntos del resumen salen siempre, incluso cuando no hay nada
  que contar. Un informe vacío que dice «0 proyectos» es más útil que uno en
  blanco, aunque ocupe tres líneas para no decir nada.
