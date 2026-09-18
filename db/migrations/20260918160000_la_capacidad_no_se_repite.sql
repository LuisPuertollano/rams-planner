-- migrate:up
-- ---------------------------------------------------------------------------
-- La capacidad de una ejecución se guarda una vez, no una vez por ejecución
-- ---------------------------------------------------------------------------
-- Se guarda TODO el historial y se seguirá guardando: una ejecución tiene que
-- poder reproducirse dentro de dos años, y para eso la capacidad contra la que
-- se calculó tiene que estar entera, día a día. La decisión no cambia. Lo que
-- cambia es dejar de escribir el mismo bloque una vez tras otra.
--
-- Medido en una instalación de demostración con seis personas y tres cálculos
-- seguidos sin tocar ningún calendario:
--
--     huella                             filas   ejecución
--     04c9fc4a6d4a35c18b319061445d7c17    6018   52de9bc1…
--     04c9fc4a6d4a35c18b319061445d7c17    6018   87378417…
--     04c9fc4a6d4a35c18b319061445d7c17    6018   98cd4254…
--
-- La misma huella tres veces: 3 MB para guardar tres copias idénticas. Y no es
-- casualidad. **La capacidad no depende del plan.** Sale del calendario de la
-- persona, de sus ausencias y de sus factores de indirecto y reserva. Mover una
-- tarea recalcula el plan entero y no mueve ni un minuto de capacidad.
--
-- Así que se guarda por su contenido: un `capacity_set` identificado por la
-- huella de sus celdas, y cada ejecución apuntando al suyo. Dos ejecuciones con
-- la misma capacidad comparten el bloque; en cuanto alguien cambia un
-- calendario, la huella cambia y nace un bloque nuevo. Es exactamente lo que ya
-- hace `calculation_run.input_hash` con la instantánea del plan.
--
-- Sin pérdida y sin cambiar ninguna consulta: la vista `resource_capacity_
-- timephased` sigue existiendo con la misma forma, y quien pregunta por la
-- capacidad de una ejecución sigue preguntando igual.

CREATE TABLE capacity_set (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- md5 de las celdas en orden canónico. Es la identidad del bloque: dos
    -- bloques con la misma huella son el mismo bloque, byte a byte.
    content_hash TEXT NOT NULL,
    -- Cuántas celdas tiene. Redundante y barato: permite ver de un vistazo si
    -- un bloque es el de veinticinco personas o el de una.
    cell_count   INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT capacity_set_hash_key   UNIQUE (content_hash),
    CONSTRAINT capacity_set_count_check CHECK (cell_count >= 0)
);

COMMENT ON TABLE capacity_set IS
    'Un bloque de capacidad identificado por su contenido. Varias ejecuciones comparten el suyo mientras nadie toque un calendario.';

CREATE TABLE capacity_cell (
    capacity_set_id  UUID NOT NULL REFERENCES capacity_set(id) ON DELETE CASCADE,
    resource_id      UUID NOT NULL REFERENCES resource(id)     ON DELETE CASCADE,
    work_date        DATE NOT NULL,
    capacity_minutes INTEGER NOT NULL,
    gross_minutes    INTEGER,
    PRIMARY KEY (capacity_set_id, resource_id, work_date)
);

COMMENT ON TABLE capacity_cell IS
    'La capacidad de una persona un día, dentro de un bloque. El motor sólo escribe días laborables: un día sin fila no tiene capacidad.';

ALTER TABLE calculation_run
    ADD COLUMN capacity_set_id UUID REFERENCES capacity_set(id);

COMMENT ON COLUMN calculation_run.capacity_set_id IS
    'El bloque de capacidad contra el que se calculó. Nulo sólo si la ejecución no tuvo ninguna celda.';

-- --------------------------------------------------------------------------
-- Mudanza de lo que ya hay, sin perder una sola celda
-- --------------------------------------------------------------------------
-- La huella se calcula AQUÍ con la misma expresión que usará el escritor, para
-- que una ejecución vieja y una nueva con la misma capacidad compartan bloque
-- en vez de quedarse cada una con el suyo.

CREATE TEMPORARY TABLE huella_por_ejecucion ON COMMIT DROP AS
SELECT c.run_id,
       md5(string_agg(
             c.resource_id::text || '|' || c.work_date::text || '|' ||
             c.capacity_minutes::text || '|' || COALESCE(c.gross_minutes::text, ''),
             E'\n' ORDER BY c.resource_id, c.work_date)) AS content_hash,
       count(*) AS cell_count
