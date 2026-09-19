/**
 * El catálogo de documentos y la matriz de precedencias.
 *
 * Nada de lo que se escribe aquí cambia un plan por sí solo, así que nada de
 * esto recalcula. Es una declaración: qué entregables hay y en qué orden se
 * pueden hacer. Lo que la aplica a un proyecto concreto viene después.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  activityMinutes,
  checkActivities,
  checkDeliveries,
  checkSignatureCycle,
  lastGate,
  type ActivityProblem,
  type ActivityStep,
  type DeliveryProblem,
  type DocumentActivity,
  type Signature,
  type SignatureProblem,
} from '@planner/domain'
import {
  createDocumentType,
  readActivities,
  readDeliveries,
  readDocumentTypes,
  readPrecedences,
  readSignatures,
  setActivities,
  setNodeDocument,
  setPrecedence,
  setPredecessors,
  setSignatures,
  softDeleteDocumentType,
  updateDocumentType,
  withTransaction,
  DOCUMENT_KINDS,
  type DocumentActivityRow,
  type DocumentGateRow,
  type DocumentKind,
  type DocumentSignature,
  type Pool,
} from '@planner/persistence'
import { toCsv } from './csv.js'
import { fallar } from './errors.js'
import { ImportError } from './import-plan.js'
import { importDocumentsCsv } from './import-documents.js'
import { DOCUMENTS_SPEC, plantillaCsv } from './import-specs.js'
import { desde, porNodo } from './permissions.js'

/** Los campos de la ficha, en un sitio: los comparten el alta y la edición. */
const ficha = {
  description: z.string().max(1000).nullable().optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  discipline: z.string().max(60).nullable().optional(),
  gate: z.string().max(60).nullable().optional(),
  weeksBeforeGate: z.number().int().min(0).max(1000).nullable().optional(),
  standardMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  taskCode: z.string().max(60).nullable().optional(),
  sortKey: z.number().int().min(0).max(100_000).optional(),
}

/**
 * Una firma que llega del cliente. **Rol, nunca persona**: el esquema no acepta
 * un identificador de recurso y no es un descuido — el catálogo dice que hace
 * falta un jefe RAMS, no quién lo es esta semana.
 */
const firmaSchema = z.object({
  step: z.enum(['author', 'verifier', 'approver', 'reviewer']),
  position: z.number().int().min(1).max(20),
  role: z.string().trim().min(1).max(80),
  standardMinutes: z.number().int().min(0).max(10_000_000).nullable(),
})

/**
 * Una subactividad que llega del cliente. Rol y nunca persona, igual que la
 * firma. `signature` es la firma que esta subactividad descarga, si descarga
 * alguna: es lo que saca los minutos de firma de estar sueltos.
 */
const subactividadSchema = z.object({
  step: z.enum(['create', 'review_1', 'review_2', 'review_3', 'support']),
  position: z.number().int().min(1).max(20),
  role: z.string().trim().min(1).max(80),
  standardMinutes: z.number().int().min(0).max(10_000_000).nullable(),
  signature: z
    .object({
      step: z.enum(['author', 'verifier', 'approver', 'reviewer']),
      position: z.number().int().min(1).max(20),
    })
    .nullable()
    .default(null),
})

/**
 * Las columnas de la exportación, tomadas del contrato de la importación.
 *
 * De ahí y no de una lista propia: exportar, corregir en la hoja de cálculo y
 * volver a importar sólo funciona si el fichero que sale es el que entra, y
 * dos listas paralelas se separan el día que alguien añade una columna.
 */
const COLUMNAS_CSV = DOCUMENTS_SPEC.columnas.map((columna) => columna.nombre)

/** Un problema del ciclo, con el entregable al que pertenece. */
interface ProblemaDeFirma extends SignatureProblem {
  readonly documentTypeId: string
}

