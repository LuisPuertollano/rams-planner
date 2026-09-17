# ADR-0015 · Autenticación y permisos

**Estado:** aceptada (queda un detalle abierto) · **Fecha:** 2026-09-16 · **Revisada:** 2026-09-17

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
  un algoritmo de derivación lento y con sal (argon2id o bcrypt), nunca un
  digest rápido.
- **La sesión va en una cookie `HttpOnly`, `Secure` y `SameSite=Lax`**, no en
  `localStorage`: un token que puede leer JavaScript lo puede leer cualquier
  script que entre en la página.
- **El actor de cada cambio pasa a `app.actor_id`** en la transacción, que es
  donde el trigger de auditoría ya lo está esperando. Esto es lo primero que hay
  que hacer y lo que menos discusión tiene.
- **Un permiso denegado se explica.** Igual que un hallazgo: qué hace falta para
  hacer eso, no un 403 pelado.

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

Es el mismo trato que la regla de dependencias del núcleo: la regla se hace
cumplir, no se recuerda.

## Lo que queda abierto

**Los costes: ¿se ocultan o se agregan?** De momento `costes.ver` los oculta
entero: sin ese permiso la API **no envía** los importes, no los esconde en
pantalla. Es la opción segura y la que se implementa. Queda por decidir si hace
falta un punto intermedio —totales por proyecto sin tarifas individuales—, que
es lo que suele querer la gente en la práctica. Cambiarlo más adelante es añadir
un permiso al catálogo, no rehacer nada.

## Por qué no se ha implementado ya

Es la única parte de la herramienta donde equivocarse tiene consecuencias que no
se ven. Un fallo en el reparto de trabajo propone una tontería y se descarta;
un fallo en la autenticación deja la planificación y los costes de un equipo
expuestos sin que nadie se entere, y puede tardar meses en descubrirse.

Además, las cuatro preguntas de arriba no las puede contestar quien escribe el
código: cambian según cómo trabaje el equipo que la usa. Implementar primero y
preguntar después significaría tirar el trabajo o, peor, quedarse con lo que
salió.

## Mientras tanto

Lo que dice `docs/operacion.md` sigue siendo la respuesta correcta: si la
herramienta sale de la red local, un proxy inverso delante con su propia
autenticación. No es una solución elegante, pero es una solución real y no
depende de que este ADR se cierre.
