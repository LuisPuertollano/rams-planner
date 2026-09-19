import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchProjectGates, fetchStructure, type DependencyRow, type Project, type ProjectGate, type TaskRow } from '../api.js'
import { fullDate, hours, monthLabel } from '../format.js'
import { useT, type Traductor } from '../i18n/index.js'

interface Props {
  readonly tasks: readonly TaskRow[]
  readonly projects: readonly Project[]
}

const DIA_MS = 86_400_000
/** Alto de una fila y de su línea: el mismo número lo usan el CSS y las flechas. */
const ALTO = 31
const ANCHO_ETIQUETA = 260
/** A partir de aquí el cronograma arranca plegado por proyecto. */
const MUCHAS_FILAS = 200

/**
 * Cuántos píxeles ocupa un día en cada nivel de acercamiento.
 *
 * Es lo único que cambia al acercar: todo lo demás se calcula a partir de aquí,
 * así que no hay dos sistemas de coordenadas que puedan separarse.
 */
const PX_POR_DIA = { dia: 22, semana: 6, mes: 2.2 } as const
type Zoom = keyof typeof PX_POR_DIA

/** El día de un instante, a medianoche UTC. Las barras van en días, no en horas. */
const aDia = (iso: string): number => Math.floor(Date.parse(iso) / DIA_MS)

interface Fila {
  readonly task: TaskRow
  readonly projectId: string
  readonly indent: number
}

/**
 * El cronograma.
 *
 * Los componentes comerciales traen su propio modelo de datos y su propio
 * motor, y eso reintroduce justo la mezcla entre lo declarado y lo derivado que
 * el sistema prohíbe. Aquí las barras son sólo una proyección de `task_result`.
 *
 * ## Lo que cambió, y por qué
 *
 * La primera versión metía la cartera entera en el 100 % del ancho. Con tres
 * años de plan, cada tarea era una raya de dos píxeles y el cronograma sólo
 * servía para decir «hay trabajo»: ni se leía una fecha, ni se veía qué espera
 * a qué, ni dónde caen las puertas.
 *
 * Ahora la escala es **píxeles por día** y se desplaza, que es lo que hace el
 * libro del equipo con sus 408 columnas diarias. Y encima van las cuatro cosas
 * que convierten un dibujo en una herramienta de decidir:
 *
 *   - **las flechas**: qué espera a qué. Un plan sin cadena no es un plan.
 *   - **las puertas**: en un proyecto RAMS son la fecha que manda.
 *   - **la holgura**: hasta dónde se puede retrasar algo sin romper nada.
 *   - **el avance**: cuánto lleva hecho la barra que estás mirando.
 */
