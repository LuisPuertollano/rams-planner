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
  'Reparto',
  'Comparar',
  'Datos',
  'Administración',
] as const

export type Screen = (typeof SCREENS)[number]

export interface PermissionDefinition {
  /** Código estable: es lo que se guarda en la base de datos. No se renombra. */
  readonly code: string
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
    screen: 'Carga',
    label: 'Ver la carga y la saturación',
    detail: 'Las horas comprometidas por persona, mes y proyecto, y quién se pasa de capacidad.',
  },
  {
    code: 'costes.ver',
    screen: 'Carga',
    label: 'Ver costes y tarifas',
    detail:
      'Los importes en euros, aquí y en cualquier otra pantalla. Sin este permiso la herramienta ' +
      'devuelve los datos sin importes: no se ocultan en pantalla, no se envían.',
    sensitive: true,
    // Filtra el contenido de varias respuestas, no el acceso a una ruta.
    enforcedIn: ['GET /api/runs/:runId/load', 'GET /api/runs/:runId/export.csv', 'GET /api/resources'],
  },

  // --- Plan -----------------------------------------------------------------
  {
    code: 'plan.ver',
    screen: 'Plan',
    label: 'Ver el plan y sus resultados',
    detail: 'El árbol de trabajo, las fechas calculadas, el cronograma y los hallazgos.',
  },
  {
    code: 'plan.editar',
    screen: 'Plan',
    label: 'Editar tareas',
    detail: 'Duración, avance, restricciones y fechas objetivo de una tarea que ya existe.',
  },
  {
    code: 'plan.estructura',
    screen: 'Plan',
    label: 'Crear y quitar proyectos, fases y tareas',
    detail: 'Cambiar la forma del árbol, no sólo lo que hay dentro. Incluye dar de baja una rama.',
  },
  {
    code: 'asignaciones.editar',
    screen: 'Plan',
    label: 'Asignar personas a tareas',
    detail: 'Quién trabaja en qué y con qué dedicación. De aquí nace la carga.',
  },
  {
    code: 'dependencias.editar',
    screen: 'Plan',
    label: 'Editar dependencias',
    detail: 'Qué espera a qué. Es lo que más mueve las fechas de todo el plan.',
  },
  {
    code: 'requisitos.editar',
    screen: 'Plan',
    label: 'Editar las competencias que pide una tarea',
    detail: 'El nivel mínimo que exige cada tarea, que es lo que dispara los avisos de competencia.',
  },

  // --- Equipo ---------------------------------------------------------------
  {
    code: 'equipo.ver',
    screen: 'Equipo',
    label: 'Ver el equipo y su calendario',
    detail: 'Las personas, sus calendarios, su dedicación y sus ausencias. Sin tarifas.',
  },
  {
    code: 'equipo.editar',
    screen: 'Equipo',
    label: 'Editar la ficha de una persona',
    detail: 'Alta y baja, nombre, calendario y dedicación base.',
  },
  {
    code: 'ausencias.editar',
    screen: 'Equipo',
    label: 'Editar disponibilidad y ausencias',
    detail: 'Vacaciones, bajas, formación y tramos de dedicación. Cambia la capacidad real.',
  },
  {
    code: 'tarifas.editar',
    screen: 'Equipo',
    label: 'Editar tarifas',
    detail: 'El coste por hora de cada persona. Implica poder verlas.',
    sensitive: true,
  },

  // --- Competencias ---------------------------------------------------------
  {
    code: 'competencias.ver',
    screen: 'Competencias',
    label: 'Ver la hoja de competencias',
    detail: 'Quién sabe hacer qué y dónde el equipo depende de una sola persona.',
  },
  {
    code: 'competencias.editar',
    screen: 'Competencias',
    label: 'Editar el nivel de las personas',
    detail: 'Subir o bajar el nivel de alguien en una competencia.',
    sensitive: true,
  },
  {
    code: 'competencias.catalogo',
    screen: 'Competencias',
    label: 'Gestionar el catálogo de competencias',
    detail: 'Crear y retirar competencias. Retirar una borra los niveles de todo el equipo.',
  },

  // --- Reparto --------------------------------------------------------------
  {
    code: 'reparto.ver',
    screen: 'Reparto',
    label: 'Ver las propuestas de reparto',
    detail: 'Qué trabajo se podría mover y a quién. No cambia nada por sí solo.',
  },
  {
    code: 'reparto.aplicar',
    screen: 'Reparto',
    label: 'Aplicar una propuesta de reparto',
    detail: 'Mover de verdad una asignación de una persona a otra.',
  },

  // --- Comparar y ejecuciones ----------------------------------------------
  {
    code: 'ejecuciones.ver',
    screen: 'Comparar',
    label: 'Ver el historial de cálculos y comparar',
    detail: 'La lista de ejecuciones, las líneas base y el diff entre dos planes.',
  },
  {
    code: 'calcular',
    screen: 'Comparar',
    label: 'Recalcular el plan',
    detail: 'Lanzar un cálculo a mano. Los cambios de datos ya recalculan solos.',
  },
  {
    code: 'nivelar',
    screen: 'Comparar',
    label: 'Nivelar',
    detail: 'Retrasar tareas hasta que el plan quepa. Crea una ejecución nueva; no toca el plan.',
    // Es el mismo endpoint que recalcular, con una bandera en el cuerpo.
    enforcedIn: ['POST /api/calculate'],
  },
  {
    code: 'lineabase.crear',
    screen: 'Comparar',
    label: 'Congelar una línea base',
    detail: 'Poner nombre a una foto del plan para poder comparar contra ella más adelante.',
  },
  {
    code: 'historial.ver',
    screen: 'Comparar',
    label: 'Ver el registro de cambios',
    detail: 'Quién cambió qué y cuándo, con su comentario.',
  },

  // --- Datos ----------------------------------------------------------------
  {
    code: 'importar',
    screen: 'Datos',
    label: 'Importar un plan desde CSV',
    detail: 'Cargar proyectos enteros de golpe. Crea personas que no existan.',
  },
  {
    code: 'exportar',
    screen: 'Datos',
    label: 'Exportar a CSV',
    detail: 'Descargar la carga. Si no se pueden ver costes, el fichero sale sin la columna de coste.',
  },
  {
    code: 'plantillas.usar',
    screen: 'Datos',
    label: 'Crear un proyecto desde una plantilla',
    detail: 'Copiar un molde completo en un proyecto nuevo.',
  },
  {
    code: 'plantillas.gestionar',
    screen: 'Datos',
    label: 'Crear y gestionar plantillas',
    detail: 'Guardar un proyecto como plantilla, duplicarlo o convertirlo en molde.',
    // Copiar a un proyecto pide `plantillas.usar`; copiar a un molde, esto.
    enforcedIn: ['POST /api/projects/:projectId/duplicate', 'PATCH /api/projects/:projectId'],
  },

  // --- Administración -------------------------------------------------------
  {
    code: 'usuarios.gestionar',
    screen: 'Administración',
    label: 'Gestionar usuarios',
    detail: 'Altas, bajas, contraseñas y a qué roles pertenece cada uno.',
    sensitive: true,
  },
  {
    code: 'roles.gestionar',
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
