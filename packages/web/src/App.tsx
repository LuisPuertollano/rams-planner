import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from './api.js'
import {
  can,
  fetchMe,
  fetchRunData,
  fetchState,
  freezeBaseline,
  recalculate,
  signOut,
  type AppState,
  type MeResponse,
  type RunData,
  type TaskRow,
} from './api.js'
import { hours, percent } from './format.js'
import { activePeriods } from './periods.js'
import { EditPanel } from './components/EditPanel.js'
import { ImportButton } from './components/ImportButton.js'
import { ProjectPanel } from './components/ProjectPanel.js'
import { WhyPanel } from './components/WhyPanel.js'
import { AdminView } from './views/AdminView.js'
import { CalendarView } from './views/CalendarView.js'
import { LoginView } from './views/LoginView.js'
import { DiffView } from './views/DiffView.js'
import { FindingsView } from './views/FindingsView.js'
import { GanttView } from './views/GanttView.js'
import { HeatmapView } from './views/HeatmapView.js'
import { MatrixView } from './views/MatrixView.js'
import { PlanView } from './views/PlanView.js'
import { RebalanceView } from './views/RebalanceView.js'
import { SkillsView } from './views/SkillsView.js'
import { ResourcesView } from './views/ResourcesView.js'

type Tab =
  | 'matriz' | 'saturacion' | 'plan' | 'cronograma'
  | 'equipo' | 'competencias' | 'calendario' | 'reparto' | 'hallazgos' | 'comparar'
  | 'admin'

/**
 * Cada pestaña declara con qué permiso se entra. Si alguien no tiene ninguno de
 * ellos, la pestaña no se enseña — pero eso es cortesía, no seguridad: quien
 * escriba la URL a mano se encuentra con un 403 del servidor igualmente.
 */
const TABS: readonly { id: Tab; label: string; hint: string; permission: readonly string[] }[] = [
  { id: 'matriz', label: 'Carga', hint: 'Cuántas horas tiene comprometida cada persona, cada mes, en cada proyecto', permission: ['carga.ver'] },
  { id: 'saturacion', label: 'Saturación', hint: 'Quién se pasa de capacidad, cuándo y por cuánto', permission: ['carga.ver'] },
  { id: 'plan', label: 'Plan', hint: 'El árbol de trabajo con sus fechas calculadas', permission: ['plan.ver'] },
  { id: 'cronograma', label: 'Cronograma', hint: 'El plan en el tiempo, con el camino crítico', permission: ['plan.ver'] },
  { id: 'equipo', label: 'Equipo', hint: 'De qué está hecha la capacidad: calendario, dedicación, ausencias y tarifa de cada persona', permission: ['equipo.ver'] },
  { id: 'calendario', label: 'Calendario', hint: 'Quién está fuera, cuándo, y qué capacidad le queda al equipo cada día', permission: ['equipo.ver'] },
  { id: 'competencias', label: 'Competencias', hint: 'Quién sabe hacer qué, y dónde el equipo tiene un único especialista', permission: ['competencias.ver'] },
  { id: 'reparto', label: 'Reparto', hint: 'Qué trabajo se podría mover, a quién, y qué arreglaría. Propuestas, no decisiones', permission: ['reparto.ver'] },
  { id: 'hallazgos', label: 'Hallazgos', hint: 'Todo lo que el motor quiere decirte', permission: ['carga.ver', 'plan.ver'] },
  { id: 'comparar', label: 'Comparar', hint: 'En qué se diferencia el plan de hoy del que congelaste', permission: ['ejecuciones.ver'] },
  { id: 'admin', label: 'Administración', hint: 'Quién entra, qué rol tiene y qué deja hacer cada rol', permission: ['roles.gestionar', 'usuarios.gestionar'] },
]

