-- migrate:up
-- ---------------------------------------------------------------------------
-- El plan se puede calcular hacia atrás, desde la puerta
-- ---------------------------------------------------------------------------
-- En un proyecto RAMS la fecha que manda no es la de empezar: es la de la
-- puerta de certificación. El libro del equipo siempre lo ha sabido —su motor
-- ancla en IQA/FQA y va hacia atrás— y el planner hacía lo contrario: empujaba
-- desde el arranque y avisaba cuando no llegaba.
--
-- Las dos cosas hacen falta, y por eso esto es un MODO y no un cambio:
--
--   adelante  ¿cuándo termina esto si empiezo ya?   (lo de siempre)
--   atras     ¿cuándo tengo que empezar para llegar? (lo que pedía el libro)
--
-- Va por proyecto y no por instalación porque conviven: una oferta se planifica
-- hacia delante para saber qué se promete, y un proyecto en marcha hacia atrás
-- para saber si la puerta es alcanzable.

CREATE TYPE schedule_mode AS ENUM ('adelante', 'atras');

ALTER TABLE project
    ADD COLUMN schedule_mode schedule_mode NOT NULL DEFAULT 'adelante';

COMMENT ON COLUMN project.schedule_mode IS
    'adelante: las tareas van a su fecha más temprana. atras: van a la más tardía que todavía llega a su puerta.';

-- migrate:down
ALTER TABLE project DROP COLUMN IF EXISTS schedule_mode;
DROP TYPE IF EXISTS schedule_mode;
