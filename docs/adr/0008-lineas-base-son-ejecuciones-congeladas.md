# ADR-0008 · Una línea base es una ejecución congelada

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Microsoft Project guarda once juegos de columnas duplicadas (`baseline1_start`,
`baseline2_start`…). Es un número arbitrario, ocupa el esquema y no permite comparar dos
líneas base entre sí sin gimnasia.

## Decisión

Una línea base es una fila en `baseline` que apunta a un `calculation_run` marcado como
inmutable. Nada más.

## Consecuencias

- Comparar cualquier par de planes es un `JOIN` entre dos `run_id`: el diff contra línea
  base sale gratis, y también el diff «ayer contra hoy» o «plan vivo contra what-if».
- El número de líneas base es ilimitado.
- Congelar es una acción de usuario, así que es la única escritura que `planner_api`
  tiene en la zona derivada, y está acotada a la columna `is_frozen`.

## Coste aceptado

Hay que retener indefinidamente los datos de las ejecuciones congeladas, incluido su
snapshot de entrada comprimido. Una línea base sin su snapshot es una foto sin negativo:
no se puede reproducir ni explicar.
