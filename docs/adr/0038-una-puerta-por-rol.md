# ADR-0038 — Una puerta por rol, y la pantalla que no veía nadie

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P6

## Contexto

El manual de uso tiene 616 líneas y cuenta la herramienta entera, pantalla por
pantalla. Está bien escrito y es el sitio equivocado por donde empezar: quien
sólo consulta la carga no necesita saber cómo se importa un parte de horas, y
quien administra no necesita la mitad de lo que hay antes de llegar a lo suyo.
La herramienta tiene cuatro roles —lectura, planificación, responsable,
superadministración— y ninguna documentación que respete esa división.

Y al escribir esa división apareció lo que este ADR existe sobre todo para
registrar.

### La pantalla que no veía nadie

`documentos.ver`, `documentos.gestionar` y `documentos.asignar` existen como
permisos desde que nació el catálogo, y **no estaban en ninguno de los tres
roles de arranque**:

```
rol           permisos   de documentos
lectura            9          0
planificador      27          0
responsable       29          0
```

Sólo el superadmin llegaba a esa pantalla, y lo hacía porque lo tiene todo por
definición, no porque nadie se lo hubiera dado. Detrás de esa puerta cerrada
estaban el catálogo de entregables entero, la matriz de precedencias
(ADR-0027), el ciclo de firma por rol (ADR-0032) y las subactividades
(ADR-0037): **tres migraciones de trabajo invisibles en una instalación nueva**.

Por qué no saltó en tres rondas: las pruebas de permisos comprueban que un
permiso que falta se deniega. Ninguna comprobaba que un permiso que existe lo
tenga alguien, y esa es exactamente la forma que tiene una pantalla de volverse
invisible sin romper nada.

## Decisión

**Una página de entrada por rol**, `docs/uso-por-rol.md`, que dice qué hace cada
uno y por dónde empieza, y que devuelve al manual cuando una pantalla concreta
deja una duda. El manual no se parte: sigue siendo la referencia completa, y
ahora tiene quien lo abra por el sitio correcto.

**Y los tres roles sembrados reciben los permisos de documentos**, con el
reparto que el resto de la hoja ya usa:

| | lectura | planificación | responsable |
|---|:---:|:---:|:---:|
| `documentos.ver` | ✓ | ✓ | ✓ |
| `documentos.gestionar` | | ✓ | ✓ |
| `documentos.asignar` | | ✓ | ✓ |

Declarar qué entrega cada tarea es planificar, no administrar; y ver el catálogo
es como ver el plan.

**Sólo a los tres roles sembrados, y sólo si no lo tienen ya.** Un rol que
alguien haya creado o recortado a mano es suyo, y esta migración no opina sobre
él.

**Y una prueba que mira al revés.** `roles.integration.test.ts` no comprueba que
un permiso que falta se deniegue —eso ya está cubierto— sino que los roles
sembrados llegan a donde tienen que llegar. Sin la migración falla en dos de sus
seis pruebas, con el nombre del permiso que falta.

## Alternativas descartadas

**Dejarlo a quien administre.** Es defendible —la hoja de permisos existe para
eso— y es lo que ya estaba pasando: nadie lo tocó porque nadie sabía que hiciera
falta. Un permiso que hay que descubrir para poder usar la funcionalidad que
paga no es configuración, es un fallo con una explicación.

**Dárselo también al rol de lectura para gestionar.** El catálogo describe cómo
trabaja el equipo y quien sólo consulta no lo cambia, igual que no cambia el
plan.

**Partir el manual en cuatro documentos, uno por rol.** Cuatro copias del mismo
párrafo sobre la pestaña Carga es la forma segura de que tres se queden
anticuadas. La página por rol enlaza; no copia.

**Una página también para el superadmin dentro de `operacion.md`.** Ahí está lo
de levantar y copiar, que es otra cosa: la superadministración reparte acceso,
no administra el servidor. Las dos páginas se enlazan y cada una dice lo suyo.

## Consecuencias

Una instalación nueva enseña el catálogo de documentos a quien tiene que verlo,
que es el efecto que las tres migraciones anteriores daban por hecho.

Y queda escrita la clase de fallo, porque volverá: **un permiso nuevo que no se
mete en ningún rol es una funcionalidad que no existe.** La prueba lo caza para
los permisos de documentos; no lo caza en general, y hacerlo —una regla que exija
que todo permiso esté en algún rol— chocaría con `usuarios.gestionar` y
`roles.gestionar`, que están fuera a propósito. El sitio donde se caza de verdad
es aquí, en la lista de comprobación de cualquier ADR que añada un permiso.
