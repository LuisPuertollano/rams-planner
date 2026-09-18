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
| [0016](0016-documentos-y-precedencias.md) | Los documentos y su matriz: el orden del ciclo de vida, declarado una vez | P1 |
| [0017](0017-cuatro-idiomas.md) | La interfaz en cuatro idiomas, con el castellano como fuente | — |
| [0018](0018-aplicar-la-matriz.md) | Aplicar la matriz a un proyecto: la propuesta se enseña antes de escribirse | P2, P4 |
| [0019](0019-informes.md) | Informes: un resumen sin frases hechas, sobre una ejecución y un periodo | P2, P3, P4 |
| [0020](0020-hallazgos-traducidos.md) | Los hallazgos, traducidos desde el código y no desde la frase | P2, P4 |
| [0021](0021-permisos-traducidos.md) | El catálogo de permisos en cuatro idiomas; los nombres de los roles no se traducen | P1 |
| [0022](0022-errores-con-codigo.md) | Los errores de la API llevan código estable; la frase se escribe en la interfaz | P1 |
| [0023](0023-capacidad-neta-y-compromiso.md) | Capacidad neta frente a bruta, compromiso del proyecto y línea base de referencia | P1, P2, P4, P5 |
| [0024](0024-estado-del-proyecto.md) | El estado del proyecto decide qué entra en el cálculo; el enlace que cruza a lo archivado se avisa | P1, P2, P3, P4 |
| [0025](0025-ci-arranca-el-contenedor.md) | CI construye la imagen y la arranca; una regla vigila las listas del Dockerfile | — |
| [0026](0026-las-horas-reales.md) | Las horas reales van al informe, no al motor; el trabajo fuera de plan se cuenta y se dice | P1, P2, P3, P5 |
| [0027](0027-catalogo-de-entregables.md) | La ficha del entregable, el catálogo por CSV y una pantalla que aguanta ochenta filas | P1, P5, P6 |
| [0028](0028-el-fichero-se-explica-solo.md) | El contrato de cada importación vive en un sitio; la plantilla trae su manual dentro | P1, P6 |
| [0029](0029-una-portada-y-seis-pestanas.md) | Una portada que contesta «¿qué miro hoy?» y catorce pestañas agrupadas en seis | P1, P7 |
| [0030](0030-ni-una-frase-a-mano.md) | Ni una frase de la interfaz escrita a mano: todo al diccionario, y una regla que lo vigila | P1, P6 |
| [0031](0031-el-panel-de-capacidad.md) | El panel de capacidad reproduce la hoja de Excel que ya se usaba, con sus tablas rellenas | P1, P2, P5, P7 |
| [0032](0032-el-ciclo-de-firma-por-rol.md) | Quién escribe, verifica y aprueba cada entregable: por rol, nunca por persona | P1, P2, P5, P6 |

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
