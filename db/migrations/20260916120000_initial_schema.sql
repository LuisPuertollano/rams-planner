-- migrate:up
-- Esquema inicial. Ver docs/esquema.md para el porqué de cada decisión.

-- =============================================================================
-- RAMS Planner — esquema de referencia (PostgreSQL 16+)
-- =============================================================================
-- Convenciones, sin excepciones:
--   * snake_case en todo.
--   * Tiempo de trabajo: minutos laborables, INTEGER. Nunca horas decimales.
--   * Porcentajes: puntos base, INTEGER (10000 = 100,00 %).
--   * Dinero: céntimos, BIGINT + código de moneda ISO.
--   * Momentos: TIMESTAMPTZ en UTC. Fechas de calendario: DATE (sin zona).
--   * Claves primarias: UUID (gen_random_uuid). PostgreSQL 16 no trae uuidv7.
--   * Borrado: soft delete (deleted_at). Nada se pierde (principio P7).
--   * Lo DECLARADO vive en tablas sin sufijo; lo DERIVADO vive en tablas con
--     sufijo _result / _timephased y SIEMPRE cuelga de calculation_run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ---------------------------------------------------------------------------
-- 0. Tipos enumerados
-- ---------------------------------------------------------------------------
CREATE TYPE resource_kind      AS ENUM ('person','team','material','cost');
CREATE TYPE node_kind          AS ENUM ('phase','work_package','task','milestone');
CREATE TYPE task_type          AS ENUM ('fixed_work','fixed_duration','fixed_units');
CREATE TYPE constraint_kind    AS ENUM ('asap','alap',
                                        'start_no_earlier_than','start_no_later_than',
                                        'finish_no_earlier_than','finish_no_later_than',
                                        'must_start_on','must_finish_on');
CREATE TYPE dependency_kind    AS ENUM ('FS','SS','FF','SF');
CREATE TYPE contour_kind       AS ENUM ('flat','front_loaded','back_loaded','bell','turtle','manual');
CREATE TYPE scenario_kind      AS ENUM ('working','baseline','whatif');
CREATE TYPE run_status         AS ENUM ('running','succeeded','failed','superseded');
CREATE TYPE finding_severity   AS ENUM ('blocking','error','warning','info');
CREATE TYPE field_data_type    AS ENUM ('text','number','integer','date','boolean','single_select','multi_select','duration','money');
CREATE TYPE actual_source      AS ENUM ('timesheet','import','manual','estimate');
CREATE TYPE absence_kind       AS ENUM ('vacation','sick','training','parental','public_holiday','other');
CREATE TYPE audit_operation    AS ENUM ('insert','update','delete','restore');

