import { useEffect, useState } from 'react'
import {
  fetchGateReadiness,
  type GateEvidence,
  type GateEvidenceState,
  type GateReadiness,
} from '../api.js'
import { errorText } from '../errors.js'
import { fullDate } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'

interface Props {
  readonly projectId: string
  /** Cambia cuando se recalcula: así la tabla no se queda con cifras viejas. */
  readonly version: number
}

const estadoDe = (estado: GateEvidenceState): keyof Diccionario =>
  `puertas.estado.${estado}` as keyof Diccionario

/** Sólo dos estados piden acción; los otros tres son información. */
const MAL: ReadonlySet<GateEvidenceState> = new Set<GateEvidenceState>(['tarde', 'sin-partir'])

/**
 * Cómo llega el proyecto a cada una de sus puertas (ADR-0056).
 *
 * La pantalla de arriba mira **desde la tarea**: a cada entrega se le propone
 * su fecha objetivo. Esta mira **desde la puerta**, que es como la mira una
 * revisión de certificación: qué espera cada puerta, qué hay en el plan y qué
 * falta. Las dos cifras que no salen de ningún otro sitio son «llega tarde» y
 * «no está en el plan», y por eso van en la cabecera de cada puerta y no
 * escondidas en una columna.
 *
 * No escribe nada. Se sirve de una ejecución concreta y la enseña con su
 * `runId`, como el informe, para que dos personas miren los mismos días.
 */
export function GateReadinessPanel({ projectId, version }: Props): React.JSX.Element | null {
  const { t } = useT()
  const [datos, setDatos] = useState<GateReadiness | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (projectId === '') return
    setError(null)
    fetchGateReadiness(projectId)
      .then((resultado) => {
        setDatos(resultado)
        // Se abren solas las puertas que piden algo: si todo llega, no hay
        // nada que leer y una tabla de cuatrocientas filas estorba.
        setAbiertas(
          new Set(
            resultado.gates
              .filter((puerta) => puerta.totals.tarde + puerta.totals.sinPartir > 0)
              .map((puerta) => puerta.gate),
          ),
        )
      })
      .catch((cause: unknown) => {
        setDatos(null)
        setError(errorText(t, cause, 'error.local.puertasPreparacion'))
      })
  }, [projectId, version, t])

  if (error !== null) return <div className="error-banner">{error}</div>
  if (datos === null) return null
  if (datos.runId === null) {
    return (
      <p className="faint" style={{ marginTop: 10 }}>{t('puertas.preparacion.sinCalculo')}</p>
    )
  }
  if (datos.gates.length === 0) {
    return <p className="faint" style={{ marginTop: 10 }}>{t('puertas.preparacion.nada')}</p>
  }

  const alternar = (gate: string): void => {
    setAbiertas((previo) => {
      const nuevo = new Set(previo)
      if (nuevo.has(gate)) nuevo.delete(gate)
      else nuevo.add(gate)
      return nuevo
    })
  }

  const celda = (fila: GateEvidence): React.JSX.Element => (
    <tr key={`${fila.documentTypeId}-${fila.maturity ?? ''}`}>
      <td>
        <b>{fila.documentCode}</b>
        {/* Muchos entregables se llaman como su código; repetirlo no informa. */}
        {fila.documentName === fila.documentCode ? null : (
          <> <span className="faint">{fila.documentName}</span></>
        )}
      </td>
      <td>{fila.maturity ?? <span className="faint">{t('puertas.preparacion.final')}</span>}</td>
      <td className={MAL.has(fila.state) ? 'bad' : 'faint'}>
        {t(estadoDe(fila.state))}
        {fila.daysLate === null ? null : ` · ${t('puertas.preparacion.dias', fila.daysLate)}`}
      </td>
      <td className="faint">
        {fila.dueOn === null
          ? '—'
          : fila.weeks === 0
            ? fullDate(fila.dueOn)
            : t('puertas.preparacion.limite', fullDate(fila.dueOn), fila.weeks ?? 0)}
      </td>
      <td>{fila.finish === null ? <span className="faint">—</span> : fullDate(fila.finish)}</td>
      <td className="faint">{fila.taskName ?? '—'}</td>
    </tr>
  )

  return (
    <>
      <h4>{t('puertas.preparacion.titulo')}</h4>
      <p className="faint" style={{ margin: '0 0 8px', maxWidth: '90ch' }}>
        {t('puertas.preparacion.explica')}
      </p>

      {datos.gates.map((puerta) => {
        const abierta = abiertas.has(puerta.gate)
        const pide = puerta.totals.tarde + puerta.totals.sinPartir
        return (
          <div key={puerta.gate} style={{ marginTop: 10 }}>
            <button
              className="button"
              aria-expanded={abierta}
              onClick={() => { alternar(puerta.gate) }}
            >
              {abierta ? '▾' : '▸'} <b>{puerta.gate}</b>
              {puerta.date === null
                ? ` · ${t('puertas.preparacion.sinFecha')}`
                : ` · ${fullDate(puerta.date)}`}
              {' · '}
              {t('puertas.preparacion.resumen', puerta.totals.esperadas, puerta.totals.aTiempo)}
              {pide === 0 ? null : (
                <span className="bad">
                  {' · '}
                  {t('puertas.preparacion.pide', puerta.totals.tarde, puerta.totals.sinPartir)}
                </span>
              )}
            </button>
            {!abierta ? null : (
              <table className="grid grid--inline">
                <thead>
                  <tr>
                    <th>{t('puertas.col.entregable')}</th>
                    <th>{t('puertas.preparacion.col.madurez')}</th>
                    <th>{t('puertas.preparacion.col.estado')}</th>
                    <th>{t('puertas.preparacion.col.limite')}</th>
                    <th>{t('puertas.preparacion.col.termina')}</th>
                    <th>{t('puertas.col.tarea')}</th>
                  </tr>
                </thead>
                <tbody>{puerta.evidence.map(celda)}</tbody>
              </table>
            )}
          </div>
        )
      })}
    </>
  )
}
