# ADR-0009 · Nivelación heurística, determinista y desactivada por defecto

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Nivelar recursos —redistribuir para eliminar sobreasignaciones— es un problema NP-duro.
Ninguna herramienta lo resuelve de forma óptima, aunque todas lo insinúen.

## Decisión

Heurística de prioridad, **declarada como tal en la interfaz**, desactivada por defecto,
que escribe en una columna separada (`leveled_minutes`) y **nunca** sobre
`planned_minutes`. El orden de candidatos es: prioridad del proyecto, holgura total,
inicio temprano y, como último desempate, el UUID de la tarea.

Ese cuarto criterio es lo que la hace reproducible: dos ejecuciones con los mismos datos
dan exactamente el mismo plan nivelado.

## Alternativas descartadas

- **Solver de programación entera.** Mejores resultados, pero opaco: no sabe explicar por
  qué movió lo que movió, lo que choca de frente con P4. Además es una dependencia pesada
  y no determinista entre versiones.
- **Nivelación automática al guardar.** Mueve el plan del usuario sin su permiso.

## Coste aceptado

Los resultados son buenos, no óptimos, y la interfaz lo dice con esas palabras. Cuando la
heurística no converge sin romper una restricción dura, emite `LEVELING_IMPOSSIBLE` y deja
la sobreasignación visible en vez de esconderla.
