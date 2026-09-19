# ADR-0059 — La versión vigente en la puerta, no sólo la entregada en ella

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** P2, P4 ·
**Corrige:** ADR-0058

## Contexto

ADR-0058 contestaba cada consulta de la Checkliste buscando el entregable que
nombra **en la puerta de la consulta**. Al preparar el fichero real de Luis
apareció que esa regla es falsa, y no en un caso raro.

Luis confirmó que **IQA e IQR son la misma puerta** y que sus proyectos
declaran IQR. Al aplicar el renombre y mirar qué contestaría la herramienta en
IQR, el dato lo dijo:

| | |
|---|---|
| Entregas que el catálogo declara en IQR | AssmR, NFSaR, RDemR, RMonR, ReVVR, SaC |
| Documentos que la Checkliste engancha | SSPHA, HzLog, SRIL, FMECA, SRAC, SaP |
| Coincidencias | **ninguna** |

Los seis que la Checkliste nombra vencen antes: FMECA, HzLog y SRIL en CGR,
SSPHA y SaP en IGR, SRAC en GFV. Y tiene sentido, porque en IQR la hoja no
pregunta si se entrega el Hazard Log: pregunta si **sigue al día**
(«up-to-date and the evidences available as per the current DR maturity»).

Con la regla de ADR-0058, esas consultas salían **`no-cumple`, con el documento
marcado como «no está en el plan»**, de un documento entregado y terminado
meses antes. 22 filas en IQR y 30 en FEI: un tercio del fichero, todas falsas.

Reproducido antes de tocar nada, con una prueba que ponía el FMECA entregado en
CGR y la consulta en IQR: `ESTADO: no-cumple · falta: [FMECA]`.

## Decisión

La evidencia de un documento en una puerta es **su última entrega cuya puerta
cae en ésta o antes**.

- **Cuando la consulta declara madurez, manda.** Pedir el preliminar en CGR y
  que el plan sólo tenga la final de PGR no es «vigente»: falta el preliminar.
- **Una entrega posterior nunca vale.** En PGR no se puede enseñar algo que se
  entrega en CGR. Esto no se afloja.
- **Una puerta sin fecha no entra en el orden**, porque no se puede saber si va
  antes o después de otra.

Y un estado nuevo, **`vigente-de-antes`**, para cuando la respuesta viene de
una puerta anterior. No se dice «cumple»: la herramienta sabe que el documento
se entregó y llegó a tiempo, pero **si sigue vigente lo dice una persona**, y
decir «cumple» daría una tranquilidad que el plan no puede respaldar. En la
pantalla lleva punto hueco y la fila dice de qué puerta sale la prueba.

## Consecuencias

- Desaparece un tercio de falsos negativos del fichero real.
- El estado `cumple` pasa a significar algo más estrecho y más útil: entregado
  **en esta puerta**, a tiempo.
- La respuesta ya no depende sólo de la puerta: depende del **orden** de las
  puertas del proyecto, que es dato suyo. Un proyecto que no fecha sus puertas
  no obtiene esto, y ya lo decía.

## Comprobado

- 5 pruebas nuevas, y las que importan son las dos que fijan los bordes: **una
  entrega posterior no vale como evidencia**, y **una final anterior no tapa el
  preliminar que la consulta pide**. Sin esas dos, «lo vigente» se convierte en
  «lo que sea».
- Entre dos versiones anteriores manda la más reciente.
- Las 12 pruebas de ADR-0058 siguen pasando sin tocarlas: la regla vieja era un
  caso particular de la nueva.

## Cómo se encontró

No lo encontró ninguna prueba ni releer el código: lo encontró **preparar el
fichero de datos reales y preguntarse qué contestaría la pantalla**. La misma
lección que ADR-0052 y ADR-0055, por tercera vez: el modelo se valida contra el
dato, no contra sí mismo.
