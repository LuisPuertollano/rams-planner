# RAMS Planner

Herramienta de planificación y cálculo de carga de trabajo para un equipo de
ingeniería que trabaja en varios proyectos a la vez.

La pregunta que existe para contestar, en cualquier momento y sin ambigüedad:

> ¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto —
> y cuánta capacidad le queda?

Y la de segundo orden, que es la que decide contratos:

> Si acepto este proyecto nuevo, ¿quién se satura, cuándo, y cuánto?

## Arrancar

```bash
cp .env.example .env
docker compose up -d --build
```

Y abrir **http://localhost:45678**. Compose levanta PostgreSQL, aplica las
migraciones con un job separado, carga un juego de datos de demostración con
tres proyectos que se solapan y sirve la aplicación. No hay más pasos.

Para trabajar sin Docker, con una base de datos propia:

```bash
pnpm install
pnpm build
dbmate --migrations-dir ./db/migrations up   # esquema y calendarios base
pnpm db:demo                                 # datos de ejemplo (opcional)
pnpm dev:api                                 # API + interfaz en :45678
pnpm dev:web                                 # opcional: Vite en :45677 con recarga
```

## Qué hace

| Vista | Qué contesta |
|-------|--------------|
| **Carga** | Cuántas horas tiene comprometida cada persona, cada mes, en cada proyecto, con su capacidad y su saturación |
| **Saturación** | Quién se pasa de capacidad, cuándo y por cuánto. Escala divergente centrada en el 100 % |
| **Plan** | El árbol de trabajo con las fechas que ha calculado el motor, la holgura y el camino crítico |
| **Cronograma** | El plan en el tiempo, con hitos y camino crítico |
| **Calendario** | Quién está fuera, cuándo, y qué capacidad exacta le queda al equipo cada día y cada mes |
| **Competencias** | Quién sabe hacer qué, en una matriz de personas × competencias, y dónde el equipo tiene un único especialista |
| **Equipo** | De qué está hecha la capacidad: el calendario de cada persona, su dedicación, sus ausencias y su tarifa. Todo declarado, y cada cambio recalcula |
| **Hallazgos** | Ciclos, conflictos de restricción, sobrecargas, deadlines incumplidos y desvíos de presupuesto |
| **Comparar** | En qué se diferencia el plan de hoy de una línea base o de cualquier cálculo anterior |
| **¿por qué?** | La traza de cada fecha: qué regla la produjo y con qué entradas, hasta el dato que alguien escribió |

El botón **Nivelar** retrasa tareas hasta que el plan cabe en la capacidad del
equipo. Es una heurística, está declarada como tal y **no toca el plan
original**: crea una ejecución nueva que se compara con la anterior en la
pestaña **Comparar**, para ver qué ha costado que quepa. Cuando una asignación
no cabe ni sola en la jornada de la persona, lo dice en vez de retrasarla
eternamente: ahí lo que hay que cambiar es la dedicación, la duración o el
calendario, no la fecha.

La herramienta trae de serie la plantilla **PLANTILLA-RAMS**, con el ciclo de
vida de la EN 50126 en seis fases, sus hitos y sus dependencias encadenadas. El
botón **+ Desde «PLANTILLA-RAMS»** crea un proyecto entero a partir de ella,
anclado en la fecha que le digas. Cualquier proyecto se puede **guardar como
plantilla** desde su panel, que es como se acaban teniendo los moldes que de
verdad se usan. Una plantilla no lleva gente y no se calcula: es un molde.

La vista **Plan** también se edita: **+ Proyecto** y **+ Fase** crean la
estructura, y el botón **✎** de cada fila abre el panel donde se pone el nombre,
se asigna a quién trabaja en la tarea y con qué dedicación, se declara de qué
depende y se da de baja lo que sobra. En ese panel no hay ni una fecha: las
fechas las calcula el motor.

En esa misma vista las dos primeras columnas de datos son declaradas y se
editan en línea: al confirmar un cambio, el plan se recalcula entero y el
resultado queda guardado como una ejecución nueva. Las demás columnas llevan
candado. Congelar el plan con el botón **Línea base** y volver a la pestaña
**Comparar** enseña la cascada completa de un cambio.

## Cargar tus propios datos

