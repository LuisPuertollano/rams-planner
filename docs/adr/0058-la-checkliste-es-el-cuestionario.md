# ADR-0058 — La Checkliste es el cuestionario de la puerta

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** P1, P2, P4

## Contexto

ADR-0056 dio por hecho que la Checkliste oficial era la lista de
entregable × madurez × puerta, y **la hoja de verdad lo desmintió**. Su propia
consulta 0.5 pregunta si los entregables están

> «available as per the maturity defined in the deliverable list in the Safety
> plan»

y la hoja de referencias remite al DTRF «for standard deliverable list with
expected maturity for each design review phase». Esa lista vive en el plan de
seguridad —que es lo que el catálogo ya contiene— y por eso ADR-0056 no declaró
ninguna tabla.

Lo que la hoja **sí** contiene, y no estaba en ninguna parte:

| | |
|---|---|
| Consultas | 51, en 8 capítulos |
| Puertas | 5 (IGR, PGR, CGR, FEI, IQA) |
| Casillas (consulta × puerta) | 255, de las que 166 declaran nivel |
| Textos de «proof request» distintos | 162 |
| Consultas que nombran un entregable | 27 |

## El mecanismo que sustituye

En Excel esto es una rejilla, y la puerta se elige en un desplegable que
alimenta un `VLOOKUP` con el número de columna calculado a mano:

```
N1 = SUM(IF(cabecera = 'Safety DRCL'!$H$2; 3..7; 0))
I6 = VLOOKUP(G6; 'Safety Gate info'!$N$4:$T$62; N1; FALSO)
```

Es un pivote a mano porque una hoja de cálculo no sabe hacer un *join*. Cuesta
lo que cuesta siempre: añadir una puerta es añadir una columna y repasar las 51
fórmulas, y una consulta nueva en medio descoloca el rango.

## Decisión

Tres tablas y un *join*. El desplegable y el `VLOOKUP` pasan a ser
`WHERE gate = $1`:

```
gate_query           (disciplina, capítulo, código, pregunta, orden)
gate_query_gate      (consulta, puerta, nivel M|HR|R|C, proof_request)
gate_query_document  (consulta, entregable, madurez)     ← el enganche
```

Y una función pura, `answerGateChecklist`, que cruza el cuestionario con lo que
ADR-0056 ya resolvió y contesta cada consulta: `cumple`, `no-cumple`,
`sin-saber`, `la-contesta-una-persona` o `puerta-sin-fechar`.

### El reparto es el producto

De las 51 consultas, las que nombran un entregable **las contesta el plan**: ya
sabe si está planificado, en qué versión y si llega a la puerta. Las demás las
contesta una persona. Saber cuáles son antes de entrar en la sala es lo que
convierte una lista de 51 en una lista de 24 — y hoy eso se hace entero a mano.

### El nivel decide la gravedad, y eso es dato, no criterio mío

`M` obligatoria → `error`; `HR` → `warning`; `R` y `C` → `info`. Hasta ahora
todos los avisos de puerta pesaban lo mismo porque **nada declaraba la
importancia**; ahora la declara la Checkliste. Ninguna es bloqueante:
bloqueante en este modelo significa «el motor no puede calcular», y aquí sí
puede — lo que pasa es que la revisión no pasaría.

### El contenido no entra en el repositorio

La Checkliste es un documento controlado del departamento. Aquí va el modelo y
su importador; las consultas se cargan por CSV en cada instalación, igual que
el catálogo de entregables (ADR-0027). Una fila por **casilla**, no una columna
por puerta: así añadir una puerta es añadir filas y no cambiar el formato.

## Dos discrepancias medidas, que son de Luis y no mías

Las puertas de la Checkliste y las que declara la cartera real **no coinciden
del todo**, y esto se midió contra `planner_real` (34 proyectos):

| | |
|---|---|
| Declaradas por los proyectos | CGR, FQA, GFV, **IGR**, IQR, **PGR**, SGR, VGR |
| Columnas de la Checkliste | **IGR**, **PGR**, **CGR**, FEI, IQA |

- **IGR, PGR y CGR** casan tal cual. No hace falta ninguna tabla de
  equivalencias.
- **FEI** no la declara ningún proyecto. En la hoja `GR Chainage` del libro
  aparece como «Sub-sys only», con `N/A` a nivel de tren.
- **IQA** no la declara ningún proyecto, que declaran **IQR**. La misma hoja
  las pone en la misma fila: IQR a nivel de tren, IQA a nivel de módulo.

La herramienta **no adivina**: una consulta de una puerta que el proyecto no ha
fechado sale como `puerta-sin-fechar` y se enseña. Callarlo dejaría una puerta
entera fuera del repaso sin que nadie lo notase.

## Comprobado

- 20 pruebas nuevas: 12 sin base sobre el cruce y 8 contra PostgreSQL sobre el
  importador, que es donde está el riesgo de un formato que se mantiene desde
  una hoja de cálculo.
- La prueba que más decide: **volver a cargar el mismo fichero deja el mismo
  cuestionario**, no el doble. Y quitar una fila quita esa puerta de verdad.
- Un entregable que la hoja nombra y el catálogo no tiene **avisa y carga el
  resto**: las dos listas las mantiene gente distinta, y un nombre que todavía
  no existe es información, no una razón para no cargar doscientas filas.
- Migración `up` y `down` contra PostgreSQL 16.
- Encontrado escribiendo las pruebas: `sort_key` se asigna **por importación**,
  así que dos ficheros cargados en la misma disciplina interleavan su orden. Es
  correcto —una Checkliste es una hoja y se carga entera— pero conviene saberlo
  y está dicho en el propio fichero de pruebas.
