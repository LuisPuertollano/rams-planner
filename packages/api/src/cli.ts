/**
 * CLI del planificador.
 *
 *   planner seed-demo    carga el juego de datos de demostración
 *   planner calculate    recalcula y guarda una ejecución
 *   planner runs         lista las últimas ejecuciones
 */

import { createPool, latestRun, withTransaction } from '@planner/persistence'
import { readConfig } from './config.js'
import { calculate, defaultScenarioId } from './engine.js'
import { seedDemoData } from './demo-data.js'

const command = process.argv[2] ?? 'help'
const config = readConfig(process.env)
const pool = createPool(config.databaseUrl)

try {
  switch (command) {
    case 'seed-demo': {
      const created = await withTransaction(pool, (db) => seedDemoData(db))
      if (created) {
        const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
        const summary = await calculate(pool, scenarioId, 'carga de datos de demostración')
        console.log(
          `Datos de demostración cargados y calculados: ${String(summary.tasks)} tareas, ` +
            `${String(summary.timephasedCells)} celdas de carga, ${String(summary.findings)} hallazgos ` +
            `(${String(summary.durationMs)} ms).`,
        )
      } else {
        console.log('La base de datos ya tiene proyectos: no se toca nada.')
      }
      break
    }

    case 'calculate': {
      const scenarioId = await withTransaction(pool, (db) => defaultScenarioId(db))
      const summary = await calculate(pool, scenarioId, 'recálculo desde la CLI')
      console.log(JSON.stringify(summary, null, 2))
      break
    }

    case 'runs': {
      const run = await withTransaction(pool, (db) => latestRun(db))
      console.log(run === undefined ? 'No hay ninguna ejecución todavía.' : JSON.stringify(run, null, 2))
      break
    }

    default:
      console.log('Uso: planner <seed-demo|calculate|runs>')
      process.exitCode = 1
  }
} finally {
  await pool.end()
}
