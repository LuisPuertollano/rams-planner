/**
 * El Gantt del libro del equipo, convertido al CSV de plan del planner.
 *
 *     node tools/gantt-a-plan.mjs gantt.csv > plan.csv
 *     node tools/gantt-a-plan.mjs gantt.csv --proyecto "Línea 4" > plan.csv
 *
 * ## Qué come y por qué eso
 *
 * Come la hoja `Gantt` **exportada a CSV desde Excel** («Guardar como → CSV»),
 * no el `.xlsm`. Dos razones y las dos pesan:
 *
 *   - El libro tiene datos del equipo y de proyectos reales y **no entra en el
 *     repositorio jamás**. Esta herramienta es código; el fichero se queda en la
 *     máquina de quien lo convierte.
 *   - Leer `.xlsm` pediría una dependencia nueva para un conversor que se usa de
 *     uvas a peras. El planner habla CSV de punta a punta; esto también.
 *
 * Las columnas se buscan **por su nombre de cabecera**, no por su posición: la
 * hoja tiene el encabezado en la fila 13, columnas ocultas y un preámbulo, y
 * contar columnas a mano se rompe el día que alguien inserta una.
 *
 * ## Lo que se pierde por el camino, dicho en voz alta
 *
 * El CSV de plan del planner expresa menos cosas que el Gantt, así que convertir
 * pierde. Lo que se pierde **se cuenta al final, por stderr**, en vez de
 * disimularlo:
 *
 *   - **Los enlaces SS y FF.** El CSV sólo sabe decir «esta tarea espera a esta
 *     otra», que es fin-comienzo. Un SS convertido a FS no es una traducción:
 *     es hacer esperar a algo que iba en paralelo, y alarga el plan importado
 *     sin que nadie lo haya pedido. Así que **se descartan** y se dicen: quitar
 *     una restricción se ve y se corrige; inventarse una, no.
 *   - **Los desfases.** El CSV no tiene columna de `lag`.
 *   - **Las horas.** El CSV lleva duración en días, no esfuerzo. Las horas del
 *     Gantt se quedan fuera; el planner las deriva de la duración.
 *
 * ## El nombre de cada tarea, que es lo que decide si esto funciona
 *
 * El CSV cita las predecesoras **por nombre**, así que dos tareas de un mismo
 * proyecto no pueden llamarse igual. Y en el Gantt un documento aparece varias
 * veces —una por subactividad—, y algunas actividades se repiten de verdad:
 * «(S) Safety Management · S» sale una vez por año.
 *
 * Así que el nombre se construye en tres escalones, y sólo se baja al siguiente
 * cuando el anterior choca dentro del proyecto:
 *
 *     1. «(S) Safety-CbC · C»                    descripción y subactividad
 *     2. «(S) Safety Management · S · 2024-06»   + el mes de inicio
 *     3. «(S) Design Review · C (3)»             + un contador
 *
 * Medido sobre el libro real: 1.176 nombres se quedan en el escalón 1, 254 bajan
 * al 2 y 256 al 3. **Cero choques.** Y como la predecesora se resuelve por el
 * `d.id` de la fila y no por su texto, las dos puntas usan el mismo nombre
 * generado y el enlace siempre cuadra.
 */

import { readFileSync } from 'node:fs'

/** Las columnas del Gantt que hacen falta, por el nombre de su cabecera. */
const COLUMNAS = {
  id: 'id',
  proyecto: 'Project',
  tipo: 'Type',
  descripcion: 'Description',
  mision: 'Mission',
  quien: 'Team\nMember',
  depId: 'd.\nid',
  conexion: 'd.\nconn',
  desfase: 'd.\nlag',
  dias: 'Work\ndays',
  inicio: 'Start',
}

/** Las columnas del CSV de plan, en el orden del contrato de la importación. */
const SALIDA = [
  'proyecto', 'nombre_proyecto', 'fase', 'tarea', 'dias',
  'predecesoras', 'recurso', 'dedicacion', 'disciplina', 'deadline', 'no_antes_de',
]

const limpia = (valor) => String(valor ?? '').replace(/\s+/g, ' ').trim()

/**
 * Los días, con dos decimales y coma.
 *
 * El libro los calcula dividiendo horas entre capacidad diaria, así que salen
 * cosas como `7,142857142857143`. Dos decimales son 1,2 minutos de precisión en
 * una jornada de ocho horas: más que de sobra para una duración, y la diferencia
 * entre un CSV que se lee y uno que no.
 */
