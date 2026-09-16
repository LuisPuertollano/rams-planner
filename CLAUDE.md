# Convenciones del proyecto

Este fichero es la referencia para cualquiera —persona o agente— que toque el
repositorio. Lo que aquí se llama principio tiene prioridad sobre cualquier
conveniencia de implementación; en conflicto, gana el de número más bajo.

## Los siete principios

**P1 · Lo declarado y lo derivado no se tocan.** Ningún campo que escribe el
usuario puede sobrescribirlo el motor, y ningún campo que calcula el motor puede
editarlo el usuario. Viven en tablas distintas y en roles de base de datos
distintos (`planner_api` no tiene escritura sobre la zona derivada;
`planner_engine` no la tiene sobre la declarada). Para fijar una fecha no se
edita la fecha calculada: se declara una restricción, que es un dato de entrada.

**P2 · El motor es una función pura y determinista.** Sin I/O, sin `Date.now()`,
sin `Math.random()`, sin depender del orden de iteración. Los desempates son
explícitos y llegan hasta el UUID. ESLint lo verifica en `packages/{domain,
calendar,scheduler,workload,explain,rules}/src`.

**P3 · Todo resultado pertenece a una ejecución identificada.** Nada de «los
datos calculados»: los calculados en la ejecución X, con `engine_version` e
`input_hash`. Una línea base es una ejecución congelada con nombre.

**P4 · Todo número derivado sabe explicarse.** La derivación —qué regla lo
produjo y con qué entradas— es una salida de primera clase del motor, no
logging. Se escribe desde el principio: añadirla después es reescribir el motor.

**P5 · Aritmética entera.** Minutos laborables, céntimos, puntos base. El único
módulo autorizado a producir decimales es `packages/domain/src/format.ts`.

**P6 · El esquema modela conceptos, no pantallas.** Un árbol WBS recursivo, no
una jerarquía rígida. Los atributos del dominio (tag RAMS, nivel SIL, centro de
coste) son campos personalizados definidos como datos, no columnas.

**P7 · El historial es inmutable y de sólo añadir.** `DELETE` es `deleted_at`.
`change_event` rechaza `UPDATE` y `DELETE` incluso para el propietario.

## Unidades

| Magnitud | Tipo | Unidad | Nunca |
|----------|------|--------|-------|
| Tiempo de trabajo | `WorkMinutes` | minutos laborables enteros | horas decimales |
| Porcentajes | `BasisPoints` | 10000 = 100,00 % | `0.85` |
| Dinero | `Cents` | céntimos enteros | euros con decimales |
| Fechas de calendario | `CalendarDate` | `'YYYY-MM-DD'` sin zona | `Date` |

Los tipos son nominales: el compilador impide mezclarlos. No los conviertas con
`as`; usa los constructores (`workMinutes()`, `basisPoints()`, …), que validan.

## Reglas de trabajo

- **Tests antes que implementación** en el núcleo. El corpus de *golden files* es
  la red de seguridad del proyecto: si un golden file cambia, el diff se revisa a
  mano, nunca se acepta en bloque.
- **Nada de `any`** sin un comentario que justifique por qué.
- **Nada de `eval` ni `new Function`.** Las expresiones de usuario se evalúan con
  el intérprete acotado de `@planner/rules` (AST validado, operadores en lista
  blanca, límite de pasos).
- **Un `runId` acompaña a todo número derivado** que devuelva la API. Un número
  sin `runId` es un bug: no se puede auditar.
- **Un ADR corto** en `docs/adr/` antes de implementar cualquier decisión con
  alternativas reales: contexto, decisión, alternativas descartadas, coste.
- **Commits pequeños**, un PR por fase.
- Si algo del enunciado parece equivocado, **dilo antes de implementarlo**, con
  una propuesta. No lo implementes «como te lo han pedido» si crees que está mal.

## Antes de dar algo por terminado

```bash
pnpm verify     # lint + tipos + regla de dependencia + tests
```

Y si tocaste la base de datos:

```bash
dbmate --migrations-dir ./db/migrations up
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
```

Toda migración tiene que ser **reversible**: CI hace `down` de todas y vuelve a
hacer `up`.

## Dónde está el porqué

- La especificación completa: [`docs/diseno/`](docs/diseno/).
- Las decisiones estructurales, con sus alternativas descartadas: [`docs/adr/`](docs/adr/).
- Los 40 casos límite que el motor tiene que pasar:
  [`docs/diseno/04-motor-de-calculo.md`](docs/diseno/04-motor-de-calculo.md).

Si vas a implementar algo que contradice un ADR, cámbialo primero ahí y explica por qué.
Un ADR que ya no se cumple es peor que no tenerlo.

## Fases

Se trabaja por fases y **se para en cada puerta**. No adelantes trabajo de fases
posteriores: la fase 1 mal cerrada contamina todo lo demás.

| Fase | Contenido | Estado |
|------|-----------|--------|
| 0 | Cimientos: monorepo, CI, esquema, invariantes, semilla | ✅ |
| 1 | Calendarios jerárquicos y las tres primitivas | ✅ |
| 2 | CPM con restricciones, holguras y explicaciones | ✅ |
| 3 | Carga diaria, capacidad, saturación y coste | ✅ |
| 4 | Persistencia, API e interfaz (carga, saturación, plan, cronograma, hallazgos, «¿por qué?») | ✅ |
| 5 | Edición en línea de datos declarados, líneas base y comparación | ✅ |
| 6 | Import/export CSV y campos personalizados de extremo a extremo | ✅ |
| 6b | Realidad ejecutada (imputaciones, plan vs. real, curva S) | ⬜ |
| 7 | Nivelación heurística determinista, opcional | ✅ |
