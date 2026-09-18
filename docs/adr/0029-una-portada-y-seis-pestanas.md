# ADR-0029 — Una portada, y seis pestañas en vez de catorce

**Estado:** aceptada · **Fecha:** 2026-09-18 · **Principios:** P1, P4, P6

## Contexto

La herramienta tenía catorce pestañas en una sola fila, todas al mismo nivel:

```
Carga · Saturación · Plan · Cronograma · Equipo · Calendario · Competencias ·
Documentos · Reparto · Informes · Hallazgos · Comparar · Registro · Administración
```

Y una cabecera con diez controles, también todos al mismo nivel: tema, idioma,
Importar CSV, Importar horas, Exportar, Línea base, Nivelar, Recalcular,
Contraseña, Salir.

Tres problemas, y ninguno es de estética.

**Nada respondía «¿y ahora qué miro?».** Para saber si el plan de hoy se
sostiene había que visitar seis pantallas y cruzarlas mentalmente: los hallazgos
graves en una, quién se pasa de capacidad en otra, lo que llega tarde en una
tercera, las horas fichadas fuera de plan en el informe. La herramienta lo
calculaba todo y no lo juntaba en ningún sitio.

**Catorce pestañas en fila no tienen jerarquía.** «Carga» y «Administración»
pesaban lo mismo, y «Hallazgos» —que es donde está lo urgente— quedaba la
undécima, después de «Reparto».

**La cabecera mezclaba mirar con hacer.** Cambiar el tema y recalcular el plan
entero eran dos botones idénticos a dos centímetros. Uno no tiene consecuencias
y el otro reescribe todas las fechas de todos los proyectos.

Había además un impuesto de mantenimiento que hacía cara cualquier
reorganización: el nombre de cada pestaña estaba escrito **tres veces** —en el
tipo `Tab`, en la unión de claves de `label` y en la de `hint`—, cuarenta y dos
cadenas que había que mantener de acuerdo a mano.

## Decisión

**Seis grupos arriba, un segundo nivel dentro.**

```
Hoy   Plan          Capacidad     Equipo         Datos          Registro
      Plan          Carga         Equipo         Documentos     Comparar
      Cronograma    Saturación    Calendario     Importaciones  Registro
                    Reparto       Competencias                  Administración
                    Informes
```

«Hallazgos» desaparece como pestaña: vive en «Hoy», que es donde se mira.

**Una portada, «Hoy», que no calcula nada nuevo.** Todo lo que enseña ya estaba
en la herramienta, repartido: los hallazgos graves, quién se pasa de capacidad,
lo que llega tarde, los enlaces que apuntan fuera del plan, las horas fichadas
donde nadie planificó nada, y cuándo fue el último cálculo. Cada bloque lleva a
la pantalla que lo explica. Si no hay nada que enseñar, lo dice: un hueco en
blanco se lee como una avería.

**La cabecera se parte en dos.** Un único menú **Calcular** con todo lo que
cambia los datos —Recalcular, Nivelar, Línea base, Importar plan, Importar
horas, Exportar— y, al otro lado, lo que sólo cambia cómo lo ves tú: tema,
idioma, tu nombre, contraseña y salir.

**La navegación se declara una vez**, en `packages/web/src/nav.ts`. Las claves
de texto salen del diccionario por tipo (`Extract<keyof Diccionario,
'tab.${string}'>`), así que una errata no compila y el nombre se escribe una
sola vez.

## Consecuencias

El diálogo de importar ya no puede vivir dentro del botón que lo abre: el menú
se cierra al elegir una opción, y eso desmontaría la importación a medias. Por
eso `App` guarda **qué** se está importando y pinta el diálogo arriba del todo,
y los tres contratos se configuran en un único `ImportDialog` que usan el menú,
la pantalla de Importaciones y el catálogo de documentos.

Una pantalla más que existe es una pantalla más que puede mentir. La primera
versión de «Hoy» contaba las personas pasadas con la ocupación **mensual** y
decía «3», diez centímetros debajo de una tarjeta que decía «6». Las dos cifras
eran correctas: el motor marca la sobrecarga **por día** y la ocupación se
agrega **por mes**, y alguien puede pasarse un martes sin pasarse abril. Daba
igual que fuese explicable; dos números distintos para lo que se lee como lo
mismo hacen que se deje de creer a los dos. La lista sale ahora del mismo
hallazgo del que sale la tarjeta, y el mes se añade sólo cuando además lo hay.

Es la misma avería que ADR-0027 anotó con otra ropa: una regla que suena bien
—«la ocupación mensual es la ocupación»— que nadie del dominio confirmó, y que
contradice lo que el motor ya decía.

## Alternativas descartadas

**Dejar catorce pestañas y sólo añadir la portada.** Habrían sido quince. La
portada arregla «¿qué miro?» y no arregla «¿dónde está lo que busco?».

**Un menú lateral plegable.** Cabe todo, pero esconde la navegación entera
detrás de un clic y no dice qué va con qué; los grupos sí.

**Rutas en la URL en vez de estado.** Sería mejor —un enlace a una pantalla
concreta hoy no existe—, pero es una decisión aparte y más grande: obliga a
elegir un enrutador y a decidir qué parte del estado es direccionable. Esta
reorganización no la impide; al declararse la navegación en un solo sitio, la
hace más barata.
