/**
 * Juego de datos de demostración.
 *
 * No es relleno: está construido para que las pantallas enseñen algo real desde
 * el primer minuto. Hay tres proyectos que se solapan, gente con jornadas
 * distintas, vacaciones en agosto, una sobrecarga deliberada, un deadline que
 * no se cumple y campos personalizados del dominio RAMS.
 */

import type { Queryable } from '@planner/persistence'

const CAL_BW = '00000000-0000-4000-8000-000000000002'
const CAL_BW_35H = '00000000-0000-4000-8000-000000000003'

const uuid = (namespace: number, index: number): string =>
  `${String(namespace).repeat(8)}-0000-4000-8000-${String(index).padStart(12, '0')}`

const DAY = 480

interface DemoResource {
  readonly key: number
  readonly code: string
  readonly name: string
  readonly calendarId: string
  readonly centsPerHour: number
  readonly availability?: readonly { from: string; to: string; unitsBp: number }[]
  readonly absences?: readonly { from: string; to: string; kind: string; minutesPerDay?: number }[]
  /** Competencias por código, con su nivel. Deliberadamente desigual: un equipo
   *  real tiene huecos, y es justo lo que la hoja de competencias debe enseñar. */
  readonly skills?: Readonly<Record<string, number>>
}

const RESOURCES: readonly DemoResource[] = [
  {
    key: 1,
    code: 'amuller',
    name: 'Ana Müller',
    calendarId: CAL_BW_35H,
    centsPerHour: 7_800,
    absences: [{ from: '2026-08-03', to: '2026-08-21', kind: 'vacation' }],
    skills: { Plan: 4, 'Hazard Log': 5, Requisitos: 4, FMECA: 3, 'Safety Case': 4 },
  },
  {
    key: 2,
    code: 'miglesias',
    name: 'Marc Iglesias',
    calendarId: CAL_BW,
    centsPerHour: 8_500,
    skills: { Plan: 5, SIL: 4, Requisitos: 4, 'Safety Case': 5, 'V&V': 3 },
  },
  {
    key: 3,
    code: 'lvogt',
    name: 'Lena Vogt',
    calendarId: CAL_BW,
    centsPerHour: 7_200,
    // Cedida a otro programa media jornada durante la primavera.
    availability: [
      { from: '2026-01-01', to: '2026-03-31', unitsBp: 10_000 },
      { from: '2026-04-01', to: '2026-06-30', unitsBp: 6_000 },
      { from: '2026-07-01', to: '2029-12-31', unitsBp: 10_000 },
    ],
    skills: { FMECA: 5, RAM: 4, 'Hazard Log': 3, Definición: 3 },
  },
  { key: 4, code: 'truiz', name: 'Tomás Ruiz', calendarId: CAL_BW, centsPerHour: 6_900,
    skills: { RAM: 5, FMECA: 3, Definición: 4 } },
  {
    key: 5,
    code: 'sbraun',
    name: 'Sofia Braun',
    calendarId: CAL_BW_35H,
    centsPerHour: 7_100,
    absences: [{ from: '2026-05-11', to: '2026-05-13', kind: 'training' }],
    skills: { FMECA: 4, 'V&V': 4, RAM: 2 },
  },
  // A propósito sin «Safety Case» ni «SIL»: el equipo depende de dos personas
  // para eso, y la hoja de competencias lo enseña de un vistazo.
  { key: 6, code: 'jkowalski', name: 'Jan Kowalski', calendarId: CAL_BW, centsPerHour: 6_600,
    skills: { 'V&V': 5, Definición: 3, Requisitos: 2 } },
]

interface DemoTask {
  readonly key: number
  readonly name: string
  readonly days: number
  readonly phase: number
  readonly after?: readonly number[]
  readonly assign?: readonly { resource: number; unitsBp?: number; contour?: string }[]
  readonly milestone?: boolean
  readonly deadline?: string
  readonly constraint?: { kind: string; date: string }
  readonly ramsTag?: string
  readonly standardDays?: number
}

