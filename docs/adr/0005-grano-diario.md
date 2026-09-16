# ADR-0005 · Grano diario en la carga distribuida

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

La pregunta que la herramienta contesta es mensual («¿cuántas horas tiene Ana en
marzo?»), así que la tentación es guardar meses.

## Decisión

`assignment_timephased` guarda **una fila por asignación y día**. Toda vista semanal,
mensual, trimestral, por proyecto, por competencia o por etiqueta es una agregación de
esa tabla.

## Alternativas descartadas

- **Grano mensual.** Un mes con festivos no es 1/12 del año, y una tarea del 25 de marzo
  al 5 de abril no reparte 50/50. Prorratear es aproximado y no tiene vuelta atrás.
- **Grano horario.** Exacto de más: multiplica el volumen por ocho sin contestar ninguna
  pregunta nueva.

## Coste aceptado

Unas 100 000 filas por ejecución con 20 recursos y 5 años. Se gestiona con particionado
anual y purga de ejecuciones antiguas. A cambio, se gana algo que no tiene precio: que
dos pantallas no puedan contradecirse, porque beben de la misma fuente.
