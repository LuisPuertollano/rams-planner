import { useMemo, useState } from 'react'
import type { Project, TaskRow } from '../api.js'
import { days, fullDate, hours, percent } from '../format.js'

interface Props {
  readonly tasks: readonly TaskRow[]
  readonly projects: readonly Project[]
  readonly onExplain: (task: TaskRow) => void
}

/** El plan, como árbol WBS. Todas las columnas de la derecha son derivadas. */
export function PlanView({ tasks, projects, onExplain }: Props): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const byProject = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const task of tasks) {
      const bucket = map.get(task.projectId) ?? []
      bucket.push(task)
      map.set(task.projectId, bucket)
    }
    return map
  }, [tasks])

  const toggle = (nodeId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const isHidden = (task: TaskRow): boolean => task.parentId !== null && collapsed.has(task.parentId)

  return (
    <table className="grid">
      <thead>
        <tr>
          <th style={{ minWidth: 320 }}>Tarea</th>
          <th>Inicio</th>
          <th>Fin</th>
          <th>Duración</th>
          <th>Trabajo</th>
          <th>Holgura</th>
          <th>Avance</th>
          <th>Equipo</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => {
          const rows = byProject.get(project.id) ?? []
          return (
            <>
              <tr key={project.id} className="row--total">
                <td colSpan={9}>
                  {project.code} · {project.name}
                </td>
              </tr>
              {rows.filter((task) => !isHidden(task)).map((task) => (
                <tr key={task.nodeId}>
                  <td>
                    <span className="wbs__name" style={{ paddingLeft: task.parentId === null ? 0 : 18 }}>
                      {task.kind === 'phase' || task.kind === 'work_package' ? (
                        <button
                          className="disclosure"
                          onClick={() => { toggle(task.nodeId) }}
                          aria-expanded={!collapsed.has(task.nodeId)}
                          aria-label="Plegar"
                        >
                          {collapsed.has(task.nodeId) ? '▸' : '▾'}
                        </button>
                      ) : null}
                      <span className={task.isCritical === true ? 'critical' : ''}>{task.name}</span>
                      {task.kind === 'milestone' ? <span className="wbs__kind">hito</span> : null}
                      {task.deadline === null ? null : (
                        <span className="wbs__kind" title="Fecha objetivo (blanda)">
                          ⚑ {fullDate(task.deadline)}
                        </span>
                      )}
                      {task.constraintKind !== null && task.constraintKind !== 'asap' ? (
                        <span className="wbs__kind" title="Restricción declarada">
                          {task.constraintKind.replaceAll('_', ' ')}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="cell--derived">{fullDate(task.scheduledStart)}</td>
                  <td className="cell--derived">{fullDate(task.scheduledFinish)}</td>
                  <td className="cell--derived">{days(task.durationMinutes)}</td>
                  <td className="cell--derived">
                    {task.workMinutes === null || task.workMinutes === 0 ? '—' : `${hours(task.workMinutes)} h`}
                  </td>
                  <td className={`cell--derived ${task.isCritical === true ? 'critical' : ''}`}>
                    {task.totalSlackMinutes === null ? '—' : days(task.totalSlackMinutes)}
                  </td>
                  <td className="cell--derived">{task.percentCompleteBp === 0 ? '—' : percent(task.percentCompleteBp)}</td>
                  <td className="muted" style={{ textAlign: 'left' }}>
                    {task.assignees.join(', ') || '—'}
                  </td>
                  <td>
                    {task.kind === 'task' || task.kind === 'milestone' ? (
                      <button className="button" onClick={() => { onExplain(task) }}>
                        ¿por qué?
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </>
          )
        })}
      </tbody>
    </table>
  )
}
