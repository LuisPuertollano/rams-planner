import type { Diccionario } from './i18n/index.js'

/**
 * La navegación, en un solo sitio.
 *
 * Antes eran catorce pestañas en fila y el nombre de cada una estaba escrito
 * **tres veces**: en el tipo `Tab`, en la unión de claves de `label` y en la de
 * `hint`. Cuarenta y dos cadenas que había que mantener a mano de acuerdo entre
 * sí, y que convertían «mover una pestaña de sitio» en un ejercicio de
 * paciencia. Aquí el nombre se escribe una vez y el compilador comprueba lo
 * demás: `ClaveDeTab` sale del diccionario, así que una errata no compila.
 */

type ClaveDeTab = Extract<keyof Diccionario, `tab.${string}`>
type ClaveDeGrupo = Extract<keyof Diccionario, `grupo.${string}`>
type ClaveDeNota = Extract<keyof Diccionario, `nota.${string}`>

/** Una pantalla concreta: lo que se pinta dentro del panel. */
export type VistaId =
  | 'hoy'
  | 'plan' | 'cronograma'
  | 'panel' | 'carga' | 'saturacion' | 'reparto' | 'informes'
  | 'equipo' | 'calendario' | 'competencias'
  | 'documentos' | 'importaciones'
  | 'comparar' | 'registro' | 'admin'

/** Un grupo: lo que se lee arriba. Seis, y no catorce. */
export type GrupoId = 'hoy' | 'plan' | 'capacidad' | 'equipo' | 'datos' | 'registro'

export interface Vista {
  readonly id: VistaId
  readonly label: ClaveDeTab
  readonly hint: ClaveDeTab
  /** La coletilla de la derecha: qué se puede tocar aquí y qué no. */
  readonly nota: ClaveDeNota
  /**
   * Con cuál de estos permisos se entra. Si no hay ninguno, la vista no se
   * enseña — pero eso es cortesía, no seguridad: quien escriba la URL a mano se
   * encuentra con un 403 del servidor igualmente.
   */
  readonly permission: readonly string[]
  /** El permiso hace falta en toda la herramienta, no sobre un proyecto. */
  readonly everywhere?: true
  /** Ni las tarjetas de cifras ni el sello del cálculo dicen nada en esta vista. */
  readonly sinCifras?: true
}

export interface Grupo {
  readonly id: GrupoId
  readonly label: ClaveDeGrupo
  readonly hint: ClaveDeGrupo
  readonly vistas: readonly Vista[]
}

