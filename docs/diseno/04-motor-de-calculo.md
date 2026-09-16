# 04 · Motor de cálculo

El corazón del sistema. Es una **función pura**:

```ts
calculate(snapshot: PlanSnapshot, options: EngineOptions): PlanResult
```

Sin base de datos, sin red, sin `Date.now()`, sin `Math.random()`, sin dependencia del
orden de iteración de un `Map`. Todo lo que necesita entra por `snapshot`; todo lo que
produce sale por `PlanResult`. Es lo que hace posible reproducir cualquier cálculo del
pasado (principio P2).

```mermaid
flowchart LR
  S[PlanSnapshot] --> C1[1· Compilar calendarios]
  C1 --> C2[2· Validar grafo]
  C2 --> C3[3· Resolver ecuación de tarea]
  C3 --> C4[4· Paso adelante CPM]
  C4 --> C5[5· Restricciones]
  C5 --> C6[6· Paso atrás y holguras]
  C6 --> C7[7· Agregar contenedores]
  C7 --> C8[8· Distribución temporal]
  C8 --> C9[9· Capacidad y saturación]
  C9 --> C10[10· Nivelación opcional]
  C10 --> C11[11· Costes]
  C11 --> C12[12· Reglas y hallazgos]
  C12 --> R[PlanResult + derivaciones]
```

---

## Paso 1 · Compilar calendarios

Todo el sistema mide el tiempo en **minutos laborables**. Antes de nada se compila
cada calendario a un índice denso sobre el horizonte del cálculo:

```
CompiledCalendar {
  horizonStart: Date
  dayMinutes:   Int32Array      // minutos laborables de cada día del horizonte
  daySlots:     Slot[][]        // intervalos concretos de cada día
  prefixSum:    Int32Array      // suma acumulada -> búsqueda O(log n)
}
```

Con la suma acumulada, las tres operaciones fundamentales son logarítmicas:

| Operación | Significado | Coste |
|-----------|-------------|-------|
| `workingMinutesBetween(a, b, cal)` | duración real entre dos momentos | O(log n) |
| `addWorkingMinutes(t, m, cal)` | avanzar m minutos laborables | O(log n) |
| `snapToWorkingTime(t, cal, dir)` | llevar un instante al minuto laborable más cercano | O(log n) |

**Resolución del calendario de una tarea** (y se registra cuál se usó, en
`task_result.calendar_used_id`):

```
calendario(tarea) = tarea.calendar_id
                 ?? calendario del único recurso asignado
                 ?? proyecto.calendar_id
                 ?? calendario base del sistema
```

Con varios recursos de calendarios distintos, la tarea usa el calendario del proyecto
y cada **asignación** se distribuye según el calendario de *su* recurso. Es la única
interpretación que no miente cuando Ana trabaja 35 h y Marc 40 h en la misma tarea.

**Herencia.** Un calendario hijo hereda los días del padre y los sobrescribe con sus
propios `week_slot` y `exception`. La compilación es recursiva con detección de ciclos
(invariante C1).

---

## Paso 2 · Validar el grafo

- Orden topológico (Kahn). Si queda algún nodo, hay ciclo.
- **Un ciclo no se rompe automáticamente.** Se emite un hallazgo `blocking` con el
  ciclo completo enumerado (`A → B → C → A`) y el cálculo se detiene. Romper enlaces
  en silencio, como hacen algunas herramientas, produce planes que nadie puede explicar.
- Las dependencias entre nodos contenedores se normalizan a sus hojas: un enlace
  `FS` desde un paquete de trabajo equivale a un `FS` desde la última hoja que termina.
- Enlaces entre proyectos distintos son válidos y están soportados (es lo que hace
  posible planificar una cartera, no proyectos aislados).

---

## Paso 3 · Resolver la ecuación de la tarea

```
trabajo = duración × unidades
```

`task_type` determina cuál de las tres magnitudes queda **anclada** cuando cambia otra:

| `task_type` | Cambias duración → | Cambias trabajo → | Cambias unidades → |
|-------------|--------------------|-------------------|--------------------|
| `fixed_work` | recalcula unidades | recalcula duración | recalcula duración |
| `fixed_duration` | recalcula trabajo | recalcula unidades | recalcula trabajo |
| `fixed_units` | recalcula trabajo | recalcula duración | recalcula duración |

