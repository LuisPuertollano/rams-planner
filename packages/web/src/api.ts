/**
 * Cliente de la API.
 *
 * Todo lo derivado llega acompañado de su `runId`: si un número no lo trae, es
 * un bug del servidor, no un detalle de presentación.
 */

export interface RunSummary {
  readonly id: string
  readonly engineVersion: string
  readonly inputHash: string
  readonly status: string
  readonly startedAt: string
  readonly durationMs: number | null
  readonly isFrozen: boolean
  readonly stats: Readonly<Record<string, number>>
}

export interface Project {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly statusStart: string
}

export interface Resource {
  readonly id: string
  readonly code: string
  readonly displayName: string
  readonly calendarCode: string | null
}

export interface TaskRow {
  readonly nodeId: string
  readonly projectId: string
  readonly parentId: string | null
  readonly kind: string
  readonly code: string | null
  readonly name: string
  readonly path: string
  readonly scheduledStart: string | null
  readonly scheduledFinish: string | null
  readonly durationMinutes: number | null
  readonly workMinutes: number | null
  readonly totalSlackMinutes: number | null
  readonly isCritical: boolean | null
  readonly percentCompleteBp: number
  readonly constraintKind: string | null
  readonly deadline: string | null
  readonly taskType: string | null
  readonly assignees: readonly string[]
}

export interface LoadCell {
  readonly resourceId: string
  readonly projectId: string
  readonly nodeId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly costCents: number
}

export interface UtilizationCell {
  readonly resourceId: string
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
}

export interface FindingRow {
  readonly severity: 'blocking' | 'error' | 'warning' | 'info'
  readonly code: string
  readonly entityType: string
  readonly entityId: string
  readonly entityName: string | null
  readonly occursOn: string | null
  readonly message: string
}

export interface DerivationRow {
  readonly targetType: string
  readonly rule: string
  readonly inputs: Readonly<Record<string, unknown>>
  readonly output: unknown
}

export interface AppState {
  readonly run: RunSummary | null
  readonly projects: readonly Project[]
  readonly resources: readonly Resource[]
}

export interface RunData {
  readonly tasks: readonly TaskRow[]
  readonly load: readonly LoadCell[]
  readonly utilization: readonly UtilizationCell[]
  readonly findings: readonly FindingRow[]
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}))
    const message = typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : response.statusText
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export async function fetchState(): Promise<AppState> {
  return get<AppState>('/api/state')
}

export async function fetchRunData(runId: string): Promise<RunData> {
  const [tasks, load, utilization, findings] = await Promise.all([
    get<{ tasks: readonly TaskRow[] }>(`/api/runs/${runId}/tasks`),
    get<{ cells: readonly LoadCell[] }>(`/api/runs/${runId}/load?bucket=month`),
    get<{ cells: readonly UtilizationCell[] }>(`/api/runs/${runId}/utilization?bucket=month`),
    get<{ findings: readonly FindingRow[] }>(`/api/runs/${runId}/findings`),
  ])
  return { tasks: tasks.tasks, load: load.cells, utilization: utilization.cells, findings: findings.findings }
}

export async function fetchDerivations(runId: string, nodeId: string): Promise<readonly DerivationRow[]> {
  const body = await get<{ derivations: readonly DerivationRow[] }>(`/api/runs/${runId}/explain/${nodeId}`)
  return body.derivations
}

export async function recalculate(reason: string): Promise<{ runId: string; durationMs: number }> {
  const response = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!response.ok) throw new Error('No se pudo recalcular')
  return response.json() as Promise<{ runId: string; durationMs: number }>
}
