-- migrate:up
-- ---------------------------------------------------------------------------
-- La Checkliste no es una lista de entregables: es el cuestionario de la puerta
-- ---------------------------------------------------------------------------
-- ADR-0056 dio por hecho que la Checkliste oficial era la lista de
-- entregable × madurez × puerta, y la hoja de verdad —RSA-RS-FRM-004 v1.3—
-- demostró que no. Su propia consulta 0.5 pregunta si los entregables están
-- «as per the maturity defined in the deliverable list in the Safety plan», y
-- la hoja de referencias remite al DTRF. Esa lista vive en el plan de
-- seguridad, que es lo que el catálogo ya contiene, y por eso ADR-0056 no
-- declaró ninguna tabla.
--
-- Lo que la hoja SÍ contiene, y aquí no había, es otra cosa:
--
--   * 51 **consultas** agrupadas en capítulos (Requirements, Design Solution,
--     Safety Demonstration & Closure, Suppliers, V&V…).
--   * Por cada par (consulta, puerta), el **nivel** con que se exige —M
--     mandatory, HR highly recommended, R recommended, C confirm— y el texto de
--     la **prueba que se pide**. 255 casillas, 162 con texto.
--   * Y en 27 de las 51, el **entregable** que la consulta nombra: «Is the
--     organic FMECA issued or updated?». Ése es el enganche que permite
--     contestar la consulta desde el plan en vez de a mano.
--
-- ## Por qué tres tablas y no la hoja tal cual
--
-- En Excel esto es una rejilla de consultas por puertas, y la puerta elegida se
-- escoge en un desplegable que alimenta un VLOOKUP con el número de columna
-- calculado a mano:
--
--     N1 = SUM(IF(cabecera = puerta_elegida; 3..7; 0))
--     I6 = VLOOKUP(G6; 'Safety Gate info'!$N$4:$T$62; N1; FALSO)
--
-- Es un pivote hecho a mano porque una hoja de cálculo no sabe hacer un join.
-- Cuesta lo que cuesta siempre: añadir una puerta es añadir una columna y
-- repasar las 51 fórmulas, y una consulta nueva en medio descoloca el rango.
--
-- Aquí el desplegable y el VLOOKUP son `WHERE gate = $1`. Añadir una puerta es
-- insertar filas.
--
-- ## Lo que NO entra en el repositorio
--
-- El contenido de la Checkliste es un documento controlado del departamento.
-- Aquí va el modelo y su importador; las 51 consultas se cargan por CSV en cada
-- instalación, igual que el catálogo de entregables (ADR-0027).

CREATE TABLE gate_query (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- `safety`, `ram`… Cada disciplina tiene su hoja y su juego de consultas, y
    -- las dos se revisan en las mismas puertas. Texto libre por el mismo motivo
    -- que la puerta: el juego de disciplinas es de cada casa.
    discipline   TEXT NOT NULL,
    -- El capítulo tal cual lo numera la hoja: '0', '1'… con su nombre.
    chapter      TEXT NOT NULL,
    chapter_name TEXT,
    -- El identificador de la consulta dentro de su hoja: '3.5'. Es el que usa
    -- la gente al hablar —«el 3.5 está abierto»— así que se guarda como texto
    -- y no se renumera.
    code         TEXT NOT NULL,
    question     TEXT NOT NULL,
    -- El orden de la hoja. Un cuestionario leído fuera de orden no se contesta.
    sort_key     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gate_query_discipline_check CHECK (btrim(discipline) <> ''),
    CONSTRAINT gate_query_code_check       CHECK (btrim(code) <> ''),
    CONSTRAINT gate_query_question_check   CHECK (btrim(question) <> '')
);

-- El código identifica la consulta dentro de su disciplina, y es por donde
-- casa el CSV al volver a importarlo: cargar dos veces la misma hoja tiene que
-- dejar 51 consultas, no 102.
CREATE UNIQUE INDEX gate_query_codigo_unico
    ON gate_query (lower(btrim(discipline)), upper(btrim(code)));

COMMENT ON TABLE gate_query IS
    'Una consulta de la Checkliste de revisión: la pregunta que se hace en la puerta, no el entregable que se entrega.';

CREATE TABLE gate_query_gate (
    query_id      UUID NOT NULL REFERENCES gate_query(id) ON DELETE CASCADE,
    gate          TEXT NOT NULL,
    -- Con cuánta fuerza se exige en ESTA puerta. La misma consulta es
    -- recomendada en IGR y obligatoria en CGR, y eso es la mitad de lo que
    -- dice la hoja.
    level         TEXT NOT NULL,
    -- «Questions / Proof Request»: qué hay que enseñar para darla por buena.
    -- Cambia con la puerta, y ése es justo el motivo del VLOOKUP de la hoja.
    proof_request TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (query_id, gate),
    CONSTRAINT gate_query_gate_gate_check  CHECK (btrim(gate) <> ''),
    -- Cerrado a propósito: un nivel escrito mal no puede quedarse como un
    -- valor más que nadie sabe ordenar. M > HR > R > C.
    CONSTRAINT gate_query_gate_level_check CHECK (level IN ('M', 'HR', 'R', 'C'))
);

CREATE UNIQUE INDEX gate_query_gate_unico
    ON gate_query_gate (query_id, upper(btrim(gate)));

COMMENT ON COLUMN gate_query_gate.level IS
    'M mandatory · HR highly recommended · R recommended · C confirm. Una consulta que no aparece en una puerta no se pregunta allí.';

-- El enganche: esta consulta habla de este entregable, en esta madurez.
--
-- Es lo que convierte el cuestionario en algo que el plan puede contestar
-- solo. «Is the organic FMECA issued or updated?» en CGR es una pregunta que
-- la herramienta ya sabe responder: sabe si el FMECA está en el plan, en qué
-- versión y si llega a la puerta. Las que no nombran ningún entregable
-- —aproximadamente la mitad— son exactamente las que tiene que contestar una
-- persona, y eso también es información.
CREATE TABLE gate_query_document (
    query_id         UUID NOT NULL REFERENCES gate_query(id) ON DELETE CASCADE,
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    -- Qué versión del documento contesta la consulta. NULL es la final, con el
    -- mismo criterio que `node_delivery.maturity`: la final no tiene nombre de
    -- madurez porque es el documento.
    maturity         TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NULL no se compara consigo mismo, así que la clave se normaliza: sin esto,
-- «el FMECA final» se podría declarar dos veces en la misma consulta.
CREATE UNIQUE INDEX gate_query_document_unico
    ON gate_query_document (query_id, document_type_id, upper(btrim(COALESCE(maturity, ''))));

CREATE INDEX gate_query_document_documento_idx ON gate_query_document (document_type_id);

COMMENT ON TABLE gate_query_document IS
    'La consulta de la Checkliste nombra este entregable: el enganche que deja contestarla desde el plan.';

GRANT SELECT, INSERT, UPDATE, DELETE ON gate_query          TO planner_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON gate_query_gate     TO planner_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON gate_query_document TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS gate_query_document;
DROP TABLE IF EXISTS gate_query_gate;
DROP TABLE IF EXISTS gate_query;
