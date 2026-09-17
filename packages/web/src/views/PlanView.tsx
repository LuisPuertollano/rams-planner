import { useMemo, useState } from 'react'
import {
  createNode,
  createProject,
  duplicateProject,
  updateTask,
  type FieldValue,
  type Project,
  type TaskRow,
} from '../api.js'
import { days, fullDate, hours, percent } from '../format.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly tasks: readonly TaskRow[]
  readonly projects: readonly Project[]
  readonly fields: readonly FieldValue[]
  readonly onExplain: (task: TaskRow) => void
  /** Abre el panel de edición de la rama: nombre, equipo, dependencias, baja. */
  readonly onEdit: (task: TaskRow) => void
  /** Abre el panel del proyecto: identidad, fecha de referencia, prioridad, baja. */
  readonly onEditProject: (project: Project) => void
  readonly onChanged: () => void
}

/**
 * El plan, como árbol WBS.
 *
 * Las dos primeras columnas de datos son **declaradas** y se editan en línea.
 * Las demás son **derivadas**: fondo propio, candado y ni un solo `input`. Es el
 * principio P1 hecho algo que se ve, no una nota en un documento.
 */
export function PlanView({
  tasks,
  projects,
  fields,
  onExplain,
  onEdit,
  onEditProject,
  onChanged,
}: Props): React.JSX.Element {
  const { t } = useT()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tagOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const field of fields) if (field.fieldKey === 'rams_tag') map.set(field.entityId, field.value)
    return map
  }, [fields])

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

  const save = (task: TaskRow, changes: Readonly<Record<string, number | string | null>>): void => {
    setSaving(task.nodeId)
    setError(null)
    updateTask(task.nodeId, { ...changes, comment: 'edición desde la vista de plan' })
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.guardar')) })
      .finally(() => { setSaving(null) })
  }

  /** Un proyecto nuevo arranca hoy; la fecha de referencia se ajusta después. */
  const addProject = (): void => {
    const name = window.prompt('Nombre del proyecto nuevo')
    if (name === null || name.trim() === '') return
    const code = window.prompt('Código del proyecto (corto y único)', name.trim().slice(0, 12).toUpperCase())
    if (code === null || code.trim() === '') return
    setSaving('nuevo-proyecto')
    setError(null)
    createProject({ code: code.trim(), name: name.trim(), statusStart: new Date().toISOString().slice(0, 10) })
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.crear')) })
      .finally(() => { setSaving(null) })
  }

  const addPhase = (project: Project): void => {
    const name = window.prompt(`Nombre de la fase nueva en ${project.code}`)
    if (name === null || name.trim() === '') return
    setSaving(project.id)
    setError(null)
    createNode({ projectId: project.id, parentId: null, kind: 'phase', name: name.trim() })
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.crear')) })
      .finally(() => { setSaving(null) })
  }

  /**
   * Crear un proyecto a partir de una plantilla. Se copia todo el molde —árbol,
   * duraciones, dependencias y disciplinas— y se ancla en la fecha que se pida.
   * Lo que nunca viaja es la gente: eso se decide mirando quién tiene hueco.
   */
  const fromTemplate = (template: Project): void => {
    const name = window.prompt(`Nombre del proyecto nuevo a partir de «${template.name}»`)
    if (name === null || name.trim() === '') return
    const code = window.prompt('Código del proyecto (corto y único)', name.trim().slice(0, 12).toUpperCase())
    if (code === null || code.trim() === '') return
    const start = window.prompt('Fecha de arranque (AAAA-MM-DD)', new Date().toISOString().slice(0, 10))
    if (start === null || !/^\d{4}-\d{2}-\d{2}$/.test(start.trim())) return

    setSaving(template.id)
    setError(null)
    duplicateProject(template.id, { code: code.trim(), name: name.trim(), statusStart: start.trim() })
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.crear')) })
      .finally(() => { setSaving(null) })
  }

  const plantillas = projects.filter((project) => project.isTemplate)
  const enMarcha = projects.filter((project) => !project.isTemplate)

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      <div className="toolbar">
        <button className="button" onClick={addProject} disabled={saving !== null}>+ Proyecto</button>
        {plantillas.map((template) => (
          <button
            key={template.id}
            className="button"
            disabled={saving !== null}
            onClick={() => { fromTemplate(template) }}
            title={`Copia el molde completo de «${template.name}» en un proyecto nuevo`}
          >
            + Desde «{template.code}»
          </button>
        ))}
        <span className="faint">
          Todo lo que se añade aquí es dato declarado. Las fechas las sigue calculando el motor.
        </span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th style={{ minWidth: 300 }}>Tarea</th>
            <th title="Dato declarado: lo escribes tú">Duración ✎</th>
            <th title="Dato declarado: lo escribes tú">Avance ✎</th>
            <th title="Derivado del cálculo">Inicio 🔒</th>
            <th title="Derivado del cálculo">Fin 🔒</th>
            <th title="Derivado del cálculo">Trabajo 🔒</th>
            <th title="Derivado del cálculo">Holgura 🔒</th>
            <th>Equipo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...enMarcha, ...plantillas].map((project) => (
            <ProjectRows
              key={project.id}
              project={project}
              rows={(byProject.get(project.id) ?? []).filter((task) => !isHidden(task))}
              collapsed={collapsed}
              onToggle={toggle}
              onExplain={onExplain}
              onEdit={onEdit}
              onEditProject={onEditProject}
              onAddPhase={addPhase}
              onSave={save}
              saving={saving}
              tagOf={tagOf}
            />
          ))}
        </tbody>
      </table>
    </>
  )
}

