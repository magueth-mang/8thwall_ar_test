// Fiches du véhicule présentées en AR (points d'intérêt posés sur la voiture).
// Un concessionnaire n'a qu'à modifier ce fichier : titres, chiffres, lignes. Données indicatives (démonstration).
//   id      : identifiant du point (relié à une zone du modèle dans carShowcase.js)
//   label   : petit nom affiché sous la pastille, en AR
//   kicker  : surtitre en capitales de la fiche
//   title   : titre de la fiche
//   stats   : jusqu'à 4 chiffres clés { value, unit, label }
//   lines   : lignes de texte (si pas de stats, ou en complément)
//   action  : effet joué sur la voiture à l'ouverture (phares, portières, cotes…)

export const CAR_INFO = {
  model: 'X7 M60i xDrive',
  maker: 'BMW',
  footer: 'Données indicatives · démonstration',
}

export const CAR_SPECS = [
  {
    id: 'moteur', label: 'Moteur', kicker: 'Motorisation', title: 'V8 4,4 L biturbo',
    stats: [
      { value: '530', unit: 'ch', label: 'Puissance' },
      { value: '750', unit: 'Nm', label: 'Couple' },
      { value: '4,7', unit: 's', label: '0 à 100 km/h' },
      { value: '250', unit: 'km/h', label: 'Vitesse max.' },
    ],
    lines: ['Hybridation légère 48 V'],
  },
  {
    id: 'phares', label: 'Éclairage', kicker: 'Signature lumineuse', title: 'Feux LED adaptatifs',
    lines: ['Projecteurs à matrice LED', 'Calandre rétroéclairée Iconic Glow', 'Feux de jour en deux étages'],
    action: 'lights',
  },
  {
    id: 'chassis', label: 'Châssis', kicker: 'Transmission & liaison au sol', title: 'xDrive · suspension pneumatique',
    stats: [
      { value: '22', unit: '"', label: 'Jantes M' },
      { value: '8', unit: 'rapports', label: 'Steptronic' },
      { value: '4', unit: 'roues', label: 'Motrices xDrive' },
      { value: '2', unit: 'essieux', label: 'Pneumatiques' },
    ],
  },
  {
    id: 'interieur', label: 'Intérieur', kicker: 'Habitacle', title: 'Sept places, cuir Merino',
    stats: [
      { value: '7', unit: 'places', label: 'Trois rangées' },
      { value: '14,9', unit: '"', label: 'Écran central' },
      { value: '12,3', unit: '"', label: 'Combiné' },
      { value: '4', unit: 'zones', label: 'Climatisation' },
    ],
    action: 'doors',
  },
  {
    id: 'coffre', label: 'Coffre', kicker: 'Volume de chargement', title: 'Jusqu’à 2 120 litres',
    stats: [
      { value: '326', unit: 'L', label: '7 places' },
      { value: '750', unit: 'L', label: '5 places' },
      { value: '2 120', unit: 'L', label: '2 places' },
    ],
    lines: ['Hayon électrique en deux parties'],
  },
  {
    id: 'dimensions', label: 'Dimensions', kicker: 'Gabarit', title: 'Grand SUV de luxe',
    stats: [
      { value: '5,18', unit: 'm', label: 'Longueur' },
      { value: '2,00', unit: 'm', label: 'Largeur' },
      { value: '1,83', unit: 'm', label: 'Hauteur' },
      { value: '3,10', unit: 'm', label: 'Empattement' },
    ],
    action: 'dims',
  },
]
