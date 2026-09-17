# ADR-0015 · Autenticación y permisos

**Estado:** aceptada e implementada (queda un detalle abierto) · **Fecha:** 2026-09-16 · **Revisada:** 2026-09-17

## Contexto

La herramienta no tiene autenticación. Hoy eso es correcto: se despliega en la
red local de un equipo y `docs/operacion.md` dice que, para exponerla fuera,
hay que poner un proxy inverso delante.

Alojarla en web cambia eso, y entonces aparecen dos necesidades distintas que
conviene no confundir:

1. **Saber quién hace cada cambio.** El esquema ya está preparado: existe
   `app_user`, y el trigger de auditoría lee `app.actor_id` de la sesión. Hoy
   los cambios se registran sin actor, que es honesto pero poco útil cuando son
   varias personas.
2. **Limitar qué puede ver y hacer cada uno.** Los costes por hora del equipo no
   son un dato que deba ver todo el mundo.

Son necesidades separadas: la primera es auditoría y ya tiene su sitio; la
segunda es autorización y hay que diseñarla.

## Decisión

El despliegue es **red local o VPN**, nunca internet abierto. Eso quita de encima
el registro público, la recuperación por correo, los captchas y los límites
anti-bots: el riesgo aquí no es un atacante anónimo, es que un compañero vea lo
que no le toca. Se resuelve con roles, no con fortificación.

- **Login propio**, sin SSO. Basta para una instalación de equipo y no ata la
  herramienta a un servicio externo. Si algún día hay Entra ID o Google
  Workspace de por medio, se añade sin rehacer nada.
- **TLS delante, y esto no es opcional.** En `http://` la contraseña y la cookie
  de sesión viajan en claro por la red. La VPN cifra el túnel desde fuera, pero
  dentro de la red del servidor no protege nada. Un proxy inverso (nginx, Caddy)
  con certificado interno.
- **El permiso es por pantalla y acción**, no por endpoint suelto ni por pantalla
  entera. Unas 28 casillas del tipo «ver la carga», «ver costes», «editar
  tareas», «editar tarifas». Es el grano en el que se puede decidir sin
  necesitar un manual, y permite lo que de verdad se pide: que alguien vea el
  plan sin poder tocarlo.
- **Los permisos son por proyecto.** Un rol se concede sobre un proyecto
  concreto, y también de forma global para quien trabaja en todos. El permiso
  efectivo sobre un proyecto es la unión de los dos.
- **Pero no todos los permisos se pueden acotar.** Las personas del equipo, sus
  tarifas, sus competencias y las ejecuciones del motor son de todos los
  proyectos a la vez: «editar el equipo, pero sólo en el proyecto A» no
  describe nada. Cada función del catálogo dice de cuáles es (`scope`), y una
  función global **sólo cuenta concedida en toda la herramienta**. Un rol
  concedido sobre un proyecto lleva únicamente sus funciones por proyecto.
- **El superadministrador es un rol fijo que la hoja no puede editar.** Lo tiene
  todo y no se le puede quitar nada desde la propia interfaz. Es la única forma
  de que desmarcar una casilla no te deje fuera de tu herramienta sin más salida
  que abrir la base de datos a mano.

Y lo que ya estaba decidido y no depende de nada de lo anterior:

- **La autorización no se implementa sólo en la interfaz.** Esconder un botón no
  es un permiso. Cualquier regla se hace cumplir en la API y, donde se pueda, en
  los roles de base de datos que ya existen (`planner_api`, `planner_engine`,
  `planner_readonly`), que están puestos exactamente para esto.
- **Las contraseñas no se guardan, ni siquiera cifradas.** Se guarda un hash con
  un algoritmo de derivación lento y con sal, nunca un digest rápido. Se ha
  implementado con **scrypt** (`node:crypto`, N=32768, r=8, p=1, 64 bytes) en
  lugar de argon2id por una razón práctica: argon2 obliga a compilar una
  extensión nativa, y la imagen es Alpine. El hash guarda sus propios
  parámetros (`scrypt$N$r$p$sal$derivada`), así que subir el coste más adelante
  no invalida las contraseñas que ya existen.