/**
 * Los problemas de todos los ciclos del catálogo, en una pasada.
 *
 * El orden es el del catálogo y, dentro de cada entregable, el de la propia
 * función pura: salida estable (P2), que es lo que permite comparar dos
 * lecturas sin que la lista baile.
 */
function problemasDeFirma(
  types: readonly { readonly id: string; readonly kind: DocumentKind }[],
  signatures: readonly DocumentSignature[],
): readonly ProblemaDeFirma[] {
  const porDocumento = new Map<string, DocumentSignature[]>()
  for (const firma of signatures) {
    const lista = porDocumento.get(firma.documentTypeId) ?? []
    lista.push(firma)
    porDocumento.set(firma.documentTypeId, lista)
  }
  return types.flatMap((tipo) =>
    checkSignatureCycle(tipo.kind, porDocumento.get(tipo.id) ?? []).map((problema) => ({
      ...problema,
      documentTypeId: tipo.id,
    })),
  )
}

/**
 * El ciclo de firma, repartido en las cinco casillas del CSV.
 *
 * Al volver al fichero se pierde algo y conviene saber qué: los minutos de cada
 * firma, que el CSV no lleva, y cualquier verificador a partir del tercero, que
 * no tiene columna. Lo primero es a propósito; lo segundo no le ha pasado a
 * ningún procedimiento visto hasta ahora, y si pasa, el que sobre se queda en
 * la base y no en el fichero.
 */
function casillasDeFirma(firmas: readonly DocumentSignature[]): Readonly<Record<string, string>> {
  const rol = (step: Signature['step'], position: number): string =>
    firmas.find((firma) => firma.step === step && firma.position === position)?.role ?? ''
  return {
    autor: rol('author', 1),
    verificador_1: rol('verifier', 1),
    verificador_2: rol('verifier', 2),
    aprobador: rol('approver', 1),
    revisores: firmas
      .filter((firma) => firma.step === 'reviewer')
      .map((firma) => firma.role)
      .join('|'),
  }
}

/**
 * Las cinco casillas de la cadena para el CSV, en la forma que el importador
 * vuelve a leer: `rol:horas` y, si descarga una firma, `rol:horas:firma`.
 *
 * Que la exportación escriba exactamente lo que la importación lee no es un
 * detalle: el fichero exportado es la mejor plantilla que existe, porque ya
 * lleva dentro el catálogo de quien lo descarga.
 */
function casillasDeSubactividad(
  actividades: readonly DocumentActivityRow[],
): Readonly<Record<string, string>> {
  const NOMBRE_DE_FIRMA: Readonly<Record<string, string>> = {
    'author:1': 'autor',
    'verifier:1': 'verificador_1',
    'verifier:2': 'verificador_2',
    'approver:1': 'aprobador',
    'reviewer:1': 'revisores',
  }
  const casilla = (step: ActivityStep): string => {
    const actividad = actividades.find((a) => a.step === step)
    if (actividad === undefined) return ''
    const horas =
      actividad.standardMinutes === null
        ? ''
        : `:${(actividad.standardMinutes / 60).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}`
    const firma =
      actividad.signature === null
        ? ''
        : `:${NOMBRE_DE_FIRMA[`${actividad.signature.step}:${String(actividad.signature.position)}`] ?? ''}`
    return `${actividad.role}${horas}${firma}`
  }
  return {
    crear: casilla('create'),
    revisar_1: casilla('review_1'),
    revisar_2: casilla('review_2'),
    revisar_3: casilla('review_3'),
    soportar: casilla('support'),
  }
}

/**
 * Las entregas previas para el CSV, tal y como el importador las lee:
 * `PGR:preliminar:30:4|IGR:as designed:20`.
 */
function casillaDeEntregas(entregas: readonly DocumentGateRow[]): string {
  return entregas
    .map((entrega) => {
      const semanas = entrega.weeksBeforeGate === null ? '' : `:${String(entrega.weeksBeforeGate)}`
      return `${entrega.gate}:${entrega.maturity}:${String(Math.round(entrega.shareBp / 100))}${semanas}`
    })
    .join('|')
}

