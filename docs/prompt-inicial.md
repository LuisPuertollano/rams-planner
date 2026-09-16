# Prompt inicial

Este es el prompt con el que nació el repositorio: un enunciado autocontenido que
lleva dentro los objetivos, los principios, el stack, los puntos no negociables del
esquema, los doce pasos del motor y las puertas de cada fase.

Se conserva por dos razones. La primera es de auditoría: explica de dónde salen las
decisiones que hoy están en el código. La segunda es práctica: sirve para arrancar
una sesión de trabajo nueva sin tener que reconstruir el contexto.

La especificación desarrollada está en [`diseno/`](diseno/); el prompt es su resumen
ejecutable.

---

Construye desde cero una herramienta de planificación y cálculo de carga de trabajo
para un equipo de ingeniería RAMS ferroviaria que trabaja en varios proyectos a la vez.
El repositorio está vacío. No hay código heredado que respetar.

## Qué tiene que contestar la herramienta

Estas diez preguntas son el alcance. Lo que no sirva a ninguna, no se construye:

1. ¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto?
2. ¿Quién está por encima de su capacidad, cuándo y por cuánto?
3. ¿Por qué esta tarea empieza en esta fecha y no antes?
4. Si acepto este proyecto nuevo, ¿quién se satura y cuándo?
5. ¿En qué se diferencia el plan de hoy del que aprobamos hace tres meses?
6. ¿Cuánta capacidad libre tiene el equipo en el segundo semestre?
7. ¿Las horas realmente imputadas cuadran con lo planificado?
8. ¿Quién cambió esta estimación, cuándo y por qué?
9. ¿Qué pasa si una persona se va dos meses?
10. ¿Qué paquetes de trabajo se pasan sistemáticamente del esfuerzo estándar?

## Qué NO es

- No es un clon de Microsoft Project. No se busca fidelidad numérica con él.
- No se escribe el formato .mpp. El intercambio va por MS Project XML, Excel y CSV.
- No es un gestor de tareas del día a día. La unidad mínima es la tarea de varios
  días con esfuerzo estimado, no el ticket.
- No hay multi-tenant, ni facturación, ni portal de clientes.

## Los siete principios (prioridad sobre cualquier conveniencia de implementación)

**P1. Lo declarado y lo derivado no se tocan.** Ningún campo que escribe el usuario
puede sobrescribirlo el motor, y ningún campo que calcula el motor puede editarlo el
usuario. Viven en tablas distintas, con roles de base de datos distintos: el rol de la
API no tiene escritura sobre las tablas de resultados; el rol del motor no la tiene
sobre las tablas declaradas. Para fijar una fecha no se edita la fecha calculada: se
declara una restricción, que es un dato de entrada.

**P2. El motor es una función pura y determinista.** `calculate(snapshot, opciones)`
sin I/O, sin `Date.now()`, sin `Math.random()`, sin dependencia del orden de iteración.
Todos los desempates son explícitos y llegan hasta el UUID. Mismo snapshot ⇒ mismo
resultado, bit a bit, hoy y dentro de tres años.

**P3. Todo resultado pertenece a una ejecución identificada.** No existen «los datos
calculados»; existen los calculados en la ejecución X, con versión de motor y hash de
entradas. Las ejecuciones se conservan, se comparan y se congelan. Una línea base no es
un tipo de dato especial: es una ejecución congelada con nombre.

**P4. Todo número derivado sabe explicarse.** Cada valor calculado emite su derivación
—qué regla lo produjo y con qué entradas— como salida de primera clase del motor, no
como logging. La UI lo expone como un árbol navegable hasta los datos declarados.

**P5. Aritmética entera.** Tiempo en minutos laborables (entero). Dinero en céntimos
(entero). Porcentajes en puntos base (10000 = 100 %). Nada de horas decimales ni coma
flotante en el núcleo. Los redondeos ocurren en un único sitio documentado, en
presentación.

**P6. El esquema modela conceptos, no pantallas.** Un único árbol WBS recursivo, no una
jerarquía rígida de tres niveles. Los atributos de dominio (tag RAMS, nivel SIL, centro
de coste) son campos personalizados definidos como datos, no columnas.

**P7. El historial es inmutable y de sólo añadir.** `DELETE` es `deleted_at`. Cada
mutación genera un evento append-only con actor, momento, antes, después y motivo.
Nadie, ni la aplicación, tiene `UPDATE` ni `DELETE` sobre ese log.

## Stack

- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  Node 22 LTS, monorepo pnpm + Turborepo.
- PostgreSQL 16. Se usan `daterange`, `EXCLUDE USING gist`, particionado, CTE recursivas.
- Acceso a datos con SQL explícito (`pg` + Kysely). **Sin ORM**: el valor del producto
  está en cinco consultas de agregación y tienen que ser legibles y auditables.
- Migraciones con dbmate, aplicadas por un job separado, nunca por el arranque del server.
- API Fastify, contrato OpenAPI generado desde Zod, cliente TypeScript generado.
- Frontend React 19 + Vite + TanStack Query/Table/Virtual. Gantt propio sobre Canvas/SVG
  (los componentes comerciales traen su propio modelo de datos y reintroducen la mezcla
  que P1 prohíbe).
