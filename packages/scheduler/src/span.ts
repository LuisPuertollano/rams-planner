/**
 * La ventana de una tarea continua: de dónde a dónde, y qué hacer si no cuadra.
 *
 * Hay trabajo que no es un entregable. «Gestión del proyecto», «seguimiento RAM
 * mensual», «soporte durante la garantía»: no terminan un día, ocupan una fase
 * entera en paralelo con todo lo demás.
 *
 * La ecuación de la tarea —`trabajo = duración × dedicación`— se lee al revés
 * para ellas, y en eso está todo:
 *
 *   una tarea normal     el trabajo y la dedicación mandan; sale la DURACIÓN
 *   una tarea continua   la fase manda; sale la DEDICACIÓN
 *
 * Que es exactamente la pregunta que alguien se hace de verdad con la gestión
 * de un proyecto: no «¿cuánto dura?» —dura lo que dure el proyecto— sino «¿a
 * qué porcentaje tengo que llevar a esta persona para que quepa?».
 *
 * Aquí sólo se resuelven las dos anclas a dos fechas. El resto —ajustar al
 * calendario, medir los minutos laborables y sacar la intensidad— lo hace el
 * motor, que es quien tiene el calendario compilado.
 */

import { ANCLA_ARRANQUE, normalizeGate, type CalendarDate } from '@planner/domain'

/** Lo que hace falta de un proyecto para resolver un ancla. */
export interface ProyectoConPuertas {
  readonly statusStart: CalendarDate
  readonly gates: Readonly<Record<string, CalendarDate>>
}

/**
 * La fecha de un ancla, o el nombre de la puerta que falta.
 *
 * Se devuelve el nombre **tal y como lo escribió quien declaró la tarea**, no
 * el normalizado: el aviso lo lee una persona que busca esa palabra en su ficha
 * de proyecto, y «Iqa» escrito en mayúsculas no ayuda a encontrarla.
 */
export type Ancla =
  | { readonly hay: true; readonly date: CalendarDate }
  | { readonly hay: false; readonly falta: string }

export function resolverAncla(ancla: string, proyecto: ProyectoConPuertas): Ancla {
  const limpio = ancla.trim()
  if (limpio.toLowerCase() === ANCLA_ARRANQUE) return { hay: true, date: proyecto.statusStart }
  const fecha = proyecto.gates[normalizeGate(limpio)]
  return fecha === undefined ? { hay: false, falta: limpio } : { hay: true, date: fecha }
}
