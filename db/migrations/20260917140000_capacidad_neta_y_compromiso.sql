-- migrate:up
-- ---------------------------------------------------------------------------
-- Capacidad neta, compromiso del proyecto y línea base de referencia
-- ---------------------------------------------------------------------------
-- Tres datos **declarados** que faltaban, cada uno para una pregunta que la
-- herramienta no sabía contestar.

-- --- 1. Lo que del día no llega nunca a una tarea --------------------------
--
-- El calendario dice que alguien tiene ocho horas, y el plan las reparte
-- enteras. Pero de esas ocho, una parte no llega nunca a una tarea del plan:
-- reuniones de departamento, formación, la revisión de otro, el correo. Y otra
-- parte hay que guardarla para lo que no se sabe todavía: la baja de un día que
-- nadie declaró porque nadie la vio venir.
--
-- Planificar contra el bruto sobrecompromete de forma sistemática, y el hueco
-- **no se ve como sobrecarga**: se ve como retrasos, tres meses después.
--
-- Son dos campos y no uno porque son dos cosas distintas:
--
--   - `indirect_bp` es trabajo que **pasa**, conocido y repetido. Lo sabe quien
--     lleva al equipo, y es distinto para quien coordina que para quien no.
--   - `reserve_bp` es sitio que se **guarda** para lo que no ha pasado. Es una
--     decisión de riesgo, no una medida.
--
-- Cero por defecto, y esto no es pereza: es P2. Una migración que cambiase la
-- capacidad de todo el mundo dejaría todas las ejecuciones guardadas sin poder
-- reproducirse. El número cambia cuando alguien lo declara.
ALTER TABLE resource
  ADD COLUMN indirect_bp integer NOT NULL DEFAULT 0,
  ADD COLUMN reserve_bp integer NOT NULL DEFAULT 0;

-- Hasta 5000 (50 %) cada uno. El tope no es arbitrario: por encima de la mitad
-- del día, lo que hay no es un factor de corrección sino una dedicación parcial,
-- y eso ya se declara —y se explica mejor— en `resource_availability`.
ALTER TABLE resource
  ADD CONSTRAINT resource_indirect_bp_check CHECK (indirect_bp BETWEEN 0 AND 5000),
  ADD CONSTRAINT resource_reserve_bp_check CHECK (reserve_bp BETWEEN 0 AND 5000);

-- El bruto se guarda al lado del neto, no se recalcula al mirarlo.
--
-- Es lo que hace que la resta se pueda enseñar (P4): sin el bruto, «7,4 h» es
-- un número que nadie puede comprobar, y volver a calcularlo desde el
-- calendario de hoy daría otro resultado en cuanto alguien cambie un festivo.
-- Una ejecución se explica con lo que ella misma vio.
--
-- **Nulo, y sin rellenar lo de antes.** Ésta es la tabla más grande de la base
-- —una fila por persona y día de cada ejecución— y un `UPDATE` completo la
-- bloquea entera: en la base de desarrollo de aquí, veintiséis millones de
-- filas y dos minutos y veintidós segundos de bloqueo exclusivo para un cambio
-- que debería ser sólo de metadatos.
--
-- Y nulo dice la verdad mejor que un número: esas ejecuciones **no anotaron**
-- un bruto. Que no hubiera factores y por tanto coincidiera con el neto es
-- cierto, pero lo que se está guardando es qué apuntó cada ejecución, y ésas no
-- apuntaron nada. Quien lee decide qué hacer con el hueco; aquí no se inventa.
ALTER TABLE resource_capacity_timephased
  ADD COLUMN gross_minutes integer;

-- `NOT VALID` por la misma razón: obliga a todo lo que se escriba a partir de
-- ahora, que es lo que hace falta, y se ahorra recorrer veintiséis millones de
-- filas que son todas nulas y que por tanto ya la cumplen.
ALTER TABLE resource_capacity_timephased
  ADD CONSTRAINT resource_capacity_timephased_gross_check
  CHECK (gross_minutes IS NULL OR gross_minutes >= capacity_minutes)
  NOT VALID;

-- --- 2. Cuánto de esta demanda hay que servir de verdad --------------------
--
-- Sumar las horas de una oferta a las de un contrato firmado y llamar plan al
-- total es la forma más rápida de que el plan no sirva para decidir. Son la
-- misma unidad y no son la misma obligación.
--
-- Tres niveles y no ocho: esto es **confianza en la demanda**, no tipo de
-- trabajo. Si además hace falta distinguir I+D de sostenimiento, eso es otro
-- eje y va en un campo propio, no aquí.
CREATE TYPE commitment_level AS ENUM ('firme', 'probable', 'posible');

COMMENT ON TYPE commitment_level IS
  'firme: contratado, hay que hacerlo. '
  'probable: previsto y esperado, sin firmar. '
  'posible: oferta u oportunidad; puede no llegar nunca.';

-- `firme` por defecto porque es lo que había: todos los proyectos de una
-- instalación en marcha se estaban tratando como obligatorios, y decir otra
-- cosa al migrar sería inventarse un dato que nadie declaró.
ALTER TABLE project
  ADD COLUMN commitment commitment_level NOT NULL DEFAULT 'firme';

-- --- 3. Contra qué se compara este proyecto --------------------------------
--
-- Congelar una línea base ya se podía. Lo que faltaba era decir **cuál** es la
-- de referencia de cada proyecto: sin eso, «frente a la línea base» obliga a
-- elegir a mano cada vez, y dos personas comparan contra fotos distintas sin
-- enterarse.
--
-- Es por proyecto y no global porque cada proyecto congela en su propio momento
-- —su revisión, su hito contractual— y la línea base del de al lado no le dice
-- nada.
--
-- `ON DELETE SET NULL`: una línea base que se retira deja al proyecto sin
-- referencia, que es la verdad, y no un puntero a algo que ya no está.
ALTER TABLE project
  ADD COLUMN current_baseline_id uuid REFERENCES baseline(id) ON DELETE SET NULL;

CREATE INDEX project_commitment_idx ON project (commitment) WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS project_commitment_idx;
ALTER TABLE project DROP COLUMN IF EXISTS current_baseline_id;
ALTER TABLE project DROP COLUMN IF EXISTS commitment;
DROP TYPE IF EXISTS commitment_level;
ALTER TABLE resource_capacity_timephased
  DROP CONSTRAINT IF EXISTS resource_capacity_timephased_gross_check;
ALTER TABLE resource_capacity_timephased DROP COLUMN IF EXISTS gross_minutes;
ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_reserve_bp_check;
ALTER TABLE resource DROP CONSTRAINT IF EXISTS resource_indirect_bp_check;
ALTER TABLE resource DROP COLUMN IF EXISTS reserve_bp;
ALTER TABLE resource DROP COLUMN IF EXISTS indirect_bp;
