import { useEffect, useMemo, useState } from 'react'
import { fetchReport, type AppState, type FindingRow, type Report, type RunData } from '../api.js'
import { findingHint, findingText, severityLabel } from '../findings.js'
import { dateTime, fullDate, hours, monthLabel, percent } from '../format.js'
import { useT, type Traductor } from '../i18n/index.js'
import type { VistaId } from '../nav.js'

interface Props {
  readonly state: AppState
  readonly data: RunData
  /** Si no se pueden ver las horas fichadas, ni se piden: sería un 403 seguro. */
  readonly puedeVerReales: boolean
  readonly onIr: (vista: VistaId) => void
}

/** Cuántas filas se enseñan de cada bloque antes del «…y N más». */
const CABEN = 5

const GRAVE = new Set(['blocking', 'error'])

/**
 * La portada: lo que hay que mirar antes que nada.
 *
 * No calcula nada nuevo. Todo lo que dice ya estaba en la herramienta, repartido
 * entre seis pantallas que había que visitar una por una para enterarse de si el
 * plan de hoy se sostiene. Esa era la queja real: catorce pestañas y ninguna que
 * respondiera «¿y ahora qué miro?».
 *
 * De ahí las dos reglas de esta pantalla. La primera: cada línea lleva a la
 * pantalla que la explica, porque un resumen que no se puede abrir es un cartel.
 * La segunda: si no hay nada que enseñar, se dice — un hueco en blanco se lee
 * como una avería, y «no hay nada que te bloquee» es una respuesta.
 *
 * Aquí viven también los hallazgos, que antes tenían pestaña propia. Los graves
 * arriba del todo; el resto, doblado, porque son avisos y no urgencias.
 */
