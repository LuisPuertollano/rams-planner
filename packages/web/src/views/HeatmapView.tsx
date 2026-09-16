import { useMemo, useState } from 'react'
import type { Resource, UtilizationCell } from '../api.js'
import { hours, monthLabel, percent, utilizationColor } from '../format.js'
import { activePeriods } from '../periods.js'

interface Props {
  readonly resources: readonly Resource[]
  readonly utilization: readonly UtilizationCell[]
}

/**
 * Mapa de calor de saturación.
 *
 * La escala es divergente y está centrada en el 100 %: el color no dice «mucho
 * o poco trabajo», dice «te pasas o no te pasas», que es la única pregunta que
 * importa aquí.
 */
export function HeatmapView({ resources, utilization }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<UtilizationCell | null>(null)

  const periods = useMemo(
    () => activePeriods(utilization.filter((cell) => cell.plannedMinutes > 0).map((cell) => cell.period)),
    [utilization],
  )
  const byKey = useMemo(() => {
    const map = new Map<string, UtilizationCell>()
    for (const cell of utilization) map.set(`${cell.resourceId}|${cell.period}`, cell)
    return map
  }, [utilization])

  if (periods.length === 0) {
    return <div className="empty"><h3>Sin capacidad que representar</h3></div>
  }

  return (
    <>
      <table className="grid">
        <thead>
          <tr>
            <th>Recurso</th>
            {periods.map((period) => (
              <th key={period}>{monthLabel(period)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => (
            <tr key={resource.id}>
              <td>{resource.displayName}</td>
              {periods.map((period) => {
                const cell = byKey.get(`${resource.id}|${period}`)
                const bp = cell?.utilizationBp ?? null
                const isEmpty = (cell?.plannedMinutes ?? 0) === 0
                return (
                  <td key={period} style={{ padding: 0 }}>
                    <button
                      className="heat"
                      style={{
                        background: isEmpty ? 'transparent' : utilizationColor(bp),
                        color: isEmpty ? 'var(--text-faint)' : undefined,
                      }}
                      onClick={() => { setSelected(cell ?? null) }}
                      title={`${resource.displayName} · ${monthLabel(period)}: ${hours(cell?.plannedMinutes ?? 0)} h de ${hours(cell?.capacityMinutes ?? 0)} h`}
                    >
                      {isEmpty ? '·' : percent(bp)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
        <div className="legend">
          <span>Saturación:</span>
          {[
            ['util-low', 'holgado (< 60 %)'],
            ['util-ok', 'equilibrado'],
            ['util-full', 'al límite (~100 %)'],
            ['util-over', 'pasado'],
            ['util-critical', 'insostenible (> 130 %)'],
          ].map(([token, label]) => (
            <span key={token}>
              <span className="legend__swatch" style={{ background: `var(--${token ?? ''})` }} />
              {label}
            </span>
          ))}
        </div>
        {selected === null ? (
          <p className="faint" style={{ marginBottom: 0 }}>
            Un recurso puede estar equilibrado al mes y saturado tres días concretos. El mes es la mentira cómoda;
            el motor guarda el día.
          </p>
        ) : (
          <p style={{ marginBottom: 0 }}>
            <b>{resources.find((r) => r.id === selected.resourceId)?.displayName}</b> en{' '}
            {monthLabel(selected.period)}: {hours(selected.plannedMinutes, 1)} h planificadas sobre{' '}
            {hours(selected.capacityMinutes, 1)} h de capacidad ({percent(selected.utilizationBp)}).{' '}
            {selected.capacityMinutes - selected.plannedMinutes >= 0
              ? `Le quedan ${hours(selected.capacityMinutes - selected.plannedMinutes, 1)} h libres.`
              : `Le faltan ${hours(selected.plannedMinutes - selected.capacityMinutes, 1)} h.`}
          </p>
        )}
      </div>
    </>
  )
}