export function GanttView({ tasks, projects }: Props): React.JSX.Element {
  const { t, locale } = useT()
  const [zoom, setZoom] = useState<Zoom>('semana')
  const [soloCritico, setSoloCritico] = useState(false)
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set())
  const arrancado = useRef(false)
  const [dependencias, setDependencias] = useState<readonly DependencyRow[]>([])
  const [puertas, setPuertas] = useState<ReadonlyMap<string, readonly ProjectGate[]>>(new Map())
  const scroll = useRef<HTMLDivElement>(null)
  const yaCentrado = useRef(false)

  useEffect(() => {
    fetchStructure()
      .then((estructura) => { setDependencias(estructura.dependencies) })
      .catch(() => { setDependencias([]) })
  }, [])

  useEffect(() => {
    // Las puertas son por proyecto y cada una es una petición. Se piden todas a
    // la vez y las que fallen —por permisos— se quedan fuera sin romper nada:
    // un cronograma sin puertas sigue siendo un cronograma.
    Promise.all(
      projects.map(async (proyecto) =>
        [proyecto.id, await fetchProjectGates(proyecto.id).catch(() => [])] as const,
      ),
    )
      .then((pares) => { setPuertas(new Map(pares)) })
      .catch(() => { setPuertas(new Map()) })
  }, [projects])

  const colocadas = useMemo(
    () => tasks.filter((task) => task.scheduledStart !== null && task.scheduledFinish !== null),
    [tasks],
  )

  /**
   * Una cartera grande arranca plegada.
   *
   * Sin esto, la cartera real —36 proyectos, 6 222 tareas— pintaba 6 256 filas
   * y 4 760 flechas de golpe y tardaba cinco segundos en aparecer. Y además no
   * servía de nada: nadie mira seis mil barras a la vez, se abre el proyecto
   * que interesa. El corte no es un número mágico, es el punto a partir del
   * cual la lista ya no se recorre con el ojo.
   */
  useEffect(() => {
    if (arrancado.current || colocadas.length === 0) return
    arrancado.current = true
    if (colocadas.length > MUCHAS_FILAS) {
      setPlegados(new Set(projects.map((proyecto) => proyecto.id)))
    }
  }, [colocadas, projects])

  const limites = useMemo(() => {
    if (colocadas.length === 0) return null
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const task of colocadas) {
      min = Math.min(min, aDia(task.scheduledStart ?? ''))
      // El fin tardío puede caer después del fin programado: es la holgura, y
      // si no entra en los límites se dibujaría fuera del lienzo.
      max = Math.max(max, aDia(task.lateFinish ?? task.scheduledFinish ?? ''))
    }
    // Las puertas también mandan en el ancho: una puerta que cae después del
    // último trabajo es exactamente la que hay que ver.
    for (const lista of puertas.values()) {
      for (const puerta of lista) max = Math.max(max, aDia(`${puerta.date}T00:00:00Z`))
    }
    return { min: min - 2, max: max + 2 }
  }, [colocadas, puertas])

  const px = PX_POR_DIA[zoom]
  const x = (dia: number): number => (dia - (limites?.min ?? 0)) * px
  const anchoTotal = limites === null ? 0 : (limites.max - limites.min) * px

  /** Las filas en el orden en que se pintan. Es también el orden de las `y`. */
  const filas = useMemo((): readonly Fila[] => {
    const salida: Fila[] = []
    for (const proyecto of projects) {
      const suyas = colocadas.filter((task) => task.projectId === proyecto.id)
      if (suyas.length === 0) continue
      salida.push({ task: CABECERA, projectId: proyecto.id, indent: 0 })
      if (plegados.has(proyecto.id)) continue
      for (const task of suyas) {
        const contenedor = task.kind === 'phase' || task.kind === 'work_package'
        if (soloCritico && task.isCritical !== true && !contenedor) continue
        salida.push({ task, projectId: proyecto.id, indent: contenedor ? 1 : 2 })
      }
    }
    return salida
  }, [projects, colocadas, plegados, soloCritico])

  /**
   * De cuándo a cuándo va cada proyecto.
   *
   * Es lo que enseña la fila del proyecto cuando está plegado. Sin esto,
   * plegar la cartera dejaba treinta y seis renglones vacíos: se veía que hay
   * treinta y seis proyectos y nada más, que es menos de lo que dice la lista
   * de proyectos. Con la barra puesta, plegado se ve lo que de verdad importa
   * de una cartera — quién empieza cuándo y quién se solapa con quién.
   */
  const tramos = useMemo(() => {
    const mapa = new Map<string, { desde: number; hasta: number }>()
    for (const task of colocadas) {
      const inicio = aDia(task.scheduledStart ?? '')
      const fin = aDia(task.scheduledFinish ?? '')
      const actual = mapa.get(task.projectId)
      if (actual === undefined) mapa.set(task.projectId, { desde: inicio, hasta: fin })
      else {
        actual.desde = Math.min(actual.desde, inicio)
        actual.hasta = Math.max(actual.hasta, fin)
      }
    }
    return mapa
  }, [colocadas])

  /**
   * De qué fila a qué fila va cada proyecto.
   *
   * Es lo que permite dibujar sus puertas cruzando SUS tareas y sólo las suyas.
   * Una línea de lado a lado pondría la puerta de un proyecto encima de las
   * tareas del de al lado, que es el error que más confunde de un cronograma
   * de cartera.
   */
  const bloques = useMemo(() => {
    const mapa = new Map<string, { desde: number; hasta: number }>()
    filas.forEach((fila, indice) => {
      const actual = mapa.get(fila.projectId)
      if (actual === undefined) mapa.set(fila.projectId, { desde: indice, hasta: indice + 1 })
      else actual.hasta = indice + 1
    })
    return mapa
  }, [filas])

  const yDe = useMemo(() => {
    const mapa = new Map<string, number>()
    filas.forEach((fila, indice) => {
      if (fila.task !== CABECERA) mapa.set(fila.task.nodeId, indice * ALTO + ALTO / 2)
    })
    return mapa
  }, [filas])

  // Centrar en hoy la primera vez que hay algo que enseñar. Sólo la primera:
  // volver a centrar en cada cambio de zoom le quitaría el sitio a quien ya se
  // había desplazado a mirar otra cosa.
  useEffect(() => {
    if (yaCentrado.current || limites === null || scroll.current === null) return
    const hoy = Math.floor(Date.now() / DIA_MS)
    if (hoy < limites.min || hoy > limites.max) return
    scroll.current.scrollLeft = Math.max(0, x(hoy) - scroll.current.clientWidth / 2)
    yaCentrado.current = true
  }, [limites, zoom])

  if (limites === null) {
    return <div className="empty"><h3>{t('cronograma.vacio')}</h3></div>
  }

  const hoy = Math.floor(Date.now() / DIA_MS)
  const hoyVisible = hoy >= limites.min && hoy <= limites.max

  return (
    <div>
      <div className="toolbar">
        <span className="faint">{t('cronograma.escala')}</span>
        {(Object.keys(PX_POR_DIA) as readonly Zoom[]).map((nivel) => (
          <button
            key={nivel}
            className={zoom === nivel ? 'button button--primary' : 'button'}
            onClick={() => { setZoom(nivel) }}
          >
            {t(`cronograma.zoom.${nivel}` as 'cronograma.zoom.dia')}
          </button>
        ))}
        <label className="faint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={soloCritico}
            onChange={(e) => { setSoloCritico(e.target.checked) }}
          />
          {t('cronograma.soloCritico')}
        </label>
        <button
          className="button"
          onClick={() => {
            setPlegados((antes) => (antes.size === 0 ? new Set(projects.map((p) => p.id)) : new Set()))
          }}
        >
          {plegados.size === 0 ? t('cronograma.plegarTodo') : t('cronograma.desplegarTodo')}
        </button>
        <span className="faint">{t('cronograma.cuantas', filas.length, colocadas.length)}</span>
      </div>

      <div className="gantt__scroll" ref={scroll}>
        <div className="gantt" style={{ width: ANCHO_ETIQUETA + anchoTotal }}>
          <Cabecera limites={limites} px={px} zoom={zoom} />

          <div style={{ position: 'relative' }}>
            {/* Hoy, y las puertas de cada proyecto. Van debajo de las barras a
                propósito: son referencias, no datos. */}
            {!hoyVisible ? null : (
              <div className="gantt__hoy" style={{ left: ANCHO_ETIQUETA + x(hoy) }} title={t('cronograma.hoy')} />
            )}

            {filas.map((fila, indice) =>
              fila.task === CABECERA ? (
                <FilaProyecto
                  key={`p-${fila.projectId}`}
                  proyecto={projects.find((p) => p.id === fila.projectId)}
                  tramo={tramos.get(fila.projectId)}
                  x={x}
                  t={t}
                  plegado={plegados.has(fila.projectId)}
                  onPlegar={() => {
                    setPlegados((antes) => {
                      const siguiente = new Set(antes)
                      if (siguiente.has(fila.projectId)) siguiente.delete(fila.projectId)
                      else siguiente.add(fila.projectId)
                      return siguiente
                    })
                  }}
                />
              ) : (
                <FilaTarea key={fila.task.nodeId} fila={fila} x={x} indice={indice} t={t} locale={locale} />
              ),
            )}

            {/* Las puertas de cada proyecto, cruzando sus filas y sólo las suyas. */}
            <Puertas puertas={puertas} bloques={bloques} x={x} t={t} />

            {/* Las flechas, encima de todo y sin interceptar el ratón. */}
            <Flechas dependencias={dependencias} yDe={yDe} colocadas={colocadas} x={x} />
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 16px' }} className="legend">
        <span><span className="legend__swatch" style={{ background: 'var(--accent)' }} />{t('cronograma.leyenda.tarea')}</span>
        <span><span className="legend__swatch" style={{ background: 'var(--severity-error)' }} />{t('cronograma.leyenda.critico')}</span>
        <span><span className="legend__swatch" style={{ background: 'var(--text-faint)', height: 6 }} />{t('cronograma.leyenda.contenedor')}</span>
        <span><span className="legend__swatch gantt__muestra-holgura" />{t('cronograma.leyenda.holgura')}</span>
        <span><span className="legend__swatch gantt__muestra-puerta" />{t('cronograma.leyenda.puerta')}</span>
      </div>
    </div>
  )
}