export function App(): React.JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [state, setState] = useState<AppState | null>(null)
  const [data, setData] = useState<RunData | null>(null)
  const [tab, setTab] = useState<Tab>('matriz')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [explaining, setExplaining] = useState<TaskRow | null>(null)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto')

  const load = useCallback(async () => {
    const next = await fetchState()
    setState(next)
    setData(next.run === null ? null : await fetchRunData(next.run.id))
  }, [])

  // Primero quién eres; lo demás depende de eso. Pedir el plan sin sesión sólo
  // produciría un 401 y un banner rojo en la cara de quien todavía no ha entrado.
  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Error al cargar') })
  }, [])

  const entrado = me !== null && (me.user !== null || me.openInstallation)

  useEffect(() => {
    if (!entrado) return
    load().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Error al cargar') })
  }, [entrado, load])

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

  const visibleTabs = useMemo(
    () => TABS.filter((item) => item.permission.some((code) => can(me?.permissions ?? null, code))),
    [me],
  )

  // Si el rol de quien mira no llega a la pestaña elegida (o a la de inicio),
  // se cae a la primera que sí pueda ver en vez de dejar el panel en blanco.
  useEffect(() => {
    if (visibleTabs.length === 0) return
    if (!visibleTabs.some((item) => item.id === tab)) setTab(visibleTabs[0]?.id ?? 'matriz')
  }, [visibleTabs, tab])

  const activeTab = TABS.find((item) => item.id === tab)
  const puede = (code: string): boolean => can(me?.permissions ?? null, code)

  if (me === null) {
    return <div className="login"><div className="login__card"><h1>Cargando…</h1></div></div>
  }

  if (!entrado) {
    return <LoginView onEntered={setMe} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>RAMS Planner</h1>
          <span>carga de trabajo, explicada hasta el último minuto</span>
        </div>

        <nav className="tabs" role="tablist">
          {visibleTabs.map((item) => (
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

        {state?.run === null || state === null || tab === 'admin' ? null : (
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
        {!puede('importar') ? null : (
          <ImportButton
            onImported={() => {
              load().catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'Error al recargar')
              })
            }}
          />
        )}
        {state?.run == null || !puede('exportar') ? null : (
          <a
            className="button"
            href={`/api/runs/${state.run.id}/export.csv?bucket=month`}
            title="Descargar la carga mensual en CSV, con el runId en cada fila"
          >
            Exportar
          </a>
        )}
        {!puede('lineabase.crear') ? null : (
          <button className="button" onClick={onFreeze} disabled={busy || state?.run == null} title="Congelar el plan actual como línea base">
            Línea base
          </button>
        )}
        {!puede('nivelar') ? null : (
          <button
            className="button"
            onClick={() => { onRecalculate(true) }}
            disabled={busy}
            title="Retrasar tareas hasta que el plan quepa en la capacidad del equipo. Crea una ejecución nueva; el plan original no se toca"
          >
            Nivelar
          </button>
        )}
        {!puede('calcular') ? null : (
          <button className="button button--primary" onClick={() => { onRecalculate(false) }} disabled={busy}>
            {busy ? 'Calculando…' : 'Recalcular'}
          </button>
        )}
        {me.user === null ? null : (
          <span className="usuario-chip" title={me.user.email}>
            {me.user.displayName}
            <button
              className="button"
              title="Salir"
              onClick={() => {
                signOut()
                  .then(fetchMe)
                  .then(setMe)
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'No se pudo salir')
                  })
              }}
            >
              Salir
            </button>
          </span>
        )}
      </header>

      <main className="content">
        {visibleTabs.length > 0 ? null : (
          <div className="empty">
            <h3>Tu cuenta no tiene todavía ningún permiso</h3>
            <p style={{ maxWidth: '52ch', margin: '0 auto' }}>
              Has entrado bien, pero nadie te ha concedido aún un rol. Quien administre la herramienta puede
              hacerlo desde <b>Administración → Usuarios y roles</b>.
            </p>
          </div>
        )}
        {!me.openInstallation ? null : (
          <div className="error-banner">
            Esta instalación no tiene ningún usuario dado de alta, así que está abierta a cualquiera que
            llegue a ella. Crea el primero con{' '}
            <code>node packages/api/dist/cli.js crear-superadmin &lt;correo&gt; &lt;nombre&gt;</code>.
          </div>
        )}
        {error === null ? null : <div className="error-banner">{error}</div>}
        {notice === null ? null : (
          <div className="notice">
            {notice}
            <button className="button" onClick={() => { setNotice(null) }}>
              Entendido
            </button>
          </div>
        )}

        {totals === null || visibleTabs.length === 0 || tab === 'admin' ? null : (
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

        {visibleTabs.length === 0 ? null : (
        <section className="panel">
          <div className="panel__head">
            <h2>{activeTab?.label}</h2>
            <p>{activeTab?.hint}</p>
            <span className="spacer faint" style={{ fontSize: 12 }}>
              {tab === 'admin'
                ? '✎ lo que marques aquí es lo que la API deja hacer'
                : tab === 'equipo' || tab === 'competencias'
                  ? '✎ todo declarado · cada cambio recalcula el plan'
                  : tab === 'plan'
                    ? '✎ declarado · 🔒 derivado, no editable'
                    : '🔒 columnas derivadas · no editables'}
            </span>
          </div>
          <div className={tab === 'hallazgos' ? 'panel__body panel__body--flush' : 'panel__body panel__body--flush'}>
            {tab === 'admin' ? (
              <AdminView projects={state?.projects ?? []} currentUserId={me.user?.id ?? null} />
            ) : tab === 'competencias' ? (
              <SkillsView
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'Error al recargar')
                  })
                }}
              />
            ) : tab === 'equipo' ? (
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
            ) : state === null ? (
              <div className="empty">
                <h3>Cargando…</h3>
              </div>
            ) : data === null ? (
              // Base de datos vacía. Es la primera pantalla que ve alguien que
              // instala esto, así que dice por dónde se empieza en vez de
              // quedarse en blanco.
              <div className="empty">
                <h3>Aquí no hay nada todavía</h3>
                <p style={{ maxWidth: '52ch', margin: '0 auto' }}>
                  El orden que funciona es este: primero el <b>Equipo</b>, porque de ahí sale la capacidad y el
                  coste; después el plan, importando un CSV o creándolo a mano.
                </p>
                <div className="stat-row" style={{ justifyContent: 'center', marginTop: 20 }}>
                  {!puede('equipo.ver') ? null : (
                    <button className="button" onClick={() => { setTab('equipo') }}>
                      Ir al equipo
                    </button>
                  )}
                  {!puede('importar') ? null : (
                    <a className="button" href="/api/import/plantilla.csv">
                      Descargar la plantilla CSV
                    </a>
                  )}
                </div>
                <p className="faint" style={{ marginTop: 20, fontSize: 12 }}>
                  ¿Sólo quieres verla funcionar? <code>pnpm --filter @planner/api seed:demo</code> carga tres
                  proyectos que se solapan.
                </p>
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
                onEdit={setEditing}
                onEditProject={setEditingProject}
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'Error al recargar')
                  })
                }}
              />
            ) : tab === 'reparto' ? (
              <RebalanceView
                projects={state.projects}
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'Error al recargar')
                  })
                }}
              />
            ) : tab === 'calendario' ? (
              <CalendarView runId={state.run?.id ?? ''} />
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
        )}
      </main>

      {explaining === null || state?.run == null ? null : (
        <WhyPanel runId={state.run.id} task={explaining} onClose={() => { setExplaining(null) }} />
      )}

      {editingProject === null ? null : (
        <ProjectPanel
          project={editingProject}
          onClose={() => { setEditingProject(null) }}
          onChanged={() => {
            load().catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : 'Error al recargar')
            })
          }}
        />
      )}

      {editing === null || state === null || data === null ? null : (
        <EditPanel
          task={editing}
          tasks={data.tasks}
          resources={state.resources}
          onClose={() => { setEditing(null) }}
          onChanged={() => {
            load().catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : 'Error al recargar')
            })
          }}
        />
      )}
    </div>
  )
}
