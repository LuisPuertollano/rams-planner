-- migrate:up
-- ---------------------------------------------------------------------------
-- Las dos funciones de las horas reales, para los roles que ya existen
-- ---------------------------------------------------------------------------
-- La tabla `actual_entry` está en el esquema desde el primer día y nadie la
-- usaba. No hace falta migrarla: lo que hace falta es decidir **quién puede
-- verla y quién puede escribirla**, y eso no se actualiza solo.
--
-- `reales.ver` se concede a los tres roles de arranque, por la misma razón que
-- `informes.ver`: los tres ya podían ver el plan, y las horas reales no enseñan
-- nada que no vieran —de hecho enseñan menos, porque el reparto por persona
-- sigue pidiendo `carga.ver` y los importes `costes.ver`—.
INSERT INTO role_permission (role_id, permission_code)
SELECT r.id, 'reales.ver'
FROM app_role r
WHERE r.deleted_at IS NULL
  AND r.code IN ('lectura', 'planificador', 'responsable')
ON CONFLICT DO NOTHING;

-- `reales.registrar` **no**. Cargar el parte de horas escribe sobre todos los
-- proyectos a la vez, así que va con quien ya podía importar el plan, y no con
-- quien sólo lee. Si nadie tenía `importar`, nadie lo estrena: la hoja de
-- permisos está para eso.
INSERT INTO role_permission (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'reales.registrar'
FROM role_permission rp
JOIN app_role r ON r.id = rp.role_id AND r.deleted_at IS NULL
WHERE rp.permission_code = 'importar'
ON CONFLICT DO NOTHING;

-- migrate:down
DELETE FROM role_permission WHERE permission_code IN ('reales.ver', 'reales.registrar');
