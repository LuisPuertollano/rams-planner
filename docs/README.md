# Documentación

| Documento | Qué responde |
|-----------|--------------|
| [`uso-por-rol.md`](uso-por-rol.md) | **Empieza aquí para usar la herramienta**: qué hace tu rol y por dónde empieza |
| [`manual-de-uso.md`](manual-de-uso.md) | Para quien planifica: qué hacer, en qué orden, y cómo leer lo que sale |
| [`operacion.md`](operacion.md) | Levantar, copiar, actualizar, volver atrás y qué mirar cuando algo va mal |
| [`diseno/`](diseno/) | La especificación completa: objetivos, dominio, esquema, motor, arquitectura, auditoría, vistas y plan |
| [`adr/`](adr/) | Las decisiones estructurales, con sus alternativas descartadas |
| [`prompt-inicial.md`](prompt-inicial.md) | El enunciado con el que nació el proyecto |

Y en la raíz del repositorio, [`CLAUDE.md`](../CLAUDE.md): las convenciones de trabajo
—unidades, reglas, puertas de fase— que debe leer cualquiera que toque el código.

## Por dónde empezar

- **Para usar la herramienta**: [`uso-por-rol.md`](uso-por-rol.md) primero —son
  cuarenta líneas y te dice qué te toca—, y [`manual-de-uso.md`](manual-de-uso.md)
  cuando una pantalla concreta te deje una duda. No hace falta nada de lo demás.
- **Para mantenerla en marcha**: [`operacion.md`](operacion.md).
- **Para entender qué es esto**: [`diseno/01-objetivos-y-principios.md`](diseno/01-objetivos-y-principios.md).
- **Para tocar la base de datos**: [`diseno/03-esquema-de-datos.md`](diseno/03-esquema-de-datos.md).
- **Para tocar el motor**: [`diseno/04-motor-de-calculo.md`](diseno/04-motor-de-calculo.md),
  y en particular su lista de 40 casos límite, que es el contrato de pruebas.
- **Para saber qué toca ahora**: [`diseno/08-plan-de-implementacion.md`](diseno/08-plan-de-implementacion.md).
