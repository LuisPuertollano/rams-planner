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
  readonly triggerReason?: string | null
}

export interface Project {
  readonly id: string
  readonly code: string
  readonly name: string
  /** Fecha de referencia: ancla las tareas sin predecesora ni restricción. */
  readonly statusStart: string
  /** Desempate determinista en la nivelación: el número más bajo gana. */
  readonly priority: number
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
  readonly declaredDurationMinutes: number | null
  readonly declaredWorkMinutes: number | null
  readonly declaredPercentCompleteBp: number | null
}

export interface Baseline {
  readonly id: string
  readonly runId: string
  readonly name: string
  readonly capturedAt: string
  readonly note: string | null
}

export interface FieldValue {
  readonly entityId: string
  readonly fieldKey: string
  readonly label: string
  readonly value: string
}

export interface TaskDiff {
  readonly nodeId: string
  readonly name: string
  readonly projectId: string
  readonly startFrom: string | null
  readonly startTo: string | null
  readonly finishFrom: string | null
  readonly finishTo: string | null
  readonly startDeltaDays: number | null
  readonly finishDeltaDays: number | null
  readonly workFrom: number | null
  readonly workTo: number | null
  readonly workDeltaMinutes: number | null
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
  readonly baselines: readonly Baseline[]
  readonly fields: readonly FieldValue[]
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

export async function updateTask(
  nodeId: string,
  changes: Readonly<Record<string, number | string | null>>,
): Promise<void> {
  const response = await fetch(`/api/tasks/${nodeId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : 'No se pudo guardar',
    )
  }
}

export async function freezeBaseline(runId: string, name: string): Promise<Baseline> {
  const response = await fetch(`/api/runs/${runId}/freeze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error('No se pudo congelar la línea base')
  return response.json() as Promise<Baseline>
}

export async function fetchDiff(baseRunId: string, targetRunId: string): Promise<readonly TaskDiff[]> {
  const body = await get<{ tasks: readonly TaskDiff[] }>(`/api/runs/${baseRunId}/diff/${targetRunId}`)
  return body.tasks
}

export interface CalculationSummary {
  readonly runId: string
  readonly durationMs: number
  readonly leveledTasks?: number
  readonly converged?: boolean
}

export async function recalculate(reason: string, level = false): Promise<CalculationSummary> {
  const response = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason, level }),
  })
  if (!response.ok) throw new Error('No se pudo recalcular')
  return response.json() as Promise<CalculationSummary>
}

export async function fetchRuns(): Promise<readonly RunSummary[]> {
  const body = await get<{ runs: readonly RunSummary[] }>('/api/runs')
  return body.runs
}

// ---------------------------------------------------------------------------
// Ficha de recursos
//
// Todo lo de esta sección es dato DECLARADO: no lleva `runId` porque no
// pertenece a ninguna ejecución. Lo que sí devuelve cada escritura es la
// ejecución nueva que ha provocado, para que la pantalla no se quede mirando
// números viejos.
// ---------------------------------------------------------------------------

export interface CalendarOption {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly parentCode: string | null
}

export interface AvailabilityPeriod {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly unitsBp: number
  readonly reason: string | null
}

export interface AbsencePeriod {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly minutesPerDay: number | null
  readonly note: string | null
}

export interface CostRatePeriod {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly currency: string
  readonly standardCentsHour: number
}

export interface ResourceDetail {
  readonly id: string
  readonly code: string
  readonly displayName: string
  readonly kind: string
  readonly calendarId: string | null
  readonly calendarCode: string | null
  readonly maxUnitsBp: number
  readonly activeFrom: string | null
  readonly activeTo: string | null
  readonly availability: readonly AvailabilityPeriod[]
  readonly absences: readonly AbsencePeriod[]
  readonly costRates: readonly CostRatePeriod[]
}

export interface TeamState {
  readonly resources: readonly ResourceDetail[]
  readonly calendars: readonly CalendarOption[]
}

export async function fetchTeam(): Promise<TeamState> {
  return get<TeamState>('/api/resources')
}

async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : 'No se pudo guardar',
    )
  }
}

