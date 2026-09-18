import { useState } from 'react'
import { importPlanCsv, type PlanImported } from '../api.js'
import { useT } from '../i18n/index.js'
import { ImportPanel } from './ImportPanel.js'

interface Props {
  readonly onImported: () => void
}

/**
 * Importar un plan entero desde el CSV que cualquiera ya tiene en Excel.
 *
 * El botón ya no abre el selector de ficheros: abre el panel que explica qué
 * fichero hace falta. Pedir un fichero sin decir qué forma tiene que tener era
 * pedirle a alguien que adivine, y la plantilla estaba escondida detrás de otro
 * botón que no decía para qué servía.
 */
export function ImportButton({ onImported }: Props): React.JSX.Element {
  const { t } = useT()
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <button
        className="button"
        title={t('importar.plan.titulo')}
        onClick={() => { setAbierto(true) }}
      >
        {t('boton.importar')}
      </button>

      {!abierto ? null : (
        <ImportPanel<PlanImported>
          tipo="plan"
          onClose={() => { setAbierto(false) }}
          importar={importPlanCsv}
          onImported={onImported}
          resumen={(r) =>
            t('importar.plan.hecho', r.projects, r.phases, r.tasks, r.dependencies, r.assignments)
          }
          avisos={(r) => [
            ...(r.resourcesCreated.length === 0
              ? []
              : [t('importar.plan.personasNuevas', r.resourcesCreated.join(', '))]),
            ...r.warnings,
          ]}
        />
      )}
    </>
  )
}
