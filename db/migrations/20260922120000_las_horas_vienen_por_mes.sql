-- migrate:up
-- ---------------------------------------------------------------------------
-- Las horas reales vienen por mes y por proyecto, no por tarea
-- ---------------------------------------------------------------------------
-- `actual_entry` supone algo que el sistema de fichaje no sabe: contra qué
-- TAREA se ficharon las horas. SAP CATS —y cualquier otro— sabe «Ana imputó
-- 40 h al proyecto CBTC en abril» y nada más. La tarea no está en el dato.
--
-- El libro del equipo resolvió esto hace años, y bien, con tres piezas:
--
--   CATS export          lo que dice el sistema: persona, proyecto, mes, horas
--   Actuals_Declaration  lo que declara la persona: «de mis horas de abril en
--                        CBTC, el 60 % fue al FMECA y el 40 % al Hazard Log»
--   Declaration_CHECK    la matriz persona × mes que dice si eso cuadra
--
-- Aquí entran las dos primeras como tablas —son dato declarado, P1— y la
-- tercera se calcula, porque es derivada.
--
-- La tarea sale de multiplicar: horas del mes × porcentaje declarado. Y el
-- invariante que sostiene todo esto es **que ningún minuto se pierda por el
-- camino**: cada minuto que entra o cae en una tarea o sale nombrado en un
-- descuadre.
--
-- Por eso un reparto que no suma 10000 no se aplica a medias. El reparto es
-- proporcional, así que una declaración que sólo cubre el 60 % no dejaría el
-- 40 % fuera: le daría a esa tarea las horas ENTERAS del mes, incluidas las que
-- se fueron a algo que nadie declaró. Se queda fuera entero y se dice.

-- Lo que dice el sistema de fichaje. Sin tarea, porque no la trae.
CREATE TABLE actual_month (
    resource_id  UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES project(id)  ON DELETE CASCADE,
    -- Siempre el día 1: es un mes, no un día, y guardarlo como fecha permite
    -- ordenarlo y acotarlo sin trocear cadenas.
    period       DATE NOT NULL,
    minutes      INTEGER NOT NULL CHECK (minutes >= 0),
    -- El identificador que traía el fichero, para poder rastrear una fila
    -- hasta su origen sin abrir el export.
    external_ref TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID REFERENCES app_user(id),
    PRIMARY KEY (resource_id, project_id, period),
    CONSTRAINT actual_month_es_un_mes CHECK (EXTRACT(DAY FROM period) = 1)
);
CREATE INDEX ON actual_month (project_id, period);

COMMENT ON TABLE actual_month IS
    'Horas reales tal y como las da el sistema de fichaje: persona, proyecto y mes. La tarea no viene en el dato.';

-- Lo que declara la persona sobre ese mes.
CREATE TABLE actual_split (
    resource_id UUID NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES project(id)  ON DELETE CASCADE,
    period      DATE NOT NULL,
    node_id     UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    -- Mayor que cero: un reparto del 0 % no es un reparto, es una fila que
    -- alguien se dejó puesta.
    share_bp    INTEGER NOT NULL CHECK (share_bp > 0 AND share_bp <= 10000),
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID REFERENCES app_user(id),
    PRIMARY KEY (resource_id, project_id, period, node_id),
    CONSTRAINT actual_split_es_un_mes CHECK (EXTRACT(DAY FROM period) = 1)
);
CREATE INDEX ON actual_split (node_id);

COMMENT ON TABLE actual_split IS
    'De las horas de esa persona en ese proyecto y ese mes, qué parte fue a cada tarea. La suma tiene que dar 10000.';
COMMENT ON COLUMN actual_split.share_bp IS
    'Puntos básicos: 10000 = el 100 % de las horas del mes. La suma por (persona, proyecto, mes) tiene que ser exactamente 10000.';

GRANT SELECT, INSERT, UPDATE, DELETE ON actual_month TO planner_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON actual_split TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS actual_split;
DROP TABLE IF EXISTS actual_month;