FROM resource_capacity_timephased c
GROUP BY c.run_id;

INSERT INTO capacity_set (content_hash, cell_count)
SELECT DISTINCT content_hash, cell_count FROM huella_por_ejecucion
ON CONFLICT (content_hash) DO NOTHING;

UPDATE calculation_run r
   SET capacity_set_id = s.id
  FROM huella_por_ejecucion h
  JOIN capacity_set s ON s.content_hash = h.content_hash
 WHERE r.id = h.run_id;

-- Las celdas, una sola vez por bloque. `DISTINCT ON` elige una ejecución
-- cualquiera de las que comparten huella: por definición todas traen lo mismo.
INSERT INTO capacity_cell (capacity_set_id, resource_id, work_date, capacity_minutes, gross_minutes)
SELECT s.id, c.resource_id, c.work_date, c.capacity_minutes, c.gross_minutes
FROM (
    SELECT DISTINCT ON (content_hash) content_hash, run_id
    FROM huella_por_ejecucion ORDER BY content_hash, run_id
) elegida
JOIN capacity_set s ON s.content_hash = elegida.content_hash
JOIN resource_capacity_timephased c ON c.run_id = elegida.run_id;

-- Dos vistas del esquema inicial cuelgan de la tabla. Se tiran y se vuelven a
-- crear IDÉNTICAS sobre la vista nueva: lo que cambia es de dónde salen las
-- celdas, no lo que significan.
DROP VIEW v_monthly_utilization;
DROP VIEW v_monthly_capacity;

DROP TABLE resource_capacity_timephased;

-- La vista conserva la forma de siempre: quien pregunta por la capacidad de una
-- ejecución no tiene por qué saber que el bloque está compartido.
CREATE VIEW resource_capacity_timephased AS
SELECT r.id AS run_id, c.resource_id, c.work_date, c.capacity_minutes, c.gross_minutes
FROM calculation_run r
JOIN capacity_cell c ON c.capacity_set_id = r.capacity_set_id;

COMMENT ON VIEW resource_capacity_timephased IS
    'La capacidad de cada ejecución, con la forma de siempre. Detrás, el bloque está compartido entre las ejecuciones que tienen la misma.';

CREATE VIEW v_monthly_capacity AS
SELECT  run_id,
        resource_id,
        date_trunc('month', work_date)::date AS month,
        SUM(capacity_minutes)                AS capacity_minutes
FROM    resource_capacity_timephased
GROUP BY 1,2,3;

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

GRANT SELECT ON resource_capacity_timephased, v_monthly_capacity, v_monthly_utilization TO planner_api;
GRANT INSERT, UPDATE, DELETE ON capacity_set, capacity_cell TO planner_api;

-- migrate:down
-- El orden importa: las dos vistas del esquema inicial cuelgan de
-- `resource_capacity_timephased`, así que caen antes que ella.
DROP VIEW IF EXISTS v_monthly_utilization;
DROP VIEW IF EXISTS v_monthly_capacity;
DROP VIEW IF EXISTS resource_capacity_timephased;

CREATE TABLE resource_capacity_timephased (
    run_id           UUID NOT NULL REFERENCES calculation_run(id) ON DELETE CASCADE,
    resource_id      UUID NOT NULL REFERENCES resource(id)        ON DELETE CASCADE,
    work_date        DATE NOT NULL,
    capacity_minutes INTEGER NOT NULL,
    gross_minutes    INTEGER,
    PRIMARY KEY (run_id, resource_id, work_date)
);

INSERT INTO resource_capacity_timephased (run_id, resource_id, work_date, capacity_minutes, gross_minutes)
SELECT r.id, c.resource_id, c.work_date, c.capacity_minutes, c.gross_minutes
FROM calculation_run r
JOIN capacity_cell c ON c.capacity_set_id = r.capacity_set_id;

CREATE VIEW v_monthly_capacity AS
SELECT  run_id,
        resource_id,
        date_trunc('month', work_date)::date AS month,
        SUM(capacity_minutes)                AS capacity_minutes
FROM    resource_capacity_timephased
GROUP BY 1,2,3;

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

GRANT INSERT, UPDATE, DELETE ON resource_capacity_timephased TO planner_api;
GRANT SELECT ON v_monthly_capacity, v_monthly_utilization TO planner_api;

ALTER TABLE calculation_run DROP COLUMN IF EXISTS capacity_set_id;
DROP TABLE IF EXISTS capacity_cell;
DROP TABLE IF EXISTS capacity_set;
