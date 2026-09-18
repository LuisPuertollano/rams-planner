-- migrate:up
-- ---------------------------------------------------------------------------
-- Qué subactividad del catálogo es cada tarea del plan
-- ---------------------------------------------------------------------------
-- ADR-0037 dejó declarado el catálogo —qué subactividades tiene cada entregable,
-- con qué rol y cuántos minutos— y dijo en voz alta lo que NO hacía: partir la
-- tarea del plan en su cadena. Esto es eso.
--
-- Partir una tarea no es un `INSERT`: la invariante W2 dice que un `task` no
-- puede tener hijos, así que la tarea pasa a ser `work_package`, su fila `task`
-- se va, y nacen sus hijos. Lo que hace falta guardar es de dónde viene cada
-- hijo, y es lo único que se guarda aquí.
--
-- Sirve para tres cosas, y las tres hacen falta:
--
--   1. **Que la operación sea repetible.** Sin esta marca no hay forma de saber
--      si una tarea ya se partió, y aplicarla dos veces partiría los trozos.
--   2. **Que la pantalla lo diga.** Una tarea llamada «FMECA · Revisar 1» sin
--      nada detrás es un nombre; con esto es una subactividad de un entregable
--      concreto, y se puede volver al catálogo desde el plan.
--   3. **Que se pueda deshacer.** Saber qué nodos nacieron de una expansión es
--      lo que permite recogerlos.

CREATE TABLE node_activity (
    node_id          UUID PRIMARY KEY REFERENCES wbs_node(id) ON DELETE CASCADE,
    -- De qué entregable es esta subactividad. No se borra en cascada desde el
    -- catálogo: retirar un entregable del catálogo no puede desmontar un plan
    -- que ya se calculó contra él.
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE RESTRICT,
    step             activity_step NOT NULL,
    position         SMALLINT NOT NULL DEFAULT 1,
    -- El nodo que era la tarea antes de partirse, y que ahora es su contenedor.
    -- Redundante —es el padre— y barato: permite recoger una expansión entera
    -- sin fiarse de que nadie haya movido el nodo de sitio por medio.
    expanded_from    UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT node_activity_position_check CHECK (position >= 1),
    -- Dos hijos de la misma expansión no pueden ser la misma subactividad.
    CONSTRAINT node_activity_unica UNIQUE (expanded_from, step, position)
);

CREATE INDEX ON node_activity (expanded_from);
CREATE INDEX ON node_activity (document_type_id);

COMMENT ON TABLE node_activity IS
    'Qué subactividad del catálogo es cada tarea nacida de partir un entregable. Es lo que hace la operación repetible y reversible.';
COMMENT ON COLUMN node_activity.expanded_from IS
    'El nodo que era la tarea y ahora es el contenedor de la cadena. Permite recoger una expansión entera.';

GRANT INSERT, UPDATE, DELETE ON node_activity TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS node_activity;
