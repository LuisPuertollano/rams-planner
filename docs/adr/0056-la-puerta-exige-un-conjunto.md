# ADR-0056 — La puerta exige un conjunto, y el plan dice si llega

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** P1, P2, P4

## Contexto

Desde ADR-0042 la puerta de un entregable le pone fecha objetivo a la tarea que
lo entrega, y desde ADR-0047 esa tarea se parte en las entregas que pide la
Checkliste. Las dos miran **desde la tarea**: cada entrega sabe su día.

Nadie mira **desde la puerta**, que es como la mira una revisión de
certificación. Y hay tres cosas que sólo se ven desde ahí:

1. **Lo que falta.** Una entrega que nadie ha planificado no es una tarea que
   llega tarde: es una tarea que no está. No puede generar `DEADLINE_MISSED`
   porque no hay nada a lo que ponerle la fecha.
2. **El conjunto.** Que once entregas lleguen a una puerta y tres no, decide la
   puerta entera. Tres avisos sueltos en una lista de ciento cuatro, no.
3. **La fecha objetivo puede no estar puesta.** `applyGateDeadlines` escribe
   sólo las tareas que alguien dejó marcadas. Una entrega sin objetivo aplicado
   no avisa de nada aunque su puerta sea el martes.

## Decisión

Una función pura, `assessGateReadiness`, cruza **lo que cada puerta exige** con
**lo que el plan tiene** y dice, fila a fila, en qué estado llega cada entrega:
`a-tiempo`, `tarde` (con los días), `sin-partir`, `sin-fecha` y
`sin-fecha-de-puerta`. Dos hallazgos nuevos, `GATE_EVIDENCE_LATE` y
`GATE_EVIDENCE_MISSING`, dicen lo mismo en el idioma de quien mira.

No escribe nada y no recalcula: se sirve de una ejecución concreta y la
devuelve con su `runId`, como el informe.

### Lo que NO se declara, y por qué (P1)

**No hay tabla nueva.** El conjunto que una puerta exige ya está dicho en dos
sitios: `document_gate` trae las entregas previas de cada documento —con su
puerta y su madurez, que es literalmente una fila de Checkliste— y
`document_type.gate` trae la final. La expectativa se **une** de esos dos, no
se vuelve a declarar.

Esto no es pereza: **lo dice la propia Checkliste oficial**. En la hoja del
departamento (RSA-RS-FRM-004 v1.3, 51 consultas × 5 puertas) la consulta 0.5
pregunta

> «Are the deliverables, required for the phase, available **as per the
> maturity defined in the deliverable list in the Safety plan**?»

y la hoja de referencias remite al DTRF 150805 «for standard deliverable list
with expected maturity for each design review phase». Es decir: la lista de
entregable × madurez × puerta **no vive en la Checkliste**; vive en el plan de
seguridad, que es exactamente lo que el catálogo del planner ya contiene. Una
tabla nueva aquí sería una segunda copia de esa lista, y dos copias divergen.

### El recorte que evita cuatrocientos avisos falsos

Las expectativas son del catálogo, que es del departamento entero: 88
documentos. Se recortan a **los documentos que este proyecto entrega**. Es
conservador a propósito —calla de más, no de menos—, y se cae solo el día que
la Checkliste diga qué documentos aplican a qué proyecto.

## Consecuencias

- Una entrega que la Checkliste pide y el plan no tiene deja de ser invisible.
- El aviso no depende de que nadie haya pulsado «aplicar objetivos».
- Es una lectura más: no cambia ningún número del plan ni ninguna fecha.
- La pantalla abre sola las puertas que piden algo. Si todo llega, no hay nada
  que leer.

## Comprobado

Contra la base de demostración, con el catálogo partido en entregas, la
pantalla destapa en un vistazo el defecto que la propuesta de precedencias por
entrega había medido a mano:

| puerta | esperadas | a tiempo | tarde |
|---|---|---|---|
| RP · 10/04/2026 | 3 | 2 | FMECA · preliminar, 12 días |
| RD · 15/05/2026 | 5 | 3 | **SC · preliminar, 32 días**; SIL, 4 días |
| RF · 29/05/2026 | 2 | 1 | SC · as designed, 39 días |
| PES · 07/08/2026 | 1 | 1 | — |

`SC · preliminar` es el caso de la propuesta: vence en RD y hereda las
precedencias de la entrega final, así que el plan la termina 32 días después de
su puerta. Esta pantalla no lo arregla —eso es la otra mitad, las precedencias
por entrega— pero es la primera que lo **enseña sin que nadie lo busque**.

- 20 pruebas nuevas: 15 sin base sobre el cruce y 5 contra PostgreSQL sobre el
  SQL, que es donde estaba el riesgo.
- Verificado **por mutación**: quitar el `NOT EXISTS` que impide contar dos
  veces la entrega final hace fallar una prueba; quitar el `::date` del fin
  hace fallar tres, porque una entrega que termina a las cinco de la tarde del
  día de la puerta pasaría a llegar tarde.
- Mirado en pantalla con Chromium, sin errores de consola.

## Lo que esto no hace

No modela el **orden dentro de una puerta**: dos documentos que vencen en la
misma puerta y uno alimenta al otro siguen necesitando precedencias por
entrega. Y no sabe qué es **obligatorio** y qué es prueba opcional: la
Checkliste lo dice —M, HR, R, C por puerta— y ese es el siguiente paso.
