import { useState } from 'react'
import { useT } from '../i18n/index.js'

interface Props {
  /** Lo que se lee en el botón. */
  readonly etiqueta: string
  readonly titulo: string
  readonly principal?: boolean | undefined
  /**
   * Las opciones. Reciben `cerrar` porque una opción que abre un diálogo tiene
   * que cerrar el menú **ella**: el diálogo no vive aquí dentro, y si viviera,
   * cerrar el menú lo desmontaría.
   */
  readonly children: (cerrar: () => void) => React.ReactNode
}

/**
 * Un menú desplegable, para agrupar lo que cambia los datos.
 *
 * La cabecera tenía diez controles en fila y ninguna pista de cuáles se pueden
 * pulsar sin consecuencias. Mirar —el tema, el idioma, quién eres— y hacer
 * —recalcular, nivelar, congelar, importar— pesaban lo mismo, y eso hace que
 * «Recalcular» dé el mismo respeto que «Tema», que es justo al revés.
 *
 * El fondo se cierra al pulsar fuera igual que los otros paneles de la
 * herramienta; es el mismo `.backdrop`, no uno nuevo.
 */
export function Menu({ etiqueta, titulo, principal, children }: Props): React.JSX.Element {
  const { t } = useT()
  const [abierto, setAbierto] = useState(false)
  const cerrar = (): void => { setAbierto(false) }

  return (
    <div className="menu">
      <button
        className={principal === true ? 'button button--primary' : 'button'}
        aria-haspopup="menu"
        aria-expanded={abierto}
        title={titulo}
        onClick={() => { setAbierto(!abierto) }}
      >
        {etiqueta} ▾
      </button>

      {!abierto ? null : (
        <>
          <button className="backdrop" onClick={cerrar} aria-label={t('menu.cerrar')} />
          <div className="menu__panel" role="menu">
            {children(cerrar)}
          </div>
        </>
      )}
    </div>
  )
}
