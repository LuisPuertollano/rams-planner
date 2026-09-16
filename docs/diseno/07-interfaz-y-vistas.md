# 07 · Interfaz y vistas

Ocho vistas. Cada una existe porque contesta una pregunta del documento 01. Si una
vista no contesta ninguna, sobra.

## V1 · Matriz de carga  *(P1, P6 — la vista principal)*

La pantalla por la que existe la herramienta. Cuadrícula virtualizada:

```
                    │ Ene 26 │ Feb 26 │ Mar 26 │ Abr 26 │ May 26 │
────────────────────┼────────┼────────┼────────┼────────┼────────┤
▼ Ana Müller        │  120 h │  148 h │  168 h │  104 h │   88 h │
   capacidad        │  112 h │  128 h │  147 h │  133 h │  140 h │
   saturación       │  107 % │  116 % │  114 % │   78 % │   63 % │
   ├ P-2026-03 RAMS │   80 h │   96 h │  120 h │   64 h │   40 h │
   │  └ Revisión SIL│   40 h │   48 h │   60 h │        │        │
   └ P-2026-07 CBTC │   40 h │   52 h │   48 h │   40 h │   48 h │
▼ Marc Iglesias     │   96 h │  104 h │   96 h │  120 h │  136 h │
```

- Filas: recurso → proyecto → paquete → tarea (el árbol WBS completo, desplegable).
- Columnas: mes por defecto; conmutable a semana, trimestre o día sin recargar (todo
  sale de la misma tabla diaria).
- Transponible: proyecto → recurso, o agrupada por competencia, etiqueta o campo
  personalizado.
- Celdas editables **sólo** si corresponden a un contorno manual. El resto es derivado
  y por tanto de sólo lectura, con el candado visible (P1 hecho tangible).
- Clic en cualquier celda → panel «¿por qué?» (doc 06).
- Exporta a Excel conservando la jerarquía y las fórmulas de totales.

## V2 · Mapa de calor de saturación  *(P2)*

Recursos × tiempo, color por utilización. Escala divergente centrada en el 100 %:
azul = infrautilizado, neutro = equilibrado, rojo = sobrecargado. Se conmuta entre
grano mensual y **diario**, porque un recurso al 95 % en el mes puede estar al 300 %
tres días concretos, y ese es el dato que duele.

Clic en una celda roja → lista de asignaciones que causan la sobrecarga, ordenadas por
contribución, con acción directa «mover», «reducir dedicación» o «reasignar», cada una
mostrando su impacto antes de confirmar.

## V3 · Gantt  *(P3)*

Con lo que un Gantt tiene que tener y casi nunca tiene:

- Barras de línea base superpuestas (fantasma gris), no en una fila aparte.
- Camino crítico con umbral de holgura configurable.
- Enlaces dibujables; **al arrastrar una barra se abre un diálogo explícito**: «¿quieres
  crear la restricción *no empezar antes del 14/04*?». Nunca se crea una restricción
  silenciosa (la lección nº 1 aprendida de Microsoft Project).
- Deadlines como marcadores, visualmente distintos de las restricciones.
- Franja de capacidad del recurso bajo cada barra.

## V4 · Hoja de plan

Cuadrícula tipo hoja de cálculo sobre el árbol WBS: columnas configurables (incluidos
campos personalizados y calculados), edición en línea, copiar/pegar desde Excel,
relleno hacia abajo, deshacer multinivel. Es la vista donde de verdad se introducen los
datos, y por eso tiene que ser rápida con el teclado: sin ella, la herramienta se usa
una semana y se vuelve al Excel.

Las columnas derivadas van con fondo distinto y candado. Siempre.

## V5 · Comparador de escenarios  *(P4, P5)*

Dos ejecuciones lado a lado con el diff del doc 06 resaltado. Modo especial «¿qué pasa
si acepto este proyecto?»: se crea un escenario `whatif`, se añade el proyecto
candidato y la vista responde con tres cifras y una lista:

- cuántas personas-mes libres quedan,
- quién se satura y en qué meses,
- qué tareas existentes se retrasarían si se nivela.

## V6 · Plan vs. real  *(P7, P10)*

Por tarea y por mes: planificado, imputado, restante, desviación. Con la curva S de
trabajo acumulado y, si se activa, valor ganado (BCWS/BCWP/ACWP, CPI, SPI). El
benchmarking contra `standard_effort_minutes` vive aquí: qué paquetes se pasan
sistemáticamente del esfuerzo estándar y en cuánto.

## V7 · Recursos y disponibilidad  *(P9)*

Ficha del recurso: calendario efectivo pintado (con herencia visible: «hereda de
base_bw, sobrescribe los viernes»), periodos de disponibilidad, ausencias, tarifas con
vigencia, competencias, y la carga resultante en la misma pantalla. Editar unas
vacaciones y ver inmediatamente qué se rompe es el flujo principal de esta vista.

## V8 · Hallazgos e historial  *(P8)*

Bandeja de todos los `finding` de la ejecución activa, agrupados por severidad, con
enlace directo a la entidad y a su explicación. Y la línea de tiempo de cambios
filtrable por entidad, actor y periodo.

---

## Principios de interfaz

1. **Lo derivado se ve derivado.** Fondo distinto, candado, y al pasar el ratón el
   `runId` que lo produjo. El usuario nunca debe dudar de si un número lo escribió él.
2. **Ningún efecto secundario invisible.** Toda acción que cree una restricción, cambie
   un tipo de tarea o altere un valor declarado lo dice antes de hacerlo, con el
   impacto previsto.
3. **Previsualización antes de comprometer.** Editar muestra el resultado provisional
   (calculado en el navegador) con marca visual clara; guardar lo hace oficial.
4. **Una sola fuente de cifras.** Toda vista consulta la misma tabla derivada de la
   misma ejecución. Dos pantallas no pueden contradecirse, por construcción.
5. **Teclado primero** en las vistas de datos. La velocidad de entrada es lo que decide
   si la herramienta se usa o se abandona por Excel.
6. **Vacío informativo.** Una matriz sin datos explica qué falta para llenarla, no
   muestra una tabla en blanco.
7. **Todo exportable.** Cualquier vista → Excel/CSV con la misma jerarquía y el `runId`
   en la cabecera, para que el fichero exportado siga siendo auditable fuera.