interface DemoProject {
  readonly key: number
  readonly code: string
  readonly name: string
  readonly start: string
  readonly phases: readonly { key: number; name: string }[]
  readonly tasks: readonly DemoTask[]
}

const PROJECTS: readonly DemoProject[] = [
  {
    key: 1,
    code: 'CBTC-L3',
    name: 'CBTC Línea 3 — Homologación RAMS',
    start: '2026-03-02',
    phases: [
      { key: 11, name: 'Análisis preliminar' },
      { key: 12, name: 'Análisis detallado' },
      { key: 13, name: 'Verificación y Safety Case' },
    ],
    tasks: [
      { key: 101, name: 'Plan RAMS', days: 5, phase: 11, assign: [{ resource: 2 }], ramsTag: 'Plan' },
      { key: 102, name: 'Hazard Log inicial', days: 10, phase: 11, after: [101], assign: [{ resource: 1 }], ramsTag: 'Hazard Log', standardDays: 8 },
      { key: 103, name: 'Análisis funcional FMECA', days: 15, phase: 11, after: [101], assign: [{ resource: 3 }], ramsTag: 'FMECA' },
      { key: 104, name: 'Revisión de concepto', days: 0, phase: 11, after: [102, 103], milestone: true },
      { key: 105, name: 'FMECA subsistema freno', days: 12, phase: 12, after: [104], assign: [{ resource: 1 }], ramsTag: 'FMECA' },
      { key: 106, name: 'FMECA subsistema puertas', days: 8, phase: 12, after: [104], assign: [{ resource: 5 }], ramsTag: 'FMECA' },
      { key: 107, name: 'Cálculo RAM', days: 10, phase: 12, after: [104], assign: [{ resource: 4, contour: 'bell' }], ramsTag: 'RAM' },
      { key: 108, name: 'Asignación SIL', days: 6, phase: 12, after: [105, 106], assign: [{ resource: 2 }], ramsTag: 'SIL' },
      { key: 109, name: 'Análisis de importancia', days: 5, phase: 12, after: [107], assign: [{ resource: 3 }], ramsTag: 'RAM' },
      { key: 110, name: 'Plan de verificación', days: 4, phase: 13, assign: [{ resource: 6 }], ramsTag: 'Plan' },
      { key: 111, name: 'Ejecución de pruebas', days: 20, phase: 13, after: [108, 110], assign: [{ resource: 6 }, { resource: 4, unitsBp: 5_000 }], ramsTag: 'Verificación' },
      { key: 112, name: 'Safety Case', days: 15, phase: 13, after: [109, 111], assign: [{ resource: 2, contour: 'back_loaded' }], deadline: '2026-12-11', ramsTag: 'Safety Case' },
      { key: 113, name: 'Entrega a organismo notificado', days: 0, phase: 13, after: [112], milestone: true },
    ],
  },
  {
    key: 2,
    code: 'DEP-SIG',
    name: 'Señalización depósito Neckarau',
    start: '2026-04-01',
    phases: [
      { key: 21, name: 'Ingeniería' },
      { key: 22, name: 'Validación' },
    ],
    tasks: [
      { key: 201, name: 'Especificación de requisitos', days: 8, phase: 21, assign: [{ resource: 5 }], ramsTag: 'Plan' },
      // Ana entra aquí mientras sigue con el FMECA del freno: sobrecarga deliberada.
      { key: 202, name: 'Hazard Log depósito', days: 10, phase: 21, after: [201], assign: [{ resource: 1 }], ramsTag: 'Hazard Log' },
      { key: 203, name: 'Análisis de riesgos de maniobra', days: 12, phase: 21, after: [201], assign: [{ resource: 3 }], ramsTag: 'Hazard Log' },
      { key: 204, name: 'Matriz de trazabilidad', days: 6, phase: 22, after: [202, 203], assign: [{ resource: 6 }], ramsTag: 'Verificación' },
      { key: 205, name: 'Informe de seguridad', days: 10, phase: 22, after: [204], assign: [{ resource: 2 }], ramsTag: 'Safety Case' },
    ],
  },
  {
    key: 3,
    code: 'FRENO-SIL2',
    name: 'Certificación SIL 2 del sistema de freno',
    start: '2026-06-01',
    phases: [{ key: 31, name: 'Demostración de integridad' }],
    tasks: [
      { key: 301, name: 'Revisión de arquitectura', days: 10, phase: 31, assign: [{ resource: 4 }], ramsTag: 'SIL' },
      { key: 302, name: 'Cálculo de tasas de fallo', days: 12, phase: 31, after: [301], assign: [{ resource: 3 }], ramsTag: 'RAM' },
      { key: 303, name: 'Análisis de modos comunes', days: 8, phase: 31, after: [301], assign: [{ resource: 5 }], ramsTag: 'FMECA' },
      {
        key: 304,
        name: 'Informe SIL 2',
        days: 10,
        phase: 31,
        after: [302, 303],
        assign: [{ resource: 1 }],
        // El cliente no acepta el informe antes de cerrar la campaña de ensayos.
        constraint: { kind: 'start_no_earlier_than', date: '2026-09-01' },
        ramsTag: 'SIL',
      },
      { key: 305, name: 'Auditoría externa', days: 0, phase: 31, after: [304], milestone: true, deadline: '2026-10-30' },
    ],
  },
]

