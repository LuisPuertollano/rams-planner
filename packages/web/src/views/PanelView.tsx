import { useEffect, useMemo, useState } from 'react'
import {
  fetchReport,
  type AppState,
  type Report,
  type RunData,
} from '../api.js'
import { hours, monthLabel, percent } from '../format.js'
import { useT, type Traductor } from '../i18n/index.js'
import {
  cifrasDelPanel,
  loQueViene,
  POR_DEBAJO,
  POR_ENCIMA,
  proporcion,
  VENTANA,
  type Mes,
  type Persona,
  type Proxima,
} from '../panel-cifras.js'

interface Props {
  readonly state: AppState
  readonly data: RunData
  /** Sin este permiso ni se piden las horas fichadas: sería un 403 seguro. */
  readonly puedeVerReales: boolean
}

/** Cuántas personas caben en el gráfico antes de que deje de leerse. */
const CABEN = 16

/**
 * El panel de capacidad.
 *
 * Es el tablero que el libro «Ressource Mgmnt - TrRAMS MHG» tenía en su hoja
 * `01_Dashboard_Overview`, con sus mismas seis cifras de cabecera, sus mismos
 * umbrales —por debajo del 80 %, por encima del 100 %— y sus mismos cortes por
 * proyecto y por compromiso. Dos de sus bloques estaban ahí como marcador de
 * sitio, sin datos: «PRÓXIMAS TAREAS» y «TABLA DETALLE (para planners)». Aquí
 * salen llenos, porque el motor ya los calcula.
 *
 * Nada de lo que enseña es nuevo: es la carga, la capacidad y el plan que ya
 * están en la ejecución, puestos donde se leen de una vez.
 *
 * Sobre el color: una sola serie y un solo tono. El estado —te pasas o no— lo
 * llevan las dos líneas de referencia y la etiqueta de cada barra, no el tono,
 * porque el tono solo no distingue al que va al 78 % del que va al 82 %.
 */
export function PanelView({ state, data, puedeVerReales }: Props): React.JSX.Element {
  const { t } = useT()
  const [proyecto, setProyecto] = useState('')
  const [compromiso, setCompromiso] = useState('')
  const [informe, setInforme] = useState<Report | null>(null)

  useEffect(() => {
    if (!puedeVerReales) return
    // Lo fichado no está en la ejecución: vive en su propia tabla. Si falla,
    // el panel se queda sin esa frase y con todo lo demás.
    fetchReport([], '', '')
      .then(setInforme)
      .catch(() => { setInforme(null) })
  }, [puedeVerReales, data])

  const proyectosVisibles = useMemo(() => {
    if (compromiso === '') return new Set(state.projects.map((p) => p.id))
    return new Set(state.projects.filter((p) => p.commitment === compromiso).map((p) => p.id))
  }, [state.projects, compromiso])

  const cifras = useMemo(
    () => cifrasDelPanel(data, proyecto, proyectosVisibles),
    [data, proyecto, proyectosVisibles],
  )

  const nombreDe = useMemo(() => {
    const porId = new Map(state.resources.map((r) => [r.id, r.displayName]))
    return (id: string): string => porId.get(id) ?? id
  }, [state.resources])

  const codigoDe = useMemo(() => {
    const porId = new Map(state.projects.map((p) => [p.id, p.code]))
    return (id: string): string => porId.get(id) ?? ''
  }, [state.projects])

  const proximas = useMemo(
    () => loQueViene(data, proyecto, proyectosVisibles, new Date().toISOString().slice(0, 10)),
    [data, proyecto, proyectosVisibles],
  )

  const acotado = proyecto !== '' || compromiso !== ''

  return (
    <div className="panel-cap">
      {/* La línea de frescura: de cuándo son estos números. */}
      <p className="panel-cap__fresco">
        {t('panel.fresco.calculo', state.run === null ? '—' : fechaCorta(state.run.startedAt))}
        {informe === null || informe.actualsHidden || informe.totals.actualsThrough === null
          ? ''
          : ` · ${t('panel.fresco.reales', informe.totals.actualsThrough)}`}
        {` · ${t('panel.fresco.hallazgos', data.findings.length)}`}
      </p>

      {/* Un filtro para todo lo que hay debajo, no uno por gráfico. */}
      <div className="toolbar panel-cap__filtros">
        <label className="faint">
          {t('panel.filtro.proyecto')}{' '}
          <select
            className="input"
            value={proyecto}
            onChange={(event) => { setProyecto(event.target.value) }}
          >
            <option value="">{t('panel.filtro.todos')}</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </label>
        <label className="faint">
          {t('panel.filtro.compromiso')}{' '}
          <select
            className="input"
            value={compromiso}
            onChange={(event) => { setCompromiso(event.target.value) }}
          >
            <option value="">{t('panel.filtro.todos')}</option>
            <option value="firme">{t('proyecto.firme')}</option>
            <option value="probable">{t('proyecto.probable')}</option>
            <option value="posible">{t('proyecto.posible')}</option>
          </select>
        </label>
        {!acotado ? null : <span className="faint">{t('panel.filtro.nota')}</span>}
      </div>

      <div className="stat-row">
        <Cifra etiqueta={t('panel.kpi.capacidad')} valor={`${hours(cifras.capacidad)} h`}
          pista={t('panel.kpi.capacidad.pista')} />
        <Cifra etiqueta={t('panel.kpi.demanda')} valor={`${hours(cifras.demanda)} h`}
          pista={t('panel.kpi.demanda.pista')} />
        <Cifra etiqueta={t('panel.kpi.ocupacion')} valor={percent(cifras.ocupacionBp)}
          pista={t('panel.kpi.ocupacion.pista')} />
        <Cifra etiqueta={t('panel.kpi.hueco')} valor={`${hours(cifras.hueco)} h`}
          pista={t('panel.kpi.hueco.pista', hours(cifras.huecoPorPersona))} />
        <Cifra etiqueta={t('panel.kpi.porEncima')} valor={String(cifras.porEncima)}
          pista={t('panel.kpi.porEncima.pista')} />
        <Cifra etiqueta={t('panel.kpi.porDebajo')} valor={String(cifras.porDebajo)}
          pista={t('panel.kpi.porDebajo.pista')} />
      </div>

      <PorMes meses={cifras.meses} t={t} />
      <PorPersona gente={cifras.gente} nombreDe={nombreDe} t={t} />
      <Detalle gente={cifras.gente} nombreDe={nombreDe} codigoDe={codigoDe} t={t} />
      <Proximas filas={proximas} codigoDe={codigoDe} t={t} />

      <p className="panel-cap__leyenda faint">{t('panel.leyenda')}</p>
    </div>
  )
}

