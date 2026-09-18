import { useState } from 'react'
import { ImportDialog, type TipoDeImportacion } from '../components/ImportDialog.js'
import { useT, type Traductor } from '../i18n/index.js'

interface Props {
  readonly puede: (code: string) => boolean
  /** El plan recalcula al importarse; el resto de la pantalla tiene que enterarse. */
  readonly onPlanImportado: () => void
}

interface Ficha {
  readonly tipo: TipoDeImportacion
  readonly permiso: string
  readonly titulo: (t: Traductor['t']) => string
  readonly que: (t: Traductor['t']) => string
  readonly exportarUrl?: string
}

const FICHAS: readonly Ficha[] = [
  {
    tipo: 'plan',
    permiso: 'importar',
    titulo: (t) => t('importaciones.plan.titulo'),
    que: (t) => t('importaciones.plan.que'),
  },
  {
    tipo: 'actuals',
    permiso: 'reales.registrar',
    titulo: (t) => t('importaciones.horas.titulo'),
    que: (t) => t('importaciones.horas.que'),
  },
  {
    tipo: 'team',
    permiso: 'equipo.editar',
    titulo: (t) => t('importaciones.equipo.titulo'),
    que: (t) => t('importaciones.equipo.que'),
  },
  {
    tipo: 'documents',
    permiso: 'documentos.gestionar',
    titulo: (t) => t('importaciones.documentos.titulo'),
    que: (t) => t('importaciones.documentos.que'),
    exportarUrl: '/api/documents/export.csv',
  },
]

/**
 * Dónde va cada CSV.
 *
 * Los dos botones de importar vivían en la cabecera, entre el selector de tema y
 * el de idioma, y el tercero estaba escondido dentro del catálogo de documentos.
 * Quien llegaba con una hoja de cálculo tenía que adivinar cuál de los tres era
 * el suyo mirando tres sitios distintos.
 *
 * Esta pantalla no importa nada por su cuenta: abre el mismo diálogo de siempre,
 * que es el que explica el contrato y trae la plantilla. Lo único que añade es
 * la respuesta a «¿qué se puede cargar aquí?», que antes no estaba escrita en
 * ningún sitio.
 */
export function ImportsView({ puede, onPlanImportado }: Props): React.JSX.Element {
  const { t } = useT()
  const [abierta, setAbierta] = useState<TipoDeImportacion | null>(null)

  const mias = FICHAS.filter((ficha) => puede(ficha.permiso))

  if (mias.length === 0) {
    return (
      <div className="empty">
        <h3>{t('importaciones.sinPermiso.titulo')}</h3>
        <p>{t('importaciones.sinPermiso.texto')}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {abierta === null ? null : (
        <ImportDialog
          tipo={abierta}
          onClose={() => { setAbierta(null) }}
          onImported={abierta === 'plan' ? onPlanImportado : undefined}
          exportarUrl={FICHAS.find((ficha) => ficha.tipo === abierta)?.exportarUrl}
        />
      )}

      <p className="faint" style={{ marginTop: 0 }}>{t('importaciones.nota')}</p>

      <div className="stat-row">
        {mias.map((ficha) => (
          <div className="stat" key={ficha.tipo} style={{ flexBasis: 260 }}>
            <div className="stat__label">{ficha.titulo(t)}</div>
            <p style={{ fontSize: 13, margin: '6px 0 12px', color: 'var(--text-muted)' }}>
              {ficha.que(t)}
            </p>
            <button className="button" onClick={() => { setAbierta(ficha.tipo) }}>
              {t('importaciones.abrir')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
