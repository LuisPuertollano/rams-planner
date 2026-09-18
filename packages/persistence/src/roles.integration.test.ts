/**
 * Los tres roles sembrados llegan a las pantallas que les tocan.
 *
 * Esto existe por una avería concreta: `documentos.ver`, `documentos.gestionar`
 * y `documentos.asignar` existían como permisos desde que nació el catálogo y
 * **no estaban en ninguno de los tres roles de arranque**. Sólo el superadmin
 * —que lo tiene todo por definición, no por reparto— llegaba a esa pantalla, y
 * detrás de esa puerta cerrada estaban el catálogo entero, la matriz de
 * precedencias, el ciclo de firma y las subactividades.
 *
 * Nadie lo vio en tres migraciones de trabajo porque las pruebas de permisos
 * comprueban que un permiso que falta se deniega, no que un permiso que existe
 * lo tenga alguien. Aquí se comprueba lo segundo, que es la forma que tiene una
 * pantalla de volverse invisible sin que salte nada.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { readRoles } from './roles.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

/** Los tres roles editables que la instalación siembra, por su código. */
const SEMBRADOS = ['lectura', 'planificador', 'responsable'] as const

async function sembrados(): Promise<Map<string, readonly string[]>> {
  if (pool === null) return new Map()
  const roles = await withTransaction(pool, (db) => readRoles(db))
  return new Map(
    roles
      .filter((rol) => (SEMBRADOS as readonly string[]).includes(rol.code))
      .map((rol) => [rol.code, rol.permissions]),
  )
}

function de(todos: Map<string, readonly string[]>, code: string): readonly string[] {
  const permisos = todos.get(code)
  if (permisos === undefined) throw new Error(`no existe el rol sembrado «${code}»`)
  return permisos
}

/** Un permiso que sólo mira: ver algo, o llevárselo tal cual está. */
function soloMira(permiso: string): boolean {
  return permiso.endsWith('.ver') || permiso === 'exportar'
}

describe.skipIf(pool === null)('los roles de arranque', () => {
  it('los tres siguen existiendo y ninguno se ha quedado vacío', async () => {
    if (pool === null) return
    const todos = await sembrados()
    expect([...todos.keys()].toSorted()).toEqual([...SEMBRADOS].toSorted())
    for (const code of SEMBRADOS) {
      expect(de(todos, code).length, code).toBeGreaterThan(0)
    }
  })

  it('el catálogo de documentos lo ve todo el mundo', async () => {
    if (pool === null) return
    // Es la pantalla donde viven los entregables, las precedencias, las firmas
    // y las subactividades. Que no la viera nadie no era una decisión.
    const todos = await sembrados()
    for (const code of SEMBRADOS) {
      expect(de(todos, code), code).toContain('documentos.ver')
    }
  })

  it('quien planifica también lo gestiona y lo asigna; quien sólo lee, no', async () => {
    if (pool === null) return
    const todos = await sembrados()
    for (const code of ['planificador', 'responsable'] as const) {
      expect(de(todos, code), code).toContain('documentos.gestionar')
      expect(de(todos, code), code).toContain('documentos.asignar')
    }
    expect(de(todos, 'lectura')).not.toContain('documentos.gestionar')
    expect(de(todos, 'lectura')).not.toContain('documentos.asignar')
  })

  it('lectura no escribe nada, y no ve costes', async () => {
    if (pool === null) return
    const lectura = de(await sembrados(), 'lectura')
    expect(lectura.filter((permiso) => !soloMira(permiso))).toEqual([])
    expect(lectura).not.toContain('costes.ver')
  })

  it('sólo el responsable ve costes y toca tarifas', async () => {
    if (pool === null) return
    const todos = await sembrados()
    expect(de(todos, 'responsable')).toContain('costes.ver')
    expect(de(todos, 'responsable')).toContain('tarifas.editar')
    expect(de(todos, 'planificador')).not.toContain('costes.ver')
    expect(de(todos, 'planificador')).not.toContain('tarifas.editar')
  })

  it('usuarios y roles no los reparte ningún rol sembrado', async () => {
    if (pool === null) return
    // Se puede delegar desde la hoja de permisos, y conviene pensárselo: quien
    // puede repartir roles puede darse a sí mismo todo lo demás. Por eso no
    // viene puesto de fábrica.
    const todos = await sembrados()
    for (const code of SEMBRADOS) {
      expect(de(todos, code), code).not.toContain('usuarios.gestionar')
      expect(de(todos, code), code).not.toContain('roles.gestionar')
    }
  })
})