function redondea(valor) {
  const numero = Number(String(valor).replace(',', '.'))
  if (!Number.isFinite(numero)) return '0'
  return String(Math.round(numero * 100) / 100).replace('.', ',')
}

/** La fecha en AAAA-MM-DD, o vacío si la celda no trae una. */
function fechaIso(valor) {
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(valor ?? ''))?.[1] ?? ''
}

/** Un CSV con comillas, sin dependencias. Excel exporta así. */
export function parseCsv(texto, delimitador) {
  const filas = []
  let fila = []
  let celda = ''
  let enComillas = false
  const cierraFila = () => {
    fila.push(celda)
    filas.push(fila)
    fila = []
    celda = ''
  }
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"'
        i += 1
      } else if (c === '"') enComillas = false
      else celda += c
      continue
    }
    if (c === '"') enComillas = true
    else if (c === delimitador) {
      fila.push(celda)
      celda = ''
    } else if (c === '\n') cierraFila()
    else if (c !== '\r') celda += c
  }
  if (celda !== '' || fila.length > 0) cierraFila()
  return filas
}

export function detectaDelimitador(texto) {
  const linea = texto.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const cuenta = (c) => linea.split(c).length - 1
  if (cuenta('\t') > cuenta(';') && cuenta('\t') > cuenta(',')) return '\t'
  return cuenta(';') >= cuenta(',') ? ';' : ','
}

/**
 * Encuentra la fila de cabecera y dónde cae cada columna.
 *
 * La hoja trae un preámbulo de doce filas con parámetros del motor del libro,
 * así que la cabecera se busca: es la primera fila que tiene a la vez
 * «Description» y «Mission». Los saltos de línea dentro de una cabecera —el
 * libro escribe «Work\ndays»— se normalizan a un espacio antes de comparar.
 */
export function encuentraCabecera(filas) {
  const quiere = Object.fromEntries(
    Object.entries(COLUMNAS).map(([clave, nombre]) => [clave, limpia(nombre).toLowerCase()]),
  )
  for (const [indice, fila] of filas.entries()) {
    const celdas = fila.map((c) => limpia(c).toLowerCase())
    if (!celdas.includes(quiere.descripcion) || !celdas.includes(quiere.mision)) continue
    const donde = {}
    for (const [clave, nombre] of Object.entries(quiere)) {
      const columna = celdas.indexOf(nombre)
      if (columna !== -1) donde[clave] = columna
    }
    return { fila: indice, donde }
  }
  return null
}

/** Lo que falta para poder convertir. Vacío si está todo. */
export function columnasQueFaltan(donde) {
  const imprescindibles = ['id', 'proyecto', 'tipo', 'descripcion', 'dias']
  return imprescindibles.filter((clave) => donde[clave] === undefined)
}

/**
 * Convierte las filas del Gantt en filas del CSV de plan.
 *
 * `filtro` deja pasar sólo los proyectos cuyo nombre lo contenga, sin
 * distinguir mayúsculas. Sin filtro entran los 36 del libro de golpe, que rara
 * vez es lo que se quiere.
 */
