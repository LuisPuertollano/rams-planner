# Documentación

| Documento | Qué responde |
|-----------|--------------|
| [`diseno/`](diseno/) | La especificación completa: objetivos, dominio, esquema, motor, arquitectura, auditoría, vistas y plan |
| [`adr/`](adr/) | Las decisiones estructurales, con sus alternativas descartadas |
| [`prompt-inicial.md`](prompt-inicial.md) | El enunciado con el que nació el proyecto |

Y en la raíz del repositorio, [`CLAUDE.md`](../CLAUDE.md): las convenciones de trabajo
—unidades, reglas, puertas de fase— que debe leer cualquiera que toque el código.

## Por dónde empezar

- **Para entender qué es esto**: [`diseno/01-objetivos-y-principios.md`](diseno/01-objetivos-y-principios.md).
- **Para tocar la base de datos**: [`diseno/03-esquema-de-datos.md`](diseno/03-esquema-de-datos.md).
- **Para tocar el motor**: [`diseno/04-motor-de-calculo.md`](diseno/04-motor-de-calculo.md),
  y en particular su lista de 40 casos límite, que es el contrato de pruebas.
- **Para saber qué toca ahora**: [`diseno/08-plan-de-implementacion.md`](diseno/08-plan-de-implementacion.md).