- Tests: Vitest, fast-check para propiedades, golden files JSON versionados.
- Despliegue: Docker Compose (postgres, migrate, api, web, worker).

Arquitectura hexagonal. Paquetes del núcleo — `domain`, `calendar`, `scheduler`,
`workload`, `explain`, `rules` — sin I/O, sin framework, sin base de datos. Adaptadores
— `persistence`, `api`, `cli`, `interop` — alrededor. Las dependencias apuntan hacia
dentro y CI lo verifica. El núcleo se empaqueta también para el navegador (web worker),
de modo que la previsualización interactiva use el mismo motor y no un segundo motor
aproximado que dé números distintos.

## Modelo de datos, lo esencial

Cuatro zonas con reglas de escritura distintas:

- **Declarado**: `project`, `wbs_node`, `task`, `dependency`, `assignment`, `resource`,
  `calendar` + `calendar_week_slot` + `calendar_exception`, `resource_availability`,
  `absence`, `resource_cost_rate`, `field_definition`, `field_value`.
- **Derivado**: `calculation_run`, `task_result`, `assignment_timephased`,
  `resource_capacity_timephased`, `finding`, `derivation`, `baseline`.
- **Real**: `actual_entry`, `progress_update`.
- **Historial**: `change_event` (append-only).

Puntos que no son negociables:

- `wbs_node` es un árbol recursivo con `node_kind` (`phase` | `work_package` | `task` |
  `milestone`) y `path` materializado. Los contenedores no se estiman: sus cifras son la
  agregación derivada de sus hijos. Los datos de planificación viven en una tabla `task`
  1:1 que sólo tienen las hojas.
- `resource_availability(resource_id, valid_period DATERANGE, units_bp)` con
  `EXCLUDE USING gist (resource_id WITH =, valid_period WITH &&)`. Nada de JSONB de
  disponibilidad: no se consulta, no se indexa, no se valida el solape y el log sólo
  puede decir «el JSON cambió».
- `assignment_timephased(run_id, assignment_id, work_date, planned_minutes,
  leveled_minutes)` a **grano diario**, particionada por año. Toda vista mensual,
  semanal, por proyecto o por competencia es una agregación de esta tabla. Una sola
  fuente: dos pantallas no pueden contradecirse.
- `calculation_run` guarda `engine_version` e `input_hash` (sha256 de la serialización
  canónica del snapshot). Si el hash no cambió, no se recalcula.
- Las tarifas y los patrones semanales de calendario tienen vigencia. Nunca un valor
  único eterno.

## El motor, en orden

1. **Compilar calendarios**. Índice denso de minutos laborables por día sobre el
   horizonte, con suma acumulada: `workingMinutesBetween`, `addWorkingMinutes`,
   `snapToWorkingTime`, todas O(log n). Herencia de calendarios con detección de ciclos.
   Resolución para una tarea: calendario de la tarea → del recurso asignado único → del
   proyecto → base, y se registra cuál se usó. Con varios recursos de calendarios
   distintos, la tarea usa el del proyecto y cada asignación se distribuye con el de su
   recurso.
2. **Validar el grafo**. Orden topológico (Kahn). Un ciclo no se rompe automáticamente:
   se enumera completo, se emite un hallazgo bloqueante y el cálculo se detiene.
3. **Ecuación de la tarea**: `trabajo = duración × unidades`. `task_type`
   (`fixed_work` | `fixed_duration` | `fixed_units`) determina qué magnitud queda
   anclada; `is_effort_driven` determina qué pasa al añadir o quitar un recurso. Todo
   recálculo que altere un valor declarado emite una derivación y un aviso explícito en
   la UI. Nunca en silencio.
4. **Paso adelante** (early start/finish) con enlaces FS/SS/FF/SF y desfase en minutos
   laborables del calendario del sucesor.
5. **Restricciones**, por precedencia: `must_*` (duras, y si contradicen una dependencia
   se emite conflicto y la restricción gana, visible) → `*_no_earlier_than` →
   `*_no_later_than` → `alap` → `asap`. El `deadline` es **blando**: no mueve nada, sólo
   genera hallazgo. Esta distinción se explica en la UI cada vez que el usuario
   introduce una fecha.
6. **Paso atrás**, holgura total y libre, criticidad con umbral configurable.
7. **Agregar contenedores**. El avance se agrega ponderado por trabajo, nunca como media
   aritmética de porcentajes.
8. **Distribución temporal**. Perfiles de contorno (`flat`, `front_loaded`,
   `back_loaded`, `bell`, `turtle`, `manual`). Reparto entero por **restos mayores** con
   desempate por fecha ascendente, garantizando `Σ reparto ≡ total` exactamente.
9. **Capacidad y saturación**: `calendario ∩ disponibilidad ∩ ausencias`, acotado a 0.
   Por día, y agregado a mes. Se muestran ambos niveles: un recurso equilibrado al mes
   puede estar al 300 % tres días concretos.
