-- migrate:up
-- ---------------------------------------------------------------------------
-- El historial guarda lo que cambia, no la fila entera dos veces
-- ---------------------------------------------------------------------------
-- Los disparadores de auditoría guardaban `to_jsonb(OLD)` y `to_jsonb(NEW)`
-- enteros en cada UPDATE. Medido sobre la cartera real: 4.862 actualizaciones
-- ocupaban 3,3 MB, y **la media de columnas que cambian de verdad en una es
-- 1,00**. O sea que para anotar «alguien cambió la duración de esta tarea» se
-- escribían dos filas completas de quince columnas: 810 bytes por un número.
--
-- Aquí el UPDATE pasa a guardar **sólo las claves cuyo valor cambia**, con su
-- antes y su después. No se pierde nada de lo que el historial contesta —quién
-- cambió qué, cuándo y por qué—: la pantalla del registro ya calculaba ese
-- mismo diff al leer y tiraba el resto. Lo único que desaparece es la copia de
-- las columnas que nadie tocó, que tampoco servía para reconstruir la fila:
-- eso siempre ha exigido recorrer el historial entero desde el principio.
--
-- Lo que NO cambia, y es deliberado:
--
--   INSERT  guarda la fila entera, porque la fila entera ES el cambio.
--   DELETE  guarda la fila entera, porque es lo que se pierde y sin ella el
--           historial no podría decir qué había.
--
-- Y una cosa que se midió y NO sirve: comprimir la columna con la compresión
-- de PostgreSQL. Una fila de `change_event` ocupa unos 800 bytes y el umbral
-- de TOAST son 2 kB, así que estas filas nunca llegan a comprimirse. Poner
-- `STORAGE MAIN` no habría ahorrado un solo byte.

-- El diff, en un solo sitio. Hay DOS disparadores de auditoría —el genérico y
-- el de `task`, que tiene la clave en `node_id` y no en `id`— y escribir la
-- misma cuenta en los dos es la forma segura de que un día digan cosas
-- distintas. Se descubrió midiendo: la primera versión sólo tocaba el genérico
-- y las tareas seguían pesando lo mismo.
CREATE OR REPLACE FUNCTION cambios_de(fuente JSONB, contra JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT jsonb_object_agg(clave, valor)
      FROM jsonb_each(fuente) AS e(clave, valor)
     WHERE contra -> clave IS DISTINCT FROM valor
$$;

COMMENT ON FUNCTION cambios_de(JSONB, JSONB) IS
    'Las claves de `fuente` cuyo valor no coincide con el de `contra`. NULL si no hay ninguna.';

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
        -- La entidad se saca ANTES de reducir: el `id` no cambia nunca, así que
        -- no estaría en el diff y el historial se quedaría sin saber de quién
        -- habla.
        v_entity := COALESCE(v_after->>'id', v_before->>'id')::UUID;
        v_before := cambios_de(v_before, v_after);
        v_after  := cambios_de(to_jsonb(NEW), to_jsonb(OLD));

        INSERT INTO change_event (actor_id, request_id, operation, entity_type, entity_id,
                                  before_value, after_value, comment)
        VALUES (v_actor, v_request, v_op, TG_TABLE_NAME, v_entity, v_before, v_after, v_comment);
        RETURN NEW;
    END IF;

    v_entity := COALESCE(v_after->>'id', v_before->>'id')::UUID;

    INSERT INTO change_event (actor_id, request_id, operation, entity_type, entity_id,
                              before_value, after_value, comment)
    VALUES (v_actor, v_request, v_op, TG_TABLE_NAME, v_entity, v_before, v_after, v_comment);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- `task` tiene su propio disparador porque su clave es `node_id`. Misma regla.
CREATE OR REPLACE FUNCTION record_task_change_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before  JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_after   JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    v_entity  UUID;
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
    v_entity := COALESCE(v_after->>'node_id', v_before->>'node_id')::UUID;
    IF TG_OP = 'UPDATE' THEN
        v_before := cambios_de(to_jsonb(OLD), to_jsonb(NEW));
        v_after  := cambios_de(to_jsonb(NEW), to_jsonb(OLD));
    END IF;

    INSERT INTO change_event (actor_id, request_id, operation, entity_type, entity_id,
                              before_value, after_value, comment)
    VALUES (v_actor, v_request, v_op, 'task', v_entity, v_before, v_after, v_comment);
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- migrate:down
-- La vuelta atrás deja los dos disparadores como estaban: la fila entera a los
-- dos lados. Los eventos ya escritos NO se tocan —son append-only, P7— así que
-- una base revertida tiene un historial con las dos formas. Se distinguen
-- solas: un evento reducido trae menos claves que la tabla.
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

DROP FUNCTION IF EXISTS cambios_de(JSONB, JSONB);
