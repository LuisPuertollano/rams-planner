/**
 * CLI del planificador.
 *
 *   planner seed-demo    carga el juego de datos de demostración
 *   planner calculate    recalcula y guarda una ejecución
 *   planner runs         lista las últimas ejecuciones
 */

import { createPool, recentRuns, withTransaction } from '@planner/persistence'
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
      // Una tabla, no un JSON: esto se mira desde una terminal, y lo que se
      // busca aquí es el hash. Dos ejecuciones con el mismo hash tienen que dar
      // el mismo resultado; si no, el motor ha dejado de ser determinista (P2).
      const runs = await withTransaction(pool, (db) => recentRuns(db))
      if (runs.length === 0) {
        console.log('No hay ninguna ejecución todavía.')
        break
      }
      console.log('ejecución  fecha             motor    ms   hash      congelada  motivo')
      for (const run of runs) {
        const started = run.startedAt.slice(0, 16).replace('T', ' ')
        console.log(
          [
            run.id.slice(0, 8),
            started,
            run.engineVersion.padEnd(7),
            String(run.durationMs ?? 0).padStart(5),
            run.inputHash.slice(0, 8),
            run.isFrozen ? '   sí     ' : '   no     ',
            run.triggerReason ?? '',
          ].join('  '),
        )
      }
      break
    }

    default:
      console.log('Uso: planner <seed-demo|calculate|runs>')
      process.exitCode = 1
  }
} finally {
  await pool.end()
}
