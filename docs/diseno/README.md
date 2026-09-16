# Diseño del sistema

Especificación completa, escrita antes de la primera línea de código de producción.

| # | Documento | Qué responde |
|---|-----------|--------------|
| 01 | [Objetivos y principios](01-objetivos-y-principios.md) | Qué debe hacer, qué **no** debe hacer, y las 7 reglas que gobiernan todas las demás decisiones |
| 02 | [Modelo de dominio](02-modelo-de-dominio.md) | Los conceptos, sus invariantes y el vocabulario único del sistema |
| 03 | [Esquema de datos](03-esquema-de-datos.md) | Las cuatro zonas, por qué cada tabla es como es, y los invariantes que impone PostgreSQL |
| 04 | [Motor de cálculo](04-motor-de-calculo.md) | Calendarios, CPM, distribución temporal de carga, nivelación. Con pseudocódigo y 40 casos límite |
| 05 | [Arquitectura técnica](05-arquitectura-tecnica.md) | Paquetes, capas, stack, API, despliegue, pruebas |
| 06 | [Auditoría y explicabilidad](06-auditoria-y-explicabilidad.md) | Cómo se responde a «¿de dónde sale este número?» |
| 07 | [Interfaz y vistas](07-interfaz-y-vistas.md) | Las 8 pantallas y qué pregunta contesta cada una |
| 08 | [Plan de implementación](08-plan-de-implementacion.md) | Fases, criterios de aceptación, esfuerzo, riesgos |

Las decisiones estructurales viven en [`../adr/`](../adr/), una por fichero.

## Resumen en una página

**El problema real.** Un equipo de N ingenieros repartido entre M proyectos. La pregunta
que la herramienta debe contestar, en cualquier momento y sin ambigüedad:

> *¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto — y cuánta
> capacidad le queda?*

Y la de segundo orden, que es la que decide contratos:

> *Si acepto este proyecto nuevo, ¿quién se satura, cuándo, y cuánto?*

**La idea central.** El sistema separa de forma absoluta tres cosas que las herramientas
del mercado mezclan, y esa mezcla es la razón por la que nadie se fía de sus números:

```
   DECLARADO                 DERIVADO                   REAL
   lo que tú afirmas    →    lo que el motor calcula  ←  lo que pasó
   (duración, trabajo,       (fechas, holgura,           (partes de horas,
    dependencias,             carga mensual,               avance reportado)
    disponibilidad)           saturación)

   editable                  NUNCA editable             editable, con fuente
   rol planner_api           rol planner_engine         rol planner_api
                             ligado a un calculation_run
```

Nada derivado se guarda junto a lo declarado, y la separación la impone PostgreSQL con
permisos, no la disciplina del código. Todo valor derivado pertenece a una **ejecución de
cálculo** identificada, con versión de motor y hash de entradas. Dos ejecuciones se
comparan campo a campo. Una línea base no es un tipo de dato especial: es una ejecución
congelada.

**El motor es una función pura.** `calcular(PlanSnapshot) → PlanResult`. Sin base de
datos, sin reloj, sin aleatoriedad. Mismo snapshot ⇒ mismo resultado, bit a bit, hoy y
dentro de tres años. Eso es lo que hace el sistema auditable: se puede coger el snapshot
de entrada de un cálculo de hace un año, pasarlo por la CLI y reproducir exactamente el
número que hay en aquel informe.

**Toda unidad es entera.** Minutos laborables, céntimos, puntos base. Cero aritmética de
coma flotante en el núcleo, cero deriva de redondeo al agregar 250 días en un mes.

**La adaptabilidad es de diseño, no un parche.** Un árbol WBS recursivo en vez de una
jerarquía rígida; campos personalizados definidos por el usuario como datos, no como
migraciones; reglas de aviso declarativas. Lo que hoy es «tag RAMS» y mañana es «nivel
SIL» o «centro de coste» no debe tocar el esquema.
