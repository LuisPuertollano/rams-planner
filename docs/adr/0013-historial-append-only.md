# ADR-0013 · Historial append-only con borrado lógico

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

«¿Quién cambió esta estimación, cuándo y por qué?» es una de las diez preguntas. Un
historial que se puede editar no es un historial.

## Decisión

- `change_event` es de **sólo añadir**. Nadie tiene `UPDATE` ni `DELETE`: ni la
  aplicación, ni el propietario de la base de datos. Un trigger lo rechaza.
- El borrado de entidades es `deleted_at` (borrado lógico). Nada se pierde.
- Cada mutación registra actor, momento, antes, después y un `request_id` que agrupa todos
  los cambios de una misma operación de usuario: mover una fase con 30 tareas es **un**
  cambio en la interfaz y 31 filas agrupadas en el historial.
- El comentario del cambio se captura en la interfaz para lo sensible (estimaciones,
  disponibilidad, dependencias). No para todo: pedir justificación al renombrar una tarea
  sólo enseña a la gente a escribir «.» en el campo.

## Coste aceptado

Crecimiento lineal e ilimitado, que se gestiona con particionado y archivado por política.
Y que todas las consultas deben filtrar `deleted_at IS NULL`, lo que se encapsula en
vistas para que no se olvide.
