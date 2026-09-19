# Qué hace cada rol, y por dónde empieza

El [manual de uso](manual-de-uso.md) cuenta la herramienta entera, pantalla por
pantalla. Esta página es lo otro: **una puerta por rol**, para que nadie tenga
que leer 600 líneas buscando las cuarenta que le tocan.

Busca tu rol, léete su página, y vuelve al manual sólo cuando una pantalla
concreta te deje una duda.

> **Las pestañas que no puedes usar no aparecen.** Si un compañero tiene una que
> tú no tienes, no es un fallo: es el reparto de permisos. No hay ninguna
> pantalla escondida a la que se llegue escribiendo la dirección a mano; el
> servidor comprueba el permiso otra vez en cada petición.

| Rol | Para quién | Qué NO puede |
|---|---|---|
| [**Lectura**](#lectura) | Quien consulta el plan y la carga: dirección, jefes de proyecto, compañeros de otros equipos | Tocar nada. Ni ver costes. |
| [**Planificación**](#planificación) | Quien construye y mantiene el plan | Ver costes ni tocar tarifas |
| [**Responsable**](#responsable) | Quien además responde del presupuesto | — |
| [**Superadministración**](#superadministración) | Quien instala y reparte el acceso | — (lo tiene todo, y nadie se lo puede recortar) |

Los tres primeros son roles **editables**: la hoja de permisos los cambia, así
que lo que sigue es su reparto de arranque, no una ley. Si en tu instalación
alguien los ha ajustado, manda lo que diga la pestaña **Administración ›
Permisos**.

---

## Lectura

**Lo que ves:** Carga, Saturación, Plan, Cronograma, Equipo, Competencias,
Reparto, Documentos, Informes, Registro. **En euros no entras**, y eso es
deliberado: el coste no es un dato de consulta general.

**Lo que no puedes:** guardar nada. Ningún botón que escriba está ahí. Tampoco
calcular: lo que ves es la última ejecución que alguien lanzó.

### Tu recorrido, en tres pantallas

**1 · Carga** — la pregunta de siempre: *cuántas horas tiene comprometidas cada
persona, cada mes*. Filas de personas, columnas de meses. El número es minutos
convertidos a horas, y no hay ninguna estimación escondida detrás.

**2 · Saturación** — la misma tabla, en color. Azul por debajo del 100 %, gris
en la raya, rojo por encima. **El porcentaje va escrito dentro de cada celda a
propósito**: el color es el atajo, no el dato, y quien no distinga el rojo del
gris sigue leyendo «131 %».

Un aviso que conviene interiorizar, y que la propia pantalla escribe debajo:
*un recurso puede estar equilibrado al mes y saturado tres días concretos*. El
mes es la mentira cómoda; el motor guarda el día.

**3 · Informes** — la pregunta de la reunión mensual: *¿en qué estamos?* Sale
resumido en cinco líneas, y debajo el detalle por proyecto y por tarea.

### Lo que puedes llevarte

Tienes **exportar**. Cualquier tabla sale a CSV con los mismos números que ves,
y ese fichero se abre en Excel sin pelearse con el separador decimal.

### Si algo no cuadra

No lo arregles: díselo a quien planifique. Y cuando un número te extrañe, **haz
clic en él**: casi todos los números derivados de esta herramienta se explican,
y te contarán de dónde salen antes de que tengas que preguntar.

---

## Planificación

Todo lo de Lectura, y además **el plan es tuyo**: lo construyes, lo asignas, lo
calculas y lo congelas en líneas base. Lo único que no ves son los costes.

### La primera vez, en este orden

Saltarse el paso 1 es la causa más frecuente de que después nada cuadre. El
manual lo detalla en [«Empezar desde cero»](manual-de-uso.md#2-empezar-desde-cero);
aquí va el orden y el porqué:

1. **Equipo** — las personas, su calendario y sus ausencias. Sin esto no hay
   capacidad contra la que medir nada. Si son más de cinco, no las teclees:
   *Datos › Importaciones › El equipo* las carga de una vez, con sus
   competencias y sus tarifas, desde un CSV.
2. **Competencias** — quién sabe hacer qué. Es lo que después permite que el
   reparto proponga a alguien y no a cualquiera.
3. **Documentos** — el catálogo de entregables y la matriz de precedencias.
   Se declara **una vez** y vale para todos los proyectos. Si lo tienes en una
   hoja, entra por CSV con su cadena de subactividades incluida: cinco columnas,
   `rol:horas` en cada una. Y si tu Checkliste pide algunos documentos en
   borrador en puertas anteriores, eso va en `entregas_previas`: el porcentaje
   de cada una es **parte** del esfuerzo del documento, no esfuerzo extra.
3.bis **Tu plantilla**, si la tienes. El CSV de plan con un «sí» en la columna
   `plantilla` crea el molde de tu departamento —fases, tareas, duraciones y
   dependencias— sin personas. Y la columna `entregable` lo ata al catálogo, que
   es lo que después permite partir en entregas y en subactividades y poner
   fechas de puerta.
4. **Plan** — el proyecto, sus tareas y sus dependencias.
5. **Las puertas del proyecto** — cuándo cae cada revisión de certificación.
   Es lo que convierte «este documento va a la revisión de diseño» en una fecha.
   Se puede dejar para después, pero entonces no hay fechas objetivo.
6. **Calcular**.

### Las cuatro cosas que sólo tú puedes hacer

**Calcular.** Nada se recalcula solo. Tocas el plan, y el plan cambia cuando tú
lo dices. Cada ejecución queda guardada entera y se puede volver a mirar.

**Nivelar.** La herramienta propone mover tareas para deshacer sobrecargas.
Propone: no escribe hasta que aceptas, y te dice qué movería y por qué.

**Crear una línea base.** Congela una ejecución para comparar contra ella más
adelante. Una línea base **no se borra nunca**, ni siquiera por limpieza
automática: es el «esto es lo que dijimos» de la conversación de dentro de seis
meses.

**Importar.** Plan, equipo, catálogo de documentos y partes de horas entran por
CSV. Cargar dos veces el mismo fichero deja las cosas igual que cargarlo una:
el código manda.

### Documentos: el catálogo, las firmas y las subactividades

Es la pestaña que más ha crecido, y la que más ahorra cuando está llena.

**La matriz de precedencias** dice qué entregable es condición necesaria de
cuál. Con eso declarado, el panel **Aplicar la matriz a un proyecto** propone
las dependencias que faltan, cada una con la casilla que la justifica. No
escribe nada hasta que aceptas.

**El ciclo de firma** dice quién escribe, quién verifica y quién aprueba cada
entregable — **por rol, nunca por persona**. «Jefe RAMS», no el nombre de quien
lo es esta semana. La pantalla avisa si falta el aprobador o si el autor se
verifica a sí mismo, pero **guarda igual**: un catálogo a medio rellenar es el
estado normal de un catálogo el primer día.

**Las subactividades** parten cada entregable en el trabajo real que cuesta:

| | Qué es |
|---|---|
| **Crear (C)** | Quien lo escribe |
| **Revisar 1, 2 y 3 (R1/R2/R3)** | Los **niveles** de revisión |
| **Soportar (S)** | Acompañar: reuniones, dudas, el ISA |

Tres cosas que ahorran preguntas:

- **Revisar es trabajo de otro, y va después.** Lo normal son unas 40 h de quien
  escribe contra unas 10 h de quien revisa. Declararlo junto como «50 h de
  alguien» cuenta mal dos veces: el esfuerzo de cada uno y la duración.
- **Los niveles no son rondas.** Un entregable puede tener revisión 2 sin
  revisión 1: es lo que pasa con lo que escribe otro departamento y aquí sólo se
  revisa. No falta nada y la herramienta no avisa de ello.
- **El soporte no es un documento.** No entrega nada y no bloquea a nadie.

Cada subactividad puede decir **qué firma descarga**. Cuando la revisión de
nivel 1 *es* la verificación que firma el verificador, se marca en el desplegable
de la derecha, y así la herramienta puede avisarte de lo que de otro modo se
perdería: *una firma que cuesta minutos y que ninguna subactividad hace*.

Debajo del catálogo hay tres paneles que llevan lo declarado al plan. Los tres
funcionan igual: eliges proyecto, pulsas **Previsualizar**, y ves entero lo que
harían —con el motivo de cada descarte— antes de que se escriba nada.

**Partir las tareas en las entregas que piden las puertas.** Si tu Checkliste
pide el documento en borrador antes, este panel lo pone en el plan: el «Safety
Case — 120 h» pasa a ser un paquete con *SC · preliminar* (RD), *SC · as
designed* (RF) y *SC* (PES), encadenadas y **cada una con la fecha objetivo de
su propia puerta**. El trabajo total no cambia, y quien estaba asignado se
queda asignado a todas: el borrador y la versión final son el mismo trabajo de
la misma persona en dos momentos. Va **antes** que el panel siguiente: primero
las versiones, y luego cada versión en crear y revisar.

**Partir las tareas en su cadena.** «Redactar el FMECA — 40 h» pasa a ser un
paquete con *Crear* y *Revisar 1* encadenadas, y sus asignaciones y dependencias
se mudan. Mira la cifra de arriba antes de aceptar: **el trabajo total no
cambia**, porque se reparte en la proporción del catálogo y no se vuelve a
estimar. Si no cuadra, no apliques.

**Las puertas del proyecto y las fechas objetivo.** Arriba escribes cuándo cae
cada puerta de certificación en *este* proyecto —el catálogo sabe a cuál va cada
entregable, no en qué día cae—, y de cruzar las dos mitades sale la fecha
objetivo de cada tarea: la fecha de la puerta menos siete días por semana
declarada.

Tres cosas de este último panel que evitan sustos:

- **El objetivo es blando.** No mueve ninguna tarea; si el plan termina después,
  sale en *Qué va tarde* y en los hallazgos. Es para enterarte, no para que el
  plan finja que llega.
- **Se pone una vez.** Mueves la fecha de una puerta y hay que volver a
  previsualizar y aplicar: no se recalcula solo, porque pisaría una fecha que
  pudiste poner a mano.
- **Una puerta sin fecha sale avisada, con su nombre.** Es el descarte más
  común el primer día; se arregla escribiendo la fecha arriba.

### Lo que la herramienta no hará por ti

No adivina. No autocompleta una estimación, no reparte por su cuenta y no
recalcula a tus espaldas. Si un número te sorprende, haz clic: se explica.

---

## Responsable

Todo lo de Planificación, y **dos cosas más**:

- **Ver costes.** La columna en euros aparece en Carga, en Informes y en la
  ficha de cada proyecto.
- **Editar tarifas.** En Equipo, la tarifa de cada persona con su periodo de
  vigencia.

### Lo único que hay que entender de las tarifas

**Cada día se cuenta con la tarifa que estaba vigente ese día.** No con la de
hoy, no con la media. Si alguien cambia de tarifa en julio, el coste de junio no
se mueve — y eso es lo que hace que un presupuesto cerrado siga cerrado cuando
se revisan las nóminas.

De ahí sale la única equivocación cara posible: **abrir una tarifa nueva sin
cerrar la anterior**. La herramienta lo rechaza (`TARIFA_SOLAPADA`) en vez de
elegir una de las dos por ti.

### Y una advertencia sobre los euros

El coste que ves es **el del plan**, no el que se ha gastado. Para lo segundo
están las **horas reales**, que se importan del parte y se comparan en el
informe. Un proyecto puede ir bien en euros planificados y mal en euros
gastados; son dos preguntas distintas y la herramienta contesta las dos por
separado a propósito.

---

## Superadministración

Lo tienes todo, siempre, y **nadie te lo puede recortar**: no es una convención
de la aplicación, es un disparador en la base de datos. Si alguien intenta
quitarle permisos al rol de sistema por SQL, tampoco puede.

Tu trabajo no es planificar: es que los demás puedan.

### Las tres cosas del primer día

1. **Crear las cuentas.** No hay registro ni recuperación por correo, a
   propósito: esto se despliega en la red del equipo, no en internet. Da una
   contraseña generada y di que la cambien al entrar.
2. **Repartir los roles.** Los tres editables son un punto de partida
   razonable, no un dogma. La pestaña **Administración › Permisos** los cambia
   en un minuto, y cada casilla explica qué desbloquea.
3. **Cerrar la instalación.** Mientras no exista ninguna cuenta, la herramienta
   no pide entrar y sale un banner rojo avisando. Se cierra creando la primera:
   `crear-superadmin`, en [`operacion.md`](operacion.md#7-usuarios-roles-y-permisos).

### Lo que conviene mirar de vez en cuando

- **Registro › Administración** — quién hizo qué y cuándo.
- **El historial de ejecuciones** — se guarda entero y se puede reproducir. No
  ocupa lo que parece: dos ejecuciones con la misma capacidad comparten su
  bloque, así que recalcular sin tocar un calendario cuesta una fila.
- **Las copias de seguridad** — [`operacion.md`](operacion.md). Es lo único de
  esta lista que, si falla, no tiene arreglo después.

### Lo que NO deberías hacer

Planificar desde la superadministración por comodidad. No porque rompa nada,
sino porque entonces el registro dice «superadmin» donde debería decir un
nombre, y el día que haya que reconstruir qué pasó, no lo dirá.

---

## Un mapa rápido de permisos

Los de arranque de cada rol. La hoja de permisos manda sobre esto.

| | Lectura | Planificación | Responsable |
|---|:---:|:---:|:---:|
| Ver carga, plan, equipo, competencias, reparto | ✓ | ✓ | ✓ |
| Ver informes y ejecuciones | ✓ | ✓ | ✓ |
| Ver el catálogo de documentos | ✓ | ✓ | ✓ |
| Exportar a CSV | ✓ | ✓ | ✓ |
| Editar el plan, el equipo y las competencias | | ✓ | ✓ |
| Gestionar el catálogo, las firmas y las subactividades | | ✓ | ✓ |
| Calcular, nivelar y crear líneas base | | ✓ | ✓ |
| Importar | | ✓ | ✓ |
| Registrar horas reales | | ✓ | ✓ |
| **Ver costes** | | | ✓ |
| **Editar tarifas** | | | ✓ |
| Gestionar usuarios y roles | | | |

La última fila está vacía a propósito: **usuarios y roles son sólo de la
superadministración** en el reparto de arranque. Se puede delegar desde la hoja
de permisos, y conviene pensárselo antes: quien puede repartir roles puede darse
a sí mismo todo lo demás.