10. **Nivelación**: heurística determinista, **desactivada por defecto**, que escribe en
    `leveled_minutes` y nunca sobre `planned_minutes`. Orden: prioridad de proyecto,
    holgura total, inicio temprano, UUID.
11. **Costes** con la tarifa vigente del día.
12. **Reglas y hallazgos**. Las reglas de aviso son datos (AST JSON validado por
    esquema), no código. Códigos: `DEPENDENCY_CYCLE`, `CONSTRAINT_CONFLICT`,
    `RESOURCE_OVERALLOCATED`, `RESOURCE_NO_CAPACITY`, `DEADLINE_MISSED`,
    `BUDGET_EXCEEDED`, `TASK_UNASSIGNED`, `LEVELING_IMPOSSIBLE`.

Los campos calculados y las condiciones de las reglas se evalúan con un intérprete
propio y acotado: AST validado, operadores en lista blanca, límite de pasos, sin acceso
a red ni a globales. **Nunca `eval` ni `new Function`.**

## Decisiones ya tomadas

Cámbialas si no te convencen, pero no las dejes ambiguas:

- **Interfaz en español**, con i18n desde el primer día (añadirla después es caro).
  Identificadores de código, base de datos y API en inglés.
- **Autenticación**: local con sesiones, y OIDC detrás de una interfaz para conectar
  luego un SSO. No inventes un sistema de permisos elaborado: roles `admin`, `planner`,
  `viewer`.
- **Imputaciones de horas**: se importan (CSV/Excel). No se construye un módulo de
  partes de horas — es otro producto.
- **Costes**: el esquema los contempla desde el principio; la UI de costes se aplaza.
- **Concurrencia**: optimista con `ETag` / `If-Match` por entidad, sin edición
  colaborativa en tiempo real.
- Zona horaria por defecto `Europe/Berlin`; calendario base con festivos de
  Baden-Württemberg.

## Cómo quiero que trabajes

Por fases, **parando en cada puerta** para que yo revise antes de seguir. No adelantes
trabajo de fases posteriores.

- **Fase 0 — Cimientos.** Monorepo, TypeScript estricto, Vitest, ESLint, CI (build,
  test, cobertura, verificación de la regla de dependencia entre paquetes), Docker
  Compose con Postgres, dbmate, esquema aplicado y datos semilla.
  *Puerta:* `pnpm test` verde en CI y `docker compose up` levanta la base de datos
  migrada.

- **Fase 1 — Calendarios.** `@planner/calendar` completo.
  *Puerta:* ≥ 10 propiedades de fast-check en verde (ida y vuelta de
  `addWorkingMinutes`/`workingMinutesBetween`, monotonía, invarianza ante el orden de
  carga de excepciones), cobertura de ramas ≥ 95 %, y golden files de: tarea de 1 minuto
  en día parcial, tarea que arranca al cierre de jornada, tarea que cruza Navidad, tarea
  que cruza un cambio de patrón semanal, herencia de tres niveles, excepción con jornada
  más larga de lo normal.
  *No empieces la fase 2 hasta que esta esté cerrada.* Es la que más se subestima y
  ninguna decisión posterior la corrige.

- **Fase 2 — Planificación.** `@planner/scheduler` con `@planner/explain` desde la
  primera línea; añadir las derivaciones después es reescribir el motor.
  *Puerta:* `planner calc snapshot.json` funciona desde la CLI y el árbol de explicación
  se genera para cualquier fecha calculada.

- **Fase 3 — Carga de trabajo.** `@planner/workload`, persistencia de ejecuciones, API
  mínima, y en la web la **matriz de carga** (recurso → proyecto → tarea × mes, con
  capacidad y saturación) y el **mapa de calor**.
  *Puerta:* con datos reales cargados por CSV, la matriz contesta las preguntas 1, 2 y 6,
  y cualquier celda se explica hasta el dato declarado.

Reglas de trabajo:

- Escribe los tests del núcleo **antes** que la implementación. El corpus de golden
  files es la red de seguridad de todo el proyecto: si un golden file cambia, el diff se
  revisa a mano.
- Cada valor derivado que devuelva la API viene acompañado del `runId` que lo produjo.
  Un número sin `runId` es un bug, porque no se puede auditar.
- Prohibido `any` sin comentario justificando por qué. Usa tipos nominales por unidad
  (`WorkMinutes`, `BasisPoints`, `Cents`) para que el compilador impida mezclarlas.
- Commits pequeños y descriptivos. Un PR por fase.
- Cuando una decisión de diseño tenga alternativas reales, escribe un ADR corto en
  `docs/adr/` antes de implementar: contexto, decisión, alternativas descartadas, coste
  aceptado.
- Si algo del enunciado te parece equivocado, dilo antes de implementarlo, con tu
  propuesta. No lo implementes «como te lo han pedido» si crees que está mal.

Empieza por la fase 0. Cuando la cierres, párate y enséñame qué hay antes de seguir.
