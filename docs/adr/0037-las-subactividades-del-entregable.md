# ADR-0037 — Un entregable no es una tarea: es una cadena de subactividades

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P2, P5, P6

## Contexto

Hasta ahora un documento era una casilla de la matriz y, en un plan, una tarea.
Quien lo escribe y quien lo revisa eran la misma barra del cronograma y el mismo
montón de horas. El libro con el que el equipo planifica de verdad —hoja `Gantt`
de `Ressource Mgmnt - TrRAMS MHG.xlsm`, 4 910 filas, 36 proyectos— no lo cuenta
así. Cada documento aparece **varias veces**, una por subactividad:

```
Type  Description            Mission  Role      Work h   d.item
T     (S) Safety-Bid/BECO    C        S-Eng       50     (MSt) PROJECT Start
T     (S) Safety-Bid/BECO    R1       TL RAMS     10     (S) Safety-Bid/BECO - C
T     (S) Safety-CbC         C        S-Eng      100     (S) Safety-Bid/BECO - R1
```

Contado sobre las 1 686 subactividades vivas del libro:

| | C | R1 | R2 | R3 | S |
|---|---|---|---|---|---|
| Cuántas | 750 | 491 | 61 | 4 | 380 |
| Mediana de horas | 40 | 10 | 4 | 10 | 39 |
| Rol más frecuente | S-Eng | S-Eng | S-Eng | R-Eng | S-Eng |

Y tres cosas que se leen ahí y que la herramienta no sabía:

1. **La revisión es trabajo de otro, y va después.** 40 h de autor contra 10 h
   de revisor, cuatro a uno, repetido en todo el libro. Contarlas juntas como
   «50 h de alguien» es contar mal dos veces: el esfuerzo de cada persona y la
   duración del documento.
2. **El siguiente documento no espera al anterior entero: espera a su última
   revisión.** De las 299 dependencias entre documentos distintos, la forma
   dominante es exactamente `C ← R1`. Hacer esperar la creación del sucesor
   hasta el final del predecesor alarga el proyecto por un tramo que nadie ha
   pedido.
3. **El soporte no es un documento.** `S` aparece en 59 grupos propios —gestión
   de seguridad, formación, acompañamiento al ISA— con hasta 2 389 h y sin
   ninguna creación delante. No entrega nada y no bloquea a nadie.

## Decisión

**El catálogo declara, por entregable, sus subactividades: crear, revisar en
tres niveles y soportar. Por rol y con sus minutos.**

`document_activity (document_type_id, step, position, role, standard_minutes,
signature_step, signature_position)`, con `step` en
`create · review_1 · review_2 · review_3 · support`.

### Niveles, no rondas

`review_1/2/3` no son vueltas de revisión. En el libro hay **57 entregables con
C + R2 y sin R1** —los que escribe otro departamento (VEH, SYS, CCON, VAL) y
donde RAMS sólo revisa en segundo nivel— y hay **C + R3 sin R2**. Un contador de
rondas no puede saltarse el 1; un nivel sí.

De ahí sale lo que el motor **no** comprueba, y conviene dejarlo escrito porque
las tres reglas parecen obvias:

- *«Una revisión sin creación está mal.»* No: es la mitad del trabajo de un
  equipo de seguridad.
- *«Los niveles no pueden saltarse.»* Tampoco.
- *«Quien revisa no puede tener el rol de quien escribe.»* Es la regla de
  independencia de ADR-0032, y allí está bien. Aquí no: la mayoría de los
  entregables del libro tienen `C: S-Eng` y `R1: S-Eng`, porque un rol lo
  ocupan varias personas. Avisar aquí sería avisar de casi todo, que es la
  forma segura de que dejen de leerse los avisos.

### La cadena es implícita

No se declara ninguna arista. Se encadenan **los niveles declarados** en orden,
saltándose los huecos, y dentro de un mismo nivel las subactividades van en
paralelo: dos revisores del nivel 1 revisan a la vez. El soporte no encadena con
nadie.

Es lo que hace el libro, y una cadena que no se teclea es una cadena que no se
puede teclear mal.

### La puerta que cierra, expuesta desde hoy

