import { Menu } from './Menu.js'
import { ESCALAS, porcentajeDeEscala, type Escala } from '../escala.js'
import { IDIOMAS, NOMBRE_DEL_IDIOMA, useT, type Idioma } from '../i18n/index.js'

export type Tema = 'auto' | 'light' | 'dark'

const TEMAS: readonly Tema[] = ['light', 'auto', 'dark']

interface Props {
  readonly tema: Tema
  readonly onTema: (tema: Tema) => void
  readonly idioma: Idioma
  readonly onIdioma: (idioma: Idioma) => void
  readonly escala: Escala
  readonly onEscala: (escala: Escala) => void
}

/**
 * «Vista»: cómo ves tú la herramienta.
 *
 * Tres ajustes que no cambian ni un dato —tema, idioma y zoom— viven juntos en
 * un menú en vez de sueltos en la barra. Antes ocupaban tres controles fijos de
 * distinta forma cada uno: un botón con un símbolo, un desplegable y nada para
 * el zoom porque no existía. Se usan una vez al mes y estaban permanentemente
 * en pantalla, al lado de «Calcular», que se usa a diario.
 *
 * La regla que los junta es la misma que separa «Calcular» del resto: lo que
 * **cambia los datos** manda en la barra; lo que cambia **cómo los miras** se
 * guarda. Y por eso el menú no dice «Ajustes», que no significa nada: dice qué
 * hace.
 */
export function MenuVista({
  tema,
  onTema,
  idioma,
  onIdioma,
  escala,
  onEscala,
}: Props): React.JSX.Element {
  const { t } = useT()

  return (
    <Menu etiqueta={t('menu.vista')} titulo={t('menu.vista.titulo')}>
      {() => (
        <div className="ajustes">
          <div className="ajustes__fila">
            <span className="ajustes__nombre">{t('vista.zoom')}</span>
            <div className="segmentado" role="group" aria-label={t('vista.zoom')}>
              {ESCALAS.map((escalon) => (
                <button
                  key={escalon}
                  className="segmentado__opcion"
                  aria-pressed={escalon === escala}
                  onClick={() => { onEscala(escalon) }}
                >
                  {t('vista.zoom.porciento', porcentajeDeEscala(escalon))}
                </button>
              ))}
            </div>
            {/* El zoom decide cuánto cabe, no sólo cómo de grande se ve: esa es
                la diferencia con el del navegador y conviene decirla. */}
            <span className="ajustes__pista">{t('vista.zoom.pista')}</span>
          </div>

          <div className="ajustes__fila">
            <span className="ajustes__nombre">{t('vista.tema')}</span>
            <div className="segmentado" role="group" aria-label={t('vista.tema')}>
              {TEMAS.map((opcion) => (
                <button
                  key={opcion}
                  className="segmentado__opcion"
                  aria-pressed={opcion === tema}
                  onClick={() => { onTema(opcion) }}
                >
                  {t(`vista.tema.${opcion}` as 'vista.tema.auto')}
                </button>
              ))}
            </div>
            <span className="ajustes__pista">{t('vista.tema.pista')}</span>
          </div>

          <div className="ajustes__fila">
            <span className="ajustes__nombre">{t('vista.idioma')}</span>
            <div className="segmentado" role="group" aria-label={t('vista.idioma')}>
              {IDIOMAS.map((codigo) => (
                <button
                  key={codigo}
                  className="segmentado__opcion"
                  aria-pressed={codigo === idioma}
                  onClick={() => { onIdioma(codigo) }}
                >
                  {/* Cada idioma escrito en el suyo: quien abre esto sin
                      entender la pantalla necesita reconocerlo, no leerlo. */}
                  {NOMBRE_DEL_IDIOMA[codigo]}
                </button>
              ))}
            </div>
            <span className="ajustes__pista">{t('vista.idioma.pista')}</span>
          </div>
        </div>
      )}
    </Menu>
  )
}
