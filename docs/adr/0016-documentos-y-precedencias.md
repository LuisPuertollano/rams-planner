# ADR-0016 · Los documentos y su matriz de precedencias

**Estado:** aceptada · **Fecha:** 2026-09-17

## Contexto

El plan de un proyecto de seguridad es, en el fondo, dos cosas: una lista de
entregables y el orden en que se pueden hacer. El Hazard Log preliminar antes
que el FMECA; el FMECA antes que el Safety Case.

Ese orden **no cambia de proyecto a proyecto**. Lo fija la norma y la forma de
trabajar del equipo. Pero hasta ahora había que volver a dibujarlo a mano en
cada plan nuevo, tarea por tarea y dependencia por dependencia, y cada vez salía
un poco distinto: alguien se olvidaba de que el RAM espera al FMECA, y el plan
pasaba las revisiones igual porque nada lo comprobaba.

## Decisión

Se declara una vez, en dos tablas:

- **`document_type`** — el catálogo de entregables del equipo.
- **`document_precedence`** — la matriz. `predecessor_id` es condición
  necesaria de `successor_id`.

Y una tercera que ata lo anterior a un plan concreto:

- **`node_document`** — qué documento entrega cada tarea.

### Por qué no se reutiliza `rams_tag`

Ya existe un campo personalizado «Disciplina RAMS» cuyos valores se parecen
mucho a esta lista. Son cosas distintas y mezclarlas se pagaría después:

- La **disciplina** es una etiqueta para agrupar y filtrar. Una tarea de «Plan»
  no entrega necesariamente un documento; puede ser una reunión.
- El **documento** es algo que se entrega y que otra cosa espera.

Es el mismo razonamiento que llevó a modelar las competencias aparte de la
disciplina: que hoy los nombres coincidan no los hace lo mismo, y el día que
alguien renombre una disciplina, la precedencia debe seguir en pie.

### `node_document` es N:N

Una tarea de consolidación entrega varios documentos, y un documento grande se
reparte entre varias tareas. Obligar a uno solo daría un modelo más limpio y
planes que no se pueden escribir.

### El catálogo arranca vacío

Ni la migración ni ninguna semilla de producción meten entregables. Los de
verdad son los del equipo que instala esto, no los que se le ocurran a quien
escribe el código — y ya hubo un aviso sobre esto con la plantilla EN 50126
inventada. La pantalla vacía explica para qué sirve y cómo llenarla.

Los **datos de demostración** sí traen nueve documentos con su orden, para que
la matriz se pueda ver funcionando sin teclear nada.

### Los ciclos se señalan, no se impiden

Si A espera a B y B espera a A, ningún plan que salga de ahí se puede calcular.
Pero bloquear la segunda cruz sería peor de usar: a veces el ciclo se descubre
justo al marcarla, y lo que se quiere entonces es ver las dos y decidir cuál
sobra. Se pintan en rojo y se explican.

Lo que sí impide la base de datos es la diagonal: un `CHECK` rechaza que un
documento se espere a sí mismo, porque eso no es una decisión discutible.

### Los permisos

Tres funciones, y el alcance de cada una sale de a quién pertenece la cosa:

| Función | Alcance | Por qué |
|---|---|---|
| `documentos.ver` | toda la herramienta | El catálogo es del equipo, no de un proyecto. |
| `documentos.gestionar` | toda la herramienta | Cambia cómo se planifica **todo**, no un plan. |
| `documentos.asignar` | por proyecto | Se hace tarea a tarea, y una tarea sí es de un proyecto. |

## Lo que quedaba

**Aplicar la matriz a un proyecto**: recorrer sus tareas, mirar qué documentos
entregan y crear las dependencias que la matriz exige, con una previsualización
antes de escribir nada. Hecho en
[ADR-0018](0018-aplicar-la-matriz.md).
