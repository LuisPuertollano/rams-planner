import { useEffect, useState } from 'react'
import {
  assign,
  fetchSkills,
  setNodeSkill,
  createNode,
  fetchDocuments,
  fetchStructure,
  link,
  removeNode,
  renameNode,
  unassign,
  unlink,
  setNodeDocument,
  type DocumentCatalogue,
  type PlanStructure,
  type Resource,
  type SkillMatrix,
  type TaskRow,
} from '../api.js'
import { percent } from '../format.js'
import { errorText } from '../errors.js'
import { existeClave, useT, type Traductor } from '../i18n/index.js'
import { EntityHistory } from './EntityHistory.js'

interface Props {
  readonly task: TaskRow
  readonly tasks: readonly TaskRow[]
  readonly resources: readonly Resource[]
  readonly onClose: () => void
  /** Se llama tras cada escritura: el servidor ya ha recalculado. */
  readonly onChanged: () => void
}

const LINK_KINDS = ['FS', 'SS', 'FF', 'SF'] as const

/** Cómo se lee un tipo de enlace. El código es el contrato; la frase, no. */
function nombreDelEnlace(t: Traductor['t'], kind: string): string {
  const clave = `enlace.${kind}`
  return existeClave(clave) ? t(clave) : kind
}

const isContainer = (task: TaskRow): boolean => task.kind === 'phase' || task.kind === 'work_package'

/**
 * El panel de edición de una rama del plan.
 *
 * Todo lo que hay aquí es declarado: el nombre, quién trabaja en la tarea y con
 * qué dedicación, de qué depende, y qué cuelga de ella. Ni una sola fecha: las
 * fechas las calcula el motor y se miran en la tabla, no se escriben.
 */