- **La sesión va en una cookie `HttpOnly`, `Secure` y `SameSite=Lax`**, no en
  `localStorage`: un token que puede leer JavaScript lo puede leer cualquier
  script que entre en la página.
- **El actor de cada cambio pasa a `app.actor_id`** en la transacción, que es
  donde el trigger de auditoría ya lo está esperando. Esto es lo primero que hay
  que hacer y lo que menos discusión tiene.
- **Un permiso denegado se explica.** Igual que un hallazgo: qué hace falta para
  hacer eso, no un 403 pelado.
- **Cambiarse la propia contraseña no depende de ningún rol.** Es la tercera
  categoría de ruta, junto a las públicas y las que piden permiso: pide sesión
  y nada más. Ponerle un permiso del catálogo permitiría que alguien se lo
  quitara a otro, que es dejar a una persona encerrada con una contraseña que
  no puede cambiar. La lista está declarada y auditada igual que la de rutas
  públicas, y tiene una sola entrada.

## El catálogo se deriva del código, y se hace cumplir

Una hoja de permisos sólo vale si está completa. Una lista escrita a mano se
desincroniza a la tercera funcionalidad nueva, y lo peor es cómo falla: el
endpoint nuevo no aparece en la hoja y queda **abierto para todos** sin que nadie
lo haya decidido.

Por eso el catálogo vive en `packages/api/src/permissions.ts` y es la fuente
única de la que salen la comprobación de cada petición, la hoja que ve el
superadministrador y la documentación de qué significa cada función. Y por eso:

- **Cada ruta declara su permiso** en su propia definición, no en una tabla
  aparte.
- **Una prueba registra las rutas de verdad** —con las mismas funciones que usa
  el servidor— y audita lo que salga. Una ruta sin permiso, o con un permiso que
  no está en el catálogo, rompe CI con el método y la ruta en el mensaje.
- **El servidor tampoco arranca** si encuentra una. Es mejor no arrancar que
  arrancar con un agujero que nadie ve.
- Los permisos que no protegen una ruta entera sino lo que se devuelve —los
  importes— o lo que se pide —nivelar es un `POST /api/calculate` con una
  bandera— declaran en qué ruta se aplican, y otra prueba comprueba que esa ruta
  sigue existiendo. Renombrar un endpoint sin actualizar el catálogo deja el
  permiso apuntando al vacío, y eso también se caza.
- **Cada ruta con un permiso por proyecto dice de qué proyecto habla.** Es la
  mitad que declarar el permiso no garantiza: sin ella, el guardián sólo puede
  preguntar «¿puede en *algún* proyecto?», y un rol acotado deja de acotar. La
  declaración es `project:` en el `config` de la ruta, y dice de dónde sale el
  proyecto —un identificador de la ruta o del cuerpo, un nodo, una asignación,
  una dependencia—, o que la acción es de toda la herramienta, o que la
  respuesta la recorta el propio manejador. El arranque no deja pasar una ruta
  por proyecto sin declararlo, ni una global que declare un proyecto que no
  puede tener.

Es el mismo trato que la regla de dependencias del núcleo: la regla se hace
cumplir, no se recuerda.

## Cómo ha quedado

- `db/migrations/20260917080000_usuarios_y_roles.sql` · `app_role`,
  `role_permission`, `user_role` (con `project_id` nulo = global) y
  `user_session`. Dos triggers impiden borrar, renombrar o repermisar el rol de
  sistema desde SQL, no sólo desde la interfaz.
- `packages/persistence/src/auth.ts` · contraseñas y sesiones. Se guarda el
  SHA-256 del token de sesión, nunca el token: quien lea la base de datos no
  puede suplantar a nadie con lo que hay en ella. `login()` verifica una
  contraseña aunque el correo no exista, para que tardar menos no delate qué
  correos están dados de alta.
- `packages/persistence/src/roles.ts` · permisos efectivos, globales y por
  proyecto, con `can()` y `projectsWhere()`.
