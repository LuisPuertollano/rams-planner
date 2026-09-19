/**
 * Qué fichero espera cada importación, dicho una sola vez.
 *
 * El problema que resuelve, en las palabras de quien lo encontró: «el CSV puede
 * tener mil formas y no sé lo que esperas». Tenía razón, y de tres maneras: el
 * botón de la plantilla no decía que fuera la respuesta a esa pregunta, la
 * plantilla no explicaba ninguna columna, y en el parte de horas el enlace sólo
 * aparecía **después** de importar.
 *
 * Así que el contrato vive aquí, y de aquí salen las dos cosas que lo cuentan:
 *
 *   - La **plantilla descargable**, con el manual de las columnas dentro del
 *     propio fichero como comentarios y las filas de ejemplo comentadas, para
 *     que no entren por descuido.
 *   - La **tabla de la pantalla**, que la interfaz pide a la API en vez de
 *     llevar su propia copia. Una copia se queda vieja el día que alguien
 *     añade una columna al parser; esto no puede.
 *
 * El orden de las columnas aquí es el orden de la plantilla y el de la tabla.
 */

import { toCsv } from './csv.js'

export interface ImportColumn {
  readonly nombre: string
  /** Sin ella el fichero se rechaza. Las demás pueden faltar o venir vacías. */
  readonly obligatoria: boolean
  /** Qué es, en una frase que quepa en una celda de tabla. */
  readonly que: string
  /** Un valor de verdad, no un `<texto>`: se copia y funciona. */
  readonly ejemplo: string
}

export interface ImportSpec {
  /** El identificador de la importación en las rutas: plan, actuals, documents. */
  readonly tipo: string
  readonly titulo: string
  /** Qué hace esta importación, en una frase. */
  readonly resumen: string
  /** Las tres o cuatro cosas que hay que saber antes de rellenar el fichero. */
  readonly reglas: readonly string[]
  readonly columnas: readonly ImportColumn[]
  /** Filas completas de ejemplo, en el mismo orden que las columnas. */
  readonly ejemplos: readonly (readonly string[])[]
}

// ---------------------------------------------------------------------------