export async function createResource(input: {
  readonly code: string
  readonly displayName: string
  readonly calendarId: string | null
  readonly maxUnitsBp: number
}): Promise<void> {
  return send('/api/resources', 'POST', input)
}

export async function patchResource(
  resourceId: string,
  changes: Readonly<Record<string, string | number | null>>,
): Promise<void> {
  return send(`/api/resources/${resourceId}`, 'PATCH', changes)
}

export async function removeResource(resourceId: string): Promise<void> {
  return send(`/api/resources/${resourceId}`, 'DELETE')
}

export async function addAvailability(
  resourceId: string,
  period: { readonly from: string; readonly to: string; readonly unitsBp: number; readonly reason: string | null },
): Promise<void> {
  return send(`/api/resources/${resourceId}/availability`, 'POST', period)
}

export async function removeAvailability(id: string): Promise<void> {
  return send(`/api/availability/${id}`, 'DELETE')
}

export async function addAbsence(
  resourceId: string,
  absence: { readonly kind: string; readonly from: string; readonly to: string; readonly note: string | null },
): Promise<void> {
  return send(`/api/resources/${resourceId}/absences`, 'POST', absence)
}

export async function removeAbsence(id: string): Promise<void> {
  return send(`/api/absences/${id}`, 'DELETE')
}

export async function addCostRate(
  resourceId: string,
  rate: { readonly from: string; readonly to: string; readonly standardCentsHour: number },
): Promise<void> {
  return send(`/api/resources/${resourceId}/rates`, 'POST', rate)
}

export async function removeCostRate(id: string): Promise<void> {
  return send(`/api/rates/${id}`, 'DELETE')
}

// ---------------------------------------------------------------------------
// Edición de la estructura del plan
//
// Lo mismo que hace la importación de CSV, pero de uno en uno. Cada escritura
// recalcula en el servidor; quien llama sólo tiene que recargar.
// ---------------------------------------------------------------------------

export interface AssignmentRow {
  readonly id: string
  readonly nodeId: string
  readonly resourceId: string
  readonly unitsBp: number
}

export interface DependencyRow {
  readonly id: string
  readonly predecessorNodeId: string
  readonly successorNodeId: string
  readonly kind: string
  readonly lagMinutes: number
}

export interface PlanStructure {
  readonly assignments: readonly AssignmentRow[]
  readonly dependencies: readonly DependencyRow[]
}

export async function fetchStructure(): Promise<PlanStructure> {
  return get<PlanStructure>('/api/plan/structure')
}

export async function createProject(input: {
  readonly code: string
  readonly name: string
  readonly statusStart: string
}): Promise<void> {
  return send('/api/projects', 'POST', input)
}

export async function patchProject(
  projectId: string,
  changes: Readonly<Record<string, string | number>>,
): Promise<void> {
  return send(`/api/projects/${projectId}`, 'PATCH', changes)
}

export async function removeProject(projectId: string): Promise<void> {
  return send(`/api/projects/${projectId}`, 'DELETE')
}

export async function createNode(input: {
  readonly projectId: string
  readonly parentId: string | null
  readonly kind: 'phase' | 'task' | 'milestone'
  readonly name: string
  readonly durationMinutes?: number
}): Promise<void> {
  return send('/api/nodes', 'POST', input)
}

export async function renameNode(nodeId: string, name: string): Promise<void> {
  return send(`/api/nodes/${nodeId}`, 'PATCH', { name })
}

export async function removeNode(nodeId: string): Promise<void> {
  return send(`/api/nodes/${nodeId}`, 'DELETE')
}

export async function assign(nodeId: string, resourceId: string, unitsBp: number): Promise<void> {
  return send('/api/assignments', 'POST', { nodeId, resourceId, unitsBp })
}

export async function unassign(assignmentId: string): Promise<void> {
  return send(`/api/assignments/${assignmentId}`, 'DELETE')
}

export async function link(
  predecessorNodeId: string,
  successorNodeId: string,
  kind: string,
  lagMinutes: number,
): Promise<void> {
  return send('/api/dependencies', 'POST', { predecessorNodeId, successorNodeId, kind, lagMinutes })
}

export async function unlink(id: string): Promise<void> {
  return send(`/api/dependencies/${id}`, 'DELETE')
}