export async function seedDemoData(db: Queryable): Promise<boolean> {
  // Las plantillas no cuentan: vienen de serie con el esquema, así que una base
  // recién migrada tiene una y seguiría estando vacía a todos los efectos.
  const existing = await db.query<{ exists: number }>(
    'SELECT 1 AS exists FROM project WHERE NOT is_template LIMIT 1',
  )
  if (existing.rows.length > 0) return false

  await seedResources(db)
  const ramsFieldId = await seedFieldDefinitions(db)
  await seedProjects(db, ramsFieldId)
  await seedDocuments(db)
  return true
}

/**
 * Un juego de entregables con su orden, para que la matriz de documentos se
 * pueda ver funcionando.
 *
 * Va en los datos de demostración y **no** en una migración a propósito: los
 * entregables de verdad son los del equipo que instala esto, no los que se le
 * ocurran a quien escribe el código. Una instalación real arranca con la matriz
 * vacía y su pantalla explicando cómo llenarla.
 */
const DEMO_DOCUMENTS: readonly { readonly code: string; readonly name: string; readonly detail: string }[] = [
  { code: 'PGS', name: 'Plan de gestión de la seguridad', detail: 'Cómo se va a demostrar la seguridad del sistema.' },
  { code: 'PHA', name: 'Análisis preliminar de riesgos', detail: 'Los peligros que se ven antes de tener diseño.' },
  { code: 'HL', name: 'Hazard Log', detail: 'El registro vivo de peligros y su tratamiento.' },
  { code: 'SRS', name: 'Requisitos de seguridad', detail: 'Lo que el sistema tiene que cumplir, y por qué.' },
  { code: 'SIL', name: 'Asignación de SIL', detail: 'Qué nivel de integridad se exige a cada función.' },
  { code: 'FMECA', name: 'FMECA', detail: 'Modos de fallo, efectos y criticidad.' },
  { code: 'RAM', name: 'Informe RAM', detail: 'Fiabilidad, disponibilidad y mantenibilidad demostradas.' },
  { code: 'VV', name: 'Matriz de verificación', detail: 'Cada requisito contra la evidencia que lo cierra.' },
  { code: 'SC', name: 'Safety Case', detail: 'El argumento completo, con su evidencia.' },
]

/** La fila es condición necesaria de la columna. */
const DEMO_PRECEDENCES: readonly (readonly [string, string])[] = [
  ['PGS', 'PHA'],
  ['PHA', 'HL'],
  ['PHA', 'SRS'],
  ['HL', 'FMECA'],
  ['SRS', 'SIL'],
  ['SIL', 'FMECA'],
  ['FMECA', 'RAM'],
  ['SRS', 'VV'],
  ['FMECA', 'SC'],
  ['RAM', 'SC'],
  ['VV', 'SC'],
  ['HL', 'SC'],
]

