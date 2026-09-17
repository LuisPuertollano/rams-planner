import { useMemo, useState } from 'react'
import {
  applyMatrix,
  fetchMatrixPlan,
  type MatrixPlan,
  type Project,
  type ProposedDependency,
  type SkipReason,
} from '../api.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly projects: readonly Project[]
  /** Si esta persona puede crear dependencias. Sin eso, sólo se previsualiza. */
  readonly canApply: boolean
  /** Para que el resto de la aplicación recargue tras escribir. */
  readonly onApplied: () => void
}

const MOTIVO: Readonly<Record<SkipReason, string>> = {
  'ya-existe': 'ya está en el plan',
  'misma-tarea': 'la misma tarea entrega los dos',
  'crearia-un-ciclo': 'cerraría un ciclo',
}

/**
 * Aplicar la matriz a un proyecto.
 *
 * La matriz dice qué documento espera a cuál; las fichas de las tareas dicen
 * qué documento entrega cada una. Cruzando las dos cosas salen las
 * dependencias del proyecto sin teclear ninguna.
 *
 * Se enseña **antes** de escribir, con el motivo de cada descarte y con los
 * documentos que nadie entrega, y se puede desmarcar lo que no cuadre. Un
 * aplicador que mete veinte dependencias de golpe y las cuenta después no se
 * puede usar sobre un plan de verdad.
 */
