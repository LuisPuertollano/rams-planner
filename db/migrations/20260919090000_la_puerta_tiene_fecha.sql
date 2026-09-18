-- migrate:up
-- ---------------------------------------------------------------------------
-- La puerta tiene fecha, y la fecha es del proyecto
-- ---------------------------------------------------------------------------
-- ADR-0027 dejó en la ficha del entregable a qué puerta va (`gate`) y cuántas
-- semanas antes tiene que estar terminado (`weeks_before_gate`), y escribió que
-- el motor todavía no lo usaba. Le faltaba la mitad del dato: **cuándo ocurre
-- esa puerta**, que no es del catálogo sino de cada proyecto. El catálogo dice
-- «el FMECA va a CGR»; el proyecto dice «mi CGR es el 14 de mayo de 2028».
--
-- Por eso no puede ser una columna de `document_type`: el mismo entregable va a
-- la misma puerta en todos los proyectos, y la puerta cae en un día distinto en
-- cada uno.

CREATE TABLE project_gate (
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    -- El nombre de la puerta, tal cual lo escribe el catálogo: TTG, IGR, CGR,
    -- IQA, FQA… Texto libre por el mismo motivo que `document_type.gate`: cada
    -- cliente tiene su juego de puertas y una enumeración obligaría a migrar
    -- para añadir una.
    gate        TEXT NOT NULL,
    gate_date   DATE NOT NULL,
    -- Para qué es esta puerta, cuando las siglas no bastan.
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, gate),
    CONSTRAINT project_gate_name_check CHECK (btrim(gate) <> '')
);

-- La puerta casa con el catálogo por su nombre, y «cgr» y «CGR» son la misma
-- puerta escrita por dos personas distintas. Que convivan las dos filas haría
-- que la mitad de los entregables encontraran fecha y la otra mitad no, sin que
-- nada lo dijera. Se prohíbe aquí y no se arregla luego adivinando.
CREATE UNIQUE INDEX project_gate_nombre_unico ON project_gate (project_id, upper(btrim(gate)));

COMMENT ON TABLE project_gate IS
    'Cuándo cae cada puerta de certificación en ESTE proyecto. La otra mitad de document_type.gate.';
COMMENT ON COLUMN project_gate.gate IS
    'El nombre de la puerta, escrito igual que en document_type.gate. Es por ahí por donde casan.';

GRANT SELECT, INSERT, UPDATE, DELETE ON project_gate TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS project_gate;
