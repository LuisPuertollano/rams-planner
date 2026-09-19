import { ESCALAS, type Escala } from '../periods.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly valor: Escala
  readonly onCambiar: (escala: Escala) => void
}

/**
 * En qué se agrupan las columnas: mes, trimestre o año.
 *
 * Vive en su propio componente porque lo usan tres pantallas y las tres tienen
 * que ofrecer lo mismo: una escala que en la matriz de carga signifique una
 * cosa y en la saturación otra sería peor que no tenerla.
 */
export function SelectorDeEscala({ valor, onCambiar }: Props): React.JSX.Element {
  const { t } = useT()
  return (
    <div className="toolbar">
      <span className="faint">{t('escala.titulo')}</span>
      {/* Tres opciones excluyentes son un control segmentado, no tres botones
          sueltos de los que uno va pintado: la forma ya dice que eliges una. */}
      <div className="segmentado" role="group" aria-label={t('escala.titulo')}>
        {ESCALAS.map((escala) => (
          <button
            key={escala}
            className="segmentado__opcion"
            aria-pressed={valor === escala}
            onClick={() => { onCambiar(escala) }}
          >
            {t(`escala.${escala}` as 'escala.mes')}
          </button>
        ))}
      </div>
    </div>
  )
}
