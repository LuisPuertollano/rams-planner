-- migrate:up
-- ---------------------------------------------------------------------------
-- La tarea que dura una fase
-- ---------------------------------------------------------------------------
-- Hay trabajo que no es un entregable. «Gestión del proyecto», «seguimiento
-- RAM mensual», «soporte durante la garantía»: no terminan un día, ocupan una
-- FASE entera, en paralelo con todo lo demás y a baja intensidad.
--
-- Hasta hoy el planner sólo sabía hacer lo contrario. A una tarea se le declara
-- el trabajo, el motor lo divide por la dedicación y saca una duración; 2.000 h
-- de gestión se convertían en 250 días seguidos de una persona a jornada
-- completa, encadenados detrás de su predecesora. La curva de carga salía con
-- la gestión apilada en un bloque y el resto del proyecto vacío.
--
-- El libro del equipo lleva desde su v28 haciéndolo bien, y así lo hace: la
-- ventana **viene de las puertas**, las filas del paquete la comparten EN
-- PARALELO, y el encadenado se suprime para ellas.
--
-- Aquí se declara igual, con dos anclas:
--
--   span_from = 'arranque'  ->  el arranque del proyecto (project.status_start)
--   span_from = 'IQA'       ->  la fecha de esa puerta en este proyecto
--   span_to   = 'FQA'       ->  ídem
--
-- Y entonces la ecuación de la tarea se lee al revés, que es lo que cambia
-- todo: la duración deja de salir del trabajo y la pone la fase; lo que el plan
-- calcula y enseña es la INTENSIDAD — a qué dedicación hay que llevar eso para
-- que quepa entre las dos puertas.
--
-- Las dos columnas van juntas o no van: media ventana no es una ventana. Y las
-- anclas se guardan como texto por lo mismo que `project_gate.gate` y
-- `document_type.gate`: cada cliente tiene su juego de puertas, y una
-- enumeración obligaría a migrar para añadir una.

ALTER TABLE task
    ADD COLUMN span_from TEXT,
    ADD COLUMN span_to   TEXT,
    ADD CONSTRAINT task_span_entero_o_nada
        CHECK ((span_from IS NULL) = (span_to IS NULL)),
    ADD CONSTRAINT task_span_no_vacio
        CHECK ((span_from IS NULL OR btrim(span_from) <> '')
           AND (span_to   IS NULL OR btrim(span_to)   <> ''));

COMMENT ON COLUMN task.span_from IS
    'Ancla de inicio de una tarea continua: «arranque» o el nombre de una puerta. NULL = tarea normal.';
COMMENT ON COLUMN task.span_to IS
    'Ancla de fin: el nombre de una puerta. Va siempre con span_from.';

-- migrate:down
ALTER TABLE task
    DROP CONSTRAINT IF EXISTS task_span_entero_o_nada,
    DROP CONSTRAINT IF EXISTS task_span_no_vacio,
    DROP COLUMN IF EXISTS span_from,
    DROP COLUMN IF EXISTS span_to;
