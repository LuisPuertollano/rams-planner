-- migrate:up
-- ---------------------------------------------------------------------------
-- Plantillas de proyecto
-- ---------------------------------------------------------------------------
-- Una plantilla NO es un modelo de datos nuevo: es un proyecto marcado como tal
-- (P6, el esquema modela conceptos). Tiene su árbol WBS, sus duraciones, sus
-- dependencias y sus campos, exactamente igual que cualquier proyecto, porque
-- eso es justo lo que una plantilla es. Lo único que la distingue es que no se
-- calcula: no produce fechas ni carga, y por eso el snapshot la excluye.
--
-- La alternativa —tablas `project_template`, `template_node`,
-- `template_dependency`— sería un segundo modelo paralelo que hay que mantener
-- al día cada vez que el primero cambia, y que se desincroniza a la tercera
-- funcionalidad nueva.
ALTER TABLE project ADD COLUMN is_template BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN project.is_template IS
    'Una plantilla es un proyecto que no se calcula: no genera fechas ni carga. Sirve de molde para crear otros.';

-- Las consultas de proyecto real y de plantilla son siempre disjuntas.
CREATE INDEX ON project (is_template) WHERE deleted_at IS NULL;

-- Una plantilla no lleva gente: el molde dice qué trabajo hay, no quién lo hace.
-- Si se copia un proyecto con asignaciones para convertirlo en plantilla, las
-- asignaciones se quedan por el camino, y esto lo hace cumplir la base de datos
-- en vez de la aplicación.
CREATE OR REPLACE FUNCTION assignment_not_on_template() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM wbs_node n JOIN project p ON p.id = n.project_id
        WHERE n.id = NEW.node_id AND p.is_template
    ) THEN
        RAISE EXCEPTION 'Una plantilla no lleva personas asignadas: describe el trabajo, no quién lo hace';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_not_on_template_trg
    BEFORE INSERT OR UPDATE ON assignment
    FOR EACH ROW EXECUTE FUNCTION assignment_not_on_template();

-- migrate:down
DROP TRIGGER IF EXISTS assignment_not_on_template_trg ON assignment;
DROP FUNCTION IF EXISTS assignment_not_on_template();
DROP INDEX IF EXISTS project_is_template_idx;
ALTER TABLE project DROP COLUMN is_template;
