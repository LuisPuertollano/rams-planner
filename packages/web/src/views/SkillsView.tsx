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
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly onChanged: () => void
}

/**
 * La escala, explicada donde se usa. Un número del 1 al 5 no dice nada solo.
 *
 * Las etiquetas son el número; lo que significa cada uno vive en el
 * diccionario, porque eso sí se lee.
 */
const NIVELES = [0, 1, 2, 3, 4, 5] as const

const CLAVE_DEL_NIVEL: Readonly<Record<number, keyof Diccionario>> = {
  0: 'competencias.nivel.0',
  1: 'competencias.nivel.1',
  2: 'competencias.nivel.2',
  3: 'competencias.nivel.3',
  4: 'competencias.nivel.4',
  5: 'competencias.nivel.5',
}

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
    const name = window.prompt(t('competencias.pideNombre'))
    if (name === null || name.trim() === '') return
    const code = window.prompt(t('competencias.pideCodigo'), name.trim().slice(0, 20))
    if (code === null || code.trim() === '') return
    run(async () => { await createSkill(code.trim(), name.trim()) })
  }

  if (matrix === null || team === null) {
    return <div className="empty"><h3>{error ?? t('competencias.cargando')}</h3></div>
  }

  return (
    <>
      {error === null ? null : <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
      <div className="toolbar">
        <button className="button" onClick={nuevaCompetencia} disabled={busy}>
          {t('competencias.nueva')}
        </button>
        <span className="faint">{t('competencias.escala')}</span>
      </div>

      {team.length === 0 ? (
        <div className="empty">
          <h3>{t('competencias.sinEquipo')}</h3>
          <p>{t('competencias.sinEquipoDetalle', t('tab.equipo'))}</p>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>{t('col.persona')}</th>
              {matrix.skills.map((skill) => (
                <th key={skill.id} title={skill.name}>
                  <span className="skill-head">
                    {skill.code}
                    <button
                      className="skill-head__drop"
                      title={t('competencias.quitarTitulo', skill.name)}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(t('competencias.quitarConfirma', skill.name))
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
                        title={t(
                          'competencias.celda',
                          resource.displayName,
                          skill.name,
                          t(CLAVE_DEL_NIVEL[level] ?? 'competencias.nivel.0'),
                        )}
                        data-level={level}
                        onChange={(event) => {
                          const siguiente = Number(event.target.value)
                          run(async () => { await setResourceSkill(resource.id, skill.id, siguiente) })
                        }}
                      >
                        {NIVELES.map((nivel) => (
                          <option key={nivel} value={nivel}>{nivel === 0 ? '—' : nivel}</option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="row--total">
              <td title={t('competencias.autonomosTitulo')}>{t('competencias.autonomos')}</td>
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
                        ? t('competencias.cobertura.nadie', skill.name)
                        : cobertura === 1
                          ? t('competencias.cobertura.unico', skill.name)
                          : t('competencias.cobertura.varios', cobertura, skill.name)
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
