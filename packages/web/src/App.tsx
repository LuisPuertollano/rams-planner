import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project } from './api.js'
import {
  can,
  canEverywhere,
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
import { dateTime, euros, fijarLocale, hours, percent } from './format.js'
import {
  IDIOMAS,
  NOMBRE_DEL_IDIOMA,
  TraductorProvider,
  crearTraductor,
  idiomaInicial,
  recordarIdioma,
  useT,
  type Idioma,
} from './i18n/index.js'
import { activePeriods } from './periods.js'
import { EditPanel } from './components/EditPanel.js'
import { ImportButton } from './components/ImportButton.js'
import { PasswordPanel } from './components/PasswordPanel.js'
import { ProjectPanel } from './components/ProjectPanel.js'
import { WhyPanel } from './components/WhyPanel.js'
import { AdminView } from './views/AdminView.js'
import { CalendarView } from './views/CalendarView.js'
import { LoginView } from './views/LoginView.js'
import { DiffView } from './views/DiffView.js'
import { ApplyMatrixPanel } from './views/ApplyMatrixPanel.js'
import { DocumentsView } from './views/DocumentsView.js'
import { FindingsView } from './views/FindingsView.js'
import { GanttView } from './views/GanttView.js'
import { HistoryView } from './views/HistoryView.js'
import { HeatmapView } from './views/HeatmapView.js'
import { MatrixView } from './views/MatrixView.js'
import { PlanView } from './views/PlanView.js'
import { RebalanceView } from './views/RebalanceView.js'
import { ReportView } from './views/ReportView.js'
import { SkillsView } from './views/SkillsView.js'
import { ResourcesView } from './views/ResourcesView.js'
import { errorText } from './errors.js'

type Tab =
  | 'matriz' | 'saturacion' | 'plan' | 'cronograma'
  | 'equipo' | 'competencias' | 'calendario' | 'documentos' | 'reparto' | 'informes' | 'hallazgos'
  | 'comparar' | 'registro' | 'admin'

/**
 * Cada pestaña declara con qué permiso se entra. Si alguien no tiene ninguno de
 * ellos, la pestaña no se enseña — pero eso es cortesía, no seguridad: quien
 * escriba la URL a mano se encuentra con un 403 del servidor igualmente.
 */
const TABS: readonly {
  id: Tab
  /** La clave del diccionario. El texto vive en `i18n/`, no aquí. */
  label: 'tab.carga' | 'tab.saturacion' | 'tab.plan' | 'tab.cronograma' | 'tab.equipo'
  | 'tab.calendario' | 'tab.competencias' | 'tab.documentos' | 'tab.reparto' | 'tab.informes'
  | 'tab.hallazgos' | 'tab.comparar' | 'tab.registro' | 'tab.admin'
  hint: 'tab.carga.pista' | 'tab.saturacion.pista' | 'tab.plan.pista' | 'tab.cronograma.pista'
  | 'tab.equipo.pista' | 'tab.calendario.pista' | 'tab.competencias.pista' | 'tab.documentos.pista'
  | 'tab.reparto.pista' | 'tab.informes.pista' | 'tab.hallazgos.pista' | 'tab.comparar.pista'
  | 'tab.registro.pista' | 'tab.admin.pista'
  permission: readonly string[]
  /** El permiso hace falta en toda la herramienta, no sobre un proyecto. */
  everywhere?: true
}[] = [
  { id: 'matriz', label: 'tab.carga', hint: 'tab.carga.pista', permission: ['carga.ver'] },
  // La saturación es del equipo entero: con la carga de un solo proyecto, la
  // ocupación de una persona no es su ocupación.
  { id: 'saturacion', label: 'tab.saturacion', hint: 'tab.saturacion.pista', permission: ['carga.ver'], everywhere: true },
  { id: 'plan', label: 'tab.plan', hint: 'tab.plan.pista', permission: ['plan.ver'] },
  { id: 'cronograma', label: 'tab.cronograma', hint: 'tab.cronograma.pista', permission: ['plan.ver'] },
  { id: 'equipo', label: 'tab.equipo', hint: 'tab.equipo.pista', permission: ['equipo.ver'] },
  { id: 'calendario', label: 'tab.calendario', hint: 'tab.calendario.pista', permission: ['equipo.ver'] },
  { id: 'competencias', label: 'tab.competencias', hint: 'tab.competencias.pista', permission: ['competencias.ver'] },
  { id: 'documentos', label: 'tab.documentos', hint: 'tab.documentos.pista', permission: ['documentos.ver'] },
  { id: 'reparto', label: 'tab.reparto', hint: 'tab.reparto.pista', permission: ['reparto.ver'] },
  { id: 'informes', label: 'tab.informes', hint: 'tab.informes.pista', permission: ['informes.ver'] },
  { id: 'hallazgos', label: 'tab.hallazgos', hint: 'tab.hallazgos.pista', permission: ['carga.ver', 'plan.ver'] },
  { id: 'comparar', label: 'tab.comparar', hint: 'tab.comparar.pista', permission: ['ejecuciones.ver'] },
  { id: 'registro', label: 'tab.registro', hint: 'tab.registro.pista', permission: ['historial.ver'] },
  { id: 'admin', label: 'tab.admin', hint: 'tab.admin.pista', permission: ['roles.gestionar', 'usuarios.gestionar'] },
]

/**
 * El idioma envuelve a toda la aplicación.
 *
 * Está fuera de `App` porque el traductor tiene que existir antes de que se
 * pinte nada: un componente que se monta y luego cambia de idioma parpadea, y
 * la pantalla de entrada es justo la primera que alguien ve.
 */
export function App(): React.JSX.Element {
  const [idioma, setIdioma] = useState<Idioma>(() => idiomaInicial())
  const traductor = useMemo(() => crearTraductor(idioma), [idioma])

  // El `locale` de los números se fija **durante el pintado**, no después.
  // En un `useEffect` llegaría tarde: los hijos ya se habrían pintado con el
  // idioma anterior y se vería un «1,648 h» inglés en una pantalla en
  // castellano hasta el siguiente cambio de estado. Es idempotente, así que
  // repetirlo en cada pintado no cuesta nada.
  fijarLocale(traductor.locale)

  useEffect(() => {
    recordarIdioma(idioma)
    document.documentElement.lang = idioma
  }, [idioma])

  return (
    <TraductorProvider value={traductor}>
      <Planner idioma={idioma} onIdioma={setIdioma} />
    </TraductorProvider>
  )
}

function Planner({
  idioma,
  onIdioma,
}: {
  readonly idioma: Idioma
  readonly onIdioma: (idioma: Idioma) => void
}): React.JSX.Element {
  const { t, locale } = useT()
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
  const [cambiandoClave, setCambiandoClave] = useState(false)

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
      .catch((cause: unknown) => { setError(errorText(t, cause, 'app.errorCargar')) })
  }, [])

  const entrado = me !== null && (me.user !== null || me.openInstallation)

  useEffect(() => {
    if (!entrado) return
    load().catch((cause: unknown) => { setError(errorText(t, cause, 'app.errorCargar')) })
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
    const name = window.prompt(
      t('lineaBase.pide'),
      t('lineaBase.porDefecto', new Date().toLocaleDateString(locale)),
    )
    if (name === null || name.trim() === '') return
    setBusy(true)
    freezeBaseline(state.run.id, name.trim())
      .then(load)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'lineaBase.error')) })
      .finally(() => { setBusy(false) })
  }

  const onRecalculate = (level = false): void => {
    setBusy(true)
    setError(null)
    setNotice(null)
    recalculate(level ? t('calculo.razonNivelacion') : t('calculo.razonInterfaz'), level)
      .then(async (summary) => {
        if (level) {
          setNotice(
            summary.converged === true
              ? t('calculo.nivelado', summary.leveledTasks ?? 0)
              : t('calculo.niveladoParcial', summary.leveledTasks ?? 0),
          )
        }
        await load()
      })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'calculo.error')) })
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
    // Sin capacidad no hay ocupación que enseñar: quien sólo ve un proyecto no
    // recibe la del equipo, y un 0 h o un — sin explicación parece un fallo.
    const cost = data.load.reduce((sum, cell) => sum + cell.costCents, 0)
    return {
      planned,
      capacity,
      overallocated,
      critical,
      cost,
      showCost: !data.costsHidden,
      hasCapacity: data.utilization.length > 0,
    }
  }, [data])

  const visibleTabs = useMemo(
    () =>
      TABS.filter((item) =>
        item.permission.some((code) =>
          item.everywhere === true ? canEverywhere(me, code) : can(me, code),
        ),
      ),
    [me],
  )

  // Si el rol de quien mira no llega a la pestaña elegida (o a la de inicio),
  // se cae a la primera que sí pueda ver en vez de dejar el panel en blanco.
  useEffect(() => {
    if (visibleTabs.length === 0) return
    if (!visibleTabs.some((item) => item.id === tab)) setTab(visibleTabs[0]?.id ?? 'matriz')
  }, [visibleTabs, tab])

  const activeTab = TABS.find((item) => item.id === tab)
  const puede = (code: string): boolean => can(me, code)

  if (me === null) {
    return <div className="login"><div className="login__card"><h1>{t('app.cargando')}</h1></div></div>
  }

  if (!entrado) {
    return <LoginView onEntered={setMe} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>{t('app.nombre')}</h1>
          <span>{t('app.lema')}</span>
        </div>

        <nav className="tabs" role="tablist">
          {visibleTabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className="tab"
              onClick={() => { setTab(item.id) }}
              title={t(item.hint)}
            >
              {t(item.label)}
            </button>
          ))}
        </nav>

        {state?.run === null ||
        state === null ||
        tab === 'admin' ||
        tab === 'registro' ||
        tab === 'informes' ||
        tab === 'documentos' ? null : (
          <span className="run-chip" title={t('ejecucion.hash', state.run.inputHash)}>
            {t(
              'ejecucion.chip',
              state.run.id.slice(0, 8),
              state.run.engineVersion,
              dateTime(state.run.startedAt),
              state.run.durationMs ?? 0,
            )}
          </span>
        )}

        <button
          className="button"
          onClick={() => { setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark') }}
          title={t('boton.tema')}
        >
          {theme === 'auto' ? '◐' : theme === 'light' ? '☀' : '☾'}
        </button>
        <select
          className="input input--idioma"
          value={idioma}
          title={t('boton.idioma')}
          aria-label={t('boton.idioma')}
          onChange={(event) => { onIdioma(event.target.value as Idioma) }}
        >
          {IDIOMAS.map((codigo) => (
            // Cada idioma, escrito en su propio idioma: quien abre esto sin
            // entender la pantalla necesita reconocer el suyo, no leerlo.
            <option key={codigo} value={codigo}>{NOMBRE_DEL_IDIOMA[codigo]}</option>
          ))}
        </select>
        {!puede('importar') ? null : (
          <ImportButton
            onImported={() => {
              load().catch((cause: unknown) => {
                setError(errorText(t, cause, 'app.errorRecargar'))
              })
            }}
          />
        )}
        {state?.run == null || !puede('exportar') ? null : (
          <a
            className="button"
            href={`/api/runs/${state.run.id}/export.csv?bucket=month`}
            title={t('boton.exportarTitulo')}
          >
            {t('boton.exportar')}
          </a>
        )}
        {!puede('lineabase.crear') ? null : (
          <button
            className="button"
            onClick={onFreeze}
            disabled={busy || state?.run == null}
            title={t('boton.lineaBaseTitulo')}
          >
            {t('boton.lineaBase')}
          </button>
        )}
        {!puede('nivelar') ? null : (
          <button
            className="button"
            onClick={() => { onRecalculate(true) }}
            disabled={busy}
            title={t('boton.nivelarTitulo')}
          >
            {t('boton.nivelar')}
          </button>
        )}
        {!puede('calcular') ? null : (
          <button className="button button--primary" onClick={() => { onRecalculate(false) }} disabled={busy}>
            {busy ? t('boton.calculando') : t('boton.recalcular')}
          </button>
        )}
        {me.user === null ? null : (
          <span className="usuario-chip" title={me.user.email}>
            {me.user.displayName}
            <button
              className="button"
              title={t('boton.contrasenaTitulo')}
              onClick={() => { setCambiandoClave(true) }}
            >
              {t('boton.contrasena')}
            </button>
            <button
              className="button"
              title={t('boton.salir')}
              onClick={() => {
                signOut()
                  .then(fetchMe)
                  .then(setMe)
                  .catch((cause: unknown) => {
                    setError(errorText(t, cause, 'app.errorRecargar'))
                  })
              }}
            >
              {t('boton.salir')}
            </button>
          </span>
        )}
      </header>

      <main className="content">
        {visibleTabs.length > 0 ? null : (
          <div className="empty">
            <h3>{t('vacio.sinPermisos.titulo')}</h3>
            <p style={{ maxWidth: '52ch', margin: '0 auto' }}>{t('vacio.sinPermisos.texto')}</p>
          </div>
        )}
        {!me.openInstallation ? null : (
          <div className="error-banner">
            {t('abierta.aviso', '')}{' '}
            <code>node packages/api/dist/cli.js crear-superadmin &lt;correo&gt; &lt;nombre&gt;</code>
          </div>
        )}
        {error === null ? null : <div className="error-banner">{error}</div>}
        {notice === null ? null : (
          <div className="notice">
            {notice}
            <button className="button" onClick={() => { setNotice(null) }}>
              {t('app.entendido')}
            </button>
          </div>
        )}

        {totals === null ||
        visibleTabs.length === 0 ||
        tab === 'admin' ||
        tab === 'registro' ||
        tab === 'informes' ||
        tab === 'documentos' ? null : (
          <div className="stat-row">
            <div className="stat">
              <div className="stat__label">{t('stat.planificado')}</div>
              <div className="stat__value">{hours(totals.planned)} h</div>
              <div className="stat__hint">
                {totals.hasCapacity
                  ? t('stat.planificado.sobre', hours(totals.capacity))
                  : t('stat.planificado.recortado')}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">{t('stat.ocupacion')}</div>
              <div className="stat__value">
                {totals.hasCapacity
                  ? percent(
                      totals.capacity === 0
                        ? null
                        : Math.round((totals.planned * 10_000) / totals.capacity),
                    )
                  : '—'}
              </div>
              <div className="stat__hint">
                {totals.hasCapacity ? t('stat.ocupacion.media') : t('stat.ocupacion.sinCapacidad')}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">{t('stat.sobrecargadas')}</div>
              <div className="stat__value">{totals.hasCapacity ? totals.overallocated : '—'}</div>
              <div className="stat__hint">
                {totals.hasCapacity ? t('stat.sobrecargadas.pista') : t('stat.sobrecargadas.sinCapacidad')}
              </div>
            </div>
            {!totals.showCost ? null : (
              <div className="stat">
                <div className="stat__label">{t('stat.coste')}</div>
                <div className="stat__value">{euros(totals.cost)}</div>
                <div className="stat__hint">
                  {totals.cost === 0 ? t('stat.coste.cero') : t('stat.coste.pista')}
                </div>
              </div>
            )}
            <div className="stat">
              <div className="stat__label">{t('stat.criticas')}</div>
              <div className="stat__value">{totals.critical}</div>
              <div className="stat__hint">{t('stat.criticas.pista')}</div>
            </div>
          </div>
        )}

        {visibleTabs.length === 0 ? null : (
        <section className="panel">
          <div className="panel__head">
            <h2>{activeTab === undefined ? '' : t(activeTab.label)}</h2>
            <p>{activeTab === undefined ? '' : t(activeTab.hint)}</p>
            <span className="spacer faint" style={{ fontSize: 12 }}>
              {tab === 'admin'
                ? t('nota.admin')
                : tab === 'documentos'
                  ? t('nota.documentos')
                : tab === 'registro'
                  ? t('nota.registro')
                : tab === 'equipo' || tab === 'competencias'
                  ? t('nota.declarado')
                  : tab === 'plan'
                    ? t('nota.plan')
                    : t('nota.derivado')}
            </span>
          </div>
          <div className={tab === 'hallazgos' ? 'panel__body panel__body--flush' : 'panel__body panel__body--flush'}>
            {tab === 'admin' ? (
              <AdminView projects={state?.projects ?? []} currentUserId={me.user?.id ?? null} />
            ) : tab === 'documentos' ? (
              // El catálogo es dato declarado del equipo: existe aunque no
              // haya ni un proyecto, y de hecho conviene llenarlo antes.
              <>
                <DocumentsView canEdit={puede('documentos.gestionar')} />
                {(state?.projects ?? []).length === 0 ? null : (
                  <ApplyMatrixPanel
                    projects={state?.projects ?? []}
                    canApply={puede('dependencias.editar')}
                    onApplied={() => {
                      load().catch((cause: unknown) => {
                        setError(errorText(t, cause, 'app.errorRecargar'))
                      })
                    }}
                  />
                )}
              </>
            ) : tab === 'informes' ? (
              // El informe se pide a su propia ruta y trae su ejecución dentro,
              // así que no depende de la que tenga cargada el resto de la app.
              <ReportView projects={state?.projects ?? []} />
            ) : tab === 'registro' ? (
              // El registro es dato propio: existe aunque no se haya calculado
              // nada, y de hecho lo primero que se registra es el alta de la
              // primera persona del equipo.
              <HistoryView projects={state?.projects ?? []} />
            ) : tab === 'competencias' ? (
              <SkillsView
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(errorText(t, cause, 'app.errorRecargar'))
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
                    setError(errorText(t, cause, 'app.errorRecargar'))
                  })
                }}
              />
            ) : state === null ? (
              <div className="empty">
                <h3>{t('app.cargando')}</h3>
              </div>
            ) : data === null ? (
              // Base de datos vacía. Es la primera pantalla que ve alguien que
              // instala esto, así que dice por dónde se empieza en vez de
              // quedarse en blanco.
              <div className="empty">
                <h3>{t('vacio.nada.titulo')}</h3>
                <p style={{ maxWidth: '52ch', margin: '0 auto' }}>{t('vacio.nada.texto')}</p>
                <div className="stat-row" style={{ justifyContent: 'center', marginTop: 20 }}>
                  {!puede('equipo.ver') ? null : (
                    <button className="button" onClick={() => { setTab('equipo') }}>
                      {t('vacio.nada.irEquipo')}
                    </button>
                  )}
                  {!puede('importar') ? null : (
                    <a className="button" href="/api/import/plantilla.csv">
                      {t('vacio.nada.plantilla')}
                    </a>
                  )}
                </div>
                <p className="faint" style={{ marginTop: 20, fontSize: 12 }}>
                  {t('vacio.nada.demo', '')} <code>pnpm --filter @planner/api seed:demo</code>
                </p>
              </div>
            ) : tab === 'matriz' ? (
              <MatrixView
                costsHidden={data.costsHidden}
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
                    setError(errorText(t, cause, 'app.errorRecargar'))
                  })
                }}
              />
            ) : tab === 'reparto' ? (
              <RebalanceView
                projects={state.projects}
                onChanged={() => {
                  load().catch((cause: unknown) => {
                    setError(errorText(t, cause, 'app.errorRecargar'))
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

      {!cambiandoClave || me.user === null ? null : (
        <PasswordPanel
          onClose={() => { setCambiandoClave(false) }}
          onChanged={() => {
            // El servidor ha cerrado todas las sesiones. Volver a preguntar
            // quién eres devuelve «nadie», y la aplicación enseña la entrada.
            setCambiandoClave(false)
            fetchMe()
              .then(setMe)
              .catch(() => { window.location.reload() })
          }}
        />
      )}

      {explaining === null || state?.run == null ? null : (
        <WhyPanel runId={state.run.id} task={explaining} onClose={() => { setExplaining(null) }} />
      )}

      {editingProject === null ? null : (
        <ProjectPanel
          project={editingProject}
          onClose={() => { setEditingProject(null) }}
          onChanged={() => {
            load().catch((cause: unknown) => {
              setError(errorText(t, cause, 'app.errorRecargar'))
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
              setError(errorText(t, cause, 'app.errorRecargar'))
            })
          }}
        />
      )}
    </div>
  )
}
