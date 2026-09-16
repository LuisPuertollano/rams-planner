import { useMemo, useState } from 'react'
import type { LoadCell, Project, Resource, UtilizationCell } from '../api.js'
import { hours, monthLabel, percent, utilizationColor } from '../format.js'
import { activePeriods } from '../periods.js'

interface Props {
  readonly resources: readonly Resource[]
  readonly projects: readonly Project[]
  readonly load: readonly LoadCell[]
  readonly utilization: readonly UtilizationCell[]
  readonly runId: string
}


/**
 * La matriz de carga: recurso → proyecto × mes.
 *
 * Es la pantalla por la que existe la herramienta. Todas sus celdas son valores
 * derivados y por eso ninguna es editable: llevan el `runId` que las produjo en
 * el título, para que se pueda auditar de dónde sale cada número.
 */
export function MatrixView({ resources, projects, load, utilization, runId }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const periods = useMemo(
    () => activePeriods(load.filter((cell) => cell.plannedMinutes > 0).map((cell) => cell.period)),
    [load],
  )

  const byResourcePeriod = useMemo(() => index(load, (cell) => `${cell.resourceId}|${cell.period}`), [load])
  const byResourceProjectPeriod = useMemo(
    () => index(load, (cell) => `${cell.resourceId}|${cell.projectId}|${cell.period}`),
    [load],
  )
  const utilByKey = useMemo(() => {
    const map = new Map<string, UtilizationCell>()
    for (const cell of utilization) map.set(`${cell.resourceId}|${cell.period}`, cell)
    return map
  }, [utilization])

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
        <h3>Todavía no hay carga que mostrar</h3>
        <p>Carga datos y pulsa «Recalcular» para que el motor reparta el trabajo.</p>
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
    <table className="grid">
      <thead>
        <tr>
          <th>Recurso</th>
          {periods.map((period) => (
            <th key={period}>{monthLabel(period)}</th>
          ))}
          <th>Total</th>
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
          <td>Equipo</td>
          {totalsByPeriod.map((minutes, index) => (
            <td key={periods[index]}>{hours(minutes)}</td>
          ))}
          <td>{hours(totalsByPeriod.reduce((sum, value) => sum + value, 0))}</td>
        </tr>
      </tbody>
    </table>
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
  projects,
}: ResourceRowsProps): React.JSX.Element {
  return (
    <>
      <tr className="row--resource">
        <td>
          <button className="disclosure" onClick={onToggle} aria-expanded={isOpen} aria-label="Desplegar proyectos">
            {isOpen ? '▾' : '▸'}
          </button>
          {resource.displayName}{' '}
          <span className="faint">{resource.calendarCode === null ? '' : resource.calendarCode.replace('base_', '')}</span>
        </td>
        {periods.map((period) => {
          const minutes = plannedOf(period)
          return (
            <td
              key={period}
              className={minutes === 0 ? 'cell--derived cell--zero' : 'cell--derived'}
              title={`Derivado de la ejecución ${runId.slice(0, 8)} · no editable`}
            >
              {hours(minutes)}
            </td>
          )
        })}
        <td>{hours(total)}</td>
      </tr>

      <tr className="row--capacity">
        <td>capacidad · saturación</td>
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

      {isOpen
        ? projects.map((project) => (
            <tr className="row--project" key={project.id}>
              <td>{project.label}</td>
              {periods.map((period) => (
                <td key={period} className={project.minutesOf(period) === 0 ? 'cell--zero' : ''}>
                  {hours(project.minutesOf(period))}
                </td>
              ))}
              <td>{hours(periods.reduce((sum, period) => sum + project.minutesOf(period), 0))}</td>
            </tr>
          ))
        : null}
    </>
  )
}

function index(cells: readonly LoadCell[], key: (cell: LoadCell) => string): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  for (const cell of cells) map.set(key(cell), (map.get(key(cell)) ?? 0) + cell.plannedMinutes)
  return map
}
