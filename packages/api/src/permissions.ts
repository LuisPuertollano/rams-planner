/**
 * Catálogo de funciones de la herramienta.
 *
 * Esta lista es **la fuente única** de lo que se puede hacer. De aquí salen tres
 * cosas que antes se escribían por separado y se desincronizaban:
 *
 *   1. La comprobación de permisos en cada petición.
 *   2. La hoja de roles que ve el superadministrador.
 *   3. La documentación de qué significa cada función.
 *
 * Y lo que la mantiene al día no es la buena voluntad: **toda ruta `/api/` tiene
 * que declarar su permiso, y una prueba lo comprueba recorriendo las rutas que
 * Fastify tiene registradas de verdad**. Añadir un endpoint sin decir quién
 * puede usarlo rompe CI. Es el mismo trato que la regla de dependencias del
 * núcleo: la regla se hace cumplir, no se recuerda.
 */

/** Las pantallas, en el orden en que aparecen en la barra. */
export const SCREENS = [
  'Carga',
  'Plan',
  'Equipo',
  'Competencias',
  'Documentos',
  'Reparto',
  'Informes',
  'Comparar',
  'Datos',
  'Administración',
] as const

export type Screen = (typeof SCREENS)[number]

/**
 * De qué habla un permiso.
 *
 * `project`: se puede conceder sobre un proyecto concreto y entonces sólo vale
 * ahí. Editar una tarea del proyecto A no dice nada sobre el proyecto B.
 *
 * `global`: no tiene sentido por proyecto y sólo cuenta concedido en toda la
 * herramienta. Las personas del equipo, sus tarifas, sus competencias y las
 * ejecuciones del motor son de todos los proyectos a la vez; un rol concedido
 * sólo sobre un proyecto **no** trae consigo sus permisos globales, porque
 * «editar el equipo, pero sólo en el proyecto A» no describe nada.
 */
export type PermissionScope = 'project' | 'global'

/**
 * Un identificador de la petición que lleva a un proyecto. Sin `resolve` ya es
 * el proyecto; con él es un nodo, una asignación o una dependencia, y el
 * guardián consulta a qué proyecto pertenece.
 */
export interface ProjectRef {
  readonly in: 'params' | 'body'
  readonly name: string
  readonly resolve?: 'node' | 'assignment' | 'dependency'
}

/** De dónde sale el proyecto del que habla una petición. */
export type ProjectSource =
  /**
   * De uno o varios identificadores de la petición. Varios cuando la operación
   * toca dos sitios a la vez —una dependencia entre proyectos, un reparto que
   * mueve trabajo—: ahí hace falta poder en **todos**, no en uno.
   */
  | { readonly from: 'request'; readonly refs: readonly ProjectRef[] }
  /**
   * La petición no habla de un proyecto sino de todos —crear uno nuevo, mirar
   * la saturación del equipo—, así que el permiso se exige **en toda la
   * herramienta**. Tenerlo sobre un proyecto no basta.
   */
  | { readonly from: 'global' }
  /**
   * La respuesta cubre varios proyectos y el manejador la **recorta** a los que
   * quien pregunta puede ver. El guardián sólo comprueba que pueda en alguno;
   * lo que sale ya viene filtrado.
   */
  | { readonly from: 'filtered' }

/**
 * Atajos para declararlo en las rutas sin que la definición se coma la línea.
 * Se leen como lo que significan, que es de lo que se trata.
 */
export const desde = (...refs: readonly ProjectRef[]): ProjectSource => ({ from: 'request', refs })
export const enProyecto = (name = 'projectId', where: 'params' | 'body' = 'params'): ProjectRef => ({
  in: where,
  name,
})
export const porNodo = (name = 'nodeId', where: 'params' | 'body' = 'params'): ProjectRef => ({
  in: where,
  name,
  resolve: 'node',
})
export const porAsignacion = (name = 'assignmentId', where: 'params' | 'body' = 'params'): ProjectRef => ({
  in: where,
  name,
  resolve: 'assignment',
})
export const porDependencia = (name = 'id', where: 'params' | 'body' = 'params'): ProjectRef => ({
  in: where,
  name,
  resolve: 'dependency',
})
/** La acción es de toda la herramienta: el permiso se exige global. */
export const EN_TODA_LA_HERRAMIENTA: ProjectSource = { from: 'global' }
/** La respuesta la recorta el manejador a lo que quien pregunta puede ver. */
export const RECORTADO: ProjectSource = { from: 'filtered' }

