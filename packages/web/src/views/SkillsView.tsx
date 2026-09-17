import { useEffect, useMemo, useState } from 'react'
import {
  createSkill,
  fetchSkills,
  fetchTeam,
  removeSkill,
  setResourceSkill,
  type ResourceDetail,
  type SkillMatrix,
} from '../api.js'
import { errorText } from '../errors.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly onChanged: () => void
}

/** La escala, explicada donde se usa. Un número del 1 al 5 no dice nada solo. */
const NIVELES: readonly { value: number; label: string; hint: string }[] = [
  { value: 0, label: '—', hint: 'No la tiene declarada' },
  { value: 1, label: '1', hint: 'En formación: necesita que le enseñen' },
  { value: 2, label: '2', hint: 'Con apoyo: puede hacerlo si alguien revisa' },
  { value: 3, label: '3', hint: 'Autónomo: lo saca adelante solo' },
  { value: 4, label: '4', hint: 'Referencia: los demás le preguntan' },
  { value: 5, label: '5', hint: 'Experto reconocido: defiende el trabajo fuera' },
]

const hintOf = (level: number): string => NIVELES.find((item) => item.value === level)?.hint ?? ''

/**
 * La hoja de competencias: personas en las filas, competencias en las columnas.
 *
 * Es una matriz porque la pregunta que contesta es de matriz: «¿quién puede
 * hacer esto?» se lee por columnas y «¿qué sabe hacer esta persona?» por filas.
 * Partirla en fichas individuales obligaría a abrir siete pantallas para
 * contestar la primera.
 */
export function SkillsView({ onChanged }: Props): React.JSX.Element {
  const { t } = useT()
  const [matrix, setMatrix] = useState<SkillMatrix | null>(null)
  const [team, setTeam] = useState<readonly ResourceDetail[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    const [siguiente, equipo] = await Promise.all([fetchSkills(), fetchTeam()])
    setMatrix(siguiente)
    setTeam(equipo.resources)
  }

  useEffect(() => {
    reload().catch((cause: unknown) => {
      setError(errorText(t, cause, 'error.local.competencias'))
    })
  }, [])

  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    action()
      .then(reload)
      .then(onChanged)
      .catch((cause: unknown) => { setError(errorText(t, cause, 'error.local.guardar')) })
      .finally(() => { setBusy(false) })
  }

  const levelOf = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of matrix?.resourceSkills ?? []) map.set(`${row.resourceId}|${row.skillId}`, row.level)
    return map
  }, [matrix])

  /** Cuánta gente hay por encima del nivel autónomo en cada competencia. */
  const coberturaDe = (skillId: string): number =>
    (matrix?.resourceSkills ?? []).filter((row) => row.skillId === skillId && row.level >= 3).length

  const nuevaCompetencia = (): void => {
    const name = window.prompt('Nombre de la competencia nueva')
    if (name === null || name.trim() === '') return
    const code = window.prompt('Código corto (el que se usa para agrupar)', name.trim().slice(0, 20))
    if (code === null || code.trim() === '') return
    run(async () => { await createSkill(code.trim(), name.trim()) })
  }

  if (matrix === null || team === null) {
    return <div className="empty"><h3>{error ?? 'Cargando las competencias…'}</h3></div>
  }

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      <div className="toolbar">
        <button className="button" onClick={nuevaCompetencia} disabled={busy}>+ Competencia</button>
        <span className="faint">
          1 en formación · 2 con apoyo · 3 autónomo · 4 referencia · 5 experto. El motor avisa cuando alguien
          está en una tarea que pide una competencia que no tiene.
        </span>
      </div>

      {team.length === 0 ? (
        <div className="empty">
          <h3>Todavía no hay nadie en el equipo</h3>
          <p>Las competencias se declaran sobre personas: empieza por la pestaña Equipo.</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Persona</th>
              {matrix.skills.map((skill) => (
                <th key={skill.id} title={skill.name}>
                  <span className="skill-head">
                    {skill.code}
                    <button
                      className="skill-head__drop"
                      title={`Quitar «${skill.name}» del catálogo, con los niveles y requisitos que tenga`}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `¿Quitar la competencia «${skill.name}»? Se pierden los niveles de todo el ` +
                              'equipo y los requisitos de las tareas que la pedían.',
                          )
                        ) {
                          run(async () => { await removeSkill(skill.id) })
                        }
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((resource) => (
              <tr key={resource.id}>
                <td>{resource.displayName}</td>
                {matrix.skills.map((skill) => {
                  const level = levelOf.get(`${resource.id}|${skill.id}`) ?? 0
                  return (
                    <td key={skill.id} className={level === 0 ? 'cell--zero' : ''}>
                      <select
                        className="level"
                        value={level}
                        disabled={busy}
                        title={`${resource.displayName} · ${skill.name}: ${hintOf(level)}`}
                        data-level={level}
                        onChange={(event) => {
                          const siguiente = Number(event.target.value)
                          run(async () => { await setResourceSkill(resource.id, skill.id, siguiente) })
                        }}
                      >
                        {NIVELES.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="row--total">
              <td title="Personas de nivel 3 o superior: las que pueden sacar ese trabajo adelante solas">
                Autónomos o más
              </td>
              {matrix.skills.map((skill) => {
                // Cero es un agujero y uno es un riesgo: si esa persona se va
                // de vacaciones o del equipo, ese trabajo se para. Eso es lo
                // que una hoja de competencias tiene que enseñar de un vistazo.
                const cobertura = coberturaDe(skill.id)
                const clase = cobertura === 0 ? 'cobertura--nadie' : cobertura === 1 ? 'cobertura--unico' : ''
                return (
                  <td
                    key={skill.id}
                    className={clase}
                    title={
                      cobertura === 0
                        ? `Nadie puede sacar «${skill.name}» adelante solo: hoy el equipo no cubre esto`
                        : cobertura === 1
                          ? `Un único especialista en «${skill.name}»: si falta, ese trabajo se para`
                          : `${String(cobertura)} personas de nivel 3 o superior en «${skill.name}»`
                    }
                  >
                    {cobertura}
                    {cobertura <= 1 ? <span className="cobertura__aviso"> ⚠</span> : null}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      )}
    </>
  )
}
