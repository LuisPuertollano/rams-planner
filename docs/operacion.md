# Operación

Cómo se levanta, se mantiene, se copia y se actualiza la herramienta. Para el
uso diario, [`manual-de-uso.md`](manual-de-uso.md).

---

## 1. Levantar

### Con Docker (lo normal)

```bash
cp .env.example .env     # y cambia POSTGRES_PASSWORD
docker compose up -d --build
```

Queda en **http://localhost:45678**.

Compose levanta tres cosas, en este orden:

| Servicio | Qué es | Cuándo termina |
|----------|--------|----------------|
| `db` | PostgreSQL 16, con su volumen `pgdata` | Sigue vivo |
| `migrate` | Un job de un solo uso que aplica las migraciones con dbmate | Termina y se queda parado; es lo esperado |
| `api` | La API y la interfaz compilada, en un solo proceso | Sigue vivo |

**El esquema nunca lo aplica el arranque de la API.** Es un job aparte a
propósito: una migración a medias durante un despliegue es imposible de
auditar, y si el job falla, la API no llega a arrancar contra una base
inconsistente.

`SEED_DEMO=true` carga el juego de datos de demostración **sólo si la base está
vacía**. Ponlo a `false` en cuanto tengas datos de verdad; aunque es idempotente,
no hay razón para que esté encendido.

### Sin Docker

```bash
pnpm install
pnpm build
dbmate --migrations-dir ./db/migrations up
pnpm db:demo          # opcional
pnpm dev:api
```

Necesita Node 22, pnpm 9, PostgreSQL 16 y dbmate. `DATABASE_URL` tiene que estar
en el entorno o en `.env`.

---

## 2. Variables de entorno

| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `DATABASE_URL` | — (obligatoria) | Conexión a PostgreSQL. Sin ella la API no arranca, y lo dice |
| `PORT` | `45678` | Puerto de la API y la interfaz |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `WEB_ROOT` | `packages/web/dist` | Dónde está la interfaz compilada. Se toca sólo si se sirve desde otro sitio |
| `SEED_DEMO` | `false` | `true` carga los datos de demostración si la base está vacía |
| `LOG_LEVEL` | `info` | Nivel de log de Fastify |

Los puertos `454xx` de `.env.example` están elegidos para no chocar con un
PostgreSQL local en el 5432 ni con los servidores de desarrollo habituales.

---

## 3. Los roles de la base de datos

Las migraciones crean tres roles de grupo, sin login:

| Rol | Escribe | No puede escribir |
|-----|---------|-------------------|
| `planner_api` | Lo declarado y lo real: personas, calendarios, proyectos, tareas, asignaciones, avances | Ningún resultado del motor |
| `planner_engine` | Lo derivado: ejecuciones, resultados, reparto diario, capacidad, hallazgos, derivaciones | Ningún dato del usuario |
| `planner_readonly` | Nada | Nada |

Nadie escribe `change_event`: el historial sólo lo rellena el trigger de
auditoría. Esto es el principio P1 impuesto por la base de datos en vez de por
convención, y es lo que hace que la herramienta sea auditable de verdad.

El usuario real de cada servicio se crea **fuera de las migraciones**, con su
contraseña, y se le concede el grupo:

```sql
CREATE USER planner_api_svc PASSWORD '...';
GRANT planner_api TO planner_api_svc;
```

En la configuración por defecto de Docker la API se conecta con el
superusuario del contenedor, que es aceptable para una instalación de un solo
equipo. Para separarlo de verdad, crea los dos usuarios y dale a la API el
suyo. Los roles ya están, no hay que tocar nada más.

Para comprobar que la separación sigue en pie:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
```

Son once comprobaciones que **provocan a propósito la operación que debe
fallar**. Si alguna pasa cuando debía fallar, el guion se para. Merece la pena
ejecutarlo después de cada actualización.

---

## 4. Copias de seguridad

Todo el estado está en PostgreSQL. No hay ficheros al margen: ni adjuntos, ni
caché, ni índices aparte.

```bash
# Copia
docker compose exec -T db pg_dump -U planner -Fc planner > planner-$(date +%F).dump