export const PLAN_SPEC: ImportSpec = {
  tipo: 'plan',
  titulo: 'Un plan entero desde una tabla',
  resumen:
    'Una fila por tarea. Crea los proyectos, las fases, las tareas, los enlaces entre ellas y las ' +
    'asignaciones, y después recalcula.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'Un proyecto que ya existe NO se sobrescribe: la importación entera se rechaza y lo dice.',
    'Las personas que no existan se crean, con jornada estándar y sin tarifa. Revísalas después.',
    'Un «sí» en «plantilla» crea el proyecto como molde: no se calcula y NO lleva personas, así que sus asignaciones se quedan fuera y se avisa.',
    '«entregable» enlaza la tarea con el catálogo por su código. Es lo que hace que la tarea se pueda partir en subactividades y reciba la fecha objetivo de su puerta.',
    'Cualquier error deja el fichero fuera entero. No hay importaciones a medias.',
    'Varias personas en una tarea, separadas por barra o punto y coma: «Ana Müller;Marc Iglesias».',
  ],
  columnas: [
    { nombre: 'proyecto', obligatoria: true, que: 'Código del proyecto. Se repite en todas sus filas.', ejemplo: 'CBTC-L3' },
    { nombre: 'nombre_proyecto', obligatoria: false, que: 'Nombre largo del proyecto. Basta ponerlo en una fila.', ejemplo: 'CBTC Línea 3' },
    { nombre: 'fase', obligatoria: false, que: 'Agrupa tareas. Vacío deja la tarea colgando del proyecto.', ejemplo: 'Análisis' },
    { nombre: 'tarea', obligatoria: true, que: 'Nombre de la tarea. Es lo que citan las predecesoras.', ejemplo: 'Hazard Log' },
    { nombre: 'dias', obligatoria: true, que: 'Duración en días laborables. Un 0 la convierte en hito.', ejemplo: '10' },
    { nombre: 'predecesoras', obligatoria: false, que: 'Tareas que tienen que terminar antes, por su nombre.', ejemplo: 'Plan RAMS' },
    { nombre: 'recurso', obligatoria: false, que: 'Quién la hace. Varias personas, separadas por ; o |.', ejemplo: 'Ana Müller' },
    { nombre: 'dedicacion', obligatoria: false, que: 'Porcentaje de jornada. Sin nada, 100.', ejemplo: '50' },
    { nombre: 'disciplina', obligatoria: false, que: 'Etiqueta RAMS para agrupar y filtrar.', ejemplo: 'Hazard Log' },
    { nombre: 'deadline', obligatoria: false, que: 'Fecha límite comprometida, AAAA-MM-DD.', ejemplo: '2026-05-29' },
    { nombre: 'no_antes_de', obligatoria: false, que: 'No puede empezar antes de esta fecha, AAAA-MM-DD.', ejemplo: '2026-03-02' },
    { nombre: 'entregable', obligatoria: false, que: 'Código del entregable que produce esta tarea, del catálogo.', ejemplo: 'S-FMECA' },
    { nombre: 'plantilla', obligatoria: false, que: 'Un «sí» crea el proyecto como PLANTILLA: molde, sin personas ni cálculo.', ejemplo: 'sí' },
  ],
  ejemplos: [
    ['CBTC-L3', 'CBTC Línea 3', 'Análisis', 'Plan RAMS', '5', '', 'Ana Müller', '100', 'Plan', '', '2026-03-02', 'S-SAP', ''],
    ['CBTC-L3', '', 'Análisis', 'Hazard Log', '10', 'Plan RAMS', 'Ana Müller;Marc Iglesias', '50', 'Hazard Log', '2026-05-29', '', 'S-HAZLOG', ''],
    ['CBTC-L3', '', 'Análisis', 'Revisión de concepto', '0', 'Hazard Log', '', '', '', '', '', '', ''],
    ['MOLDE-RAMS', 'Proyecto RAMS (molde)', 'Análisis', 'Plan RAMS', '5', '', '', '', 'Plan', '', '', 'S-SAP', 'sí'],
  ],
}

export const ACTUALS_SPEC: ImportSpec = {
  tipo: 'actuals',
  titulo: 'El parte de horas',
  resumen:
    'Una fila por persona, tarea y día. Cruza lo que se fichó de verdad con lo planificado, en el ' +
    'informe. NO recalcula el plan: lo que ya pasó no cambia cuándo puede pasar el resto.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'Nada se crea: el proyecto, la tarea y la persona tienen que existir ya. Un parte de horas no da de alta a nadie.',
    'Volver a cargar el mismo fichero CORRIGE las horas de esos días; no las duplica.',
    'Dos apuntes del mismo día en la misma tarea se suman: son dos ratos de trabajo.',
    'Más de 24 h en una sola fila se rechaza: casi siempre son minutos puestos en la columna de horas.',
  ],
  columnas: [
    { nombre: 'proyecto', obligatoria: true, que: 'Código del proyecto, tal y como está en la herramienta.', ejemplo: 'CBTC-L3' },
    { nombre: 'tarea', obligatoria: true, que: 'Nombre exacto de la tarea dentro de ese proyecto.', ejemplo: 'Hazard Log' },
    { nombre: 'persona', obligatoria: true, que: 'Nombre o código de quien fichó. Tiene que estar en el equipo.', ejemplo: 'Ana Müller' },
    { nombre: 'fecha', obligatoria: true, que: 'El día trabajado, AAAA-MM-DD.', ejemplo: '2026-03-02' },
    { nombre: 'horas', obligatoria: true, que: 'Horas de ese día en esa tarea. Coma o punto decimal.', ejemplo: '7,5' },
    { nombre: 'origen', obligatoria: false, que: 'parte, importado, manual o estimado. Sin nada, parte.', ejemplo: 'parte' },
    { nombre: 'referencia', obligatoria: false, que: 'El identificador del sistema de origen, para rastrear la fila.', ejemplo: 'TS-1024' },
  ],
  ejemplos: [
    ['CBTC-L3', 'Plan RAMS', 'Ana Müller', '2026-03-02', '7,5', 'parte', 'TS-1024'],
    ['CBTC-L3', 'Hazard Log', 'Marc Iglesias', '2026-03-02', '4', '', ''],
    ['CBTC-L3', 'Hazard Log', 'Marc Iglesias', '2026-03-02', '2', '', ''],
  ],
}

