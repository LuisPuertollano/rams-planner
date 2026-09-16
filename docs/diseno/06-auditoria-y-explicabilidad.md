# 06 · Auditoría y explicabilidad

Tres preguntas distintas que se confunden con frecuencia, y que aquí tienen tres
mecanismos separados:

| Pregunta | Mecanismo | Tabla |
|----------|-----------|-------|
| ¿Por qué este número **es** este número? | Derivaciones del motor | `derivation` |
| ¿Quién cambió **qué** y cuándo? | Log de cambios append-only | `change_event` |
| ¿En qué se diferencia este plan del de antes? | Diff entre ejecuciones | `calculation_run` × 2 |

## 6.1 Explicabilidad: el panel «¿por qué?»

Cada valor derivado se puede desplegar hasta los datos declarados. Ejemplo real de lo
que devuelve `GET /api/runs/{run}/explain?target=task_result.scheduled_start&id={task}`:

```
scheduled_start(«Revisión SIL») = 2026-04-14 08:00
│
├─ regla CONSTRAINT_NONE           → no hay restricción, manda la dependencia
├─ regla FS_LINK                   → 2026-04-13 17:00 + 1 d de desfase
│  ├─ predecesor: «FMECA subsistema freno»
│  │  └─ early_finish = 2026-04-13 17:00
│  │     ├─ regla TASK_EQUATION    → duración 12 000 min = trabajo 12 000 / unidades 100 %
│  │     │  ├─ declarado: work_declared_minutes = 12000      [task 8f2a…]
│  │     │  └─ declarado: units_bp = 10000                   [assignment 61bd…]
│  │     └─ regla CALENDAR_SNAP    → calendario «base_bw»
│  │        └─ declarado: project.calendar_id                [project P-2026-03]
│  └─ declarado: dependency.lag_minutes = 480                [dependency 44c1…]
└─ regla CALENDAR_SNAP             → 14/04 00:00 → 14/04 08:00 (inicio de jornada)
```

Cada hoja del árbol es un dato que **alguien escribió** y que tiene su propia entrada en
`change_event`: quién, cuándo, con qué comentario. La cadena completa va desde «el
número del informe» hasta «Marc puso 200 h el 3 de febrero porque el cliente amplió el
alcance».

Lo mismo para una celda de la matriz de carga:

```
carga(Ana, marzo 2026, proyecto P-2026-03) = 8 400 min (140 h)
├─ asignación «Revisión SIL»               5 400 min
│  ├─ regla CONTOUR_FLAT  → 30 000 min repartidos en 41 días laborables
│  ├─ regla ROUNDING_LARGEST_REMAINDER → +1 min a 17 días (desempate por fecha asc)
│  └─ regla CALENDAR_RESOURCE → calendario «ana_80» (35 h/sem al 80 %)
└─ asignación «Hazard Log»                 3 000 min
   └─ …
```

## 6.2 Registro de cambios

Un trigger genérico sobre todas las tablas declaradas escribe en `change_event`:
operación, entidad, `before`/`after` en JSONB, actor, `request_id` y comentario.

- El `request_id` agrupa todos los cambios de una misma operación de usuario. Mover una
  fase con 30 tareas es **un** cambio en la UI y 31 filas agrupadas en el log, no 31
  cambios sueltos.
- El comentario se captura en la UI para los cambios sensibles (estimaciones,
  disponibilidad, dependencias). No es obligatorio para todo: pedir justificación para
  renombrar una tarea sólo enseña a la gente a escribir «.» en el campo.
- Nadie tiene `UPDATE` ni `DELETE` sobre `change_event`, ni siquiera la aplicación. El
  borrado es soft-delete en la tabla origen, que a su vez genera su evento.

Vista derivada: **línea de tiempo de una entidad**. «Esta tarea nació el 12/01 con 80 h,
pasó a 120 h el 3/02 (Marc: "ampliación de alcance"), se le añadió a Ana el 5/02, y su
fecha de fin se movió 11 días en la ejecución del 6/02.»

## 6.3 Comparación de ejecuciones

`GET /api/runs/{a}/diff/{b}` devuelve, por tarea y por celda de carga:

```json
{
  "tasks": [{
    "nodeId": "…", "name": "Revisión SIL",
    "scheduledStart": { "from": "2026-04-02", "to": "2026-04-14", "deltaDays": 12 },
    "workMinutes":    { "from": 24000, "to": 30000, "deltaMinutes": 6000 },
    "causes": ["dependency.lag_minutes changed", "assignment 61bd… units_bp 10000→8000"]
  }],
  "load": [{
    "resourceId": "…", "month": "2026-03",
    "plannedMinutes": { "from": 7200, "to": 8400, "deltaMinutes": 1200 }
  }]
}
```

El campo `causes` se construye cruzando el diff de resultados con los `change_event`
ocurridos entre las dos ejecuciones. Es la funcionalidad que hace que la reunión de
seguimiento dure quince minutos en vez de hora y media.

Casos de uso directos:
- **Plan actual vs. línea base**: desviación contra lo comprometido (pregunta P5).
- **Escenario what-if vs. plan vivo**: impacto de aceptar un proyecto (pregunta P4).
- **Ejecución de ayer vs. de hoy**: qué movió el cambio que acabo de hacer.

## 6.4 Reproducibilidad

```bash
planner replay --run 9c1e4a7b            # reproduce y compara con lo almacenado
planner replay --run 9c1e4a7b --export snapshot.json
planner calc snapshot.json --engine 1.4.2
```

`replay` recarga el snapshot original, lo vuelve a pasar por el motor de la versión
registrada y compara byte a byte. Salidas posibles:

- ✅ **idéntico** — el número del informe es defendible ante cualquiera.
- ⚠️ **versión de motor distinta** — dice qué versión haría falta y qué cambió entre
  ambas (el `CHANGELOG` del motor documenta qué cálculos afecta cada versión).
- ❌ **divergente con la misma versión** — es un bug grave del motor (no determinismo)
  y CI debe fallar. La prueba nº 40 del corpus existe exactamente para esto.

Los snapshots de las ejecuciones **congeladas** (líneas base) se guardan comprimidos,
íntegros. Una línea base sin su snapshot de entrada es una foto sin negativo: no se
puede reproducir ni explicar.

## 6.5 Qué NO es auditable (y por qué está bien)

- Las previsualizaciones del navegador no generan ejecuciones ni eventos. Son
  provisionales, se marcan como tal en la UI y desaparecen al guardar o descartar.
- Las derivaciones de ejecuciones intermedias se purgan por política (por defecto: se
  conservan 30 días, y siempre las congeladas). Los resultados se conservan; el árbol
  de explicación detallado, no indefinidamente.
- La nivelación heurística es **reproducible** (mismo resultado) pero no **óptima**, y
  la UI lo dice con esas palabras. Prometer optimalidad en un problema NP-duro es
  mentir.
