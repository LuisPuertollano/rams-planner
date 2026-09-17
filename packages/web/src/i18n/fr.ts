import type { Diccionario } from './index.js'

/**
 * Français. Typé sur le dictionnaire espagnol : une clé manquante est une
 * erreur de compilation, pas une phrase en espagnol au milieu d'un écran
 * français.
 */
export const fr: Diccionario = {
  'app.nombre': 'RAMS Planner',
  'app.lema': 'la charge de travail, expliquée à la minute près',
  'app.cargando': 'Chargement…',
  'app.errorCargar': 'Impossible de charger',
  'app.errorRecargar': 'Impossible de recharger',
  'app.entendido': 'Compris',

  'boton.importar': 'Importer un CSV',
  'boton.exportar': 'Exporter',
  'boton.exportarTitulo': "La charge mensuelle en CSV, avec l'identifiant du calcul sur chaque ligne",
  'boton.lineaBase': 'Référence',
  'boton.lineaBaseTitulo': 'Figer le plan actuel comme référence',
  'boton.nivelar': 'Niveler',
  'boton.nivelarTitulo':
    "Retarder des tâches jusqu'à ce que le plan tienne dans la capacité de l'équipe. Crée un nouveau calcul ; le plan d'origine n'est pas touché",
  'boton.recalcular': 'Recalculer',
  'boton.calculando': 'Calcul en cours…',
  'boton.contrasena': 'Mot de passe',
  'boton.contrasenaTitulo': 'Changer mon mot de passe',
  'boton.salir': 'Se déconnecter',
  'boton.tema': 'Thème : automatique, clair ou sombre',
  'boton.idioma': 'Langue',

  'lineaBase.pide': 'Nom de la référence',
  'lineaBase.porDefecto': 'Plan %s',
  'lineaBase.error': 'Impossible de figer la référence',
  'calculo.error': 'Impossible de recalculer',
  'calculo.nivelado':
    "Nivelé : %s tâche(s) retardée(s) pour que le plan tienne dans la capacité de l'équipe. Compare avec le calcul précédent pour voir ce que cela a coûté.",
  'calculo.niveladoParcial':
    "Nivellement partiel : %s tâche(s) retardée(s), mais il reste des surcharges qu'aucun retard ne règle. Regarde les constats.",
  'calculo.razonInterfaz': "recalcul depuis l'interface",
  'calculo.razonNivelacion': 'nivellement des ressources',

  'ejecucion.chip': 'calcul %s · moteur %s · %s · %s ms',
  'ejecucion.hash': 'Empreinte des entrées : %s',

  'tab.carga': 'Charge',
  'tab.carga.pista': 'Combien d’heures chaque personne a engagées, chaque mois, sur chaque projet',
  'tab.saturacion': 'Saturation',
  'tab.saturacion.pista': 'Qui dépasse sa capacité, quand et de combien',
  'tab.plan': 'Plan',
  'tab.plan.pista': "L'arborescence du travail avec ses dates calculées",
  'tab.cronograma': 'Chronologie',
  'tab.cronograma.pista': 'Le plan dans le temps, avec le chemin critique',
  'tab.equipo': 'Équipe',
  'tab.equipo.pista':
    'De quoi la capacité est faite : calendrier, disponibilité, absences et taux horaire de chacun',
  'tab.calendario': 'Calendrier',
  'tab.calendario.pista': "Qui est absent, quand, et quelle capacité il reste à l'équipe chaque jour",
  'tab.competencias': 'Compétences',
  'tab.competencias.pista': "Qui sait faire quoi, et où l'équipe n'a qu'un seul spécialiste",
  'tab.documentos': 'Documents',
  'tab.documentos.pista':
    'Quels livrables existent et lequel est nécessaire à quel autre. Déclaré une fois, valable pour tous les projets',
  'tab.reparto': 'Répartition',
  'tab.reparto.pista':
    'Quel travail pourrait bouger, vers qui, et ce que cela réglerait. Des propositions, pas des décisions',
  'tab.hallazgos': 'Constats',
  'tab.hallazgos.pista': 'Tout ce que le moteur veut te dire',
  'tab.comparar': 'Comparer',
  'tab.comparar.pista': "En quoi le plan d'aujourd'hui diffère de celui que tu as figé",
  'tab.registro': 'Journal',
  'tab.registro.pista': 'Qui a changé quoi et quand, avec son commentaire',
  'tab.admin': 'Administration',
  'tab.admin.pista': 'Qui entre, quel rôle il a et ce que chaque rôle autorise',

  'nota.admin': "✎ ce que tu coches ici est ce que l'API autorise vraiment",
  'nota.documentos': '✎ la ligne est nécessaire à la colonne',
  'nota.registro': "🔒 lecture seule · le journal est écrit par la base de données, pas par l'application",
  'nota.declarado': '✎ tout est déclaré · chaque changement recalcule le plan',
  'nota.plan': '✎ déclaré · 🔒 dérivé, non modifiable',
  'nota.derivado': '🔒 colonnes dérivées · non modifiables',

  'stat.planificado': 'Travail planifié',
  'stat.planificado.sobre': 'sur %s h de capacité sur ces mois',
  'stat.planificado.recortado': 'sur les projets que tu peux voir',
  'stat.ocupacion': "Occupation de l'équipe",
  'stat.ocupacion.media': 'moyenne des mois avec du travail',
  'stat.ocupacion.sinCapacidad':
    "la capacité est celle de toute l'équipe : il faut voir la charge sur l'ensemble de l'outil",
  'stat.sobrecargadas': 'Personnes surchargées',
  'stat.sobrecargadas.pista': 'sur au moins un mois',
  'stat.sobrecargadas.sinCapacidad': "seulement avec la charge de l'ensemble de l'outil",
  'stat.coste': 'Coût engagé',
  'stat.coste.pista': 'les heures multipliées par le taux en vigueur chaque jour',
  'stat.coste.cero': "tombe à zéro : il manque les taux horaires de l'équipe",
  'stat.criticas': 'Tâches critiques',
  'stat.criticas.pista': 'sans marge : les retarder retarde le plan',

  'vacio.nada.titulo': "Il n'y a encore rien ici",
  'vacio.nada.texto':
    "L'ordre qui marche est celui-ci : d'abord l'Équipe, parce que c'est de là que viennent la capacité et le coût ; ensuite le plan, en important un CSV ou en le créant à la main.",
  'vacio.nada.irEquipo': "Aller à l'équipe",
  'vacio.nada.plantilla': 'Télécharger le modèle CSV',
  'vacio.nada.demo': 'Tu veux juste le voir tourner ? %s charge trois projets qui se chevauchent.',
  'vacio.sinPermisos.titulo': "Ton compte n'a encore aucune permission",
  'vacio.sinPermisos.texto':
    "Tu es bien connecté, mais personne ne t'a encore attribué de rôle. La personne qui administre l'outil peut le faire depuis Administration → Utilisateurs et rôles.",

  'abierta.aviso':
    "Cette installation n'a aucun utilisateur, elle est donc ouverte à quiconque y accède. Crée le premier avec %s.",

  'login.correo': 'Adresse e-mail',
  'login.contrasena': 'Mot de passe',
  'login.entrar': 'Se connecter',
  'login.entrando': 'Connexion…',
  'login.error': 'Connexion impossible',
  'login.pie':
    "Pas de compte ? C'est la personne qui administre l'outil qui te le donne. Si tu viens de l'installer et qu'il n'y en a aucun, crée le premier avec %s.",

  'clave.titulo': 'Changer mon mot de passe',
  'clave.cerrar': 'Fermer',
  'clave.actual': 'Mot de passe actuel',
  'clave.nueva': 'Nouveau mot de passe (%s caractères ou plus)',
  'clave.repite': 'Répète le nouveau',
  'clave.corta': 'Le nouveau doit faire %s caractères ou plus.',
  'clave.distintas': 'Les deux saisies du nouveau mot de passe ne correspondent pas.',
  'clave.igual': "Le nouveau doit être différent de l'actuel.",
  'clave.aviso':
    "Le changer ferme toutes tes sessions, celle-ci comprise : tu devras te reconnecter avec le nouveau. C'est volontaire — si tu le changes parce que quelqu'un d'autre le connaissait, laisser des sessions ouvertes ne règle rien.",
  'clave.enviar': 'Changer et se reconnecter',
  'clave.enviando': 'Changement…',
  'clave.error': 'Impossible de changer le mot de passe',
}
