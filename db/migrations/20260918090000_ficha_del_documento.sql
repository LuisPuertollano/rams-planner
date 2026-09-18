-- migrate:up
-- ---------------------------------------------------------------------------
-- La ficha del entregable: lo que hace falta para que el catálogo valga
-- ---------------------------------------------------------------------------
-- Hasta ahora un `document_type` era un código, un nombre y una descripción.
-- Suficiente para dibujar una matriz de nueve filas; insuficiente para traer
-- un catálogo EN 50126 de verdad, donde cada entregable llega con su tipo, su
-- disciplina, la puerta a la que va, cuántas semanas antes se termina, el
-- esfuerzo estándar y el código con el que se ficha.
--
-- Todo es **declarado** (P1): lo escribe una persona y el motor no lo corrige.
-- Todo es opcional: un equipo que sólo quiere nombres y flechas sigue pudiendo.

-- Un catálogo real mezcla tres cosas que se comportan distinto, y llamarlas a
-- todas «documento» obliga a adivinar mirando el nombre.
CREATE TYPE document_kind AS ENUM ('documento', 'hito', 'fase');

ALTER TABLE document_type
    -- Un hito es un instante y una fase agrupa; un documento se entrega. Ojo:
    -- un hito SÍ puede traer esfuerzo, y el dato real lo dejó claro. Una puerta
    -- de revisión cuesta las horas de su propia reunión (16 h en el catálogo
    -- que provocó esto), y prohibirlo habría sido una regla inventada.
    ADD COLUMN kind              document_kind NOT NULL DEFAULT 'documento',
    -- Safety, RAM, ILS, Sistemas… El filtro con el que un catálogo de ochenta
    -- filas se vuelve mirable. Texto libre a propósito: cada equipo tiene las
    -- suyas y una enumeración obligaría a migrar para añadir una.
    ADD COLUMN discipline        TEXT,
    -- La puerta de certificación a la que va el entregable (TTG, IGR, IQA…).
    ADD COLUMN gate              TEXT,
    -- Semanas antes de esa puerta en las que tiene que estar terminado. Es la
    -- regla del DocFlowChart, y aquí entra como DATO: el motor todavía no la
    -- usa para calcular fechas, y cuando lo haga será una decisión aparte.
    ADD COLUMN weeks_before_gate INTEGER,
    -- El esfuerzo típico, en minutos (P5: el minuto es la unidad). Sirve para
    -- sembrar la tarea que lo entrega sin que nadie lo teclee otra vez.
    ADD COLUMN standard_minutes  INTEGER,
    -- El código con el que se ficha en el sistema de partes de horas.
    ADD COLUMN task_code         TEXT,
    ADD CONSTRAINT document_type_weeks_check
        CHECK (weeks_before_gate IS NULL OR weeks_before_gate >= 0),
    ADD CONSTRAINT document_type_minutes_check
        CHECK (standard_minutes IS NULL OR standard_minutes >= 0);

COMMENT ON COLUMN document_type.kind IS
    'Documento (se entrega), hito (un instante) o fase (agrupa). Cambia cómo se lee la fila.';
COMMENT ON COLUMN document_type.weeks_before_gate IS
    'Semanas antes de la puerta en que debe estar terminado. Dato declarado; el motor todavía no lo usa.';
COMMENT ON COLUMN document_type.standard_minutes IS
    'Esfuerzo típico en minutos. Un hito también puede traerlo: la puerta de revisión cuesta la reunión.';

-- Los filtros de la pantalla son estos dos. Con ochenta filas ya se nota.
CREATE INDEX document_type_discipline_idx ON document_type (discipline) WHERE deleted_at IS NULL;
CREATE INDEX document_type_gate_idx       ON document_type (gate)       WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS document_type_gate_idx;
DROP INDEX IF EXISTS document_type_discipline_idx;
ALTER TABLE document_type
    DROP CONSTRAINT IF EXISTS document_type_minutes_check,
    DROP CONSTRAINT IF EXISTS document_type_weeks_check,
    DROP COLUMN IF EXISTS task_code,
    DROP COLUMN IF EXISTS standard_minutes,
    DROP COLUMN IF EXISTS weeks_before_gate,
    DROP COLUMN IF EXISTS gate,
    DROP COLUMN IF EXISTS discipline,
    DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS document_kind;