interface ProjectRowsProps {
  readonly project: Project
  readonly rows: readonly TaskRow[]
  readonly collapsed: ReadonlySet<string>
  readonly onToggle: (nodeId: string) => void
  readonly onExplain: (task: TaskRow) => void
  readonly onEdit: (task: TaskRow) => void
  readonly onEditProject: (project: Project) => void
  readonly onAddPhase: (project: Project) => void
  readonly onSave: (task: TaskRow, changes: Readonly<Record<string, number | string | null>>) => void
  readonly saving: string | null
  readonly tagOf: ReadonlyMap<string, string>
}

function ProjectRows({
  project,
  rows,
  collapsed,
  onToggle,
  onExplain,
  onEdit,
  onEditProject,
  onAddPhase,
  onSave,
  saving,
  tagOf,
}: ProjectRowsProps): React.JSX.Element {
  return (
    <>
      <tr
        className={
          project.isTemplate || project.status !== 'activo' ? 'row--total row--template' : 'row--total'
        }
      >
        <td colSpan={8}>
          {project.code} · {project.name}
          {project.isTemplate ? (
            <span className="wbs__kind" style={{ marginLeft: 10 }} title="Un molde: no se calcula ni genera carga">
              plantilla
            </span>
          ) : null}
          {/* Sin esto, un proyecto fuera del cálculo se ve como un proyecto
              vacío y nadie sabe por qué no tiene fechas. */}
          {project.status === 'activo' ? null : (
            <span
              className="wbs__kind"
              style={{ marginLeft: 10 }}
              title={
                project.status === 'archivado'
                  ? 'Archivado: se guarda por su historia y no entra en el cálculo'
                  : 'En pausa: se guarda entero y no entra en el cálculo'
              }
            >
              {project.status}
            </span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button
            className="button"
            onClick={() => { onAddPhase(project) }}
            title="Añadir una fase a este proyecto"
          >
            + Fase
          </button>{' '}
          <button
            className="button"
            onClick={() => { onEditProject(project) }}
            title="Fecha de referencia, prioridad, nombre y baja"
          >
            ✎
          </button>
        </td>
      </tr>
      {rows.map((task) => {
        const isContainer = task.kind === 'phase' || task.kind === 'work_package'
        const isBusy = saving === task.nodeId
        return (
          <tr key={task.nodeId} style={isBusy ? { opacity: 0.55 } : undefined}>
            <td>
              <span className="wbs__name" style={{ paddingLeft: task.parentId === null ? 0 : 18 }}>
                {isContainer ? (
                  <button
                    className="disclosure"
                    onClick={() => { onToggle(task.nodeId) }}
                    aria-expanded={!collapsed.has(task.nodeId)}
                    aria-label="Plegar"
                  >
                    {collapsed.has(task.nodeId) ? '▸' : '▾'}
                  </button>
                ) : null}
                <span className={task.isCritical === true && !isContainer ? 'critical' : ''}>{task.name}</span>
                {task.kind === 'milestone' ? <span className="wbs__kind">hito</span> : null}
                {tagOf.get(task.nodeId) === undefined ? null : <span className="tag">{tagOf.get(task.nodeId)}</span>}
                {task.deadline === null ? null : (
                  <span className="wbs__kind" title="Fecha objetivo: no mueve la tarea, sólo avisa">
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

            <td>
              {isContainer || task.kind === 'milestone' ? (
                <span className="faint">—</span>
              ) : (
                <NumberCell
                  value={(task.declaredDurationMinutes ?? 0) / 480}
                  suffix="d"
                  step={0.5}
                  disabled={isBusy}
                  onCommit={(value) => { onSave(task, { durationMinutes: Math.round(value * 480) }) }}
                />
              )}
            </td>

            <td>
              {isContainer ? (
                <span className="cell--derived">{percent(task.percentCompleteBp)}</span>
              ) : (
                <NumberCell
                  value={(task.declaredPercentCompleteBp ?? 0) / 100}
                  suffix="%"
                  step={5}
                  disabled={isBusy}
                  onCommit={(value) => {
                    onSave(task, { percentCompleteBp: Math.max(0, Math.min(10_000, Math.round(value * 100))) })
                  }}
                />
              )}
            </td>

            <td className="cell--derived">{fullDate(task.scheduledStart)}</td>
            <td className="cell--derived">{fullDate(task.scheduledFinish)}</td>
            <td className="cell--derived">
              {task.workMinutes === null || task.workMinutes === 0 ? '—' : `${hours(task.workMinutes)} h`}
            </td>
            <td className={`cell--derived ${task.isCritical === true && !isContainer ? 'critical' : ''}`}>
              {isContainer ? '—' : days(task.totalSlackMinutes)}
            </td>
            <td className="muted" style={{ textAlign: 'left' }}>
              {task.assignees.join(', ') || '—'}
            </td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {isContainer ? null : (
                <button className="button" onClick={() => { onExplain(task) }}>
                  ¿por qué?
                </button>
              )}{' '}
              <button
                className="button"
                onClick={() => { onEdit(task) }}
                title="Equipo, dependencias, nombre y baja"
              >
                ✎
              </button>
            </td>
          </tr>
        )
      })}
    </>
  )
}

interface NumberCellProps {
  readonly value: number
  readonly suffix: string
  readonly step: number
  readonly disabled: boolean
  readonly onCommit: (value: number) => void
}

/** Celda declarada: se edita, y al confirmar dispara el recálculo del plan. */
function NumberCell({ value, suffix, step, disabled, onCommit }: NumberCellProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value).replace('.', ',')

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(parsed) || parsed === value) return
    onCommit(parsed)
  }

  return (
    <span className="editable">
      <input
        className="editable__input"
        value={shown}
        inputMode="decimal"
        step={step}
        disabled={disabled}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(null)
        }}
        aria-label={`Valor declarado en ${suffix}`}
      />
      <span className="editable__suffix">{suffix}</span>
    </span>
  )
}