export const MONTHLY_SPEC: ImportSpec = {
  tipo: 'monthly',
  titulo: 'Las horas del mes, como las da el fichaje',
  resumen:
    'Una fila por persona, proyecto y mes. Es lo que SAP CATS —o cualquier otro— sabe de verdad: ' +
    'la tarea NO viene en el dato. Para que estas horas lleguen a una tarea hace falta además la ' +
    'declaración del reparto.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'Nada se crea: el proyecto y la persona tienen que existir ya.',
    'Una fila ES el total de ese mes, no un apunte: volver a cargar marzo deja marzo como diga el fichero, no el doble.',
    'Sin la declaración del reparto, estas horas no llegan a ninguna tarea: salen en la conciliación como «sin declarar».',
    'Un mes que ya tiene parte de horas diario por tarea no se reparte: contaría el trabajo dos veces, y la conciliación lo dice.',
  ],
  columnas: [
    { nombre: 'proyecto', obligatoria: true, que: 'Código del proyecto, tal y como está en la herramienta.', ejemplo: 'CBTC-L3' },
    { nombre: 'persona', obligatoria: true, que: 'Nombre o código de quien imputó. Tiene que estar en el equipo.', ejemplo: 'Ana Müller' },
    { nombre: 'mes', obligatoria: true, que: 'El mes, AAAA-MM. No lleva día porque el dato no lo trae.', ejemplo: '2026-04' },
    { nombre: 'horas', obligatoria: true, que: 'Horas de esa persona en ese proyecto y ese mes. Coma o punto decimal.', ejemplo: '38,5' },
    { nombre: 'referencia', obligatoria: false, que: 'El identificador del export de origen, para rastrear la fila.', ejemplo: 'CATS-2026-04' },
  ],
  ejemplos: [
    ['CBTC-L3', 'Ana Müller', '2026-04', '38,5', 'CATS-2026-04'],
    ['CBTC-L3', 'Marc Iglesias', '2026-04', '12', ''],
  ],
}

export const SPLITS_SPEC: ImportSpec = {
  tipo: 'splits',
  titulo: 'El reparto declarado de esas horas',
  resumen:
    'La otra mitad: «de mis horas de abril en CBTC, el 60 % fue al FMECA y el 40 % al Hazard Log». ' +
    'Es lo único que sabe en qué se fueron las horas, porque el sistema de fichaje no lo sabe.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'La declaración de un mes se REEMPLAZA entera: lo que no venga en el fichero, se borra.',
    'Los porcentajes de un mismo (persona, proyecto, mes) tienen que sumar 100.',
    'Un mes que no suma 100 se guarda igual, pero NO se reparte: el reparto es proporcional, así que una declaración del 60 % le daría a esa tarea las horas ENTERAS del mes.',
    'La tarea tiene que existir y ser tarea o hito: una fase es el resumen de sus hijas y no dice en qué se fue el trabajo.',
  ],
  columnas: [
    { nombre: 'proyecto', obligatoria: true, que: 'Código del proyecto.', ejemplo: 'CBTC-L3' },
    { nombre: 'persona', obligatoria: true, que: 'Nombre o código de quien declara.', ejemplo: 'Ana Müller' },
    { nombre: 'mes', obligatoria: true, que: 'El mes al que se refiere, AAAA-MM.', ejemplo: '2026-04' },
    { nombre: 'tarea', obligatoria: true, que: 'Nombre exacto de la tarea dentro de ese proyecto.', ejemplo: 'Análisis funcional FMECA' },
    { nombre: 'porcentaje', obligatoria: true, que: 'Qué parte de las horas de ese mes fue a esa tarea. Entre 0 y 100.', ejemplo: '60' },
    { nombre: 'nota', obligatoria: false, que: 'Por qué, cuando el reparto necesita explicación.', ejemplo: 'Dos semanas de campaña de ensayos' },
  ],
  ejemplos: [
    ['CBTC-L3', 'Ana Müller', '2026-04', 'Análisis funcional FMECA', '60', ''],
    ['CBTC-L3', 'Ana Müller', '2026-04', 'Hazard Log inicial', '40', ''],
  ],
}

