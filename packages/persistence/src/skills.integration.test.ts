/**
 * Competencias contra PostgreSQL de verdad.
 *
 * Lo que importa aquí es que la hoja llega entera al motor: si los niveles o
 * los requisitos no viajan en el snapshot, los avisos de competencia no se
 * emiten y la funcionalidad existe sólo en la pantalla.
 */

import { calendarDate } from '@planner/domain'
import { schedulePlan } from '@planner/scheduler'
import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from './db.js'
import { duplicateProject } from './duplicate.js'
import { createNode, createProject, upsertAssignment } from './plan-edit.js'
import { createResource } from './resources.js'
import { readSkillMatrix, setNodeSkillRequirement, setResourceSkill } from './skills.js'
import { loadSnapshot } from './snapshot.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

afterAll(async () => {
  await pool?.end()
})

const unique = (prefix: string): string =>
  `${prefix}-${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`

const horizon = { from: calendarDate('2026-01-01'), to: calendarDate('2027-12-31') }

describe.skipIf(pool === null)('competencias', () => {
  it('las competencias del catálogo llegan con su código y su nombre', async () => {
    if (pool === null) return
    const matrix = await withTransaction(pool, (db) => readSkillMatrix(db))
    const codigos = matrix.skills.map((skill) => skill.code)
    expect(codigos).toContain('FMECA')
    expect(codigos).toContain('Safety Case')
    // Y el nombre explica el código: «SIL» solo no dice nada en un aviso.
    expect(matrix.skills.find((skill) => skill.code === 'SIL')?.name).toContain('SIL')
  })

  it('un nivel se pone, se cambia y se retira con el cero', async () => {
    if (pool === null) return
    const resourceId = await withTransaction(pool, (db) =>
      createResource(db, { code: unique('persona'), displayName: 'Con competencias' }),
    )
    const skillId = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ id: string }>("SELECT id FROM skill WHERE code = 'FMECA'")
      return rows[0]?.id ?? ''
    })

    const nivelDe = async (): Promise<number | undefined> =>
      (await withTransaction(pool, (db) => readSkillMatrix(db))).resourceSkills.find(
        (row) => row.resourceId === resourceId && row.skillId === skillId,
      )?.level

    await withTransaction(pool, async (db) => { await setResourceSkill(db, resourceId, skillId, 2) })
    expect(await nivelDe()).toBe(2)

    await withTransaction(pool, async (db) => { await setResourceSkill(db, resourceId, skillId, 5) })
    expect(await nivelDe()).toBe(5)

    await withTransaction(pool, async (db) => { await setResourceSkill(db, resourceId, skillId, 0) })
    expect(await nivelDe()).toBeUndefined()
  })

  it('el motor avisa de quien no tiene la competencia que pide su tarea', async () => {
    if (pool === null) return
    const code = unique('COMPETENCIAS')

    const { nodeId } = await withTransaction(pool, async (db) => {
      const projectId = await createProject(db, { code, name: 'Competencias', statusStart: '2026-03-02' })
      const fase = await createNode(db, { projectId, kind: 'phase', name: 'Fase' })
      const node = await createNode(db, { projectId, parentId: fase, kind: 'task', name: 'Pide FMECA' })

      const { rows } = await db.query<{ id: string }>("SELECT id FROM skill WHERE code = 'FMECA'")
      const skillId = rows[0]?.id ?? ''
      await setNodeSkillRequirement(db, node, skillId, 4)

      const sinCompetencia = await createResource(db, { code: unique('nosabe'), displayName: 'No sabe' })
      const conPoco = await createResource(db, { code: unique('aprende'), displayName: 'Aprendiendo' })
      await setResourceSkill(db, conPoco, skillId, 2)
      await upsertAssignment(db, node, sinCompetencia, 10_000)
      await upsertAssignment(db, node, conPoco, 10_000)
      return { nodeId: node }
    })

    const snapshot = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))
    // Primero: la hoja tiene que llegar al motor. Si esto falla, lo demás es humo.
    expect(snapshot.skillRequirements.some((item) => item.nodeId === nodeId)).toBe(true)
    expect(snapshot.resources.some((item) => item.skills.length > 0)).toBe(true)

    const { findings } = schedulePlan(snapshot)
    const mios = findings.filter(
      (finding) => finding.code === 'SKILL_MISSING' || finding.code === 'SKILL_BELOW_LEVEL',
    )
    const porPersona = new Map(mios.map((finding) => [finding.payload?.['resource'], finding.code]))
    expect(porPersona.get('No sabe')).toBe('SKILL_MISSING')
    expect(porPersona.get('Aprendiendo')).toBe('SKILL_BELOW_LEVEL')
  })

  it('los requisitos viajan cuando se copia un proyecto', async () => {
    if (pool === null) return
    const code = unique('CONREQ')

    const projectId = await withTransaction(pool, async (db) => {
      const id = await createProject(db, { code, name: 'Con requisitos', statusStart: '2026-03-02' })
      const fase = await createNode(db, { projectId: id, kind: 'phase', name: 'Fase' })
      const node = await createNode(db, { projectId: id, parentId: fase, kind: 'task', name: 'Pide RAM' })
      const { rows } = await db.query<{ id: string }>("SELECT id FROM skill WHERE code = 'RAM'")
      await setNodeSkillRequirement(db, node, rows[0]?.id ?? '', 5)
      return id
    })

    const copia = await withTransaction(pool, (db) =>
      duplicateProject(db, projectId, { code: unique('COPIAREQ'), name: 'Copia', statusStart: '2026-03-02' }),
    )

    const { rows } = await pool.query<{ min_level: number }>(
      `SELECT r.min_level FROM node_skill_requirement r
       JOIN wbs_node n ON n.id = r.node_id WHERE n.project_id = $1`,
      [copia.projectId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.min_level).toBe(5)
  })

  it('una plantilla no aporta requisitos al motor', async () => {
    if (pool === null) return
    const snapshot = await withTransaction(pool, (db) => loadSnapshot(db, { horizon }))
    const { rows } = await pool.query<{ id: string }>(
      `SELECT n.id FROM wbs_node n JOIN project p ON p.id = n.project_id WHERE p.is_template`,
    )
    const deplantilla = new Set(rows.map((row) => row.id))
    expect(snapshot.skillRequirements.some((item) => deplantilla.has(item.nodeId))).toBe(false)
  })
})
