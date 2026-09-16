# 03 · Esquema de datos

DDL vivo en [`db/migrations/`](../../db/migrations). Este documento explica **por qué**
el esquema es así y qué decisiones concretas evita. Los invariantes que aquí se
afirman están comprobados en [`db/tests/invariants.sql`](../../db/tests/invariants.sql),
que CI ejecuta en cada PR.

## 3.1 Las cuatro zonas

El esquema está dividido en cuatro zonas con reglas de escritura distintas. La
separación es física (tablas separadas) y se refuerza con permisos de base de datos,
no sólo con disciplina en el código.

| Zona | Tablas | Quién escribe | Quién lee |
|------|--------|---------------|-----------|
| **Declarado** | `project`, `wbs_node`, `task`, `dependency`, `assignment`, `resource`, `calendar*`, `resource_availability`, `absence`, `resource_cost_rate`, `scenario*`, `field_*`, `tag*`, `rule_definition` | `planner_api` | Todos |
| **Derivado** | `calculation_run`, `task_result`, `assignment_timephased`, `resource_capacity_timephased`, `finding`, `derivation` | `planner_engine`, dentro de un `calculation_run` | Todos, sólo lectura |
| **Real** | `actual_entry`, `progress_update` | `planner_api` | Todos |
| **Historial** | `change_event` | Sólo el trigger (`SECURITY DEFINER`) | Auditoría |

> `planner_api` **no tiene** `INSERT/UPDATE/DELETE` sobre la zona derivada. `planner_engine`
> **no tiene** escritura sobre la declarada. Esto convierte el principio P1 en algo que
> PostgreSQL hace cumplir, no algo que hay que recordar en cada revisión de código.

La única excepción, deliberada y acotada: congelar una ejecución como línea base sí es
una acción de usuario, así que `planner_api` tiene `INSERT` sobre `baseline` y `UPDATE`
**sólo de la columna `is_frozen`** de `calculation_run`.

Los roles son de grupo (`NOLOGIN`). El usuario real de cada servicio se crea fuera de
las migraciones, con su contraseña, y se le concede el grupo:

```sql
CREATE USER planner_api_svc PASSWORD '...';
GRANT planner_api TO planner_api_svc;
```

## 3.2 Decisiones concretas y su justificación

### Minutos enteros en vez de horas decimales

`duration_minutes INTEGER`, no `duration_hours NUMERIC(10,2)`.

Una jornada de 7,5 h son 450 minutos exactos. En horas decimales, 1/3 de jornada son
2,5 h — pero 1/3 de una jornada de 7 h son 2,333… y al sumar 220 días laborables de
un año aparece la diferencia de 0,4 h que hunde la credibilidad de un informe.
Con enteros, la suma es exacta por construcción y los redondeos ocurren sólo al
formatear para el usuario.

### `DATERANGE` + `EXCLUDE USING gist` en vez de JSONB para la disponibilidad

La tentación es guardar `monthly_availability_overrides JSONB`. Eso significa:
no se puede consultar («¿quién está al 50 % en abril?» exige escanear y parsear todo),
no se puede indexar, no se puede validar el solape, y el registro de cambios sólo
puede decir «el JSON cambió».

Con `resource_availability(resource_id, valid_period DATERANGE, units_bp)` y una
restricción `EXCLUDE`, PostgreSQL **impide** físicamente que existan dos periodos
solapados para el mismo recurso (invariante R1), la consulta es un índice GiST, y
cada cambio de disponibilidad es una fila con su propio evento de auditoría.

### Un árbol `wbs_node` en vez de tres tablas

Proyecto → Paquete → Actividad es una jerarquía **rígida de tres niveles**. Cada nivel
nuevo que la realidad exija (fase, subsistema, lote) es una tabla nueva, un modelo
nuevo, un controlador nuevo, un componente de UI nuevo y una migración.

Un árbol recursivo con `node_kind` cuesta lo mismo hoy y no cuesta nada mañana. El
precio es que las consultas de subárbol necesitan `path` materializado — resuelto con
`path text_pattern_ops` y un prefijo `LIKE '001.004.%'`, que es un index scan.

### `task` separada de `wbs_node` en 1:1

Los nodos contenedores no tienen duración propia ni trabajo propio: sus cifras son la
suma de sus hijos. Si duración y trabajo vivieran en `wbs_node`, esas columnas
estarían nulas o —peor— rellenas con valores derivados en el 40 % de las filas,
violando P1. Separándolas, un contenedor simplemente **no tiene fila** en `task`.

### Los resultados cuelgan de `calculation_run`