# Restauración sobre una base vacía
docker compose exec -T db pg_restore -U planner -d planner --clean --if-exists < planner-2026-09-16.dump
```

Qué contiene la copia, y por qué importa: **los datos declarados, todos los
cálculos hechos, las líneas base y el historial completo de cambios**. Restaurar
una copia devuelve la herramienta al estado exacto, con las explicaciones de
cada número incluidas.

Los cálculos se pueden regenerar (`pnpm db:calculate`), pero **no se deben**
regenerar para ahorrar espacio: una línea base es un cálculo congelado, y borrar
cálculos es borrar líneas base. El histórico de una cartera de proyectos ocupa
unos megabytes al año.

---

## 5. Actualizar

```bash
git pull
docker compose up -d --build
```

El job `migrate` aplica las migraciones nuevas antes de que arranque la API. El
orden importa y compose lo garantiza con `service_completed_successfully`.

Antes de actualizar una instalación con datos de verdad:

1. Haz la copia (punto 4).
2. Mira si hay migraciones nuevas: `git log --oneline -- db/migrations`.
3. Actualiza.
4. Ejecuta los invariantes (punto 3).

### Volver atrás

Cada migración lleva su sección `migrate:down` y CI comprueba en cada PR que el
esquema se puede desmontar entero. Para revertir una:

```bash
dbmate --migrations-dir ./db/migrations down
```

Una migración que borra una columna **borra los datos de esa columna**. El
`down` restituye el esquema, no el contenido. Restaurar la copia es lo correcto
casi siempre.

---

## 6. La CLI

Se ejecuta dentro del contenedor de la API o en local con `DATABASE_URL` puesta:

```bash
docker compose exec api node packages/api/dist/cli.js <comando>
```

| Comando | Qué hace |
|---------|----------|
| `seed-demo` | Carga los datos de demostración, si la base está vacía |
| `calculate` | Recalcula y guarda una ejecución nueva. Sirve para un cron |
| `runs` | Lista las últimas ejecuciones con su hash de entradas |
| `crear-superadmin <correo> <nombre>` | Da de alta la primera cuenta, con todos los permisos |
| `cambiar-clave <correo>` | Genera una contraseña nueva para alguien que perdió la suya |

Los dos últimos **generan la contraseña y la imprimen una vez**. No se pasan por
argumento a propósito: un argumento queda en el historial del shell y en la
lista de procesos de la máquina.

`calculate` desde un cron nocturno es útil por una razón concreta: como el hash
de entradas está guardado, dos ejecuciones con el mismo hash y resultados
distintos significarían que el motor ha dejado de ser determinista. Es una
alarma barata.

---

## 7. Usuarios, roles y permisos

### La primera cuenta

Una base recién migrada **no tiene ningún usuario**, y mientras eso sea así la
herramienta está **abierta**: cualquiera que llegue a ella entra y hace lo que
quiera. Es a propósito —una instalación que no deja entrar a nadie hasta que
alguien encuentre el comando correcto es peor—, pero se avisa por todas partes:
en el log del arranque y en un banner rojo arriba de la interfaz.

Se cierra creando el primer superadministrador:

```bash
docker compose exec api node packages/api/dist/cli.js \
  crear-superadmin luis@empresa.com "Luis Puertollano"
