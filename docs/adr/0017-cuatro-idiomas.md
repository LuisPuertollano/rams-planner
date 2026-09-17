# ADR-0017 · La interfaz en cuatro idiomas

**Estado:** aceptada, en curso · **Fecha:** 2026-09-17

## Contexto

La interfaz nació en castellano y la decisión estaba escrita: «interfaz en
castellano; base de datos y API en inglés», con la nota «antes de la fase 4:
añadir i18n después es caro». Se pidió después, y es caro: la herramienta tiene
unas 350 cadenas visibles repartidas en treinta y tres ficheros.

## Decisión

Cuatro idiomas —castellano, inglés, alemán y francés— con un diccionario por
idioma y **el castellano como fuente**.

### El castellano define qué claves existen

`es.ts` lleva `as const`; los otros tres se escriben contra el tipo que sale de
él. Una traducción a la que le falte una clave **no compila**, y una que se
invente una, tampoco.

Esto importa más de lo que parece, porque una traducción incompleta **no falla**:
se queda en castellano en medio de una pantalla en alemán y nadie lo ve hasta
que lo ve un cliente. Es el mismo trato que el catálogo de permisos y la regla
de dependencias: la regla se hace cumplir, no se recuerda.

Lo que el tipo no puede comprobar lo comprueba una prueba: que ninguna
traducción esté vacía, que los huecos `%s` sean los mismos en los cuatro —uno de
más deja un hueco sin rellenar, uno de menos se come un dato— y que ningún
idioma sea una copia del castellano.

### Sin librería

Hace falta un diccionario, un `%s` y elegir el idioma. Tres cosas que caben en
cien líneas y que no justifican una dependencia que hay que mantener durante
diez años. Si algún día hacen falta plurales de verdad —el alemán y el francés
los tienen distintos del castellano— se añade entonces, con el caso delante.

### El idioma de los números vive en una variable de módulo

`1.234,5` y `1,234.5` son el mismo número escrito de dos formas que se leen mal
cruzadas, y `03/04` es marzo o abril según quién lo mire. Así que todo el
formateo pasa por el idioma activo.

Y ese idioma es **un único hecho de la página**, no algo que cambie de una tabla
a otra. Pasarlo a mano por cada `hours()` no daría ni una garantía más y se
olvidaría en la mitad de los sitios, que es como se acaba con un número en
alemán y el de al lado en castellano. Vive en `format.ts` y lo fija la
aplicación al cambiar de idioma.

Se fija **durante el pintado**, no en un `useEffect`. En un efecto llega tarde:
los hijos ya se han pintado con el idioma anterior y se ve un «1,648 h» inglés
en una pantalla en castellano hasta el siguiente cambio de estado. Se encontró
mirando la pantalla, no el test.

### El idioma inicial

El que se eligió la última vez; si no, el del navegador. Quien abre la
herramienta en Fráncfort no debería tener que buscar el selector para entender
la pantalla de entrada.

## Lo que queda

**Esto traduce el armazón**: la pantalla de entrada, la barra superior, los
nombres y las pistas de las pestañas, las tarjetas de arriba, los estados
vacíos, el panel de contraseña y **todos los números y fechas de toda la
herramienta**.

**El interior de las tablas sigue en castellano**, y también lo que produce el
servidor: los mensajes de los hallazgos, las etiquetas del catálogo de permisos
y los errores de la API. Eso último es la parte cara: hay que traducir desde el
`code` y la carga útil que ya viajan, no desde la frase.

Los **hallazgos** ya están hechos, así: [ADR-0020](0020-hallazgos-traducidos.md).
Quedan las etiquetas de los permisos y los errores de la API.

Se hace por partes a propósito. La alternativa era un solo cambio de trescientas
cadenas y cuatro traducciones, imposible de revisar de verdad; y una revisión
que no se hace no protege de nada.
