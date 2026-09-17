-- migrate:up
-- ---------------------------------------------------------------------------
-- Usuarios, roles y permisos
-- ---------------------------------------------------------------------------
-- `app_user` existía desde el esquema inicial con su correo y su nombre: sólo
-- le faltaba poder entrar. El trigger de auditoría lleva desde el primer día
-- esperando un `app.actor_id`, así que en cuanto haya sesión el historial pasa
-- de decir «sin actor» a decir quién cambió cada cosa.
--
-- La contraseña NO se guarda, ni cifrada: se guarda una derivación lenta con
-- sal. `scrypt` está en la biblioteca estándar de Node, así que no hace falta
-- compilar nada en la imagen Alpine, que es donde bcrypt y argon2 duelen.
ALTER TABLE app_user
    ADD COLUMN password_hash TEXT,
    ADD COLUMN password_changed_at TIMESTAMPTZ,
    ADD COLUMN last_login_at TIMESTAMPTZ;

COMMENT ON COLUMN app_user.password_hash IS
    'scrypt con sal, en el formato «scrypt$N$r$p$sal$derivada». Nunca la contraseña.';

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- Un rol es un nombre y un puñado de permisos. Los permisos concretos NO viven
-- aquí como columnas: viven en `role_permission`, una fila por casilla marcada,
-- porque el catálogo de funciones crece y una tabla con 28 columnas booleanas
-- necesitaría una migración cada vez que se añade una pantalla.
CREATE TABLE app_role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    -- Un rol de sistema lo tiene todo y la hoja no lo puede tocar. Es la única
    -- forma de que desmarcar una casilla no te deje fuera de tu herramienta.
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    sort_key    INTEGER NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE role_permission (
    role_id         UUID NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    -- Código del catálogo que vive en el código, no una clave ajena: el
    -- catálogo es de la aplicación y la base de datos no tiene por qué saberse
    -- la lista. Lo que sí se hace es sincronizar y avisar de los que sobran.
    permission_code TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_code)
);

-- ---------------------------------------------------------------------------
-- Quién tiene qué rol, y dónde
-- ---------------------------------------------------------------------------
-- `project_id` nulo significa «en toda la herramienta». Con proyecto, el rol
-- vale sólo ahí. El permiso efectivo sobre un proyecto es la unión de los dos,
-- que es lo que la gente espera: quien es planificador global también lo es en
-- cada proyecto, sin tener que repetirlo.
CREATE TABLE user_role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES app_role(id) ON DELETE CASCADE,
    project_id  UUID REFERENCES project(id) ON DELETE CASCADE,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dos índices únicos en vez de una clave compuesta: en PostgreSQL dos filas con
-- NULL no se consideran iguales, así que una clave con `project_id` nulable
-- dejaría meter el mismo rol global dos veces.
CREATE UNIQUE INDEX user_role_global_unico ON user_role (user_id, role_id)
    WHERE project_id IS NULL;
CREATE UNIQUE INDEX user_role_proyecto_unico ON user_role (user_id, role_id, project_id)
    WHERE project_id IS NOT NULL;
CREATE INDEX ON user_role (project_id);

-- ---------------------------------------------------------------------------
-- Sesiones
-- ---------------------------------------------------------------------------
-- Se guarda el HASH del identificador de sesión, no el identificador. Quien lea
-- esta tabla —una copia de seguridad, un volcado, alguien con acceso a la base—
-- no puede suplantar a nadie con lo que ve.
CREATE TABLE user_session (
    token_hash   TEXT PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT
);
CREATE INDEX ON user_session (user_id);
CREATE INDEX ON user_session (expires_at);

-- ---------------------------------------------------------------------------
-- El rol de sistema, y la red de seguridad
-- ---------------------------------------------------------------------------
INSERT INTO app_role (id, code, name, description, is_system, sort_key) VALUES
    ('00000000-0000-4000-9004-000000000001', 'superadmin', 'Superadministración',
     'Lo tiene todo, siempre. Ni la hoja de permisos ni nadie puede recortarlo.', TRUE, 0),
    ('00000000-0000-4000-9004-000000000002', 'lectura', 'Lectura',
     'Ve el plan, la carga y el equipo. No toca nada y no ve costes.', FALSE, 10),
    ('00000000-0000-4000-9004-000000000003', 'planificador', 'Planificación',
     'Edita el plan, el equipo y las competencias. No ve costes.', FALSE, 20),
    ('00000000-0000-4000-9004-000000000004', 'responsable', 'Responsable',
     'Todo lo del planificador, más costes y tarifas.', FALSE, 30);

