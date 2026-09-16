-- migrate:up
-- ---------------------------------------------------------------------------
-- Separación declarado / derivado, impuesta por la base de datos (P1)
-- ---------------------------------------------------------------------------
-- El principio P1 dice que el motor no puede escribir datos del usuario y que
-- el usuario no puede escribir resultados del motor. Hacerlo cumplir por
-- convención falla en el tercer hotfix; hacerlo cumplir con GRANT no falla.
--
-- Estos son roles de grupo (NOLOGIN). El usuario real de cada servicio se crea
-- fuera de las migraciones (con su contraseña) y se le concede el grupo:
--     CREATE USER planner_api_svc PASSWORD '...'; GRANT planner_api TO planner_api_svc;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planner_api') THEN
        CREATE ROLE planner_api NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planner_engine') THEN
        CREATE ROLE planner_engine NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planner_readonly') THEN
        CREATE ROLE planner_readonly NOLOGIN;
    END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO planner_api, planner_engine, planner_readonly;

-- Todos pueden leer todo: la transparencia no es el problema que P1 resuelve.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO planner_api, planner_engine, planner_readonly;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO planner_api, planner_engine;

-- --- La API escribe lo DECLARADO y lo REAL, y nada más -----------------------
GRANT INSERT, UPDATE, DELETE ON
    app_user, calendar, calendar_week_slot, calendar_exception, calendar_exception_slot,
    resource, resource_availability, absence, resource_cost_rate, skill, resource_skill,
    portfolio, project, wbs_node, task, dependency, assignment, assignment_manual_contour,
    scenario, scenario_project, scenario_override,
    field_definition, field_value, tag, taggable, rule_definition,
    actual_entry, progress_update
TO planner_api;

-- Congelar una ejecución como línea base sí es una acción de usuario, pero sólo
-- puede tocar esa bandera: el resto de la ejecución sigue siendo del motor.
GRANT INSERT ON baseline TO planner_api;
GRANT UPDATE (is_frozen) ON calculation_run TO planner_api;

-- --- El motor escribe lo DERIVADO, y nada más -------------------------------
GRANT INSERT, UPDATE, DELETE ON
    calculation_run, task_result, assignment_timephased,
    resource_capacity_timephased, finding, derivation
TO planner_engine;

-- --- Nadie escribe el historial directamente (P7) ---------------------------
-- change_event sólo se rellena desde el trigger de auditoría, que es
-- SECURITY DEFINER. Ningún rol de aplicación tiene INSERT/UPDATE/DELETE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON change_event FROM PUBLIC, planner_api, planner_engine, planner_readonly;

-- Lo mismo para las tablas nuevas que se creen más adelante.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO planner_api, planner_engine, planner_readonly;

-- migrate:down
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM planner_api, planner_engine, planner_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM planner_api, planner_engine, planner_readonly;
REVOKE ALL ON SCHEMA public FROM planner_api, planner_engine, planner_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM planner_api, planner_engine, planner_readonly;
DROP ROLE IF EXISTS planner_api;
DROP ROLE IF EXISTS planner_engine;
DROP ROLE IF EXISTS planner_readonly;
