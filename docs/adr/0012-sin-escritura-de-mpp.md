# ADR-0012 · No se escribe el formato .mpp

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Intercambiar planes con quien usa Microsoft Project es una necesidad real.

## Decisión

El intercambio va por **MS Project XML** (documentado), Excel y CSV. `.mpp` se puede
*leer* con MPXJ si algún día hace falta; no se escribe.

## Por qué

`.mpp` es un formato cerrado, sin documentar y que cambia entre versiones. Reproducirlo es
un pozo sin fondo que no sirve a ninguna de las diez preguntas del documento de objetivos.

## Coste aceptado

Quien reciba un plan nuestro tendrá que importarlo desde XML en vez de abrirlo con doble
clic. Es un paso más, una vez, frente a un mantenimiento perpetuo.