export function convierte(filas, { filtro = null } = {}) {
  const cabecera = encuentraCabecera(filas)
  if (cabecera === null) {
    return { error: 'No se encuentra la cabecera: ninguna fila tiene «Description» y «Mission».' }
  }
  const faltan = columnasQueFaltan(cabecera.donde)
  if (faltan.length > 0) {
    return { error: `Faltan columnas imprescindibles en la cabecera: ${faltan.join(', ')}` }
  }

  const { donde } = cabecera
  const dato = (fila, clave) =>
    donde[clave] === undefined ? '' : limpia(fila[donde[clave]])

  const crudas = []
  for (const fila of filas.slice(cabecera.fila + 1)) {
    const id = dato(fila, 'id')
    if (id === '' || !/^\d+$/.test(id)) continue
    crudas.push({
      id: Number(id),
      proyecto: dato(fila, 'proyecto'),
      tipo: dato(fila, 'tipo'),
      descripcion: dato(fila, 'descripcion'),
      mision: dato(fila, 'mision'),
      quien: dato(fila, 'quien'),
      depId: dato(fila, 'depId'),
      conexion: dato(fila, 'conexion'),
      desfase: dato(fila, 'desfase'),
      dias: dato(fila, 'dias'),
      inicio: dato(fila, 'inicio'),
    })
  }

  const cuentas = {
    leidas: crudas.length,
    canceladas: 0,
    proyectos: 0,
    fases: 0,
    tareas: 0,
    hitos: 0,
    enlaces: 0,
    enlacesSueltos: 0,
    ssDescartados: 0,
    ffDescartados: 0,
    desfasesPerdidos: 0,
    ceroDias: 0,
    anclas: 0,
  }

  // La fase de una fila es la última de tipo «S» que haya por encima dentro del
  // mismo proyecto. Comprobado contra el libro real: 4.616 filas coinciden con
  // su `s id` y ninguna discrepa.
  const faseDe = new Map()
  const ultimaFase = new Map()
  for (const fila of crudas) {
    if (fila.tipo === 'S') ultimaFase.set(fila.proyecto, fila.descripcion)
    else if (fila.tipo === 'Pr') ultimaFase.set(fila.proyecto, '')
    faseDe.set(fila.id, ultimaFase.get(fila.proyecto) ?? '')
  }

  const pasa = (fila) =>
    filtro === null || fila.proyecto.toLowerCase().includes(filtro.toLowerCase())

  const vivas = crudas.filter((fila) => {
    if (!pasa(fila)) return false
    if (fila.mision === 'Canc.') {
      cuentas.canceladas += 1
      return false
    }
    return fila.tipo === 'T' || fila.tipo === 'M'
  })

  // --- los nombres, en los tres escalones -----------------------------------
  const base = (fila) =>
    fila.mision === '' ? fila.descripcion : `${fila.descripcion} · ${fila.mision}`
  const cuantasVeces = new Map()
  for (const fila of vivas) {
    const clave = `${fila.proyecto}\u0000${base(fila)}`
    cuantasVeces.set(clave, (cuantasVeces.get(clave) ?? 0) + 1)
  }
  const usados = new Map()
  const nombreDe = new Map()
  for (const fila of vivas) {
    let nombre = base(fila)
    if ((cuantasVeces.get(`${fila.proyecto}\u0000${nombre}`) ?? 0) > 1) {
      const mes = /^\d{4}-\d{2}/.exec(fila.inicio)?.[0]
      if (mes !== undefined) nombre = `${nombre} · ${mes}`
    }
    const clave = `${fila.proyecto}\u0000${nombre}`
    const veces = (usados.get(clave) ?? 0) + 1
    usados.set(clave, veces)
    nombreDe.set(fila.id, veces === 1 ? nombre : `${nombre} (${String(veces)})`)
  }

  const nombreDelProyecto = new Map()
  for (const fila of crudas) {
    if (pasa(fila) && !nombreDelProyecto.has(fila.proyecto)) {
      nombreDelProyecto.set(fila.proyecto, fila.proyecto)
    }
  }
  cuentas.proyectos = nombreDelProyecto.size
  cuentas.fases = new Set(vivas.map((fila) => `${fila.proyecto}\u0000${faseDe.get(fila.id)}`)).size

  const salida = []
  const yaPuesto = new Set()
  for (const fila of vivas) {
    // Una predecesora sólo cuenta si es fin-comienzo Y la fila a la que apunta
    // sigue viva: apuntar a una cancelada es apuntar a nada.
    let predecesora = ''
    if (fila.depId !== '' && /^\d+$/.test(fila.depId)) {
      const destino = nombreDe.get(Number(fila.depId))
      if (fila.conexion === 'SS') cuentas.ssDescartados += 1
      else if (fila.conexion === 'FF') cuentas.ffDescartados += 1
      else if (destino === undefined) cuentas.enlacesSueltos += 1
      else {
        predecesora = destino
        cuentas.enlaces += 1
        if (fila.desfase !== '' && fila.desfase !== '0') cuentas.desfasesPerdidos += 1
      }
    }

    const dias = fila.tipo === 'M' ? '0' : redondea(fila.dias)
    // Un 0 convierte la tarea en hito al importar. Si la fila NO era un hito en
    // el libro, eso es un cambio de significado y hay que decirlo.
    if (fila.tipo !== 'M' && Number(dias.replace(',', '.')) === 0) cuentas.ceroDias += 1
    if (fila.tipo === 'M') cuentas.hitos += 1
    else cuentas.tareas += 1

    if (predecesora === '' && fechaIso(fila.inicio) !== '') cuentas.anclas += 1
    const primeraDelProyecto = !yaPuesto.has(fila.proyecto)
    yaPuesto.add(fila.proyecto)

    salida.push({
      proyecto: fila.proyecto,
      nombre_proyecto: primeraDelProyecto ? (nombreDelProyecto.get(fila.proyecto) ?? '') : '',
      fase: faseDe.get(fila.id) ?? '',
      tarea: nombreDe.get(fila.id) ?? '',
      dias,
      predecesoras: predecesora,
      recurso: fila.quien,
      dedicacion: '',
      // La subactividad es la etiqueta que mejor agrupa: «C», «R1», «S».
      disciplina: fila.mision,
      deadline: '',
      // Sólo se ancla lo que NO tiene predecesora. Es la diferencia entre
      // importar un plan y importar una foto: las cabezas de cadena traen la
      // fecha del libro, y de ahí en adelante manda el motor. Anclar cada tarea
      // a su fecha del Gantt dejaría las dependencias de adorno y convertiría
      // el plan en una lista de fechas que no reaccionan a nada.
      //
      // Y hace falta además por un motivo prosaico: el importador saca la fecha
      // de arranque del proyecto de la MENOR `no_antes_de` del fichero. Sin
      // ninguna, todo proyecto importado empieza hoy.
      no_antes_de: predecesora === '' ? fechaIso(fila.inicio) : '',
    })
  }

  return { filas: salida, cuentas }
}

