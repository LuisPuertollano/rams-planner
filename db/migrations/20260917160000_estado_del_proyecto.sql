-- migrate:up
-- ---------------------------------------------------------------------------
-- El estado del proyecto: qué entra en el cálculo y qué no
-- ---------------------------------------------------------------------------
-- El tercero de los datos que tiene PlaTo y no teníamos. A diferencia del
-- compromiso y de la línea base de referencia —que son de lectura—, **éste
-- cambia el motor**: lo que no está activo deja de generar carga.
--
-- Tres estados, los mismos que PlaTo:
--
--   - `activo`     — se calcula y consume capacidad. Lo de siempre.
--   - `inactivo`   — declarado y en pausa: no hay presupuesto todavía, o está
--                    parado esperando algo. Se guarda entero y no ocupa a nadie.
--   - `archivado`  — terminado o muerto. Se guarda por su historia y no vuelve.
--
-- `inactivo` y `archivado` salen los dos del cálculo, y la diferencia es de
-- intención, no de motor: «va a volver» y «se acabó» son dos cosas distintas
-- para quien mira la lista, aunque el planificador las trate igual. Es la misma
-- razón por la que existen dos y no un `is_active`.
--
-- **Lo ya calculado no se toca.** Una ejecución es inmutable (P3): el proyecto
-- que se archiva hoy sigue teniendo su carga en la ejecución de ayer, porque
-- ayer estaba dentro. Desaparece de la siguiente, no de la anterior, y un
-- informe viejo sigue enseñándolo —que es la verdad de aquella foto—.
CREATE TYPE project_status AS ENUM ('activo', 'inactivo', 'archivado');

COMMENT ON TYPE project_status IS
  'activo: se calcula y consume capacidad. '
  'inactivo: declarado y en pausa; no genera carga. '
  'archivado: terminado; se guarda por su historia y no genera carga.';

-- `activo` por defecto, que es lo que eran todos: decir otra cosa al migrar
-- sacaría proyectos del plan sin que nadie lo hubiera pedido.
ALTER TABLE project
  ADD COLUMN status project_status NOT NULL DEFAULT 'activo';

-- El índice es el que usan las cinco consultas de la instantánea, que filtran
-- por esto en cada cálculo.
CREATE INDEX project_status_idx ON project (status) WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS project_status_idx;
ALTER TABLE project DROP COLUMN IF EXISTS status;
DROP TYPE IF EXISTS project_status;