/** Un problema de las subactividades, con el entregable al que pertenece. */
interface ProblemaDeActividad extends ActivityProblem {
  readonly documentTypeId: string
}

/** Agrupa por entregable conservando el orden de lectura (P2). */
function porEntregable<T extends { readonly documentTypeId: string }>(
  filas: readonly T[],
): ReadonlyMap<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const fila of filas) {
    const lista = mapa.get(fila.documentTypeId) ?? []
    lista.push(fila)
    mapa.set(fila.documentTypeId, lista)
  }
  return mapa
}

/**
 * Los problemas de las subactividades de todo el catálogo, en una pasada.
 *
 * Se le pasan también las firmas porque la comprobación que más importa —una
 * firma que cuesta minutos y que ninguna subactividad hace— necesita las dos
 * listas. Es el hueco que ADR-0032 dejó escrito.
 */
function problemasDeActividad(
  types: readonly { readonly id: string; readonly kind: DocumentKind }[],
  activities: readonly DocumentActivityRow[],
  signatures: readonly DocumentSignature[],
): readonly ProblemaDeActividad[] {
  const actividadesDe = porEntregable(activities)
  const firmasDe = porEntregable(signatures)
  return types.flatMap((tipo) =>
    checkActivities(tipo.kind, actividadesDe.get(tipo.id) ?? [], firmasDe.get(tipo.id) ?? []).map(
      (problema) => ({ ...problema, documentTypeId: tipo.id }),
    ),
  )
}

/** Un problema de las entregas previas, con el entregable al que pertenece. */
interface ProblemaDeEntrega extends DeliveryProblem {
  readonly documentTypeId: string
}

/** Lo que está mal en las Checklisten declaradas, en una pasada y en orden. */
function problemasDeEntrega(
  types: readonly { readonly id: string; readonly kind: DocumentKind; readonly gate: string | null }[],
  deliveries: readonly DocumentGateRow[],
): readonly ProblemaDeEntrega[] {
  const entregasDe = porEntregable(deliveries)
  return types.flatMap((tipo) =>
    checkDeliveries(entregasDe.get(tipo.id) ?? [], tipo.kind, tipo.gate).map((problema) => ({
      ...problema,
      documentTypeId: tipo.id,
    })),
  )
}

/**
 * Lo que cuesta cada entregable según sus subactividades, y por dónde cierra.
 *
 * Se manda calculado y no se deja para la pantalla por lo mismo de siempre: la
 * regla —qué subactividad cierra el entregable de cara a los demás— vive en
 * `domain` y escribirla otra vez en la web sería escribirla dos veces.
 *
 * `gate` es la subactividad que cierra: la revisión de nivel más alto, o la
 * creación si no hay ninguna. Es lo que el plan usará para atar el siguiente
 * documento, y enseñarlo ahora deja ver la decisión antes de que cambie nada.
 */
interface EsfuerzoDelEntregable {
  readonly documentTypeId: string
  readonly minutes: number
  readonly gateStep: DocumentActivity['step'] | null
  readonly gateRole: string | null
}

function esfuerzoPorEntregable(
  activities: readonly DocumentActivityRow[],
): readonly EsfuerzoDelEntregable[] {
  return [...porEntregable(activities)].map(([documentTypeId, actividades]) => {
    const cierra = lastGate(actividades)
    return {
      documentTypeId,
      minutes: activityMinutes(actividades),
      gateStep: cierra?.step ?? null,
      gateRole: cierra?.role ?? null,
    }
  })
}

