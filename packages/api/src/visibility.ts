/**
 * Recortar lo que se devuelve a los proyectos que quien pregunta puede ver.
 *
 * Es la otra mitad de los permisos por proyecto. El guardián decide si una
 * petición pasa; esto decide qué sale por la puerta. Sin ello, un rol concedido
 * sobre un proyecto vería el plan entero en cuanto pidiera `/api/state`, que es
 * justamente lo que la concesión por proyecto promete que no pasa.
 *
 * La regla, cuando algo no pertenece a ningún proyecto —la saturación de una
 * persona, un hallazgo sobre alguien del equipo—, es exigir el permiso **en
 * toda la herramienta**: un dato de todo el equipo no se sirve a quien sólo
 * tiene un trozo. La alternativa, enseñarlo a medias, daría un número que no
 * significa nada y que además delata lo que no se puede ver.
 */

import type { FastifyRequest } from 'fastify'
import { projectsWhere } from '@planner/persistence'

/** `'all'` o el conjunto concreto. Un conjunto vacío significa «nada». */
export type Visible = 'all' | ReadonlySet<string>

export function visibleProjects(request: FastifyRequest, code: string): Visible {
  // Instalación todavía sin usuarios: el guardián ya ha dejado pasar y aquí
  // tampoco se recorta nada. Es el modo abierto, y viene con su aviso.
  if (request.permisos === undefined) return 'all'
  const alcance = projectsWhere(request.permisos, code)
  return alcance === 'all' ? 'all' : new Set(alcance)
}

/** ¿Se puede ver lo que no es de ningún proyecto? Sólo con el permiso global. */
export function seesEverything(visible: Visible): boolean {
  return visible === 'all'
}

/**
 * Deja sólo las filas de proyectos visibles.
 *
 * `projectOf` devuelve `null` para las filas que no son de ningún proyecto;
 * ésas sólo pasan si se puede ver todo.
 */
export function onlyVisible<T>(
  visible: Visible,
  rows: readonly T[],
  projectOf: (row: T) => string | null,
): readonly T[] {
  if (visible === 'all') return rows
  return rows.filter((row) => {
    const projectId = projectOf(row)
    return projectId !== null && visible.has(projectId)
  })
}

/**
 * ¿Puede el fichero llevar una columna de dato sensible?
 *
 * Sólo si ese dato se ve en **todos** los proyectos que salen en el fichero:
 * una columna con huecos miente igual que un cero que se lee como «costó cero».
 *
 * Y sólo si hay filas. `every` sobre un array vacío es `true`, así que sin esa
 * condición un fichero sin ninguna fila salía con la cabecera del dato para
 * quien no puede ver ni un importe. No se filtraba ninguna cifra —no había
 * cifras— pero la cabecera afirmaba un permiso que esa persona no tiene, y la
 * cabecera es justo lo que alguien lee para saber qué le dejan ver.
 */
export function columnaSensible<T>(
  visible: Visible,
  rows: readonly T[],
  projectOf: (row: T) => string,
): boolean {
  if (visible === 'all') return true
  return rows.length > 0 && rows.every((row) => visible.has(projectOf(row)))
}
