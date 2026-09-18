import { useState } from 'react'
import { importActualsCsv, type ActualsImported } from '../api.js'
import { hours, shortDate } from '../format.js'
import { useT } from '../i18n/index.js'
import { ImportPanel } from './ImportPanel.js'

/**
 * Cargar el parte de horas.
 *
 * Hermano del de importar el plan y deliberadamente no el mismo: **no
 * recalcula**. El plan dice cuándo puede pasar el trabajo y lo que ya pasó no
 * cambia esa respuesta, así que cargar horas no invalida nada de lo que hay en
 * pantalla, y por eso tampoco avisa a nadie de que recargue.
 *
 * Aquí estaba además el peor caso de la plantilla escondida: el enlace sólo
 * aparecía dentro del panel de resultados, o sea **después** de importar, que
 * es exactamente cuando ya no sirve para nada.
 */
export function ImportActualsButton(): React.JSX.Element {
  const { t, locale } = useT()
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <button
        className="button"
        title={t('horas.importarTitulo')}
        onClick={() => { setAbierto(true) }}
      >
        {t('horas.importar')}
      </button>

      {!abierto ? null : (
        <ImportPanel<ActualsImported>
          tipo="actuals"
          onClose={() => { setAbierto(false) }}
          importar={importActualsCsv}
          resumen={(r) =>
            t(
              'horas.resultado',
              hours(r.minutes, 0, locale),
              r.rows,
              r.saved,
              r.projects,
              r.people,
              shortDate(r.from),
              shortDate(r.to),
            )
          }
          avisos={(r) => r.warnings}
        />
      )}
    </>
  )
}
