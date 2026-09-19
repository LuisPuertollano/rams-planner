import {
  importActualsCsv,
  importMonthlyCsv,
  importSplitsCsv,
  importChecklistCsv,
  importDocumentsCsv,
  importPlanCsv,
  importTeamCsv,
  type ActualsImported,
  type MonthlyImported,
  type SplitsImported,
  type ChecklistImported,
  type TipoDeCsv,
  type DocumentsImported,
  type PlanImported,
  type TeamImported,
} from '../api.js'
import { hours, shortDate } from '../format.js'
import { useT } from '../i18n/index.js'
import { ImportPanel } from './ImportPanel.js'

/**
 * Las siete cosas que se pueden cargar desde un CSV.
 *
 * Es un alias de `TipoDeCsv` y no una segunda unión: dos listas de lo mismo se
 * separan, y separarse aquí significa que un tipo pide un contrato y se carga
 * con otro importador.
 */
export type TipoDeImportacion = TipoDeCsv

interface Props {
  readonly tipo: TipoDeImportacion
  readonly onClose: () => void
  /**
   * Qué hacer cuando ha entrado. No es lo mismo en las tres: el plan recalcula
   * y hay que recargar la pantalla; el parte de horas no cambia ni una fecha.
   */
  readonly onImported?: (() => void) | undefined
  /** El CSV que ya hay, que es la mejor plantilla cuando existe. */
  readonly exportarUrl?: string | undefined
}

/**
 * El único sitio donde se dice cómo es cada importación.
 *
 * Antes cada botón traía su propio `ImportPanel` configurado a mano, y eso
 * aguantaba mientras hubo un botón. Con el menú «Calcular», la pantalla de
 * Importaciones y el catálogo de documentos pidiendo los mismos tres diálogos,
 * tres copias del mismo `resumen` habrían empezado a separarse a la primera
 * frase que alguien mejorase en una sola de ellas.
 *
 * Y hay una razón que no es de estilo: el panel tiene que sobrevivir a que se
 * cierre el menú desde el que se abrió. Si viviera dentro del menú, cerrarlo lo
 * desmontaría en mitad de la importación. Por eso quien lo abre guarda **qué**
 * está importando, y el diálogo se pinta arriba del todo.
 */
export function ImportDialog({ tipo, onClose, onImported, exportarUrl }: Props): React.JSX.Element {
  const { t, locale } = useT()

  // Un `switch` sin `default`, y no una cadena de «if» con una caída al final.
  // Es la diferencia entre que añadir un tipo a `TipoDeImportacion` sin su rama
  // sea un ERROR DE COMPILACIÓN o que se lleve en silencio el importador del
  // último `return`. Pasó: la Checkliste se cargaba contra el catálogo de
  // documentos, y el mensaje que salía —«falta la columna nombre»— era cierto
  // sobre un formato que nadie había elegido.
  switch (tipo) {
  case 'plan': {
    return (
      <ImportPanel<PlanImported>
        tipo="plan"
        onClose={onClose}
        importar={importPlanCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) =>
          t('importar.plan.hecho', r.projects, r.phases, r.tasks, r.dependencies, r.assignments)
        }
        avisos={(r) => [
          // El enlace con el catálogo va arriba porque es lo que decide si al
          // plan importado le llegan las subactividades y las fechas de puerta.
          ...(r.deliverables === 0 ? [] : [t('importar.plan.entregables', r.deliverables)]),
          ...(r.resourcesCreated.length === 0
            ? []
            : [t('importar.plan.personasNuevas', r.resourcesCreated.join(', '))]),
          ...r.warnings,
        ]}
      />
    )
  }

  case 'actuals': {
    // Sin `onImported` por defecto: cargar horas no recalcula nada, así que no
    // hay nada que recargar. Es la diferencia con el plan, y es a propósito.
    return (
      <ImportPanel<ActualsImported>
        tipo="actuals"
        onClose={onClose}
        importar={importActualsCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
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
    )
  }

  case 'monthly': {
    // Tampoco recalcula: son horas, no plan.
    return (
      <ImportPanel<MonthlyImported>
        tipo="monthly"
        onClose={onClose}
        importar={importMonthlyCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) =>
          t('mensual.resultado', hours(r.minutes, 0, locale), r.rows, r.saved, r.projects, r.people, r.from, r.to)
        }
        // El aviso que hay que dar siempre, porque es la mitad que falta: estas
        // horas no llegan a ninguna tarea hasta que alguien declare el reparto.
        avisos={() => [t('mensual.faltaElReparto')]}
      />
    )
  }

  case 'splits': {
    return (
      <ImportPanel<SplitsImported>
        tipo="splits"
        onClose={onClose}
        importar={importSplitsCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) => t('reparto.resultado', r.rows, r.saved, r.months)}
        avisos={(r) =>
          r.notHundred.length === 0 ? [] : [t('reparto.noSuman', r.notHundred.length)]
        }
      />
    )
  }

  case 'team': {
    // Cambiar una jornada o una tarifa cambia la capacidad y el coste, así que
    // esta importación SÍ recalcula: es la diferencia con el catálogo.
    return (
      <ImportPanel<TeamImported>
        tipo="team"
        onClose={onClose}
        importar={importTeamCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) =>
          t('equipo.importado', r.rows, r.created, r.updated, r.skillsSet, r.rates)
        }
        avisos={(r) => [
          ...(r.skillsCreated === 0 ? [] : [t('equipo.competenciasNuevas', r.skillsCreated)]),
          ...r.warnings,
        ]}
      />
    )
  }

  case 'documents': {
    return (
      <ImportPanel<DocumentsImported>
        tipo="documents"
        onClose={onClose}
        importar={importDocumentsCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) => t('documentos.importado', r.rows, r.created, r.updated, r.links, r.activities)}
        avisos={(r) => r.warnings}
      />
    )
  }

  case 'checklist': {
    return (
      <ImportPanel<ChecklistImported>
        tipo="checklist"
        onClose={onClose}
        importar={importChecklistCsv}
        onImported={onImported}
        exportarUrl={exportarUrl}
        resumen={(r) =>
          t('checklist.importado', r.queries, r.created, r.updated, r.gates, r.links)
        }
        avisos={(r) => [
          // Las puertas que nombra la hoja: es lo que hay que cotejar con las
          // que declaran los proyectos, y lo que destapa que la Checkliste
          // pregunta en una puerta que nadie ha fechado.
          t('checklist.importado.puertas', r.gateNames.join(', ')),
          ...(r.humanOnly === 0 ? [] : [t('checklist.importado.personas', r.humanOnly)]),
          ...r.warnings,
        ]}
      />
    )
  }
  }
}
