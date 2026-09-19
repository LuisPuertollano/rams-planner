import { useMemo, useState } from 'react'
import type { LoadCell, Project, Resource, UtilizationCell } from '../api.js'
import { euros, hours, percent, periodLabel, utilizationColor } from '../format.js'
import { useT } from '../i18n/index.js'
import { agrupar, claveDeCarga, periodosActivos, sumaCarga, sumaSaturacion, type Escala } from '../periods.js'
import { SelectorDeEscala } from '../components/SelectorDeEscala.js'

interface Props {
  readonly resources: readonly Resource[]
  readonly projects: readonly Project[]
  readonly load: readonly LoadCell[]
  readonly utilization: readonly UtilizationCell[]
  readonly runId: string
  /**
   * Si los importes han llegado. El servidor los manda a cero cuando no hay
   * permiso, así que sin este dato la matriz enseñaría «0 €» y eso se lee como
   * «costó cero», que es distinto de no poder verlo.
   */
  readonly costsHidden: boolean
}

/** En qué se mide la matriz. El reparto del trabajo es el mismo; la unidad no. */
type Unidad = 'horas' | 'euros'


/**
 * La matriz de carga: recurso → proyecto × mes.
 *
 * Es la pantalla por la que existe la herramienta. Todas sus celdas son valores
 * derivados y por eso ninguna es editable: llevan el `runId` que las produjo en
 * el título, para que se pueda auditar de dónde sale cada número.
 */
export function MatrixView({
  resources,
  projects,
  load,
  utilization,
  runId,
  costsHidden,
}: Props): React.JSX.Element {
  const { t, locale } = useT()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [escala, setEscala] = useState<Escala>('mes')
  const [unidad, setUnidad] = useState<Unidad>('horas')
  const enEuros = unidad === 'euros' && !costsHidden

  /** El valor de una celda según la unidad. Lo demás de la matriz no cambia. */
  const valorDe = useMemo(
    () => (cell: LoadCell): number => (enEuros ? cell.costCents : cell.plannedMinutes),
    [enEuros],
  )
  const formatea = useMemo(
    () => (valor: number): string => (enEuros ? euros(valor) : `${hours(valor)}`),
    [enEuros],
  )

  // Las celdas llegan por mes y se juntan aquí. Todo lo que viene después
  // trabaja sobre `celdas` y `saturacion`, así que la escala no se cuela en
  // ninguna cuenta de más abajo.
  const celdas = useMemo(() => agrupar(load, escala, claveDeCarga, sumaCarga), [load, escala])
  const saturacion = useMemo(
    () => agrupar(utilization, escala, (cell) => cell.resourceId, sumaSaturacion),
    [utilization, escala],
  )

  const periods = useMemo(
    () => periodosActivos(load.filter((cell) => cell.plannedMinutes > 0).map((cell) => cell.period), escala),
    [load, escala],
  )

  const byResourcePeriod = useMemo(
    () => index(celdas, (cell) => `${cell.resourceId}|${cell.period}`, valorDe),
    [celdas, valorDe],
  )
  const byResourceProjectPeriod = useMemo(
    () => index(celdas, (cell) => `${cell.resourceId}|${cell.projectId}|${cell.period}`, valorDe),
    [celdas, valorDe],
  )
  const utilByKey = useMemo(() => {
    const map = new Map<string, UtilizationCell>()
    for (const cell of saturacion) map.set(`${cell.resourceId}|${cell.period}`, cell)
    return map
  }, [saturacion])

  const projectsOf = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const cell of load) {
      const bucket = map.get(cell.resourceId) ?? new Set<string>()
      bucket.add(cell.projectId)
      map.set(cell.resourceId, bucket)
    }
    return map
  }, [load])

  const projectName = (id: string): string => projects.find((project) => project.id === id)?.code ?? id

  if (periods.length === 0) {
    return (
      <div className="empty">
        <h3>{t('carga.vacio')}</h3>
        <p>{t('carga.vacioDetalle')}</p>
      </div>
    )
  }

  const toggle = (resourceId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(resourceId)) next.delete(resourceId)
      else next.add(resourceId)
      return next
    })
  }

  const totalsByPeriod = periods.map((period) =>
    resources.reduce((sum, resource) => sum + (byResourcePeriod.get(`${resource.id}|${period}`) ?? 0), 0),
  )

  return (
    <>
      <SelectorDeEscala valor={escala} onCambiar={setEscala} />
      <div className="toolbar">
        <span className="faint">{t('carga.medirEn')}</span>
        <button
          className="tab"
          aria-selected={!enEuros}
          onClick={() => { setUnidad('horas') }}
        >
          {t('carga.horas')}
        </button>
        <button
          className="tab"
          aria-selected={enEuros}
          disabled={costsHidden}
          title={costsHidden ? t('carga.sinCostesTitulo') : t('carga.eurosTitulo')}
          onClick={() => { setUnidad('euros') }}
        >
          {t('carga.euros')}
        </button>
        <span className="faint">
          {costsHidden
            ? t('carga.sinCostesNota')
            : enEuros
              ? t('carga.notaEuros')
              : t('carga.notaHoras')}
        </span>
      </div>

    <table className="grid">
      <thead>
        <tr>
          <th>{t('col.recurso')}</th>
          {periods.map((period) => (
            <th key={period}>{periodLabel(period, locale, t('escala.letraTrimestre'))}</th>
          ))}
          <th>{t('col.total')}</th>
        </tr>
      </thead>
      <tbody>
        {resources.map((resource) => {
          const isOpen = expanded.has(resource.id)
          const resourceProjects = [...(projectsOf.get(resource.id) ?? [])].sort()
          const total = periods.reduce((sum, period) => sum + (byResourcePeriod.get(`${resource.id}|${period}`) ?? 0), 0)

          return (
            <ResourceRows
              key={resource.id}
              resource={resource}
              periods={periods}
              isOpen={isOpen}
              onToggle={() => { toggle(resource.id) }}
              total={total}
              runId={runId}
              plannedOf={(period) => byResourcePeriod.get(`${resource.id}|${period}`) ?? 0}
              utilOf={(period) => utilByKey.get(`${resource.id}|${period}`)}
              hasCapacity={utilization.length > 0}
              enEuros={enEuros}
              formatea={formatea}
              projects={resourceProjects.map((projectId) => ({
                id: projectId,
                label: projectName(projectId),
                minutesOf: (period: string) =>
                  byResourceProjectPeriod.get(`${resource.id}|${projectId}|${period}`) ?? 0,
              }))}
            />
          )
        })}
        <tr className="row--total">
          <td>{t('carga.equipo')}</td>
          {totalsByPeriod.map((valor, index) => (
            <td key={periods[index]}>{formatea(valor)}</td>
          ))}
          <td>{formatea(totalsByPeriod.reduce((sum, value) => sum + value, 0))}</td>
        </tr>
      </tbody>
    </table>
    </>
  )
}