`lastGate` devuelve la revisión de nivel más alto declarada, o la creación si no
hay ninguna. El catálogo ya la manda —`activityEffort.gateStep`— y la pantalla
ya la enseña, **antes de que ningún plan la use**. Es la decisión de la
observación 2, puesta a la vista para poder discutirla antes de que mueva una
fecha.

### El puente con el ciclo de firma

ADR-0032 dejó escrito que los minutos de una firma «no entran en la carga de
nadie». Una subactividad puede decir **qué firma descarga**. Cuando la revisión
de nivel 1 *es* la verificación que firma el verificador, se dice, y esos
minutos dejan de estar sueltos.

Nulo a propósito y en la mayoría de los casos: RAMS revisando el documento de
otro departamento no firma nada nuestro.

Y de ahí sale la comprobación que de verdad importa —**una firma que cuesta
minutos y que ninguna subactividad hace**—, junto con otras tres:

| código | qué caza |
|---|---|
| `ACTIVITY_SIGNATURE_ORPHAN` | la firma cuesta minutos y nadie la hace |
| `ACTIVITY_SIGNATURE_TWICE` | dos subactividades descargan la misma firma |
| `ACTIVITY_SUPPORT_SIGNS` | el soporte acompaña, no firma |
| `ACTIVITY_ON_CONTAINER` | subactividades en una fase o en un hito |

### Dos tablas y no una

`document_signature` y `document_activity` dicen las dos «rol + minutos por
entregable», y aun así son cosas distintas:

- **La firma es el sello.** Quién tiene que firmar para que el entregable valga,
  que es de lo que habla la independencia de EN 50126. No tiene duración ni
  predecesora: es una propiedad del documento terminado.
- **La subactividad es el trabajo.** Un trozo planificable con esfuerzo, rol,
  fechas y cadena.

Se solapan —quien escribe suele firmar como autor— y por eso hay un puente, no
una fusión. Fusionarlas obligaría a decidir qué es «R2 revisando el documento de
otro departamento»: no es autor, ni verificador, ni aprobador de nada nuestro, y
sin embargo son 4 h de alguien.

## Lo que esto **no** hace

**No parte ninguna tarea, no mueve ninguna fecha y no cambia ni una cifra.** Es
el catálogo. Aplicarlo a un proyecto concreto —expandir la tarea en su cadena,
atar `A.última revisión → B.creación`— es el paso siguiente y va aparte: una
migración que además cambiara los números de todas las pantallas serían dos
decisiones metidas en una, y la segunda no se podría revisar.

## Alternativas descartadas

**Un reparto de porcentajes dentro de la tarea** («70 % autor, 30 % revisor»).
Más barato y no sirve para lo que hace falta: no da dos fechas, no da dos
personas y no permite que el sucesor empiece cuando termina la revisión. El
grano que pide el libro es el de la fila, no el de la fracción.

**Declarar las aristas de la cadena una a una.** Más general, y en el libro no
hay ni una sola excepción al orden `C → R1 → R2 → R3`. Una tabla de aristas que
siempre contiene lo mismo es una tabla que algún día contendrá algo distinto por
error.

**Meter `Canc.` como sexto paso.** Es el 60 % de las filas del libro y no es un
papel: es un hecho de un proyecto —esta subactividad no se va a hacer— y el
catálogo describe cómo trabaja el equipo, no lo que pasó en un proyecto.

**Fusionar firma y subactividad.** Arriba.

## Consecuencias

La pantalla de documentos gana una columna y la ficha una sección. Los datos de
demostración traen los tres casos que importan, incluido un aprobador cuyos 45
minutos no hace nadie, para que el aviso se vea funcionando.

Una avería encontrada al escribir esto y que conviene recordar: `ON DELETE SET
NULL` sobre una clave foránea compuesta anula **todas** sus columnas, y una de
ellas era `document_type_id`. Quitar una firma del ciclo reventaba la
transacción entera en vez de desenganchar la subactividad. Lo arregla la lista
de columnas de PostgreSQL 15+, y hay una prueba de integración por cada mitad de
la frase.

Queda apuntado lo que este ADR no resuelve: `position` admite dos roles en el
mismo nivel y la pantalla sólo edita el primero. La base ya lo aguanta; el día
que haga falta, lo que cambia es la pantalla.