-- Los permisos de arranque de los tres roles editables. Son un punto de
-- partida razonable, no un dogma: la hoja los cambia.
INSERT INTO role_permission (role_id, permission_code)
SELECT '00000000-0000-4000-9004-000000000002', code FROM (VALUES
    ('carga.ver'), ('plan.ver'), ('equipo.ver'), ('competencias.ver'),
    ('reparto.ver'), ('ejecuciones.ver'), ('exportar')
) AS p(code);

INSERT INTO role_permission (role_id, permission_code)
SELECT '00000000-0000-4000-9004-000000000003', code FROM (VALUES
    ('carga.ver'), ('plan.ver'), ('plan.editar'), ('plan.estructura'),
    ('asignaciones.editar'), ('dependencias.editar'), ('requisitos.editar'),
    ('equipo.ver'), ('equipo.editar'), ('ausencias.editar'),
    ('competencias.ver'), ('competencias.editar'), ('competencias.catalogo'),
    ('reparto.ver'), ('reparto.aplicar'),
    ('ejecuciones.ver'), ('calcular'), ('nivelar'), ('lineabase.crear'), ('historial.ver'),
    ('importar'), ('exportar'), ('plantillas.usar'), ('plantillas.gestionar')
) AS p(code);

INSERT INTO role_permission (role_id, permission_code)
SELECT '00000000-0000-4000-9004-000000000004', code FROM (VALUES
    ('carga.ver'), ('costes.ver'), ('plan.ver'), ('plan.editar'), ('plan.estructura'),
    ('asignaciones.editar'), ('dependencias.editar'), ('requisitos.editar'),
    ('equipo.ver'), ('equipo.editar'), ('ausencias.editar'), ('tarifas.editar'),
    ('competencias.ver'), ('competencias.editar'), ('competencias.catalogo'),
    ('reparto.ver'), ('reparto.aplicar'),
    ('ejecuciones.ver'), ('calcular'), ('nivelar'), ('lineabase.crear'), ('historial.ver'),
    ('importar'), ('exportar'), ('plantillas.usar'), ('plantillas.gestionar')
) AS p(code);

-- El rol de sistema no se toca. No es una convención de la aplicación: si
-- alguien intenta recortarlo por SQL, tampoco puede.
CREATE OR REPLACE FUNCTION app_role_de_sistema_intocable() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_system THEN
            RAISE EXCEPTION 'El rol «%» es de sistema y no se puede borrar', OLD.code;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.is_system AND (NEW.code <> OLD.code OR NEW.is_system <> OLD.is_system
                          OR NEW.deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'El rol «%» es de sistema: no se puede renombrar, degradar ni dar de baja', OLD.code;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_role_de_sistema_intocable_trg
    BEFORE UPDATE OR DELETE ON app_role
    FOR EACH ROW EXECUTE FUNCTION app_role_de_sistema_intocable();

-- Y sus permisos tampoco se editan: el superadministrador no los lee de esta
-- tabla —los tiene todos por definición— pero dejar la puerta abierta invita a
-- que alguien intente «arreglarlo» por aquí.
CREATE OR REPLACE FUNCTION role_permission_no_de_sistema() RETURNS TRIGGER AS $$
DECLARE v_role UUID;
BEGIN
    v_role := COALESCE(NEW.role_id, OLD.role_id);
    IF EXISTS (SELECT 1 FROM app_role WHERE id = v_role AND is_system) THEN
        RAISE EXCEPTION 'Los permisos de un rol de sistema no se editan: los tiene todos por definición';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_permission_no_de_sistema_trg
    BEFORE INSERT OR UPDATE OR DELETE ON role_permission
    FOR EACH ROW EXECUTE FUNCTION role_permission_no_de_sistema();

GRANT INSERT, UPDATE, DELETE ON app_role, role_permission, user_role, user_session TO planner_api;

-- migrate:down
DROP TRIGGER IF EXISTS role_permission_no_de_sistema_trg ON role_permission;
DROP FUNCTION IF EXISTS role_permission_no_de_sistema();
DROP TRIGGER IF EXISTS app_role_de_sistema_intocable_trg ON app_role;
DROP FUNCTION IF EXISTS app_role_de_sistema_intocable();
DROP TABLE IF EXISTS user_session;
DROP TABLE IF EXISTS user_role;
DROP TABLE IF EXISTS role_permission;
DROP TABLE IF EXISTS app_role;
ALTER TABLE app_user
    DROP COLUMN password_hash,
    DROP COLUMN password_changed_at,
    DROP COLUMN last_login_at;