function Cifra({
  etiqueta, valor, pista,
}: { readonly etiqueta: string; readonly valor: string; readonly pista: string }): React.JSX.Element {
  return (
    <div className="stat">
      <div className="stat__label">{etiqueta}</div>
      <div className="stat__value stat__value--suelto">{valor}</div>
      <div className="stat__hint">{pista}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gráfico 1 · capacidad y demanda por mes
// ---------------------------------------------------------------------------

/**
 * Dos series del mismo tamaño —horas contra horas—, así que un solo eje.
 *
 * Nunca dos escalas: la alineación entre ellas sería arbitraria y el gráfico se
 * inventaría una relación que no está en los datos.
 */
function PorMes({ meses, t }: { readonly meses: readonly Mes[]; readonly t: Traductor['t'] }): React.JSX.Element | null {
  const [encima, setEncima] = useState<{ x: number; y: number; mes: Mes } | null>(null)
  if (meses.length === 0) return null

  const ancho = 900
  const alto = 260
  const margen = { arriba: 16, derecha: 12, abajo: 34, izquierda: 56 }
  const util = { ancho: ancho - margen.izquierda - margen.derecha, alto: alto - margen.arriba - margen.abajo }
  const techo = Math.max(...meses.flatMap((m) => [m.capacidad, m.demanda]), 1)
  const escala = (v: number): number => (v / techo) * util.alto
  const banda = util.ancho / meses.length
  const grosor = Math.min(22, (banda - 10) / 2)
  const marcas = ticks(techo)
  const pico = meses.reduce((a, b) => (b.demanda > a.demanda ? b : a), meses[0] as Mes)

  return (
    <section className="panel-cap__grafico">
      <h3>{t('panel.mes.titulo')}</h3>
      <p className="faint">{t('panel.mes.pista')}</p>
      <div className="leyenda-viz">
        <span><i className="sw sw--pista" /> {t('panel.mes.capacidad')}</span>
        <span><i className="sw sw--acento" /> {t('panel.mes.demanda')}</span>
      </div>
      <div className="viz">
        <svg viewBox={`0 0 ${String(ancho)} ${String(alto)}`} role="img" aria-label={t('panel.mes.titulo')}>
          {marcas.map((v) => {
            const y = margen.arriba + util.alto - escala(v)
            return (
              <g key={v}>
                <line className="viz__rejilla" x1={margen.izquierda} x2={ancho - margen.derecha} y1={y} y2={y} />
                <text className="viz__tick" x={margen.izquierda - 8} y={y + 4} textAnchor="end">{hours(v)}</text>
              </g>
            )
          })}
          {meses.map((m, i) => {
            const x = margen.izquierda + i * banda
            const base = margen.arriba + util.alto
            // Dos pilares por mes, con 2 px de superficie entre ellos: es el
            // hueco el que los separa, no un borde dibujado alrededor.
            const xc = x + banda / 2 - grosor - 1
            const xd = x + banda / 2 + 1
            return (
              <g key={m.period}
                onMouseEnter={() => { setEncima({ x: x + banda / 2, y: base - escala(Math.max(m.capacidad, m.demanda)), mes: m }) }}
                onMouseLeave={() => { setEncima(null) }}
              >
                <rect x={x} y={margen.arriba} width={banda} height={util.alto} fill="transparent" />
                <path className="viz__barra viz__barra--pista"
                  d={columna(xc, base - escala(m.capacidad), grosor, escala(m.capacidad))} />
                <path className="viz__barra viz__barra--acento"
                  d={columna(xd, base - escala(m.demanda), grosor, escala(m.demanda))} />
                <text className="viz__tick" x={x + banda / 2} y={alto - 12} textAnchor="middle">
                  {monthLabel(m.period)}
                </text>
                {m.period !== pico.period ? null : (
                  <text className="viz__etiqueta" x={xd + grosor / 2} y={base - escala(m.demanda) - 7} textAnchor="middle">
                    {hours(m.demanda)} h
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {encima === null ? null : (
          <div className="viz__globo" style={{ left: `${String((encima.x / ancho) * 100)}%`, top: `${String((encima.y / alto) * 100)}%` }}>
            <b>{monthLabel(encima.mes.period)}</b>
            <div>{t('panel.mes.capacidad')}: {hours(encima.mes.capacidad)} h</div>
            <div>{t('panel.mes.demanda')}: {hours(encima.mes.demanda)} h</div>
            <div>{t('col.saturacion')}: {percent(proporcion(encima.mes.demanda, encima.mes.capacidad))}</div>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Gráfico 2 · ocupación por persona
// ---------------------------------------------------------------------------

function PorPersona({
  gente, nombreDe, t,
}: {
  readonly gente: readonly Persona[]
  readonly nombreDe: (id: string) => string
  readonly t: Traductor['t']
}): React.JSX.Element | null {
  const conDatos = gente.filter((p) => p.ocupacionBp !== null)
  if (conDatos.length === 0) return null
  const visibles = conDatos.slice(0, CABEN)

  const ancho = 900
  const filaAlto = 26
  const margen = { arriba: 22, derecha: 60, abajo: 8, izquierda: 150 }
  const alto = margen.arriba + visibles.length * filaAlto + margen.abajo
  const util = ancho - margen.izquierda - margen.derecha
  const techo = Math.max(...visibles.map((p) => p.ocupacionBp ?? 0), 12_000)
  const x = (bpv: number): number => (bpv / techo) * util

  return (
    <section className="panel-cap__grafico">
      <h3>{t('panel.persona.titulo')}</h3>
      <p className="faint">{t('panel.persona.pista')}</p>
      <div className="viz">
        <svg viewBox={`0 0 ${String(ancho)} ${String(alto)}`} role="img" aria-label={t('panel.persona.titulo')}>
          {[POR_DEBAJO, POR_ENCIMA].map((umbral) => (
            <g key={umbral}>
              <line className="viz__umbral" x1={margen.izquierda + x(umbral)} x2={margen.izquierda + x(umbral)}
                y1={margen.arriba - 8} y2={alto - margen.abajo} />
              <text className="viz__tick" x={margen.izquierda + x(umbral)} y={margen.arriba - 12} textAnchor="middle">
                {percent(umbral)}
              </text>
            </g>
          ))}
          {visibles.map((p, i) => {
            const y = margen.arriba + i * filaAlto
            const bpv = p.ocupacionBp ?? 0
            return (
              <g key={p.resourceId}>
                <text className="viz__nombre" x={margen.izquierda - 10} y={y + 15} textAnchor="end">
                  {nombreDe(p.resourceId)}
                </text>
                <rect className="viz__pista" x={margen.izquierda} y={y + 4}
                  width={util} height={filaAlto - 10} rx="4" />
                <rect className="viz__barra viz__barra--acento" x={margen.izquierda} y={y + 4}
                  width={Math.max(x(bpv), 1)} height={filaAlto - 10} rx="4" />
                <text className="viz__etiqueta" x={margen.izquierda + x(bpv) + 8} y={y + 15}>
                  {percent(bpv)}
                </text>
                <title>
                  {`${nombreDe(p.resourceId)}: ${hours(p.demanda)} h / ${hours(p.capacidad)} h`}
                </title>
              </g>
            )
          })}
        </svg>
      </div>
      {conDatos.length <= CABEN ? null : (
        <p className="faint">{t('panel.persona.yMas', conDatos.length - CABEN)}</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Las dos tablas
// ---------------------------------------------------------------------------

function Detalle({
  gente, nombreDe, codigoDe, t,
}: {
  readonly gente: readonly Persona[]
  readonly nombreDe: (id: string) => string
  readonly codigoDe: (id: string) => string
  readonly t: Traductor['t']
}): React.JSX.Element | null {
  if (gente.length === 0) return null
  return (
    <section className="panel-cap__tabla">
      <h3>{t('panel.detalle.titulo')}</h3>
      <p className="faint">{t('panel.detalle.pista')}</p>
      <table className="grid">
        <thead>
          <tr>
            <th>{t('col.recurso')}</th>
            <th>{t('col.capacidad')}</th>
            <th>{t('panel.kpi.demanda')}</th>
            <th>{t('panel.col.hueco')}</th>
            <th>{t('col.saturacion')}</th>
            <th>{t('panel.col.estado')}</th>
            <th>{t('col.proyectos')}</th>
          </tr>
        </thead>
        <tbody>
          {gente.map((p) => (
            <tr key={p.resourceId}>
              <td>{nombreDe(p.resourceId)}</td>
              <td>{hours(p.capacidad)}</td>
              <td>{hours(p.demanda)}</td>
              <td>{hours(p.capacidad - p.demanda)}</td>
              <td>{percent(p.ocupacionBp)}</td>
              <td>{estado(t, p.ocupacionBp)}</td>
              <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                {p.proyectos.map((id) => codigoDe(id)).filter((c) => c !== '').join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Proximas({
  filas, codigoDe, t,
}: {
  readonly filas: readonly Proxima[]
  readonly codigoDe: (id: string) => string
  readonly t: Traductor['t']
}): React.JSX.Element {
  return (
    <section className="panel-cap__tabla">
      <h3>{t('panel.proximas.titulo', VENTANA)}</h3>
      <p className="faint">{t('panel.proximas.pista')}</p>
      {filas.length === 0 ? (
        <p className="faint">{t('panel.proximas.vacio', VENTANA)}</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>{t('panel.col.termina')}</th>
              <th>{t('col.proyecto')}</th>
              <th>{t('col.tarea')}</th>
              <th>{t('col.equipo')}</th>
              <th>{t('col.trabajo')}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nodeId}>
                <td>{fechaCorta(f.finish)}</td>
                <td>{codigoDe(f.projectId)}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{f.name}</td>
                <td style={{ textAlign: 'left' }}>{f.equipo.join(', ') || '—'}</td>
                <td>{hours(f.minutos)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Geometría y estado (lo que sí es de la vista)
// ---------------------------------------------------------------------------

function estado(t: Traductor['t'], ocupacionBp: number | null): string {
  if (ocupacionBp === null) return '—'
  if (ocupacionBp > POR_ENCIMA) return `▲ ${t('panel.estado.porEncima')}`
  if (ocupacionBp < POR_DEBAJO) return `▼ ${t('panel.estado.porDebajo')}`
  return `● ${t('panel.estado.bien')}`
}

/**
 * Una columna con la punta redondeada y la base cuadrada.
 *
 * `rx` en un `<rect>` redondea las cuatro esquinas y la barra se despega de la
 * línea de base. La punta es el dato; el apoyo no.
 */
function columna(x: number, y: number, ancho: number, alto: number): string {
  const r = Math.min(4, ancho / 2, Math.max(alto, 0))
  if (alto <= 0) return ''
  return `M ${String(x)} ${String(y + alto)} L ${String(x)} ${String(y + r)} `
    + `Q ${String(x)} ${String(y)} ${String(x + r)} ${String(y)} `
    + `L ${String(x + ancho - r)} ${String(y)} `
    + `Q ${String(x + ancho)} ${String(y)} ${String(x + ancho)} ${String(y + r)} `
    + `L ${String(x + ancho)} ${String(y + alto)} Z`
}

/** Cuatro marcas redondas: las cifras que no llevan etiqueta directa. */
function ticks(techo: number): readonly number[] {
  const paso = Math.max(1, Math.ceil(techo / 4 / 6_000) * 6_000)
  const fuera: number[] = []
  for (let v = paso; v <= techo; v += paso) fuera.push(v)
  return fuera
}

function fechaCorta(iso: string): string {
  return iso.slice(0, 10)
}