export const GRUPOS: readonly Grupo[] = [
  {
    id: 'hoy',
    label: 'grupo.hoy',
    hint: 'grupo.hoy.pista',
    vistas: [
      {
        id: 'hoy',
        label: 'tab.hoy',
        hint: 'tab.hoy.pista',
        nota: 'nota.derivado',
        permission: ['carga.ver', 'plan.ver'],
      },
    ],
  },
  {
    id: 'plan',
    label: 'grupo.plan',
    hint: 'grupo.plan.pista',
    vistas: [
      {
        id: 'plan',
        label: 'tab.plan',
        hint: 'tab.plan.pista',
        nota: 'nota.plan',
        permission: ['plan.ver'],
      },
      {
        id: 'cronograma',
        label: 'tab.cronograma',
        hint: 'tab.cronograma.pista',
        nota: 'nota.derivado',
        permission: ['plan.ver'],
      },
    ],
  },
  {
    id: 'capacidad',
    label: 'grupo.capacidad',
    hint: 'grupo.capacidad.pista',
    vistas: [
      // El panel va primero: contesta «¿cabe el trabajo?» de un vistazo, y las
      // otras tres pantallas son el detalle de esa misma pregunta.
      {
        id: 'panel',
        label: 'tab.panel',
        hint: 'tab.panel.pista',
        nota: 'nota.derivado',
        permission: ['carga.ver'],
        everywhere: true,
        // El panel trae sus propias seis cifras y su propia línea de frescura.
        // Dejar además la fila global ponía «Personas sobrecargadas 6» justo
        // encima de «Por encima 0»: dos medidas distintas —el día y el mes—
        // contradiciéndose a diez centímetros.
        sinCifras: true,
      },
      {
        id: 'carga',
        label: 'tab.carga',
        hint: 'tab.carga.pista',
        nota: 'nota.derivado',
        permission: ['carga.ver'],
      },
      // La saturación es del equipo entero: con la carga de un solo proyecto,
      // la ocupación de una persona no es su ocupación.
      {
        id: 'saturacion',
        label: 'tab.saturacion',
        hint: 'tab.saturacion.pista',
        nota: 'nota.derivado',
        permission: ['carga.ver'],
        everywhere: true,
      },
      {
        id: 'reparto',
        label: 'tab.reparto',
        hint: 'tab.reparto.pista',
        nota: 'nota.derivado',
        permission: ['reparto.ver'],
      },
      // El informe se pide a su propia ruta y trae su ejecución dentro, así que
      // no depende de la que tenga cargada el resto de la aplicación.
      {
        id: 'informes',
        label: 'tab.informes',
        hint: 'tab.informes.pista',
        nota: 'nota.derivado',
        permission: ['informes.ver'],
        sinCifras: true,
      },
    ],
  },
  {
    id: 'equipo',
    label: 'grupo.equipo',
    hint: 'grupo.equipo.pista',
    vistas: [
      // La ficha del equipo es dato declarado: existe aunque todavía no se haya
      // calculado nada, y de hecho es por donde hay que empezar en una base de
      // datos vacía.
      {
        id: 'equipo',
        label: 'tab.equipo',
        hint: 'tab.equipo.pista',
        nota: 'nota.declarado',
        permission: ['equipo.ver'],
      },
      {
        id: 'calendario',
        label: 'tab.calendario',
        hint: 'tab.calendario.pista',
        nota: 'nota.derivado',
        permission: ['equipo.ver'],
      },
      {
        id: 'competencias',
        label: 'tab.competencias',
        hint: 'tab.competencias.pista',
        nota: 'nota.declarado',
        permission: ['competencias.ver'],
      },
    ],
  },
  {
    id: 'datos',
    label: 'grupo.datos',
    hint: 'grupo.datos.pista',
    vistas: [
      // El catálogo es dato declarado del equipo: existe aunque no haya ni un
      // proyecto, y de hecho conviene llenarlo antes.
      {
        id: 'documentos',
        label: 'tab.documentos',
        hint: 'tab.documentos.pista',
        nota: 'nota.documentos',
        permission: ['documentos.ver'],
        sinCifras: true,
      },
      {
        id: 'importaciones',
        label: 'tab.importaciones',
        hint: 'tab.importaciones.pista',
        nota: 'nota.importaciones',
        permission: ['importar', 'reales.registrar', 'documentos.gestionar'],
        sinCifras: true,
      },
    ],
  },
  {
    id: 'registro',
    label: 'grupo.registro',
    hint: 'grupo.registro.pista',
    vistas: [
      {
        id: 'comparar',
        label: 'tab.comparar',
        hint: 'tab.comparar.pista',
        nota: 'nota.derivado',
        permission: ['ejecuciones.ver'],
      },
      // El registro es dato propio: existe aunque no se haya calculado nada, y
      // de hecho lo primero que se registra es el alta de la primera persona.
      {
        id: 'registro',
        label: 'tab.registro',
        hint: 'tab.registro.pista',
        nota: 'nota.registro',
        permission: ['historial.ver'],
        sinCifras: true,
      },
      {
        id: 'admin',
        label: 'tab.admin',
        hint: 'tab.admin.pista',
        nota: 'nota.admin',
        permission: ['roles.gestionar', 'usuarios.gestionar'],
        sinCifras: true,
      },
    ],
  },
]

/** Todas las vistas, sin los grupos. Para buscar una por su identificador. */
export const VISTAS: readonly Vista[] = GRUPOS.flatMap((grupo) => grupo.vistas)
