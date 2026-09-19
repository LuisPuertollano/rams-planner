import { useEffect, useRef, useState } from 'react'
import type { Grupo, GrupoId, VistaId } from '../nav.js'
import { useT } from '../i18n/index.js'

interface Props {
  readonly grupos: readonly Grupo[]
  readonly grupoActivo: string | undefined
  readonly vista: VistaId | undefined
  readonly onVista: (id: VistaId) => void
  /**
   * Pulsar el grupo, que no es lo mismo que elegir una pantalla: vuelve a la
   * ÚLTIMA que estuviste viendo dentro de él. Sin eso, ir de Equipo →
   * Calendario → Plan → Equipo te devuelve a Equipo, y castiga justo a quien
   * usa más de una pantalla de un grupo.
   */
  readonly onGrupo: (id: GrupoId) => void
}

/**
 * Cuánto se espera antes de cerrar un menú al salir el ratón.
 *
 * Sin esta espera, el menú se cierra en el hueco que hay entre el botón y su
 * panel y no se puede llegar a él. Es el defecto clásico de los menús al pasar
 * el ratón, y 180 ms es lo que tarda una mano en cruzar ese hueco sin que la
 * espera se note como pereza.
 */
const CIERRE_MS = 180

/**
 * La navegación: seis grupos arriba, y lo que hay dentro de cada uno al pasar
 * el ratón por encima.
 *
 * ## Por qué esto sustituye a dos filas
 *
 * Antes había dos niveles **visibles a la vez**: los seis grupos en la barra y,
 * dentro del panel, una segunda fila con las pantallas del grupo activo. Esa
 * segunda fila ocupaba un renglón en todas las pantallas para enseñar entre una
 * y seis palabras, y sólo las de un grupo: para saber qué hay en «Capacidad»
 * había que irse a Capacidad.
 *
 * Aquí el segundo nivel aparece **bajo demanda y para cualquier grupo**: el
 * panel se ve sin salir de donde estás, con la frase de cada pantalla al lado,
 * que es lo que de verdad hace falta para elegir. Y el renglón se recupera para
 * el contenido, que es de lo que va todo este cambio.
 *
 * ## El ratón no es la única forma
 *
 * Pasar el ratón **abre**, pero no es el único camino ni el que manda:
 *
 * - Pulsar el grupo va a su primera pantalla, como antes. Nadie pierde un
 *   camino que ya tenía en los dedos.
 * - El foco del teclado abre el panel igual que el ratón, así que se recorre
 *   entero con el tabulador.
 * - `Escape` cierra y devuelve el foco al grupo.
 * - En una pantalla táctil no hay «pasar por encima»: ahí el primer toque abre
 *   el panel y el segundo entra, que es lo que hace el navegador por su cuenta
 *   con `:hover`, y por eso el botón del grupo también navega.
 */
export function NavBar({ grupos, grupoActivo, vista, onVista, onGrupo }: Props): React.JSX.Element {
  const { t } = useT()
  const [abierto, setAbierto] = useState<string | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelar = (): void => {
    if (temporizador.current !== null) clearTimeout(temporizador.current)
    temporizador.current = null
  }

  const abrir = (id: string): void => { cancelar(); setAbierto(id) }
  const cerrarLuego = (): void => {
    cancelar()
    temporizador.current = setTimeout(() => { setAbierto(null) }, CIERRE_MS)
  }

  // Un temporizador que sobrevive al desmontaje dispara sobre un componente que
  // ya no está. Es el aviso de React que nadie lee hasta que rompe una prueba.
  useEffect(() => cancelar, [])

  const ir = (id: VistaId): void => {
    cancelar()
    setAbierto(null)
    onVista(id)
  }

  return (
    <nav className="nav" aria-label={t('nav.titulo')}>
      {grupos.map((grupo) => {
        const activo = grupoActivo === grupo.id
        const desplegado = abierto === grupo.id
        // Un grupo con una sola pantalla no tiene nada que desplegar: enseñar
        // un panel con un único elemento repetido es ruido.
        const conPanel = grupo.vistas.length > 1
        return (
          <div
            key={grupo.id}
            className="nav__grupo"
            onMouseEnter={() => { if (conPanel) abrir(grupo.id) }}
            onMouseLeave={cerrarLuego}
            onFocus={() => { if (conPanel) abrir(grupo.id) }}
            onBlur={cerrarLuego}
            onKeyDown={(evento) => {
              if (evento.key === 'Escape' && desplegado) {
                evento.stopPropagation()
                cancelar()
                setAbierto(null)
              }
            }}
          >
            <button
              className="nav__boton"
              aria-current={activo ? 'page' : undefined}
              aria-expanded={conPanel ? desplegado : undefined}
              aria-haspopup={conPanel ? 'menu' : undefined}
              title={t(grupo.hint)}
              onClick={() => {
                cancelar()
                setAbierto(null)
                onGrupo(grupo.id)
              }}
            >
              {t(grupo.label)}
              {!conPanel ? null : <span className="nav__flecha" aria-hidden="true">▾</span>}
            </button>

            {!conPanel || !desplegado ? null : (
              <div className="nav__panel" role="menu">
                {grupo.vistas.map((item) => (
                  <button
                    key={item.id}
                    role="menuitem"
                    className="nav__item"
                    aria-current={item.id === vista ? 'page' : undefined}
                    onClick={() => { ir(item.id) }}
                  >
                    <span className="nav__item-nombre">{t(item.label)}</span>
                    {/* La frase de la pantalla es lo que hace elegible el menú:
                        sin ella son seis palabras sueltas. */}
                    <span className="nav__item-pista">{t(item.hint)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
