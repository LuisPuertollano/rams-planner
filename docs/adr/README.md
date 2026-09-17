# Decisiones de arquitectura

Cada decisión estructural, con lo que se descartó y por qué. Si dentro de dos años algo
parece una mala idea, aquí está el razonamiento que había detrás.

| # | Decisión | Principio que sirve |
|---|----------|--------------------|
| [0001](0001-separacion-declarado-derivado.md) | Separación física entre lo declarado y lo derivado | P1 |
| [0002](0002-aritmetica-entera.md) | Aritmética entera en todo el núcleo | P5 |
| [0003](0003-sin-orm.md) | SQL explícito, sin ORM | — |
| [0004](0004-arbol-wbs-recursivo.md) | Un árbol WBS recursivo, no una jerarquía fija | P6 |
| [0005](0005-grano-diario.md) | Grano diario en la carga distribuida | P5 |
| [0006](0006-motor-puro-en-los-dos-lados.md) | El motor es puro y corre en servidor y navegador | P2 |
| [0007](0007-derivaciones-de-primera-clase.md) | Las derivaciones son una salida del motor | P4 |
| [0008](0008-lineas-base-son-ejecuciones-congeladas.md) | Una línea base es una ejecución congelada | P3 |
| [0009](0009-nivelacion-heuristica-opcional.md) | Nivelación heurística, determinista y opcional | P2 |
| [0010](0010-restricciones-explicitas.md) | Restricciones explícitas y deadlines blandos | P1 |
| [0011](0011-campos-personalizados-como-datos.md) | Los campos del dominio son datos, no columnas | P6 |
| [0012](0012-sin-escritura-de-mpp.md) | No se escribe el formato .mpp | — |
| [0013](0013-historial-append-only.md) | Historial append-only con borrado lógico | P7 |
| [0014](0014-nivelacion-por-retraso.md) | La nivelación empuja fechas, y dice cuándo eso no basta | P2 |
| [0015](0015-autenticacion-y-permisos.md) | Autenticación y permisos: quién entra, qué ve y qué puede hacer | P1 |
<<<<<<< HEAD
| [0016](0016-documentos-y-precedencias.md) | Los documentos y su matriz: el orden del ciclo de vida, declarado una vez | P1 |
=======
| [0017](0017-cuatro-idiomas.md) | La interfaz en cuatro idiomas, con el castellano como fuente | — |
>>>>>>> c06a2f7 (La herramienta habla cuatro idiomas)

## Decisiones tomadas por defecto

Se cerraron al arrancar el proyecto para que no hubiera ambigüedad, no porque sean
intocables. Revisarlas es barato ahora y caro más adelante — sobre todo la primera.

| Decisión | Valor | Cuándo revisarla |
|----------|-------|------------------|
| Idioma de la interfaz | Español, con i18n desde el primer día. Identificadores de código, base de datos y API en inglés | Antes de la fase 4: añadir i18n después es caro |
| Autenticación | Local con sesiones, y OIDC detrás de una interfaz para conectar un SSO. Roles `admin`, `planner`, `viewer` | Cuando haya SSO en el homelab |
| Imputaciones de horas | Se importan (CSV/Excel). No se construye un módulo de partes de horas | Si el equipo no tiene de dónde importarlas |
| Costes | En el esquema desde el principio; la interfaz se aplaza a la fase 6 | Si hacen falta antes |
| Concurrencia | Optimista con `ETag`/`If-Match`. Sin edición colaborativa en tiempo real | Si más de una persona planifica a la vez de forma habitual |

## Escribir un ADR

Antes de implementar cualquier decisión con alternativas reales. Corto: contexto,
decisión, alternativas descartadas, coste aceptado. El valor está en las alternativas
descartadas — es lo que evita volver a discutir lo mismo dentro de un año.
