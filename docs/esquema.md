# Esquema de datos

DDL en [`db/migrations/`](../db/migrations). Este documento explica **por qué** el
esquema es así.

## Las cuatro zonas

La separación es física —tablas distintas— y está reforzada con permisos de base
de datos, no sólo con disciplina en el código.

| Zona | Tablas | Quién escribe |
|------|--------|---------------|
| **Declarado** | `project`, `wbs_node`, `task`, `dependency`, `assignment`, `resource`, `calendar*`, `resource_availability`, `absence`, `resource_cost_rate`, `scenario*`, `field_*`, `tag*`, `rule_definition` | `planner_api` |
| **Derivado** | `calculation_run`, `task_result`, `assignment_timephased`, `resource_capacity_timephased`, `finding`, `derivation` | `planner_engine` |
| **Real** | `actual_entry`, `progress_update` | `planner_api` |
| **Historial** | `change_event` | sólo el trigger (`SECURITY DEFINER`) |

`planner_api` no tiene `INSERT` sobre la zona derivada y `planner_engine` no lo
tiene sobre la declarada. Eso convierte el principio P1 en algo que el sistema
hace cumplir, no algo que hay que recordar — y hay un test que lo comprueba
(`db/tests/invariants.sql`).

La única excepción, deliberada y acotada: congelar una ejecución como línea base
sí es una acción de usuario, así que `planner_api` tiene `INSERT` sobre
`baseline` y `UPDATE` **sólo de la columna `is_frozen`** de `calculation_run`.

## Decisiones y su justificación

### Minutos enteros, no horas decimales

Una jornada de 7,5 h son 450 minutos exactos. En horas decimales, un tercio de
una jornada de 7 h son 2,333… y al sumar 220 días laborables aparece la
diferencia de 0,4 h que hunde la credibilidad de un informe. Con enteros la suma
es exacta por construcción.

### `DATERANGE` + `EXCLUDE`, no JSONB, para la disponibilidad

`resource_availability(resource_id, valid_period, units_bp)` con una restricción
`EXCLUDE USING gist` hace que PostgreSQL **impida** dos periodos solapados para
el mismo recurso. Con un JSONB de *overrides* mensuales no se puede consultar
(«¿quién está al 50 % en abril?» obliga a escanear y parsear todo), no se puede
indexar, no se valida el solape, y el historial sólo puede decir «el JSON
cambió».

### Un árbol `wbs_node`, no tres tablas

Proyecto → Paquete → Actividad es una jerarquía rígida de tres niveles. Cada
nivel que la realidad exija después (fase, subsistema, lote) sería una tabla
nueva, un modelo nuevo, una UI nueva y una migración. Un árbol recursivo con
`node_kind` cuesta lo mismo hoy y no cuesta nada mañana. El precio es el `path`
materializado que la aplicación mantiene al mover subárboles.

Los nodos contenedores no se estiman: sus cifras son la agregación derivada de
sus hijos, y por eso **no tienen fila** en `task`.

### Los resultados cuelgan de `calculation_run`

No existe `task.computed_start`; existe `task_result(run_id, node_id, …)`.
Comparar dos planes es un `JOIN` entre dos `run_id`, así que el diff contra línea
base sale gratis. Y una línea base no necesita once juegos de columnas duplicadas
(`baseline1_start`, `baseline2_start`…): es una fila apuntando a una ejecución
congelada.

`input_hash` permite no recalcular si nada cambió, y detectar que un informe
salió de un plan que ya no existe.

### Grano diario en `assignment_timephased`

Un mes con festivos no es 1/12 del año, y una tarea del 25/03 al 05/04 no
reparte 50/50. Guardar el día y agregar hacia arriba es exacto; guardar el mes y
prorratear es aproximado y no tiene vuelta atrás. Además, que toda vista agregue
la misma tabla es lo que impide que dos pantallas se contradigan.

Volumen: unas 100 000 filas por ejecución con 20 recursos y 5 años. Particionada
por año; `ensure_assignment_timephased_partition(año)` crea las particiones
nuevas y es idempotente.

### Vigencias, no valores eternos

Las tarifas (`resource_cost_rate`) y los patrones semanales de calendario
(`calendar_week_slot`) tienen periodo de validez. Una tarifa única eterna obliga
a reescribir el pasado cada vez que alguien sube de categoría.

## Invariantes que hace cumplir la base de datos

| Código | Invariante | Mecanismo |
|--------|-----------|-----------|
| R1 | La disponibilidad de un recurso no se solapa | `EXCLUDE USING gist` |
| R2 | La capacidad diaria nunca es negativa | `CHECK` |
| C1 | Un calendario no hereda de sí mismo | `CHECK` |
| C2 | Los intervalos de un día no se solapan | `CHECK` + clave primaria |
| W1 | Un nodo no es su propio ancestro | `CHECK` + validación en la app |
| T1 | Un hito no tiene duración ni trabajo | `CHECK` |
| D1 | Una dependencia no une una tarea consigo misma | `CHECK` |
| A1 | Un recurso no se asigna dos veces a la misma tarea | `UNIQUE` |
| P1 | El motor no escribe lo declarado y la API no escribe lo derivado | `GRANT` |
| P7 | El historial no se edita | trigger que rechaza `UPDATE`/`DELETE` |

Todos están cubiertos en `db/tests/invariants.sql`, que CI ejecuta en cada PR.
