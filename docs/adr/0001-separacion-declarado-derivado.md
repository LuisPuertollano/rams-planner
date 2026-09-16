# ADR-0001 · Separación física entre lo declarado y lo derivado

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

En las herramientas de planificación al uso, la fecha que escribe el usuario y la
fecha que calcula el motor viven en la misma columna. De ahí nacen las
restricciones fantasma: arrastras una barra en el Gantt y sin avisarte se crea un
*no empezar antes del…* que envenena el plan durante meses. El resultado es que
nadie se fía de los números.

## Decisión

Lo declarado y lo derivado viven en tablas distintas, y además en roles de base
de datos distintos: `planner_api` no tiene escritura sobre la zona derivada y
`planner_engine` no la tiene sobre la declarada. Para fijar una fecha no se edita
la fecha calculada: se declara una restricción, que es un dato de entrada.

## Alternativas descartadas

- **Convención y revisiones de código.** Falla en el tercer *hotfix*, y falla en
  silencio.
- **Columnas separadas en la misma tabla** (`start_declared`, `start_computed`).
  No impide que un `UPDATE` descuidado las cruce, y no resuelve a qué ejecución
  de cálculo pertenece el valor derivado.

## Coste aceptado

Más tablas, más `JOIN`s, y hay que saber siempre de qué ejecución vienen los
números. A cambio, la pregunta «¿esto lo escribí yo o lo calculó la herramienta?»
tiene respuesta sin ambigüedad.
