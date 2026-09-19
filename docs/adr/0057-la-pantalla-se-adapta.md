# ADR-0057 — La pantalla se adapta: mando, menús y zoom

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** —

## Contexto

La interfaz había crecido por acumulación: catorce pantallas, seis grupos, un
menú de acciones, un tema, un idioma y un usuario, todo en la misma fila y con
el mismo peso. Tres defectos medibles, no de gusto:

1. **Dos niveles de navegación visibles a la vez.** Los seis grupos arriba y,
   dentro del panel, una segunda fila con las pantallas del grupo activo. Ese
   renglón estaba en **todas** las pantallas para enseñar entre una y seis
   palabras, y sólo las del grupo en el que ya estabas: para saber qué hay en
   «Capacidad» había que irse a Capacidad.
2. **Cinco tarjetas de cifras, siempre.** 110 px de alto en cada pantalla, con
   un número grande cada una que en la mitad de los casos era «—».
3. **Nada que regular.** La densidad era la que era. En el plan real caben doce
   filas en una pantalla de portátil, y no había forma de pedir veinte.

Y uno de forma: todo era una tarjeta blanca con el mismo borde, el mismo radio
de 10 px y la misma sombra. Sin jerarquía, el mando pesaba lo mismo que el
contenido.

## Decisión

**Una barra de mando en tinta.** La cabecera deja de ser papel y pasa a ser
tinta en los dos temas. Separa de un vistazo lo que manda de lo que se lee, y
el contenido empieza en el borde de su propia zona en vez de flotar en una
página sin cabecera.

**La navegación se despliega al pasar el ratón.** Los seis grupos siguen
arriba; lo que hay dentro de cada uno aparece bajo demanda, **con la frase de
cada pantalla al lado**, que es lo que de verdad hace falta para elegir. La
segunda fila desaparece y el renglón se recupera para el contenido. El ratón no
es el único camino: pulsar el grupo navega —y vuelve a la última pantalla que
estuviste viendo en él—, el foco del teclado abre el panel igual, `Escape`
cierra, y el tabulador lo recorre entero.

**Un zoom de cinco escalones, de la herramienta y no del navegador.** 80 · 90 ·
100 · 112 · 125 %. Decide cuánta información cabe, que es lo que se pide cuando
se pide zoom en una herramienta de planificación. Se guarda en el navegador de
quien lo pone, y si el almacenamiento falla —ventana privada— la herramienta
abre al 100 % sin decir nada, porque un zoom no es un dato del plan.

**Las cifras pasan a un renglón.** Las cinco tarjetas se convierten en una
cinta de una línea, y la coletilla explicativa aparece **sólo cuando el número
no está** —explica el hueco, no adorna la cifra—. El número grande se reserva
para «Hoy» y el panel, donde la cifra *es* la pantalla.

**Lo secundario se calla.** Las acciones de cada fila (`+ Fase`, `✎`,
`¿por qué?`) pierden borde y fondo y los recuperan cuando el ratón o el teclado
llegan a su fila: en una tabla de cuatrocientas filas eran ochocientos
rectángulos compitiendo con los números. Las doce plantillas, que ocupaban una
banda entera de botones idénticos, pasan a un menú. Y los controles de tres
opciones excluyentes —escala del periodo, zoom del cronograma— pasan a ser un
control segmentado, porque la forma ya dice que eliges una.

## `zoom` y no una escala de `rem`

Lo ortodoxo sería declarar los tamaños en `rem` y mover el `font-size` de la
raíz. Aquí eso **deja media herramienta fuera**: el cronograma calcula su
geometría en píxeles desde JavaScript —el ancho de un día, la posición de una
barra— y esos píxeles no son `rem` ni pueden serlo. Con la escala de `rem`, el
Gantt se quedaría del tamaño de siempre dentro de una pantalla encogida.

La duda que hacía sospechoso a `zoom` era qué pasa con lo que está en
`position: fixed` —los cajones y sus fondos—. **Se comprobó en un navegador de
verdad antes de elegirlo**: a 1,25 y a 0,8, el fondo del cajón sigue midiendo
1500 × 950, el viewport entero. No se razonó: se midió.

## Consecuencias

- Un renglón menos de chrome en todas las pantallas, y otro más al quitar las
  tarjetas: en el plan caben **20 filas donde antes cabían 12**, al 100 %; al
  80 %, 28.
- Para saber qué hay en un grupo ya no hay que entrar en él.
- El tema, el idioma y el zoom viven juntos en «Vista» en vez de sueltos en la
  barra: se usan una vez al mes y estaban permanentemente al lado de
  «Calcular», que se usa a diario.
- La rampa de saturación **no se toca**: sus valores están medidos y los vigila
  `check:rampa`. Lo que cambia es la superficie sobre la que se dibuja.

## Comprobado

- 947 pruebas, **11 nuevas** sobre la escala: el escalón más cercano, el valor
  imposible, el fuera de rango, el almacenamiento que lanza y el que no existe.
- Mirado en pantalla con Chromium: claro y oscuro, 80 % y 125 %, 1600, 1180 y
  900 px de ancho. Sin desbordamiento horizontal en ninguno y sin un solo error
  de consola.
- Recorrido con el teclado: el foco en un grupo abre su panel, el tabulador
  entra en él y `Escape` lo cierra. Trazado, no supuesto.
- El zoom sobrevive a la recarga.
- Las siete reglas de `tools/` en verde, `check:literales` incluida: ninguna de
  las frases nuevas está escrita a mano en la interfaz.
