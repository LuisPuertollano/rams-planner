# RAMS Planner

Herramienta de planificación y cálculo de carga de trabajo para un equipo de
ingeniería que trabaja en varios proyectos a la vez.

La pregunta que existe para contestar, en cualquier momento y sin ambigüedad:

> ¿Cuántas horas tiene comprometidas cada persona, cada mes, en cada proyecto —
> y cuánta capacidad le queda?

Y la de segundo orden, que es la que decide contratos:

> Si acepto este proyecto nuevo, ¿quién se satura, cuándo, y cuánto?

## Estado

**Fase 0 — Cimientos.** Monorepo, tipos estrictos, CI, esquema de base de datos
completo con sus invariantes y datos semilla. Todavía no hay motor de cálculo ni
interfaz: eso son las fases 1 a 3.

| Fase | Contenido | Estado |
|------|-----------|--------|
| 0 | Cimientos: monorepo, CI, esquema, semilla | ✅ |
| 1 | `@planner/calendar`: aritmética de tiempo laborable | ⬜ |
| 2 | `@planner/scheduler`: CPM, restricciones, explicaciones | ⬜ |
| 3 | `@planner/workload`: carga, capacidad, matriz y mapa de calor | ⬜ |

## Arranque

```bash
cp .env.example .env
docker compose up -d          # levanta Postgres y aplica las migraciones
pnpm install
pnpm verify                   # lint + tipos + regla de dependencia + tests
```

`docker compose up` deja la base de datos migrada y sembrada. Las migraciones las
aplica un servicio `migrate` de un solo uso, **nunca** el arranque de un servidor:
una migración a medias durante un despliegue es imposible de auditar.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm verify` | Todo lo que CI verifica del código, en orden |
| `pnpm test` | Tests |
| `pnpm test:coverage` | Tests con cobertura (umbral: 95 % de ramas en el núcleo) |
| `pnpm lint` | ESLint, incluidas las reglas que impiden `eval` y el I/O en el núcleo |
| `pnpm typecheck` | TypeScript estricto en todos los paquetes |
| `pnpm check:deps` | Verifica que el núcleo no conoce a los adaptadores |
| `pnpm db:up` | Aplica las migraciones contra `DATABASE_URL` |

Los invariantes de la base de datos se comprueban con:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
```

## Cómo está organizado

```
packages/          núcleo puro: sin I/O, sin framework, sin base de datos
  domain/            unidades (minutos, puntos base, céntimos), aritmética exacta
                     serialización canónica, borde de presentación
db/
  migrations/      esquema, roles, auditoría y datos semilla (dbmate)
  tests/           invariantes que hace cumplir la base de datos
tools/             verificación de la regla de dependencia
docs/
  esquema.md       las cuatro zonas de datos y por qué están separadas
  adr/             decisiones de arquitectura, con sus alternativas descartadas
```

Arquitectura hexagonal: las dependencias apuntan hacia dentro y CI lo verifica.
El núcleo se empaquetará también para el navegador, de modo que la
previsualización interactiva use el mismo motor que el servidor y no un segundo
motor aproximado que dé números distintos.

## Los principios

Tienen prioridad sobre cualquier conveniencia de implementación. En conflicto,
gana el de número más bajo. Están desarrollados en [`CLAUDE.md`](CLAUDE.md).

1. **Lo declarado y lo derivado no se tocan** — tablas distintas, roles distintos.
2. **El motor es una función pura y determinista** — mismo snapshot, mismo resultado.
3. **Todo resultado pertenece a una ejecución identificada** — con versión y hash.
4. **Todo número derivado sabe explicarse** — hasta el dato que alguien escribió.
5. **Aritmética entera** — minutos, céntimos, puntos base. Nunca horas decimales.
6. **El esquema modela conceptos, no pantallas** — árbol WBS, campos como datos.
7. **El historial es inmutable y de sólo añadir** — `DELETE` es `deleted_at`.
