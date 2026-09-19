import { useEffect, useState } from 'react'
import {
  fetchGateChecklist,
  type ConsultaResuelta,
  type EstadoDeConsulta,
  type GateChecklist,
} from '../api.js'
import { errorText } from '../errors.js'
import { fullDate } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly projectId: string
  readonly version: number
}

const estadoDe = (estado: EstadoDeConsulta): keyof Diccionario =>
  `checklist.estado.${estado}` as keyof Diccionario

/**
 * El tono de cada estado.
 *
 * «La contesta una persona» va en neutro a propósito: no es un fallo, es media
 * Checkliste. Pintarlo de ámbar convertiría la mitad del cuestionario en un
 * problema y haría que nadie mirase los que sí lo son.
 */
const TONO: Readonly<Record<EstadoDeConsulta, string>> = {
  cumple: 'chip chip--bien',
  // Vigente de antes NO es un fallo, pero tampoco es «recién entregado»: el
  // punto hueco dice que la respuesta existe y que su antigüedad la juzga
  // una persona.
  'vigente-de-antes': 'chip chip--neutro',
  'no-cumple': 'chip chip--mal',
  'sin-saber': 'chip chip--neutro',
  'la-contesta-una-persona': 'chip chip--neutro',
  'puerta-sin-fechar': 'chip chip--aviso',
}

/** Una M que falla suspende la puerta. Las demás avisan, y se nota. */
const TONO_NIVEL: Readonly<Record<string, string>> = {
  M: 'chip chip--mal',
  HR: 'chip chip--aviso',
  R: 'chip',
  C: 'chip',
}

/**
 * La Checkliste de la puerta, contestada con lo que el plan ya sabe (ADR-0058).
 *
 * Esta pantalla existe para hacer visible un reparto: de las consultas de la
 * hoja, las que nombran un entregable llegan **ya contestadas**, con su fecha;
 * las que no, las contesta una persona. Saber cuáles son antes de entrar en la
 * sala es lo que convierte una lista de cincuenta y una en una de veinticuatro.
 *
 * Se abren solas las puertas que tienen alguna consulta sin cumplir. Si todo
 * cumple, no hay nada que leer.
 */
export function GateChecklistPanel({ projectId, version }: Props): React.JSX.Element | null {
  const { t } = useT()
  const [datos, setDatos] = useState<GateChecklist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const [soloPendientes, setSoloPendientes] = useState(true)

  useEffect(() => {
    if (projectId === '') return
    setError(null)
    fetchGateChecklist(projectId)
      .then((resultado) => {
        setDatos(resultado)
        setAbiertas(
          new Set(
            resultado.gates
              .filter((puerta) => puerta.totals.noCumplen > 0)
              .map((puerta) => puerta.gate),
          ),
        )
      })
      .catch((cause: unknown) => {
        setDatos(null)
        setError(errorText(t, cause, 'error.local.checklistLeer'))
      })
  }, [projectId, version, t])

  if (error !== null) return <div className="error-banner">{error}</div>
  if (datos === null) return null

  // Sin ninguna hoja cargada no se enseña una tabla vacía: se dice qué falta.
  if (datos.disciplines.length === 0) {
    return (
      <>
        <h4>{t('checklist.titulo')}</h4>
        <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
          {t('checklist.sinHoja')}
        </p>
      </>
    )
  }
  if (datos.runId === null || datos.gates.length === 0) {
    return (
      <>
        <h4>{t('checklist.titulo')}</h4>
        <p className="faint" style={{ margin: '0 0 8px' }}>
          {datos.runId === null ? t('checklist.sinCalculo') : t('checklist.nada')}
        </p>
      </>
    )
  }

  const alternar = (gate: string): void => {
    setAbiertas((previo) => {
      const nuevo = new Set(previo)
      if (nuevo.has(gate)) nuevo.delete(gate)
      else nuevo.add(gate)
      return nuevo
    })
  }

  const fila = (consulta: ConsultaResuelta): React.JSX.Element => (
    <tr key={`${consulta.queryId}-${consulta.code}`}>
      <td><b>{consulta.code}</b></td>
      <td>
        {consulta.question}
        {consulta.proofRequest === null ? null : (
          <span className="faint" style={{ display: 'block' }}>{consulta.proofRequest}</span>
        )}
      </td>
      <td><span className={TONO_NIVEL[consulta.level] ?? 'chip'}>{consulta.level}</span></td>
      <td><span className={TONO[consulta.state]}>{t(estadoDe(consulta.state))}</span></td>
      <td className="faint">
        {consulta.evidence.length === 0
          ? '—'
          : consulta.evidence
              .map(
                (fuente) =>
                  `${fuente.cell.documentCode}` +
                  `${fuente.cell.maturity === null ? '' : ` · ${fuente.cell.maturity}`}` +
                  // De dónde sale, cuando no sale de esta puerta. Sin esto, la
                  // fila dice «cumple» sin decir que la prueba es de hace un año.
                  `${fuente.current ? '' : ` (${fuente.gate})`}`,
              )
              .join(', ')}
      </td>
    </tr>
  )

  return (
    <>
      <h4>{t('checklist.titulo')}</h4>
      <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
        {t('checklist.explica')}
      </p>

      <div className="toolbar">
        <label className="faint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(evento) => { setSoloPendientes(evento.target.checked) }}
          />
          {t('checklist.soloPendientes')}
        </label>
        <span className="faint">
          {t(
            'checklist.reparto',
            datos.totals?.consultas ?? 0,
            (datos.totals?.consultas ?? 0) - (datos.totals?.deUnaPersona ?? 0),
            datos.totals?.deUnaPersona ?? 0,
          )}
        </span>
      </div>

      {datos.gates.map((puerta) => {
        const abierta = abiertas.has(puerta.gate)
        const visibles = soloPendientes
          ? puerta.queries.filter((consulta) => consulta.state !== 'cumple')
          : puerta.queries
        return (
          <div key={puerta.gate} style={{ marginTop: 10 }}>
            <button
              className="button"
              aria-expanded={abierta}
              onClick={() => { alternar(puerta.gate) }}
            >
              {abierta ? '▾' : '▸'} <b>{puerta.gate}</b>
              {puerta.date === null
                ? ` · ${t('checklist.sinFecha')}`
                : ` · ${fullDate(puerta.date)}`}
              {' · '}
              {t('checklist.resumen', puerta.totals.consultas, puerta.totals.cumplen)}
              {puerta.totals.obligatoriasQueFallan === 0 ? null : (
                <span className="bad">
                  {' · '}
                  {t('checklist.suspende', puerta.totals.obligatoriasQueFallan)}
                </span>
              )}
            </button>
            {!abierta ? null : visibles.length === 0 ? (
              <p className="faint" style={{ margin: '6px 0 0' }}>{t('checklist.todoCumple')}</p>
            ) : (
              <table className="grid grid--texto">
                <thead>
                  <tr>
                    <th>{t('checklist.col.codigo')}</th>
                    <th>{t('checklist.col.consulta')}</th>
                    <th>{t('checklist.col.nivel')}</th>
                    <th>{t('checklist.col.estado')}</th>
                    <th>{t('checklist.col.entregables')}</th>
                  </tr>
                </thead>
                <tbody>{visibles.map(fila)}</tbody>
              </table>
            )}
          </div>
        )
      })}
    </>
  )
}
