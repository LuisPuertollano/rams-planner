import { useEffect, useState } from 'react'
import {
  assign,
  fetchSkills,
  setNodeSkill,
  createNode,
  fetchStructure,
  link,
  removeNode,
  renameNode,
  unassign,
  unlink,
  type PlanStructure,
  type Resource,
  type SkillMatrix,
  type TaskRow,
} from '../api.js'
import { percent } from '../format.js'

interface Props {
  readonly task: TaskRow
  readonly tasks: readonly TaskRow[]
  readonly resources: readonly Resource[]
  readonly onClose: () => void
  /** Se llama tras cada escritura: el servidor ya ha recalculado. */
  readonly onChanged: () => void
}

const LINK_KINDS: readonly { value: string; label: string }[] = [
  { value: 'FS', label: 'fin → inicio' },
  { value: 'SS', label: 'inicio → inicio' },
  { value: 'FF', label: 'fin → fin' },
  { value: 'SF', label: 'inicio → fin' },
]

const isContainer = (task: TaskRow): boolean => task.kind === 'phase' || task.kind === 'work_package'

/**
 * El panel de edición de una rama del plan.
 *
 * Todo lo que hay aquí es declarado: el nombre, quién trabaja en la tarea y con
 * qué dedicación, de qué depende, y qué cuelga de ella. Ni una sola fecha: las
 * fechas las calcula el motor y se miran en la tabla, no se escriben.
 */
