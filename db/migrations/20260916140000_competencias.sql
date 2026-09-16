-- migrate:up
-- ---------------------------------------------------------------------------
-- Competencias: qué sabe hacer cada persona y qué exige cada tarea
-- ---------------------------------------------------------------------------
-- Las tablas `skill` y `resource_skill` ya existían en el esquema inicial pero
-- no las usaba nadie. Lo que faltaba era el otro lado: qué competencia pide una
-- tarea. Sin eso, «quién puede hacer esto» no se puede contestar, y cualquier
-- reparto de trabajo es a ciegas.
--
-- Se modela aparte de `rams_tag` a propósito. La disciplina es una etiqueta que
-- el usuario pone para agrupar y filtrar; el requisito de competencia es una
-- condición que se comprueba. Que hoy coincidan no los hace lo mismo: el día
-- que alguien renombre una disciplina, el requisito debe seguir en pie.
CREATE TABLE node_skill_requirement (
    node_id     UUID NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
    skill_id    UUID NOT NULL REFERENCES skill(id)    ON DELETE CASCADE,
    min_level   SMALLINT NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 5),
    PRIMARY KEY (node_id, skill_id)
);
CREATE INDEX ON node_skill_requirement (skill_id);

COMMENT ON TABLE node_skill_requirement IS
    'Competencia que exige una tarea, con el nivel mínimo. Lo comprueba el motor, no una convención.';

-- El nivel deja de admitir NULL: «tiene esta competencia pero no sé a qué
-- nivel» no es un dato con el que se pueda decidir nada.
UPDATE resource_skill SET level = 3 WHERE level IS NULL;
ALTER TABLE resource_skill ALTER COLUMN level SET NOT NULL;
ALTER TABLE resource_skill ALTER COLUMN level SET DEFAULT 3;

COMMENT ON COLUMN resource_skill.level IS
    '1 en formación · 2 con apoyo · 3 autónomo · 4 referencia · 5 experto reconocido.';

-- Las competencias de partida son las disciplinas del trabajo RAMS: los mismos
-- códigos que usa la etiqueta de disciplina, para que ambas cosas hablen el
-- mismo idioma desde el primer día sin estar atadas la una a la otra.
INSERT INTO skill (id, code, name) VALUES
    ('00000000-0000-4000-9002-000000000001', 'Plan',         'Planificación RAMS y gestión de la seguridad'),
    ('00000000-0000-4000-9002-000000000002', 'Definición',   'Definición del sistema y análisis de contexto'),
    ('00000000-0000-4000-9002-000000000003', 'Hazard Log',   'Análisis de peligros y gestión del Hazard Log'),
    ('00000000-0000-4000-9002-000000000004', 'Requisitos',   'Especificación de requisitos de seguridad'),
    ('00000000-0000-4000-9002-000000000005', 'SIL',          'Asignación y demostración de SIL'),
    ('00000000-0000-4000-9002-000000000006', 'FMECA',        'FMECA y análisis de modos de fallo'),
    ('00000000-0000-4000-9002-000000000007', 'RAM',          'Fiabilidad, mantenibilidad y disponibilidad'),
    ('00000000-0000-4000-9002-000000000008', 'V&V',          'Verificación y validación'),
    ('00000000-0000-4000-9002-000000000009', 'Safety Case',  'Redacción y defensa del caso de seguridad')
ON CONFLICT (code) DO NOTHING;

-- La plantilla de serie ya dice la disciplina de cada tarea. Convertirla en
-- requisito de competencia es gratis y hace que la plantilla sirva de verdad
-- para repartir trabajo desde el primer proyecto que se cree con ella.
INSERT INTO node_skill_requirement (node_id, skill_id, min_level)
SELECT v.entity_id, s.id, 3
FROM field_value v
JOIN field_definition f ON f.id = v.field_id AND f.entity_type = 'wbs_node' AND f.field_key = 'rams_tag'
JOIN skill s ON s.code = v.value_text
JOIN wbs_node n ON n.id = v.entity_id AND n.deleted_at IS NULL
ON CONFLICT (node_id, skill_id) DO NOTHING;

-- migrate:down
ALTER TABLE resource_skill ALTER COLUMN level DROP NOT NULL;
ALTER TABLE resource_skill ALTER COLUMN level DROP DEFAULT;
DROP TABLE IF EXISTS node_skill_requirement;
DELETE FROM skill WHERE id IN (
    '00000000-0000-4000-9002-000000000001','00000000-0000-4000-9002-000000000002',
    '00000000-0000-4000-9002-000000000003','00000000-0000-4000-9002-000000000004',
    '00000000-0000-4000-9002-000000000005','00000000-0000-4000-9002-000000000006',
    '00000000-0000-4000-9002-000000000007','00000000-0000-4000-9002-000000000008',
    '00000000-0000-4000-9002-000000000009'
);
