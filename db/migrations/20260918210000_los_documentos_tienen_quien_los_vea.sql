-- migrate:up
-- ---------------------------------------------------------------------------
-- La pantalla de Documentos no la ve nadie, y no era a propósito
-- ---------------------------------------------------------------------------
-- Encontrado al escribir la documentación por rol, que es exactamente para lo
-- que sirve escribirla: `documentos.ver`, `documentos.gestionar` y
-- `documentos.asignar` existen como permisos desde que nació el catálogo, y
-- **no están en ninguno de los tres roles de arranque**. Sólo el superadmin
-- —que lo tiene todo por definición y no por reparto— llega a esa pantalla.
--
-- Lo que se queda invisible no es un rincón: es el catálogo de entregables
-- entero, la matriz de precedencias, el ciclo de firma por rol y las
-- subactividades. Tres migraciones de trabajo detrás de una puerta cerrada.
--
-- El reparto que se pone es el que el resto de la hoja ya usa, sin inventar
-- nada nuevo:
--
--   - **Lectura** ve el catálogo, como ve el plan y la carga. No lo toca.
--   - **Planificación** lo ve, lo gestiona y lo asigna a las tareas: declarar
--     qué entrega cada tarea es planificar, no administrar.
--   - **Responsable** igual que planificación, que es su relación en todo lo
--     demás salvo costes y tarifas.
--
-- Sólo a los tres roles sembrados, y sólo si todavía no lo tienen: un rol que
-- alguien haya creado o recortado a mano es suyo, y esta migración no opina
-- sobre él. `ON CONFLICT DO NOTHING` hace que volver a pasarla no haga nada.

INSERT INTO role_permission (role_id, permission_code)
SELECT '00000000-0000-4000-9004-000000000002', code FROM (VALUES
    ('documentos.ver')
) AS p(code)
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, p.code
FROM (VALUES
    ('00000000-0000-4000-9004-000000000003'::uuid),
    ('00000000-0000-4000-9004-000000000004'::uuid)
) AS r(id),
(VALUES
    ('documentos.ver'), ('documentos.gestionar'), ('documentos.asignar')
) AS p(code)
ON CONFLICT DO NOTHING;

-- migrate:down
-- Sólo se quita de los tres roles sembrados, que son los únicos a los que esta
-- migración se los dio.
DELETE FROM role_permission
 WHERE permission_code IN ('documentos.ver', 'documentos.gestionar', 'documentos.asignar')
   AND role_id IN (
       '00000000-0000-4000-9004-000000000002',
       '00000000-0000-4000-9004-000000000003',
       '00000000-0000-4000-9004-000000000004');