export interface PermissionDefinition {
  /** Código estable: es lo que se guarda en la base de datos. No se renombra. */
  readonly code: string
  /** Si se puede conceder por proyecto o sólo en toda la herramienta. */
  readonly scope: PermissionScope
  readonly screen: Screen
  /** Qué se puede hacer, en la frase que leería quien reparte los permisos. */
  readonly label: string
  /** Por qué importa, para que marcar la casilla sea una decisión informada. */
  readonly detail: string
  /**
   * Un permiso sensible sale marcado en la hoja. No cambia nada técnicamente;
   * cambia que quien reparte se lo piense.
   */
  readonly sensitive?: boolean
  /**
   * No todos los permisos protegen una ruta entera. Algunos dependen de lo que
   * se pida —nivelar es un `POST /api/calculate` con una bandera— y otros
   * filtran lo que se devuelve, como los importes. Esos se comprueban dentro
   * del manejador, y aquí se dice en cuál: así siguen siendo visibles y la
   * prueba puede exigir que la ruta que se nombra exista de verdad.
   */
  readonly enforcedIn?: readonly string[]
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // --- Carga y saturación ---------------------------------------------------
  {
    code: 'carga.ver',
    scope: 'project',
    screen: 'Carga',
    label: 'Ver la carga y la saturación',
    detail: 'Las horas comprometidas por persona, mes y proyecto, y quién se pasa de capacidad.',
    // El informe lleva el reparto por persona dentro. Sin este permiso llega
    // sin esa parte, y lo dice en vez de enseñar ceros.
    enforcedIn: ['GET /api/report'],
  },
  {
    code: 'costes.ver',
    scope: 'project',
    screen: 'Carga',
    label: 'Ver costes y tarifas',
    detail:
      'Los importes en euros, aquí y en cualquier otra pantalla. Sin este permiso la herramienta ' +
      'devuelve los datos sin importes: no se ocultan en pantalla, no se envían.',
    sensitive: true,
    // Filtra el contenido de varias respuestas, no el acceso a una ruta.
    enforcedIn: [
      'GET /api/runs/:runId/load',
      'GET /api/runs/:runId/export.csv',
      'GET /api/resources',
      'GET /api/report',
    ],
  },

  // --- Plan -----------------------------------------------------------------
  {
    code: 'plan.ver',
    scope: 'project',
    screen: 'Plan',
    label: 'Ver el plan y sus resultados',
    detail: 'El árbol de trabajo, las fechas calculadas, el cronograma y los hallazgos.',
  },
  {
    code: 'plan.editar',
    scope: 'project',
    screen: 'Plan',
    label: 'Editar tareas',
    detail: 'Duración, avance, restricciones y fechas objetivo de una tarea que ya existe.',
  },
  {
    code: 'plan.estructura',
    scope: 'project',
    screen: 'Plan',
    label: 'Crear y quitar proyectos, fases y tareas',
    detail: 'Cambiar la forma del árbol, no sólo lo que hay dentro. Incluye dar de baja una rama.',
  },
  {
    code: 'asignaciones.editar',
    scope: 'project',
    screen: 'Plan',
    label: 'Asignar personas a tareas',
    detail: 'Quién trabaja en qué y con qué dedicación. De aquí nace la carga.',
  },
  {
    code: 'dependencias.editar',
    scope: 'project',
    screen: 'Plan',
    label: 'Editar dependencias',
    detail: 'Qué espera a qué. Es lo que más mueve las fechas de todo el plan.',
  },
  {
    code: 'requisitos.editar',
    scope: 'project',
    screen: 'Plan',
    label: 'Editar las competencias que pide una tarea',
    detail: 'El nivel mínimo que exige cada tarea, que es lo que dispara los avisos de competencia.',
  },

  // --- Equipo ---------------------------------------------------------------
  {
    code: 'equipo.ver',
    scope: 'global',
    screen: 'Equipo',
    label: 'Ver el equipo y su calendario',
    detail: 'Las personas, sus calendarios, su dedicación y sus ausencias. Sin tarifas.',
  },
  {
    code: 'equipo.editar',
    scope: 'global',
    screen: 'Equipo',
    label: 'Editar la ficha de una persona',
    detail: 'Alta y baja, nombre, calendario y dedicación base.',
  },
  {
    code: 'ausencias.editar',
    scope: 'global',
    screen: 'Equipo',
    label: 'Editar disponibilidad y ausencias',
    detail: 'Vacaciones, bajas, formación y tramos de dedicación. Cambia la capacidad real.',
  },
  {
    code: 'tarifas.editar',
    scope: 'global',
    screen: 'Equipo',
    label: 'Editar tarifas',
    detail: 'El coste por hora de cada persona. Implica poder verlas.',
    sensitive: true,
  },

