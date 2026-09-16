# ADR-0006 · El motor es puro y corre en el servidor y en el navegador

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Editar un plan tiene que dar respuesta inmediata, y un viaje al servidor por cada
tecla no la da. La salida habitual es un cálculo aproximado en el cliente y el bueno en
el servidor.

## Decisión

`calculate(snapshot, opciones)` es una función pura —sin I/O, sin reloj, sin
aleatoriedad, sin depender del orden de iteración— empaquetada también para el
navegador (web worker). El mismo código, en dos ubicaciones.

## Alternativas descartadas

- **Dos motores, uno aproximado.** Siempre acaban dando números distintos, y el usuario
  siempre cree al equivocado.
- **Sólo servidor, con *debounce*.** La edición de un plan grande se vuelve incómoda y
  la herramienta se abandona por Excel.

## Coste aceptado

El subgrafo que se edita debe caber en memoria del navegador. La previsualización carga
sólo la parte afectada, no el plan entero.

## Cómo se verifica

ESLint prohíbe `fetch`, `process`, `Date.now()` y `Math.random()` en
`packages/{domain,calendar,scheduler,workload,explain,rules}/src`, y
`tools/check-dependency-rule.mjs` comprueba que el núcleo no importa módulos de Node ni
depende de los adaptadores. CI ejecuta ambos.
