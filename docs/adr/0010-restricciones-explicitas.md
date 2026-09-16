# ADR-0010 · Restricciones explícitas y deadlines blandos

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

La causa número uno de planes de Microsoft Project que nadie consigue explicar son las
restricciones fantasma: arrastras una barra del Gantt y se crea un *Start No Earlier
Than* que no pediste y que no verás hasta dentro de tres meses.

## Decisión

- Arrastrar una barra **abre un diálogo**: «¿quieres crear la restricción *no empezar
  antes del 14/04*?». Nunca se crea una restricción en silencio.
- `deadline` es **blando**: no mueve la tarea, sólo genera un hallazgo `DEADLINE_MISSED`
  con los días de retraso. Para mover, existe `constraint_kind`.
- Una restricción dura que contradiga una dependencia no se relaja: gana la restricción y
  se emite `CONSTRAINT_CONFLICT`, visible.
- Cualquier recálculo que altere un valor declarado (la duración al añadir un recurso a
  una tarea `fixed_work`) lo dice antes de hacerlo y deja su derivación.

## Coste aceptado

Fricción deliberada en el Gantt: un clic de más. Compra no tener que explicar, meses
después, por qué el plan hace algo que nadie recuerda haber pedido.