interface ResourceRowsProps {
  readonly resource: Resource
  readonly periods: readonly string[]
  readonly isOpen: boolean
  readonly onToggle: () => void
  readonly total: number
  readonly runId: string
  readonly plannedOf: (period: string) => number
  readonly utilOf: (period: string) => UtilizationCell | undefined
  /** Si llegó la capacidad del equipo. Sin ella la fila de saturación sobra. */
  readonly hasCapacity: boolean
  /** La matriz está en euros: la capacidad, que es tiempo, no pinta nada. */
  readonly enEuros: boolean
  /** Cómo se escribe un valor en la unidad elegida. */
  readonly formatea: (valor: number) => string
  readonly projects: readonly { id: string; label: string; minutesOf: (period: string) => number }[]
}

function ResourceRows({
  resource,
  periods,
  isOpen,
  onToggle,
  total,
  runId,
  plannedOf,
  utilOf,
  hasCapacity,
  enEuros,
  formatea,
  projects,
}: ResourceRowsProps): React.JSX.Element {
  const { t } = useT()
  return (
    <>
      <tr className="row--resource">
        <td>
          <button className="disclosure" onClick={onToggle} aria-expanded={isOpen} aria-label={t('carga.desplegar')}>
            {isOpen ? '▾' : '▸'}
          </button>
          {resource.displayName}{' '}
          <span className="faint">{resource.calendarCode === null ? '' : resource.calendarCode.replace('base_', '')}</span>
        </td>
        {periods.map((period) => {
          const valor = plannedOf(period)
          return (
            <td
              key={period}
              className={valor === 0 ? 'cell--derived cell--zero' : 'cell--derived'}
              title={t('carga.derivadoDe', runId.slice(0, 8))}
            >
              {formatea(valor)}
            </td>
          )
        })}
        <td>{formatea(total)}</td>
      </tr>

      {/* Sin permiso para ver la carga de toda la herramienta no llega la
          capacidad del equipo. La fila se quita entera: enseñarla a cero diría
          que esa persona no tiene capacidad, que es distinto de no saberlo.
          En euros tampoco aparece: la capacidad de una persona es tiempo, y
          poner horas en una tabla de importes sólo confunde. */}
      {!hasCapacity || enEuros ? null : (
      <tr className="row--capacity">
        <td>{t('carga.capacidadSaturacion')}</td>
        {periods.map((period) => {
          const util = utilOf(period)
          const bp = util?.utilizationBp ?? null
          return (
            <td key={period}>
              {hours(util?.capacityMinutes ?? 0)}{' '}
              {bp === null || (util?.plannedMinutes ?? 0) === 0 ? null : (
                <span className="util" style={{ background: utilizationColor(bp) }}>
                  {percent(bp)}
                </span>
              )}
            </td>
          )
        })}
        <td />
      </tr>
      )}

      {isOpen
        ? projects.map((project) => (
            <tr className="row--project" key={project.id}>
              <td>{project.label}</td>
              {periods.map((period) => (
                <td key={period} className={project.minutesOf(period) === 0 ? 'cell--zero' : ''}>
                  {formatea(project.minutesOf(period))}
                </td>
              ))}
              <td>{formatea(periods.reduce((sum, period) => sum + project.minutesOf(period), 0))}</td>
            </tr>
          ))
        : null}
    </>
  )
}

function index(
  cells: readonly LoadCell[],
  key: (cell: LoadCell) => string,
  valor: (cell: LoadCell) => number,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  for (const cell of cells) map.set(key(cell), (map.get(key(cell)) ?? 0) + valor(cell))
  return map
}