  // --- Competencias ---------------------------------------------------------
  {
    code: 'competencias.ver',
    scope: 'global',
    screen: 'Competencias',
    label: 'Ver la hoja de competencias',
    detail: 'Quién sabe hacer qué y dónde el equipo depende de una sola persona.',
  },
  {
    code: 'competencias.editar',
    scope: 'global',
    screen: 'Competencias',
    label: 'Editar el nivel de las personas',
    detail: 'Subir o bajar el nivel de alguien en una competencia.',
    sensitive: true,
  },
  {
    code: 'competencias.catalogo',
    scope: 'global',
    screen: 'Competencias',
    label: 'Gestionar el catálogo de competencias',
    detail: 'Crear y retirar competencias. Retirar una borra los niveles de todo el equipo.',
  },

  // --- Documentos -----------------------------------------------------------
  {
    code: 'documentos.ver',
    scope: 'global',
    screen: 'Documentos',
    label: 'Ver los documentos y su matriz',
    detail: 'Qué entregables tiene el equipo y cuál es condición necesaria de cuál.',
  },
  {
    code: 'documentos.gestionar',
    scope: 'global',
    screen: 'Documentos',
    label: 'Editar el catálogo de documentos y la matriz',
    detail:
      'Alta y baja de entregables, y las cruces de la matriz. Cambia cómo se planifican todos los ' +
      'proyectos, no sólo uno.',
    sensitive: true,
  },
  {
    code: 'documentos.asignar',
    scope: 'project',
    screen: 'Documentos',
    label: 'Decir qué documento entrega una tarea',
    detail: 'Lo que conecta la matriz con un plan concreto. Se hace tarea a tarea, en su ficha.',
  },

  // --- Reparto --------------------------------------------------------------
  {
    code: 'reparto.ver',
    scope: 'project',
    screen: 'Reparto',
    label: 'Ver las propuestas de reparto',
    detail: 'Qué trabajo se podría mover y a quién. No cambia nada por sí solo.',
  },
  {
    code: 'reparto.aplicar',
    scope: 'project',
    screen: 'Reparto',
    label: 'Aplicar una propuesta de reparto',
    detail: 'Mover de verdad una asignación de una persona a otra.',
  },

  // --- Informes -------------------------------------------------------------
  {
    code: 'informes.ver',
    scope: 'project',
    screen: 'Informes',
    label: 'Ver informes',
    detail:
      'El resumen y el detalle de uno o varios proyectos en el periodo que elijas. Sólo sale lo que ' +
      'ya puedes ver: sin «ver la carga» el informe llega sin el reparto por persona, y sin «ver ' +
      'costes» llega sin importes.',
  },

  // --- Los reales -----------------------------------------------------------
  {
    code: 'reales.ver',
    scope: 'project',
    screen: 'Informes',
    label: 'Ver las horas reales',
    detail:
      'Las horas que se han fichado de verdad, frente a las planificadas. Es el dato que dice si el ' +
      'plan se parece a lo que está pasando, y también quién ha trabajado en qué: sin este permiso ' +
      'el informe sale sólo con lo planificado.',
    // No protege una ruta: filtra lo que devuelve el informe. Sin él la lista
    // de horas no llega —no llega a cero— y la respuesta lo dice.
    enforcedIn: ['GET /api/report'],
  },
  {
    code: 'reales.registrar',
    scope: 'global',
    screen: 'Datos',
    label: 'Importar horas reales',
    detail:
      'Cargar el parte de horas. Es global y no por proyecto porque un fichero de horas trae todos ' +
      'los proyectos a la vez, y quien lo carga tiene que poder escribir en todos.',
  },

  // --- Comparar y ejecuciones ----------------------------------------------
  {
    code: 'ejecuciones.ver',
    scope: 'global',
    screen: 'Comparar',
    label: 'Ver el historial de cálculos y comparar',
    detail: 'La lista de ejecuciones, las líneas base y el diff entre dos planes.',
  },
  {
    code: 'calcular',
    scope: 'global',
    screen: 'Comparar',
    label: 'Recalcular el plan',
    detail: 'Lanzar un cálculo a mano. Los cambios de datos ya recalculan solos.',
  },
  {
    code: 'nivelar',
    scope: 'global',
    screen: 'Comparar',
    label: 'Nivelar',
    detail: 'Retrasar tareas hasta que el plan quepa. Crea una ejecución nueva; no toca el plan.',
    // Es el mismo endpoint que recalcular, con una bandera en el cuerpo.
    enforcedIn: ['POST /api/calculate'],
  },
  {
    code: 'lineabase.crear',
    scope: 'global',
    screen: 'Comparar',
    label: 'Congelar una línea base',
    detail: 'Poner nombre a una foto del plan para poder comparar contra ella más adelante.',
  },
  {
    code: 'historial.ver',
    scope: 'global',
    screen: 'Comparar',
    label: 'Ver el registro de cambios',
    detail: 'Quién cambió qué y cuándo, con su comentario.',
  },

