# Manual de uso

Para quien planifica, no para quien programa. Aquí no hay nada de arquitectura:
sólo qué hacer, en qué orden, y cómo leer lo que sale.

Si eres nuevo, **empieza por [`uso-por-rol.md`](uso-por-rol.md)**: dice qué hace
tu rol y por dónde empezar, en cuarenta líneas, y te trae aquí sólo cuando una
pantalla concreta te deje una duda.

Si lo que buscas es levantar la herramienta, hacer copias de seguridad o
actualizarla, eso está en [`operacion.md`](operacion.md).

---

## 1. Las dos preguntas

La herramienta existe para contestar dos preguntas, y todo lo demás está a su
servicio:

> **¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto —
> y cuánta capacidad le queda?**

> **Si acepto este proyecto nuevo, ¿quién se satura, cuándo y cuánto?**

La primera se contesta en la pestaña **Carga**. La segunda, cargando el proyecto
nuevo y comparando contra una línea base en la pestaña **Comparar**.

---

## 1.bis Entrar

Lo primero es una pantalla de entrada con correo y contraseña. La cuenta te la
da quien administre la herramienta; no hay registro y no hay recuperación por
correo, a propósito: esto se despliega en la red del equipo, no en internet.

Si te han dado una contraseña generada, **cámbiala nada más entrar**: el botón
**Contraseña**, arriba a la derecha junto a tu nombre. No hace falta permiso
para eso y nadie te lo puede quitar. Al cambiarla se cierran todas tus sesiones
y vuelves a entrar con la nueva, que es lo que tiene sentido si la vieja la
conocía alguien más.

**El idioma.** El selector de la barra de arriba cambia la herramienta a
castellano, inglés, alemán o francés, y se recuerda. Si es la primera vez,
arranca en el idioma de tu navegador. De momento están traducidos el armazón
—entrada, pestañas, botones, tarjetas— y **todas las fechas y números**; el
interior de las tablas y los mensajes del motor siguen en castellano.

**Verás sólo lo que tu rol te deja ver.** Las pestañas y los botones que no
puedes usar no aparecen, así que si un compañero tiene una pestaña que tú no
tienes, no es un fallo: es el reparto de permisos. Quien administre la
herramienta puede cambiarlo en un minuto.