export const DOCUMENTS_SPEC: ImportSpec = {
  tipo: 'documents',
  titulo: 'El catálogo de entregables y su matriz',
  resumen:
    'Una fila por entregable, hito o fase, con su ficha y con lo que tiene que estar terminado antes. ' +
    'Se declara una vez y vale para todos los proyectos.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'El código manda: una fila cuyo código ya existe ACTUALIZA ese entregable en vez de crear otro.',
    '«espera_a» es la lista COMPLETA de lo que espera esa fila: lo que no venga, se borra.',
    'El orden de las filas es el orden del ciclo de vida, y es el que se ve en la pantalla.',
    'Un ciclo (A espera a B y B espera a A) no rechaza el fichero: se avisa con la ruta entera.',
    'El ciclo de firma se declara por ROL, nunca por persona: «Ing. RAMS», no «Ana Müller».',
    'Las cinco casillas de firma son la lista COMPLETA del ciclo: lo que no venga, se borra.',
    'Las cinco casillas de la cadena (crear, revisar_1..3, soportar) son la lista COMPLETA: lo que no venga, se borra.',
    'Cada casilla de la cadena lleva sus horas —«Ing. RAMS:30»— porque partir una tarea reparte en la PROPORCIÓN del catálogo, y sin horas no hay proporción.',
    'El tercer trozo de una casilla cita la firma que descarga: «Ing. Sistemas:4:verificador_1». Así se avisa de una firma que cuesta horas y que nadie hace.',
    '«entregas_previas» es la Checkliste: el mismo documento pedido en borrador en puertas ANTERIORES. La final sigue en «puerta».',
    'El porcentaje de cada entrega previa es parte del esfuerzo del documento, no esfuerzo extra: lo que no se llevan las previas cuesta la final.',
  ],
  columnas: [
    { nombre: 'codigo', obligatoria: true, que: 'Código corto y único. Es lo que se ve en la matriz.', ejemplo: 'S-FMECA' },
    { nombre: 'nombre', obligatoria: true, que: 'Nombre completo del entregable.', ejemplo: 'FMECA' },
    { nombre: 'tipo', obligatoria: false, que: 'documento, hito o fase. Sin nada, documento.', ejemplo: 'documento' },
    { nombre: 'disciplina', obligatoria: false, que: 'Safety, RAM, ILS… Sirve para filtrar. Texto libre.', ejemplo: 'Safety' },
    { nombre: 'puerta', obligatoria: false, que: 'La puerta de certificación a la que va.', ejemplo: 'CGR' },
    { nombre: 'semanas_antes', obligatoria: false, que: 'Semanas antes de esa puerta en que debe estar listo.', ejemplo: '28' },
    { nombre: 'horas', obligatoria: false, que: 'Esfuerzo típico. Un hito también puede llevarlo.', ejemplo: '450' },
    { nombre: 'codigo_tarea', obligatoria: false, que: 'El código con el que se ficha en el sistema de horas.', ejemplo: 'PWTDF-D800' },
    { nombre: 'descripcion', obligatoria: false, que: 'Para qué es. Sale al pasar por encima del nombre.', ejemplo: 'Modos de fallo, efectos y criticidad' },
    { nombre: 'espera_a', obligatoria: false, que: 'Códigos que tienen que estar antes, separados por | o ,.', ejemplo: 'S-HAZLOG|S-SAP' },
    { nombre: 'autor', obligatoria: false, que: 'Rol que lo escribe. Un rol, no una persona.', ejemplo: 'Ing. RAMS' },
    { nombre: 'verificador_1', obligatoria: false, que: 'Rol que verifica el contenido. Distinto del autor.', ejemplo: 'Ing. Sistemas' },
    { nombre: 'verificador_2', obligatoria: false, que: 'Segunda verificación, si el procedimiento la pide.', ejemplo: 'Jefe RAMS' },
    { nombre: 'aprobador', obligatoria: false, que: 'Rol que aprueba. Sin él, el entregable no se cierra.', ejemplo: 'PrEM' },
    { nombre: 'revisores', obligatoria: false, que: 'Roles a los que se convoca, separados por | o ,.', ejemplo: 'Calidad|Compras' },
    { nombre: 'crear', obligatoria: false, que: 'Quién lo escribe y cuántas horas: «rol:horas», y «rol:horas:firma» si descarga una.', ejemplo: 'Ing. RAMS:30' },
    { nombre: 'revisar_1', obligatoria: false, que: 'Primer nivel de revisión, igual: «rol:horas».', ejemplo: 'Ing. Sistemas:4:verificador_1' },
    { nombre: 'revisar_2', obligatoria: false, que: 'Segundo nivel de revisión. Los niveles no son rondas: puede haber 2 sin 1.', ejemplo: 'Jefe RAMS:2' },
    { nombre: 'revisar_3', obligatoria: false, que: 'Tercer nivel de revisión.', ejemplo: '' },
    { nombre: 'soportar', obligatoria: false, que: 'Acompañar: reuniones, dudas, el ISA. No encadena con nadie.', ejemplo: 'Jefe RAMS:10' },
    { nombre: 'entregas_previas', obligatoria: false, que: 'Las veces que la Checkliste lo pide en borrador antes: «puerta:cómo:%:semanas», separadas por |.', ejemplo: 'PGR:preliminar:30:4' },
  ],
  ejemplos: [
    ['S-HAZLOG', 'Hazard Log preliminar', 'documento', 'Safety', 'IGR', '48', '120', 'PWTDF-D800', 'Registro de peligros de la primera vuelta', '', 'Ing. RAMS', 'Ing. Sistemas', '', 'PrEM', '', 'Ing. RAMS:16', 'Ing. Sistemas:4:verificador_1', '', '', '', ''],
    ['S-SAP', 'Safety Plan', 'documento', 'Safety', 'IGR', '50', '120', 'PWTDF-D800', '', 'S-HAZLOG', 'Ing. RAMS', 'Ing. Sistemas', 'Jefe RAMS', 'PrEM', 'Calidad|Compras', 'Ing. RAMS:14', 'Ing. Sistemas:4:verificador_1', 'Jefe RAMS:2:verificador_2', '', '', ''],
    ['S-FMECA', 'FMECA', 'documento', 'Safety', 'CGR', '28', '450', 'PWTDF-D800', 'Modos de fallo, efectos y criticidad', 'S-HAZLOG|S-SAP', 'Ing. RAMS 1', 'Ing. RAMS 2', 'Ing. Sistemas', 'PrEM', '', 'Ing. RAMS 1:60', 'Ing. RAMS 2:8:verificador_1', 'Ing. Sistemas:6:verificador_2', '', 'Jefe RAMS:10', 'PGR:preliminar:30:4'],
    ['MST-IQA', 'Puerta IQA', 'hito', '', 'IQA', '0', '16', '', 'Las 16 h son las de la propia reunión de revisión', 'S-FMECA', '', '', '', '', ''],
  ],
}