export function registerDocumentRoutes(app: FastifyInstance, pool: Pool): void {
  const escribir = async (
    reply: FastifyReply,
    comment: string,
    handler: Parameters<typeof withTransaction<unknown>>[1],
  ): Promise<unknown> => {
    try {
      return { result: await withTransaction(pool, handler, { comment }) }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23505') {
        return fallar(reply, 422, 'DOCUMENTO_YA_EXISTE', 'Ya existe un documento con ese código.')
      }
      throw error
    }
  }

  /** El catálogo y la matriz, que es lo que pinta la pantalla de una vez. */
  app.get('/api/documents', { config: { permission: 'documentos.ver' } }, async () =>
    withTransaction(pool, async (db) => {
      const types = await readDocumentTypes(db)
      const signatures = await readSignatures(db)
      const activities = await readActivities(db)
      const deliveries = await readDeliveries(db)
      return {
        types,
        precedences: await readPrecedences(db),
        signatures,
        activities,
        deliveries,
        activityEffort: esfuerzoPorEntregable(activities),
        // Los problemas del ciclo se calculan AQUÍ y no en la pantalla, por lo
        // mismo que los hallazgos, los permisos y los errores: el código es el
        // contrato y la frase la escribe el diccionario. La alternativa era que
        // la web se trajera el paquete `domain` para repetir la comprobación, y
        // una regla escrita dos veces es una regla que se separa.
        signatureProblems: problemasDeFirma(types, signatures),
        activityProblems: problemasDeActividad(types, activities, signatures),
        deliveryProblems: problemasDeEntrega(types, deliveries),
      }
    }),
  )

  app.post('/api/documents', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(200),
        ...ficha,
      })
      .parse(request.body)
    return escribir(reply, `alta del documento ${body.code}`, (db) => createDocumentType(db, body))
  })

  app.patch('/api/documents/:documentId', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(200).optional(),
        ...ficha,
      })
      .parse(request.body)
    if (Object.keys(body).length === 0) return fallar(reply, 400, 'NADA_QUE_CAMBIAR', 'No hay nada que cambiar.')
    return escribir(reply, 'edición de un documento', async (db) => {
      await updateDocumentType(db, documentId, body)
    })
  })

  app.delete('/api/documents/:documentId', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    return escribir(reply, 'baja de un documento', async (db) => {
      await softDeleteDocumentType(db, documentId)
    })
  })

  /**
   * Una casilla de la matriz.
   *
   * Se manda el estado que debe quedar, no «alterna»: dos pestañas abiertas
   * sobre la misma matriz no deberían dejar la casilla donde no la dejó nadie.
   */
  app.put('/api/documents/precedence', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        predecessorId: z.string().uuid(),
        successorId: z.string().uuid(),
        required: z.boolean(),
      })
      .parse(request.body)
    if (body.predecessorId === body.successorId) {
      return fallar(reply, 422, 'DOCUMENTO_NO_SE_ESPERA_A_SI_MISMO', 'Un documento no se espera a sí mismo.')
    }
    return escribir(
      reply,
      body.required ? 'nueva precedencia entre documentos' : 'precedencia entre documentos retirada',
      async (db) => {
        await setPrecedence(db, body.predecessorId, body.successorId, body.required)
      },
    )
  })

  /**
   * Los predecesores de un documento, de golpe.
   *
   * Es la operación que hace usable la matriz cuando el catálogo crece: con
   * ochenta entregables, la rejilla tiene 6.400 casillas y marcar seis es una
   * tarea de puntería. Esto es «este espera a estos seis», y **sustituye la
   * lista entera**: lo que no venga se borra.
   */
  app.put('/api/documents/:documentId/predecessors', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ predecessorIds: z.array(z.string().uuid()).max(500) }).parse(request.body)
    if (body.predecessorIds.includes(documentId)) {
      return fallar(reply, 422, 'DOCUMENTO_NO_SE_ESPERA_A_SI_MISMO', 'Un documento no se espera a sí mismo.')
    }
    return escribir(reply, 'predecesores de un documento', async (db) => {
      await setPredecessors(db, documentId, body.predecessorIds)
    })
  })

  /**
   * El ciclo de firma de un entregable, de golpe.
   *
   * **Sustituye el ciclo entero**, igual que los predecesores: lo que no venga
   * se borra. Un ciclo mal repartido —sin aprobador, o con el autor
   * verificándose a sí mismo— **se guarda igual**. Avisar es trabajo de la
   * pantalla, que lo calcula con la misma función pura que la importación; un
   * catálogo a medio rellenar es el estado normal de un catálogo el primer día,
   * y una herramienta que se niega a guardarlo es una herramienta que no se usa.
   *
   * Lo único que sí se rechaza es la casilla repetida: dos firmas para el mismo
   * paso y la misma posición no es un catálogo incompleto, es un cuerpo que se
   * contradice, y guardarlo dejaría en la base sólo una de las dos sin decir
   * cuál.
   */
  app.put('/api/documents/:documentId/signatures', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ signatures: z.array(firmaSchema).max(40) }).parse(request.body)

    const casillas = body.signatures.map((firma) => `${firma.step}:${String(firma.position)}`)
    if (new Set(casillas).size !== casillas.length) {
      return fallar(
        reply,
        422,
        'FIRMA_CASILLA_REPETIDA',
        'Dos firmas ocupan el mismo paso y la misma posición.',
      )
    }
    return escribir(reply, 'ciclo de firma de un documento', async (db) => {
      await setSignatures(db, documentId, body.signatures satisfies readonly Signature[])
    })
  })

  /**
   * Las subactividades de un entregable, de golpe.
   *
   * Misma forma que el ciclo de firma y por las mismas razones: sustituye la
   * lista entera, guarda lo que esté a medias y sólo rechaza la casilla
   * repetida, que no es un catálogo incompleto sino un cuerpo que se
   * contradice.
   *
   * Lo que **no** se rechaza, y conviene saberlo: una subactividad que dice
   * descargar una firma que todavía no existe se guarda sin la firma. El
   * catálogo se llena en dos pantallas y en cualquier orden.
   */
  app.put('/api/documents/:documentId/activities', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params)
    const body = z.object({ activities: z.array(subactividadSchema).max(40) }).parse(request.body)

    const casillas = body.activities.map((actividad) => `${actividad.step}:${String(actividad.position)}`)
    if (new Set(casillas).size !== casillas.length) {
      return fallar(
        reply,
        422,
        'SUBACTIVIDAD_CASILLA_REPETIDA',
        'Dos subactividades ocupan el mismo paso y la misma posición.',
      )
    }
    return escribir(reply, 'subactividades de un documento', async (db) => {
      await setActivities(db, documentId, body.activities satisfies readonly DocumentActivity[])
    })
  })

  /**
   * El catálogo entero desde un CSV.
   *
   * Es la puerta por la que entra una plantilla de verdad: un catálogo EN 50126
   * son unas ochenta filas y unas ciento treinta flechas, y eso no se teclea.
   * Cargar dos veces el mismo fichero deja el catálogo igual que cargarlo una
   * vez: el código manda.
   */
  app.post('/api/documents/import', { config: { permission: 'documentos.gestionar' } }, async (request, reply) => {
    const text = typeof request.body === 'string' ? request.body : ''
    if (text.trim() === '') return fallar(reply, 400, 'CSV_VACIO', 'El cuerpo debe ser el CSV en texto plano.')
    try {
      return await withTransaction(pool, (db) => importDocumentsCsv(db, text), {
        comment: 'importación del catálogo de documentos desde CSV',
      })
    } catch (error) {
      if (error instanceof ImportError) {
        return fallar(reply, 422, 'CSV_INVALIDO', error.message, {
          detalle: error.message,
          rows: error.rows,
        })
      }
      throw error
    }
  })

  /**
   * El catálogo de vuelta a CSV.
   *
   * Mismas columnas que la importación, a propósito: exportar, corregir en la
   * hoja de cálculo y volver a importar es el camino corto para tocar ochenta
   * filas, y sólo funciona si el fichero que sale es el que entra.
   */
  app.get('/api/documents/export.csv', { config: { permission: 'documentos.ver' } }, async (_request, reply) => {
    const { types, precedences, signatures, activities, deliveries } = await withTransaction(pool, async (db) => ({
      types: await readDocumentTypes(db),
      precedences: await readPrecedences(db),
      signatures: await readSignatures(db),
      activities: await readActivities(db),
      deliveries: await readDeliveries(db),
    }))
    const codigoDe = new Map(types.map((tipo) => [tipo.id, tipo.code]))
    const esperaA = new Map<string, string[]>()
    for (const p of precedences) {
      const lista = esperaA.get(p.successorId) ?? []
      const codigo = codigoDe.get(p.predecessorId)
      if (codigo !== undefined) lista.push(codigo)
      esperaA.set(p.successorId, lista)
    }
    const cadenaDe = new Map<string, DocumentActivityRow[]>()
    for (const actividad of activities) {
      const lista = cadenaDe.get(actividad.documentTypeId) ?? []
      lista.push(actividad)
      cadenaDe.set(actividad.documentTypeId, lista)
    }
    const entregasDe = new Map<string, DocumentGateRow[]>()
    for (const entrega of deliveries) {
      const lista = entregasDe.get(entrega.documentTypeId) ?? []
      lista.push(entrega)
      entregasDe.set(entrega.documentTypeId, lista)
    }
    const firmasDe = new Map<string, DocumentSignature[]>()
    for (const firma of signatures) {
      const lista = firmasDe.get(firma.documentTypeId) ?? []
      lista.push(firma)
      firmasDe.set(firma.documentTypeId, lista)
    }
    const rows = types.map((tipo) => ({
      codigo: tipo.code,
      nombre: tipo.name,
      tipo: tipo.kind,
      disciplina: tipo.discipline ?? '',
      puerta: tipo.gate ?? '',
      semanas_antes: tipo.weeksBeforeGate === null ? '' : String(tipo.weeksBeforeGate),
      // De vuelta a horas con coma decimal, que es como se escribieron.
      horas:
        tipo.standardMinutes === null
          ? ''
          : (tipo.standardMinutes / 60).toFixed(2).replace(/\.?0+$/, '').replace('.', ','),
      codigo_tarea: tipo.taskCode ?? '',
      descripcion: tipo.description ?? '',
      espera_a: (esperaA.get(tipo.id) ?? []).join('|'),
      ...casillasDeFirma(firmasDe.get(tipo.id) ?? []),
      ...casillasDeSubactividad(cadenaDe.get(tipo.id) ?? []),
      entregas_previas: casillaDeEntregas(entregasDe.get(tipo.id) ?? []),
    }))
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="catalogo-documentos.csv"')
      .send(toCsv(rows, COLUMNAS_CSV))
  })

  /**
   * Qué fichero espera esta importación: la plantilla con su manual dentro, y
   * el contrato en JSON para que la pantalla lo enseñe sin llevar su copia.
   */
  app.get('/api/import/documents/formato', { config: { permission: 'documentos.gestionar' } }, () => DOCUMENTS_SPEC)

  app.get('/api/import/documents/plantilla.csv', { config: { permission: 'documentos.gestionar' } }, async (_request, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="plantilla-documents.csv"')
      .send(plantillaCsv(DOCUMENTS_SPEC)),
  )

  /** Qué entrega una tarea. Es lo que ata la matriz a un plan de verdad. */
  app.put(
    '/api/nodes/:nodeId/documents/:documentId',
    { config: { permission: 'documentos.asignar', project: desde(porNodo()) } },
    async (request, reply) => {
      const { nodeId, documentId } = z
        .object({ nodeId: z.string().uuid(), documentId: z.string().uuid() })
        .parse(request.params)
      const body = z.object({ delivers: z.boolean() }).parse(request.body)
      return escribir(reply, 'documento que entrega una tarea', async (db) => {
        await setNodeDocument(db, nodeId, documentId, body.delivers)
      })
    },
  )
}