`is_effort_driven` modula qué pasa al **añadir o quitar un recurso**: si está activo, el
trabajo total se mantiene y la duración se reparte entre más gente; si no, cada recurso
añade su propio trabajo y la duración no cambia.

> Estos dos ajustes son los que más confusión generan en Microsoft Project, porque allí
> son invisibles. Aquí, **cada recálculo que altere un valor declarado emite una fila de
> `derivation` y un aviso en la UI**: «he cambiado la duración de 5 d a 3 d porque la
> tarea es `fixed_work` y has añadido un segundo recurso». Nunca en silencio.

---

## Paso 4 · Paso adelante (early start / early finish)

En orden topológico, para cada tarea:

```
ES(t) = max(
          proyecto.status_start,
          max sobre predecesores p de:
            FS:  EF(p) + lag
            SS:  ES(p) + lag
            FF:  EF(p) + lag − duración(t)
            SF:  ES(p) + lag − duración(t)
        )
ES(t) = snapToWorkingTime(ES(t), cal(t), FORWARD)
EF(t) = addWorkingMinutes(ES(t), duración(t), cal(t))
```

El `lag` se mide **en minutos laborables del calendario del sucesor**. (Project usa el
del proyecto; medirlo en el del sucesor es más consistente y se documenta como tal.)

Cada `max` que gana deja una fila de `derivation` con `rule_code = 'FS_LINK'` y el
predecesor responsable. Eso es lo que permite contestar P3 —«¿por qué empieza el 14 de
abril?»— con «porque la tarea *Revisión FMECA* termina el 11 y hay un enlace FS con 1
día de desfase», y no con una conjetura.

---

## Paso 5 · Aplicar restricciones

Orden de precedencia, de mayor a menor:

1. `must_start_on` / `must_finish_on` — **duras**. Si contradicen una dependencia:
   hallazgo `error` `CONSTRAINT_CONFLICT`, la restricción gana y el conflicto queda
   visible. Nunca se relaja en silencio.
2. `start_no_earlier_than` / `finish_no_earlier_than` — empujan hacia adelante.
3. `start_no_later_than` / `finish_no_later_than` — limitan; si se incumplen, hallazgo.
4. `alap` — se resuelve en el paso atrás.
5. `asap` — por defecto, no hace nada.

`deadline` **no** es una restricción: no mueve la tarea. Genera un hallazgo
`DEADLINE_MISSED` con los días de retraso. Esta distinción —dura vs. blanda— es
deliberada y se explica en la UI cada vez que el usuario introduce una fecha.

---

## Paso 6 · Paso atrás y holguras

En orden topológico inverso, desde `max(EF)` o desde el fin de proyecto declarado:

```
LF(t) = min sobre sucesores s de:  (según tipo de enlace, simétrico al paso 4)
LS(t) = subtractWorkingMinutes(LF(t), duración(t), cal(t))

holgura_total(t) = workingMinutesBetween(EF(t), LF(t), cal(t))
holgura_libre(t) = min(ES(s)) − EF(t)   sobre los sucesores s
crítica(t)       = holgura_total(t) ≤ umbral   (umbral configurable, por defecto 0)
```

El umbral es configurable porque «crítico» con 0 minutos de holgura es inútil en la
práctica: con planes reales interesa ver también lo que tiene menos de un día.

---

## Paso 7 · Agregar contenedores

Los nodos `phase` y `work_package` **no se planifican**: se agregan desde sus hojas.

```
inicio(c)   = min(inicio(hijos))
fin(c)      = max(fin(hijos))
trabajo(c)  = Σ trabajo(hijos)
coste(c)    = Σ coste(hijos)
avance(c)   = Σ (avance(h) × trabajo(h)) / Σ trabajo(h)      ← ponderado por trabajo
```

El avance ponderado por trabajo es la única agregación honesta: la media aritmética de
porcentajes hace que una tarea de 2 h al 100 % compense a una de 200 h al 0 %.