El botón **Importar CSV** de la cabecera lee un fichero plano, el que ya tienes
en Excel. Descarga la plantilla en
[`/api/import/plantilla.csv`](http://localhost:45678/api/import/plantilla.csv) o
escríbela a mano:

```csv
proyecto;nombre_proyecto;fase;tarea;dias;predecesoras;recurso;dedicacion;disciplina;deadline;no_antes_de
CBTC-L3;CBTC Línea 3;Análisis;Plan RAMS;5;;Ana Müller;100;Plan;;2026-03-02
CBTC-L3;CBTC Línea 3;Análisis;Hazard Log;10;Plan RAMS;Ana Müller;Marc Iglesias;50;Hazard Log;2026-05-29;
CBTC-L3;CBTC Línea 3;Análisis;Revisión de concepto;0;Hazard Log;;;;;
```

- El separador se detecta solo: coma, punto y coma o tabulador, con o sin BOM.
  Los decimales admiten coma y punto.
- `dias` a **0** crea un hito.
- `predecesoras` y `recurso` admiten varios valores separados por `;` o `|`.
- Las personas que no existan **se crean** con jornada estándar y sin tarifa, y
  la respuesta te dice cuáles. Complétalas en la pestaña **Equipo**: sin tarifa,
  el coste de sus tareas sale a cero y la lista se lo marca con un ⚠.
- Un proyecto cuyo código ya exista **no se sobrescribe**: la importación entera
  se rechaza nombrando el conflicto.
- Cualquier fila ilegible aborta la importación y se te dice qué fila y por qué.
  No hay importaciones a medias.

El botón **Exportar** descarga la carga mensual en CSV con el `runId` en cada
fila: el fichero sigue siendo auditable fuera de la herramienta.

## Cómo está hecho

```
packages/
  domain/        unidades (minutos, puntos base, céntimos), aritmética entera exacta,
                 fechas sin `Date`, serialización canónica, hallazgos
  calendar/      calendarios jerárquicos con vigencia y las tres primitivas de
                 tiempo laborable, todas O(log n)
  explain/       derivaciones: la respuesta a «¿por qué este número?»
  scheduler/     CPM con restricciones, holguras y camino crítico por proyecto
  workload/      reparto diario, capacidad efectiva, saturación y coste
  persistence/   SQL explícito contra PostgreSQL; carga del snapshot y guardado
                 de las ejecuciones
  api/           Fastify; sirve también la interfaz compilada. Y la CLI
  web/           React + Vite
db/
  migrations/    esquema, roles, auditoría y calendarios base (dbmate)
  tests/         invariantes que hace cumplir la base de datos
docs/            diseño completo y decisiones de arquitectura
```

Los cinco primeros paquetes son el **núcleo puro**: sin I/O, sin framework, sin
base de datos y sin reloj. `tools/check-dependency-rule.mjs` lo verifica en cada
PR, y ESLint impide que alguien meta `fetch`, `process`, `Date.now()` o
`Math.random()` dentro de ellos.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm verify` | Todo lo que CI verifica del código, en orden |
| `pnpm test` · `pnpm test:coverage` | Tests · con cobertura (umbral por paquete) |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript estricto |
| `pnpm check:deps` | El núcleo no conoce a los adaptadores |
| `pnpm db:demo` · `pnpm db:calculate` | Datos de ejemplo · recalcular desde la CLI |

Los invariantes de la base de datos:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
```

## Los principios

Tienen prioridad sobre cualquier conveniencia de implementación. En conflicto,
gana el de número más bajo. Desarrollados en [`CLAUDE.md`](CLAUDE.md) y razonados
en [`docs/diseno/01-objetivos-y-principios.md`](docs/diseno/01-objetivos-y-principios.md).

1. **Lo declarado y lo derivado no se tocan.** Tablas distintas y roles de base
   de datos distintos: `planner_api` no puede escribir resultados y
   `planner_engine` no puede escribir datos del usuario.
2. **El motor es una función pura y determinista.** Mismo snapshot, mismo
   resultado, bit a bit, hoy y dentro de tres años.
3. **Todo resultado pertenece a una ejecución identificada,** con versión de
   motor y hash de entradas. Una línea base es una ejecución congelada.
4. **Todo número derivado sabe explicarse,** hasta el dato que alguien escribió.
5. **Aritmética entera:** minutos laborables, céntimos, puntos base. Nunca horas
   decimales.
6. **El esquema modela conceptos, no pantallas:** árbol WBS recursivo y campos
   del dominio definidos como datos.
7. **El historial es inmutable y de sólo añadir.** `DELETE` es `deleted_at`.

## Documentación

- [`docs/manual-de-uso.md`](docs/manual-de-uso.md) — para quien planifica: qué
  hacer, en qué orden, y cómo leer lo que sale.
- [`docs/operacion.md`](docs/operacion.md) — levantar, copiar, actualizar,
  volver atrás y qué mirar cuando algo va mal.
- [`docs/diseno/`](docs/diseno/) — la especificación completa. Si vas a tocar el
  motor, la lista de 40 casos límite de
  [`04-motor-de-calculo.md`](docs/diseno/04-motor-de-calculo.md) es el contrato de pruebas.
- [`docs/adr/`](docs/adr/) — las decisiones estructurales, con lo que se descartó.
- [`CLAUDE.md`](CLAUDE.md) — convenciones: unidades, reglas y puertas de fase.
