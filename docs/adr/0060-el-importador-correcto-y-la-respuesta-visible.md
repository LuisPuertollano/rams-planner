# ADR-0060 — El importador correcto, y la respuesta donde se mira

**Estado:** aceptada · **Fecha:** 2026-09-23 · **Principios:** —

## Contexto

Luis dijo: «¿puedes poner una confirmación de que un import se ha hecho
correctamente? No hay feedback». Reproducido en un navegador de verdad, no era
un defecto sino **dos**, y el primero era peor de lo que el síntoma sugería.

### 1. La Checkliste se cargaba contra el catálogo de documentos

`ImportDialog` era una cadena de `if (tipo === …)` que terminaba en un `return`
**sin condición**. Al añadir `'checklist'` a la unión de tipos en ADR-0058 sin
su rama, elegir «La Checkliste de revisión» caía en ese último `return` y abría
el importador del catálogo de entregables. Medido:

| | |
|---|---|
| Diálogo que se abría | «Una fila por entregable, hito o fase…» |
| Petición que salía | `POST /api/documents/import` |
| Respuesta | `422 · Falta la columna «nombre»` |

El mensaje era cierto, y era sobre un formato que nadie había elegido.

TypeScript no podía verlo: la caída pasaba `tipo="documents"` como literal, que
es válido. Y había una segunda mitad del mismo olvido: `CHECKLIST_SPEC` entró en
`IMPORT_SPECS` —por eso la pantalla ofrecía la tarjeta— pero nadie llamó a
`servirFormato`, así que `/api/import/checklist/formato` no existía. No se notó
porque el diálogo pedía el contrato del otro.

### 2. La respuesta se dibujaba dos pantallas más arriba

Medido en el navegador: el cuerpo del diálogo mide **2767 px** y se ven **836**.
El botón que carga el fichero está **al final**; el banner de resultado se pinta
**al principio**. Se carga un fichero desde abajo del todo y la respuesta —el
«ha ido bien» o el «te falta una columna»— aparece fuera de la pantalla. La
herramienta contestaba y parecía no contestar.

## Decisión

**Un `switch` sin `default`.** Faltar una rama deja de compilar. Comprobado
quitándola: `TS2366, Function lacks ending return statement and return type does
not include 'undefined'`. Y una sola unión, `TipoDeCsv`, en vez de dos listas
paralelas que se separan.

**La respuesta manda cuando llega.** Al terminar bien, el contrato —reglas,
columnas, plantilla— se aparta y deja en pantalla lo que acaba de pasar, con
«Cerrar» y «Cargar otro fichero». Y tanto el resultado como el error se llevan
a la vista con `scrollIntoView`, porque el error sí necesita el contrato al
lado para arreglar el fichero.

**La Checkliste dice lo suyo al terminar:** cuántas consultas, cuántas nuevas y
actualizadas, cuántas casillas de puerta, cuántos enganches con el catálogo,
**qué puertas nombra la hoja** —que es lo que hay que cotejar con las que
declaran los proyectos— y cuántas consultas las contesta una persona.

## Las dos guardias

Lo que el compilador no ve es una rama que **existe** y pasa el tipo de otra:
`case 'checklist'` pintando `tipo="documents"` compila igual de bien. Dos
pruebas, cada una verificada mutando el código para comprobar que falla:

1. **Cada rama pinta SU tipo.** Lee el fichero del disco, como las reglas de
   `tools/`. Mutada a `tipo="documents"` en la rama de la Checkliste: falla con
   «la rama de «checklist» pinta documents».
2. **Cada importación declarada sirve su contrato y su plantilla.** Registra las
   rutas de verdad y las audita. Mutada quitando `servirFormato(CHECKLIST_SPEC)`:
   falla nombrando `/api/import/checklist/formato`.

## Comprobado

- La importación entera, en un navegador: abre el diálogo correcto, va a
  `/api/gates/checklist/import`, y carga **51 consultas y 166 casillas de
  puerta** con su confirmación visible.
- 4 pruebas nuevas, las dos guardias verificadas por mutación.
- Las siete reglas de `tools/` en verde.

## Lo que esto enseña

El síntoma era «no hay feedback» y la causa era «el botón hace otra cosa». Si se
hubiera arreglado el síntoma —un banner más grande, un toast— la Checkliste
habría seguido cargándose contra el catálogo de documentos, ahora con una
confirmación bien visible de algo que no era lo que se pidió.