---

## Paso 8 · Distribución temporal (timephasing)

**El paso que contesta la pregunta que de verdad importa.** Convierte cada asignación
en minutos por día.

```
para cada asignación a de la tarea t:
    cal     = calendario del recurso de a
    ventana = [max(inicio(t), a.window_from), min(fin(t), a.window_to)]
    días    = días laborables de cal dentro de ventana
    trabajo = a.work_declared_minutes ?? (duración(t) × a.units_bp / 10000)
    pesos   = perfilDeContorno(a.contour_kind, días, cal)
    reparto = distribuirEntero(trabajo, pesos)        // ver nota de redondeo
```

### Perfiles de contorno

| Perfil | Pesos | Cuándo usarlo |
|--------|-------|---------------|
| `flat` | proporcional a los minutos laborables de cada día | por defecto |
| `front_loaded` | rampa descendente | arranques intensivos |
| `back_loaded` | rampa ascendente | integración, cierre |
| `bell` | campana simétrica | tareas de ejecución larga |
| `turtle` | trapecio (lento-rápido-lento) | tareas con curva de aprendizaje |
| `manual` | `assignment_manual_contour` | lo que tú digas, sin recálculo |

### Redondeo determinista

Repartir 1 000 minutos entre 7 días no da entero. La regla es **única y documentada**:

```
distribuirEntero(total, pesos):
    bruto_i   = total × peso_i / Σ pesos
    base_i    = floor(bruto_i)
    resto     = total − Σ base_i
    orden     = días ordenados por (parte_fraccionaria desc, fecha asc)   ← desempate estable
    sumar 1 minuto a los primeros `resto` días de ese orden
```

Propiedad garantizada: **`Σ reparto ≡ total`, exactamente, siempre**. El desempate por
fecha ascendente hace el resultado independiente del orden de iteración (principio P2).

---

## Paso 9 · Capacidad y saturación

```
capacidad(r, d) = minutosLaborables(cal(r), d)
                × disponibilidad(r, d).units_bp / 10000
                − minutosDeAusencia(r, d)
                ... acotado inferiormente a 0                    ← invariante R2

carga(r, d)     = Σ reparto de todas las asignaciones de r en d
saturación(r,d) = carga / capacidad
```

Se emite `RESOURCE_OVERALLOCATED` por día y se agrega por mes. **Aviso importante que
la UI debe dejar claro:** un recurso puede estar equilibrado al mes y saturado tres días
concretos. Por eso se guarda el día y se muestran ambos niveles; el mes solo es la
mentira cómoda que todos los informes cuentan.

---

## Paso 10 · Nivelación (opcional, nunca automática)

Redistribuye para eliminar sobreasignaciones. Es NP-duro, así que es una **heurística**
declarada como tal, **desactivada por defecto** y que produce un plan separado
(`leveled_minutes`), nunca sobrescribiendo `planned_minutes`.

```
mientras exista día sobreasignado:
    candidatos = asignaciones de ese recurso ese día
    ordenar por: (1) prioridad del proyecto asc
                 (2) holgura total desc          ← retrasar primero lo que no es crítico
                 (3) fecha de inicio temprana desc
                 (4) uuid de tarea asc           ← desempate final, determinista
    retrasar el primer candidato hasta el siguiente hueco de capacidad
    respetar dependencias y restricciones duras
    registrar leveling_delay_minutes y una derivación con el motivo
    si no hay solución sin romper una restricción dura:
        emitir LEVELING_IMPOSSIBLE y dejar la sobreasignación visible
```

El cuarto criterio de desempate es lo que hace la nivelación **reproducible**: dos
ejecuciones con los mismos datos dan exactamente el mismo plan nivelado.

Opciones: horizonte, granularidad (día/semana), permitir división de tareas, permitir
ajuste de asignación, límite de retraso.

---

## Paso 11 · Costes

```
coste(a, d) = minutos(a, d) / 60 × tarifa_vigente(recurso(a), d)
```

La tarifa se busca por el periodo de vigencia del día, no por una tarifa única. Los
costes agregan hacia arriba por el árbol WBS igual que el trabajo. Todo en céntimos
enteros; la conversión de moneda, si la hubiera, ocurre en presentación con el tipo de
cambio del periodo, nunca dentro del motor.

