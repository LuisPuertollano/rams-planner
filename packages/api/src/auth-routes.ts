/**
 * Entrar, salir y saber quién eres — y el guardián que aplica los permisos.
 *
 * El guardián es un `preHandler` global: se ejecuta antes de cualquier
 * manejador, mira el permiso que la ruta declaró y decide. Lo importante es que
 * **el camino por defecto es denegar**: una ruta sin permiso declarado no llega
 * ni a registrarse (lo impide el arranque), y una petición sin sesión sólo pasa
 * por las cuatro rutas públicas.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  can,
  changeOwnPassword,
  effectivePermissions,
  enterAuditContext,
  findSession,
  login,
  logout,
  projectOfAssignment,
  projectOfNode,
  projectsOfDependency,
  withTransaction,
  type AppUser,
  type AuditContext,
  type EffectivePermissions,
  type Pool,
} from '@planner/persistence'
import {
  PERMISSIONS,
  PERMISSION_BY_CODE,
  PUBLIC_ROUTES,
  SESSION_ONLY_ROUTES,
  type PermissionScope,
  type ProjectSource,
} from './permissions.js'
import type { RoutePermissionConfig } from './route-permissions.js'

export const SESSION_COOKIE = 'planner_sesion'

/**
 * Una instalación sin ningún usuario con contraseña sigue funcionando sin
 * login, como hasta ahora.
 *
 * No es una puerta trasera, es la única forma de que actualizar no te deje
 * fuera de tu propia herramienta: quien ya la tenía en marcha no tiene usuarios
 * todavía, y si el guardián empezara a devolver 401 el día de la actualización,
 * la única salida sería abrir la base de datos a mano.
 *
 * En cuanto existe el primer usuario con contraseña, el control se activa solo
 * y ya no se puede volver atrás creando... nada: para desactivarlo habría que
 * borrar todos los usuarios, que es una decisión bien visible.
 *
 * **Sólo se cachea que está cerrada**, y esto no es un detalle. Cachear que
 * está abierta la mantiene abierta hasta que la caché caduque: alguien crea el
 * primer superadministrador con la CLI —otro proceso, que no puede avisar a
 * éste— y la herramienta sigue dejando entrar a cualquiera unos segundos más.
 * De los dos errores posibles, ése es el que no se puede permitir. El otro
 * —volver a consultar de más— cuesta un `SELECT EXISTS` sobre una tabla
 * diminuta, y sólo mientras la instalación siga abierta, que es un rato al
 * principio y nunca más.
 */
let cerrada = false

async function instalacionSinUsuarios(pool: Pool): Promise<boolean> {
  // Una vez hay usuarios, ya no se vuelve atrás: para reabrirla habría que
  // borrarlos todos, y eso es un reinicio del servidor de todas formas.
  if (cerrada) return false
  const { rows } = await pool.query<{ existe: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM app_user WHERE password_hash IS NOT NULL AND deleted_at IS NULL) AS existe',
  )
  const hayUsuarios = rows[0]?.existe ?? false
  if (hayUsuarios) cerrada = true
  return !hayUsuarios
}

/**
 * Vuelve a mirar si la instalación tiene usuarios.
 *
 * Sólo hace falta en un sentido: una base que se vacía entre pruebas. En
 * marcha, pasar de abierta a cerrada se nota solo, y de cerrada a abierta no
 * pasa.
 */
export function olvidarEstadoDeInstalacion(): void {
  cerrada = false
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Quién hace la petición. `undefined` mientras no haya sesión. */
    usuario?: AppUser
    permisos?: EffectivePermissions
    /**
     * El contexto que firma las escrituras de esta petición. Se crea vacío en
     * el primer hook y se rellena al resolver la sesión; es el mismo objeto que
     * lee `withTransaction`.
     */
    auditoria?: AuditContext
  }
}

/**
 * Lee la cookie de sesión a mano.
 *
 * Una dependencia menos que auditar para leer una cabecera. Lo que importa aquí
 * es lo de abajo: los atributos con los que se **escribe** la cookie.
 */