export function EditPanel({ task, tasks, resources, onClose, onChanged }: Props): React.JSX.Element {
  const [structure, setStructure] = useState<PlanStructure | null>(null)
  const [skills, setSkills] = useState<SkillMatrix | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(task.name)

  const reload = async (): Promise<void> => {
    const [siguiente, matriz] = await Promise.all([fetchStructure(), fetchSkills()])
    setStructure(siguiente)
    setSkills(matriz)
  }

  useEffect(() => {
    setName(task.name)
    reload().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la estructura')
    })
  }, [task.nodeId, task.name])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const run = (action: () => Promise<void>, close = false): void => {
    setBusy(true)
    setError(null)
    action()
      .then(reload)
      .then(() => { onChanged(); if (close) onClose() })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo guardar') })
      .finally(() => { setBusy(false) })
  }

  const nameOfNode = new Map(tasks.map((row) => [row.nodeId, row.name]))
  const nameOfResource = new Map(resources.map((row) => [row.id, row.displayName]))

  const myAssignments = (structure?.assignments ?? []).filter((row) => row.nodeId === task.nodeId)
  const myPredecessors = (structure?.dependencies ?? []).filter((row) => row.successorNodeId === task.nodeId)
  const free = resources.filter((row) => !myAssignments.some((item) => item.resourceId === row.id))
  // Una tarea no puede depender de sí misma ni de quien ya es su predecesora.
  const linkable = tasks.filter(
    (row) =>
      row.nodeId !== task.nodeId &&
      !isContainer(row) &&
      !myPredecessors.some((item) => item.predecessorNodeId === row.nodeId),
  )

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="why" role="dialog" aria-label={`Editar: ${task.name}`}>
        <div className="why__head">
          <div>
            <h2>Editar</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {task.path} · {isContainer(task) ? 'contenedor' : task.kind === 'milestone' ? 'hito' : 'tarea'}
            </p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Cerrar</button>
        </div>

        <div className="why__body">
          {error === null ? null : <div className="error-banner">{error}</div>}

          <label className="field">
            <span>Nombre</span>
            <input
              className="input"
              value={name}
              disabled={busy}
              onChange={(event) => { setName(event.target.value) }}
              onBlur={() => {
                if (name.trim() !== '' && name !== task.name) {
                  run(async () => { await renameNode(task.nodeId, name.trim()) })
                }
              }}
            />
          </label>

          {isContainer(task) ? (
            <div className="card">
              <h3 className="card__title">Colgar trabajo aquí</h3>
              <p className="card__note">
                Se añade al final. La duración por defecto de una tarea nueva es un día; se ajusta en la tabla.
              </p>
              <div className="inline-form" style={{ marginTop: 8 }}>
                <AddChild
                  busy={busy}
                  onAdd={(kind, childName) => {
                    run(async () => {
                      await createNode({
                        projectId: task.projectId,
                        parentId: task.nodeId,
                        kind,
                        name: childName,
                        ...(kind === 'task' ? { durationMinutes: 480 } : {}),
                      })
                    })
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="card__head">
                  <h3 className="card__title">Equipo de la tarea</h3>
                </div>
                <p className="card__note">
                  La dedicación es el porcentaje de la jornada de esa persona que va a esta tarea. De aquí sale
                  la carga.
                </p>
                {myAssignments.length === 0 ? (
                  <p className="faint" style={{ margin: '8px 0 0' }}>
                    Sin nadie asignado: esta tarea ocupa tiempo en el calendario pero no consume capacidad.
                  </p>
                ) : (
                  <table className="grid grid--inline">
                    <thead><tr><th>Persona</th><th>Dedicación</th><th /></tr></thead>
                    <tbody>
                      {myAssignments.map((row) => (
                        <tr key={row.id}>
                          <td>{nameOfResource.get(row.resourceId) ?? row.resourceId.slice(0, 8)}</td>
                          <td>{percent(row.unitsBp)}</td>
                          <td>
                            <button
                              className="button"
                              disabled={busy}
                              title="Quitar de la tarea"
                              onClick={() => { run(async () => { await unassign(row.id) }) }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {structure === null || free.length === 0 ? null : (
                  <AddAssignment
                    resources={free}
                    busy={busy}
                    onAdd={(resourceId, unitsBp) => {
                      run(async () => { await assign(task.nodeId, resourceId, unitsBp) })
                    }}
                  />
                )}
              </div>

              <div className="card">
                <h3 className="card__title">Competencias que pide</h3>
                <p className="card__note">
                  El motor avisa cuando alguien está en esta tarea sin la competencia, o con ella por debajo del
                  nivel. No impide nada: quién es capaz de qué lo decides tú, no la herramienta.
                </p>
                {skills === null ? null : (
                  <table className="grid grid--inline">
                    <thead><tr><th>Competencia</th><th>Nivel mínimo</th></tr></thead>
                    <tbody>
                      {skills.skills.map((skill) => {
                        const actual =
                          skills.requirements.find(
                            (item) => item.nodeId === task.nodeId && item.skillId === skill.id,
                          )?.minLevel ?? 0
                        return (
                          <tr key={skill.id}>
                            <td title={skill.name}>{skill.code}</td>
                            <td>
                              <select
                                className="level"
                                value={actual}
                                disabled={busy}
                                data-level={actual}
                                onChange={(event) => {
                                  const siguiente = Number(event.target.value)
                                  run(async () => { await setNodeSkill(task.nodeId, skill.id, siguiente) })
                                }}
                              >
                                <option value={0}>no la pide</option>
                                {[1, 2, 3, 4, 5].map((level) => (
                                  <option key={level} value={level}>{level}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                <h3 className="card__title">Depende de</h3>
                <p className="card__note">
                  Las predecesoras mandan sobre las fechas. El desfase se cuenta en días laborables de la tarea
                  que espera, y puede ser negativo para adelantar.
                </p>
                {myPredecessors.length === 0 ? (
                  <p className="faint" style={{ margin: '8px 0 0' }}>
                    Sin predecesoras: arranca con el proyecto o con su restricción.
                  </p>
                ) : (
                  <table className="grid grid--inline">
                    <thead><tr><th>Predecesora</th><th>Enlace</th><th>Desfase</th><th /></tr></thead>
                    <tbody>
                      {myPredecessors.map((row) => (
                        <tr key={row.id}>
                          <td>{nameOfNode.get(row.predecessorNodeId) ?? '—'}</td>
                          <td>{LINK_KINDS.find((item) => item.value === row.kind)?.label ?? row.kind}</td>
                          <td>{row.lagMinutes === 0 ? '—' : `${String(Math.round(row.lagMinutes / 480))} d`}</td>
                          <td>
                            <button
                              className="button"
                              disabled={busy}
                              title="Quitar la dependencia"
                              onClick={() => { run(async () => { await unlink(row.id) }) }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {structure === null || linkable.length === 0 ? null : (
                  <AddDependency
                    options={linkable}
                    busy={busy}
                    onAdd={(predecessorId, kind, lagDays) => {
                      run(async () => { await link(predecessorId, task.nodeId, kind, Math.round(lagDays * 480)) })
                    }}
                  />
                )}
              </div>
            </>
          )}

          <div className="card">
            <h3 className="card__title">Quitar del plan</h3>
            <p className="card__note">
              Se da de baja esto y todo lo que cuelgue. No se borra nada: los cálculos ya hechos se siguen
              explicando igual.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`¿Quitar «${task.name}» del plan, con todo lo que cuelgue?`)) {
                  run(async () => { await removeNode(task.nodeId) }, true)
                }
              }}
            >
              Quitar del plan
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

function AddChild({
  busy,
  onAdd,
}: {
  readonly busy: boolean
  readonly onAdd: (kind: 'phase' | 'task' | 'milestone', name: string) => void
}): React.JSX.Element {
  const [kind, setKind] = useState<'phase' | 'task' | 'milestone'>('task')
  const [name, setName] = useState('')

  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() === '') return
        onAdd(kind, name.trim())
        setName('')
      }}
    >
      <label className="field"><span>Qué</span>
        <select
          className="input"
          value={kind}
          onChange={(event) => { setKind(event.target.value as 'phase' | 'task' | 'milestone') }}
        >
          <option value="task">Tarea</option>
          <option value="milestone">Hito</option>
          <option value="phase">Fase</option>
        </select>
      </label>
      <label className="field" style={{ flex: '2 1 200px' }}><span>Nombre</span>
        <input className="input" value={name} onChange={(event) => { setName(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Añadir</button>
    </form>
  )
}

function AddAssignment({
  resources,
  busy,
  onAdd,
}: {
  readonly resources: readonly Resource[]
  readonly busy: boolean
  readonly onAdd: (resourceId: string, unitsBp: number) => void
}): React.JSX.Element {
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '')
  const [units, setUnits] = useState('100')

  // La lista de personas asignables cambia cuando se asigna o se quita a
  // alguien. Si la elección guardada ya no está en la lista, el desplegable
  // enseña la primera opción pero el estado sigue apuntando a la anterior: se
  // asignaría a quien no es. Se resuelve usando siempre una elección válida.
  const selected = resources.some((resource) => resource.id === resourceId) ? resourceId : (resources[0]?.id ?? '')

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = Math.round(Number(units.replace(',', '.')) * 100)
        if (selected === '' || !Number.isFinite(parsed) || parsed < 0) return
        onAdd(selected, parsed)
      }}
    >
      <label className="field" style={{ flex: '2 1 180px' }}><span>Añadir a</span>
        <select className="input" value={selected} onChange={(event) => { setResourceId(event.target.value) }}>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.displayName}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>Dedicación %</span>
        <input className="input" inputMode="decimal" value={units} onChange={(event) => { setUnits(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Asignar</button>
    </form>
  )
}

function AddDependency({
  options,
  busy,
  onAdd,
}: {
  readonly options: readonly TaskRow[]
  readonly busy: boolean
  readonly onAdd: (predecessorId: string, kind: string, lagDays: number) => void
}): React.JSX.Element {
  const [predecessorId, setPredecessorId] = useState(options[0]?.nodeId ?? '')
  const [kind, setKind] = useState('FS')
  const [lag, setLag] = useState('0')

  // Mismo cuidado que en las asignaciones: la lista se encoge al enlazar.
  const selected = options.some((option) => option.nodeId === predecessorId)
    ? predecessorId
    : (options[0]?.nodeId ?? '')

  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = Number(lag.replace(',', '.'))
        if (selected === '' || !Number.isFinite(parsed)) return
        onAdd(selected, kind, parsed)
      }}
    >
      <label className="field" style={{ flex: '2 1 200px' }}><span>Predecesora</span>
        <select className="input" value={selected} onChange={(event) => { setPredecessorId(event.target.value) }}>
          {options.map((option) => (
            <option key={option.nodeId} value={option.nodeId}>{option.name}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>Enlace</span>
        <select className="input" value={kind} onChange={(event) => { setKind(event.target.value) }}>
          {LINK_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="field"><span>Desfase (d)</span>
        <input className="input" inputMode="decimal" value={lag} onChange={(event) => { setLag(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>Enlazar</button>
    </form>
  )
}
