import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchRunData,
  fetchState,
  freezeBaseline,
  recalculate,
  type AppState,
  type RunData,
  type TaskRow,
} from './api.js'
import { hours, percent } from './format.js'
import { activePeriods } from './periods.js'
import { ImportButton } from './components/ImportButton.js'
import { WhyPanel } from './components/WhyPanel.js'
import { DiffView } from './views/DiffView.js'
import { FindingsView } from './views/FindingsView.js'
import { GanttView } from './views/GanttView.js'
import { HeatmapView } from './views/HeatmapView.js'
import { MatrixView } from './views/MatrixView.js'
import { PlanView } from './views/PlanView.js'
import { ResourcesView } from './views/ResourcesView.js'

type Tab = 'matriz' | 'saturacion' | 'plan' | 'cronograma' | 'equipo' | 'hallazgos' | 'comparar'

const TABS: readonly { id: Tab; label: string; hint: string }[] = [
  { id: 'matriz', label: 'Carga', hint: 'Cuántas horas tiene comprometida cada persona, cada mes, en cada proyecto' },
  { id: 'saturacion', label: 'Saturación', hint: 'Quién se pasa de capacidad, cuándo y por cuánto' },
  { id: 'plan', label: 'Plan', hint: 'El árbol de trabajo con sus fechas calculadas' },
  { id: 'cronograma', label: 'Cronograma', hint: 'El plan en el tiempo, con el camino crítico' },
  { id: 'equipo', label: 'Equipo', hint: 'De qué está hecha la capacidad: calendario, dedicación, ausencias y tarifa de cada persona' },
  { id: 'hallazgos', label: 'Hallazgos', hint: 'Todo lo que el motor quiere decirte' },
  { id: 'comparar', label: 'Comparar', hint: 'En qué se diferencia el plan de hoy del que congelaste' },
]

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [data, setData] = useState<RunData | null>(null)
  const [tab, setTab] = useState<Tab>('matriz')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [explaining, setExplaining] = useState<TaskRow | null>(null)
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto')

  const load = useCallback(async () => {
    const next = await fetchState()
    setState(next)
    setData(next.run === null ? null : await fetchRunData(next.run.id))
  }, [])

  useEffect(() => {
    load().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Error al cargar') })
  }, [load])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('planner.theme')
      if (stored === 'light' || stored === 'dark' || stored === 'auto') setTheme(stored)
    } catch {
      // Sin almacenamiento local (ventana privada): se usa el tema del sistema.
    }
  }, [])

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem('planner.theme', theme)
    } catch {
      // Da igual: es una comodidad, no un dato del plan.
    }
  }, [theme])

  const onFreeze = (): void => {
    if (state?.run == null) return
    const name = window.prompt('Nombre de la línea base', `Plan ${new Date().toLocaleDateString('es-ES')}`)
    if (name === null || name.trim() === '') return
    setBusy(true)
    freezeBaseline(state.run.id, name.trim())
      .then(load)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo congelar') })
      .finally(() => { setBusy(false) })
  }

  const onRecalculate = (level = false): void => {
    setBusy(true)
    setError(null)
    setNotice(null)
    recalculate(level ? 'nivelación de recursos' : 'recálculo desde la interfaz', level)
      .then(async (summary) => {
        if (level) {
          setNotice(
            summary.converged === true
              ? `Nivelado: ${String(summary.leveledTasks ?? 0)} tarea(s) retrasadas para que el plan quepa en la capacidad del equipo. Compara con la ejecución anterior para ver qué ha costado.`
              : `Nivelación parcial: ${String(summary.leveledTasks ?? 0)} tarea(s) retrasadas, pero quedan sobrecargas que ningún retraso arregla. Mira los hallazgos.`,
          )
        }
        await load()
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo recalcular') })
      .finally(() => { setBusy(false) })
  }

  const totals = useMemo(() => {
    if (data === null) return null
    // La ocupación se mide sobre los meses en los que hay trabajo. Repartirla
    // sobre los cuatro años del horizonte daría un 4 % que no significa nada.
    const active = new Set(activePeriods(data.load.filter((cell) => cell.plannedMinutes > 0).map((cell) => cell.period)))
    const planned = data.load.reduce((sum, cell) => sum + cell.plannedMinutes, 0)
    const capacity = data.utilization
      .filter((cell) => active.has(cell.period))
      .reduce((sum, cell) => sum + cell.capacityMinutes, 0)
    const overallocated = new Set(
      data.findings.filter((finding) => finding.code === 'RESOURCE_OVERALLOCATED').map((finding) => finding.entityId),
    ).size
    const critical = data.tasks.filter((task) => task.isCritical === true && task.kind === 'task').length
    return { planned, capacity, overallocated, critical }
  }, [data])

  const activeTab = TABS.find((item) => item.id === tab)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>RAMS Planner</h1>
          <span>carga de trabajo, explicada hasta el último minuto</span>
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className="tab"
              onClick={() => { setTab(item.id) }}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {state?.run === null || state === null ? null : (
          <span className="run-chip" title={`Hash de entradas: ${state.run.inputHash}`}>
            ejecución <b>{state.run.id.slice(0, 8)}</b> · motor {state.run.engineVersion} ·{' '}
            {new Date(state.run.startedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
            {state.run.durationMs ?? 0} ms
          </span>
        )}

        <button
          className="button"
          onClick={() => { setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark') }}
          title="Tema: automático, claro u oscuro"
        >
          {theme === 'auto' ? '◐' : theme === 'light' ? '☀' : '☾'}
        </button>
        <ImportButton
          onImported={() => {
            load().catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : 'Error al recargar')
            })
          }}
        />
        {state?.run == null ? null : (
          <a
            className="button"
            href={`/api/runs/${state.run.id}/export.csv?bucket=month`}
            title="Descargar la carga mensual en CSV, con el runId en cada fila"
          >
            Exportar
          </a>
        )}
        <button className="button" onClick={onFreeze} disabled={busy || state?.run == null} title="Congelar el plan actual como línea base">
          Línea base
        </button>
        <button
          className="button"
          onClick={() => { onRecalculate(true) }}
          disabled={busy}
          title="Retrasar tareas hasta que el plan quepa en la capacidad del equipo. Crea una ejecución nueva; el plan original no se toca"
        >
          Nivelar
        </button>
        <button className="button button--primary" onClick={() => { onRecalculate(false) }} disabled={busy}>
          {busy ? 'Calculando…' : 'Recalcular'}
        </button>
      </header>

      <main className="content">
        {error === null ? null : <div className="error-banner">{error}</div>}
        {notice === null ? null : (
          <div className="notice">
            {notice}
            <button className="button" onClick={() => { setNotice(null) }}>
              Entendido
            </button>
          </div>
        )}

        {totals === null ? null : (
          <div className="stat-row">
            <div className="stat">
              <div className="stat__label">Trabajo planificado</div>
              <div className="stat__value">{hours(totals.planned)} h</div>
              <div className="stat__hint">sobre {hours(totals.capacity)} h de capacidad en esos meses</div>
            </div>
            <div className="stat">
              <div className="stat__label">Ocupación del equipo</div>
              <div className="stat__value">
                {percent(totals.capacity === 0 ? null : Math.round((totals.planned * 10_000) / totals.capacity))}
              </div>
              <div className="stat__hint">media de los meses con trabajo</div>
            </div>
            <div className="stat">
              <div className="stat__label">Personas sobrecargadas</div>
              <div className="stat__value">{totals.overallocated}</div>
              <div className="stat__hint">en al menos un mes</div>
            </div>
            <div className="stat">
              <div className="stat__label">Tareas críticas</div>
              <div className="stat__value">{totals.critical}</div>
              <div className="stat__hint">sin holgura: retrasarlas retrasa el plan</div>
            </div>
          </div>
        )}

        <section className="panel">
          <div className="panel__head">
            <h2>{activeTab?.label}</h2>
            <p>{activeTab?.hint}</p>
            <span className="spacer faint" style={{ fontSize: 12 }}>
              {tab === 'equipo'
                ? '✎ todo declarado · cada cambio recalcula el plan'
                : tab === 'plan'
                  ? '✎ declarado · 🔒 derivado, no editable'
                  : '🔒 columnas derivadas · no editables'}
            </span>
          </div>
          <div className={tab === 'hallazgos' ? 'panel__body panel__body--flush' : 'panel__body panel__body--flush'}>
            {tab === 'equipo' ? (
              // La ficha del equipo es dato declarado: existe aunque todavía no
              // se haya calculado nada, y de hecho es por donde hay que empezar
              // en una base de datos vacía.
              <ResourcesView
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'Error al recargar')
                  })
                }}
              />
            ) : state === null || data === null ? (
              <div className="empty">
                <h3>Cargando el plan…</h3>
                <p>Si es la primera vez, ejecuta <code>pnpm --filter @planner/api seed:demo</code>.</p>
              </div>
            ) : tab === 'matriz' ? (
              <MatrixView
                resources={state.resources}
                projects={state.projects}
                load={data.load}
                utilization={data.utilization}
                runId={state.run?.id ?? ''}
              />
            ) : tab === 'saturacion' ? (
              <HeatmapView resources={state.resources} utilization={data.utilization} />
            ) : tab === 'plan' ? (
              <PlanView
                tasks={data.tasks}
                projects={state.projects}
                fields={state.fields}
                onExplain={setExplaining}
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'Error al recargar')
                  })
                }}
              />
            ) : tab === 'cronograma' ? (
              <GanttView tasks={data.tasks} projects={state.projects} />
            ) : tab === 'comparar' ? (
              <DiffView
                baselines={state.baselines}
                currentRunId={state.run?.id ?? ''}
                projects={state.projects}
              />
            ) : (
              <FindingsView findings={data.findings} />
            )}
          </div>
        </section>
      </main>

      {explaining === null || state?.run == null ? null : (
        <WhyPanel runId={state.run.id} task={explaining} onClose={() => { setExplaining(null) }} />
      )}
    </div>
  )
}
