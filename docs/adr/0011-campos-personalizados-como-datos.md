# ADR-0011 · Los campos del dominio son datos, no columnas

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Tag RAMS, nivel SIL, norma aplicable, centro de coste, criticidad, cliente. Hoy son seis;
mañana serán otros. Como columnas, cada uno es una migración y un despliegue.

## Decisión

`field_definition` + `field_value`: el usuario define en tiempo de ejecución la entidad a
la que aplica, el tipo, las opciones y la validación. Los campos son filtrables,
agrupables y exportables automáticamente en todas las vistas. Pueden ser **calculados**
mediante una expresión declarativa.

Las expresiones se evalúan con un intérprete propio y acotado: AST validado por esquema,
operadores en lista blanca, límite de pasos, sin acceso a red ni a variables globales.
**Nunca `eval` ni `new Function`** — ESLint lo impide en todo el repositorio.

## Alternativas descartadas

- **`ALTER TABLE` por cada necesidad.** Migración más despliegue para algo que debería ser
  un formulario.
- **Un JSONB libre.** Sin validación, sin metadatos, sin interfaz genérica posible.

## Coste aceptado

Consultas más complejas y un planificador de filtros propio. Se mitiga con índices por
`entity_id` y proyecciones materializadas de los campos más usados.
