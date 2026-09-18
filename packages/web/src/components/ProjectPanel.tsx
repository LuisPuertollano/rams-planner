import { useEffect, useState } from 'react'
import { duplicateProject, patchProject, removeProject, type Baseline, type Project } from '../api.js'
import { errorText } from '../errors.js'
import { fullDate } from '../format.js'
import { useT } from '../i18n/index.js'
import { EntityHistory } from './EntityHistory.js'

interface Props {
  readonly project: Project
  /** Las fotos congeladas que se pueden elegir como referencia. */
  readonly baselines: readonly Baseline[]
  readonly onClose: () => void
  readonly onChanged: () => void
}

/**
 * Los datos declarados de un proyecto.
 *
 * La **fecha de referencia** es la que más importa y la que peor se entiende:
 * es el ancla de todas las tareas que no tienen ni predecesora ni restricción.
 * Cambiarla mueve el proyecto entero, así que se edita aquí, a la vista, en vez
 * de quedarse con el valor que le tocó el día del alta.
 */
export function ProjectPanel({ project, baselines, onClose, onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [code, setCode] = useState(project.code)
  const [name, setName] = useState(project.name)
  const [statusStart, setStatusStart] = useState(project.statusStart)
  const [priority, setPriority] = useState(String(project.priority))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const run = (action: () => Promise<void>, close = false): void => {
    setBusy(true)
    setError(null)
    action()
      .then(() => { onChanged(); if (close) onClose() })
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.guardar')) })
      .finally(() => { setBusy(false) })
  }

  const save = (changes: Readonly<Record<string, string | number | boolean | null>>): void => {
    run(async () => { await patchProject(project.id, changes) })
  }

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label={t('boton.cerrar')} />
      <aside className="why" role="dialog" aria-label={t('proyecto.titulo', project.code)}>
        <div className="why__head">
          <div>
            <h2>{project.code}</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>{t('proyecto.subtitulo')}</p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>
            {t('boton.cerrar')}
          </button>
        </div>

        <div className="why__body">
          {error === null ? null : <div className="error-banner">{error}</div>}

          <div className="card">
            <h3 className="card__title">{t('proyecto.identidad')}</h3>
            <div className="field-grid">
              <label className="field">
                <span>{t('col.nombre')}</span>
                <input
                  className="input"
                  value={name}
                  disabled={busy}
                  onChange={(event) => { setName(event.target.value) }}
                  onBlur={() => { if (name.trim() !== '' && name !== project.name) save({ name: name.trim() }) }}
                />
              </label>
              <label className="field">
                <span>{t('col.codigo')}</span>
                <input
                  className="input"
                  value={code}
                  disabled={busy}
                  onChange={(event) => { setCode(event.target.value) }}
                  onBlur={() => { if (code.trim() !== '' && code !== project.code) save({ code: code.trim() }) }}
                />
              </label>
            </div>
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.fechaRef')}</h3>
            <p className="card__note">{t('proyecto.fechaRefNota')}</p>
            <label className="field" style={{ marginTop: 8, maxWidth: 200 }}>
              <span>{t('proyecto.arranque')}</span>
              <input
                className="input"
                type="date"
                value={statusStart}
                disabled={busy}
                onChange={(event) => {
                  setStatusStart(event.target.value)
                  if (event.target.value !== '' && event.target.value !== project.statusStart) {
                    save({ statusStart: event.target.value })
                  }
                }}
              />
            </label>
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.compromiso')}</h3>
            <p className="card__note">{t('proyecto.compromisoNota')}</p>
            <label className="field" style={{ marginTop: 8, maxWidth: 260 }}>
              <span>{t('proyecto.nivel')}</span>
              <select
                className="input"
                value={project.commitment}
                disabled={busy}
                onChange={(event) => { save({ commitment: event.target.value }) }}
              >
                <option value="firme">{t('proyecto.firme')}</option>
                <option value="probable">{t('proyecto.probable')}</option>
                <option value="posible">{t('proyecto.posible')}</option>
              </select>
            </label>
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.estado')}</h3>
            <p className="card__note">{t('proyecto.estadoNota')}</p>
            <label className="field" style={{ marginTop: 8, maxWidth: 300 }}>
              <span>{t('proyecto.queSeHace')}</span>
              <select
                className="input"
                value={project.status}
                disabled={busy}
                onChange={(event) => { save({ status: event.target.value }) }}
              >
                <option value="activo">{t('proyecto.activo')}</option>
                <option value="inactivo">{t('proyecto.inactivo')}</option>
                <option value="archivado">{t('proyecto.archivado')}</option>
              </select>
            </label>
            <p className="card__note" style={{ marginTop: 8 }}>{t('proyecto.estadoEnlaces')}</p>
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.lineaBase')}</h3>
            <p className="card__note">{t('proyecto.lineaBaseNota')}</p>
            <label className="field" style={{ marginTop: 8, maxWidth: 320 }}>
              <span>{t('proyecto.foto')}</span>
              <select
                className="input"
                value={project.currentBaselineId ?? ''}
                disabled={busy || baselines.length === 0}
                onChange={(event) => {
                  save({ currentBaselineId: event.target.value === '' ? null : event.target.value })
                }}
              >
                <option value="">{t('proyecto.ninguna')}</option>
                {baselines.map((baseline) => (
                  <option key={baseline.id} value={baseline.id}>
                    {baseline.name} · {fullDate(baseline.capturedAt.slice(0, 10))}
                  </option>
                ))}
              </select>
            </label>
            {baselines.length > 0 ? null : (
              <p className="card__note" style={{ marginTop: 8 }}>{t('proyecto.sinLineasBase')}</p>
            )}
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.prioridad')}</h3>
            <p className="card__note">{t('proyecto.prioridadNota')}</p>
            <label className="field" style={{ marginTop: 8, maxWidth: 160 }}>
              <span>0 – 10000</span>
              <input
                className="input"
                inputMode="numeric"
                value={priority}
                disabled={busy}
                onChange={(event) => { setPriority(event.target.value) }}
                onBlur={() => {
                  const parsed = Number(priority)
                  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 && parsed !== project.priority) {
                    save({ priority: parsed })
                  }
                }}
              />
            </label>
          </div>

          <div className="card">
            <h3 className="card__title">{t('proyecto.copiar')}</h3>
            <p className="card__note">{t('proyecto.copiarNota')}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                className="button"
                disabled={busy}
                title={t('proyecto.guardarPlantillaTitulo')}
                onClick={() => {
                  const nombre = window.prompt(
                    t('proyecto.pidePlantillaNombre'),
                    t('proyecto.plantillaNombrePorDefecto', project.name),
                  )
                  if (nombre === null || nombre.trim() === '') return
                  const codigo = window.prompt(
                    t('proyecto.pidePlantillaCodigo'),
                    t('proyecto.plantillaCodigoPorDefecto', project.code),
                  )
                  if (codigo === null || codigo.trim() === '') return
                  run(async () => {
                    await duplicateProject(project.id, {
                      code: codigo.trim(),
                      name: nombre.trim(),
                      statusStart: project.statusStart,
                      asTemplate: true,
                    })
                  }, true)
                }}
              >
                {t('proyecto.guardarPlantilla')}
              </button>
              <button
                className="button"
                disabled={busy}
                title={t('proyecto.duplicarTitulo')}
                onClick={() => {
                  const nombre = window.prompt(
                    t('proyecto.pideNombre'),
                    t('proyecto.nombrePorDefecto', project.name),
                  )
                  if (nombre === null || nombre.trim() === '') return
                  const codigo = window.prompt(t('proyecto.pideCodigo'), `${project.code}-2`)
                  if (codigo === null || codigo.trim() === '') return
                  const inicio = window.prompt(t('proyecto.pideArranque'), project.statusStart)
                  if (inicio === null || !/^\d{4}-\d{2}-\d{2}$/.test(inicio.trim())) return
                  run(async () => {
                    await duplicateProject(project.id, {
                      code: codigo.trim(),
                      name: nombre.trim(),
                      statusStart: inicio.trim(),
                    })
                  }, true)
                }}
              >
                {t('proyecto.duplicar')}
              </button>
              <button
                className="button"
                disabled={busy}
                title={
                  project.isTemplate ? t('proyecto.aProyectoTitulo') : t('proyecto.aPlantillaTitulo')
                }
                onClick={() => {
                  const aPlantilla = !project.isTemplate
                  const aviso = aPlantilla
                    ? t('proyecto.aPlantillaConfirma', project.code)
                    : t('proyecto.aProyectoConfirma', project.code)
                  if (window.confirm(aviso)) save({ isTemplate: aPlantilla })
                }}
              >
                {project.isTemplate ? t('proyecto.aProyecto') : t('proyecto.aPlantilla')}
              </button>
            </div>
          </div>

          <EntityHistory entityId={project.id} />

          <div className="card">
            <h3 className="card__title">{t('proyecto.quitar')}</h3>
            <p className="card__note">{t('proyecto.quitarNota')}</p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('proyecto.quitarConfirma', project.code, project.name))) {
                  run(async () => { await removeProject(project.id) }, true)
                }
              }}
            >
              {t('proyecto.quitar')}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