export function ApplyMatrixPanel({ projects, canApply, onApplied }: Props): React.JSX.Element {
  const { t } = useT()
  const aplicables = useMemo(() => projects.filter((p) => !p.isTemplate), [projects])
  const [projectId, setProjectId] = useState<string>(aplicables[0]?.id ?? '')
  const [plan, setPlan] = useState<MatrixPlan | null>(null)
  const [excluidas, setExcluidas] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const nombreTarea = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const tarea of plan?.tasks ?? []) mapa.set(tarea.nodeId, `${tarea.path} ${tarea.name}`)
    return mapa
  }, [plan])

  const nombreDocumento = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const doc of plan?.documents ?? []) mapa.set(doc.id, doc.name)
    return mapa
  }, [plan])

  const clave = (dep: ProposedDependency): string => `${dep.predecessorNodeId}>${dep.successorNodeId}`

  const previsualizar = (): void => {
    if (projectId === '') return
    setBusy(true)
    setError(null)
    setHecho(null)
    fetchMatrixPlan(projectId)
      .then((resultado) => {
        setPlan(resultado)
        setExcluidas(new Set())
      })
      .catch((cause: unknown) => {
        setPlan(null)
        setError(errorText(t, cause, 'error.local.matrizProponer'))
      })
      .finally(() => { setBusy(false) })
  }

  const aplicar = (): void => {
    if (plan === null) return
    const aCrear = plan.create.filter((dep) => !excluidas.has(clave(dep)))
    if (aCrear.length === 0) return
    if (
      !window.confirm(
        `Se van a crear ${String(aCrear.length)} dependencia(s) fin-comienzo y se recalculará el plan. ` +
          'Las dependencias creadas se pueden quitar una a una después. ¿Seguir?',
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    applyMatrix(
      projectId,
      plan.create
        .filter((dep) => excluidas.has(clave(dep)))
        .map((dep) => ({ predecessorNodeId: dep.predecessorNodeId, successorNodeId: dep.successorNodeId })),
    )
      .then((resultado) => {
        setHecho(
          `${String(resultado.result.created.length)} dependencia(s) creada(s). ` +
            `Plan recalculado (ejecución ${resultado.run.runId.slice(0, 8)}).`,
        )
        setPlan(null)
        onApplied()
      })
      .catch((cause: unknown) => {
        setError(errorText(t, cause, 'error.local.matrizAplicar'))
      })
      .finally(() => { setBusy(false) })
  }

  const seleccionadas = plan === null ? 0 : plan.create.filter((d) => !excluidas.has(clave(d))).length

  return (
    <section style={{ padding: '0 16px 24px' }}>
      <h3 style={{ marginBottom: 4 }}>Aplicar la matriz a un proyecto</h3>
      <p className="faint" style={{ maxWidth: '96ch', marginTop: 0 }}>
        Cruza esta matriz con lo que entrega cada tarea del proyecto y propone las dependencias que faltan.
        No escribe nada hasta que lo apruebas, y lo que no cuadre se puede desmarcar.
      </p>

      <div className="toolbar">
        <select
          className="input"
          value={projectId}
          disabled={busy}
          onChange={(event) => {
            setProjectId(event.target.value)
            setPlan(null)
            setHecho(null)
          }}
        >
          {aplicables.length === 0 ? <option value="">No hay proyectos</option> : null}
          {aplicables.map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>
              {proyecto.code} · {proyecto.name}
            </option>
          ))}
        </select>
        <button className="button" disabled={busy || projectId === ''} onClick={previsualizar}>
          Previsualizar
        </button>
        {plan === null || !canApply ? null : (
          <button
            className="button button--primary"
            disabled={busy || seleccionadas === 0}
            onClick={aplicar}
          >
            Crear {String(seleccionadas)} dependencia(s)
          </button>
        )}
      </div>

      {error === null ? null : <div className="error-banner">{error}</div>}
      {hecho === null ? null : <div className="ok-banner">{hecho}</div>}

      {plan === null ? null : (
        <>
          {plan.create.length === 0 && plan.skipped.length === 0 ? (
            <p className="faint">
              La matriz no exige nada aquí: o ninguna tarea de este proyecto declara qué documento entrega,
              o todavía no hay cruces marcadas arriba.
            </p>
          ) : null}

          {plan.missingDocuments.length === 0 ? null : (
            <div className="warn-banner">
              La matriz nombra {String(plan.missingDocuments.length)} documento(s) que ninguna tarea de este
              proyecto entrega:{' '}
              <b>
                {plan.missingDocuments
                  .map((id) => nombreDocumento.get(id) ?? id.slice(0, 8))
                  .join(', ')}
              </b>
              . No es un error, pero la propuesta está incompleta mientras siga así.
            </div>
          )}

          {plan.create.length === 0 ? null : (
            <table className="grid grid--texto">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Esta tarea…</th>
                  <th>…precede a esta otra</th>
                  <th>Porque la matriz dice</th>
                </tr>
              </thead>
              <tbody>
                {plan.create.map((dep) => {
                  const id = clave(dep)
                  return (
                    <tr key={`${id}|${dep.documentPredecessorId}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!excluidas.has(id)}
                          disabled={busy || !canApply}
                          aria-label="Crear esta dependencia"
                          onChange={() => {
                            const siguiente = new Set(excluidas)
                            if (siguiente.has(id)) siguiente.delete(id)
                            else siguiente.add(id)
                            setExcluidas(siguiente)
                          }}
                        />
                      </td>
                      <td>{nombreTarea.get(dep.predecessorNodeId) ?? dep.predecessorNodeId}</td>
                      <td>{nombreTarea.get(dep.successorNodeId) ?? dep.successorNodeId}</td>
                      <td className="faint">
                        {nombreDocumento.get(dep.documentPredecessorId) ?? '?'} ▸{' '}
                        {nombreDocumento.get(dep.documentSuccessorId) ?? '?'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {plan.skipped.length === 0 ? null : (
            <details style={{ marginTop: 12 }}>
              <summary className="faint">
                {String(plan.skipped.length)} que la matriz exige y no se van a crear
              </summary>
              <table className="grid grid--texto" style={{ marginTop: 8 }}>
                <tbody>
                  {plan.skipped.map((dep, indice) => (
                    <tr key={`${clave(dep)}|${dep.documentPredecessorId}|${String(indice)}`}>
                      <td>{nombreTarea.get(dep.predecessorNodeId) ?? dep.predecessorNodeId}</td>
                      <td>{nombreTarea.get(dep.successorNodeId) ?? dep.successorNodeId}</td>
                      <td className={dep.reason === 'crearia-un-ciclo' ? 'sensible' : 'faint'}>
                        {MOTIVO[dep.reason]}
                        {dep.path === undefined
                          ? null
                          : `: ${dep.path.map((n) => nombreTarea.get(n) ?? n.slice(0, 8)).join(' ▸ ')}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  )
}
