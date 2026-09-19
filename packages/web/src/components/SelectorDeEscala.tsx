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
    <div className="toolbar" style={{ marginBottom: 8 }}>
      <span className="faint">{t('escala.titulo')}</span>
      {ESCALAS.map((escala) => (
        <button
          key={escala}
          className={valor === escala ? 'button button--primary' : 'button'}
          onClick={() => { onCambiar(escala) }}
        >
          {t(`escala.${escala}` as 'escala.mes')}
        </button>
      ))}
    </div>
  )
}
