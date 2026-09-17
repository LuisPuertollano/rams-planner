import type { Diccionario } from './index.js'

/**
 * Deutsch. Gegen das spanische Wörterbuch typisiert: ein fehlender Schlüssel
 * ist ein Übersetzungsfehler zur Bauzeit, kein spanischer Satz mitten auf einer
 * deutschen Seite.
 */
export const de: Diccionario = {
  'app.nombre': 'RAMS Planner',
  'app.lema': 'Arbeitslast, bis auf die letzte Minute erklärt',
  'app.cargando': 'Wird geladen…',
  'app.errorCargar': 'Konnte nicht geladen werden',
  'app.errorRecargar': 'Konnte nicht neu geladen werden',
  'app.entendido': 'Verstanden',

  'boton.importar': 'CSV importieren',
  'boton.exportar': 'Exportieren',
  'boton.exportarTitulo': 'Die monatliche Auslastung als CSV, mit der Lauf-Kennung in jeder Zeile',
  'boton.lineaBase': 'Basisplan',
  'boton.lineaBaseTitulo': 'Den aktuellen Plan als Basisplan einfrieren',
  'boton.nivelar': 'Nivellieren',
  'boton.nivelarTitulo':
    'Aufgaben verschieben, bis der Plan in die Kapazität des Teams passt. Erzeugt einen neuen Lauf; der ursprüngliche Plan bleibt unberührt',
  'boton.recalcular': 'Neu berechnen',
  'boton.calculando': 'Wird berechnet…',
  'boton.contrasena': 'Passwort',
  'boton.contrasenaTitulo': 'Mein Passwort ändern',
  'boton.salir': 'Abmelden',
  'boton.tema': 'Darstellung: automatisch, hell oder dunkel',
  'boton.idioma': 'Sprache',

  'lineaBase.pide': 'Name des Basisplans',
  'lineaBase.porDefecto': 'Plan %s',
  'lineaBase.error': 'Der Basisplan konnte nicht eingefroren werden',
  'calculo.error': 'Konnte nicht neu berechnet werden',
  'calculo.nivelado':
    'Nivelliert: %s Aufgabe(n) verschoben, damit der Plan in die Kapazität des Teams passt. Vergleiche mit dem vorherigen Lauf, um zu sehen, was es gekostet hat.',
  'calculo.niveladoParcial':
    'Teilweise nivelliert: %s Aufgabe(n) verschoben, aber es bleiben Überlastungen, die keine Verschiebung behebt. Sieh dir die Befunde an.',
  'calculo.razonInterfaz': 'Neuberechnung aus der Oberfläche',
  'calculo.razonNivelacion': 'Ressourcennivellierung',

  'ejecucion.chip': 'Lauf %s · Engine %s · %s · %s ms',
  'ejecucion.hash': 'Hash der Eingaben: %s',

  'tab.carga': 'Auslastung',
  'tab.carga.pista': 'Wie viele Stunden jede Person pro Monat und Projekt fest zugesagt hat',
  'tab.saturacion': 'Sättigung',
  'tab.saturacion.pista': 'Wer über die Kapazität geht, wann und um wie viel',
  'tab.plan': 'Plan',
  'tab.plan.pista': 'Der Projektstrukturplan mit den berechneten Terminen',
  'tab.cronograma': 'Zeitplan',
  'tab.cronograma.pista': 'Der Plan über die Zeit, mit dem kritischen Pfad',
  'tab.equipo': 'Team',
  'tab.equipo.pista':
    'Woraus die Kapazität besteht: Kalender, Verfügbarkeit, Abwesenheiten und Stundensatz jeder Person',
  'tab.calendario': 'Kalender',
  'tab.calendario.pista': 'Wer wann abwesend ist und welche Kapazität dem Team pro Tag bleibt',
  'tab.competencias': 'Kompetenzen',
  'tab.competencias.pista': 'Wer was kann, und wo das Team nur eine einzige Fachkraft hat',
  'tab.documentos': 'Dokumente',
  'tab.documentos.pista':
    'Welche Lieferobjekte es gibt und welches Voraussetzung für welches ist. Einmal festgelegt, gilt für alle Projekte',
  'tab.reparto': 'Umverteilung',
  'tab.reparto.pista':
    'Welche Arbeit sich verschieben ließe, auf wen, und was das beheben würde. Vorschläge, keine Entscheidungen',
  'tab.hallazgos': 'Befunde',
  'tab.hallazgos.pista': 'Alles, was die Engine dir sagen will',
  'tab.comparar': 'Vergleichen',
  'tab.comparar.pista': 'Worin sich der heutige Plan von dem eingefrorenen unterscheidet',
  'tab.registro': 'Änderungsprotokoll',
  'tab.registro.pista': 'Wer was wann geändert hat, mit Kommentar',
  'tab.admin': 'Verwaltung',
  'tab.admin.pista': 'Wer hereinkommt, welche Rolle sie hat und was jede Rolle erlaubt',

  'nota.admin': '✎ was du hier ankreuzt, ist das, was die API tatsächlich zulässt',
  'nota.documentos': '✎ die Zeile ist Voraussetzung für die Spalte',
  'nota.registro': '🔒 nur lesen · das Protokoll schreibt die Datenbank, nicht die Anwendung',
  'nota.declarado': '✎ alles erklärt · jede Änderung berechnet den Plan neu',
  'nota.plan': '✎ erklärt · 🔒 abgeleitet, nicht bearbeitbar',
  'nota.derivado': '🔒 abgeleitete Spalten · nicht bearbeitbar',

  'stat.planificado': 'Geplante Arbeit',
  'stat.planificado.sobre': 'bei %s h Kapazität in diesen Monaten',
  'stat.planificado.recortado': 'in den Projekten, die du sehen darfst',
  'stat.ocupacion': 'Auslastung des Teams',
  'stat.ocupacion.media': 'Mittel der Monate mit Arbeit',
  'stat.ocupacion.sinCapacidad':
    'Die Kapazität gehört dem ganzen Team: dafür brauchst du die Auslastung im gesamten Werkzeug',
  'stat.sobrecargadas': 'Überlastete Personen',
  'stat.sobrecargadas.pista': 'in mindestens einem Monat',
  'stat.sobrecargadas.sinCapacidad': 'nur mit der Auslastung des gesamten Werkzeugs',
  'stat.coste': 'Zugesagte Kosten',
  'stat.coste.pista': 'Stunden mal dem jeweils gültigen Tagessatz',
  'stat.coste.cero': 'kommt auf null heraus: dem Team fehlen die Stundensätze',
  'stat.criticas': 'Kritische Aufgaben',
  'stat.criticas.pista': 'ohne Puffer: sie zu verschieben verschiebt den Plan',

  'vacio.nada.titulo': 'Hier ist noch nichts',
  'vacio.nada.texto':
    'Die Reihenfolge, die funktioniert: zuerst das Team, denn daraus ergeben sich Kapazität und Kosten; danach der Plan, per CSV-Import oder von Hand.',
  'vacio.nada.irEquipo': 'Zum Team',
  'vacio.nada.plantilla': 'CSV-Vorlage herunterladen',
  'vacio.nada.demo': 'Willst du es nur laufen sehen? %s lädt drei sich überschneidende Projekte.',
  'vacio.sinPermisos.titulo': 'Dein Konto hat noch keine Berechtigungen',
  'vacio.sinPermisos.texto':
    'Die Anmeldung hat geklappt, aber dir wurde noch keine Rolle zugewiesen. Wer das Werkzeug verwaltet, kann das unter Verwaltung → Benutzer und Rollen tun.',

  'abierta.aviso':
    'Diese Installation hat noch keinen einzigen Benutzer und steht damit jedem offen, der sie erreicht. Lege den ersten mit %s an.',

  'login.correo': 'E-Mail',
  'login.contrasena': 'Passwort',
  'login.entrar': 'Anmelden',
  'login.entrando': 'Wird angemeldet…',
  'login.error': 'Anmeldung fehlgeschlagen',
  'login.pie':
    'Kein Konto? Das bekommst du von der Person, die das Werkzeug verwaltet. Wenn du es gerade installiert hast und es noch keins gibt, lege das erste mit %s an.',

  'clave.titulo': 'Mein Passwort ändern',
  'clave.cerrar': 'Schließen',
  'clave.actual': 'Aktuelles Passwort',
  'clave.nueva': 'Neues Passwort (%s Zeichen oder mehr)',
  'clave.repite': 'Neues Passwort wiederholen',
  'clave.corta': 'Das neue braucht %s Zeichen oder mehr.',
  'clave.distintas': 'Die beiden Eingaben des neuen Passworts stimmen nicht überein.',
  'clave.igual': 'Das neue muss sich vom aktuellen unterscheiden.',
  'clave.aviso':
    'Beim Ändern werden alle deine Sitzungen beendet, auch diese: du musst dich mit dem neuen Passwort neu anmelden. Das ist Absicht — wenn du es änderst, weil jemand anderes es kannte, hilft es nichts, Sitzungen offen zu lassen.',
  'clave.enviar': 'Ändern und neu anmelden',
  'clave.enviando': 'Wird geändert…',
  'clave.error': 'Das Passwort konnte nicht geändert werden',
}
