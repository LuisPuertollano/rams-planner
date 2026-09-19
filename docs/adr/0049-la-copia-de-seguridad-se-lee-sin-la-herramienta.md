# ADR-0049 — La copia de seguridad se lee sin la herramienta

**Estado:** aceptada · **Fecha:** 2026-09-20 · **Principios:** P1, P2, P7

## Contexto

La herramienta vive en un contenedor de Docker con PostgreSQL dentro. Hasta hoy
la única forma de salvar los datos era un `pg_dump`, que tiene dos problemas y
el segundo es el gordo:

1. Hay que saber que existe y acordarse de hacerlo.
2. **Para leerlo hace falta PostgreSQL.** Un volcado binario dentro de cinco
   años, cuando la herramienta ya no esté o no arranque, no es una copia de
   seguridad: es un fichero que dice que había datos.

Lo que hace falta es una copia que se pueda abrir con lo que haya: un zip de
CSV que Excel abra de dos clics y `grep` recorra.

## Decisión

**Un zip con una CSV por tabla, un LEEME que explica qué es cada cosa y un
`sha256sums.txt` para demostrar que nadie la tocó.** Y la vuelta: restaurar
desde ese mismo zip, sin nada más.

```
copia-planner-2026-09-19-08-09-39.zip
├── LEEME.txt          qué hay, qué NO hay y por qué; la huella
├── MANIFIESTO.csv     fichero, tabla, zona, filas, sha256
├── sha256sums.txt     sha256sum -c sha256sums.txt
└── tablas/            45 ficheros, uno por tabla
```

### La zona derivada no se copia: se copia su huella

Esta herramienta ya tiene marcada con permisos de base de datos la frontera
entre lo que alguien **escribió** y lo que el motor **calculó** (P1). Esa
frontera decide qué va en la copia.

Lo calculado no va. En la cartera real son 116 220 filas que el motor rehace en
segundos, y guardarlas multiplicaría el zip por varias veces para probar menos.
Lo que sí va es la **huella de entrada** de la última ejecución, y con ella el
LEEME explica el procedimiento: restaurar, recalcular, y si sale la misma
huella, la copia era fiel hasta el último dato. Es el principio P2 convertido en
algo que se puede hacer un martes por la mañana.

Medido, ida y vuelta sobre la cartera real —34 proyectos, 6 222 tareas, 172 467
filas en 49 tablas—:

| | |
|---|---|
| Sacar la copia | **2,3 s** · 2,3 MB |
| Restaurar sobre una base vacía | **10,7 s** |
| Restaurar sobre una base llena | **53,8 s** |
| Huella antes y después | `6d371e42…` = `6d371e42…` |

### El orden no se mantiene a mano

Las tablas se restauran en el orden que dan las **claves ajenas reales**,
ordenadas topológicamente, con desempate alfabético para que dos copias de la
misma base den el mismo zip. Una lista escrita a mano se desincroniza a la
segunda tabla nueva, y entonces restaurar falla en una instalación de verdad y
no en CI.

Y dentro de una tabla que se apunta a sí misma —`wbs_node.parent_id`— las filas
se ordenan padres primero. Eso lo destapó restaurar la cartera real: con los
datos de demostración pasaba por casualidad, porque había pocos nodos y los
UUID cayeron de cara. La peor forma de que una prueba pase.

### El esquema mandó sobre el diseño en tres sitios

Ninguna de estas tres salió de pensarlo; salieron de chocar con un disparador.

**El historial no se restaura.** `change_event` es append-only (P7) y el
disparador rechaza borrarlo. Y tiene razón: restaurarlo sería **reescribir la
historia**. Se exporta porque es evidencia, y no se restaura porque la
evidencia no se fabrica.

**Un usuario que está en la historia no se puede borrar**, porque el historial
lo señala. Así que las tablas que una tabla no restaurada señala no se vacían:
se **funden**. Lo que trae la copia se mete o se actualiza; lo que no trae sólo
se va si nadie lo señala. Y esto tampoco se mantiene a mano: sale de las claves
ajenas, así que el día que el historial apunte a otra cosa, se entera solo.

**Los roles de sistema se quedan como están.** El esquema no deja borrarlos ni
degradarlos, y hace bien.

### Lo que no sale del contenedor

Las contraseñas no se exportan. Un zip de copia acaba en un disco compartido, y
ahí no puede haber con qué entrar. Restaurar recrea las cuentas **sin**
contraseña y hay que ponerles una nueva; `user_session` no se exporta en
absoluto, porque una sesión abierta no es un dato, es una llave.

### El zip se escribe a mano, sin dependencias

Con `node:zlib` y un CRC-32 de quince líneas. El formato ZIP no ha cambiado
desde 1993 y lo que hace falta son unas cabeceras y `deflateRaw`. Una
dependencia más es una dependencia que hay que actualizar durante diez años, y
este proyecto tiene seis. Mismo argumento que el i18n sin librería.

La prueba que lo respalda no es de ida y vuelta contra sí mismo —si el escritor
y el lector comparten un error, pasan los dos— sino que **`unzip` del sistema lo
abre**, que es de lo que se trata.

## Alternativas descartadas

**`pg_dump` dentro del zip.** Restaura mejor y no se puede auditar sin
PostgreSQL, que era el requisito. Nada impide hacerlo además; esto no lo
sustituye.

**Dos representaciones: las tablas en bruto y los CSV en formato de
importación.** Estaba en el primer diseño y se quitó. Dos representaciones de
lo mismo son dos cosas que pueden discrepar, y la que restaura tiene que ser
una sola y exacta. El CSV por tabla ya se abre en Excel.

**Apagar los disparadores al restaurar.** Iría más rápido y entraría cualquier
cosa. Una copia que sólo entra con los invariantes apagados no es una copia
buena, es un volcado.

**Silenciar la auditoría durante la restauración.** Cada restauración escribe
unos 43 000 eventos de cambio y engorda el historial unos 11 MB. Silenciarlos
exigiría una forma de escribir sin auditoría, y esa puerta cuesta más que el
disco: es justo la garantía que P7 sostiene. Se queda, y los eventos llevan
todos el mismo comentario, así que se filtran de un vistazo.

## Coste aceptado

- **El historial crece unos 11 MB por restauración.** Está dicho arriba y hay
  que saberlo antes de usar restaurar como ensayo semanal.
- Restaurar sobre una base llena tarda un minuto largo, contra diez segundos
  sobre una vacía. Lo que cuesta es respetar las claves ajenas y la auditoría,
  y las dos cosas valen ese minuto.
- **Una cadena vacía y un `NULL` se escriben igual** y vuelven como `NULL` allí
  donde la columna lo admita. La alternativa —un centinela tipo `\N`— hace el
  CSV ilegible en Excel, que era el requisito. En una columna que no admite
  nulo, el vacío vuelve como vacío.
