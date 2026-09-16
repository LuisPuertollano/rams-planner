# 01 · Objetivos y principios

## 1.1 El objetivo

Calcular, de forma **fiable, reproducible y explicable**, la carga de trabajo de un
equipo de ingeniería repartido entre varios proyectos simultáneos, y permitir
simular el efecto de cambios antes de comprometerlos.

### Preguntas que el sistema debe contestar

| # | Pregunta | Vista que la contesta |
|---|----------|----------------------|
| P1 | ¿Cuántas horas tiene comprometidas Ana en marzo, y en qué proyectos? | Matriz de carga |
| P2 | ¿Quién está por encima de su capacidad, cuándo y por cuánto? | Mapa de calor de saturación |
| P3 | ¿Por qué esta tarea empieza el 14 de abril y no antes? | Panel «¿por qué?» |
| P4 | Si acepto el proyecto X, ¿qué se rompe? | Comparador de escenarios |
| P5 | ¿En qué se diferencia el plan de hoy del que aprobamos en enero? | Diff contra línea base |
| P6 | ¿Cuánta capacidad libre tiene el equipo en el segundo semestre? | Capacidad vs. demanda |
| P7 | ¿Las horas realmente imputadas cuadran con lo planificado? | Plan vs. real |
| P8 | ¿Quién cambió esta estimación, cuándo y por qué? | Registro de cambios |
| P9 | ¿Qué pasa si Ana se va dos meses? | Escenario «what-if» de disponibilidad |
| P10 | ¿Este paquete de trabajo se está pasando del esfuerzo estándar? | Benchmarking |

Si una funcionalidad propuesta no sirve a ninguna de estas diez preguntas, no entra.

## 1.2 No-objetivos (explícitos)

Decir «no» aquí es lo que evita que la herramienta se convierta en un clon mediocre
de Microsoft Project.

- **NO** se busca fidelidad numérica con Microsoft Project. Se busca que *nuestros*
  números sean correctos y explicables. Reproducir los casos límite de Project
  (nivelación exacta, restricciones en conflicto, `Fixed Duration` + unidades
  parciales) es multi-año y no aporta valor.
- **NO** se escribirá el formato `.mpp`. Es cerrado y no documentado. El intercambio,
  si algún día hace falta, va por **MS Project XML** (documentado) o Excel.
- **NO** es un gestor de tareas del día a día (no compite con Jira/Planner). La unidad
  mínima útil es la tarea de varios días con esfuerzo estimado, no el ticket.
- **NO** hay multi-tenant, facturación ni portal de clientes en el alcance.
- **NO** hay recálculo mágico implícito. El recálculo es una acción explícita y deja
  rastro (ver principio 3).

## 1.3 Los siete principios

Estos principios tienen prioridad sobre cualquier conveniencia de implementación.
Cuando haya conflicto entre dos, gana el de número más bajo.

### P1 · Lo declarado y lo derivado no se tocan

Ningún campo que el usuario escribe puede ser sobrescrito por el motor, y ningún
campo que el motor calcula puede ser editado por el usuario. Viven en tablas
distintas. Si quieres fijar una fecha, no editas la fecha calculada: declaras una
**restricción**, que es un dato de entrada, y el motor la respeta y lo dice.

> *Por qué:* es la causa raíz de la desconfianza en Project. Allí arrastras una barra
> del Gantt y sin avisarte se crea una restricción `Start No Earlier Than` que
> envenena el plan durante meses.

### P2 · El motor es una función pura y determinista

`calcular(snapshot, versión_motor) → resultado`. Sin I/O, sin `now()`, sin `random()`,
sin orden de iteración dependiente de un hash. Los desempates son explícitos y
documentados. Mismo snapshot ⇒ mismo resultado, siempre.

> *Por qué:* sin esto no hay auditoría posible. Con esto, cualquier número de
> cualquier informe pasado se puede reproducir con un comando.

### P3 · Todo resultado pertenece a una ejecución identificada

No existen «los datos calculados». Existen «los datos calculados en la ejecución
`run_2026-03-14T09:22Z#a3f9`, motor v1.4.2, hash de entradas `9c1e…`». Las ejecuciones
se conservan, se comparan y se congelan (eso es una línea base).

### P4 · Todo número derivado sabe explicarse

Cada valor calculado lleva asociada su **derivación**: qué regla lo produjo y con qué
entradas. La UI expone eso como un panel «¿por qué?» con un árbol navegable hasta los
datos declarados. No es logging de depuración: es una salida de primera clase del motor.

### P5 · Aritmética entera y explícita

Tiempo en **minutos laborables enteros**. Dinero en **céntimos enteros**. Porcentajes en
**puntos base enteros** (10000 = 100 %). Los redondeos ocurren en un único sitio
documentado y en la capa de presentación, jamás acumulándose dentro del motor.

> *Por qué:* «0,4 h de diferencia» al sumar un año de trabajo destruye la confianza tan
> eficazmente como un error grave, y cuesta el triple diagnosticarlo.

### P6 · El esquema modela conceptos, no pantallas

Una tarea es una tarea aunque la UI la pinte en tres sitios. La jerarquía es un árbol
genérico, no tres tablas rígidas. Los atributos específicos del dominio (tag RAMS,
nivel SIL, centro de coste) son **campos personalizados definidos en datos**, no
columnas. Cambiar de metodología no debe requerir una migración.

### P7 · El historial es inmutable y de sólo-añadir

Ninguna operación destruye información. `DELETE` es un `deleted_at`. Cada mutación
genera un evento append-only con actor, momento, antes, después y motivo. El estado
actual es una proyección del log, no la verdad única.

## 1.4 Criterios de «perfecta» (medibles)

La herramienta se considera terminada cuando:

1. Un cálculo de 5 000 tareas y 50 recursos sobre 5 años termina en **< 2 s**.
2. Cualquier celda de la matriz de carga se puede desplegar hasta los datos declarados
   en **≤ 4 clics**, sin salir de la pantalla.
3. Reproducir un `calculation_run` de hace un año con la CLI da resultado **idéntico**
   (verificado por hash), o dice explícitamente qué versión del motor haría falta.
4. El núcleo de cálculo tiene **cobertura de ramas ≥ 95 %** y un corpus de *golden files*
   con, como mínimo, los 40 casos límite listados en el documento 04.
5. Añadir un campo personalizado nuevo, con su columna en la matriz y su filtro, es una
   acción de **usuario** que no requiere despliegue.
