-- migrate:up
-- ---------------------------------------------------------------------------
-- La tarea se parte en las entregas que pide la Checkliste
-- ---------------------------------------------------------------------------
-- ADR-0046 dejó la Checkliste declarada —qué documento piden en qué puertas y
-- con qué parte del esfuerzo— y dijo que no movía ninguna fecha. Esto es lo que
-- la mueve: la tarea que entrega el FMECA se convierte en un paquete con una
-- tarea por entrega, cada una con su puerta y su trozo.
--
-- Es hermana de `node_activity` (ADR-0039) y va un nivel POR ENCIMA: primero se
-- parte en entregas, y cada entrega se puede partir después en su cadena de
-- crear y revisar. Al revés no significa nada — «crear el preliminar» y «crear
-- el final» no son dos pasos de una cadena, son dos entregas.

CREATE TABLE node_delivery (
    node_id          UUID PRIMARY KEY REFERENCES wbs_node(id) ON DELETE CASCADE,
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    -- 0 es la más temprana; la última es la final.
    position         SMALLINT NOT NULL,
    -- La puerta de ESTA entrega, que no es la del documento salvo en la final.
    -- Vive aquí y no se deduce, porque es de lo que sale su fecha objetivo y un
    -- dato derivado que hay que recalcular para leerlo no es un dato.
    gate             TEXT,
    weeks_before_gate INTEGER,
    -- Cómo la llama la Checkliste. NULL en la final: la final no tiene nombre
    -- de madurez, es el documento.
    maturity         TEXT,
    is_final         BOOLEAN NOT NULL,
    -- De qué tarea salió, para poder decir que ya está partida.
    expanded_from    UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT node_delivery_weeks_check
        CHECK (weeks_before_gate IS NULL OR weeks_before_gate >= 0)
);

CREATE INDEX node_delivery_expanded_from_idx ON node_delivery (expanded_from);
CREATE INDEX node_delivery_document_idx      ON node_delivery (document_type_id);

-- Una tarea partida tiene exactamente una entrega final: la que hereda el
-- entregable y a la que espera el documento siguiente.
CREATE UNIQUE INDEX node_delivery_una_final
    ON node_delivery (expanded_from) WHERE is_final;

COMMENT ON TABLE node_delivery IS
    'Esta tarea es UNA entrega de un documento: su versión en una puerta concreta. Hermana de node_activity, un nivel por encima.';
COMMENT ON COLUMN node_delivery.gate IS
    'La puerta de esta entrega. De aquí sale su fecha objetivo, no de la del documento.';

GRANT SELECT, INSERT, UPDATE, DELETE ON node_delivery TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS node_delivery;
