import { useMemo } from 'react'
import type { Project, TaskRow } from '../api.js'
import { fullDate, monthLabel } from '../format.js'

interface Props {
  readonly tasks: readonly TaskRow[]
  readonly projects: readonly Project[]
}

const DAY_MS = 86_400_000

/**
 * Gantt propio.
 *
 * Los componentes comerciales traen su propio modelo de datos y su propio
 * motor, y eso reintroduce justo la mezcla entre lo declarado y lo derivado que
 * el sistema prohíbe. Aquí las barras son sólo una proyección de `task_result`.
 */
export function GanttView({ tasks, projects }: Props): React.JSX.Element {
  const scheduled = useMemo(
    () => tasks.filter((task) => task.scheduledStart !== null && task.scheduledFinish !== null),
    [tasks],
  )

  const bounds = useMemo(() => {
    if (scheduled.length === 0) return null
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const task of scheduled) {
      min = Math.min(min, Date.parse(task.scheduledStart ?? ''))
      max = Math.max(max, Date.parse(task.scheduledFinish ?? ''))
    }
    return { min, max, span: Math.max(max - min, DAY_MS) }
  }, [scheduled])

  const months = useMemo(() => {
    if (bounds === null) return []
    const found: { label: string; left: number; width: number }[] = []
    const cursor = new Date(bounds.min)
    cursor.setUTCDate(1)
    while (cursor.getTime() <= bounds.max) {
      const start = cursor.getTime()
      const next = new Date(cursor)
      next.setUTCMonth(next.getUTCMonth() + 1)
      const visibleStart = Math.max(start, bounds.min)
      const visibleEnd = Math.min(next.getTime(), bounds.max)
      found.push({
        label: monthLabel(`${String(cursor.getUTCFullYear())}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`),
        left: ((visibleStart - bounds.min) / bounds.span) * 100,
        width: ((visibleEnd - visibleStart) / bounds.span) * 100,
      })
      cursor.setTime(next.getTime())
    }
    return found
  }, [bounds])

  if (bounds === null) {
    return <div className="empty"><h3>No hay tareas planificadas</h3></div>
  }

  const position = (task: TaskRow): { left: number; width: number } => {
    const start = Date.parse(task.scheduledStart ?? '')
    const finish = Date.parse(task.scheduledFinish ?? '')
    return {
      left: ((start - bounds.min) / bounds.span) * 100,
      width: Math.max(((finish - start) / bounds.span) * 100, 0.4),
    }
  }

  return (
    <div className="gantt">
      <div className="gantt__head">
        <div className="gantt__label">Cronograma</div>
        <div className="gantt__months" style={{ position: 'relative', height: 28 }}>
          {months.map((month) => (
            <div
              key={month.label}
              className="gantt__month"
              style={{ position: 'absolute', left: `${String(month.left)}%`, width: `${String(month.width)}%` }}
            >
              {month.width > 3 ? month.label : ''}
            </div>
          ))}
        </div>
      </div>

      {projects.map((project) => (
        <div key={project.id}>
          <div className="gantt__row" style={{ background: 'var(--bg-sunken)' }}>
            <div className="gantt__label">
              <b>{project.code}</b>
            </div>
            <div className="gantt__track" />
          </div>
          {scheduled
            .filter((task) => task.projectId === project.id)
            .map((task) => {
              const { left, width } = position(task)
              const isContainer = task.kind === 'phase' || task.kind === 'work_package'
              return (
                <div className="gantt__row" key={task.nodeId}>
                  <div className="gantt__label" style={{ paddingLeft: isContainer ? 12 : 26 }} title={task.name}>
                    {task.name}
                  </div>
                  <div className="gantt__track">
                    {task.kind === 'milestone' ? (
                      <span
                        className="gantt__milestone"
                        style={{ left: `calc(${String(left)}% - 7px)` }}
                        title={`${task.name} · ${fullDate(task.scheduledStart)}`}
                      />
                    ) : (
                      <span
                        className={[
                          'gantt__bar',
                          isContainer ? 'gantt__bar--container' : '',
                          task.isCritical === true && !isContainer ? 'gantt__bar--critical' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
                        title={`${task.name}\n${fullDate(task.scheduledStart)} → ${fullDate(task.scheduledFinish)}`}
                      />
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      ))}

      <div style={{ padding: '12px 16px' }} className="legend">
        <span>
          <span className="legend__swatch" style={{ background: 'var(--accent)' }} />
          tarea
        </span>
        <span>
          <span className="legend__swatch" style={{ background: 'var(--severity-error)' }} />
          camino crítico
        </span>
        <span>
          <span className="legend__swatch" style={{ background: 'var(--text-faint)', height: 6 }} />
          contenedor (agregado de sus hijos)
        </span>
      </div>
    </div>
  )
}