/**
 * El ciclo de firma de la demostración, **por rol y con roles inventados**.
 *
 * Inventados a propósito y dichos aquí: los datos de demostración no llevan ni
 * un nombre de persona ni un puesto de una organización real. El catálogo dice
 * que hace falta un jefe de seguridad; quién lo sea lo pone el equipo que
 * instala esto.
 *
 * Dos de ellos están mal a propósito, para que la pantalla enseñe lo que hace
 * cuando un ciclo no cuadra: el `PHA` no tiene aprobador y en el `SIL` el autor
 * se verifica a sí mismo. Una demostración en la que todo está bien no enseña
 * la mitad de la pantalla.
 */
const DEMO_SIGNATURES: readonly {
  readonly code: string
  readonly step: string
  readonly position: number
  readonly role: string
  readonly minutes: number | null
}[] = [
  { code: 'PGS', step: 'author', position: 1, role: 'Ing. de seguridad', minutes: 960 },
  { code: 'PGS', step: 'verifier', position: 1, role: 'Ing. de sistemas', minutes: 180 },
  { code: 'PGS', step: 'verifier', position: 2, role: 'Jefe de seguridad', minutes: 120 },
  { code: 'PGS', step: 'approver', position: 1, role: 'Jefe de ingeniería', minutes: 60 },
  { code: 'PGS', step: 'reviewer', position: 1, role: 'Calidad', minutes: null },
  { code: 'PGS', step: 'reviewer', position: 2, role: 'Compras', minutes: null },
  // Sin aprobador: el entregable no se puede cerrar, y la pantalla lo dice.
  { code: 'PHA', step: 'author', position: 1, role: 'Ing. de seguridad', minutes: 480 },
  { code: 'PHA', step: 'verifier', position: 1, role: 'Ing. de sistemas', minutes: 120 },
  { code: 'HL', step: 'author', position: 1, role: 'Ing. de seguridad', minutes: 240 },
  { code: 'HL', step: 'verifier', position: 1, role: 'Jefe de seguridad', minutes: 90 },
  { code: 'HL', step: 'approver', position: 1, role: 'Jefe de ingeniería', minutes: 45 },
  // El autor se verifica a sí mismo: no hay independencia, y se avisa.
  { code: 'SIL', step: 'author', position: 1, role: 'Ing. de seguridad', minutes: 360 },
  { code: 'SIL', step: 'verifier', position: 1, role: 'Ing. de seguridad', minutes: 90 },
  { code: 'SIL', step: 'approver', position: 1, role: 'Jefe de ingeniería', minutes: 45 },
  // «Ing. de seguridad 1» y «2» son dos personas del mismo puesto: eso SÍ es
  // independiente, y es como lo escriben los procedimientos de verdad.
  { code: 'FMECA', step: 'author', position: 1, role: 'Ing. de seguridad 1', minutes: 1800 },
  { code: 'FMECA', step: 'verifier', position: 1, role: 'Ing. de seguridad 2', minutes: 240 },
  { code: 'FMECA', step: 'verifier', position: 2, role: 'Ing. de sistemas', minutes: 180 },
  { code: 'FMECA', step: 'approver', position: 1, role: 'Jefe de ingeniería', minutes: 60 },
  { code: 'SC', step: 'author', position: 1, role: 'Jefe de seguridad', minutes: 2400 },
  { code: 'SC', step: 'verifier', position: 1, role: 'Ing. de seguridad 1', minutes: 480 },
  { code: 'SC', step: 'verifier', position: 2, role: 'Ing. de sistemas', minutes: 300 },
  { code: 'SC', step: 'approver', position: 1, role: 'Jefe de ingeniería', minutes: 120 },
  { code: 'SC', step: 'reviewer', position: 1, role: 'Calidad', minutes: null },
]

