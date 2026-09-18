import { describe, expect, it } from 'vitest'
import {
  aCsv,
  columnasQueFaltan,
  convierte,
  detectaDelimitador,
  encuentraCabecera,
  parseCsv,
} from './gantt-a-plan.mjs'

/**
 * Todas las filas de este fichero son **inventadas**. El libro del equipo lleva
 * proyectos y personas reales y no entra en el repositorio; lo que se prueba
 * aquí es la conversión, y para eso vale una hoja de mentira con la misma forma.
 */

/** El preámbulo de doce filas que la hoja real trae antes de la cabecera. */
const PREAMBULO = [
  ['Título del libro', '', '', '', '', '', '', '', '', '', ''],
  ['Input Column', '', 'Method', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
]

const CABECERA = [
  'id', 'Project', 'Type', 'Description', 'Mission', 'Role', 'Team\nMember',
  'd.\nid', 'd.\nconn', 'd.\nlag', 'Work\ndays', 'Start',
]

const fila = (id, proyecto, tipo, desc, mision, quien, depId, conn, lag, dias, inicio) =>
  [String(id), proyecto, tipo, desc, mision, '', quien, depId, conn, lag, dias, inicio]

/** Un proyecto pequeño con la forma del libro: proyecto, hito, fase y cadena. */
const HOJA = [
  ...PREAMBULO,
  CABECERA,
  fila(1, 'ALFA', 'Pr', 'PROJECT', '', '', '', '', '', '250', '2026-03-02 00:00:00'),
  fila(2, 'ALFA', 'M', '(MSt) Arranque', 'S', 'T. Ruiz', '', '', '', '0', '2026-03-02 00:00:00'),
  fila(3, 'ALFA', 'S', 'Fase de oferta', '', '', '', '', '', '14', ''),
  fila(4, 'ALFA', 'T', '(S) Safety-Bid', 'C', 'A. Müller', '2', 'FS', '0', '6,25', ''),
  fila(5, 'ALFA', 'T', '(S) Safety-Bid', 'R1', 'T. Ruiz', '4', 'FS', '0', '1,25', ''),
]

const convierteHoja = (filas, opciones) => convierte(filas, opciones)

describe('leer la hoja', () => {
  it('encuentra la cabecera aunque venga precedida de un preámbulo', () => {
    const encontrada = encuentraCabecera(HOJA)
    expect(encontrada?.fila).toBe(3)
    expect(encontrada?.donde.descripcion).toBe(3)
    expect(encontrada?.donde.dias).toBe(10)
  })

  it('las cabeceras con salto de línea dentro se encuentran igual', () => {
    // El libro escribe «Work\ndays» y «d.\nid» en una sola celda.
    expect(encuentraCabecera(HOJA)?.donde.depId).toBe(7)
  })

  it('sin cabecera lo dice, en vez de devolver una conversión vacía', () => {
    expect(convierteHoja([['a', 'b'], ['1', '2']]).error).toContain('cabecera')
  })

  it('una cabecera a la que le falta lo imprescindible se rechaza', () => {
    expect(columnasQueFaltan({ id: 0, proyecto: 1 })).toEqual(['tipo', 'descripcion', 'dias'])
  })

  it('el delimitador se detecta: punto y coma, coma o tabulador', () => {
    expect(detectaDelimitador('a;b;c\n1;2;3')).toBe(';')
    expect(detectaDelimitador('a,b,c\n1,2,3')).toBe(',')
    expect(detectaDelimitador('a\tb\tc')).toBe('\t')
  })

  it('las comillas de Excel se leen como Excel las escribe', () => {
    expect(parseCsv('a;"b;c";d\n1;"con ""comillas""";3', ';')).toEqual([
      ['a', 'b;c', 'd'],
      ['1', 'con "comillas"', '3'],
    ])
  })
})

describe('convertir', () => {
  it('el caso normal sale con su fase, su cadena y sus horas repartidas', () => {
    const { filas, cuentas } = convierteHoja(HOJA)
    expect(cuentas.tareas).toBe(2)
    expect(cuentas.hitos).toBe(1)
    expect(cuentas.fases).toBe(2)
    expect(filas.map((f) => [f.tarea, f.fase, f.dias, f.predecesoras])).toEqual([
      ['(MSt) Arranque · S', '', '0', ''],
      ['(S) Safety-Bid · C', 'Fase de oferta', '6,25', '(MSt) Arranque · S'],
      ['(S) Safety-Bid · R1', 'Fase de oferta', '1,25', '(S) Safety-Bid · C'],
    ])
  })

  it('la fila de proyecto no es una tarea: da el nombre y desaparece', () => {
    const { filas } = convierteHoja(HOJA)
    expect(filas.every((f) => f.tarea !== 'PROJECT')).toBe(true)
    expect(filas[0]?.nombre_proyecto).toBe('ALFA')
    // Y sólo en la primera fila: repetirlo en las 1.686 sería ruido.
    expect(filas.slice(1).every((f) => f.nombre_proyecto === '')).toBe(true)
  })

  it('la fase es la última «S» de arriba, dentro del proyecto', () => {
    const conDosFases = [
      ...HOJA,
      fila(6, 'ALFA', 'S', 'Fase de ejecución', '', '', '', '', '', '30', ''),
      fila(7, 'ALFA', 'T', '(S) SaRS', 'C', 'A. Müller', '5', 'FS', '0', '10', ''),
    ]
    const { filas } = convierteHoja(conDosFases)
    expect(filas.at(-1)?.fase).toBe('Fase de ejecución')
  })

  it('las canceladas no se convierten, y se cuentan', () => {
    const conCancelada = [...HOJA, fila(6, 'ALFA', 'T', '(S) SaRS', 'Canc.', '', '', '', '', '10', '')]
    const { filas, cuentas } = convierteHoja(conCancelada)
    expect(cuentas.canceladas).toBe(1)
    expect(filas).toHaveLength(3)
  })

  it('una predecesora que apunta a una cancelada no se escribe, y se dice', () => {
    const roto = [
      ...PREAMBULO,
      CABECERA,
      fila(1, 'ALFA', 'T', 'Muerta', 'Canc.', '', '', '', '', '5', ''),
      fila(2, 'ALFA', 'T', 'Viva', 'C', 'A. Müller', '1', 'FS', '0', '5', ''),
    ]
    const { filas, cuentas } = convierteHoja(roto)
    expect(filas[0]?.predecesoras).toBe('')
    expect(cuentas.enlacesSueltos).toBe(1)
  })

  it('los enlaces SS y FF se descartan, y se cuentan uno a uno', () => {
    // Convertirlos a fin-comienzo haría esperar a algo que iba en paralelo.
    const conSs = [
      ...PREAMBULO,
      CABECERA,
      fila(1, 'ALFA', 'T', 'Una', 'C', 'A. Müller', '', '', '', '5', '2026-03-02 00:00:00'),
      fila(2, 'ALFA', 'T', 'Otra', 'C', 'A. Müller', '1', 'SS', '0', '5', ''),
      fila(3, 'ALFA', 'T', 'Tercera', 'C', 'A. Müller', '1', 'FF', '0', '5', ''),
    ]
    const { filas, cuentas } = convierteHoja(conSs)
    expect(cuentas.ssDescartados).toBe(1)
    expect(cuentas.ffDescartados).toBe(1)
    expect(filas.every((f) => f.predecesoras === '')).toBe(true)
  })

  it('un desfase se pierde y se dice: el CSV no tiene columna de lag', () => {
    const conLag = [
      ...PREAMBULO,
      CABECERA,
      fila(1, 'ALFA', 'T', 'Una', 'C', 'A. Müller', '', '', '', '5', ''),
      fila(2, 'ALFA', 'T', 'Otra', 'C', 'A. Müller', '1', 'FS', '5', '5', ''),
    ]
    expect(convierteHoja(conLag).cuentas.desfasesPerdidos).toBe(1)
  })

  it('los días se redondean a dos decimales', () => {
    // El libro los calcula dividiendo, así que salen con quince decimales.
    const feo = [...PREAMBULO, CABECERA, fila(1, 'ALFA', 'T', 'Una', 'C', '', '', '', '', '7.142857142857143', '')]
    expect(convierteHoja(feo).filas[0]?.dias).toBe('7,14')
  })

  it('una tarea con cero días avisa: al importar se vuelve un hito', () => {
    const cero = [...PREAMBULO, CABECERA, fila(1, 'ALFA', 'T', 'Una', 'C', '', '', '', '', '0', '')]
    expect(convierteHoja(cero).cuentas.ceroDias).toBe(1)
    // Un hito de verdad no cuenta: ése SÍ es un hito.
    const hito = [...PREAMBULO, CABECERA, fila(1, 'ALFA', 'M', 'Una', '', '', '', '', '', '0', '')]
    expect(convierteHoja(hito).cuentas.ceroDias).toBe(0)
  })
})

describe('los nombres, que es lo que hace que las predecesoras cuadren', () => {
  const repetida = (id, inicio) =>
    fila(id, 'ALFA', 'T', '(S) Safety Management', 'S', 'A. Müller', '', '', '', '10', inicio)

  it('sin choque, el nombre se queda en descripción y subactividad', () => {
    expect(convierteHoja(HOJA).filas[1]?.tarea).toBe('(S) Safety-Bid · C')
  })

  it('con choque, desempata el mes de inicio', () => {
    const hoja = [
      ...PREAMBULO, CABECERA,
      repetida(1, '2024-06-01 00:00:00'),
      repetida(2, '2025-01-01 00:00:00'),
    ]
    expect(convierteHoja(hoja).filas.map((f) => f.tarea)).toEqual([
      '(S) Safety Management · S · 2024-06',
      '(S) Safety Management · S · 2025-01',
    ])
  })

  it('si ni con el mes basta, entra un contador', () => {
    const hoja = [
      ...PREAMBULO, CABECERA,
      repetida(1, '2024-06-01 00:00:00'),
      repetida(2, '2024-06-15 00:00:00'),
      repetida(3, ''),
      repetida(4, ''),
    ]
    expect(convierteHoja(hoja).filas.map((f) => f.tarea)).toEqual([
      '(S) Safety Management · S · 2024-06',
      '(S) Safety Management · S · 2024-06 (2)',
      '(S) Safety Management · S',
      '(S) Safety Management · S (2)',
    ])
  })

  it('dos tareas del mismo proyecto nunca se llaman igual', () => {
    const hoja = [...PREAMBULO, CABECERA, ...[1, 2, 3, 4, 5].map((i) => repetida(i, ''))]
    const nombres = convierteHoja(hoja).filas.map((f) => f.tarea)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('el mismo nombre en dos proyectos distintos NO choca', () => {
    const hoja = [
      ...PREAMBULO, CABECERA,
      fila(1, 'ALFA', 'T', 'Una', 'C', '', '', '', '', '5', ''),
      fila(2, 'BETA', 'T', 'Una', 'C', '', '', '', '', '5', ''),
    ]
    expect(convierteHoja(hoja).filas.map((f) => f.tarea)).toEqual(['Una · C', 'Una · C'])
  })

  it('la predecesora usa el MISMO nombre generado que la fila a la que apunta', () => {
    // Es lo único que hace que el enlace cuadre cuando el nombre se desempata.
    const hoja = [
      ...PREAMBULO, CABECERA,
      repetida(1, '2024-06-01 00:00:00'),
      repetida(2, '2025-01-01 00:00:00'),
      fila(3, 'ALFA', 'T', 'Depende', 'C', '', '2', 'FS', '0', '5', ''),
    ]
    const { filas } = convierteHoja(hoja)
    expect(filas.at(-1)?.predecesoras).toBe('(S) Safety Management · S · 2025-01')
  })
})

describe('las fechas', () => {
  it('sólo se ancla lo que no tiene predecesora', () => {
    const { filas, cuentas } = convierteHoja(HOJA)
    expect(filas[0]?.no_antes_de).toBe('2026-03-02')
    expect(filas[1]?.no_antes_de).toBe('')
    expect(filas[2]?.no_antes_de).toBe('')
    expect(cuentas.anclas).toBe(1)
  })

  it('sin fecha en el libro no se inventa ninguna', () => {
    const sinFecha = [...PREAMBULO, CABECERA, fila(1, 'ALFA', 'T', 'Una', 'C', '', '', '', '', '5', '')]
    expect(convierteHoja(sinFecha).filas[0]?.no_antes_de).toBe('')
    expect(convierteHoja(sinFecha).cuentas.anclas).toBe(0)
  })
})

describe('el filtro por proyecto', () => {
  it('deja pasar sólo los que contienen el texto, sin mirar mayúsculas', () => {
    const dos = [
      ...PREAMBULO, CABECERA,
      fila(1, 'ALFA', 'T', 'Una', 'C', '', '', '', '', '5', ''),
      fila(2, 'BETA', 'T', 'Otra', 'C', '', '', '', '', '5', ''),
    ]
    const { filas, cuentas } = convierteHoja(dos, { filtro: 'alf' })
    expect(filas.map((f) => f.proyecto)).toEqual(['ALFA'])
    expect(cuentas.proyectos).toBe(1)
  })
})

describe('el CSV que sale', () => {
  it('lleva las once columnas del contrato, en su orden', () => {
    const csv = aCsv(convierteHoja(HOJA).filas)
    expect(csv.split('\n')[0]).toBe(
      'proyecto;nombre_proyecto;fase;tarea;dias;predecesoras;recurso;dedicacion;disciplina;deadline;no_antes_de',
    )
  })

  it('entrecomilla lo que lleva punto y coma, y escapa las comillas', () => {
    const csv = aCsv([{ proyecto: 'A;B', tarea: 'con "esto"' }])
    expect(csv).toContain('"A;B"')
    expect(csv).toContain('"con ""esto"""')
  })

  it('el mismo Gantt da siempre el mismo CSV', () => {
    expect(aCsv(convierteHoja(HOJA).filas)).toBe(aCsv(convierteHoja(HOJA).filas))
  })
})
