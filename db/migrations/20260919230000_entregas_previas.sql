-- migrate:up
-- ---------------------------------------------------------------------------
-- La Checkliste pide el mismo documento varias veces, y cada vez más maduro
-- ---------------------------------------------------------------------------
-- ADR-0027 metió en la ficha del entregable a qué puerta va y cuántas semanas
-- antes; ADR-0042 lo convirtió en fecha objetivo. Las dos daban por hecho que
-- un entregable se entrega **una vez**.
--
-- No es así. Las Checklisten oficiales piden el mismo documento en varias
-- versiones preliminares, en puertas anteriores, como prueba de madurez del
-- proyecto y para bajar el riesgo. El propio catálogo del equipo ya lo
-- contiene disfrazado: «Preliminary Maintainability Analysis Report» en PGR y
-- «Maintainability Prediction Report» en CGR son el mismo documento dos veces,
-- y el plan de demostración RAM aparece tres —as Designed, as Certified y
-- Final—.
--
-- La tentación era declarar cada versión como un entregable más. Serían 240
-- filas de catálogo en vez de 88, una matriz de 57.600 casillas en vez de
-- 7.744, y tres FMECA que mantener en lugar de uno. La madurez no es una
-- propiedad del documento: es del **par (documento, puerta)**, y quien la
-- declara es la Checkliste.

CREATE TABLE document_gate (
    document_type_id  UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    -- El orden de las entregas previas: 1 es la primera y más temprana.
    position          SMALLINT NOT NULL,
    -- La puerta a la que va ESTA entrega. El destino final sigue en
    -- `document_type.gate`: aquí sólo viven las anteriores, así que un catálogo
    -- sin ninguna fila se comporta exactamente como antes.
    gate              TEXT NOT NULL,
    -- Cómo se llama esa madurez en la Checkliste: «preliminar», «as designed»…
    -- Texto libre por el mismo motivo que la puerta: cada cliente tiene el suyo.
    maturity          TEXT NOT NULL,
    weeks_before_gate INTEGER,
    -- Qué parte del esfuerzo del entregable se hace para esta entrega, en
    -- puntos básicos. Lo que no reparten las entregas previas es lo que cuesta
    -- la final: el total del documento se declara UNA vez, en `standard_minutes`,
    -- y esto sólo dice cómo se parte. Es la misma regla que ADR-0039 — partir
    -- reparte, no vuelve a estimar.
    share_bp          INTEGER NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_type_id, position),
    CONSTRAINT document_gate_gate_check   CHECK (btrim(gate) <> ''),
    CONSTRAINT document_gate_weeks_check  CHECK (weeks_before_gate IS NULL OR weeks_before_gate >= 0),
    -- Una entrega previa que no cuesta nada no es una entrega, y una que se
    -- lleva el entregable entero no deja nada para la final.
    CONSTRAINT document_gate_share_check  CHECK (share_bp > 0 AND share_bp < 10000)
);

-- Dos entregas previas del mismo documento no pueden ir a la misma puerta:
-- sería pedir el mismo borrador dos veces en el mismo sitio.
CREATE UNIQUE INDEX document_gate_una_por_puerta
    ON document_gate (document_type_id, upper(btrim(gate)));

COMMENT ON TABLE document_gate IS
    'Las entregas PREVIAS de un documento: la Checkliste lo pide en borrador en puertas anteriores. La final vive en document_type.gate.';
COMMENT ON COLUMN document_gate.share_bp IS
    'Parte del esfuerzo del documento que cuesta esta entrega, en puntos básicos. Lo que sobra es la final.';

GRANT SELECT, INSERT, UPDATE, DELETE ON document_gate TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS document_gate;
