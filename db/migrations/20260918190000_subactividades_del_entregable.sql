-- migrate:up
-- ---------------------------------------------------------------------------
-- Un entregable no es una tarea: es una cadena de subactividades
-- ---------------------------------------------------------------------------
-- Hasta ahora un documento era una casilla de la matriz y, en el plan, una
-- tarea. Quien lo escribe y quien lo revisa eran la misma barra del cronograma
-- y el mismo montón de horas. El libro con el que el equipo planifica de verdad
-- —hoja `Gantt`— no lo cuenta así: cada documento aparece **varias veces**, una
-- por subactividad, y cada una tiene su rol, sus horas y su predecesora.
--
--     Type  Description            Mission  Role      Work h   d.item
--     T     (S) Safety-Bid/BECO    C        S-Eng       50     (MSt) PROJECT Start
--     T     (S) Safety-Bid/BECO    R1       TL RAMS     10     (S) Safety-Bid/BECO - C
--     T     (S) Safety-CbC         C        S-Eng      100     (S) Safety-Bid/BECO - R1
--
-- Tres cosas que se leen ahí y que la herramienta no sabía:
--
--   1. **La revisión es trabajo de otro, y va después.** 50 h de autor y 10 h
--      de jefe, no 60 h de una persona. La proporción se repite en todo el
--      libro: mediana de 40 h creando contra 10 h revisando.
--   2. **El siguiente documento no espera al anterior entero: espera a su
--      última revisión.** De 299 dependencias entre documentos del libro, la
--      forma dominante es `C ← R1`. Un plan que hace esperar a la creación del
--      sucesor hasta el final del predecesor alarga el proyecto por un tramo
--      que nadie ha pedido.
--   3. **El soporte no es un documento.** `S` aparece en filas propias —gestión
--      de seguridad, formación, acompañamiento al ISA— con miles de horas y sin
--      ninguna creación delante. No entrega nada y no bloquea a nadie.
--
-- Esto declara el **catálogo**: qué subactividades tiene cada entregable, con
-- qué rol y cuántos minutos. Aplicarlo a un proyecto concreto —partir la tarea
-- en su cadena y atar las dependencias— es el paso siguiente y va aparte: una
-- migración que además cambiara las cifras de todas las pantallas sería dos
-- decisiones metidas en una.

-- Los cinco papeles del libro, y sólo esos. `Canc.` no está: una subactividad
-- cancelada no se declara en el catálogo, se borra de él; cancelar es un hecho
-- de un proyecto, no de cómo trabaja el equipo.
--
-- Por qué `review_1/2/3` y no un contador de vueltas: en el libro **no son
-- rondas, son niveles**. Hay documentos con C+R2 y sin R1 —los que escribe otro
-- departamento y RAMS sólo revisa en segundo nivel— y hay C+R3 sin R2. Un
-- número de ronda no podría saltarse el 1.
CREATE TYPE activity_step AS ENUM ('create', 'review_1', 'review_2', 'review_3', 'support');

CREATE TABLE document_activity (
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    step             activity_step NOT NULL,
    -- Dos personas en el mismo nivel de revisión, o dos roles soportando la
    -- misma actividad. Igual que en `document_signature`, y por lo mismo.
    position         SMALLINT NOT NULL DEFAULT 1,
    -- El nombre del rol tal y como lo escribe el equipo: «S-Eng», «TL RAMS»,
    -- «R-Eng». Texto libre y no una enumeración, por la misma razón que
    -- `discipline` y que `document_signature.role`.
    role             TEXT NOT NULL,
    -- Lo que cuesta esa subactividad, en minutos (P5). Opcional: un catálogo a
    -- medio rellenar es el estado normal de un catálogo el primer día.
    standard_minutes INTEGER,
    -- ------------------------------------------------------------------
    -- Qué firma descarga esta subactividad, si descarga alguna
    -- ------------------------------------------------------------------
    -- ADR-0032 dejó escrito que los minutos de una firma «no entran en la carga
    -- de nadie». Este es el puente: cuando la revisión de nivel 1 ES la
    -- verificación que firma el verificador, se dice aquí, y esos minutos dejan
    -- de estar sueltos. Nulo a propósito y en la mayoría de los casos: RAMS
    -- revisando el documento de otro departamento no firma nada nuestro.
    signature_step     signature_step,
    signature_position SMALLINT,
    PRIMARY KEY (document_type_id, step, position),
    CONSTRAINT document_activity_position_check CHECK (position >= 1),
    CONSTRAINT document_activity_role_check     CHECK (btrim(role) <> ''),
    CONSTRAINT document_activity_minutes_check
        CHECK (standard_minutes IS NULL OR standard_minutes >= 0),
    -- O se dice la firma entera o no se dice ninguna. Media referencia no
    -- apunta a nada.
    CONSTRAINT document_activity_signature_check
        CHECK ((signature_step IS NULL) = (signature_position IS NULL)),
    -- La firma tiene que existir, y tiene que ser del mismo entregable: una
    -- subactividad del Plan RAM no puede descargar la firma del Safety Case.
    --
    -- El `SET NULL` lleva lista de columnas a propósito, y no es un adorno: sin
    -- ella PostgreSQL anula las TRES columnas de la clave foránea, y una de
    -- ellas es `document_type_id`, que es NOT NULL y además parte de la clave
    -- primaria. Quitar una firma del ciclo reventaba la transacción entera en
    -- vez de desenganchar la subactividad. Lo que tiene que pasar es esto:
    -- desaparece la firma, y el trabajo de revisar —que sigue costando lo que
    -- costaba— se queda sin firma que descargar.
    CONSTRAINT document_activity_signature_fkey
        FOREIGN KEY (document_type_id, signature_step, signature_position)
        REFERENCES document_signature (document_type_id, step, position)
        ON DELETE SET NULL (signature_step, signature_position)
);

COMMENT ON TABLE document_activity IS
    'Las subactividades de un entregable: crear, revisar en tres niveles, soportar. Por ROL y con sus minutos, como la hoja Gantt del libro del equipo.';
COMMENT ON COLUMN document_activity.step IS
    'Niveles de revisión, no rondas: hay entregables con review_2 y sin review_1 —los que escribe otro departamento— y con review_3 y sin review_2.';
COMMENT ON COLUMN document_activity.position IS
    'Dos roles en el mismo nivel. Lo normal es 1.';
COMMENT ON COLUMN document_activity.signature_step IS
    'La firma que esta subactividad descarga, si descarga alguna. Es lo que saca los minutos de firma de ADR-0032 de estar sueltos.';

-- Se lee siempre por entregable y la clave primaria ya empieza por ahí. El
-- índice que sí hace falta es el de vuelta: qué subactividad descarga una
-- firma dada, que es lo que comprueba la regla de firmas huérfanas.
CREATE INDEX document_activity_signature_idx
    ON document_activity (document_type_id, signature_step, signature_position)
    WHERE signature_step IS NOT NULL;

-- `document_signature` no tenía índice único sobre su clave primaria por
-- columnas en ese orden, pero sí lo es: (document_type_id, step, position). La
-- clave foránea de arriba se apoya en ella.

GRANT INSERT, UPDATE, DELETE ON document_activity TO planner_api;

-- migrate:down
DROP TABLE IF EXISTS document_activity;
DROP TYPE IF EXISTS activity_step;
