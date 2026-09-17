-- migrate:up
-- ---------------------------------------------------------------------------
-- Documentos y la matriz de precedencias entre ellos
-- ---------------------------------------------------------------------------
-- El plan de un proyecto de seguridad es, en el fondo, una lista de entregables
-- y el orden en que se pueden hacer: el Hazard Log preliminar antes que el
-- FMECA, el FMECA antes que el Safety Case. Ese orden no cambia de proyecto a
-- proyecto —lo fija la norma y la forma de trabajar del equipo—, pero hasta
-- ahora había que volver a dibujarlo a mano en cada plan nuevo.
--
-- Aquí se declara una vez: qué documentos existen y cuál es condición necesaria
-- de cuál. Un proyecto concreto dice qué tarea produce qué documento, y de esas
-- dos cosas salen las dependencias sin que nadie las teclee.
--
-- Por qué no se reutiliza `rams_tag`: la disciplina es una etiqueta para
-- agrupar y filtrar —una tarea de «Plan» no produce necesariamente un
-- documento— y un documento es una cosa que se entrega y que otra espera. Que
-- hoy los nombres se parezcan no los hace lo mismo, igual que pasó con las
-- competencias.

CREATE TABLE document_type (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    -- El orden en que se enseñan en la matriz. Con el ciclo de vida delante,
    -- una matriz ordenada por fase se lee sola.
    sort_key    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX document_type_code_key ON document_type (code) WHERE deleted_at IS NULL;

COMMENT ON TABLE document_type IS
    'Catálogo de entregables del equipo. La fila y la columna de la matriz de precedencias.';

-- ---------------------------------------------------------------------------
-- La matriz: la fila es condición necesaria de la columna
-- ---------------------------------------------------------------------------
CREATE TABLE document_precedence (
    -- El de la fila: lo que tiene que estar antes.
    predecessor_id  UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    -- El de la columna: lo que espera.
    successor_id    UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (predecessor_id, successor_id),
    -- La diagonal no significa nada: un documento no se espera a sí mismo.
    CHECK (predecessor_id <> successor_id)
);
CREATE INDEX ON document_precedence (successor_id);

COMMENT ON TABLE document_precedence IS
    'A es condición necesaria de B. Se declara una vez y vale para todos los proyectos.';

-- ---------------------------------------------------------------------------
-- Qué documento produce cada tarea
-- ---------------------------------------------------------------------------
-- N:N a propósito: una tarea de consolidación entrega varios documentos, y un
-- documento grande se reparte entre varias tareas. Obligar a uno solo daría un
-- modelo más limpio y planes que no se pueden escribir.
CREATE TABLE node_document (
    node_id          UUID NOT NULL REFERENCES wbs_node(id)     ON DELETE CASCADE,
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, document_type_id)
);
CREATE INDEX ON node_document (document_type_id);

COMMENT ON TABLE node_document IS
    'La tarea entrega este documento. Es lo que conecta la matriz con un plan concreto.';

GRANT INSERT, UPDATE, DELETE ON document_type, document_precedence, node_document TO planner_api;

-- El catálogo se deja vacío a propósito: los entregables son los del equipo que
-- instala esto, no los que se le ocurran a quien escribe la migración. La
-- pantalla lo dice y se llena desde ahí. Los datos de demostración sí traen un
-- juego, para que la matriz se pueda ver funcionando.

-- migrate:down
DROP TABLE IF EXISTS node_document;
DROP TABLE IF EXISTS document_precedence;
DROP TABLE IF EXISTS document_type;
