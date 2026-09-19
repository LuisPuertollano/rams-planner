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
import { GRUPOS, type GrupoId, type Vista, type VistaId } from './nav.js'
import { activePeriods } from './periods.js'
import { EditPanel } from './components/EditPanel.js'
import { ImportDialog, type TipoDeImportacion } from './components/ImportDialog.js'
import { Menu } from './components/Menu.js'
import { PasswordPanel } from './components/PasswordPanel.js'
import { ProjectPanel } from './components/ProjectPanel.js'
import { WhyPanel } from './components/WhyPanel.js'
import { AdminView } from './views/AdminView.js'
import { BackupPanel } from './views/BackupPanel.js'
import { CalendarView } from './views/CalendarView.js'
import { LoginView } from './views/LoginView.js'
import { DiffView } from './views/DiffView.js'
import { ApplyMatrixPanel } from './views/ApplyMatrixPanel.js'
import { GatesPanel } from './views/GatesPanel.js'
import { SplitDeliveriesPanel } from './views/SplitDeliveriesPanel.js'
import { SplitTasksPanel } from './views/SplitTasksPanel.js'
import { DocumentsView } from './views/DocumentsView.js'
import { GanttView } from './views/GanttView.js'
import { HistoryView } from './views/HistoryView.js'
import { HeatmapView } from './views/HeatmapView.js'
import { ImportsView } from './views/ImportsView.js'
import { MatrixView } from './views/MatrixView.js'
import { PanelView } from './views/PanelView.js'
import { PlanView } from './views/PlanView.js'
import { RebalanceView } from './views/RebalanceView.js'
import { ReconcileView } from './views/ReconcileView.js'
import { ReportView } from './views/ReportView.js'
import { SkillsView } from './views/SkillsView.js'
import { ResourcesView } from './views/ResourcesView.js'
import { TodayView } from './views/TodayView.js'
import { errorText } from './errors.js'

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
  const [vista, setVista] = useState<VistaId>('hoy')
  // Volver a un grupo devuelve a la pantalla en la que lo dejaste. Sin esto,
  // ir de Equipo → Calendario → Plan → Equipo te deja otra vez en Equipo, y
  // castiga justo a quien usa más de una pantalla de un grupo.
  const [ultima, setUltima] = useState<Readonly<Record<string, VistaId>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [explaining, setExplaining] = useState<TaskRow | null>(null)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto')
  const [cambiandoClave, setCambiandoClave] = useState(false)
  // Qué se está importando, si es que se está importando algo. Vive aquí y no
  // en el menú porque cerrar el menú no puede cancelar una importación a medias.
  const [importando, setImportando] = useState<TipoDeImportacion | null>(null)

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

  const recargar = useCallback((): void => {
    load().catch((cause: unknown) => { setError(errorText(t, cause, 'app.errorRecargar')) })
  }, [load, t])

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

  // Los seis grupos, con dentro sólo las vistas a las que llega tu rol. Un grupo
  // que se queda sin ninguna no se enseña: es una pestaña que no lleva a nada.
  const grupos = useMemo(() => {
    const alcanza = (item: Vista): boolean =>
      item.permission.some((code) =>
        item.everywhere === true ? canEverywhere(me, code) : can(me, code),
      )
    return GRUPOS.map((grupo) => ({ ...grupo, vistas: grupo.vistas.filter(alcanza) })).filter(
      (grupo) => grupo.vistas.length > 0,
    )
  }, [me])

  const grupoActivo = grupos.find((grupo) => grupo.vistas.some((item) => item.id === vista))
  const vistaActiva = grupoActivo?.vistas.find((item) => item.id === vista)

  // Si el rol de quien mira no llega a la vista elegida (o a la de inicio), se
  // cae a la primera que sí pueda ver en vez de dejar el panel en blanco.
  useEffect(() => {
    if (grupos.length === 0 || grupoActivo !== undefined) return
    const primera = grupos[0]?.vistas[0]?.id
    if (primera !== undefined) setVista(primera)
  }, [grupos, grupoActivo])

  const irAlGrupo = (id: GrupoId): void => {
    const grupo = grupos.find((candidato) => candidato.id === id)
    if (grupo === undefined) return
    const recordada = ultima[id]
    const destino =
      recordada !== undefined && grupo.vistas.some((item) => item.id === recordada)
        ? recordada
        : grupo.vistas[0]?.id
    if (destino !== undefined) setVista(destino)
  }

  const irALaVista = (id: VistaId): void => {
    const grupo = GRUPOS.find((candidato) => candidato.vistas.some((item) => item.id === id))
    if (grupo !== undefined) setUltima((previo) => ({ ...previo, [grupo.id]: id }))
    setVista(id)
  }

  const puede = (code: string): boolean => can(me, code)

  if (me === null) {
    return <div className="login"><div className="login__card"><h1>{t('app.cargando')}</h1></div></div>
  }

  if (!entrado) {
    return <LoginView onEntered={setMe} />
  }

  const sinCifras = vistaActiva?.sinCifras === true

  // Todo lo que cambia los datos, en un solo sitio. Antes estaba repartido por
  // la cabecera entre el selector de tema y el de idioma, con el mismo peso
  // visual: «Recalcular» daba el mismo respeto que «Tema», que es al revés.
  const acciones: readonly { clave: string; nodo: (cerrar: () => void) => React.JSX.Element }[] = [
    ...(!puede('calcular') ? [] : [{
      clave: 'calcular',
      nodo: (cerrar: () => void) => (
        <button
          className="menu__item"
          role="menuitem"
          disabled={busy}
          onClick={() => { cerrar(); onRecalculate(false) }}
        >
          {busy ? t('boton.calculando') : t('boton.recalcular')}
        </button>
      ),
    }]),
    ...(!puede('nivelar') ? [] : [{
      clave: 'nivelar',
      nodo: (cerrar: () => void) => (
        <button
          className="menu__item"
          role="menuitem"
          disabled={busy}
          title={t('boton.nivelarTitulo')}
          onClick={() => { cerrar(); onRecalculate(true) }}
        >
          {t('boton.nivelar')}
        </button>
      ),
    }]),
    ...(!puede('lineabase.crear') ? [] : [{
      clave: 'lineaBase',
      nodo: (cerrar: () => void) => (
        <button
          className="menu__item"
          role="menuitem"
          disabled={busy || state?.run == null}
          title={t('boton.lineaBaseTitulo')}
          onClick={() => { cerrar(); onFreeze() }}
        >
          {t('boton.lineaBase')}
        </button>
      ),
    }]),
    ...(!puede('importar') ? [] : [{
      clave: 'importarPlan',
      nodo: (cerrar: () => void) => (
        <button
          className="menu__item"
          role="menuitem"
          title={t('importar.plan.titulo')}
          onClick={() => { cerrar(); setImportando('plan') }}
        >
          {t('boton.importar')}
        </button>
      ),
    }]),
    ...(!puede('reales.registrar') ? [] : [{
      clave: 'importarHoras',
      nodo: (cerrar: () => void) => (
        <button
          className="menu__item"
          role="menuitem"
          title={t('horas.importarTitulo')}
          onClick={() => { cerrar(); setImportando('actuals') }}
        >
          {t('horas.importar')}
        </button>
      ),
    }]),
    ...(state?.run == null || !puede('exportar') ? [] : [{
      clave: 'exportar',
      nodo: (cerrar: () => void) => (
        <a
          className="menu__item"
          role="menuitem"
          // El mes es la escala de la exportación porque es el dato fino: un
          // año se suma desde los meses en la hoja de cálculo, y de un año no
          // se pueden sacar los meses. La pantalla de Carga sí deja mirarlo
          // por trimestre o por año.
          href={`/api/runs/${state.run?.id ?? ''}/export.csv?bucket=month`}
          title={t('boton.exportarTitulo')}
          onClick={cerrar}
        >
          {t('boton.exportar')}
        </a>
      ),
    }]),
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>{t('app.nombre')}</h1>
          <span>{t('app.lema')}</span>
        </div>

        <nav className="tabs" role="tablist">
          {grupos.map((grupo) => (
            <button
              key={grupo.id}
              role="tab"
              aria-selected={grupoActivo?.id === grupo.id}
              className="tab"
              onClick={() => { irAlGrupo(grupo.id) }}
              title={t(grupo.hint)}
            >
              {t(grupo.label)}
            </button>
          ))}
        </nav>

        {/* Hacer: lo que cambia los datos y recalcula el plan. */}
        {acciones.length === 0 ? null : (
          <Menu etiqueta={t('menu.calcular')} titulo={t('menu.calcular.titulo')} principal>
            {(cerrar) => acciones.map((accion) => (
              <span key={accion.clave} style={{ display: 'contents' }}>{accion.nodo(cerrar)}</span>
            ))}
          </Menu>
        )}

        {/* Mirar: cómo ves tú la herramienta. No cambia ni un dato. */}
        <div className="topbar__mirar">
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
        </div>
      </header>

      <main className="content">
        {grupos.length > 0 ? null : (
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

        {totals === null || grupos.length === 0 || sinCifras ? null : (
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

        {grupos.length === 0 || grupoActivo === undefined || vistaActiva === undefined ? null : (
        <section className="panel">
          <div className="panel__head">
            {grupoActivo.vistas.length === 1 ? (
              <h2>{t(vistaActiva.label)}</h2>
            ) : (
              // El segundo nivel: dentro de un grupo se cambia de pantalla sin
              // salir de él. Es lo que permite que arriba haya seis y no catorce.
              <div className="subtabs" role="tablist" aria-label={t(grupoActivo.label)}>
                {grupoActivo.vistas.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={item.id === vista}
                    className="subtab"
                    onClick={() => { irALaVista(item.id) }}
                    title={t(item.hint)}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
            )}
            <p>{t(vistaActiva.hint)}</p>
            <span className="spacer faint" style={{ fontSize: 12 }}>
              {state?.run == null || sinCifras ? null : (
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
            </span>
            <span className="faint" style={{ fontSize: 12 }}>{t(vistaActiva.nota)}</span>
          </div>
          <div className="panel__body panel__body--flush">
            {vista === 'admin' ? (
              <>
                <AdminView projects={state?.projects ?? []} currentUserId={me.user?.id ?? null} />
                {!puede('copia.exportar') && !puede('copia.restaurar') ? null : (
                  <BackupPanel
                    puedeExportar={puede('copia.exportar')}
                    puedeRestaurar={puede('copia.restaurar')}
                    onRestaurado={recargar}
                  />
                )}
              </>
            ) : vista === 'documentos' ? (
              <>
                <DocumentsView canEdit={puede('documentos.gestionar')} />
                {(state?.projects ?? []).length === 0 ? null : (
                  <ApplyMatrixPanel
                    projects={state?.projects ?? []}
                    canApply={puede('dependencias.editar')}
                    onApplied={recargar}
                  />
                )}
                {(state?.projects ?? []).length === 0 ? null : (
                  <GatesPanel
                    projects={state?.projects ?? []}
                    canApply={puede('plan.editar')}
                    onApplied={recargar}
                  />
                )}
                {(state?.projects ?? []).length === 0 ? null : (
                  <SplitDeliveriesPanel
                    projects={state?.projects ?? []}
                    canApply={puede('plan.estructura')}
                    locale={locale}
                    onApplied={recargar}
                  />
                )}
                {(state?.projects ?? []).length === 0 ? null : (
                  <SplitTasksPanel
                    projects={state?.projects ?? []}
                    canApply={puede('plan.estructura')}
                    locale={locale}
                    onApplied={recargar}
                  />
                )}
              </>
            ) : vista === 'importaciones' ? (
              <ImportsView puede={puede} onPlanImportado={recargar} />
            ) : vista === 'informes' ? (
              <ReportView projects={state?.projects ?? []} />
            ) : vista === 'conciliar' ? (
              <ReconcileView
                puedeImportar={puede('reales.registrar')}
                onImportar={(tipo) => { setImportando(tipo) }}
              />
            ) : vista === 'registro' ? (
              <HistoryView projects={state?.projects ?? []} />
            ) : vista === 'competencias' ? (
              <SkillsView onChanged={recargar} />
            ) : vista === 'equipo' ? (
              <ResourcesView onChanged={recargar} />
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
                    <button className="button" onClick={() => { irALaVista('equipo') }}>
                      {t('vacio.nada.irEquipo')}
                    </button>
                  )}
                  {!puede('importar') ? null : (
                    <a className="button" href="/api/import/plan/plantilla.csv">
                      {t('vacio.nada.plantilla')}
                    </a>
                  )}
                </div>
                <p className="faint" style={{ marginTop: 20, fontSize: 12 }}>
                  {t('vacio.nada.demo', '')} <code>pnpm --filter @planner/api seed:demo</code>
                </p>
              </div>
            ) : vista === 'hoy' ? (
              <TodayView
                state={state}
                data={data}
                puedeVerReales={puede('reales.ver')}
                onIr={irALaVista}
              />
            ) : vista === 'panel' ? (
              <PanelView state={state} data={data} puedeVerReales={puede('reales.ver')} />
            ) : vista === 'carga' ? (
              <MatrixView
                costsHidden={data.costsHidden}
                resources={state.resources}
                projects={state.projects}
                load={data.load}
                utilization={data.utilization}
                runId={state.run?.id ?? ''}
              />
            ) : vista === 'saturacion' ? (
              <HeatmapView resources={state.resources} utilization={data.utilization} />
            ) : vista === 'plan' ? (
              <PlanView
                tasks={data.tasks}
                projects={state.projects}
                fields={state.fields}
                onExplain={setExplaining}
                onEdit={setEditing}
                onEditProject={setEditingProject}
                onChanged={recargar}
              />
            ) : vista === 'reparto' ? (
              <RebalanceView projects={state.projects} onChanged={recargar} />
            ) : vista === 'calendario' ? (
              <CalendarView runId={state.run?.id ?? ''} />
            ) : vista === 'cronograma' ? (
              <GanttView tasks={data.tasks} projects={state.projects} />
            ) : (
              <DiffView
                baselines={state.baselines}
                currentRunId={state.run?.id ?? ''}
                projects={state.projects}
              />
            )}
          </div>
        </section>
        )}
      </main>

      {importando === null ? null : (
        <ImportDialog
          tipo={importando}
          onClose={() => { setImportando(null) }}
          // Cargar horas no recalcula nada, así que no hay nada que recargar.
          // Es la diferencia con el plan, y es a propósito.
          onImported={importando === 'plan' ? recargar : undefined}
        />
      )}

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
          baselines={state?.baselines ?? []}
          onClose={() => { setEditingProject(null) }}
          onChanged={recargar}
        />
      )}

      {editing === null || state === null || data === null ? null : (
        <EditPanel
          task={editing}
          tasks={data.tasks}
          resources={state.resources}
          onClose={() => { setEditing(null) }}
          onChanged={recargar}
        />
      )}
    </div>
  )
}
