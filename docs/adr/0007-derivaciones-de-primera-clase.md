# ADR-0007 · Las derivaciones son una salida del motor, no logging

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

«¿Por qué esta tarea empieza el 14 de abril?» es una de las diez preguntas que la
herramienta existe para contestar. Un `console.log` no es una explicación navegable.

## Decisión

Cada valor derivado emite su **derivación**: la regla que lo produjo y las referencias a
las entradas que usó. Es parte del `PlanResult`, con su tabla (`derivation`) y su
endpoint. La interfaz la presenta como un árbol desplegable hasta los datos declarados.

Se escribe **desde la primera línea del motor**.

## Alternativas descartadas

- **Añadirlo después.** Exigiría reescribir cada paso del motor: cada `max()` que gana en
  el paso adelante es una derivación, y hay que capturarla donde ocurre.
- **Reconstruir la explicación a posteriori.** Sería un segundo motor que adivina lo que
  hizo el primero, con sus propios errores.

## Coste aceptado

Volumen y algo de rendimiento. Se mitiga con un `DerivationSink` desactivable (coste cero
en el modo rápido de previsualización) y con purga por política: se conservan siempre las
de las ejecuciones congeladas.