```

La contraseña sale por pantalla una sola vez. A partir de ahí hay que entrar
para hacer nada.

### Repartir permisos

Todo lo demás se hace desde la pestaña **Administración**, que sólo ven quienes
tienen `roles.gestionar` o `usuarios.gestionar`:

- **Hoja de permisos** — funciones en filas, roles en columnas, una casilla por
  cruce. La lista de funciones sale del código (`packages/api/src/permissions.ts`),
  así que no se puede quedar desactualizada: una funcionalidad nueva sin permiso
  no arranca el servidor.
- **Usuarios y roles** — alta de personas, contraseñas, desactivar cuentas y
  conceder roles, de forma global o **sólo sobre un proyecto**. Lo que alguien
  puede hacer en un proyecto es la unión de sus roles globales y los de ese
  proyecto: un rol por proyecto suma, nunca resta.

### Lo que no se puede acotar a un proyecto

En la hoja, algunas funciones salen marcadas **«toda la herramienta»**. Son las
que no hablan de un proyecto: las personas del equipo, sus tarifas, sus
competencias, las ejecuciones del motor y la propia administración. «Editar el
equipo, pero sólo en el proyecto A» no describe nada, así que esas funciones
**sólo cuentan concedidas en toda la herramienta**.

La consecuencia práctica: si concedes un rol sobre un proyecto, de ese rol sólo
llegan sus funciones por proyecto. Un «Responsable» concedido sobre ARBOL-2 podrá
editar el plan de ARBOL-2 y ver su carga, pero no dará de alta a nadie en el
equipo ni lanzará un cálculo. Para eso hace falta el rol concedido en toda la
herramienta.

### Lo que se ve, no sólo lo que se puede hacer

Un rol acotado a un proyecto tampoco **ve** los demás. El estado inicial, la
carga, los hallazgos, la estructura del plan y las propuestas de reparto llegan
recortados a lo que esa persona puede ver, y el CSV que exporte lleva
exactamente las mismas filas que su pantalla.

La saturación del equipo es la excepción y conviene entender por qué: la
ocupación de una persona calculada sólo con el proyecto que tú ves no es su
ocupación, es un número que engaña. Así que **ver la carga** acotado a un
proyecto da las horas de ese proyecto, y la columna de capacidad y saturación
pide el permiso en toda la herramienta.

Vienen tres roles editables de fábrica —**Lectura**, **Planificación** y
**Responsable**— y uno fijo, **Superadministración**, que lo tiene todo y no
aparece en la hoja. Esa excepción existe por una razón concreta: sin ella,
desmarcar la casilla equivocada te deja fuera de tu propia herramienta sin más
salida que abrir la base de datos a mano. La base de datos tiene además dos
triggers que rechazan borrarlo o repermisarlo incluso por SQL directo.

### Cuando alguien se va

Desactivar a una persona (**Usuarios y roles → Desactivar**) le cierra las
sesiones abiertas en el acto, no sólo le impide volver a entrar. Cambiarle la
contraseña hace lo mismo. Las cuentas no se borran: su rastro en el historial de
cambios tiene que seguir teniendo nombre.

### Lo que la interfaz esconde no es lo que protege

Las pestañas y los botones que no se pueden usar no se enseñan, pero eso es
cortesía. Lo que protege es la API: cada ruta declara su permiso y el servidor
deniega por defecto. Escribir la URL a mano devuelve un 403 con el nombre de la
función que falta.

---

## 8. Cuando algo va mal

**`api-1` aparece parado nada más levantar compose, en Windows.**
Casi siempre son los finales de línea. Git para Windows convierte a CRLF al
clonar (`core.autocrlf=true` es su valor por defecto), `docker/entrypoint.sh`
entra en la imagen con `\r` al final de cada línea y el contenedor muere al
instante: el núcleo busca un intérprete llamado `/bin/sh\r`, que no existe. En
el log se ve un `$'\r': command not found` o un `exec format error`.

El repositorio trae un `.gitattributes` que fuerza LF y el `Dockerfile` limpia
los `\r` al construir, así que en un clon nuevo no pasa. Si el clon es anterior:

```bash
git rm --cached -r .
git reset --hard
docker compose build --no-cache api
docker compose up -d
```

**La API no arranca y dice que falta `DATABASE_URL`.**
No has copiado `.env.example` a `.env`, o la ejecutas fuera de compose sin
exportarla.

**Lo primero que hay que mirar cuando algo no arranca.**

```bash
docker compose ps           # quién está vivo y quién no
docker compose logs migrate # el job del esquema
docker compose logs api     # la aplicación
```

`migrate` en `Exited (0)` es lo correcto. `api` parado es siempre un error, y
su log lo nombra.

**La API arranca pero todo sale vacío.**
El job `migrate` ha fallado. `docker compose logs migrate` lo dice. Casi siempre
es que la base no estaba lista: el job reintenta con `--wait`, pero si el
contenedor de la base no levanta, nada lo arregla.

**`docker compose ps` muestra `migrate` como `Exited (0)`.**
Es lo correcto. Es un job, no un servicio.

**El healthcheck de la API falla.**
`curl localhost:45678/api/health` devuelve el estado y la versión de PostgreSQL.
Si contesta, la API está bien y el problema es la base.

**Un cálculo tarda mucho.**
El tiempo de cada ejecución se guarda. `runs` en la CLI lo enseña, y la cabecera
de la interfaz también. Una cartera de tres proyectos con treinta tareas calcula
en decenas de milisegundos; si tarda segundos, el horizonte de cálculo es
demasiado largo o el número de tareas ha crecido mucho.

**Un número no cuadra con lo que enseñaba ayer.**
Compara los dos identificadores de ejecución en la pestaña **Comparar**. Nunca
hay dos números distintos para el mismo cálculo: si difieren, son cálculos
distintos, y el diff dice exactamente en qué.

---

## 9. Puesta en producción para un equipo

Lo mínimo que hay que cambiar respecto a la configuración de desarrollo:

- [ ] `POSTGRES_PASSWORD` con una contraseña de verdad.
- [ ] `SEED_DEMO=false`.
- [ ] Un usuario propio para la API, con el rol `planner_api` (punto 3).
- [ ] La copia de seguridad del punto 4 en un cron, con la restauración probada
      al menos una vez. Una copia que no se ha restaurado nunca no es una copia.
- [ ] El primer superadministrador creado (punto 7). Mientras no lo esté, la
      herramienta está abierta a cualquiera que llegue a ella.
- [ ] **Un proxy inverso con TLS delante.** Esto no es opcional en cuanto la
      herramienta sale de una máquina: en `http://` la contraseña y la cookie de
      sesión viajan en claro por la red del servidor, y la VPN cifra el túnel
      desde fuera pero no protege nada dentro.

Sobre el TLS: la cookie de sesión sólo lleva la marca `Secure` cuando la
petición llega por HTTPS. Si el proxy termina el TLS y habla con la API por
HTTP, tiene que mandar `X-Forwarded-Proto: https` para que la marca se ponga.