const comilla = (valor) => (/[;"\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor)

export function aCsv(filas) {
  const lineas = [SALIDA.join(';')]
  for (const fila of filas) lineas.push(SALIDA.map((c) => comilla(fila[c] ?? '')).join(';'))
  return `${lineas.join('\n')}\n`
}

/** El parte de lo convertido y de lo perdido, que es la mitad del trabajo. */
export function informe(c) {
  const lineas = [
    `Leídas ${String(c.leidas)} filas del Gantt.`,
    `  ${String(c.proyectos)} proyecto(s), ${String(c.fases)} fase(s), ` +
      `${String(c.tareas)} tarea(s) y ${String(c.hitos)} hito(s).`,
    `  ${String(c.canceladas)} fila(s) canceladas, fuera.`,
    `  ${String(c.enlaces)} dependencia(s) fin-comienzo.`,
    `  ${String(c.anclas)} tarea(s) sin predecesora ancladas a su fecha de inicio del libro; ` +
      'el resto las coloca el motor.',
  ]
  const perdido = []
  if (c.ssDescartados > 0) {
    perdido.push(
      `  ${String(c.ssDescartados)} enlace(s) SS descartados: el CSV de plan sólo sabe ` +
        'decir fin-comienzo, y convertirlos alargaría el plan sin que nadie lo pida.',
    )
  }
  if (c.ffDescartados > 0) perdido.push(`  ${String(c.ffDescartados)} enlace(s) FF descartados, por lo mismo.`)
  if (c.enlacesSueltos > 0) {
    perdido.push(
      `  ${String(c.enlacesSueltos)} enlace(s) apuntaban a una fila cancelada o filtrada: no se escriben.`,
    )
  }
  if (c.desfasesPerdidos > 0) {
    perdido.push(`  ${String(c.desfasesPerdidos)} desfase(s) perdidos: el CSV no tiene columna de lag.`)
  }
  if (c.ceroDias > 0) {
    perdido.push(
      `  ⚠ ${String(c.ceroDias)} tarea(s) con cero días: al importar se convierten en HITOS. ` +
        'Si no lo son, ponles duración antes de importar.',
    )
  }
  if (perdido.length > 0) lineas.push('Lo que se pierde por el camino:', ...perdido)
  return lineas.join('\n')
}

// ---------------------------------------------------------------------------

function principal(argv) {
  const ruta = argv.find((a) => !a.startsWith('--'))
  if (ruta === undefined) {
    process.stderr.write(
      'Uso: node tools/gantt-a-plan.mjs <gantt.csv> [--proyecto "parte del nombre"]\n\n' +
        'Exporta la hoja «Gantt» del libro a CSV desde Excel y pásala por aquí.\n' +
        'El CSV de plan sale por la salida estándar; el parte, por la de errores.\n',
    )
    return 2
  }
  const i = argv.indexOf('--proyecto')
  const filtro = i === -1 ? null : (argv[i + 1] ?? null)

  const texto = readFileSync(ruta, 'utf8')
  const resultado = convierte(parseCsv(texto, detectaDelimitador(texto)), { filtro })
  if (resultado.error !== undefined) {
    process.stderr.write(`${resultado.error}\n`)
    return 1
  }
  if (resultado.filas.length === 0) {
    process.stderr.write(
      `${informe(resultado.cuentas)}\n\nNo queda ninguna fila que escribir.\n`,
    )
    return 1
  }
  process.stdout.write(aCsv(resultado.filas))
  process.stderr.write(`${informe(resultado.cuentas)}\n`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = principal(process.argv.slice(2))
}