export function EditPanel({ task, tasks, resources, onClose, onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [structure, setStructure] = useState<PlanStructure | null>(null)
  const [skills, setSkills] = useState<SkillMatrix | null>(null)
  // El catálogo de documentos, para poder marcar cuál entrega esta tarea. Si
  // no llega —porque falta el permiso— la tarjeta no se enseña.
  const [documentos, setDocumentos] = useState<DocumentCatalogue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(task.name)

  const reload = async (): Promise<void> => {
    const [siguiente, matriz, catalogo] = await Promise.all([
      fetchStructure(),
      fetchSkills(),
      fetchDocuments().catch(() => null),
    ])
    setDocumentos(catalogo)
    setStructure(siguiente)
    setSkills(matriz)
  }

  useEffect(() => {
    setName(task.name)
    reload().catch((cause: unknown) => {
      setError(errorText(t, cause, 'error.local.estructura'))
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
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.guardar')) })
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
      <button className="backdrop" onClick={onClose} aria-label={t('boton.cerrar')} />
      <aside className="why" role="dialog" aria-label={t('editar.titulo', task.name)}>
        <div className="why__head">
          <div>
            <h2>{t('editar.editar')}</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {task.path} ·{' '}
              {isContainer(task)
                ? t('editar.contenedor')
                : task.kind === 'milestone'
                  ? t('editar.hito')
                  : t('editar.tarea')}
            </p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
            {t('boton.cerrar')}
          </button>
        </div>

        <div className="why__body">
          {error === null ? null : <div className="error-banner">{error}</div>}

          <label className="field">
            <span>{t('col.nombre')}</span>
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
              <h3 className="card__title">{t('editar.colgar')}</h3>
              <p className="card__note">{t('editar.colgarNota')}</p>
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
                  <h3 className="card__title">{t('editar.equipo')}</h3>
                </div>
                <p className="card__note">{t('editar.equipoNota')}</p>
                {myAssignments.length === 0 ? (
                  <p className="faint" style={{ margin: '8px 0 0' }}>{t('editar.sinEquipo')}</p>
                ) : (
                  <table className="grid grid--inline">
                    <thead>
                      <tr><th>{t('col.persona')}</th><th>{t('col.dedicacion')}</th><th /></tr>
                    </thead>
                    <tbody>
                      {myAssignments.map((row) => (
                        <tr key={row.id}>
                          <td>{nameOfResource.get(row.resourceId) ?? row.resourceId.slice(0, 8)}</td>
                          <td>{percent(row.unitsBp)}</td>
                          <td>
                            <button
                              className="button"
                              disabled={busy}
                              title={t('editar.quitarPersona')}
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
                <h3 className="card__title">{t('editar.documentos')}</h3>
                <p className="card__note">{t('editar.documentosNota')}</p>
                {documentos === null ? null : documentos.types.length === 0 ? (
                  <p className="faint" style={{ margin: '8px 0 0' }}>
                    {t('editar.sinDocumentos', t('tab.documentos'))}
                  </p>
                ) : (
                  <table className="grid grid--inline">
                    <thead>
                      <tr><th>{t('col.documento')}</th><th>{t('editar.loEntrega')}</th></tr>
                    </thead>
                    <tbody>
                      {documentos.types.map((tipo) => {
                        const entrega = (structure?.documents ?? []).some(
                          (item) => item.nodeId === task.nodeId && item.documentTypeId === tipo.id,
                        )
                        return (
                          <tr key={tipo.id}>
                            <td title={tipo.description ?? tipo.name}>{tipo.name}</td>
                            <td>
                              <input
                                type="checkbox"
                                checked={entrega}
                                disabled={busy}
                                aria-label={t('editar.entregaAria', tipo.name)}
                                onChange={() => {
                                  run(async () => { await setNodeDocument(task.nodeId, tipo.id, !entrega) })
                                }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                <h3 className="card__title">{t('editar.competencias')}</h3>
                <p className="card__note">{t('editar.competenciasNota')}</p>
                {skills === null ? null : (
                  <table className="grid grid--inline">
                    <thead>
                      <tr><th>{t('col.competencia')}</th><th>{t('editar.nivelMinimo')}</th></tr>
                    </thead>
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
                                <option value={0}>{t('editar.noLaPide')}</option>
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
                <h3 className="card__title">{t('editar.dependeDe')}</h3>
                <p className="card__note">{t('editar.dependeDeNota')}</p>
                {myPredecessors.length === 0 ? (
                  <p className="faint" style={{ margin: '8px 0 0' }}>{t('editar.sinPredecesoras')}</p>
                ) : (
                  <table className="grid grid--inline">
                    <thead>
                      <tr>
                        <th>{t('col.predecesora')}</th>
                        <th>{t('col.enlace')}</th>
                        <th>{t('col.desfase')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {myPredecessors.map((row) => (
                        <tr key={row.id}>
                          <td>{nameOfNode.get(row.predecessorNodeId) ?? '—'}</td>
                          <td>{nombreDelEnlace(t, row.kind)}</td>
                          <td>{row.lagMinutes === 0 ? '—' : `${String(Math.round(row.lagMinutes / 480))} d`}</td>
                          <td>
                            <button
                              className="button"
                              disabled={busy}
                              title={t('editar.quitarDependencia')}
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

          <EntityHistory entityId={task.nodeId} />

          <div className="card">
            <h3 className="card__title">{t('editar.quitar')}</h3>
            <p className="card__note">{t('editar.quitarNota')}</p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('editar.quitarConfirma', task.name))) {
                  run(async () => { await removeNode(task.nodeId) }, true)
                }
              }}
            >
              {t('editar.quitar')}
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
  const { t } = useT()
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
      <label className="field"><span>{t('editar.que')}</span>
        <select
          className="input"
          value={kind}
          onChange={(event) => { setKind(event.target.value as 'phase' | 'task' | 'milestone') }}
        >
          <option value="task">{t('editar.clase.task')}</option>
          <option value="milestone">{t('editar.clase.milestone')}</option>
          <option value="phase">{t('editar.clase.phase')}</option>
        </select>
      </label>
      <label className="field" style={{ flex: '2 1 200px' }}><span>{t('col.nombre')}</span>
        <input className="input" value={name} onChange={(event) => { setName(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>
        {t('editar.anadir')}
      </button>
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
  const { t } = useT()
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
      <label className="field" style={{ flex: '2 1 180px' }}><span>{t('editar.anadirA')}</span>
        <select className="input" value={selected} onChange={(event) => { setResourceId(event.target.value) }}>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.displayName}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>{t('editar.dedicacionPorciento')}</span>
        <input className="input" inputMode="decimal" value={units} onChange={(event) => { setUnits(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>
        {t('editar.asignar')}
      </button>
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
  const { t } = useT()
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
      <label className="field" style={{ flex: '2 1 200px' }}><span>{t('col.predecesora')}</span>
        <select className="input" value={selected} onChange={(event) => { setPredecessorId(event.target.value) }}>
          {options.map((option) => (
            <option key={option.nodeId} value={option.nodeId}>{option.name}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>{t('col.enlace')}</span>
        <select className="input" value={kind} onChange={(event) => { setKind(event.target.value) }}>
          {LINK_KINDS.map((item) => (
            <option key={item} value={item}>{nombreDelEnlace(t, item)}</option>
          ))}
        </select>
      </label>
      <label className="field"><span>{t('editar.desfaseDias')}</span>
        <input className="input" inputMode="decimal" value={lag} onChange={(event) => { setLag(event.target.value) }} required />
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>
        {t('editar.enlazar')}
      </button>
    </form>
  )
}
