-- migrate:up
-- ---------------------------------------------------------------------------
-- El ciclo de firma de cada entregable: quién lo escribe, quién lo verifica,
-- quién lo aprueba — por ROL, nunca por persona
-- ---------------------------------------------------------------------------
-- Un entregable RAMS no está hecho cuando su autor lo termina: está hecho
-- cuando lo ha verificado alguien distinto y lo ha aprobado quien puede. Los
-- procedimientos del sitio lo traen en tabla, columna a columna:
--
--     Entregable          Autor        Verificador 1  Verificador 2  Aprobador
--     Plan RAM            Ing. RAMS    Ing. Sistemas  Jefe RAMS      PrEM
--     Informes de reparto Ing. RAMS 1  Ing. RAMS 2    Ing. Sistemas  PrEM
--
-- Hasta ahora la herramienta no sabía nada de eso. Sabía que un documento
-- espera a otro, y nada más: para ella un entregable era trabajo de una sola
-- persona, y una verificación —que es esfuerzo de una segunda— no existía.
--
-- **Aquí se guarda el rol, y sólo el rol.** No hay ninguna referencia a
-- `resource` y no la va a haber: quién ocupa hoy el puesto de «Jefe RAMS» es un
-- dato de personas que cambia, se discute y no pinta nada en un catálogo que
-- describe cómo trabaja el equipo. El catálogo dice que hace falta un jefe RAMS
-- distinto del autor; quién sea ese día lo dice el plan del proyecto, no esto.
--
-- Es la primera pieza de la capacidad que los procedimientos exponen y que la
-- herramienta no sabía modelar: la maquinaria sí, los datos no.

-- Los cuatro papeles que los procedimientos distinguen, y sólo esos. Un
-- revisor no firma —opina y se le convoca—, pero está en la misma tabla porque
-- también es tiempo de alguien y se declara en el mismo sitio.
CREATE TYPE signature_step AS ENUM ('author', 'verifier', 'approver', 'reviewer');

CREATE TABLE document_signature (
    document_type_id UUID NOT NULL REFERENCES document_type(id) ON DELETE CASCADE,
    step             signature_step NOT NULL,
    -- «Verificador 1» y «Verificador 2» son el mismo papel dos veces, y el
    -- orden importa: el primero verifica el contenido y el segundo la forma.
    -- Para autor y aprobador vale siempre 1.
    position         SMALLINT NOT NULL DEFAULT 1,
    -- El nombre del rol tal y como lo escribe el equipo: «RAMS Engineer»,
    -- «PrEM», «Jefe de calidad». Texto libre y no una enumeración, por la misma
    -- razón que `discipline`: cada sitio tiene los suyos y una enumeración
    -- obligaría a migrar la base para añadir uno.
    role             TEXT NOT NULL,
    -- Lo que cuesta esa firma, en minutos (P5). Opcional: un equipo que sólo
    -- quiere saber quién firma qué no tiene por qué estimar la verificación.
    -- Ojo con lo que este número NO hace todavía: no entra en la carga de
    -- nadie. Meterlo en el cálculo cambia las cifras de todas las pantallas y
    -- es una decisión aparte, no un efecto secundario de esta migración.
    standard_minutes INTEGER,
    PRIMARY KEY (document_type_id, step, position),
    CONSTRAINT document_signature_position_check CHECK (position >= 1),
    CONSTRAINT document_signature_role_check     CHECK (btrim(role) <> ''),
    CONSTRAINT document_signature_minutes_check
        CHECK (standard_minutes IS NULL OR standard_minutes >= 0)
);

COMMENT ON TABLE document_signature IS
    'Quién escribe, verifica, aprueba y revisa cada entregable, por ROL. Nunca una persona: no hay ni habrá referencia a resource.';
COMMENT ON COLUMN document_signature.position IS
    'Distingue Verificador 1 de Verificador 2, y el orden importa. Autor y aprobador llevan siempre 1.';
COMMENT ON COLUMN document_signature.role IS
    'El nombre del rol tal y como lo escribe el equipo. Texto libre, igual que discipline.';
COMMENT ON COLUMN document_signature.standard_minutes IS
    'Lo que cuesta la firma, en minutos. Declarado; el motor todavía no lo suma a la carga de nadie.';

GRANT INSERT, UPDATE, DELETE ON document_signature TO planner_api;

-- Sin índice adicional: siempre se lee por entregable, y la clave primaria ya
-- empieza por `document_type_id`.

-- migrate:down
DROP TABLE IF EXISTS document_signature;
DROP TYPE IF EXISTS signature_step;
