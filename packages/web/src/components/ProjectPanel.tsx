import { useEffect, useState } from 'react'
import { patchProject, removeProject, type Project } from '../api.js'

interface Props {
  readonly project: Project
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
export function ProjectPanel({ project, onClose, onChanged }: Props): React.JSX.Element {
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
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'No se pudo guardar') })
      .finally(() => { setBusy(false) })
  }

  const save = (changes: Readonly<Record<string, string | number>>): void => {
    run(async () => { await patchProject(project.id, changes) })
  }

  return (
    <>
      <button className="backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="why" role="dialog" aria-label={`Proyecto: ${project.code}`}>
        <div className="why__head">
          <div>
            <h2>{project.code}</h2>
            <p className="faint" style={{ margin: '2px 0 0', fontSize: 12 }}>Datos declarados del proyecto</p>
          </div>
          <button className="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Cerrar</button>
        </div>

        <div className="why__body">
          {error === null ? null : <div className="error-banner">{error}</div>}

          <div className="card">
            <h3 className="card__title">Identidad</h3>
            <div className="field-grid">
              <label className="field">
                <span>Nombre</span>
                <input
                  className="input"
                  value={name}
                  disabled={busy}
                  onChange={(event) => { setName(event.target.value) }}
                  onBlur={() => { if (name.trim() !== '' && name !== project.name) save({ name: name.trim() }) }}
                />
              </label>
              <label className="field">
                <span>Código</span>
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
            <h3 className="card__title">Fecha de referencia</h3>
            <p className="card__note">
              Ancla las tareas que no tienen predecesora ni restricción. Cambiarla mueve el proyecto entero.
            </p>
            <label className="field" style={{ marginTop: 8, maxWidth: 200 }}>
              <span>Arranque</span>
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
            <h3 className="card__title">Prioridad</h3>
            <p className="card__note">
              Sólo se usa para desempatar en la nivelación: cuando dos tareas se pelean por la misma persona el
              mismo día, cede la del número más alto. No cambia nada más, y por defecto todos los proyectos
              empatan en 500.
            </p>
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
            <h3 className="card__title">Quitar el proyecto</h3>
            <p className="card__note">
              Se da de baja el proyecto y todo su plan. No se borra nada: los cálculos ya hechos se siguen
              explicando igual.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`¿Quitar «${project.code} · ${project.name}» y todo su plan?`)) {
                  run(async () => { await removeProject(project.id) }, true)
                }
              }}
            >
              Quitar el proyecto
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
