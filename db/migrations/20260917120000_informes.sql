-- migrate:up
-- ---------------------------------------------------------------------------
-- La función de ver informes, para los roles que ya existen
-- ---------------------------------------------------------------------------
-- El catálogo de permisos vive en el código (`packages/api/src/permissions.ts`)
-- y no hace falta migrarlo: es la lista de lo que se puede hacer. Lo que sí
-- vive en la base es **quién puede qué**, y eso no se actualiza solo.
--
-- Sin esto, una instalación que ya tuviera sus roles repartidos estrenaría la
-- pestaña de informes con nadie dentro salvo el superadministrador, y parecería
-- que la función no funciona. Se concede a los tres roles de arranque porque
-- los tres ya podían ver el plan: el informe no enseña nada que no vieran —de
-- hecho enseña menos, porque los importes y el reparto por persona siguen
-- pidiendo sus propios permisos.
--
-- Sólo a los roles de arranque y sólo si siguen existiendo. Un rol que el
-- equipo haya creado a mano es decisión suya, y la hoja de permisos está para
-- eso.
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'informes.ver'
FROM app_role r
WHERE r.deleted_at IS NULL
  AND r.code IN ('lectura', 'planificador', 'responsable')
ON CONFLICT DO NOTHING;

-- migrate:down
DELETE FROM role_permission WHERE permission_code = 'informes.ver';
