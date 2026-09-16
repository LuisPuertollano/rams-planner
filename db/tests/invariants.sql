-- ---------------------------------------------------------------------------
-- Invariantes que hace cumplir la base de datos, no la disciplina del código.
-- ---------------------------------------------------------------------------
-- Se ejecuta con: psql -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
-- Cada bloque provoca a propósito una operación que DEBE fallar. Si no falla,
-- el script aborta: sería una regresión silenciosa de un principio.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_failure(p_sql TEXT, p_what TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'OK  %  (rechazado: %)', p_what, left(SQLERRM, 80);
        RETURN;
    END;
    RAISE EXCEPTION 'FALLO: % debería haber sido rechazado y no lo fue', p_what;
END;
$$;

-- Datos mínimos de trabajo.
INSERT INTO resource (id, code, display_name, calendar_id)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'test_res', 'Recurso de prueba',
        '00000000-0000-4000-8000-000000000002');

INSERT INTO project (id, code, name, status_start)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'TEST-1', 'Proyecto de prueba', DATE '2026-01-01');

INSERT INTO wbs_node (id, project_id, node_kind, path, sort_key, name)
VALUES ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
        'milestone', '001', 1, 'Hito de prueba');

INSERT INTO resource_availability (resource_id, valid_period, units_bp)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '[2026-01-01,2026-07-01)', 10000);

-- R1: la disponibilidad de un recurso no se solapa.
SELECT pg_temp.expect_failure($$
    INSERT INTO resource_availability (resource_id, valid_period, units_bp)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '[2026-06-01,2026-09-01)', 5000)
$$, 'R1 disponibilidad solapada');

-- T1: un hito no tiene duración ni trabajo.
SELECT pg_temp.expect_failure($$
    INSERT INTO task (node_id, is_milestone, duration_minutes)
    VALUES ('cccccccc-0000-4000-8000-000000000001', TRUE, 480)
$$, 'T1 hito con duración');

-- D1: una dependencia no puede unir una tarea consigo misma.
SELECT pg_temp.expect_failure($$
    INSERT INTO dependency (predecessor_node_id, successor_node_id)
    VALUES ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001')
$$, 'D1 dependencia reflexiva');

-- C1: un calendario no hereda de sí mismo.
SELECT pg_temp.expect_failure($$
    UPDATE calendar SET parent_id = id WHERE code = 'base_bw'
$$, 'C1 calendario que hereda de sí mismo');

-- A1: un recurso no se asigna dos veces a la misma tarea.
INSERT INTO task (node_id, is_milestone, duration_minutes, work_declared_minutes)
VALUES ('cccccccc-0000-4000-8000-000000000001', TRUE, 0, 0);
INSERT INTO assignment (node_id, resource_id)
VALUES ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');
SELECT pg_temp.expect_failure($$
    INSERT INTO assignment (node_id, resource_id)
    VALUES ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001')
$$, 'A1 asignación duplicada');

-- P7: el historial es append-only, ni siquiera el propietario puede editarlo.
SELECT pg_temp.expect_failure($$
    UPDATE change_event SET comment = 'reescribiendo la historia'
    WHERE id = (SELECT min(id) FROM change_event)
$$, 'P7 UPDATE sobre change_event');
SELECT pg_temp.expect_failure($$
    DELETE FROM change_event WHERE id = (SELECT min(id) FROM change_event)
$$, 'P7 DELETE sobre change_event');

-- P7: los cambios anteriores dejaron rastro con su entidad y su operación.
DO $$
DECLARE v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM change_event
    WHERE entity_type = 'resource' AND operation = 'insert';
    IF v_count < 1 THEN
        RAISE EXCEPTION 'FALLO: el alta del recurso no quedó registrada en change_event';
    END IF;
    RAISE NOTICE 'OK  P7 el alta del recurso quedó registrada';
END;
$$;

-- P1: el rol de la API no puede escribir en la zona derivada.
DO $$
DECLARE v_has_write BOOLEAN;
BEGIN
    SELECT bool_or(has_table_privilege('planner_api', t, 'INSERT'))
      INTO v_has_write
      FROM unnest(ARRAY['task_result','assignment_timephased','finding','derivation']) AS t;
    IF v_has_write THEN
        RAISE EXCEPTION 'FALLO: planner_api puede escribir resultados derivados (P1)';
    END IF;
    RAISE NOTICE 'OK  P1 planner_api no escribe la zona derivada';
END;
$$;

-- P1: el rol del motor no puede escribir en la zona declarada.
DO $$
DECLARE v_has_write BOOLEAN;
BEGIN
    SELECT bool_or(has_table_privilege('planner_engine', t, 'INSERT') OR
                   has_table_privilege('planner_engine', t, 'UPDATE'))
      INTO v_has_write
      FROM unnest(ARRAY['task','assignment','resource','dependency','calendar']) AS t;
    IF v_has_write THEN
        RAISE EXCEPTION 'FALLO: planner_engine puede escribir datos declarados (P1)';
    END IF;
    RAISE NOTICE 'OK  P1 planner_engine no escribe la zona declarada';
END;
$$;

-- Los datos semilla están donde se espera.
DO $$
DECLARE v_calendars INTEGER; v_holidays INTEGER;
BEGIN
    SELECT count(*) INTO v_calendars FROM calendar WHERE code LIKE 'base%';
    SELECT count(*) INTO v_holidays  FROM calendar_exception WHERE NOT is_working;
    IF v_calendars <> 3 THEN RAISE EXCEPTION 'FALLO: se esperaban 3 calendarios base, hay %', v_calendars; END IF;
    IF v_holidays  < 100 THEN RAISE EXCEPTION 'FALLO: faltan festivos sembrados, hay %', v_holidays; END IF;
    RAISE NOTICE 'OK  semilla: % calendarios, % festivos', v_calendars, v_holidays;
END;
$$;

ROLLBACK;
