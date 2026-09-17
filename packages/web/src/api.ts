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
  /** Una plantilla es un molde: no se calcula y no genera carga. */
  readonly isTemplate: boolean
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
  /** Los importes no han llegado: falta el permiso. No es que cuesten cero. */
  readonly costsHidden: boolean
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
    get<{ cells: readonly LoadCell[]; costsHidden: boolean }>(`/api/runs/${runId}/load?bucket=month`),
    // La saturación es del equipo entero y pide ver la carga en toda la
    // herramienta. Quien sólo tiene un proyecto no la recibe, y eso no puede
    // tumbar la pantalla: se queda sin las filas de capacidad, no sin plan.
    get<{ cells: readonly UtilizationCell[] }>(`/api/runs/${runId}/utilization?bucket=month`).catch(
      () => ({ cells: [] as readonly UtilizationCell[] }),
    ),
    get<{ findings: readonly FindingRow[] }>(`/api/runs/${runId}/findings`),
  ])
  return {
    tasks: tasks.tasks,
    load: load.cells,
    utilization: utilization.cells,
    findings: findings.findings,
    costsHidden: load.costsHidden,
  }
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
  /**
   * Quien pide esto no tiene permiso para ver costes, así que las tarifas
   * llegan vacías. Sin este aviso la ficha diría «sin tarifa: el coste sale a
   * cero», que es una mentira distinta.
   */
  readonly costsHidden?: boolean
}

export async function fetchTeam(): Promise<TeamState> {
  return get<TeamState>('/api/resources')
}