-- ---------------------------------------------------------------------------
-- 1. Identidad y auditoría transversal
-- ---------------------------------------------------------------------------
CREATE TABLE app_user (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Log append-only. Fuente de verdad del historial (principio P7).
-- Se escribe por trigger genérico; nadie tiene UPDATE/DELETE sobre esta tabla.
CREATE TABLE change_event (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id        UUID REFERENCES app_user(id),
    request_id      UUID,                 -- agrupa todos los cambios de una operación
    operation       audit_operation NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    before_value    JSONB,
    after_value     JSONB,
    comment         TEXT                  -- "por qué", capturado en la UI
);
CREATE INDEX ON change_event (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ON change_event (request_id);
CREATE INDEX ON change_event (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Calendarios — la unidad de medida del sistema
-- ---------------------------------------------------------------------------
CREATE TABLE calendar (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,       -- 'base_de', 'base_bw', 'ana_80'
    name            TEXT NOT NULL,
    parent_id       UUID REFERENCES calendar(id),  -- herencia; NULL = calendario raíz
    timezone        TEXT NOT NULL DEFAULT 'Europe/Berlin',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (id <> parent_id)
);

-- Patrón semanal CON VIGENCIA: la jornada puede cambiar en el tiempo.
-- weekday: 1 = lunes ... 7 = domingo (ISO-8601).
CREATE TABLE calendar_week_slot (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id     UUID NOT NULL REFERENCES calendar(id) ON DELETE CASCADE,
    valid_from      DATE NOT NULL,
    valid_to        DATE,                       -- NULL = sin fin
    weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_minute    SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute      SMALLINT NOT NULL CHECK (end_minute   BETWEEN 0 AND 1440),
    CHECK (end_minute > start_minute),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ON calendar_week_slot (calendar_id, weekday, valid_from);

-- Excepciones: festivos, cierres, jornadas especiales.
-- is_working = FALSE  -> día no laborable, se ignoran los intervalos.
-- is_working = TRUE   -> jornada especial definida por calendar_exception_slot.
CREATE TABLE calendar_exception (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id     UUID NOT NULL REFERENCES calendar(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    date_from       DATE NOT NULL,
    date_to         DATE NOT NULL,
    is_working      BOOLEAN NOT NULL DEFAULT FALSE,
    recurrence_rule TEXT,                      -- RFC 5545 RRULE, opcional
    CHECK (date_to >= date_from)
);
CREATE INDEX ON calendar_exception (calendar_id, date_from, date_to);

CREATE TABLE calendar_exception_slot (
    exception_id    UUID NOT NULL REFERENCES calendar_exception(id) ON DELETE CASCADE,
    start_minute    SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute      SMALLINT NOT NULL CHECK (end_minute   BETWEEN 0 AND 1440),
    PRIMARY KEY (exception_id, start_minute),
    CHECK (end_minute > start_minute)
);

-- ---------------------------------------------------------------------------
-- 3. Recursos, disponibilidad y coste
-- ---------------------------------------------------------------------------
CREATE TABLE resource (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    resource_kind   resource_kind NOT NULL DEFAULT 'person',
    calendar_id     UUID REFERENCES calendar(id),
    user_id         UUID REFERENCES app_user(id),  -- si la persona usa la herramienta
    max_units_bp    INTEGER NOT NULL DEFAULT 10000 CHECK (max_units_bp >= 0),
    active_from     DATE,
    active_to       DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from)
);

-- Disponibilidad con vigencia. Sustituye al JSONB de overrides mensuales:
-- consultable, indexable, auditable y sin solapes (EXCLUDE).
CREATE TABLE resource_availability (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id     UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    valid_period    DATERANGE NOT NULL,
    units_bp        INTEGER NOT NULL CHECK (units_bp BETWEEN 0 AND 20000),
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    EXCLUDE USING gist (resource_id WITH =, valid_period WITH &&)   -- invariante R1
);

CREATE TABLE absence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id     UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    absence_kind    absence_kind NOT NULL,
    date_from       DATE NOT NULL,
    date_to         DATE NOT NULL,
    minutes_per_day INTEGER,                  -- NULL = día completo
    note            TEXT,
    CHECK (date_to >= date_from)
);
CREATE INDEX ON absence (resource_id, date_from, date_to);

CREATE TABLE resource_cost_rate (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id         UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    valid_period        DATERANGE NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'EUR',
    standard_cents_hour BIGINT NOT NULL CHECK (standard_cents_hour >= 0),
    overtime_cents_hour BIGINT,
    EXCLUDE USING gist (resource_id WITH =, valid_period WITH &&)
);

CREATE TABLE skill (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code    TEXT NOT NULL UNIQUE,
    name    TEXT NOT NULL
);

CREATE TABLE resource_skill (
    resource_id  UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    skill_id     UUID NOT NULL REFERENCES skill(id)    ON DELETE CASCADE,
    level        SMALLINT CHECK (level BETWEEN 1 AND 5),
    PRIMARY KEY (resource_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- 4. Estructura de trabajo — un único árbol WBS
-- ---------------------------------------------------------------------------
CREATE TABLE portfolio (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name    TEXT NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE project (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id    UUID REFERENCES portfolio(id),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    calendar_id     UUID REFERENCES calendar(id),
    status_start    DATE NOT NULL,             -- fecha de referencia del proyecto
    priority        INTEGER NOT NULL DEFAULT 500,  -- desempate determinista en nivelación
    currency        CHAR(3) NOT NULL DEFAULT 'EUR',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Árbol recursivo. `path` es materializado ('001.004.002') para ordenar y
-- consultar subárboles sin CTE recursiva en las rutas calientes.
CREATE TABLE wbs_node (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES wbs_node(id) ON DELETE CASCADE,
    node_kind       node_kind NOT NULL,
    code            TEXT,                      -- código WBS visible, editable
    path            TEXT NOT NULL,             -- materializado, mantenido por la app
    sort_key        INTEGER NOT NULL,
    name            TEXT NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CHECK (id <> parent_id),
    UNIQUE (project_id, path)
);
CREATE INDEX ON wbs_node (project_id, parent_id, sort_key);
CREATE INDEX ON wbs_node (project_id, path text_pattern_ops);

-- Datos de planificación SÓLO de hojas (task | milestone). Invariante W3.
CREATE TABLE task (
    node_id                 UUID PRIMARY KEY REFERENCES wbs_node(id) ON DELETE CASCADE,
    task_type               task_type NOT NULL DEFAULT 'fixed_work',
    is_effort_driven        BOOLEAN NOT NULL DEFAULT TRUE,
    duration_minutes        INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
    work_declared_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (work_declared_minutes >= 0),
    calendar_id             UUID REFERENCES calendar(id),  -- override de calendario
    constraint_kind         constraint_kind NOT NULL DEFAULT 'asap',
    constraint_date         DATE,
    deadline                DATE,                          -- blando: sólo genera hallazgo
    percent_complete_bp     INTEGER NOT NULL DEFAULT 0 CHECK (percent_complete_bp BETWEEN 0 AND 10000),
    remaining_work_minutes  INTEGER,                       -- NULL = derivar de %
    standard_effort_minutes INTEGER,                       -- referencia de benchmarking
    is_milestone            BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (NOT is_milestone OR (duration_minutes = 0 AND work_declared_minutes = 0)),
    CHECK (constraint_kind IN ('asap','alap') OR constraint_date IS NOT NULL)
);

CREATE TABLE dependency (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predecessor_node_id UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    successor_node_id   UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    dependency_kind     dependency_kind NOT NULL DEFAULT 'FS',
    lag_minutes         INTEGER NOT NULL DEFAULT 0,   -- puede ser negativo (adelanto)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (predecessor_node_id <> successor_node_id),
    UNIQUE (predecessor_node_id, successor_node_id)
);
CREATE INDEX ON dependency (successor_node_id);

-- ---------------------------------------------------------------------------
-- 5. Asignaciones — donde nace la carga
-- ---------------------------------------------------------------------------
CREATE TABLE assignment (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id                 UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    resource_id             UUID NOT NULL REFERENCES resource(id) ON DELETE RESTRICT,
    units_bp                INTEGER NOT NULL DEFAULT 10000 CHECK (units_bp >= 0),
    work_declared_minutes   INTEGER CHECK (work_declared_minutes >= 0), -- NULL = derivar
    contour_kind            contour_kind NOT NULL DEFAULT 'flat',
    window_from             DATE,      -- ventana parcial dentro de la tarea
    window_to               DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,
    UNIQUE (node_id, resource_id),                              -- invariante A1
    CHECK (window_to IS NULL OR window_from IS NULL OR window_to >= window_from)
);
CREATE INDEX ON assignment (resource_id);

-- Contorno manual: el usuario dibuja el reparto día a día.
CREATE TABLE assignment_manual_contour (
    assignment_id   UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    work_date       DATE NOT NULL,
    minutes         INTEGER NOT NULL CHECK (minutes >= 0),
    PRIMARY KEY (assignment_id, work_date)
);

-- ---------------------------------------------------------------------------
-- 6. Escenarios y ejecuciones de cálculo
-- ---------------------------------------------------------------------------
CREATE TABLE scenario (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    scenario_kind   scenario_kind NOT NULL DEFAULT 'working',
    parent_id       UUID REFERENCES scenario(id),   -- 'whatif' hereda de otro
    description     TEXT,
    is_frozen       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (id <> parent_id)
);

CREATE TABLE scenario_project (
    scenario_id UUID NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    PRIMARY KEY (scenario_id, project_id)
);

-- Overrides de un escenario what-if sobre los datos declarados.
-- Se aplican al construir el snapshot; los datos originales no se tocan.
CREATE TABLE scenario_override (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id     UUID NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL,      -- 'task' | 'assignment' | 'resource_availability' | ...
    entity_id       UUID,               -- NULL = alta nueva en el escenario
    patch           JSONB NOT NULL,     -- { "work_declared_minutes": 4800 }
    note            TEXT
);
CREATE INDEX ON scenario_override (scenario_id, entity_type);

CREATE TABLE calculation_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id         UUID NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    engine_version      TEXT NOT NULL,          -- semver del motor, p.ej. '1.4.2'
    input_hash          TEXT NOT NULL,          -- sha256 del snapshot canónico
    horizon_from        DATE NOT NULL,
    horizon_to          DATE NOT NULL,
    status              run_status NOT NULL DEFAULT 'running',
    triggered_by        UUID REFERENCES app_user(id),
    trigger_reason      TEXT,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    duration_ms         INTEGER,
    stats               JSONB,                  -- nº tareas, nº hallazgos, etc.
    is_frozen           BOOLEAN NOT NULL DEFAULT FALSE   -- TRUE si es línea base
);
CREATE INDEX ON calculation_run (scenario_id, started_at DESC);
CREATE INDEX ON calculation_run (input_hash);   -- reutilizar run idéntico = caché

-- Una línea base es una ejecución congelada con nombre. Nada más.
CREATE TABLE baseline (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculation_run_id  UUID NOT NULL UNIQUE REFERENCES calculation_run(id),
    name                TEXT NOT NULL,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_by         UUID REFERENCES app_user(id),
    note                TEXT
);

-- ---------------------------------------------------------------------------
-- 7. Resultados derivados — NUNCA editables por el usuario
-- ---------------------------------------------------------------------------
CREATE TABLE task_result (
    run_id              UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    node_id             UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    early_start         TIMESTAMPTZ NOT NULL,
    early_finish        TIMESTAMPTZ NOT NULL,
    late_start          TIMESTAMPTZ NOT NULL,
    late_finish         TIMESTAMPTZ NOT NULL,
    scheduled_start     TIMESTAMPTZ NOT NULL,   -- tras restricciones y nivelación
    scheduled_finish    TIMESTAMPTZ NOT NULL,
    duration_minutes    INTEGER NOT NULL,
    work_minutes        INTEGER NOT NULL,
    total_slack_minutes INTEGER NOT NULL,
    free_slack_minutes  INTEGER NOT NULL,
    leveling_delay_min  INTEGER NOT NULL DEFAULT 0,
    is_critical         BOOLEAN NOT NULL,
    cost_cents          BIGINT NOT NULL DEFAULT 0,
    calendar_used_id    UUID REFERENCES calendar(id),  -- trazabilidad (P4)
    PRIMARY KEY (run_id, node_id)
);

-- LA TABLA CENTRAL: carga distribuida por día. Todo lo demás la agrega.
CREATE TABLE assignment_timephased (
    run_id              UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    assignment_id       UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
    work_date           DATE NOT NULL,
    planned_minutes     INTEGER NOT NULL CHECK (planned_minutes >= 0),
    leveled_minutes     INTEGER NOT NULL CHECK (leveled_minutes >= 0),
    cost_cents          BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, assignment_id, work_date)
) PARTITION BY RANGE (work_date);
-- Particionado anual; el gestor de particiones las crea al vuelo.

CREATE TABLE resource_capacity_timephased (
    run_id              UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    resource_id         UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    work_date           DATE NOT NULL,
    capacity_minutes    INTEGER NOT NULL CHECK (capacity_minutes >= 0),  -- invariante R2
    PRIMARY KEY (run_id, resource_id, work_date)
);

CREATE TABLE finding (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    severity        finding_severity NOT NULL,
    code            TEXT NOT NULL,            -- 'RESOURCE_OVERALLOCATED', 'DEPENDENCY_CYCLE'...
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    occurs_on       DATE,
    message         TEXT NOT NULL,
    payload         JSONB                     -- datos para que la UI enlace y explique
);
CREATE INDEX ON finding (run_id, severity, code);
CREATE INDEX ON finding (run_id, entity_type, entity_id);

-- Traza de derivación: la respuesta a "¿por qué este número?" (principio P4).
CREATE TABLE derivation (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL,            -- 'task_result.scheduled_start'
    target_id       UUID NOT NULL,
    rule_code       TEXT NOT NULL,            -- 'FS_LINK', 'CONSTRAINT_SNET', 'CALENDAR_SNAP'
    inputs          JSONB NOT NULL,           -- referencias a los datos declarados usados
    output_value    JSONB NOT NULL
);
CREATE INDEX ON derivation (run_id, target_type, target_id);

-- ---------------------------------------------------------------------------
-- 8. Realidad ejecutada
-- ---------------------------------------------------------------------------
CREATE TABLE actual_entry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id         UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    resource_id     UUID NOT NULL REFERENCES resource(id) ON DELETE RESTRICT,
    work_date       DATE NOT NULL,
    minutes         INTEGER NOT NULL CHECK (minutes >= 0),
    source          actual_source NOT NULL DEFAULT 'manual',
    external_ref    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID REFERENCES app_user(id),
    UNIQUE (node_id, resource_id, work_date, source)
);
CREATE INDEX ON actual_entry (resource_id, work_date);

CREATE TABLE progress_update (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id                 UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    as_of_date              DATE NOT NULL,
    percent_complete_bp     INTEGER CHECK (percent_complete_bp BETWEEN 0 AND 10000),
    remaining_work_minutes  INTEGER CHECK (remaining_work_minutes >= 0),
    reported_by             UUID REFERENCES app_user(id),
    note                    TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON progress_update (node_id, as_of_date DESC);

-- ---------------------------------------------------------------------------
-- 9. Extensibilidad: campos personalizados y etiquetas
-- ---------------------------------------------------------------------------
CREATE TABLE field_definition (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type         TEXT NOT NULL,        -- 'wbs_node' | 'project' | 'resource' | 'assignment'
    field_key           TEXT NOT NULL,
    label               TEXT NOT NULL,
    data_type           field_data_type NOT NULL,
    options             JSONB,                -- para *_select
    is_required         BOOLEAN NOT NULL DEFAULT FALSE,
    validation          JSONB,
    is_computed         BOOLEAN NOT NULL DEFAULT FALSE,
    expression          TEXT,                 -- DSL propio, evaluado en sandbox (sin eval)
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (entity_type, field_key),
    CHECK (NOT is_computed OR expression IS NOT NULL)
);

CREATE TABLE field_value (
    field_id        UUID NOT NULL REFERENCES field_definition(id) ON DELETE CASCADE,
    entity_id       UUID NOT NULL,
    value_text      TEXT,
    value_number    NUMERIC(18,6),
    value_integer   BIGINT,
    value_date      DATE,
    value_boolean   BOOLEAN,
    value_json      JSONB,                    -- multi_select
    PRIMARY KEY (field_id, entity_id)
);
CREATE INDEX ON field_value (entity_id);

CREATE TABLE tag (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name    TEXT NOT NULL UNIQUE,
    color   TEXT
);

CREATE TABLE taggable (
    tag_id      UUID NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id   UUID NOT NULL,
    PRIMARY KEY (tag_id, entity_type, entity_id)
);

-- Reglas de aviso declarativas: los umbrales son DATOS, no código.
CREATE TABLE rule_definition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    severity        finding_severity NOT NULL DEFAULT 'warning',
    scope           TEXT NOT NULL,            -- 'resource_day' | 'task' | 'project_month'
    condition       JSONB NOT NULL,           -- AST de la condición, validado por esquema
    message_template TEXT NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- 10. Vistas de consulta (la única fuente de las cifras que ve el usuario)
-- ---------------------------------------------------------------------------

-- Carga mensual por recurso, proyecto y mes — contesta P1 directamente.
CREATE VIEW v_monthly_load AS
SELECT  tp.run_id,
        a.resource_id,
        n.project_id,
        date_trunc('month', tp.work_date)::date  AS month,
        SUM(tp.planned_minutes)                  AS planned_minutes,
        SUM(tp.leveled_minutes)                  AS leveled_minutes,
        SUM(tp.cost_cents)                       AS cost_cents
FROM    assignment_timephased tp
JOIN    assignment a ON a.id = tp.assignment_id
JOIN    wbs_node   n ON n.id = a.node_id
GROUP BY 1,2,3,4;

-- Capacidad mensual por recurso.
CREATE VIEW v_monthly_capacity AS
SELECT  run_id,
        resource_id,
        date_trunc('month', work_date)::date AS month,
        SUM(capacity_minutes)                AS capacity_minutes
FROM    resource_capacity_timephased
GROUP BY 1,2,3;

-- Saturación: la vista que dispara los avisos. Contesta P2 y P6.
CREATE VIEW v_monthly_utilization AS
SELECT  c.run_id,
        c.resource_id,
        c.month,
        c.capacity_minutes,
        COALESCE(SUM(l.planned_minutes), 0)  AS planned_minutes,
        c.capacity_minutes - COALESCE(SUM(l.planned_minutes), 0) AS free_minutes,
        CASE WHEN c.capacity_minutes = 0 THEN NULL
             ELSE ROUND(10000.0 * COALESCE(SUM(l.planned_minutes),0) / c.capacity_minutes)::int
        END AS utilization_bp
FROM        v_monthly_capacity c
LEFT JOIN   v_monthly_load     l
       ON   l.run_id = c.run_id AND l.resource_id = c.resource_id AND l.month = c.month
GROUP BY c.run_id, c.resource_id, c.month, c.capacity_minutes;

-- Plan vs. real por mes. Contesta P7.
CREATE VIEW v_plan_vs_actual AS
SELECT  n.project_id,
        ae.resource_id,
        date_trunc('month', ae.work_date)::date AS month,
        SUM(ae.minutes) AS actual_minutes
FROM    actual_entry ae
JOIN    wbs_node n ON n.id = ae.node_id
GROUP BY 1,2,3;

-- ---------------------------------------------------------------------------
-- 11. Particiones de la tabla de carga distribuida
-- ---------------------------------------------------------------------------
-- assignment_timephased es la tabla grande (~100k filas por ejecución). Se
-- particiona por año para que purgar ejecuciones antiguas sea barato.

CREATE OR REPLACE FUNCTION ensure_assignment_timephased_partition(p_year INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_name TEXT := format('assignment_timephased_%s', p_year);
BEGIN
    IF to_regclass(v_name) IS NULL THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF assignment_timephased FOR VALUES FROM (%L) TO (%L)',
            v_name,
            make_date(p_year, 1, 1),
            make_date(p_year + 1, 1, 1)
        );
    END IF;
    RETURN v_name;
END;
$$;

COMMENT ON FUNCTION ensure_assignment_timephased_partition(INTEGER) IS
    'Crea la partición anual si no existe. Idempotente: la llama el worker al ampliar el horizonte.';

DO $$
DECLARE
    v_year INTEGER;
BEGIN
    FOR v_year IN 2024..2035 LOOP
        PERFORM ensure_assignment_timephased_partition(v_year);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Comentarios que explican las decisiones menos obvias
-- ---------------------------------------------------------------------------
COMMENT ON TABLE  assignment_timephased IS
    'Carga distribuida a grano diario. Toda vista semanal/mensual/trimestral la agrega: una sola fuente, ninguna contradicción entre pantallas.';
COMMENT ON TABLE  calculation_run IS
    'Unidad de auditoría (P3). Todo resultado derivado cuelga de aquí, con versión de motor y hash de entradas.';
COMMENT ON TABLE  derivation IS
    'Traza de derivación (P4): qué regla produjo cada valor y con qué entradas. Se purga por política salvo en ejecuciones congeladas.';
COMMENT ON TABLE  baseline IS
    'Una línea base es una ejecución congelada con nombre. No hay columnas baseline1_*, baseline2_*...';
COMMENT ON COLUMN task.deadline IS
    'Fecha objetivo BLANDA: no mueve la tarea, sólo genera un hallazgo DEADLINE_MISSED. Para mover, se usa constraint_kind.';
COMMENT ON COLUMN resource_availability.units_bp IS
    'Puntos base: 10000 = 100 %. El EXCLUDE impide periodos solapados para el mismo recurso (invariante R1).';

-- migrate:down
DROP VIEW IF EXISTS v_plan_vs_actual, v_monthly_utilization, v_monthly_capacity, v_monthly_load;
DROP FUNCTION IF EXISTS ensure_assignment_timephased_partition(INTEGER);
DROP TABLE IF EXISTS rule_definition, taggable, tag, field_value, field_definition,
    progress_update, actual_entry, derivation, finding,
    resource_capacity_timephased, assignment_timephased, task_result,
    baseline, calculation_run, scenario_override, scenario_project, scenario,
    assignment_manual_contour, assignment, dependency, task, wbs_node, project, portfolio,
    resource_skill, skill, resource_cost_rate, absence, resource_availability, resource,
    calendar_exception_slot, calendar_exception, calendar_week_slot, calendar,
    change_event, app_user CASCADE;
DROP TYPE IF EXISTS audit_operation, absence_kind, actual_source, field_data_type,
    finding_severity, run_status, scenario_kind, contour_kind, dependency_kind,
    constraint_kind, task_type, node_kind, resource_kind;