Si acabas de instalarla y todavía no hay ninguna cuenta, no pide entrar y sale
un banner rojo avisando de que está abierta. Se cierra creando la primera:
`crear-superadmin`, en [`operacion.md`](operacion.md#7-usuarios-roles-y-permisos).

---

## 2. Empezar desde cero

En una base de datos recién creada el orden es este. Saltarse el paso 1 es la
causa más frecuente de que los costes salgan a cero.

### Paso 1 — El equipo

Pestaña **Equipo**. Por cada persona:

| Campo | Qué es | Si lo dejas en blanco |
|-------|--------|-----------------------|
| **Calendario** | De aquí salen los días y las horas laborables de esa persona: festivos incluidos | Se usa el calendario del proyecto |
| **Dedicación base** | El porcentaje de su jornada que dedica a proyectos, por defecto | 100 % |
| **Disponibilidad** | Tramos con fecha: una excedencia, una media jornada, un refuerzo temporal. Pisan a la dedicación base mientras duran | Se usa la dedicación base |
| **Ausencias** | Vacaciones, bajas, formación. Restan capacidad sin tocar el calendario del equipo | Nada resta |
| **Tarifas** | Coste por hora, con vigencia | **El coste de todas sus tareas sale a cero** |

Los calendarios base vienen ya cargados con los festivos de Baden-Württemberg
hasta 2035: `base_de` (jornada estándar), `base_bw` (con los festivos del land) y
`base_bw_35h` (semana de 35 horas). Un calendario hereda del que tiene encima:
cambiar un festivo en `base_de` lo cambia en los tres.

Las personas sin tarifa llevan un **⚠** en la lista. Es la única señal que vas a
tener de que sus horas no cuestan nada.

### Paso 2 — El plan

Hay dos caminos, y se pueden mezclar: **importar un CSV** para cargar de golpe
lo que ya tienes en Excel, o **construirlo a mano** en la pestaña Plan. Lo
normal es importar el grueso y retocar a mano lo que cambia cada semana.

#### Importar

Botón **Importar CSV** de la cabecera. El formato está en el
[README](../README.md#cargar-tus-propios-datos) y la plantilla se descarga desde
la propia herramienta.

Lo importante de la importación:

- Es **todo o nada**. Una fila ilegible aborta el fichero entero y te dice qué
  fila y por qué. No existen las importaciones a medias.
- Un proyecto cuyo código ya exista **no se sobrescribe**: se rechaza la
  importación nombrando el conflicto. Si quieres reemplazarlo, cambia el código
  o borra el proyecto anterior.
- Las personas que no existan **se crean solas**, con jornada estándar y **sin
  tarifa**. La respuesta te dice cuáles. Vuelve a la pestaña Equipo y complétalas.

#### A partir de una plantilla

Es lo que de verdad se usa cuando los proyectos se parecen entre sí, que en
RAMS es casi siempre.

En la pestaña **Plan**, junto a **+ Proyecto**, hay un botón por cada plantilla:
**+ Desde «PLANTILLA-RAMS»**. Pide nombre, código y fecha de arranque, y crea un
proyecto entero con el árbol, las duraciones, las dependencias y las disciplinas
del molde.

La herramienta trae de serie **PLANTILLA-RAMS**, con el ciclo de vida de la
EN 50126 en seis fases —planificación, análisis preliminar, riesgos y
requisitos, análisis RAM, verificación y caso de seguridad— con sus hitos y sus
24 dependencias encadenadas. Es un punto de partida, no un dogma: edítala como
cualquier otro proyecto hasta que se parezca a cómo trabajas.

Tres cosas que conviene saber:

- **Una plantilla no lleva gente.** Describe el trabajo, no quién lo hace. La
  base de datos lo impide, no es una convención. El equipo de cada proyecto se
  decide mirando quién tiene hueco, que es justo lo que la pestaña **Carga**
  contesta.
- **Una plantilla no se calcula.** No tiene fechas ni genera carga ni aparece en
  la matriz. Sólo es un molde.
- **Las fechas absolutas se desplazan.** Si el molde tiene una restricción o una
  fecha objetivo, se mueven los mismos días naturales que separan las dos fechas
  de arranque. El resultado te dice cuántas se han movido.

Para hacerte tus propias plantillas, en el panel **✎** de cualquier proyecto:

| Botón | Qué hace |
|-------|----------|
| **Guardar como plantilla** | Copia este proyecto en un molde nuevo, sin la gente ni el avance |
| **Duplicar el proyecto** | Copia este proyecto en otro proyecto, con otra fecha de arranque |
| **Convertir en plantilla** | Convierte este mismo proyecto en molde; deja de calcularse |

Lo normal es planificar un proyecto de verdad, verlo funcionar, y cuando
funcione, **guardarlo como plantilla** para el siguiente.

#### A mano

En la pestaña **Plan**:

1. **+ Proyecto** (arriba del todo) pide nombre y código.
2. **+ Fase**, en la fila de cada proyecto, cuelga una fase de él.
3. El botón **✎** de cualquier fila abre el panel de edición. Lo que ofrece
   depende de lo que sea la fila:
   - En un **proyecto**: nombre, código, **fecha de referencia** y prioridad.
   - En una **fase**: colgar de ella una tarea, un hito u otra fase.
   - En una **tarea o un hito**: quién trabaja en ella y con qué dedicación, de
     qué depende, y quitarla del plan.
4. La duración y el avance se escriben directamente en la tabla, en las columnas
   marcadas con **✎**.

La **fecha de referencia** de un proyecto es la que ancla todas las tareas que
no tienen ni predecesora ni restricción. Un proyecto nuevo arranca hoy; cámbiala
en el panel del proyecto y se mueve entero. La **prioridad** sólo sirve para
desempatar en la nivelación —cuando dos tareas se pelean por la misma persona el
mismo día, cede la del número más alto— y por defecto todos los proyectos
empatan en 500.

El árbol tiene una regla que no se puede saltar: **el trabajo cuelga de fases,
no de otras tareas**. Si intentas colgar algo de una tarea, la herramienta lo
rechaza y te dice por qué. Es lo que mantiene el plan legible cuando crece.

Quitar algo del plan da de baja también todo lo que cuelgue de ello. No se borra
nada: los cálculos ya hechos se siguen explicando igual.

### Paso 3 — Mirar

Ya hay un plan calculado. Sigue leyendo.

---

## 3. Las pestañas, una por una

### Carga

La matriz: **persona × mes × proyecto**. Cada celda son horas comprometidas.
Debajo de cada persona va su capacidad del mes y su saturación.

Es la respuesta literal a la primera pregunta. Si sólo vas a mirar una pantalla
al mes, que sea esta.

**Horas o euros.** El interruptor de arriba cambia la unidad de toda la matriz:
las mismas celdas, multiplicadas por la tarifa vigente de cada día. En euros
desaparece la fila de capacidad, porque la capacidad de una persona se mide en
tiempo y poner horas en una tabla de importes sólo confunde.

Si el coste sale a cero no es que el trabajo sea gratis: es que a esa gente le
faltan tarifas en **Equipo**. Y si el interruptor de euros está apagado, es que
tu rol no incluye ver costes.

### Saturación

La misma información, pero en color y sin proyectos: sólo **quién se pasa,
cuándo y por cuánto**. La escala está centrada en el 100 %:

| Color | Qué significa |
|-------|---------------|
| Gris | Sin trabajo asignado |
| Azul | Por debajo del 60 % — hay hueco |
| Verde | Entre el 60 % y el 95 % — sano |
| Amarillo | Alrededor del 100 % — al límite |
| Naranja | Hasta el 130 % — sobrecarga que se puede absorber con esfuerzo |
| Rojo | Por encima del 130 % — no va a pasar |

Un mes rojo no es un error de la herramienta: es un compromiso que alguien
adquirió y que no cabe.

### Plan

El árbol de trabajo con las fechas calculadas.

- Las columnas con **✎** son declaradas: las escribes tú y se editan en línea.
- Las columnas con **🔒** son derivadas: las calcula el motor y no se tocan. Si
  una fecha no te gusta, se cambia lo que la produce, no la fecha.
- El botón **¿por qué?** de cada tarea abre la traza completa: qué regla produjo
  cada fecha, con qué entradas, hasta el dato que alguien escribió.
- El botón **✎** de cada fila abre el panel de edición: nombre, equipo,
  dependencias y baja. Ahí no hay ni una sola fecha, a propósito: las fechas se
  calculan, no se escriben.

En rojo, las tareas del **camino crítico**: las que no tienen holgura. Retrasar
una de ellas retrasa el proyecto entero. El camino crítico se calcula **por
proyecto**, no para toda la cartera: cada proyecto tiene el suyo.

### Cronograma

El plan en el tiempo. Barras, hitos en rombo, camino crítico en rojo. Sirve para
enseñárselo a alguien; para trabajar, la pestaña Plan tiene más información.

### Equipo

De qué está hecha la capacidad. Ver el paso 1.

**Todo lo de esta pestaña recalcula el plan al guardarlo.** Es intencionado: una
capacidad que cambia sin que cambie la carga sería una pantalla mintiendo.

### Calendario

Quién está fuera, cuándo, y qué capacidad le queda al equipo cada día. Personas
en las filas, días del mes en las columnas.

| Color | Qué es |
|-------|--------|
| Naranja | Ausencia declarada: vacaciones, baja, formación |
| Gris | No laborable: fin de semana o festivo del calendario de esa persona |
| Verde | Disponible |

La columna **Horas** de la derecha es la capacidad real de cada persona ese mes,
y la fila **Capacidad del equipo** es la suma por día y del mes entero. Ya
llevan descontadas las ausencias y los festivos: **no es una estimación**, es la
capacidad exacta que el motor ha usado para repartir el trabajo.

Para qué sirve mirarla: un agosto en el que coinciden cuatro personas no se
detecta abriendo siete fichas individuales. Aquí se ve de un vistazo, y el
número de horas del mes te dice cuánto trabajo cabe de verdad antes de
comprometerlo.

Las ausencias se declaran en la pestaña **Equipo**, en la ficha de cada persona.

### Competencias

La hoja del equipo: **personas en las filas, competencias en las columnas**. Es
una matriz porque las preguntas que contesta son de matriz — «¿quién puede hacer
esto?» se lee por columnas y «¿qué sabe hacer esta persona?» por filas.

La escala tiene cinco niveles y cada uno significa algo concreto:

| Nivel | Qué quiere decir |
|-------|------------------|
| **1** | En formación: necesita que le enseñen |
| **2** | Con apoyo: puede hacerlo si alguien revisa |
| **3** | Autónomo: lo saca adelante solo |
| **4** | Referencia: los demás le preguntan |
| **5** | Experto reconocido: defiende el trabajo fuera |

La última fila, **Autónomos o más**, cuenta cuánta gente de nivel 3 o superior
hay en cada competencia. Es la fila que hay que mirar:

- **0** en rojo: hoy el equipo no cubre eso.
- **1** en amarillo: un único especialista. Si se va de vacaciones o del equipo,
  ese trabajo se para. Es el riesgo que nadie apunta hasta que ocurre.

Lo que una tarea **exige** se declara en su panel **✎**, sección «Competencias
que pide». Cuando alguien está en una tarea sin la competencia, sale un aviso en
**Hallazgos**; si la tiene por debajo del nivel pedido, sale como información,
porque formar a alguien es una decisión legítima y no un error.

La herramienta **no impide** asignar a quien no sabe. Quién es capaz de qué lo
decides tú; lo único que hace la herramienta es que no se te pase.

### Documentos

La **matriz de precedencias entre entregables**: una cruz dice que el documento
de la **fila** es condición necesaria del de la **columna**. El Hazard Log antes
que el FMECA, el FMECA antes que el Safety Case.

Se declara **una vez** y vale para todos los proyectos. Ese orden no cambia de
proyecto a proyecto —lo fija la norma y la forma de trabajar del equipo—, y
hasta ahora había que volver a dibujarlo a mano en cada plan nuevo, saliendo un
poco distinto cada vez.

Dos detalles de la tabla:

- **La diagonal está tapada.** Un documento no se espera a sí mismo, así que ahí
  no hay casilla, no es que esté vacía.
- **Una casilla en rojo es un ciclo**: A espera a B y B espera a A. No se impide
  marcarlo —a veces se descubre justo al marcar el segundo— pero se señala,
  porque ningún plan puede cumplir las dos cosas.

Lo que ata esto a un plan concreto es la ficha de cada tarea: la tarjeta
**Documentos que entrega**. Con eso declarado, la matriz sabe de qué tareas
habla.

El catálogo arranca **vacío** a propósito: los entregables son los vuestros, no
los que se le ocurran a la herramienta. Los datos de demostración sí traen un
juego de nueve para poder verla funcionando.

#### Aplicar la matriz a un proyecto

Debajo de la matriz, el panel **Aplicar la matriz a un proyecto**. Eliges el
proyecto, pulsas **Previsualizar** y sale lo que haría:

- **Las dependencias que crearía**, cada una con la casilla de la matriz que la
  justifica: «FMECA ▸ Safety Case». Vienen marcadas; desmarca las que no
  cuadren.
- **Las que la matriz exige y no va a crear**, con el motivo: ya están en el
  plan, la misma tarea entrega los dos documentos, o crearla cerraría un ciclo
  —y en ese caso te dice por qué camino.
- **Los huecos**: documentos que la matriz nombra y que **ninguna tarea del
  proyecto entrega**. No es un error, pero mientras eso siga así la propuesta
  está incompleta. Suele significar que falta una tarea, o que falta marcar qué
  entrega una que ya existe.

Hasta que no pulsas **Crear N dependencia(s)** no se escribe nada. Al aceptar,
se crean como dependencias fin-comienzo sin desfase —la matriz dice el orden,
no cuánto se espera— y el plan se recalcula.

Se puede aplicar las veces que haga falta: lo que ya está no se duplica, aparece
como «ya está en el plan». Y una dependencia creada así es una dependencia
normal: se quita desde **Plan** como cualquier otra.

#### La ficha de un entregable: el ciclo de firma y las subactividades

Pulsando el **código** de un entregable se abre su ficha, y debajo de los campos
de siempre hay dos bloques que declaran **cómo se hace**, no sólo en qué orden.

**El ciclo de firma.** Quién escribe, quién verifica y quién aprueba — **por
rol, nunca por persona**. «Jefe RAMS», no el nombre de quien lo es esta semana:
quién ocupa el puesto cambia, y el catálogo describe cómo trabaja el equipo.

La pantalla avisa cuando el reparto no se sostiene: que no hay aprobador, que el
autor se verifica a sí mismo, que el mismo rol aparece dos veces. **Avisa, no
impide.** Un catálogo a medio rellenar es el estado normal de un catálogo el
primer día, y una herramienta que se niega a guardarlo es una herramienta que no
se usa.

Un detalle que parece un fallo y no lo es: «RAMS Engineer 1» y «RAMS Engineer 2»
**sí** son independientes. Es como los procedimientos escriben «tiene que
verificarlo otra persona del mismo puesto».

**Las subactividades.** Un entregable no es una tarea: son las 40 h de quien lo
escribe y las 10 h de quien lo revisa, que son dos personas en dos momentos
distintos. Cinco casillas:

| | Qué es |
|---|---|
| **Crear (C)** | Quien lo escribe |
| **Revisar 1, 2, 3 (R1/R2/R3)** | Los **niveles** de revisión |
| **Soportar (S)** | Acompañar: reuniones, dudas, el ISA |

Tres cosas que evitan preguntas:

- **Los niveles no son rondas.** Un entregable puede tener revisión 2 y no tener
  revisión 1, y está bien: es lo que pasa con lo que escribe otro departamento y
  aquí sólo se revisa. La herramienta no avisa de ello porque no falta nada.
- **Que el creador y el revisor tengan el mismo rol tampoco es un error.** Un
  rol lo ocupan varias personas. Lo que sí se mira en ese sentido es el ciclo de
  firma, que es donde la independencia significa algo.
- **El soporte no encadena con nadie.** No entrega nada y no bloquea a nadie.

El desplegable de la derecha dice **qué firma descarga** cada subactividad.
Marcarlo sirve para algo concreto: la herramienta puede entonces avisarte de
*una firma que cuesta minutos y que ninguna subactividad hace*, que si no se
quedaría fuera del plan sin que nadie lo notara.

En la lista, la columna **Subactividades** resume la cadena —«S-Eng › TL RAMS»—
y lo que suma. La ⚠ delante significa que hay algo que mirar; pasa el ratón por
encima y lo dice.

> **Esto es declaración, todavía no cálculo.** El catálogo guarda las
> subactividades y sus minutos; el motor **no** parte aún las tareas del plan en
> su cadena ni mueve fechas por ellas. Cuando lo haga cambiarán cifras, y por
> eso va en un paso aparte.

### Informes

La pregunta que se hace una vez al mes: **¿en qué estamos?** Y la de después:
*¿en qué estamos **en este periodo**?*

Se elige **uno o varios proyectos** —o ninguno, y salen todos los que puedas
ver— y **un periodo**. Los cuatro botones de al lado son atajos: *Todo el plan*,
*Este trimestre*, *Seis meses*, *Este año*. El que manda por defecto es todo el
plan; los demás son decisión tuya, no de la herramienta.

**En corto** es el resumen: lo que leerías si sólo leyeras cinco líneas. Cuántos
proyectos y tareas, cuántas horas comprometidas sobre la capacidad de quien
trabaja en ellos, el avance, el coste, quién se pasa, qué va con retraso y qué
dejó dicho el último cálculo. El botón **Copiar el resumen** lo deja en el
portapapeles en texto plano, listo para pegar en un correo, con la ejecución y
el periodo al final.

Debajo va el detalle del que salen esas cinco líneas: **mes a mes**, **por
proyecto**, **por persona**, **lo que va con retraso** y **lo que dice el
motor**.

Tres cosas que conviene saber de cómo están hechos los números:

- **La capacidad es la de las personas que trabajan en los proyectos elegidos**,
  no la del equipo entero. Con el equipo entero, un informe de un solo proyecto
  diría «el 1 % de la capacidad»: cierto e inútil.
- **El avance se pondera por trabajo, no por número de tareas.** Diez fichas de
  una hora terminadas y una de mil horas sin empezar no son un 91 %. Son un 1 %.
- **La saturación de una persona es la de su peor mes.** Un 200 % en mayo y un
  20 % en junio dan un 110 % de media que no le pasa a nadie.

Si tu rol no incluye ver costes o ver la carga, el informe llega sin esa parte y
**lo dice arriba**. No es que cueste cero ni que no haya nadie pasado: es que no
se te envía.

Al pie va la **ejecución** de la que sale todo y el periodo. Dos personas que
miran el mismo informe están mirando los mismos números, y el mismo informe se
puede volver a sacar más adelante: misma ejecución y mismo periodo, mismas
cifras.

Se imprime bien: la barra, las pestañas y los botones desaparecen en papel.

### Reparto

Qué trabajo se podría mover, a quién, y qué arreglaría. **Son propuestas, no
decisiones**: se aplican de una en una y sólo si te convencen.

Cada fila dice lo mismo que diría un compañero sensato: esta tarea la lleva Jan,
que está al 131 % en mayo; Ana cumple lo que la tarea pide y tiene hueco; si se
la pasas, Jan baja al 98 % y Ana sube al 41 %.

Las reglas que sigue, y que conviene conocer para fiarse de la lista:

- Sólo mira asignaciones que caen en un mes en el que su dueño **se pasa** del
  umbral que elijas arriba.
- Un candidato lo es porque **tiene las competencias que la tarea pide, al nivel
  que las pide**, y porque le **queda hueco los días exactos** en que hay que
  hacer el trabajo.
- **Nunca propone a quien quedaría sobrecargado.** Eso sería mover el problema de
  sitio, no resolverlo.
- Si alguien está sobrecargado y **nadie puede recogerlo**, lo dice abajo en vez
  de callarse. Ese caso no se arregla repartiendo: se arregla contratando,
  formando a alguien, o moviendo la fecha.

Por qué no lo hace sola: la herramienta ve horas y competencias declaradas. No
ve que alguien acaba de entrar, que a otro le toca formarse en eso, o que ese
cliente exige que firme una persona concreta. Tú sí. Una herramienta que
reasigna sola a tu equipo acaba desobedecida, y entonces no sirve para nada.

**Reparto y Nivelar no son lo mismo**, y se complementan:

| | Qué cambia | Cuándo usarlo |
|-|------------|---------------|
| **Reparto** | **Quién** hace el trabajo. Las fechas no se tocan | Hay alguien libre que sabe hacerlo |
| **Nivelar** | **Cuándo** se hace. Quién lo hace no se toca | No hay a quién pasárselo: sólo cabe retrasar |

### Hallazgos

Todo lo que el motor quiere decirte, ordenado por gravedad:

| Gravedad | Qué es | Qué hacer |
|----------|--------|-----------|
| **Bloqueante** | El plan no se puede calcular: un ciclo de dependencias, por ejemplo | Arreglarlo ya; hasta entonces no hay plan |
| **Error** | Una restricción imposible: una tarea que debe empezar antes de que termine su predecesora | Decidir cuál de las dos cosas cede |
| **Aviso** | Una sobrecarga, un deadline que no se cumple, un desvío de presupuesto, alguien en una tarea sin la competencia que pide | Decidir si se acepta |
| **Información** | Contexto del cálculo | Leer y seguir |

Un **deadline** no mueve nunca una tarea: avisa. Una **restricción** sí la mueve,
y cuando entra en conflicto con una dependencia, gana la restricción y se emite
un hallazgo visible. Nunca se te mueve una fecha en silencio.

Cada hallazgo trae tres cosas: su **código** —estable, el mismo hoy que dentro de
dos años—, **qué ha pasado esta vez** con nombres, fechas y cifras, y debajo,
en gris, **qué significa ese código siempre**. Esa última línea es la que
convierte un aviso en algo que se puede arreglar.

Los hallazgos salen **en el idioma que tengas puesto**, los cuatro. El motor no
escribe la frase: manda el código y los datos, y la frase se monta aquí. Por eso
un cálculo de hace un año se lee hoy en alemán sin volver a calcularlo. Si
apareciera un hallazgo de un código que esta versión no conoce, se enseña la
frase original en castellano en vez de dejar un hueco.

### Comparar

El diff entre dos cálculos: qué tareas se han movido, cuántos días y cuánto
trabajo ha cambiado. Sirve para lo importante:

1. Congelas el plan de hoy con **Línea base** y le pones nombre.
2. Cargas el proyecto nuevo, o cambias lo que sea.
3. Vuelves aquí y comparas contra la línea base.

Eso es la respuesta a la segunda pregunta, con nombres y fechas.

### Registro

Quién cambió qué y cuándo, con el comentario de la operación y **qué campos se
movieron**: `duración: 480 → 960`, no «cambio en Tarea 3.2». Se filtra por
persona, por tarea o por comentario.

El registro no lo escribe la aplicación, lo escribe la base de datos con cada
cambio, así que no se puede olvidar de anotar nada ni se puede reescribir
después. Las filas que salen **sin autor** no son un fallo: son los cambios
hechos con la CLI y los anteriores a que la herramienta tuviera login.

Es de toda la herramienta y no se corta por proyecto: un cambio no siempre
cuelga de uno —dar de alta a alguien, retirar una competencia— y una lista a
medias contaría una historia falsa.

### Administración

Sólo la ven quienes administran. Son dos cosas:

**La hoja de permisos.** Una tabla con todas las funciones de la herramienta en
las filas, agrupadas por la pantalla a la que pertenecen, y los roles en las
columnas. Una casilla por cruce. Marcar o desmarcar y darle a **Guardar** en esa
columna.

Tres cosas que conviene saber de esta hoja:

1. **La lista de funciones se mantiene sola.** No está escrita a mano en ningún
   sitio: sale del propio código. Cuando la herramienta aprende a hacer algo
   nuevo, aparece aquí sin que nadie tenga que acordarse. Si a alguien se le
   olvidara ponerle permiso, el servidor no arranca.
2. **Las funciones marcadas con ● conviene pensarlas dos veces.** Son las que
   dejan ver costes y tarifas, cambiar el nivel de competencia de alguien o
   repartir permisos.
3. **Las marcadas «toda la herramienta» no se pueden acotar a un proyecto.** El
   equipo, las tarifas, las competencias y los cálculos del motor son de todos
   los proyectos a la vez, así que esas funciones sólo cuentan si el rol se
   concede en toda la herramienta. En un rol concedido sobre un proyecto se
   quedan fuera.
4. **Superadministración no aparece como columna.** Lo tiene todo siempre. Es lo
   que evita que desmarcar la casilla equivocada te deje fuera de tu propia
   herramienta.

Esta pantalla está **en los cuatro idiomas**, incluido el detalle de cada
función: es la que se lee para decidir, y una casilla cuyo texto no entiendes es
una casilla que marcas a ciegas.

Lo que **no** se traduce son los nombres de los roles, los códigos de proyecto y
los nombres de las personas. No es un olvido: los pones tú. Un rol que hayáis
llamado `Verantwortlicher` se llama así en las cuatro pantallas.

**Usuarios y roles.** Dar de alta personas, cambiarles la contraseña,
desactivarlas y concederles roles. Un rol se concede **en toda la herramienta** o
**sólo en un proyecto**. Lo que alguien puede hacer en un proyecto es la suma de
los dos: un rol por proyecto añade permisos, nunca los quita.

Desactivar a alguien le cierra las sesiones abiertas en el acto. Las cuentas no
se borran, porque su nombre tiene que seguir apareciendo en el historial de
cambios.

Un rol acotado a un proyecto tampoco deja **ver** los demás: quien lo tiene
abre la herramienta y sólo encuentra su proyecto, en la carga, en el plan, en los
hallazgos y en lo que exporte. La única excepción es la saturación del equipo,
que pide ver la carga en toda la herramienta — la ocupación de una persona
calculada con un solo proyecto no es su ocupación, es un número que engaña.

---

## 4. Los botones de la cabecera

| Botón | Qué hace |
|-------|----------|
| **Importar CSV** | Carga un plan desde un fichero plano |
| **Exportar** | Descarga la carga mensual en CSV, con el identificador del cálculo en cada fila |
| **Línea base** | Congela el cálculo actual con un nombre. Una línea base es un cálculo congelado, no una copia aparte |
| **Nivelar** | Retrasa tareas hasta que el plan quepa en la capacidad del equipo |
| **Recalcular** | Vuelve a calcular. Se usa poco: cada cambio recalcula solo |
| **Contraseña** | Cambia la tuya. Cierra todas tus sesiones y te hace volver a entrar |
| **Salir** | Cierra tu sesión |

Si alguno de estos botones no te aparece, es que tu rol no incluye esa función.

### Sobre **Nivelar**

Es una heurística y está declarada como tal. Tres cosas que conviene saber:

1. **No toca el plan original.** Crea un cálculo nuevo. Para ver qué ha costado
   que quepa, compara los dos en la pestaña **Comparar**.
2. **Es determinista.** La misma entrada da el mismo resultado siempre, hasta el
   desempate. No vas a obtener dos planes distintos del mismo botón.
3. **Cuando una asignación no cabe ni sola en la jornada de la persona, lo dice**
   en vez de retrasarla eternamente. Ahí lo que hay que cambiar es la dedicación,
   la duración o el calendario, no la fecha.

---

## 5. Cosas que pasan y qué significan

**«Falta un proyecto que yo sé que existe.»**
Tu rol está concedido sobre otros proyectos, no sobre ése. No es que el proyecto
no esté: es que no llega. Quien administre la herramienta puede concederte un rol
sobre él desde **Administración → Usuarios y roles**.

**«Veo la carga pero todos los importes salen a cero.»**
No es un fallo de datos: es que tu rol no incluye **Ver costes y tarifas**, o lo
incluye sólo sobre algunos proyectos. Los importes no se ocultan en pantalla, es
que el servidor no los envía, y el CSV que exportes sale directamente sin la
columna de coste si hay algún proyecto cuyos costes no puedas ver. Si los
necesitas, hay que pedir el permiso.

**«Veo el equipo pero no sus tarifas, y sí veo los euros de la carga.»**
Correcto y a propósito. El importe de un mes es de un proyecto; la tarifa es lo
que cobra una persona. Para lo segundo hace falta ver costes **en toda la
herramienta**, no sólo en un proyecto.

**«El coste de este proyecto sale a cero.»**
Alguien del equipo no tiene tarifa. Pestaña Equipo, busca el ⚠.

**«He cambiado la duración de una tarea y se ha movido media cartera.»**
Es lo correcto: esa tarea estaba en el camino crítico. El botón **¿por qué?** de
cualquier tarea movida enseña la cadena completa.

**«Ya hay un periodo de disponibilidad que se solapa con esas fechas.»**
Una persona no puede estar al 50 % y al 80 % el mismo día. Borra el tramo
anterior o ajusta las fechas. Lo mismo con las tarifas.

**«Una plantilla no lleva personas asignadas.»**
Estás intentando poner equipo en un molde. Crea un proyecto a partir de ella
—**+ Desde «…»** en la pestaña Plan— y asigna la gente ahí.

**«Sólo se puede colgar trabajo de una fase o de un paquete de trabajo.»**
Estás intentando meter una tarea debajo de otra tarea. Crea una fase y cuelga
las dos de ella.

**«He dado de baja a alguien y sus tareas siguen ahí.»**
Correcto. La baja es lógica: la persona deja de contar en los cálculos nuevos,
pero nada se borra y los cálculos ya hechos se siguen explicando igual. Sus
asignaciones se retiran en el mismo momento, así que sus tareas se quedan
visiblemente sin nadie y salen en **Hallazgos** como `TASK_UNASSIGNED`. Es a
propósito: si las asignaciones se quedaran ahí y el motor las ignorase por no
encontrar a su persona, la carga del proyecto bajaría en silencio.

**«El número de la pantalla no coincide con el del Excel que exporté ayer.»**
Mira el identificador de ejecución: la cabecera lo enseña y el CSV exportado lo
lleva en cada fila. Si son distintos, son dos cálculos distintos, y la pestaña
**Comparar** te dice exactamente en qué se diferencian.

---

## 6. Lo que la herramienta no hace, y no por descuido

- **No escribe ficheros `.mpp`.** Exporta CSV, que es lo que de verdad se usa.
- **No reasigna trabajo sola.** Nivelar retrasa; no decide quién hace qué. Esa
  decisión es tuya.
- **No deja escribir una fecha calculada.** Ni en la tabla ni en el panel de
  edición. Una fecha que se pueda sobreescribir a mano deja de explicar nada, y
  la mitad del valor de esta herramienta es que cada fecha se explica.
- **No adivina.** Un dato que no has declarado no se inventa: se queda vacío y,
  si afecta a un resultado, sale un hallazgo.
