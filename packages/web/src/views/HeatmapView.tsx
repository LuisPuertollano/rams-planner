import { useMemo, useState } from 'react'
import type { Resource, UtilizationCell } from '../api.js'
import { hours, percent, periodLabel, utilizationColor } from '../format.js'
import { useT, type Diccionario } from '../i18n/index.js'
import { agrupar, periodosActivos, sumaSaturacion, type Escala } from '../periods.js'
import { SelectorDeEscala } from '../components/SelectorDeEscala.js'

interface Props {
  readonly resources: readonly Resource[]
  readonly utilization: readonly UtilizationCell[]
}

/** Los cinco tramos de la escala, con el color y la frase que los nombra. */
const TRAMOS: readonly (readonly [string, keyof Diccionario])[] = [
  ['util-low', 'saturacion.holgado'],
  ['util-ok', 'saturacion.equilibrado'],
  ['util-full', 'saturacion.alLimite'],
  ['util-over', 'saturacion.pasado'],
  ['util-critical', 'saturacion.insostenible'],
]

/**
 * Mapa de calor de saturación.
 *
 * La escala es divergente y está centrada en el 100 %: el color no dice «mucho
 * o poco trabajo», dice «te pasas o no te pasas», que es la única pregunta que
 * importa aquí.
 */
export function HeatmapView({ resources, utilization }: Props): React.JSX.Element {
  const { t, locale } = useT()
  const [selected, setSelected] = useState<UtilizationCell | null>(null)
  const [escala, setEscala] = useState<Escala>('mes')

  // La saturación de un año NO es la media de las de sus meses: es el trabajo
  // del año entre la capacidad del año. La cuenta la pone `sumaSaturacion`.
  const celdas = useMemo(
    () => agrupar(utilization, escala, (cell) => cell.resourceId, sumaSaturacion),
    [utilization, escala],
  )

  const periods = useMemo(
    () => periodosActivos(utilization.filter((cell) => cell.plannedMinutes > 0).map((cell) => cell.period), escala),
    [utilization, escala],
  )
  const byKey = useMemo(() => {
    const map = new Map<string, UtilizationCell>()
    for (const cell of celdas) map.set(`${cell.resourceId}|${cell.period}`, cell)
    return map
  }, [celdas])

  if (periods.length === 0) {
    return <div className="empty"><h3>{t('saturacion.vacio')}</h3></div>
  }

  return (
    <>
      <SelectorDeEscala valor={escala} onCambiar={setEscala} />
      <table className="grid">
        <thead>
          <tr>
            <th>{t('col.recurso')}</th>
            {periods.map((period) => (
              <th key={period}>{periodLabel(period, locale, t('escala.letraTrimestre'))}</th>
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
                      title={`${resource.displayName} · ${periodLabel(period, locale, t('escala.letraTrimestre'))}: ${hours(cell?.plannedMinutes ?? 0)} h de ${hours(cell?.capacityMinutes ?? 0)} h`}
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
          <span>{t('saturacion.leyenda')}</span>
          {TRAMOS.map(([token, clave]) => (
            <span key={token}>
              <span className="legend__swatch" style={{ background: `var(--${token})` }} />
              {t(clave)}
            </span>
          ))}
        </div>
        {selected === null ? (
          <p className="faint" style={{ marginBottom: 0 }}>{t('saturacion.nota')}</p>
        ) : (
          <p style={{ marginBottom: 0 }}>
            {t(
              'saturacion.detalle',
              resources.find((r) => r.id === selected.resourceId)?.displayName ?? '',
              periodLabel(selected.period, locale, t('escala.letraTrimestre')),
              hours(selected.plannedMinutes, 1),
              hours(selected.capacityMinutes, 1),
              percent(selected.utilizationBp),
            )}{' '}
            {selected.capacityMinutes - selected.plannedMinutes >= 0
              ? t('saturacion.libres', hours(selected.capacityMinutes - selected.plannedMinutes, 1))
              : t('saturacion.faltan', hours(selected.plannedMinutes - selected.capacityMinutes, 1))}
          </p>
        )}
      </div>
    </>
  )
}
