# ADR-0004 · Un árbol WBS recursivo, no una jerarquía fija

**Estado:** aceptada · **Fecha:** 2026-09-16

## Contexto

Proyecto → Paquete de trabajo → Actividad es una jerarquía rígida de tres niveles. Es
exactamente lo que hace falta hoy, y deja de serlo el día que aparezca una fase
intermedia, un subsistema, un lote, o un paquete dentro de otro paquete.

## Decisión

Una sola tabla `wbs_node` auto-referenciada, con `node_kind`
(`phase` | `work_package` | `task` | `milestone`), `parent_id`, `path` materializado y
`sort_key`. Los datos de planificación viven en una tabla `task` 1:1 que **sólo tienen
las hojas**: los contenedores no se estiman, sus cifras son la agregación derivada de
sus hijos, y por eso no tienen fila.

## Alternativas descartadas

- **Tres tablas rígidas.** Cada nivel nuevo es una tabla, un modelo, un controlador, un
  componente de interfaz y una migración. Cuesta lo mismo hoy y caro para siempre.
- **Árbol sin `path` materializado.** Obliga a una CTE recursiva en las rutas calientes,
  que son justo las de la matriz de carga.

## Coste aceptado

La aplicación debe mantener `path` al mover subárboles, y las consultas de agregación
son algo más complejas. A cambio, añadir un nivel es un `INSERT`.
