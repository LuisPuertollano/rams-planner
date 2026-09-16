# 08 · Plan de implementación

Siete fases. Cada una termina en algo **usable y verificable**, no en «infraestructura
lista». El orden no es negociable en un punto: el motor de calendario va antes que
todo lo demás, porque cambiarlo después obliga a reescribir el resto.

Las estimaciones son de trabajo enfocado de una persona con apoyo de IA. Duplícalas si
es tiempo robado a otras tareas.

---

## Fase 0 · Cimientos  — ~3 días

Monorepo pnpm + Turborepo, TypeScript estricto, Vitest, ESLint, CI (build, test,
cobertura, comprobación de la regla de dependencia entre paquetes), Docker Compose con
Postgres, dbmate y el esquema del doc 03 aplicado.

**Terminado cuando:** `pnpm test` pasa en CI, `docker compose up` levanta base de datos
con el esquema migrado y los datos semilla (calendarios base con festivos de
Baden-Württemberg 2026-2030).

---

## Fase 1 · Calendarios  — ~1 semana

`@planner/calendar` completo: compilación, herencia, patrones con vigencia,
excepciones, y las tres primitivas.

**Terminado cuando:**
- ≥ 10 propiedades de fast-check en verde (ida y vuelta, monotonía, conmutatividad de
  excepciones, invarianza ante el orden de carga).
- Los casos 1-4, 35, 36 y 37 del corpus de golden files pasan.
- Cobertura de ramas ≥ 95 % en el paquete.

> Esta fase parece pequeña y es la que más veces se subestima. Todo lo demás depende de
> ella y ninguna decisión posterior la puede corregir.

---

## Fase 2 · Motor de planificación  — ~2 semanas

`@planner/scheduler`: validación del grafo, ecuación de la tarea, CPM completo,
restricciones, holguras, agregación de contenedores. Con `@planner/explain` desde el
primer día — añadir las derivaciones después es reescribir el motor.

**Terminado cuando:** casos 5-13, 17-27 y 35-38 en verde; `planner calc snapshot.json`
funciona desde la CLI; el árbol de explicación se genera para cualquier fecha.

---

## Fase 3 · Carga de trabajo  — ~1,5 semanas  ← **aquí la herramienta ya sirve**

`@planner/workload`: contornos, reparto entero determinista, capacidad efectiva,
saturación, costes. Persistencia de ejecuciones. API mínima. **Matriz de carga (V1) y
mapa de calor (V2)** en la web.

**Terminado cuando:** con datos reales de tu equipo cargados por CSV, la matriz
contesta P1, P2 y P6, y cualquier celda se explica hasta el dato declarado.

> A partir de este punto la herramienta ya aporta más que la hoja de Excel actual,
> aunque falte todo lo demás. Es el hito que hay que proteger: si el proyecto se
> parase aquí, no habría sido un fracaso.

---

## Fase 4 · Edición y auditoría  — ~2 semanas

API de escritura completa con concurrencia optimista, triggers de `change_event`, hoja
de plan (V4), ficha de recurso y disponibilidad (V7), bandeja de hallazgos e historial
(V8). Previsualización en el navegador con el motor compilado a web worker.

**Terminado cuando:** el plan se mantiene íntegramente desde la UI (adiós al CSV), todo
cambio queda registrado con actor y comentario, y la línea de tiempo de una entidad se
consulta desde la interfaz.

---

## Fase 5 · Gantt, escenarios y líneas base  — ~2 semanas

Gantt propio (V3) con enlaces dibujables y diálogo explícito de restricciones.
Escenarios what-if con overrides, congelación de ejecuciones como líneas base,
comparador (V5) con diff y `causes`.

**Terminado cuando:** P3, P4, P5 y P9 se contestan desde la interfaz, y
`planner replay` reproduce una línea base idéntica byte a byte.

---

## Fase 6 · Realidad y extensibilidad  — ~2 semanas

Imputaciones y avance, vista plan vs. real con curva S y benchmarking (V6), campos
personalizados y calculados de extremo a extremo (definición → columna → filtro →
export), reglas declarativas editables, importación/exportación Excel y MS Project XML.

**Terminado cuando:** añadir un campo personalizado nuevo con su columna y su filtro es
una acción de usuario sin despliegue (criterio 5 del doc 01), y P7 y P10 se contestan.

---

## Fase 7 · Nivelación y pulido  — ~1,5 semanas

Nivelación heurística determinista (opcional, nunca automática), banco de rendimiento
en CI con alerta de regresión, backups y purga de ejecuciones, documentación de usuario.

**Terminado cuando:** los casos 30-32 y 39-40 pasan, y el banco de 5 000 tareas / 50
recursos se mantiene bajo 2 s en CI.

---

## Resumen

| Fase | Contenido | Esfuerzo | Valor entregado |
|------|-----------|----------|-----------------|
| 0 | Cimientos | 3 d | — |
| 1 | Calendarios | 1 sem | base de todo |
| 2 | Planificación CPM | 2 sem | fechas explicables |
| 3 | **Carga de trabajo** | 1,5 sem | **la herramienta ya sirve** |
| 4 | Edición y auditoría | 2 sem | autonomía total |
| 5 | Gantt y escenarios | 2 sem | decisiones informadas |
| 6 | Realidad y extensibilidad | 2 sem | adaptabilidad |
| 7 | Nivelación y pulido | 1,5 sem | acabado |
| | **Total** | **~12 semanas** | |

Con IA asistiendo de forma intensiva, las fases 0-3 (el núcleo que aporta el 80 % del
valor) son realistas en **4-5 semanas**.

## Riesgos y mitigación

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| La aritmética de calendario se subestima y contamina todo | **Alta** | Fase 1 aislada y cerrada antes de seguir; property-based testing |
| Crecimiento del alcance hacia «clon completo de Project» | **Alta** | Los no-objetivos del doc 01 son vinculantes; toda propuesta debe citar una de las 10 preguntas |
| La cuadrícula virtualizada rinde mal con datos reales | Media | Prototipo de rendimiento en fase 3 con volumen real, antes de invertir en la UI |
| Las derivaciones inflan la base de datos | Media | Sink desactivable, purga por política, sólo se conservan en congeladas |
| Migración de los datos actuales | Media | Importador CSV en fase 3; el sistema viejo se mantiene en paralelo hasta el fin de la fase 4 |
| Nivelación que nunca satisface a nadie | Baja | Está fuera del camino crítico, desactivada por defecto y declarada heurística |

## Migración desde el sistema actual

El sistema RAMS existente se conserva **en marcha y sin tocar** hasta terminar la fase 4.
La migración es un importador que mapea:

| Actual | Nuevo |
|--------|-------|
| `projects` | `project` |
| `work_packages` | `wbs_node` (`node_kind = 'work_package'`) |
| `work_packages.rams_tag` | `field_definition` + `field_value` |
| `work_packages.standard_effort_hours` | `task.standard_effort_minutes` (× 60) |
| `activities` | `wbs_node` (`task`) + `task` + `assignment` |
| `resources.contract_hours` | `calendar` derivado (35 h / 40 h) |
| `resources.monthly_availability_overrides` (JSONB) | filas de `resource_availability` |
| `change_logs` | `change_event` (histórico importado, marcado como tal) |

No se migran fechas calculadas: se recalculan. Es la prueba de fuego de que el motor
reproduce lo que el equipo ya da por bueno — y si no lo reproduce, el importador
muestra el diff tarea a tarea, que es información valiosa por sí misma.