export const TEAM_SPEC: ImportSpec = {
  tipo: 'team',
  titulo: 'El equipo entero desde una tabla',
  resumen:
    'Una fila por persona: su jornada, su calendario, sus competencias y su tarifa. Da de alta a ' +
    'quien no esté y actualiza a quien ya esté.',
  reglas: [
    'Las líneas que empiezan por # son comentarios: no se importan.',
    'El código manda: una fila cuyo código ya existe ACTUALIZA a esa persona, no crea otra.',
    '«competencias» es la lista COMPLETA de esa persona: lo que no venga, se le quita.',
    'Las competencias que no existan se crean. El nivel va de 1 a 5 y es obligatorio: «FMECA:4».',
    'Las tarifas se AÑADEN, no reemplazan: una tarifa es un tramo con fechas, y borrar los anteriores reescribiría el coste de lo que ya pasó.',
    'Traer tarifas pide además el permiso de tarifas. Un fichero sin esa columna no lo necesita.',
    'Los porcentajes se escriben en porcentaje: «100» es la jornada entera, no «10000».',
    'Cualquier error deja el fichero fuera entero. No hay importaciones a medias.',
  ],
  columnas: [
    { nombre: 'codigo', obligatoria: true, que: 'Código corto y único. Es la identidad de la fila.', ejemplo: 'RAMS-01' },
    { nombre: 'nombre', obligatoria: true, que: 'Nombre con el que aparece en toda la herramienta.', ejemplo: 'Ana Müller' },
    { nombre: 'calendario', obligatoria: false, que: 'Calendario laboral, por su código o su nombre.', ejemplo: 'base_bw' },
    { nombre: 'jornada', obligatoria: false, que: 'Porcentaje de jornada. Sin nada, 100.', ejemplo: '80' },
    { nombre: 'indirecto', obligatoria: false, que: 'Lo que del día no llega a una tarea. Máximo 50 %.', ejemplo: '15' },
    { nombre: 'reserva', obligatoria: false, que: 'Lo que se guarda para lo que no ha pasado. Máximo 50 %.', ejemplo: '10' },
    { nombre: 'alta', obligatoria: false, que: 'Desde cuándo cuenta su capacidad, AAAA-MM-DD.', ejemplo: '2026-01-01' },
    { nombre: 'baja', obligatoria: false, que: 'Hasta cuándo, AAAA-MM-DD. Vacío: sigue.', ejemplo: '' },
    { nombre: 'competencias', obligatoria: false, que: 'Qué sabe hacer y a qué nivel, separadas por |.', ejemplo: 'FMECA:4|Hazard Log:3' },
    { nombre: 'tarifa', obligatoria: false, que: 'Euros por hora. Coma o punto decimal.', ejemplo: '78,50' },
    { nombre: 'tarifa_desde', obligatoria: false, que: 'Desde cuándo vale esa tarifa, AAAA-MM-DD.', ejemplo: '2026-01-01' },
    { nombre: 'tarifa_hasta', obligatoria: false, que: 'Hasta cuándo, AAAA-MM-DD. Una tarifa sin tramo no se cobra a nada.', ejemplo: '2026-12-31' },
  ],
  ejemplos: [
    ['RAMS-01', 'Ana Müller', 'base_bw', '100', '15', '10', '2026-01-01', '', 'FMECA:4|Hazard Log:3', '78,50', '2026-01-01', '2026-12-31'],
    ['RAMS-02', 'Marc Iglesias', 'base_bw', '80', '15', '10', '2026-02-01', '', 'RAM:5|FMECA:3', '82,00', '2026-01-01', '2026-12-31'],
    ['RAMS-03', 'Jan Kowalski', '', '100', '', '', '', '', 'Safety Case:4', '', '', ''],
  ],
}

