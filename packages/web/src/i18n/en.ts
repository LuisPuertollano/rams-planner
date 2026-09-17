import type { Diccionario } from './index.js'

/**
 * English. Typed against the Spanish dictionary: a missing key is a compile
 * error, not a Spanish sentence in the middle of an English screen.
 */
export const en: Diccionario = {
  'app.nombre': 'RAMS Planner',
  'app.lema': 'workload, explained down to the last minute',
  'app.cargando': 'Loading…',
  'app.errorCargar': 'Could not load',
  'app.errorRecargar': 'Could not reload',
  'app.entendido': 'Got it',

  'boton.importar': 'Import CSV',
  'boton.exportar': 'Export',
  'boton.exportarTitulo': 'Download the monthly workload as CSV, with the run identifier on every row',
  'boton.lineaBase': 'Baseline',
  'boton.lineaBaseTitulo': 'Freeze the current plan as a baseline',
  'boton.nivelar': 'Level',
  'boton.nivelarTitulo':
    "Delay tasks until the plan fits the team's capacity. Creates a new run; the original plan is untouched",
  'boton.recalcular': 'Recalculate',
  'boton.calculando': 'Calculating…',
  'boton.contrasena': 'Password',
  'boton.contrasenaTitulo': 'Change my password',
  'boton.salir': 'Sign out',
  'boton.tema': 'Theme: automatic, light or dark',
  'boton.idioma': 'Language',

  'lineaBase.pide': 'Name for the baseline',
  'lineaBase.porDefecto': 'Plan %s',
  'lineaBase.error': 'Could not freeze the baseline',
  'calculo.error': 'Could not recalculate',
  'calculo.nivelado':
    "Levelled: %s task(s) delayed so the plan fits the team's capacity. Compare against the previous run to see what it cost.",
  'calculo.niveladoParcial':
    'Partially levelled: %s task(s) delayed, but overloads remain that no delay can fix. Check the findings.',
  'calculo.razonInterfaz': 'recalculated from the interface',
  'calculo.razonNivelacion': 'resource levelling',

  'ejecucion.chip': 'run %s · engine %s · %s · %s ms',
  'ejecucion.hash': 'Input hash: %s',

  'tab.carga': 'Workload',
  'tab.carga.pista': 'How many hours each person has committed, each month, on each project',
  'tab.saturacion': 'Saturation',
  'tab.saturacion.pista': 'Who goes over capacity, when, and by how much',
  'tab.plan': 'Plan',
  'tab.plan.pista': 'The work breakdown with its calculated dates',
  'tab.cronograma': 'Timeline',
  'tab.cronograma.pista': 'The plan over time, with the critical path',
  'tab.equipo': 'Team',
  'tab.equipo.pista': "What capacity is made of: each person's calendar, availability, absences and rate",
  'tab.calendario': 'Calendar',
  'tab.calendario.pista': "Who is away, when, and what capacity the team has left each day",
  'tab.competencias': 'Skills',
  'tab.competencias.pista': 'Who can do what, and where the team has a single specialist',
  'tab.documentos': 'Documents',
  'tab.documentos.pista':
    'Which deliverables exist and which is a precondition for which. Declared once, valid for every project',
  'tab.reparto': 'Rebalance',
  'tab.reparto.pista': 'What work could move, to whom, and what it would fix. Proposals, not decisions',
  'tab.hallazgos': 'Findings',
  'tab.hallazgos.pista': 'Everything the engine wants to tell you',
  'tab.comparar': 'Compare',
  'tab.comparar.pista': "How today's plan differs from the one you froze",
  'tab.registro': 'Change log',
  'tab.registro.pista': 'Who changed what and when, with their comment',
  'tab.admin': 'Administration',
  'tab.admin.pista': 'Who gets in, which role they have, and what each role allows',

  'nota.admin': '✎ what you tick here is what the API actually allows',
  'nota.documentos': '✎ the row is a precondition for the column',
  'nota.registro': '🔒 read-only · the log is written by the database, not the application',
  'nota.declarado': '✎ all declared · every change recalculates the plan',
  'nota.plan': '✎ declared · 🔒 derived, not editable',
  'nota.derivado': '🔒 derived columns · not editable',

  'stat.planificado': 'Planned work',
  'stat.planificado.sobre': 'against %s h of capacity in those months',
  'stat.planificado.recortado': 'across the projects you can see',
  'stat.ocupacion': 'Team utilisation',
  'stat.ocupacion.media': 'average of the months with work',
  'stat.ocupacion.sinCapacidad':
    'capacity belongs to the whole team: you need to see the workload across the whole tool',
  'stat.sobrecargadas': 'People overloaded',
  'stat.sobrecargadas.pista': 'in at least one month',
  'stat.sobrecargadas.sinCapacidad': 'only with the workload of the whole tool',
  'stat.coste': 'Committed cost',
  'stat.coste.pista': "hours times each day's applicable rate",
  'stat.coste.cero': 'comes out at zero: the team is missing rates',
  'stat.criticas': 'Critical tasks',
  'stat.criticas.pista': 'no slack: delaying them delays the plan',

  'vacio.nada.titulo': 'There is nothing here yet',
  'vacio.nada.texto':
    'The order that works is this: the Team first, because capacity and cost come from there; then the plan, by importing a CSV or building it by hand.',
  'vacio.nada.irEquipo': 'Go to the team',
  'vacio.nada.plantilla': 'Download the CSV template',
  'vacio.nada.demo': 'Just want to see it work? %s loads three overlapping projects.',
  'vacio.sinPermisos.titulo': 'Your account has no permissions yet',
  'vacio.sinPermisos.texto':
    'You are signed in, but nobody has granted you a role yet. Whoever administers the tool can do it from Administration → Users and roles.',

  'abierta.aviso':
    'This installation has no users at all, so it is open to anyone who reaches it. Create the first one with %s.',

  'login.correo': 'Email',
  'login.contrasena': 'Password',
  'login.entrar': 'Sign in',
  'login.entrando': 'Signing in…',
  'login.error': 'Could not sign in',
  'login.pie':
    'No account? Whoever administers the tool gives you one. If you have just installed it and there is none, create the first with %s.',

  'clave.titulo': 'Change my password',
  'clave.cerrar': 'Close',
  'clave.actual': 'Current password',
  'clave.nueva': 'New password (%s characters or more)',
  'clave.repite': 'Repeat the new one',
  'clave.corta': 'The new one needs %s characters or more.',
  'clave.distintas': 'The two copies of the new password do not match.',
  'clave.igual': 'The new one has to be different from the current one.',
  'clave.aviso':
    'Changing it closes all your sessions, including this one: you will have to sign in again with the new password. That is deliberate — if you are changing it because somebody else knew it, leaving sessions alive fixes nothing.',
  'clave.enviar': 'Change and sign in again',
  'clave.enviando': 'Changing…',
  'clave.error': 'Could not change the password',
}