async function send(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<void> {
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
  /** Qué documento entrega cada tarea. Lo que ata la matriz a un plan real. */
  readonly documents: readonly { readonly nodeId: string; readonly documentTypeId: string }[]
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

export interface DuplicateResult {
  readonly projectId: string
  readonly nodes: number
  readonly dependencies: number
  readonly shiftedDates: number
}

/**
 * Copia un proyecto entero. Es la misma llamada para las tres cosas que se
 * piden: guardar como plantilla, crear a partir de una plantilla y duplicar.
 */
export async function duplicateProject(
  projectId: string,
  input: {
    readonly code: string
    readonly name: string
    readonly statusStart: string
    readonly asTemplate?: boolean
  },
): Promise<DuplicateResult> {
  const response = await fetch(`/api/projects/${projectId}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : 'No se pudo copiar el proyecto',
    )
  }
  const body = (await response.json()) as { result: DuplicateResult }
  return body.result
}

export async function patchProject(
  projectId: string,
  changes: Readonly<Record<string, string | number | boolean>>,
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

// ---------------------------------------------------------------------------
// Competencias
// ---------------------------------------------------------------------------

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

export async function fetchSkills(): Promise<SkillMatrix> {
  return get<SkillMatrix>('/api/skills')
}

export async function createSkill(code: string, name: string): Promise<void> {
  return send('/api/skills', 'POST', { code, name })
}

export async function removeSkill(skillId: string): Promise<void> {
  return send(`/api/skills/${skillId}`, 'DELETE')
}

/** Nivel 0 retira la competencia de esa persona. */
export async function setResourceSkill(resourceId: string, skillId: string, level: number): Promise<void> {
  const response = await fetch(`/api/resources/${resourceId}/skills/${skillId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
  })
  if (!response.ok) throw new Error('No se pudo guardar el nivel')
}

/** Nivel 0 retira el requisito de esa tarea. */
export async function setNodeSkill(nodeId: string, skillId: string, minLevel: number): Promise<void> {
  const response = await fetch(`/api/nodes/${nodeId}/skills/${skillId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ minLevel }),
  })
  if (!response.ok) throw new Error('No se pudo guardar el requisito')
}

// ---------------------------------------------------------------------------
// Calendario del equipo
// ---------------------------------------------------------------------------

export interface DailyCapacity {
  readonly resourceId: string
  readonly date: string
  readonly capacityMinutes: number
  readonly plannedMinutes: number
}

/**
 * Capacidad y carga día a día. Sale de lo derivado: es la capacidad que el
 * motor ha usado de verdad, no una reconstrucción del calendario en el cliente
 * que acabaría enseñando otro número.
 */
export async function fetchCapacity(runId: string, from: string, to: string): Promise<readonly DailyCapacity[]> {
  const body = await get<{ days: readonly DailyCapacity[] }>(
    `/api/runs/${runId}/capacity?from=${from}&to=${to}`,
  )
  return body.days
}

// ---------------------------------------------------------------------------
// Propuesta de reparto
// ---------------------------------------------------------------------------

export interface RebalanceProposal {
  readonly assignmentId: string
  readonly nodeId: string
  readonly taskName: string
  readonly projectId: string
  readonly fromResourceId: string
  readonly fromResourceName: string
  readonly toResourceId: string
  readonly toResourceName: string
  readonly minutes: number
  readonly firstDay: string
  readonly lastDay: string
  readonly fromBeforeBp: number
  readonly fromAfterBp: number
  readonly toBeforeBp: number
  readonly toAfterBp: number
  readonly relievedMinutes: number
  readonly reason: string
}

export interface RebalanceResult {
  readonly thresholdBp: number
  readonly proposals: readonly RebalanceProposal[]
  readonly findings: readonly FindingRow[]
}

export async function fetchRebalance(thresholdBp: number): Promise<RebalanceResult> {
  return get<RebalanceResult>(`/api/rebalance?threshold=${String(thresholdBp)}`)
}

export async function applyRebalance(proposal: RebalanceProposal): Promise<void> {
  return send('/api/rebalance/apply', 'POST', {
    assignmentId: proposal.assignmentId,
    nodeId: proposal.nodeId,
    toResourceId: proposal.toResourceId,
  })
}

// ---------------------------------------------------------------------------
// Sesión, permisos y administración
// ---------------------------------------------------------------------------

export interface SessionUser {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly isActive: boolean
  readonly lastLoginAt: string | null
}

export interface PermissionDefinition {
  readonly code: string
  /**
   * `project`: se puede conceder sobre un proyecto concreto. `global`: sólo
   * cuenta concedido en toda la herramienta, porque no habla de un proyecto
   * —el equipo, las tarifas, las ejecuciones del motor son de todos.
   */
  readonly scope: 'project' | 'global'
  readonly screen: string
  readonly label: string
  readonly detail: string
  readonly sensitive?: boolean
  readonly enforcedIn?: readonly string[]
}

export interface EffectivePermissions {
  readonly isSuperadmin: boolean
  readonly global: readonly string[]
  readonly byProject: Readonly<Record<string, readonly string[]>>
}

export interface MeResponse {
  readonly user: SessionUser | null
  readonly permissions: EffectivePermissions | null
  readonly catalogue: readonly PermissionDefinition[]
  /**
   * La instalación no tiene ni un usuario dado de alta, así que está abierta a
   * quien llegue. Es lo que distingue «no has entrado» de «aquí todavía no hay
   * nadie a quien pedirle que entre».
   */
  readonly openInstallation: boolean
}

export async function fetchMe(): Promise<MeResponse> {
  return get<MeResponse>('/api/auth/me')
}

export async function signIn(email: string, password: string): Promise<MeResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'No se pudo entrar',
    )
  }
  return response.json() as Promise<MeResponse>
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

/**
 * Cambia tu propia contraseña. Cierra todas tus sesiones, ésta incluida: si la
 * cambias porque alguien más la conocía, dejar sesiones vivas no arregla nada.
 */
export async function changeOwnPassword(actual: string, nueva: string): Promise<void> {
  const response = await fetch('/api/auth/clave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actual, nueva }),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : 'No se pudo cambiar la contraseña',
    )
  }
}

/**
 * ¿Puede esto? Es la copia cliente de la comprobación del servidor, y sirve
 * sólo para no enseñar botones que van a devolver un 403. Quien manda es la API.
 *
 * Toma la respuesta entera de `/api/auth/me` y no sólo los permisos porque hace
 * falta el catálogo: una función **global** —el equipo, las tarifas, el
 * motor— no cuenta concedida sobre un proyecto suelto, y sin saber de cuáles es
 * cada código, la interfaz enseñaría un botón que el servidor deniega.
 */
export function can(me: MeResponse | null, code: string, projectId?: string): boolean {
  // Todavía cargando, o instalación sin usuarios: no se esconde nada.
  if (me === null || me.permissions === null) return true
  const permissions = me.permissions
  if (permissions.isSuperadmin) return true
  if (permissions.global.includes(code)) return true

  const scope = me.catalogue.find((item) => item.code === code)?.scope ?? 'project'
  // Una función de toda la herramienta concedida sobre un proyecto no vale.
  if (scope === 'global') return false

  if (projectId !== undefined) return permissions.byProject[projectId]?.includes(code) ?? false
  return Object.values(permissions.byProject).some((lista) => lista.includes(code))
}

/**
 * ¿Puede esto **en toda la herramienta**? Para lo que no es de un proyecto:
 * la saturación del equipo se calcula con todos los proyectos a la vez, y con
 * un trozo daría un número que engaña.
 */
export function canEverywhere(me: MeResponse | null, code: string): boolean {
  if (me === null || me.permissions === null) return true
  return me.permissions.isSuperadmin || me.permissions.global.includes(code)
}

export interface Role {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly isSystem: boolean
  readonly permissions: readonly string[]
}

export interface Grant {
  readonly id: string
  readonly userId: string
  readonly roleId: string
  readonly projectId: string | null
}

export interface AdminSheet {
  readonly screens: readonly string[]
  readonly permissions: readonly PermissionDefinition[]
  readonly roles: readonly Role[]
  readonly users: readonly SessionUser[]
  readonly grants: readonly Grant[]
}

export async function fetchAdminSheet(): Promise<AdminSheet> {
  return get<AdminSheet>('/api/admin/hoja')
}

export async function saveRolePermissions(roleId: string, permissions: readonly string[]): Promise<void> {
  const response = await fetch(`/api/admin/roles/${roleId}/permissions`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ permissions }),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}))
    throw new Error(
      typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : 'No se pudo guardar',
    )
  }
}

export async function createRole(code: string, name: string, description: string): Promise<void> {
  return send('/api/admin/roles', 'POST', { code, name, description })
}

export async function removeRole(roleId: string): Promise<void> {
  return send(`/api/admin/roles/${roleId}`, 'DELETE')
}

export async function createAppUser(email: string, displayName: string, password: string): Promise<void> {
  return send('/api/admin/usuarios', 'POST', { email, displayName, password })
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  return send(`/api/admin/usuarios/${userId}/clave`, 'PUT', { password })
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  return send(`/api/admin/usuarios/${userId}/activo`, 'PUT', { active })
}

export async function grant(userId: string, roleId: string, projectId: string | null): Promise<void> {
  return send('/api/admin/concesiones', 'POST', { userId, roleId, projectId })
}

export async function revoke(grantId: string): Promise<void> {
  return send(`/api/admin/concesiones/${grantId}`, 'DELETE')
}

// ---------------------------------------------------------------------------
// El registro de cambios
// ---------------------------------------------------------------------------

export interface ChangeEvent {
  readonly id: string
  readonly occurredAt: string
  readonly actorId: string | null
  /** `null` cuando el cambio no tiene autor: la CLI, o antes de que hubiera login. */
  readonly actorName: string | null
  readonly requestId: string | null
  readonly operation: string
  readonly entityType: string
  readonly entityId: string
  readonly entityName: string | null
  readonly projectId: string | null
  readonly before: unknown
  readonly after: unknown
  readonly comment: string | null
}

export async function fetchRecentChanges(limit = 200): Promise<readonly ChangeEvent[]> {
  const body = await get<{ events: readonly ChangeEvent[] }>(`/api/history?limit=${String(limit)}`)
  return body.events
}

export async function fetchEntityHistory(entityId: string): Promise<readonly ChangeEvent[]> {
  const body = await get<{ events: readonly ChangeEvent[] }>(`/api/history/${entityId}`)
  return body.events
}

// ---------------------------------------------------------------------------
// Documentos y la matriz de precedencias
// ---------------------------------------------------------------------------

export interface DocumentType {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly sortKey: number
  /** En cuántas tareas se entrega. Para avisar antes de retirarlo. */
  readonly usedInTasks: number
}

/** La fila es condición necesaria de la columna. */
export interface DocumentPrecedence {
  readonly predecessorId: string
  readonly successorId: string
  readonly note: string | null
}

export interface DocumentCatalogue {
  readonly types: readonly DocumentType[]
  readonly precedences: readonly DocumentPrecedence[]
}

export async function fetchDocuments(): Promise<DocumentCatalogue> {
  return get<DocumentCatalogue>('/api/documents')
}

export async function createDocumentType(
  code: string,
  name: string,
  description: string | null,
): Promise<void> {
  return send('/api/documents', 'POST', { code, name, description })
}

export async function updateDocumentType(
  documentId: string,
  changes: { readonly code?: string; readonly name?: string; readonly description?: string | null },
): Promise<void> {
  return send(`/api/documents/${documentId}`, 'PATCH', changes)
}

export async function removeDocumentType(documentId: string): Promise<void> {
  return send(`/api/documents/${documentId}`, 'DELETE')
}

/** Marca o desmarca una casilla. Se manda el estado que debe quedar. */
export async function setPrecedence(
  predecessorId: string,
  successorId: string,
  required: boolean,
): Promise<void> {
  return send('/api/documents/precedence', 'PUT', { predecessorId, successorId, required })
}

export async function setNodeDocument(
  nodeId: string,
  documentId: string,
  delivers: boolean,
): Promise<void> {
  return send(`/api/nodes/${nodeId}/documents/${documentId}`, 'PUT', { delivers })
}

// ---------------------------------------------------------------------------
// Aplicar la matriz a un proyecto
// ---------------------------------------------------------------------------

/** Por qué una dependencia que la matriz exige no se va a crear. */
export type SkipReason = 'ya-existe' | 'misma-tarea' | 'crearia-un-ciclo'

export interface ProposedDependency {
  readonly predecessorNodeId: string
  readonly successorNodeId: string
  readonly documentPredecessorId: string
  readonly documentSuccessorId: string
}

export interface SkippedDependency extends ProposedDependency {
  readonly reason: SkipReason
  readonly path?: readonly string[]
}

export interface MatrixPlan {
  readonly create: readonly ProposedDependency[]
  readonly skipped: readonly SkippedDependency[]
  /** Documentos que la matriz nombra y que ninguna tarea del proyecto entrega. */
  readonly missingDocuments: readonly string[]
  readonly tasks: readonly { readonly nodeId: string; readonly name: string; readonly path: string }[]
  readonly documents: readonly DocumentType[]
}

export interface MatrixApplied {
  readonly result: {
    readonly created: readonly ProposedDependency[]
    readonly skipped: readonly SkippedDependency[]
    readonly missingDocuments: readonly string[]
  }
  readonly run: CalculationSummary
}

export async function fetchMatrixPlan(projectId: string): Promise<MatrixPlan> {
  return get<MatrixPlan>(`/api/projects/${projectId}/documents/plan`)
}

export async function applyMatrix(
  projectId: string,
  exclude: readonly { readonly predecessorNodeId: string; readonly successorNodeId: string }[],
): Promise<MatrixApplied> {
  const response = await fetch(`/api/projects/${projectId}/documents/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exclude }),
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : 'No se pudo aplicar la matriz',
    )
  }
  return payload as MatrixApplied
}