function sessionTokenOf(request: FastifyRequest): string | null {
  const header = request.headers.cookie
  if (header === undefined) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

/**
 * La cookie de sesión.
 *
 * - `HttpOnly`: JavaScript no la puede leer, así que un script que entre en la
 *   página no se lleva la sesión.
 * - `SameSite=Lax`: no viaja en peticiones que nazcan de otro sitio, que es la
 *   defensa contra que una página ajena actúe en tu nombre.
 * - `Secure` cuando se sirve por HTTPS. En una instalación por HTTP la cookie
 *   no llevaría `Secure` —si no, no funcionaría—, y eso significa que la
 *   contraseña y la sesión viajan en claro por la red. Es exactamente por esto
 *   que la documentación de operación pide TLS delante y no lo llama opcional.
 */
function cookieFor(token: string | null, secure: boolean): string {
  const base = [
    `${SESSION_COOKIE}=${token === null ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    token === null ? 'Max-Age=0' : `Max-Age=${String(60 * 60 * 24 * 14)}`,
  ]
  if (secure) base.push('Secure')
  return base.join('; ')
}

const esHttps = (request: FastifyRequest): boolean =>
  request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https'

/**
 * Dónde hay que tener el permiso para esta petición. Son tres preguntas
 * distintas y no se pueden confundir, porque confundirlas es exactamente cómo
 * se abren agujeros:
 *
 * - `global` — «¿lo tiene en toda la herramienta?». Crear un proyecto nuevo,
 *   mirar la saturación del equipo.
 * - `anywhere` — «¿lo tiene en algún sitio?». Sólo para respuestas que el
 *   manejador recorta después, y para permisos que no son por proyecto.
 * - `projects` — «¿lo tiene en estos?». La lista puede traer más de uno cuando
 *   la operación toca dos sitios, y un `null` cuando un identificador no
 *   corresponde a nada: ahí se deniega, que es lo seguro.
 */
type Alcance =
  | { readonly kind: 'global' }
  | { readonly kind: 'anywhere' }
  | { readonly kind: 'projects'; readonly ids: readonly (string | null)[] }

async function alcanceDeLaPeticion(
  pool: Pool,
  request: FastifyRequest,
  scope: PermissionScope,
  fuente: ProjectSource | undefined,
): Promise<Alcance> {
  // Un permiso global sin nada declarado se exige **global**, no «en algún
  // sitio». Si no, un rol concedido sobre un proyecto arrastraría consigo
  // permisos sobre el equipo o el motor, que no son de ningún proyecto: el
  // agujero exacto que los roles por proyecto existen para no tener.
  if (fuente === undefined) return scope === 'global' ? { kind: 'global' } : { kind: 'anywhere' }
  if (fuente.from === 'filtered') return { kind: 'anywhere' }
  if (fuente.from === 'global') return { kind: 'global' }
  if (fuente.refs.length === 0) return { kind: 'projects', ids: [null] }

  const resueltos: (string | null)[] = []
  for (const ref of fuente.refs) {
    const origen =
      ref.in === 'body'
        ? (request.body as Record<string, unknown> | undefined)
        : (request.params as Record<string, unknown> | undefined)
    const enCrudo = origen?.[ref.name]
    if (typeof enCrudo !== 'string' || enCrudo === '') {
      resueltos.push(null)
      continue
    }
    switch (ref.resolve) {
      case undefined:
        resueltos.push(enCrudo)
        break
      case 'node':
        resueltos.push(await withTransaction(pool, (db) => projectOfNode(db, enCrudo)))
        break
      case 'assignment':
        resueltos.push(await withTransaction(pool, (db) => projectOfAssignment(db, enCrudo)))
        break
      case 'dependency': {
        const proyectos = await withTransaction(pool, (db) => projectsOfDependency(db, enCrudo))
        if (proyectos.length === 0) resueltos.push(null)
        else resueltos.push(...proyectos)
        break
      }
      default:
        // El tipo no deja llegar aquí; si llegara sería un `resolve` nuevo sin
        // resolutor, y eso se deniega en vez de dejarlo pasar.
        resueltos.push(null)
    }
  }
  return { kind: 'projects', ids: resueltos }
}

/** ¿Autoriza este alcance? Un identificador que no resuelve nunca autoriza. */
function autoriza(permisos: EffectivePermissions, code: string, alcance: Alcance): boolean {
  switch (alcance.kind) {
    case 'global':
      return can(permisos, code, null)
    case 'anywhere':
      return can(permisos, code)
    case 'projects':
      return (
        alcance.ids.length > 0 &&
        alcance.ids.every((projectId) => projectId !== null && can(permisos, code, projectId))
      )
  }
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
  /**
   * El guardián. Se engancha antes que nada y decide en tres pasos: quién eres,
   * si esta ruta necesita permiso, y si lo tienes.
   */
  /**
   * Lo primero de todo, y sin esperar a nada: el contexto de auditoría.
   *
   * Tiene que ser aquí. `enterWith` sólo alcanza a lo que venga después en la
   * misma cadena de ejecución, y hacerlo tras el `await` que resuelve la sesión
   * llegaría tarde: el manejador ya no lo vería y el historial volvería a
   * guardar cambios sin nombre. Por eso el objeto se crea vacío ahora y se le
   * pone el actor abajo, en cuanto se sabe quién es.
   */
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
    const contexto: AuditContext = { requestId: request.id }
    request.auditoria = contexto
    enterAuditContext(contexto)
    done()
  })

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/')) return

    const token = sessionTokenOf(request)
    if (token !== null) {
      const usuario = await withTransaction(pool, (db) => findSession(db, token))
      if (usuario !== null) {
        request.usuario = usuario
        request.permisos = await withTransaction(pool, (db) => effectivePermissions(db, usuario.id))
        // A partir de aquí, cualquier escritura de esta petición queda firmada,
        // la haga el manejador o algo que el manejador llame. Es lo que evita
        // que una ruta nueva se olvide de decir quién la pidió.
        if (request.auditoria !== undefined) request.auditoria.actorId = usuario.id
      }
    }

    // La ruta sin barra final tal cual la declaró Fastify: es la que conoce el
    // catálogo. `request.url` traería la consulta y los parámetros resueltos.
    const rutaDeclarada = request.routeOptions.url ?? ''
    if (PUBLIC_ROUTES.has(rutaDeclarada)) return

    // Instalación recién actualizada, todavía sin usuarios: se deja pasar y se
    // avisa. El aviso no es decorativo — mientras salga, la herramienta está
    // abierta a quien llegue a ella.
    if (await instalacionSinUsuarios(pool)) {
      request.log.warn(
        'Sin usuarios dados de alta: la herramienta está abierta. Crea el primero con ' +
          '`node packages/api/dist/cli.js crear-superadmin <correo> <nombre>`.',
      )
      return
    }

    if (request.usuario === undefined) {
      return reply.status(401).send({ error: 'Hay que entrar para hacer esto.', code: 'SIN_SESION' })
    }

    // Sesión sí, permiso no: lo que uno hace sobre su propia cuenta.
    if (SESSION_ONLY_ROUTES.has(rutaDeclarada)) return

    const config = request.routeOptions.config as RoutePermissionConfig | undefined
    const permiso = config?.permission
    if (permiso === undefined) {
      // No debería ocurrir: el arranque no deja pasar una ruta sin permiso. Si
      // pasa, se deniega. Un fallo de configuración nunca abre una puerta.
      request.log.error({ ruta: rutaDeclarada }, 'ruta sin permiso declarado: se deniega')
      return reply.status(403).send({ error: 'Esta función no está configurada.', code: 'SIN_PERMISO' })
    }

    const definicion = PERMISSION_BY_CODE.get(permiso)
    if (definicion === undefined) {
      // Otro caso que el arranque ya descarta: un permiso que no está en el
      // catálogo. Si llegara, se deniega.
      request.log.error({ ruta: rutaDeclarada, permiso }, 'permiso fuera del catálogo: se deniega')
      return reply.status(403).send({ error: 'Esta función no está configurada.', code: 'SIN_PERMISO' })
    }

    const permisos = request.permisos
    if (permisos === undefined) {
      return reply.status(401).send({ error: 'Hay que entrar para hacer esto.', code: 'SIN_SESION' })
    }

    // Dónde hay que tener el permiso. El arranque ya ha exigido que toda ruta
    // con un permiso por proyecto diga de qué proyecto habla, así que aquí no
    // hay que adivinar nada.
    let alcance: Alcance
    try {
      alcance = await alcanceDeLaPeticion(pool, request, definicion.scope, config?.project)
    } catch (error) {
      request.log.error({ err: error, ruta: rutaDeclarada }, 'no se pudo resolver el proyecto de la petición')
      return reply.status(403).send({ error: 'Esta función no está configurada.', code: 'SIN_PERMISO' })
    }

    if (!autoriza(permisos, permiso, alcance)) {
      const enTodaLaHerramienta = alcance.kind === 'global'
      return reply.status(403).send({
        // Un permiso denegado se explica: qué hace falta y dónde, no un 403
        // pelado. «Lo tienes, pero no aquí» es la mitad que más se pregunta.
        error: enTodaLaHerramienta
          ? `Te falta el permiso «${definicion.label}» en toda la herramienta. ` +
            'Tenerlo sobre un proyecto suelto no basta para esto.'
          : `Te falta el permiso «${definicion.label}»${
              definicion.scope === 'project' ? ' en este proyecto' : ''
            }.`,
        code: 'SIN_PERMISO',
        permiso,
      })
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = z
      .object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) })
      .parse(request.body)

    const sesion = await withTransaction(pool, (db) =>
      login(db, body.email, body.password, request.headers['user-agent'] ?? null),
    )
    if (sesion === null) {
      // El mismo mensaje para «no existe» y «contraseña mala»: decir cuál de
      // las dos es regala la mitad del trabajo a quien prueba correos.
      return reply.status(401).send({ error: 'El correo o la contraseña no son correctos.' })
    }

    const permisos = await withTransaction(pool, (db) => effectivePermissions(db, sesion.user.id))
    return reply
      .header('set-cookie', cookieFor(sesion.token, esHttps(request)))
      .send({
        user: sesion.user,
        permissions: describePermissions(permisos),
        catalogue: PERMISSIONS,
        openInstallation: false,
      })
  })

  /**
   * Cambiar la propia contraseña.
   *
   * Existe porque la CLI dice «cámbiala al entrar» al crear una cuenta, y hasta
   * ahora no había forma de hacerlo: la única salida era pedírselo a quien
   * administra, que es exactamente lo que no debería hacer falta con una
   * contraseña que ya conoce otra persona.
   *
   * Cambiarla cierra todas las sesiones, la de quien la cambia incluida: si se
   * cambia porque alguien más la conocía, dejar sesiones vivas no arregla nada.
   * Por eso se responde con la cookie borrada y hay que volver a entrar.
   */
  app.post('/api/auth/clave', async (request, reply) => {
    const body = z
      .object({ actual: z.string().min(1).max(200), nueva: z.string().min(12).max(200) })
      .parse(request.body)

    const usuario = request.usuario
    if (usuario === undefined) {
      return reply.status(401).send({ error: 'Hay que entrar para hacer esto.', code: 'SIN_SESION' })
    }
    if (body.actual === body.nueva) {
      return reply.status(422).send({ error: 'La contraseña nueva tiene que ser distinta de la actual.' })
    }

    const cambiada = await withTransaction(pool, (db) =>
      changeOwnPassword(db, usuario.id, body.actual, body.nueva),
    )
    if (!cambiada) {
      // El mismo mensaje que al entrar mal: no confirma nada de la actual.
      return reply.status(401).send({ error: 'La contraseña actual no es correcta.' })
    }

    return reply
      .header('set-cookie', cookieFor(null, esHttps(request)))
      .send({ ok: true, sesionCerrada: true })
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = sessionTokenOf(request)
    if (token !== null) await withTransaction(pool, async (db) => { await logout(db, token) })
    return reply.header('set-cookie', cookieFor(null, esHttps(request))).send({ ok: true })
  })

  /** ¿Está la instalación todavía sin usuarios? La interfaz lo avisa arriba. */
  app.get('/api/auth/estado', { config: { permission: 'usuarios.gestionar' } }, async () => ({
    sinUsuarios: await instalacionSinUsuarios(pool),
  }))

  /**
   * Quién eres y qué puedes hacer. Sin sesión responde que nadie, con un 200:
   * la interfaz necesita poder preguntarlo para decidir si enseña el formulario
   * de entrada, y un 401 aquí sería ruido en la consola de todo el mundo.
   *
   * `openInstallation` es lo que distingue «todavía no has entrado» de «aquí
   * no hay ni usuarios»: sin ese dato la interfaz no sabría si enseñar el
   * formulario de entrada o dejar pasar a una herramienta recién instalada.
   */
  app.get('/api/auth/me', async (request) => {
    const openInstallation = await instalacionSinUsuarios(pool)
    if (request.usuario === undefined || request.permisos === undefined) {
      return { user: null, permissions: null, catalogue: PERMISSIONS, openInstallation }
    }
    return {
      user: request.usuario,
      permissions: describePermissions(request.permisos),
      catalogue: PERMISSIONS,
      openInstallation,
    }
  })

  // El aviso también en el arranque, donde lo ve quien despliega.
  void instalacionSinUsuarios(pool).then((abierta) => {
    if (abierta) {
      app.log.warn(
        'ATENCIÓN: no hay ningún usuario dado de alta, así que la herramienta está abierta ' +
          'a cualquiera que llegue a ella. Crea el primero con ' +
          '`node packages/api/dist/cli.js crear-superadmin <correo> <nombre>`.',
      )
    }
  })
}

/** Los permisos en algo que el cliente pueda leer: los `Set` no viajan por JSON. */
function describePermissions(permisos: EffectivePermissions): {
  isSuperadmin: boolean
  global: string[]
  byProject: Record<string, string[]>
} {
  const byProject: Record<string, string[]> = {}
  for (const [projectId, codigos] of permisos.byProject) byProject[projectId] = [...codigos].sort()
  return {
    isSuperadmin: permisos.isSuperadmin,
    global: [...permisos.global].sort(),
    byProject,
  }
}

/**
 * ¿Puede quien hace esta petición?
 *
 * Es para los permisos que no son una puerta sino un filtro: la ruta se deja
 * pasar, pero lo que se devuelve depende del permiso. `costes.ver` es el caso
 * claro — la carga se ve, los importes no —, y `nivelar` y
 * `plantillas.gestionar` son la otra forma: la misma ruta hace dos cosas y sólo
 * una de ellas necesita el permiso extra.
 *
 * El catálogo declara dónde se aplica cada uno (`enforcedIn`), y
 * `misplacedEnforcement()` avisa si alguna de esas rutas se renombra y este
 * código se queda hablando de una ruta que ya no existe.
 */
export function puede(request: FastifyRequest, code: string): boolean {
  // Instalación todavía sin usuarios: el guardián ya ha dejado pasar, y aquí
  // tampoco se recorta nada. Es el modo abierto, y viene con su aviso.
  if (request.permisos === undefined) return true
  return can(request.permisos, code)
}

/**
 * ¿Puede esto **en toda la herramienta**?
 *
 * Para lo que no es de ningún proyecto y aun así lleva un permiso que sí se
 * concede por proyecto. El caso es la tarifa de una persona: `costes.ver` sobre
 * el proyecto A deja ver los importes de A, no lo que cobra cada uno.
 */
export function puedeEnTodaLaHerramienta(request: FastifyRequest, code: string): boolean {
  if (request.permisos === undefined) return true
  return can(request.permisos, code, null)
}
