/**
 * Una plantilla entera que entra por el CSV de plan, contra PostgreSQL.
 *
 * Existe por lo que faltaba para poder decir que «la plantilla entra»: hasta
 * ahora el CSV de plan creaba proyectos de verdad y nada más. Una plantilla —el
 * molde que repite un departamento en cada proyecto— había que teclearla.
 *
 * Y hay dos cosas que sólo se comprueban con la base delante: que el disparador
 * del esquema, que prohíbe asignar personas a una plantilla, **no** reviente la
 * importación de un fichero que traiga la columna `recurso` rellena; y que el
 * enlace con el catálogo se escriba de verdad en `node_document`, que es de
 * donde cuelgan la partición en subactividades y la fecha objetivo de la puerta.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createPool, withTransaction } from '@planner/persistence'
import { importDocumentsCsv } from './import-documents.js'
import { importPlanCsv } from './import-plan.js'

const url = process.env['DATABASE_URL']
const pool = url === undefined ? null : createPool(url)

const sufijo = `${String(Date.now())}-${String(Math.trunc(Math.random() * 1e6))}`
const PROY = `MOLDE-${sufijo}`
const DOC = `TPL-DOC-${sufijo}`

afterAll(async () => {
  if (pool !== null) {
    await withTransaction(pool, async (db) => {
      await db.query('DELETE FROM project WHERE code LIKE $1', [`%-${sufijo}`])
      await db.query('DELETE FROM document_type WHERE code LIKE $1', [`%-${sufijo}`])
      await db.query('DELETE FROM resource WHERE display_name = $1', ['Persona inventada'])
    })
  }
  await pool?.end()
})

const describeSiHayBase = pool === null ? describe.skip : describe

const PLAN =
  'proyecto;nombre_proyecto;fase;tarea;dias;predecesoras;recurso;dedicacion;disciplina;deadline;no_antes_de;entregable;plantilla'

const importaPlan = async (...filas: readonly string[]): ReturnType<typeof importPlanCsv> => {
  if (pool === null) throw new Error('sin base')
  return withTransaction(pool, (db) => importPlanCsv(db, [PLAN, ...filas].join('\n')))
}

describeSiHayBase('la plantilla que entra por el CSV de plan', () => {
  it('se crea como plantilla, y sus personas se quedan fuera con un aviso', async () => {
    if (pool === null) return
    // El esquema prohíbe con un disparador asignar a una plantilla. Reventar la
    // importación por una columna que sobra castigaría a quien exporta su plan
    // y lo marca como molde, así que se avisa y se deja fuera.
    const resultado = await importaPlan(
      `${PROY};Molde RAMS;Análisis;Plan RAMS;5;;Persona inventada;100;Plan;;;;sí`,
      `${PROY};;Análisis;Hazard Log;10;Plan RAMS;Persona inventada;;Hazard Log;;;;`,
    )
    expect(resultado.assignments).toBe(0)
    expect(resultado.tasks).toBe(2)
    expect(resultado.warnings.join(' ')).toContain('plantilla')

    const esPlantilla = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ is_template: boolean }>(
        'SELECT is_template FROM project WHERE code = $1',
        [PROY],
      )
      return rows[0]?.is_template
    })
    expect(esPlantilla).toBe(true)
  })

  it('una plantilla no entra en el cálculo', async () => {
    if (pool === null) return
    // Es lo que distingue una plantilla de un proyecto: no produce fechas ni
    // carga. Si entrara, el molde sumaría trabajo que nadie va a hacer.
    const dentro = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM wbs_node n
         JOIN project p ON p.id = n.project_id
         WHERE p.code = $1 AND p.deleted_at IS NULL AND NOT p.is_template AND p.status = 'activo'`,
        [PROY],
      )
      return Number(rows[0]?.n ?? '0')
    })
    expect(dentro).toBe(0)
  })

  it('la columna «entregable» enlaza la tarea con el catálogo', async () => {
    if (pool === null) return
    await withTransaction(pool, (db) =>
      importDocumentsCsv(db, ['codigo;nombre;puerta;crear;revisar_1', `${DOC};Entregable inventado;RD;Ing. RAMS:30;Ing. Sistemas:6`].join('\n')),
    )
    const codigo = `${PROY}-2`
    const resultado = await importaPlan(
      `${codigo};Molde con catálogo;Análisis;Redactar el entregable;8;;;;;;;${DOC};sí`,
    )
    expect(resultado.deliverables).toBe(1)

    const enlazado = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ code: string }>(
        `SELECT d.code FROM node_document nd
         JOIN document_type d ON d.id = nd.document_type_id
         JOIN wbs_node n ON n.id = nd.node_id
         JOIN project p ON p.id = n.project_id
         WHERE p.code = $1`,
        [codigo],
      )
      return rows.map((row) => row.code)
    })
    expect(enlazado).toEqual([DOC])
  })

  it('un entregable que no está en el catálogo se dice, y el resto entra', async () => {
    if (pool === null) return
    // Es el descarte que más se va a ver: se importa el plan antes que el
    // catálogo. Rechazar el fichero entero obligaría a rehacerlo.
    const codigo = `${PROY}-3`
    const resultado = await importaPlan(
      `${codigo};Molde sin catálogo;;Una tarea;3;;;;;;;NO-EXISTE-${sufijo};sí`,
    )
    expect(resultado.tasks).toBe(1)
    expect(resultado.deliverables).toBe(0)
    expect(resultado.warnings.join(' ')).toContain('no están en el catálogo')
  })

  it('sin la columna «plantilla», el proyecto entra como proyecto de verdad', async () => {
    if (pool === null) return
    const codigo = `${PROY}-4`
    await withTransaction(pool, (db) =>
      importPlanCsv(
        db,
        ['proyecto;tarea;dias', `${codigo};Una tarea;3`].join('\n'),
      ),
    )
    const esPlantilla = await withTransaction(pool, async (db) => {
      const { rows } = await db.query<{ is_template: boolean }>(
        'SELECT is_template FROM project WHERE code = $1',
        [codigo],
      )
      return rows[0]?.is_template
    })
    expect(esPlantilla).toBe(false)
  })
})