// ---------------------------------------------------------------------------
// Informes
// ---------------------------------------------------------------------------

export type ReportSeverity = 'neutral' | 'warning' | 'error'

export type HighlightKind =
  | 'alcance' | 'trabajo' | 'avance' | 'coste'
  | 'sobrecarga' | 'riesgo' | 'hallazgos' | 'sin-fechas'

/** Un punto del resumen: sin texto, para que lo diga la interfaz y en su idioma. */
export interface Highlight {
  readonly kind: HighlightKind
  readonly severity: ReportSeverity
  readonly numbers: Readonly<Record<string, number>>
  readonly labels: readonly string[]
}

export interface ReportMonth {
  readonly period: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  readonly costCents: number
}

export interface ReportProjectLine {
  readonly projectId: string
  readonly code: string
  readonly name: string
  readonly plannedMinutes: number
  readonly costCents: number
  readonly tasksInPeriod: number
  readonly tasksTotal: number
  readonly percentCompleteBp: number
  readonly start: string | null
  readonly finish: string | null
  readonly criticalTasks: number
  readonly risks: number
  readonly blockingFindings: number
}

export interface ReportPersonLine {
  readonly resourceId: string
  readonly code: string
  readonly displayName: string
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  readonly worstPeriod: string | null
  readonly worstUtilizationBp: number | null
  readonly projects: readonly string[]
}