- `packages/api/src/auth-routes.ts` · el guardián. Un `preHandler` global que
  deniega por defecto: sólo pasan las cuatro rutas públicas declaradas en el
  catálogo y las que traen un permiso que quien pide tiene.
- `packages/api/src/admin-routes.ts` y `packages/web/src/views/AdminView.tsx` ·
  la hoja: funciones en filas, agrupadas por pantalla; roles editables en
  columnas; una casilla por cruce.
- `packages/persistence/src/audit-context.ts` · quién firma cada cambio. El
  actor viaja en un `AsyncLocalStorage` que se fija en el primer hook de la
  petición, y `withTransaction` lo recoge sin que nadie tenga que pasarlo: las
  cuarenta llamadas que escriben quedan firmadas sin tocarlas, y una ruta nueva
  no se puede olvidar de hacerlo. Un `actorId` explícito sigue ganando, para
  los trabajos de fondo.
- `packages/api/src/permissions.integration.test.ts` · las pruebas que entran
  por la puerta. Montan la aplicación entera, crean cuentas con permisos
  concretos y comprueban lo que contesta el servidor, que es lo único que
  cuenta. Las de auditoría piden **por HTTP de verdad**, no con `inject`: sin
  socket de por medio la cadena asíncrona se conserva, el fallo de propagación
  del actor no se reproduce y la prueba daría verde con el historial anónimo.

### Qué se ve, no sólo qué se puede hacer

Denegar una escritura es la mitad fácil. La otra es que una lectura no devuelva
lo que no toca: `/api/state`, la carga, los hallazgos, la estructura del plan y
las propuestas de reparto salen **recortadas** a los proyectos que quien
pregunta puede ver, y el CSV exportado lleva exactamente las mismas filas que la
pantalla. Poder exportar no amplía lo que se puede mirar.

Lo que no pertenece a ningún proyecto —la saturación de una persona, un hallazgo
sobre alguien del equipo— pide el permiso **en toda la herramienta**. Servir un
trozo daría un número que no significa nada: la ocupación de Ana calculada sólo
con el proyecto que tú ves no es su ocupación. Y además delataría, por
diferencia, la carga que no se puede ver.

### La instalación recién hecha

Una base migrada y sin ningún usuario queda **abierta**, con un aviso en el log
del arranque y un banner rojo en la interfaz. La alternativa —una instalación
que no deja entrar a nadie hasta que alguien encuentre el comando— convierte
cada despliegue nuevo en un problema de soporte. El primer superadministrador se
crea con `crear-superadmin`, y desde ese momento la puerta se cierra sola.

## Lo que queda abierto

**Los costes: ¿se ocultan o se agregan?** De momento `costes.ver` los oculta
entero: sin ese permiso la API **no envía** los importes, no los esconde en
pantalla. Es la opción segura y la que se implementa. Queda por decidir si hace
falta un punto intermedio —totales por proyecto sin tarifas individuales—, que
es lo que suele querer la gente en la práctica. Cambiarlo más adelante es añadir
un permiso al catálogo, no rehacer nada.

## Por qué se decidió antes de escribirlo

Es la única parte de la herramienta donde equivocarse tiene consecuencias que no
se ven. Un fallo en el reparto de trabajo propone una tontería y se descarta; un
fallo en la autenticación deja la planificación y los costes de un equipo
expuestos sin que nadie se entere, y puede tardar meses en descubrirse.

Y las preguntas de arriba —el grano del permiso, si es por proyecto, qué pasa
con el superadministrador— no las puede contestar quien escribe el código:
cambian según cómo trabaje el equipo que la usa. Por eso este ADR se escribió
antes que el código y se implementó después de contestarlas, en vez de al revés.

## Lo que sigue haciendo falta fuera de la herramienta

El TLS. La autenticación existe, pero en `http://` la contraseña y la cookie
viajan en claro por la red del servidor, y eso la VPN no lo arregla. Un proxy
inverso con certificado delante sigue siendo obligatorio, y ahora lo es por una
razón más concreta que antes: ya hay contraseñas que interceptar.
