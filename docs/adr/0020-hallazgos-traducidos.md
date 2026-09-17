# ADR-0020 — Los hallazgos, traducidos desde el código y no desde la frase

**Estado:** aceptada · **Fecha:** 2026-09-17 · **Principios:** P2, P4

## Contexto

[ADR-0017](0017-cuatro-idiomas.md) puso la interfaz en cuatro idiomas y dejó
escrito lo que faltaba, nombrando la parte cara:

> lo que produce el servidor: los mensajes de los hallazgos, las etiquetas del
> catálogo de permisos y los errores de la API. Eso último es la parte cara: hay
> que traducir desde el `code` y la carga útil que ya viajan, no desde la frase.

Los hallazgos son la voz del motor: quince códigos que explican por qué el plan
sale como sale. Salían en castellano en medio de una pantalla en alemán, que es
exactamente el fallo que ADR-0017 describe como el que nadie ve hasta que lo ve
un cliente.

Traducir la frase que manda el servidor no es una opción: habría que negociar el
idioma en cada petición, el mismo hallazgo guardado tendría un texto distinto
según quién lo calculó, y un informe archivado dejaría de reproducirse.

## Decisión

**El `payload` es el contrato.** El motor manda un `code`, un `payload` con
todos los datos que la frase necesita, y —de respaldo— la frase castellana que
escribió él. La interfaz construye el texto desde los dos primeros.

### El payload lleva los nombres, no los identificadores

Era la mitad del trabajo, y descubrió dos fallos de verdad: los cuatro mensajes
de `CONSTRAINT_CONFLICT` y uno de `LEVELING_IMPOSSIBLE` enseñaban el **UUID** de
la tarea donde el lector espera su nombre. Un «`«2a7bcc2b-de40-40ca…» tiene que
empezar el 3 de marzo`» no lo lee nadie, y llevaba ahí desde que se escribió.

Además, cuatro hallazgos no llevaban payload ninguno, así que su frase no se
podía reconstruir. Ahora todos lo llevan y una prueba lo comprueba rellenando
cada código y exigiendo que no quede ni un `%s` sin sustituir ni un `—` de dato
ausente, en los cuatro idiomas.

### Cuando un código dice varias cosas, el payload trae `variant`

`CONSTRAINT_CONFLICT` describe cuatro situaciones y `LEVELING_IMPOSSIBLE` cinco.
La alternativa era partirlos en nueve códigos, y se descarta: **los códigos
están guardados** en la base de datos y en los informes de hace dos años.
Añadir uno es barato; cambiar uno obliga a migrar el pasado.

Así que el payload trae una clave `variant` y la clave del diccionario es
`hallazgo.<CODE>.<variant>`. La variante no es inventada: en el conflicto de
restricción es la clase de restricción, que discrimina exactamente las cuatro
ramas.

### El respaldo es de verdad, no un adorno

Si un hallazgo llega con un código que no está en el diccionario —una ejecución
de hace dos años, un motor más nuevo hablando con una interfaz más vieja— se
enseña el `message` que mandó el servidor. En castellano, y eso es mejor que un
hueco o que un código pelado.

Que eso no pase por descuido lo impide una prueba: recorre `FindingCode`, exige
clave para cada uno y **también al revés**, que no haya claves de códigos que ya
no existen. `@planner/domain` entra en la interfaz como dependencia de
desarrollo sólo para eso; nada de lo que se compila para el navegador lo
importa. Una copia de la lista de códigos en el fichero de la prueba se
olvidaría de actualizar justo en el caso que la prueba existe para cazar.

### El texto se rellena caso a caso, a mano

`findings.ts` tiene un `switch` con un caso por clave, y en cada uno los huecos
en el orden del diccionario. Es repetitivo a propósito: un bucle genérico sobre
el payload ataría el orden de las palabras al orden de las claves de un objeto,
y entonces el alemán —que pone el verbo donde le corresponde— no se podría
traducir. El compilador comprueba la exhaustividad del `switch`.

### Las unidades se formatean donde se enseñan

El payload viaja en minutos laborables, puntos básicos y fechas ISO, como todo
lo demás (P5). La frase los convierte a horas, a porcentaje y a fecha local con
los mismos formateadores que el resto de la herramienta, así que un hallazgo
alemán dice `80,0 h` y `1.4.2026` sin que el servidor sepa nada de eso.

Un detalle que costó pensar: la saturación del pico llega como `-1` cuando ese
día **no había capacidad ninguna**, que es distinto de un 0 %. La frase lo dice
con palabras en vez de con un número.

## Alternativas descartadas

**Negociar el idioma en el servidor** (`Accept-Language`, o el idioma del
usuario en la sesión). Rompe P2: el mismo cálculo daría hallazgos distintos
según quién lo lanzó, y una ejecución dejaría de ser reproducible byte a byte.

**Guardar el hallazgo en los cuatro idiomas.** Cuadruplica la tabla de hallazgos
para un dato derivado, y un idioma nuevo obligaría a recalcular el pasado.

**Partir los códigos hasta que cada uno diga una sola cosa.** Es más limpio en
el papel y peor en la práctica: nueve códigos nuevos y los antiguos huérfanos en
la base de datos.

**Traducir también las etiquetas del catálogo de permisos y los errores de la
API en este paso.** Son otras dos conversaciones —los permisos son un catálogo
de treinta y dos entradas con su detalle, y los errores de la API no tienen
todavía un `code` estable en todas partes—. Meterlas aquí daría un cambio de
cuatrocientas cadenas imposible de revisar, que es el mismo argumento de
ADR-0017.

## Coste aceptado

- Un código nuevo en el motor obliga a tocar cuatro diccionarios y un `switch`.
  Lo obliga CI, no la memoria, y es la mitad del coste de que un cliente alemán
  lea una frase en castellano.
- La frase castellana sigue guardándose en la base de datos aunque casi nunca se
  enseñe. Es lo que permite leer un hallazgo antiguo, y ocupa lo que ocupa.
- El interior de las tablas sigue en castellano en los cuatro idiomas, igual que
  antes. Lo siguiente son las etiquetas de los permisos, que es lo que lee quien
  reparte el acceso.
