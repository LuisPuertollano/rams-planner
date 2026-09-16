/**
 * La ecuación fundamental de una tarea:
 *
 *     trabajo = duración × unidades
 *
 * `taskType` decide cuál de las tres magnitudes queda anclada y cuál se
 * recalcula. Cada recálculo que altera un valor declarado deja su derivación:
 * nunca ocurre en silencio, que es de donde viene la mala fama de estas
 * herramientas.
 */

import { applyBasisPoints, basisPoints, divideByBasisPoints } from '@planner/domain'
import type { DerivationSink } from '@planner/explain'
import type { AssignmentDefinition, TaskDefinition } from './plan.js'

export interface TaskMetrics {
  readonly durationMinutes: number
  readonly workMinutes: number
  readonly unitsBp: number
}

const FULL_TIME_BP = 10_000

export function resolveTaskMetrics(
  task: TaskDefinition,
  assignments: readonly AssignmentDefinition[],
  sink: DerivationSink,
): TaskMetrics {
  if (task.isMilestone) {
    return { durationMinutes: 0, workMinutes: 0, unitsBp: 0 }
  }

  const unitsBp = assignments.reduce((sum, assignment) => sum + assignment.unitsBp, 0)
  const effectiveUnits = basisPoints(unitsBp === 0 ? FULL_TIME_BP : unitsBp)

  const declaredWork =
    task.workDeclaredMinutes > 0
      ? task.workDeclaredMinutes
      : assignments.reduce((sum, assignment) => sum + (assignment.workDeclaredMinutes ?? 0), 0)

  switch (task.taskType) {
    case 'fixed_duration': {
      const workMinutes = applyBasisPoints(task.durationMinutes, effectiveUnits)
      if (workMinutes !== task.workDeclaredMinutes) {
        sink.record({
          targetType: 'task.workMinutes',
          targetId: task.nodeId,
          rule: 'TASK_EQUATION_FIXED_DURATION',
          inputs: { durationMinutes: task.durationMinutes, unitsBp: effectiveUnits },
          output: workMinutes,
        })
      }
      return { durationMinutes: task.durationMinutes, workMinutes, unitsBp: effectiveUnits }
    }

    case 'fixed_work': {
      const durationMinutes = declaredWork === 0 ? task.durationMinutes : divideByBasisPoints(declaredWork, effectiveUnits)
      if (durationMinutes !== task.durationMinutes) {
        sink.record({
          targetType: 'task.durationMinutes',
          targetId: task.nodeId,
          rule: 'TASK_EQUATION_FIXED_WORK',
          inputs: { workMinutes: declaredWork, unitsBp: effectiveUnits, declaredDuration: task.durationMinutes },
          output: durationMinutes,
        })
      }
      return { durationMinutes, workMinutes: declaredWork, unitsBp: effectiveUnits }
    }

    case 'fixed_units': {
      if (declaredWork > 0) {
        const durationMinutes = divideByBasisPoints(declaredWork, effectiveUnits)
        if (durationMinutes !== task.durationMinutes) {
          sink.record({
            targetType: 'task.durationMinutes',
            targetId: task.nodeId,
            rule: 'TASK_EQUATION_FIXED_UNITS',
            inputs: { workMinutes: declaredWork, unitsBp: effectiveUnits },
            output: durationMinutes,
          })
        }
        return { durationMinutes, workMinutes: declaredWork, unitsBp: effectiveUnits }
      }
      const workMinutes = applyBasisPoints(task.durationMinutes, effectiveUnits)
      return { durationMinutes: task.durationMinutes, workMinutes, unitsBp: effectiveUnits }
    }
  }
}
