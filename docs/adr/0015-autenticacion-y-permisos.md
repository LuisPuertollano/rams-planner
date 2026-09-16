# ADR-0015 · Autenticación y permisos

**Estado:** propuesta · **Fecha:** 2026-09-16

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

*Pendiente de las preguntas abiertas.* Lo que sí está decidido:

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

## Preguntas abiertas

Son decisiones del usuario, no técnicas, y cambian la implementación entera:

1. **¿Login propio o el SSO de la empresa?** Un login propio es autosuficiente y
   funciona en una instalación aislada. Con SSO (OIDC contra Entra ID, Google
   Workspace…) no hay contraseñas que guardar ni que perder, pero ata la
   herramienta a un servicio externo y complica el despliegue local.
2. **¿Qué roles hacen falta de verdad?** Un esbozo para discutir:
   - *lectura* — ve el plan y la carga; no ve costes ni tarifas.
   - *planificador* — edita plan, equipo y competencias.
   - *responsable* — además ve costes y tarifas.
   - *administración* — gestiona usuarios.
3. **¿Los costes se ocultan o se agregan?** Ocultarlos del todo deja la pestaña
   de carga a medias. Enseñar sólo totales por proyecto, sin tarifas
   individuales, suele ser lo que la gente quiere de verdad.
4. **¿Alguien debe ver sólo sus propios proyectos?** Si la respuesta es sí, el
   permiso deja de ser un rol global y pasa a ser por proyecto, que es bastante
   más trabajo.

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