  // --- Datos ----------------------------------------------------------------
  {
    code: 'importar',
    scope: 'global',
    screen: 'Datos',
    label: 'Importar un plan desde CSV',
    detail: 'Cargar proyectos enteros de golpe. Crea personas que no existan.',
  },
  {
    code: 'exportar',
    scope: 'global',
    screen: 'Datos',
    label: 'Exportar a CSV',
    detail: 'Descargar la carga. Si no se pueden ver costes, el fichero sale sin la columna de coste.',
  },
  {
    code: 'plantillas.usar',
    scope: 'global',
    screen: 'Datos',
    label: 'Crear un proyecto desde una plantilla',
    detail: 'Copiar un molde completo en un proyecto nuevo.',
  },
  {
    code: 'plantillas.gestionar',
    scope: 'global',
    screen: 'Datos',
    label: 'Crear y gestionar plantillas',
    detail: 'Guardar un proyecto como plantilla, duplicarlo o convertirlo en molde.',
    // Copiar a un proyecto pide `plantillas.usar`; copiar a un molde, esto.
    enforcedIn: ['POST /api/projects/:projectId/duplicate', 'PATCH /api/projects/:projectId'],
  },

  // --- Administración -------------------------------------------------------
  {
    code: 'copia.exportar',
    scope: 'global',
    screen: 'Administración',
    label: 'Sacar una copia de seguridad',
    detail:
      'Descargar la base entera en un zip de CSV. Lleva TODO: el equipo con sus ' +
      'tarifas, las horas fichadas y los correos de las cuentas. Las contraseñas no.',
    enforcedIn: ['GET /api/copia'],
  },
  {
    code: 'copia.restaurar',
    scope: 'global',
    screen: 'Administración',
    label: 'Restaurar una copia de seguridad',
    detail:
      'Sustituir la base entera por la de un zip. BORRA todo lo que haya. Es la ' +
      'función más destructiva de la herramienta y no la trae ningún rol de serie.',
    enforcedIn: ['POST /api/copia/comprobar', 'POST /api/copia/restaurar'],
  },
  {
    code: 'usuarios.gestionar',
    scope: 'global',
    screen: 'Administración',
    label: 'Gestionar usuarios',
    detail: 'Altas, bajas, contraseñas y a qué roles pertenece cada uno.',
    sensitive: true,
  },
  {
    code: 'roles.gestionar',
    scope: 'global',
    screen: 'Administración',
    label: 'Editar la hoja de roles',
    detail: 'Decidir qué puede hacer cada rol. Quien tiene esto puede darse cualquier otro permiso.',
    sensitive: true,
  },
]

/** Índice por código, para comprobar en O(1) y para detectar duplicados al cargar. */
export const PERMISSION_BY_CODE: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map((permission) => [permission.code, permission]),
)

/**
 * Rutas que no piden permiso, con su razón. Es una lista corta y cerrada a
 * propósito: si crece sin discusión, el sistema de permisos deja de significar
 * nada. La prueba que recorre las rutas la usa como única excepción.
 */
export const PUBLIC_ROUTES: ReadonlyMap<string, string> = new Map([
  ['/api/health', 'Sonda de vida: la usa el contenedor para saber si arrancar el resto.'],
  ['/api/auth/login', 'Para entrar hay que poder llamar a la puerta.'],
  ['/api/auth/logout', 'Salir nunca puede requerir permisos.'],
  ['/api/auth/me', 'Dice quién eres y qué puedes hacer; sin sesión responde que nadie.'],
])

/**
 * Rutas que piden **sesión pero no permiso**: cosas que uno hace sobre su
 * propia cuenta y que ningún rol debería poder quitarle.
 *
 * Es la tercera categoría, y hace falta que exista. Meterlas en
 * `PUBLIC_ROUTES` las dejaría sin sesión —cambiar la contraseña de nadie—, y
 * ponerles un permiso del catálogo permitiría que un rol se lo quitara a
 * alguien, que es como dejar a una persona encerrada con una contraseña que
 * no puede cambiar.
 *
 * Igual de corta y de cerrada que la otra, y auditada igual.
 */
export const SESSION_ONLY_ROUTES: ReadonlyMap<string, string> = new Map([
  ['/api/auth/clave', 'Cambiar la propia contraseña: pide la actual, y ningún rol puede impedirlo.'],
])