export const IMPORT_SPECS: readonly ImportSpec[] = [
  PLAN_SPEC, ACTUALS_SPEC, MONTHLY_SPEC, SPLITS_SPEC, DOCUMENTS_SPEC, TEAM_SPEC,
]

// ---------------------------------------------------------------------------

const ANCHO = 76
const REGLA = `# ${'='.repeat(ANCHO - 2)}`

/**
 * Parte una frase larga en líneas que caben, con la sangría de la segunda en
 * adelante. Sin esto, el resumen y las reglas salen en una sola línea de
 * doscientos caracteres y quien abre el fichero en el bloc de notas no la lee.
 */
function envuelve(texto: string, prefijo: string, sangria: string): readonly string[] {
  const lineas: string[] = []
  let actual = prefijo
  for (const palabra of texto.split(' ')) {
    const candidata = actual.trimEnd() === (lineas.length === 0 ? prefijo : sangria).trimEnd()
      ? `${actual}${palabra}`
      : `${actual} ${palabra}`
    if (candidata.length > ANCHO && actual.trim() !== prefijo.trim()) {
      lineas.push(actual)
      actual = `${sangria}${palabra}`
    } else actual = candidata
  }
  lineas.push(actual)
  return lineas
}

/**
 * La plantilla: el manual dentro del propio fichero.
 *
 * Quien la abre en Excel ve, por este orden: qué es esto, las reglas, una tabla
 * con cada columna y qué espera, y unas filas de ejemplo **comentadas**. Para
 * usarlas, se les quita la almohadilla; para empezar de cero, se borran. En los
 * dos casos, nadie tiene que adivinar nada.
 *
 * Las filas de ejemplo van comentadas a propósito. Si fueran filas normales,
 * quien rellenara la plantilla sin fijarse se encontraría tres entregables
 * inventados dentro de su catálogo, y descubrirlo cuesta más que evitarlo.
 */
