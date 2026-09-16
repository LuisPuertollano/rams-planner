# ADR-0003 · SQL explícito, sin ORM

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

El valor de esta herramienta está concentrado en un puñado de consultas de
agregación: carga por recurso y mes, capacidad efectiva, saturación, diff entre
ejecuciones. Son el producto, no un detalle de infraestructura.

## Decisión

Acceso a datos con SQL explícito (`pg` + Kysely como constructor tipado). Las
consultas de agregación se escriben a mano y se leen como lo que son.

## Alternativas descartadas

- **Prisma.** Mal encaje con `daterange`, `EXCLUDE USING gist`, el particionado y
  los permisos por rol, que aquí no son accesorios sino el mecanismo que hace
  cumplir P1.
- **TypeORM.** Añade una capa que hay que auditar *además* del SQL que genera.

## Coste aceptado

Más código de mapeo, mitigado con la generación de tipos de Kysely a partir del
esquema real.
