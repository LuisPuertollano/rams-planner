-- migrate:up
-- El avance de un contenedor es un valor DERIVADO: la media de sus hijos
-- ponderada por trabajo. Como tal, pertenece a la ejecución de cálculo y no a
-- la tabla `task`, donde vive el avance que declara la persona.
ALTER TABLE task_result ADD COLUMN percent_complete_bp INTEGER NOT NULL DEFAULT 0
    CHECK (percent_complete_bp BETWEEN 0 AND 10000);

COMMENT ON COLUMN task_result.percent_complete_bp IS
    'Avance derivado. En las hojas coincide con el declarado; en los contenedores es la media ponderada por trabajo.';

-- migrate:down
ALTER TABLE task_result DROP COLUMN percent_complete_bp;