async function seedDocuments(db: Queryable): Promise<void> {
  for (const [index, doc] of DEMO_DOCUMENTS.entries()) {
    await db.query(
      `INSERT INTO document_type (code, name, description, sort_key)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [doc.code, doc.name, doc.detail, (index + 1) * 10],
    )
  }
  for (const [antes, despues] of DEMO_PRECEDENCES) {
    await db.query(
      `INSERT INTO document_precedence (predecessor_id, successor_id)
       SELECT a.id, b.id FROM document_type a, document_type b
       WHERE a.code = $1 AND b.code = $2
       ON CONFLICT DO NOTHING`,
      [antes, despues],
    )
  }

  for (const firma of DEMO_SIGNATURES) {
    await db.query(
      `INSERT INTO document_signature (document_type_id, step, position, role, standard_minutes)
       SELECT d.id, $2::signature_step, $3, $4, $5 FROM document_type d WHERE d.code = $1
       ON CONFLICT DO NOTHING`,
      [firma.code, firma.step, firma.position, firma.role, firma.minutes],
    )
  }

  // Y unas cuantas tareas entregando documentos, para que la ficha de una tarea
  // no salga vacía la primera vez que se abre.
  await db.query(
    `INSERT INTO node_document (node_id, document_type_id)
     SELECT v.entity_id, d.id
     FROM field_value v
     JOIN field_definition f ON f.id = v.field_id
       AND f.entity_type = 'wbs_node' AND f.field_key = 'rams_tag'
     JOIN document_type d ON d.code = CASE v.value_text
       WHEN 'Plan' THEN 'PGS'
       WHEN 'Hazard Log' THEN 'HL'
       WHEN 'Requisitos' THEN 'SRS'
       WHEN 'SIL' THEN 'SIL'
       WHEN 'FMECA' THEN 'FMECA'
       WHEN 'RAM' THEN 'RAM'
       WHEN 'V&V' THEN 'VV'
       WHEN 'Safety Case' THEN 'SC'
       ELSE NULL END
     JOIN wbs_node n ON n.id = v.entity_id AND n.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
  )
}

async function seedResources(db: Queryable): Promise<void> {
  for (const resource of RESOURCES) {
    const id = uuid(1, resource.key)
    await db.query(
      `INSERT INTO resource (id, code, display_name, resource_kind, calendar_id, max_units_bp)
       VALUES ($1, $2, $3, 'person', $4, 10000)`,
      [id, resource.code, resource.name, resource.calendarId],
    )
    for (const [code, level] of Object.entries(resource.skills ?? {})) {
      await db.query(
        `INSERT INTO resource_skill (resource_id, skill_id, level)
         SELECT $1, s.id, $3 FROM skill s WHERE s.code = $2
         ON CONFLICT (resource_id, skill_id) DO UPDATE SET level = EXCLUDED.level`,
        [id, code, level],
      )
    }
    const availability = resource.availability ?? [{ from: '2026-01-01', to: '2029-12-31', unitsBp: 10_000 }]
    for (const period of availability) {
      await db.query(
        `INSERT INTO resource_availability (resource_id, valid_period, units_bp)
         VALUES ($1, daterange($2::date, ($3::date + 1), '[)'), $4)`,
        [id, period.from, period.to, period.unitsBp],
      )
    }
    for (const absence of resource.absences ?? []) {
      await db.query(
        `INSERT INTO absence (resource_id, absence_kind, date_from, date_to, minutes_per_day)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, absence.kind, absence.from, absence.to, absence.minutesPerDay ?? null],
      )
    }
    await db.query(
      `INSERT INTO resource_cost_rate (resource_id, valid_period, currency, standard_cents_hour)
       VALUES ($1, daterange('2026-01-01', '2030-01-01', '[)'), 'EUR', $2)`,
      [id, resource.centsPerHour],
    )
  }
}

/** Los atributos del dominio son datos, no columnas (P6). */
/**
 * La disciplina RAMS la define una migración, porque es un campo del dominio y
 * no del juego de datos de ejemplo. Aquí sólo se localiza; el `INSERT` es para
 * una base a la que le faltara, no para la ruta normal.
 */
async function seedFieldDefinitions(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO field_definition (entity_type, field_key, label, data_type, options, display_order)
     VALUES ('wbs_node', 'rams_tag', 'Disciplina RAMS', 'single_select', $1::jsonb, 1)
     ON CONFLICT (entity_type, field_key) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [JSON.stringify(['Plan', 'Definición', 'Hazard Log', 'Requisitos', 'SIL', 'FMECA', 'RAM', 'V&V', 'Safety Case'])],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('No se pudo definir el campo de disciplina RAMS')
  return id
}

async function seedProjects(db: Queryable, ramsFieldId: string): Promise<void> {
  for (const project of PROJECTS) {
    const projectId = uuid(2, project.key)
    await db.query(
      `INSERT INTO project (id, code, name, calendar_id, status_start, priority, currency)
       VALUES ($1, $2, $3, $4, $5, $6, 'EUR')`,
      [projectId, project.code, project.name, CAL_BW, project.start, project.key * 100],
    )

    const phaseIds = new Map<number, string>()
    for (const [index, phase] of project.phases.entries()) {
      const phaseId = uuid(3, phase.key)
      phaseIds.set(phase.key, phaseId)
      await db.query(
        `INSERT INTO wbs_node (id, project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, $2, NULL, 'phase', $3, $4, $5, $6)`,
        [phaseId, projectId, String(index + 1), pad(index + 1), index, phase.name],
      )
    }

    for (const [index, task] of project.tasks.entries()) {
      const nodeId = uuid(4, task.key)
      const parentId = phaseIds.get(task.phase) ?? null
      const phaseIndex = project.phases.findIndex((phase) => phase.key === task.phase)
      await db.query(
        `INSERT INTO wbs_node (id, project_id, parent_id, node_kind, code, path, sort_key, name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          nodeId,
          projectId,
          parentId,
          task.milestone === true ? 'milestone' : 'task',
          `${String(phaseIndex + 1)}.${String(index + 1)}`,
          `${pad(phaseIndex + 1)}.${pad(index + 1)}`,
          index,
          task.name,
        ],
      )
      await db.query(
        `INSERT INTO task (node_id, task_type, is_effort_driven, duration_minutes, work_declared_minutes,
                           constraint_kind, constraint_date, deadline, percent_complete_bp,
                           standard_effort_minutes, is_milestone)
         VALUES ($1, 'fixed_duration', TRUE, $2, 0, $3, $4, $5, $6, $7, $8)`,
        [
          nodeId,
          task.days * DAY,
          task.constraint?.kind ?? 'asap',
          task.constraint?.date ?? null,
          task.deadline ?? null,
          progressFor(task),
          task.standardDays === undefined ? null : task.standardDays * DAY,
          task.milestone === true,
        ],
      )
      if (task.ramsTag !== undefined) {
        await db.query(
          'INSERT INTO field_value (field_id, entity_id, value_text) VALUES ($1, $2, $3)',
          [ramsFieldId, nodeId, task.ramsTag],
        )
        // La disciplina dice de qué va la tarea; el requisito dice qué hay que
        // saber para hacerla. Aquí coinciden, pero son cosas distintas: una se
        // usa para agrupar y la otra se comprueba.
        await db.query(
          `INSERT INTO node_skill_requirement (node_id, skill_id, min_level)
           SELECT $1, s.id, 3 FROM skill s WHERE s.code = $2
           ON CONFLICT (node_id, skill_id) DO NOTHING`,
          [nodeId, task.ramsTag],
        )
      }
      for (const link of task.after ?? []) {
        await db.query(
          `INSERT INTO dependency (predecessor_node_id, successor_node_id, dependency_kind, lag_minutes)
           VALUES ($1, $2, 'FS', 0)`,
          [uuid(4, link), nodeId],
        )
      }
      for (const assignment of task.assign ?? []) {
        await db.query(
          `INSERT INTO assignment (node_id, resource_id, units_bp, contour_kind)
           VALUES ($1, $2, $3, $4)`,
          [nodeId, uuid(1, assignment.resource), assignment.unitsBp ?? 10_000, assignment.contour ?? 'flat'],
        )
      }
    }
  }
}

/** Algo de avance declarado en las primeras tareas, para que el plan parezca vivo. */
function progressFor(task: DemoTask): number {
  if (task.key === 101) return 10_000
  if (task.key === 102) return 6_000
  if (task.key === 103) return 3_000
  return 0
}

function pad(value: number): string {
  return String(value).padStart(3, '0')
}