---

## Paso 12 · Reglas y hallazgos

Las reglas de aviso son **datos** (`rule_definition.condition` como AST JSON validado
por esquema), no código. Eso permite cambiar «avisar si supera el 100 %» por «avisar si
supera el 85 % durante más de dos meses seguidos» sin desplegar.

Catálogo inicial de códigos:

| Código | Severidad | Significado |
|--------|-----------|-------------|
| `DEPENDENCY_CYCLE` | blocking | ciclo en el grafo |
| `CONSTRAINT_CONFLICT` | error | restricción dura vs. dependencia |
| `RESOURCE_OVERALLOCATED` | warning | carga > capacidad |
| `RESOURCE_NO_CAPACITY` | warning | asignación en periodo sin capacidad (vacaciones) |
| `DEADLINE_MISSED` | warning | fin previsto > deadline |
| `BUDGET_EXCEEDED` | warning | trabajo > `standard_effort_minutes` |
| `TASK_UNASSIGNED` | info | tarea con trabajo y sin recurso |
| `TASK_NO_WORK` | info | tarea con duración y sin trabajo |
| `ORPHAN_TASK` | info | sin predecesor ni sucesor ni restricción |
| `LEVELING_IMPOSSIBLE` | error | la nivelación no converge sin romper algo |

---

## Casos límite obligatorios (corpus de *golden files*)

Cada uno es un fichero de entrada + salida esperada, versionado. Si el motor cambia y
un golden file cambia, el diff **tiene que revisarse a mano**. Es el mecanismo que
impide regresiones silenciosas en los números.

1. Tarea de 1 minuto sobre un día parcial
2. Tarea que empieza justo al cierre de la jornada
3. Tarea que cruza un festivo largo (Navidad)
4. Tarea que cruza un cambio de patrón semanal (jornada reducida desde julio)
5. Enlace FS con lag negativo mayor que la duración del predecesor
6. Enlace SF (el tipo raro, casi siempre mal implementado)
7. Enlace SS con lag entre tareas de calendarios distintos
8. Cadena de 3 tareas con `must_start_on` en la del medio
9. `alap` con sucesor `asap`
10. Deadline incumplido por 1 minuto
11. Dos recursos, uno de 35 h y otro de 40 h, en la misma tarea
12. Recurso al 50 % con vacaciones a mitad de la tarea
13. Recurso con disponibilidad 0 durante toda la tarea
14. Trabajo de 1 000 minutos repartido entre 7 días (redondeo)
15. Contorno `bell` sobre 2 días
16. Contorno manual que no suma el trabajo total (debe emitir hallazgo)
17. `fixed_work` + añadir segundo recurso (`effort_driven` on y off)
18. `fixed_duration` + cambiar unidades
19. Hito con predecesores múltiples
20. Hito con duración distinta de 0 (debe rechazarse)
21. Contenedor con hijos en proyectos distintos
22. Contenedor vacío
23. Ciclo de 2 nodos · 24. Ciclo de 7 nodos · 25. Ciclo a través de un contenedor
26. Dependencia entre proyectos con calendarios distintos
27. Tarea al 100 % completada con fecha en el pasado
28. Avance parcial con trabajo restante declarado que contradice el %
29. Imputaciones reales que superan el trabajo planificado
30. Nivelación con dos tareas de idéntica prioridad y holgura (desempate)
31. Nivelación imposible por restricción dura
32. Nivelación con horizonte que corta una tarea a la mitad
33. Cambio de tarifa a mitad de tarea
34. Tarea que cruza el fin de año (partición de `timephased`)
35. Calendario que hereda de otro que hereda de otro
36. Excepción de calendario con jornada especial más larga que la normal
37. Proyecto con `status_start` posterior al inicio de una tarea con `must_start_on`
38. Escenario what-if que borra una asignación existente
39. 5 000 tareas / 50 recursos (prueba de rendimiento, < 2 s)
40. Recálculo idéntico ⇒ mismo `input_hash` y mismos resultados byte a byte
