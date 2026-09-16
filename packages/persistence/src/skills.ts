/**
 * Competencias: qué sabe hacer cada persona y qué exige cada tarea.
 *
 * Dato declarado (P1) por los dos lados. El motor sólo las lee, para avisar
 * cuando alguien está en una tarea que pide algo que no tiene; no decide nada
 * por su cuenta, porque quién es capaz de qué no lo decide una herramienta.
 */

import type { Queryable } from './db.js'

export interface Skill {
  readonly id: string
  readonly code: string
  readonly name: string
}

export interface ResourceSkill {
  readonly resourceId: string
  readonly skillId: string
  readonly level: number
}

export interface NodeSkillRequirement {
  readonly nodeId: string
  readonly skillId: string
  readonly minLevel: number
}

export interface SkillMatrix {
  readonly skills: readonly Skill[]
  readonly resourceSkills: readonly ResourceSkill[]
  readonly requirements: readonly NodeSkillRequirement[]
}

/** La hoja entera de una vez: es una matriz, y se mira como matriz. */
export async function readSkillMatrix(db: Queryable): Promise<SkillMatrix> {
  const skills = await db.query<{ id: string; code: string; name: string }>(
    'SELECT id, code, name FROM skill ORDER BY code',
  )
  const resourceSkills = await db.query<{ resource_id: string; skill_id: string; level: number }>(
    `SELECT rs.resource_id, rs.skill_id, rs.level
     FROM resource_skill rs
     JOIN resource r ON r.id = rs.resource_id AND r.deleted_at IS NULL`,
  )
  const requirements = await db.query<{ node_id: string; skill_id: string; min_level: number }>(
    `SELECT sr.node_id, sr.skill_id, sr.min_level
     FROM node_skill_requirement sr
     JOIN wbs_node n ON n.id = sr.node_id AND n.deleted_at IS NULL`,
  )
  return {
    skills: skills.rows,
    resourceSkills: resourceSkills.rows.map((row) => ({
      resourceId: row.resource_id,
      skillId: row.skill_id,
      level: row.level,
    })),
    requirements: requirements.rows.map((row) => ({
      nodeId: row.node_id,
      skillId: row.skill_id,
      minLevel: row.min_level,
    })),
  }
}

export async function createSkill(db: Queryable, code: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO skill (code, name) VALUES ($1, $2) RETURNING id',
    [code, name],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo crear la competencia')
  return id
}

/**
 * Borra una competencia del catálogo.
 *
 * El `ON DELETE CASCADE` se lleva por delante los niveles de las personas y los
 * requisitos de las tareas. Es lo correcto —si la competencia deja de existir,
 * exigirla no significa nada— pero no es reversible, así que quien llame debe
 * preguntar antes.
 */
export async function deleteSkill(db: Queryable, skillId: string): Promise<void> {
  await db.query('DELETE FROM skill WHERE id = $1', [skillId])
}

/** Pone (o cambia) el nivel de alguien en una competencia. Nivel 0 la retira. */
export async function setResourceSkill(
  db: Queryable,
  resourceId: string,
  skillId: string,
  level: number,
): Promise<void> {
  if (level <= 0) {
    await db.query('DELETE FROM resource_skill WHERE resource_id = $1 AND skill_id = $2', [resourceId, skillId])
    return
  }
  await db.query(
    `INSERT INTO resource_skill (resource_id, skill_id, level) VALUES ($1, $2, $3)
     ON CONFLICT (resource_id, skill_id) DO UPDATE SET level = EXCLUDED.level`,
    [resourceId, skillId, level],
  )
}

/** Lo mismo para lo que exige una tarea. Nivel 0 retira el requisito. */
export async function setNodeSkillRequirement(
  db: Queryable,
  nodeId: string,
  skillId: string,
  minLevel: number,
): Promise<void> {
  if (minLevel <= 0) {
    await db.query('DELETE FROM node_skill_requirement WHERE node_id = $1 AND skill_id = $2', [nodeId, skillId])
    return
  }
  await db.query(
    `INSERT INTO node_skill_requirement (node_id, skill_id, min_level) VALUES ($1, $2, $3)
     ON CONFLICT (node_id, skill_id) DO UPDATE SET min_level = EXCLUDED.min_level`,
    [nodeId, skillId, minLevel],
  )
}