export function TodayView({ state, data, puedeVerReales, onIr }: Props): React.JSX.Element {
  const { t } = useT()
  const [informe, setInforme] = useState<Report | null>(null)

  useEffect(() => {
    if (!puedeVerReales) return
    // Lo fichado no está en la ejecución: vive en su propia tabla y lo cruza el
    // informe. Si falla, esta pantalla se queda sin ese bloque y con todos los
    // demás; no es motivo para tumbar la portada.
    fetchReport([], '', '')
      .then(setInforme)
      .catch(() => { setInforme(null) })
  }, [puedeVerReales, data])

  const nombreDe = useMemo(() => {
    const porId = new Map(state.resources.map((persona) => [persona.id, persona.displayName]))
    return (id: string): string => porId.get(id) ?? id
  }, [state.resources])

  const codigoDe = useMemo(() => {
    const porId = new Map(state.projects.map((proyecto) => [proyecto.id, proyecto.code]))
    return (id: string): string => porId.get(id) ?? ''
  }, [state.projects])

  const graves = data.findings.filter((hallazgo) => GRAVE.has(hallazgo.severity))
  const fuera = data.findings.filter((hallazgo) => hallazgo.code === 'DEPENDENCY_OUT_OF_PLAN')
  const resto = data.findings.filter(
    (hallazgo) => !GRAVE.has(hallazgo.severity) && hallazgo.code !== 'DEPENDENCY_OUT_OF_PLAN',
  )

  const pasados = useMemo(() => quienVaPasado(data), [data])
  const tarde = useMemo(() => loQueLlegaTarde(data), [data])

  const fueraDePlan = informe === null || informe.actualsHidden ? 0 : informe.totals.unplannedActualMinutes
  const hayRealidad = informe !== null && !informe.actualsHidden && informe.totals.actualMinutes > 0

  const enOrden = graves.length === 0 && pasados.length === 0 && tarde.length === 0

  return (
    <div className="hoy">
      {!enOrden ? null : (
        <div className="empty" style={{ padding: '28px 16px' }}>
          <h3>{t('hoy.enOrden.titulo')}</h3>
          <p style={{ maxWidth: '56ch', margin: '0 auto' }}>{t('hoy.enOrden.texto')}</p>
        </div>
      )}

      {graves.length === 0 ? null : (
        <Bloque
          titulo={t('hoy.bloquea.titulo')}
          pista={t('hoy.bloquea.pista')}
          cuantos={graves.length}
          t={t}
        >
          {graves.slice(0, CABEN).map((hallazgo, indice) => (
            <Hallazgo key={`${hallazgo.code}-${hallazgo.entityId}-${String(indice)}`} finding={hallazgo} t={t} />
          ))}
          <Mas total={graves.length} t={t} />
        </Bloque>
      )}

      {pasados.length === 0 ? null : (
        <Bloque
          titulo={t('hoy.pasados.titulo')}
          pista={t('hoy.pasados.pista')}
          cuantos={pasados.length}
          accion={{ texto: t('hoy.ir', t('tab.saturacion')), onClick: () => { onIr('saturacion') } }}
          t={t}
        >
          {pasados.slice(0, CABEN).map((persona) => (
            <p className="hoy__fila" key={persona.resourceId}>
              <b>{nombreDe(persona.resourceId)}</b>
              <span className="faint">
                {t('hoy.pasados.fila', picoLegible(t, persona.peakBp), fullDate(persona.peakDate))}
                {persona.peorMesBp === null
                  ? ''
                  : ` ${t('hoy.pasados.mes', percent(persona.peorMesBp), monthLabel(persona.peorMes ?? ''))}`}
              </span>
            </p>
          ))}
          <Mas total={pasados.length} t={t} />
        </Bloque>
      )}

      {tarde.length === 0 ? null : (
        <Bloque
          titulo={t('hoy.tarde.titulo')}
          pista={t('hoy.tarde.pista')}
          cuantos={tarde.length}
          accion={{ texto: t('hoy.ir', t('tab.plan')), onClick: () => { onIr('plan') } }}
          t={t}
        >
          {tarde.slice(0, CABEN).map((fila) => (
            <p className="hoy__fila" key={fila.nodeId}>
              <b>
                {codigoDe(fila.projectId) === '' ? '' : `${codigoDe(fila.projectId)} · `}
                {fila.name}
              </b>
              <span className="faint">
                {fila.deadline === null
                  ? t('hoy.tarde.holgura', hours(fila.slackMinutes ?? 0))
                  : t('hoy.tarde.limite', fullDate(fila.scheduledFinish), fullDate(fila.deadline))}
              </span>
            </p>
          ))}
          <Mas total={tarde.length} t={t} />
        </Bloque>
      )}

      {fuera.length === 0 ? null : (
        <Bloque
          titulo={t('hoy.fuera.titulo')}
          pista={t('hoy.fuera.pista')}
          cuantos={fuera.length}
          accion={{ texto: t('hoy.ir', t('tab.plan')), onClick: () => { onIr('plan') } }}
          t={t}
        >
          {fuera.slice(0, CABEN).map((hallazgo, indice) => (
            <Hallazgo key={`${hallazgo.entityId}-${String(indice)}`} finding={hallazgo} t={t} />
          ))}
          <Mas total={fuera.length} t={t} />
        </Bloque>
      )}

      {!hayRealidad || informe === null ? null : (
        <Bloque
          titulo={t('hoy.realidad.titulo')}
          pista={t('hoy.realidad.hasta', informe.totals.actualsThrough ?? '—')}
          accion={{ texto: t('hoy.ir', t('tab.informes')), onClick: () => { onIr('informes') } }}
          t={t}
        >
          <p className="hoy__fila">
            <b>{hours(informe.totals.actualMinutes)} h</b>
            <span className="faint">
              {fueraDePlan === 0
                ? t('hoy.realidad.sinFuera')
                : t('hoy.realidad.fuera', hours(fueraDePlan))}
            </span>
          </p>
        </Bloque>
      )}

      {state.run === null ? null : (
        <Bloque titulo={t('hoy.calculo.titulo')} pista={t('hoy.calculo.pista')} t={t}>
          <p className="hoy__fila">
            <b>{dateTime(state.run.startedAt)}</b>
            <span className="faint">
              {t(
                'ejecucion.chip',
                state.run.id.slice(0, 8),
                state.run.engineVersion,
                dateTime(state.run.startedAt),
                state.run.durationMs ?? 0,
              )}
            </span>
          </p>
        </Bloque>
      )}

      {resto.length === 0 ? null : (
        <details className="hoy__resto">
          <summary>
            <b>{t('tab.hallazgos')}</b>{' '}
            <span className="faint">{t('hoy.resto.cuantos', resto.length)}</span>
          </summary>
          <div>
            {resto.map((hallazgo, indice) => (
              <Hallazgo key={`${hallazgo.code}-${hallazgo.entityId}-${String(indice)}`} finding={hallazgo} t={t} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Bloque({
  titulo, pista, cuantos, accion, t, children,
}: {
  readonly titulo: string
  readonly pista: string
  readonly cuantos?: number | undefined
  readonly accion?: { readonly texto: string; readonly onClick: () => void } | undefined
  readonly t: Traductor['t']
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="hoy__bloque">
      <div className="hoy__cabeza">
        <h3>
          {titulo}
          {cuantos === undefined ? null : <span className="hoy__cuenta">{cuantos}</span>}
        </h3>
        {accion === undefined ? null : (
          <button className="button" onClick={accion.onClick} title={t('hoy.irTitulo')}>
            {accion.texto}
          </button>
        )}
      </div>
      <p className="hoy__pista">{pista}</p>
      <div className="hoy__cuerpo">{children}</div>
    </section>
  )
}

function Mas({ total, t }: { readonly total: number; readonly t: Traductor['t'] }): React.JSX.Element | null {
  if (total <= CABEN) return null
  return <p className="faint hoy__mas">{t('hoy.mas', total - CABEN)}</p>
}

function Hallazgo({
  finding, t,
}: { readonly finding: FindingRow; readonly t: Traductor['t'] }): React.JSX.Element {
  return (
    <div className="finding">
      <span className={`finding__dot severity-${finding.severity}`} />
      <div>
        <div className="finding__code">
          {severityLabel(t, finding.severity)} · {finding.code}
          {finding.occursOn === null ? '' : ` · ${fullDate(finding.occursOn)}`}
        </div>
        <p className="finding__message">{findingText(t, finding)}</p>
        <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
          {findingHint(t, finding.code)}
        </p>
      </div>
    </div>
  )
}

interface VaPasado {
  readonly resourceId: string
  /** El peor día y cuánto: es lo que hace que esa persona esté pasada. */
  readonly peakDate: string
  readonly peakBp: number
  /** El peor mes por encima del 100 %, si es que lo hay. */
  readonly peorMes: string | null
  readonly peorMesBp: number | null
}

/** «sin capacidad ese día» no es un 0 %: el motor lo manda como -1. */
function picoLegible(t: Traductor['t'], bp: number): string {
  return bp < 0 ? t('hallazgo.sinCapacidad') : percent(bp)
}

/**
 * Quién se pasa de capacidad, contado **como lo cuenta la tarjeta de arriba**.
 *
 * Esto costó una pantalla entera: la primera versión miraba la ocupación
 * mensual y decía «3», justo debajo de una tarjeta que decía «6». Las dos
 * cifras eran correctas y medían cosas distintas —el motor marca la sobrecarga
 * **por día** y la ocupación se agrega **por mes**—, y alguien puede pasarse un
 * martes sin pasarse abril. Pero dos números distintos para lo que se lee como
 * lo mismo, a diez centímetros uno de otro, no se perdona: se deja de creer a
 * los dos.
 *
 * Así que la lista sale del hallazgo, que es de donde sale la tarjeta, y el mes
 * se añade sólo cuando además lo hay. La frase lo dice: el día primero.
 */
function quienVaPasado(data: RunData): readonly VaPasado[] {
  const peorMes = new Map<string, { period: string; bp: number }>()
  for (const celda of data.utilization) {
    if (celda.utilizationBp === null || celda.utilizationBp <= 10_000) continue
    const anterior = peorMes.get(celda.resourceId)
    if (anterior === undefined || celda.utilizationBp > anterior.bp) {
      peorMes.set(celda.resourceId, { period: celda.period, bp: celda.utilizationBp })
    }
  }

  const peor = new Map<string, VaPasado>()
  for (const hallazgo of data.findings) {
    if (hallazgo.code !== 'RESOURCE_OVERALLOCATED') continue
    const pico = Number(hallazgo.payload?.['peakUtilizationBp'] ?? 0)
    const dia = String(hallazgo.payload?.['peakDate'] ?? hallazgo.occursOn ?? '')
    const anterior = peor.get(hallazgo.entityId)
    // Un -1 («sin capacidad ese día») es lo peor que hay, no lo más bajo.
    const esPeor = anterior === undefined || pico < 0 || (anterior.peakBp >= 0 && pico > anterior.peakBp)
    if (!esPeor) continue
    const mes = peorMes.get(hallazgo.entityId)
    peor.set(hallazgo.entityId, {
      resourceId: hallazgo.entityId,
      peakDate: dia,
      peakBp: pico,
      peorMes: mes?.period ?? null,
      peorMesBp: mes?.bp ?? null,
    })
  }

  return [...peor.values()].sort((a, b) => {
    if (a.peakBp < 0 || b.peakBp < 0) return a.peakBp < 0 ? -1 : 1
    return b.peakBp - a.peakBp
  })
}

interface Tarde {
  readonly nodeId: string
  readonly projectId: string
  readonly name: string
  readonly scheduledFinish: string | null
  readonly deadline: string | null
  readonly slackMinutes: number | null
}

/**
 * Lo que no llega: o se pasa de su fecha límite, o ya se comió su holgura.
 *
 * Las dos cosas son el mismo problema visto desde dos sitios —la fecha que
 * alguien prometió y el margen que el cálculo dice que queda—, y separarlas
 * obligaría a mirar en dos pantallas para enterarse de una sola cosa.
 */
function loQueLlegaTarde(data: RunData): readonly Tarde[] {
  const tarde: Tarde[] = []
  for (const tarea of data.tasks) {
    if (tarea.kind !== 'task') continue
    const pasada =
      tarea.deadline !== null &&
      tarea.scheduledFinish !== null &&
      tarea.scheduledFinish > tarea.deadline
    const sinMargen = tarea.totalSlackMinutes !== null && tarea.totalSlackMinutes < 0
    if (!pasada && !sinMargen) continue
    tarde.push({
      nodeId: tarea.nodeId,
      projectId: tarea.projectId,
      name: tarea.name,
      scheduledFinish: tarea.scheduledFinish,
      deadline: pasada ? tarea.deadline : null,
      slackMinutes: tarea.totalSlackMinutes,
    })
  }
  // Lo más urgente primero: la holgura más negativa, y las que no la tienen
  // calculada al final.
  return tarde.sort((a, b) => (a.slackMinutes ?? 0) - (b.slackMinutes ?? 0))
}