/**
 * La fila de un proyecto se marca con esta tarea falsa en vez de con un campo
 * aparte: así la lista de filas es una sola lista y el índice de cada una es su
 * `y`, que es lo que necesitan las flechas.
 */
const CABECERA = { nodeId: '__cabecera__' } as unknown as TaskRow

function Cabecera({
  limites,
  px,
  zoom,
}: {
  readonly limites: { min: number; max: number }
  readonly px: number
  readonly zoom: Zoom
}): React.JSX.Element {
  const meses: { label: string; left: number; ancho: number }[] = []
  const cursor = new Date(limites.min * DIA_MS)
  cursor.setUTCDate(1)
  while (cursor.getTime() / DIA_MS <= limites.max) {
    const inicio = Math.max(Math.floor(cursor.getTime() / DIA_MS), limites.min)
    const siguiente = new Date(cursor)
    siguiente.setUTCMonth(siguiente.getUTCMonth() + 1)
    const fin = Math.min(Math.floor(siguiente.getTime() / DIA_MS), limites.max)
    if (fin > inicio) {
      meses.push({
        label: monthLabel(
          `${String(cursor.getUTCFullYear())}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
        ),
        left: (inicio - limites.min) * px,
        ancho: (fin - inicio) * px,
      })
    }
    cursor.setTime(siguiente.getTime())
  }

  // La segunda banda sólo aparece cuando cabe: con 2,2 px por día, un número
  // por día sería una mancha gris.
  const dias: { label: string; left: number }[] = []
  if (zoom === 'dia') {
    for (let dia = limites.min; dia <= limites.max; dia += 1) {
      const fecha = new Date(dia * DIA_MS)
      dias.push({ label: String(fecha.getUTCDate()), left: (dia - limites.min) * px })
    }
  }

  return (
    <div className="gantt__head">
      <div className="gantt__label gantt__label--fijo" />
      <div style={{ position: 'relative', height: zoom === 'dia' ? 40 : 28 }}>
        {meses.map((mes) => (
          <div
            key={`${mes.label}-${String(mes.left)}`}
            className="gantt__month"
            style={{ position: 'absolute', left: mes.left, width: mes.ancho, top: 0 }}
          >
            {mes.ancho > 40 ? mes.label : ''}
          </div>
        ))}
        {dias.map((dia) => (
          <div key={dia.left} className="gantt__dia" style={{ left: dia.left, width: px }}>
            {dia.label}
          </div>
        ))}
      </div>
    </div>
  )
}

function FilaProyecto({
  proyecto,
  tramo,
  x,
  t,
  plegado,
  onPlegar,
}: {
  readonly proyecto: Project | undefined
  readonly tramo: { desde: number; hasta: number } | undefined
  readonly x: (dia: number) => number
  readonly t: Traductor['t']
  readonly plegado: boolean
  readonly onPlegar: () => void
}): React.JSX.Element {
  const izquierda = tramo === undefined ? 0 : x(tramo.desde)
  const ancho = tramo === undefined ? 0 : Math.max(x(tramo.hasta + 1) - izquierda, 2)
  return (
    <div className="gantt__row gantt__row--proyecto">
      <div className="gantt__label gantt__label--fijo">
        <button className="disclosure" onClick={onPlegar} aria-expanded={!plegado}>
          {plegado ? '▸' : '▾'}
        </button>
        <b>{proyecto?.code ?? ''}</b>
      </div>
      <div className="gantt__track">
        {tramo === undefined ? null : (
          <span
            className="gantt__bar gantt__bar--proyecto"
            style={{ left: izquierda, width: ancho }}
            title={t(
              'cronograma.tramoProyecto',
              proyecto?.name ?? '',
              fullDate(new Date(tramo.desde * DIA_MS).toISOString()),
              fullDate(new Date(tramo.hasta * DIA_MS).toISOString()),
            )}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Las puertas de certificación, cada una cruzando las filas de su proyecto.
 *
 * En un proyecto RAMS la puerta es la fecha que manda, y lo que hace falta ver
 * no es dónde cae la puerta sino **qué tareas la cruzan**: una barra que pasa
 * por encima de la línea de la CGR es un entregable que llega tarde a su
 * certificación, y eso en una lista de fechas no se ve.
 */
function Puertas({
  puertas,
  bloques,
  x,
  t,
}: {
  readonly puertas: ReadonlyMap<string, readonly ProjectGate[]>
  readonly bloques: ReadonlyMap<string, { desde: number; hasta: number }>
  readonly x: (dia: number) => number
  readonly t: Traductor['t']
}): React.JSX.Element {
  return (
    <>
      {[...puertas.entries()].flatMap(([projectId, lista]) => {
        const bloque = bloques.get(projectId)
        if (bloque === undefined) return []
        return lista.map((puerta) => (
          <div
            key={`${projectId}-${puerta.gate}`}
            className="gantt__puerta"
            style={{
              left: ANCHO_ETIQUETA + x(Math.floor(Date.parse(`${puerta.date}T00:00:00Z`) / DIA_MS)),
              top: bloque.desde * ALTO,
              height: (bloque.hasta - bloque.desde) * ALTO,
            }}
            title={t('cronograma.puertaTitulo', puerta.gate, fullDate(puerta.date))}
          >
            <span className="gantt__puerta-nombre">{puerta.gate}</span>
          </div>
        ))
      })}
    </>
  )
}

function FilaTarea({
  fila,
  x,
  indice,
  t,
  locale,
}: {
  readonly fila: Fila
  readonly x: (dia: number) => number
  readonly indice: number
  readonly t: Traductor['t']
  readonly locale: string
}): React.JSX.Element {
  const { task } = fila
  const inicio = aDia(task.scheduledStart ?? '')
  const fin = aDia(task.scheduledFinish ?? '')
  const tardio = task.lateFinish === null ? fin : aDia(task.lateFinish)
  const contenedor = task.kind === 'phase' || task.kind === 'work_package'
  const izquierda = x(inicio)
  // Mínimo un día de ancho: una tarea de cuatro horas existe y tiene que verse.
  const ancho = Math.max(x(fin + 1) - izquierda, x(inicio + 1) - izquierda)
  const holgura = Math.max(x(tardio + 1) - x(fin + 1), 0)
  const avance = task.percentCompleteBp / 10_000

  const titulo = [
    task.name,
    `${fullDate(task.scheduledStart)} → ${fullDate(task.scheduledFinish)}`,
    task.workMinutes === null ? '' : t('cronograma.tituloTrabajo', hours(task.workMinutes, 0, locale)),
    holgura === 0 ? '' : t('cronograma.tituloHolgura', fullDate(task.lateFinish)),
  ].filter((linea) => linea !== '').join('\n')

  return (
    <div className="gantt__row" data-fila={indice}>
      <div className="gantt__label gantt__label--fijo" style={{ paddingLeft: 12 + fila.indent * 14 }} title={task.name}>
        {task.name}
      </div>
      <div className="gantt__track">
        {task.kind === 'milestone' ? (
          <span
            className="gantt__milestone"
            style={{ left: izquierda - 7 }}
            title={`${task.name} · ${fullDate(task.scheduledStart)}`}
          />
        ) : (
          <>
            {holgura === 0 ? null : (
              <span className="gantt__holgura" style={{ left: izquierda + ancho, width: holgura }} />
            )}
            <span
              className={[
                'gantt__bar',
                contenedor ? 'gantt__bar--container' : '',
                task.isCritical === true && !contenedor ? 'gantt__bar--critical' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: izquierda, width: ancho }}
              title={titulo}
            >
              {contenedor || avance === 0 ? null : (
                <span className="gantt__avance" style={{ width: `${String(avance * 100)}%` }} />
              )}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Las flechas de las dependencias.
 *
 * Son lo que convierte un montón de barras en un plan: sin ellas no se puede
 * contestar «¿por qué esto empieza en junio?», que es la pregunta por la que
 * alguien abre un cronograma.
 *
 * Se dibujan con codos y no con curvas porque un codo dice por dónde pasa: con
 * veinte flechas cruzándose, una curva no se sigue con el ojo.
 */
function Flechas({
  dependencias,
  yDe,
  colocadas,
  x,
}: {
  readonly dependencias: readonly DependencyRow[]
  readonly yDe: ReadonlyMap<string, number>
  readonly colocadas: readonly TaskRow[]
  readonly x: (dia: number) => number
}): React.JSX.Element | null {
  const porNodo = useMemo(() => new Map(colocadas.map((task) => [task.nodeId, task])), [colocadas])

  const caminos = dependencias.flatMap((enlace) => {
    const desde = porNodo.get(enlace.predecessorNodeId)
    const hasta = porNodo.get(enlace.successorNodeId)
    const y1 = yDe.get(enlace.predecessorNodeId)
    const y2 = yDe.get(enlace.successorNodeId)
    // Una dependencia cuyos dos extremos no están a la vista —porque el
    // proyecto está plegado o el filtro se la llevó— no se dibuja: una flecha
    // que sale de la nada confunde más que la falta de la flecha.
    if (desde === undefined || hasta === undefined || y1 === undefined || y2 === undefined) return []

    const finPred = x(aDia(desde.scheduledFinish ?? '') + 1)
    const iniPred = x(aDia(desde.scheduledStart ?? ''))
    const iniSuc = x(aDia(hasta.scheduledStart ?? ''))
    const finSuc = x(aDia(hasta.scheduledFinish ?? '') + 1)

    // De dónde sale y a dónde llega, según el tipo de enlace: una FF no ata el
    // principio del sucesor, ata su final, y la flecha tiene que decirlo.
    const x1 = enlace.kind === 'SS' || enlace.kind === 'SF' ? iniPred : finPred
    const x2 = enlace.kind === 'FF' || enlace.kind === 'SF' ? finSuc : iniSuc
    const salida = enlace.kind === 'SS' || enlace.kind === 'SF' ? -1 : 1
    const entrada = enlace.kind === 'FF' || enlace.kind === 'SF' ? 1 : -1

    const codo1 = x1 + salida * 8
    const codo2 = x2 + entrada * 8
    const medio = (y1 + y2) / 2
    return [{
      id: enlace.id,
      d: `M ${String(x1)} ${String(y1)} H ${String(codo1)} V ${String(medio)} H ${String(codo2)} V ${String(y2)} H ${String(x2)}`,
      punta: `${String(x2)},${String(y2)} ${String(x2 - entrada * 6)},${String(y2 - 4)} ${String(x2 - entrada * 6)},${String(y2 + 4)}`,
      critica: hasta.isCritical === true && desde.isCritical === true,
    }]
  })

  if (caminos.length === 0) return null
  return (
    <svg className="gantt__flechas" style={{ left: ANCHO_ETIQUETA }}>
      {caminos.map((camino) => (
        <g key={camino.id} className={camino.critica ? 'gantt__flecha--critica' : ''}>
          <path d={camino.d} />
          <polygon points={camino.punta} />
        </g>
      ))}
    </svg>
  )
}