export type RiskKind = 'fecha-limite' | 'holgura-negativa' | 'retraso'

export interface ReportRisk {
  readonly nodeId: string
  readonly projectId: string
  readonly projectCode: string
  readonly path: string
  readonly name: string
  readonly kind: RiskKind
  readonly scheduledFinish: string | null
  readonly deadline: string | null
  readonly percentCompleteBp: number
  readonly amount: number
}

export interface ReportFinding {
  readonly severity: string
  readonly code: string
  readonly projectId: string | null
  readonly entityName: string | null
  readonly message: string
  readonly occursOn: string | null
}

export interface ReportTotals {
  readonly projectCount: number
  readonly tasksInPeriod: number
  readonly tasksTotal: number
  readonly tasksWithoutDates: number
  readonly plannedMinutes: number
  readonly capacityMinutes: number
  readonly utilizationBp: number | null
  readonly costCents: number
  readonly completedTasks: number
  readonly inProgressTasks: number
  readonly notStartedTasks: number
  readonly percentCompleteBp: number
  readonly milestonesInPeriod: number
  readonly criticalTasks: number
  readonly overloadedPeople: number
  readonly blockingFindings: number
  readonly errorFindings: number
  readonly warningFindings: number
}

export interface Report {
  readonly runId: string
  readonly period: { readonly from: string; readonly to: string }
  readonly asOf: string
  readonly costsHidden: boolean
  readonly peopleHidden: boolean
  readonly tldr: readonly Highlight[]
  readonly totals: ReportTotals
  readonly months: readonly ReportMonth[]
  readonly projects: readonly ReportProjectLine[]
  readonly people: readonly ReportPersonLine[]
  readonly risks: readonly ReportRisk[]
  readonly findings: readonly ReportFinding[]
}

export async function fetchReport(
  projectIds: readonly string[],
  from: string,
  to: string,
): Promise<Report> {
  const consulta = new URLSearchParams({ from, to })
  // Sin proyectos, el servidor manda todos los que se puedan ver.
  if (projectIds.length > 0) consulta.set('projects', projectIds.join(','))
  return get<Report>(`/api/report?${consulta.toString()}`)
}
