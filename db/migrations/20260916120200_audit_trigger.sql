-- migrate:up
-- ---------------------------------------------------------------------------
-- Historial inmutable y de sólo añadir (P7)
-- ---------------------------------------------------------------------------
-- Un único trigger genérico sobre las tablas declaradas y reales. El actor, el
-- request_id y el comentario llegan por parámetros de sesión que la API fija al
-- abrir la transacción:
--     SET LOCAL app.actor_id = '...'; SET LOCAL app.request_id = '...';
--     SET LOCAL app.change_comment = 'ampliación de alcance';
-- El request_id agrupa los 31 cambios de "mover una fase con 30 tareas" en una
-- sola operación de usuario.

CREATE OR REPLACE FUNCTION record_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before   JSONB;
    v_after    JSONB;
    v_op       audit_operation;
    v_entity   UUID;
    v_actor    UUID := nullif(current_setting('app.actor_id',       true), '')::UUID;
    v_request  UUID := nullif(current_setting('app.request_id',     true), '')::UUID;
    v_comment  TEXT := nullif(current_setting('app.change_comment', true), '');
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_before := to_jsonb(OLD);
        v_op     := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        v_after  := to_jsonb(NEW);
        v_op     := 'insert';
    ELSE
        v_before := to_jsonb(OLD);
        v_after  := to_jsonb(NEW);
        -- Un soft delete es un UPDATE, pero en el historial se lee como lo que es.
        IF v_after ? 'deleted_at' THEN
            IF v_before->>'deleted_at' IS NULL AND v_after->>'deleted_at' IS NOT NULL THEN
                v_op := 'delete';
            ELSIF v_before->>'deleted_at' IS NOT NULL AND v_after->>'deleted_at' IS NULL THEN
                v_op := 'restore';
            ELSE
                v_op := 'update';
            END IF;
        ELSE
            v_op := 'update';
        END IF;
        -- Un UPDATE que no cambia nada no es un cambio.
        IF v_before = v_after THEN
            RETURN NEW;
        END IF;
    END IF;

    v_entity := COALESCE(v_after->>'id', v_before->>'id')::UUID;

    INSERT INTO change_event (actor_id, request_id, operation, entity_type, entity_id,
                              before_value, after_value, comment)
    VALUES (v_actor, v_request, v_op, TG_TABLE_NAME, v_entity, v_before, v_after, v_comment);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- El historial no se edita. Ni siquiera por el propietario de la base de datos.
CREATE OR REPLACE FUNCTION reject_change_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'change_event es append-only (P7): no se puede % una fila del historial', lower(TG_OP)
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER change_event_is_append_only
    BEFORE UPDATE OR DELETE ON change_event
    FOR EACH ROW EXECUTE FUNCTION reject_change_event_mutation();

-- Sólo las tablas con columna `id` UUID: son las que se pueden referenciar
-- desde el historial. Las tablas puente (clave compuesta) se auditan a través
-- de su entidad padre.
DO $$
DECLARE
    v_table TEXT;
    v_audited CONSTANT TEXT[] := ARRAY[
        'calendar', 'calendar_week_slot', 'calendar_exception',
        'resource', 'resource_availability', 'absence', 'resource_cost_rate',
        'portfolio', 'project', 'wbs_node', 'dependency', 'assignment',
        'scenario', 'scenario_override',
        'field_definition', 'rule_definition',
        'actual_entry', 'progress_update'
    ];
BEGIN
    FOREACH v_table IN ARRAY v_audited LOOP
        EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION record_change_event()',
            'audit_' || v_table, v_table
        );
    END LOOP;
END;
$$;

-- `task` es 1:1 con wbs_node y su clave se llama node_id, no id.
CREATE OR REPLACE FUNCTION record_task_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before  JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_after   JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    v_op      audit_operation := CASE TG_OP WHEN 'INSERT' THEN 'insert'::audit_operation
                                            WHEN 'DELETE' THEN 'delete'::audit_operation
                                            ELSE 'update'::audit_operation END;
    v_actor   UUID := nullif(current_setting('app.actor_id',       true), '')::UUID;
    v_request UUID := nullif(current_setting('app.request_id',     true), '')::UUID;
    v_comment TEXT := nullif(current_setting('app.change_comment', true), '');
BEGIN
    IF TG_OP = 'UPDATE' AND v_before = v_after THEN
        RETURN NEW;
    END IF;
    INSERT INTO change_event (actor_id, request_id, operation, entity_type, entity_id,
                              before_value, after_value, comment)
    VALUES (v_actor, v_request, v_op, 'task',
            COALESCE(v_after->>'node_id', v_before->>'node_id')::UUID,
            v_before, v_after, v_comment);
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_task
    AFTER INSERT OR UPDATE OR DELETE ON task
    FOR EACH ROW EXECUTE FUNCTION record_task_change_event();

-- migrate:down
DROP TRIGGER IF EXISTS audit_task ON task;
DROP TRIGGER IF EXISTS change_event_is_append_only ON change_event;
DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOR v_table IN
        SELECT c.relname
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname LIKE 'audit\_%' AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_' || v_table, v_table);
    END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS record_task_change_event();
DROP FUNCTION IF EXISTS record_change_event();
DROP FUNCTION IF EXISTS reject_change_event_mutation();