No hay `task.computed_start`. Hay `task_result(run_id, node_id, scheduled_start, …)`.
Consecuencias directas:

- Comparar dos planes es un `JOIN` entre dos `run_id`. El diff contra línea base
  (pregunta P5) sale gratis.
- Una línea base no necesita 11 juegos de columnas duplicadas (`baseline1_start`,
  `baseline2_start`… como en Project). Es una fila en `baseline` apuntando a un `run`.
- Se puede conservar el historial de cálculos y purgarlo por política sin tocar los
  datos declarados.
- `input_hash` permite **no recalcular** si nada cambió, y detectar «este informe salió
  de un plan que ya no existe».

### Grano diario en `assignment_timephased`

Es la tabla grande. Dimensionamiento realista para tu caso:

```
20 recursos × 4 asignaciones activas × 250 días laborables/año × 5 años
  ≈ 100 000 filas por ejecución de cálculo
```

Con `PARTITION BY RANGE (work_date)` y purga de ejecuciones antiguas, esto es
irrelevante para PostgreSQL. A cambio, **cualquier** agregación (semana, mes,
trimestre, por proyecto, por competencia, por etiqueta) es un `GROUP BY` sobre la
misma fuente. Es lo que garantiza que la vista mensual y la vista Gantt nunca puedan
contradecirse.

### Puntos base para los porcentajes

`units_bp INTEGER` con 10000 = 100 %. Permite expresar 33,33 % sin flotantes y
mantiene la aritmética entera de extremo a extremo. Al formatear se divide por 100.

### `derivation` como tabla de primera clase

Es la única forma honesta de cumplir P4. Cada vez que el motor fija un valor
—una fecha de inicio, un reparto diario, una holgura— escribe una fila con la regla
aplicada y las referencias a las entradas. La UI navega esa tabla para el panel
«¿por qué?». Es voluminosa, así que se escribe sólo para la ejecución activa y para
las congeladas (las intermedias se purgan).

## 3.3 Volumen y rendimiento esperados

| Tabla | Filas (5 años, 20 recursos, 10 proyectos) | Notas |
|-------|-------------------------------------------|-------|
| `wbs_node` | ~3 000 | |
| `assignment` | ~4 000 | |
| `assignment_timephased` | ~100 000 / ejecución | particionada por año |
| `resource_capacity_timephased` | ~25 000 / ejecución | |
| `derivation` | ~50 000 / ejecución | sólo ejecución activa + congeladas |
| `change_event` | crecimiento lineal e ilimitado | particionada por mes |

Objetivo de latencia: matriz de carga de 20 recursos × 60 meses en **< 150 ms**
desde vistas materializadas por ejecución.

## 3.4 Migraciones

- Una herramienta única (`node-pg-migrate` o `dbmate`), migraciones numeradas,
  reversibles y **aplicadas por un job separado**, nunca por el arranque del servidor.
- Prohibido el `IF NOT EXISTS` defensivo como sustituto de una migración real: oculta
  divergencias entre entornos.
- Los datos semilla (calendarios base con festivos de Baden-Württemberg, catálogo de
  campos personalizados RAMS) van en migraciones de datos separadas y versionadas.

## 3.5 Invariantes que hace cumplir la base de datos

No son comentarios en el código: son restricciones que PostgreSQL impone, y cada una
tiene su comprobación en [`db/tests/invariants.sql`](../../db/tests/invariants.sql),
que provoca a propósito la operación que debe fallar.

| Código | Invariante | Mecanismo |
|--------|-----------|-----------|
| R1 | La disponibilidad de un recurso no se solapa | `EXCLUDE USING gist` |
| R2 | La capacidad diaria nunca es negativa | `CHECK` |
| C1 | Un calendario no hereda de sí mismo | `CHECK` |
| C2 | Los intervalos laborables de un día no se solapan | `CHECK` + clave primaria |
| W1 | Un nodo no es su propio ancestro | `CHECK` + validación en la aplicación |
| T1 | Un hito no tiene duración ni trabajo | `CHECK` |
| D1 | Una dependencia no une una tarea consigo misma | `CHECK` |
| A1 | Un recurso no se asigna dos veces a la misma tarea | `UNIQUE` |
| P1 | El motor no escribe lo declarado y la API no escribe lo derivado | `GRANT` |
| P7 | El historial no se edita | trigger que rechaza `UPDATE`/`DELETE` |

Un invariante que la base de datos no pueda imponer (W1 en toda su generalidad, los
ciclos de dependencias) se valida en el motor y produce un hallazgo bloqueante, nunca
un arreglo silencioso.