export function plantillaCsv(spec: ImportSpec): string {
  const anchoNombre = Math.max(...spec.columnas.map((c) => c.nombre.length), 8)
  const lineas: string[] = [
    REGLA,
    `#  PLANTILLA · ${spec.titulo}`,
    REGLA,
    ...envuelve(spec.resumen, '#  ', '#  '),
    '#',
    ...spec.reglas.flatMap((regla) => envuelve(regla, '#  · ', '#    ')),
    '#',
    `#  ${'COLUMNA'.padEnd(anchoNombre)}  ¿HACE FALTA?  QUÉ ES`,
    `#  ${'-'.repeat(anchoNombre)}  ------------  ${'-'.repeat(40)}`,
    ...spec.columnas.map(
      (c) => `#  ${c.nombre.padEnd(anchoNombre)}  ${(c.obligatoria ? 'Sí' : 'no').padEnd(12)}  ${c.que}`,
    ),
    '#',
    `#  Debajo de la cabecera hay ${String(spec.ejemplos.length)} fila(s) de EJEMPLO, comentadas con #.`,
    '#  Quítales la almohadilla del principio para importarlas, o bórralas y',
    '#  escribe las tuyas. Todo lo que empieza por # se ignora al importar.',
    REGLA,
  ]

  const columnas = spec.columnas.map((c) => c.nombre)
  // La cabecera, por `toCsv`, para que el separador y el BOM sean los de siempre.
  const cabeceraYFilas = toCsv(
    spec.ejemplos.map((fila) => Object.fromEntries(columnas.map((c, i) => [c, fila[i] ?? '']))),
    columnas,
  )
  const [cabecera, ...filas] = cabeceraYFilas.replace(/^\uFEFF/, '').trimEnd().split('\r\n')

  return (
    // BOM delante de todo: sin él, Excel abre el fichero en latin-1 y rompe los
    // acentos del manual que acabamos de escribir.
    '\uFEFF' +
    [...lineas, cabecera ?? columnas.join(';'), ...filas.map((fila) => `#${fila}`), ''].join('\r\n')
  )
}
