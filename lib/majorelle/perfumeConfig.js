// « BLEU INTERDIT » — configuration partagée du scénario parfum du Jardin Majorelle.
// Gelée au démarrage (SPEC_PERFUME.md, annexe B) : noms, ordres de rendu, coordonnées et textes.
// Tous les modules la lisent ; seul le directeur (lib/majorellePerfumeScene.js) l'interprète.
// Coordonnées « jardin » en mètres (three.js : x droite, y haut, la cour vers −z).

export const PB_CFG = {
  bottleUrl: '/majorelle/perfume.glb', metaUrl: '/majorelle/perfume_meta.json', texBase: '/majorelle/perfume/',
  productName: 'BLEU INTERDIT',
  heroInGarden: 0.21, heroOut: 0.40,
  // aucune rotation automatique du flacon (demande client) : il reste de face, seul le geste du visiteur le tourne
  // auto[i] : la réponse de la note i (0 ORANGER, 1 LOTUS, 2 CÈDRE) écarte-t-elle d'elle-même le flacon ? Mesuré dans la
  // vue visiteur (GARDEN XL, intégration ; fleurs / lotus dégagés, flacon centré → en aparté) :
  //   ORANGER : de loin 41 → 56 fleurs dégagées au pic (posées 31 → 43), de près 28 → 64 (posées 5 → 42) : toujours ;
  //   LOTUS   : de loin 4 → 4 lotus dégagés (seuls les lotus changent), de près 0 → 4 : 'view' = seulement si le flacon
  //             centré en cacherait (moins de viewMinClear dégagés, estimé à l'ouverture de la réponse) ;
  //   CÈDRE   : la lumière se lit sur toute la cour, à travers le verre aussi : jamais.
  // Un toucher bref du flacon le fait aussi glisser (centre ↔ aparté) et ce choix du visiteur l'emporte.
  aside: { dx: 0.09, dy: -0.015, scale: 0.36, yawDeg: 0, auto: [true, 'view', false], viewMinClear: 3 },
  signatureYawDeg: 0, sprayYawDeg: 0,
  E: [0, 0, -2.80], hoverBaseY: 0.14,
  lying: { base: [-0.33, -0.2557, -2.80], phiDeg: -90 },
  preLift: { base: [-0.04, -0.02, -2.80] },
  swingDur: 1.8, liftDur: 0.9, swingStart: 3.4,
  koiGuard: [0, 0, -3.55], koiPart: [0, 0, -4.0],
  glide: { y: 0.06, zEnd: -1.90, leanDeg: 8, dur: 1.05 },
  bringOutDur: 2.6, returnFlightDur: 2.3,
  notes: {
    // ORANGER (GARDEN XL §2) : une pluie de fleurs d'oranger sur tout le bassin et sur ses bords. Mètres jardin ;
    // rectangles [x0, x1, z0, z1] ; comptes par palier (uniquement des comptes : jamais de recompilation).
    neroli: {
      tiers: {
        high: { flowers: 78, petals: 14, reprise: 20, reprisePetals: 3, survivors: 12, inView: 10 },
        medium: { flowers: 54, petals: 10, reprise: 14, reprisePetals: 2, survivors: 9, inView: 7 },
        low: { flowers: 34, petals: 6, reprise: 9, reprisePetals: 2, survivors: 6, inView: 5 },
      },
      split: { water: 0.77, floor: 0.06 },                       // margelle = le reste
      // flowerClear / budClear : distance minimale à une fleur / un bouton statique ; padEdge : bande évitée au bord d'une feuille
      water: { rect: [-0.73, 0.73, -6.23, -2.05], near: [-0.73, 0.73, -2.05, -1.82], nearShare: 0.08, leftX: -0.10, leftShare: 0.55, spacing: 0.16, petalSpacing: 0.10, flowerClear: 0.13, budClear: 0.09, padEdge: 0.045 },
      coping: { y: 0.083, width: 0.22, spacing: 0.18, strips: [ // [x0, x1, z0, z1, part]
        [-0.62, 0.55, -1.66, -1.52, 0.38], [-0.99, -0.83, -6.20, -3.30, 0.30], [-0.70, 0.70, -6.48, -6.34, 0.17], [0.83, 0.99, -6.20, -2.00, 0.15]] },
      floor: { y: 0.003, rect: [-0.55, 0.50, -1.42, -1.12], spacing: 0.20, zMax: -1.40, zMin: -0.50 },
      // départs t_k = dur · (1 − (1 − k/(N−1))^(1/power)) ± jitter/2 : power 2,4 (et non 2,2) → la moitié est partie à
      // 0,9 s (≥ 50 % à 1 s malgré le jitter) et la dernière part à 3,6 s pile (dernière arrivée ≈ 6,9 s à tous les paliers)
      launch: { dur: 3.6, power: 2.4, jitter: 0.12, inViewY: [2.1, 2.7], inViewDelay: 0.35, inViewFall: [1.6, 2.1], inViewX: 0.5, inViewZ: [-5.5, -2.3], spawnY: [2.9, 3.5], appear: 0.30 },
      fall: [2.5, 3.3], petalFall: [2.8, 3.5], scale: [1.25, 1.75], farBoost: 0.15, petalScale: [0.95, 1.25],
      reprise: { water: [-0.73, 0.60, -4.80, -2.20], copingShare: 0.15, spawnY: [2.3, 2.9], dur: 1.4, fall: [2.0, 2.6], petalFall: [2.3, 3.0], survivors: 2 },
      stone: { hop: 0.006, hopT: 0.20, hop2: 0.0015, hop2T: 0.10, slideK: 0.3, slideMax: 0.18, friction: 0.9, edge: 0.03, flash: 0.6 },
      sepLanded: 0.13, wallMargin: 0.09, fadeAfter: 9, extraSurvivors: 2, stoneSurvivors: 2,
      // anciennes clés (lecteurs externes ; fire() ne lit plus area / spawnY, count plafonne le nombre de fleurs)
      area: [-0.73, 0.73, -6.23, -1.82], spawnY: [2.9, 3.5], count: 78, survivors: 12,
    },
    // LOTUS (GARDEN XL §3) : un champ de 6 nymphéas sur tout le bassin, éclos en vague depuis le héros.
    // `at` / `radius` : le héros (z −2,15 et non −2,00 : sa feuille ne passe plus sous le bord proche du bassin).
    // field : [x, z] mètres jardin, sc = échelle (rayon 0,21·sc), delay = départ (s) ; l'ordre du tableau EST l'ordre
    // d'éclosion (près → loin, gauche / droite en alternance). Disposition validée contre les bords du bassin, les 27
    // feuilles et les 7 fleurs statiques : quel que soit le flacon (aparté ou centré), 3 à 4 lotus restent dégagés.
    // pulseWave : décalage (s) du rappel d'un rang au suivant. count : nombre de lotus par palier (repli : 5 au palier bas).
    lily: {
      at: [-0.45, 0, -2.15], radius: 0.21, pulseWave: 0.12, count: { high: 6, medium: 6, low: 6 },
      field: [
        { at: [-0.45, -2.15], sc: 1.00, delay: 0.00 }, { at: [-0.27, -3.22], sc: 0.70, delay: 0.45 },
        { at: [0.30, -2.95], sc: 0.78, delay: 0.70 }, { at: [-0.15, -4.60], sc: 0.72, delay: 1.10 },
        { at: [0.55, -4.70], sc: 0.60, delay: 1.35 }, { at: [-0.58, -5.45], sc: 0.55, delay: 1.60 },
      ],
    },
  },
  rain: [[-0.10, 0, -2.00], [0.15, 0, -3.20], [-0.05, 0, -4.40]], rainSpacing: 0.8,
  splash: { window: 2.5, maxInWindow: 3, bigK: 0.7, bigGap: 1.2, smallGap: 0.6, queueMax: 0.4, tapGap: 0.7 },
  idle: { ghostAfter: 6, autoKnockAfter: 10, autoSprayAfter: 12, faceOnAfter: 3 },
  // strikeAt : la frappe du heurtoir (perfume.js KNOCK : levée 0,38 + suspension 0,12 + chute 0,11 s)
  knock: { strikeAt: 0.61, answerDelay: 0.35, debounce: 0.6 },
  // start 0.96 (et non 0.88) : WP1 a relevé le remplissage pour que le ménisque passe au-dessus de l'œil du heurtoir
  // (perfume_meta.json cavity.fillFraction = 0.96, ménisque y 7.711 cm) ; WP3 a réglé le look-dev à cette valeur.
  // 0.93 (au lieu de 0.96) : le ménisque passe sous le médaillon, visible dans la fenêtre quand le flacon est agité (ORANGER)
  fill: { start: 0.93, perSpray: 0.02, min: 0.70 },
  emergeMode: 'leaf',          // 'leaf' | 'shallow' (repli du risque 1)
  doorBreath: false, closeDoor: true,
  quality: 'auto',
}

export const PB_NAMES = {
  glass: 'PB_Glass', juice: 'PB_Juice', gold: 'PB_Gold', cap: 'PB_Cap', proxy: 'PB_ReflProxy',
  capPivot: 'PB_CapPivot', ringPivot: 'PB_RingPivot', nozzle: 'PB_Nozzle', strike: 'PB_Strike', meniscus: 'PB_Meniscus',
}

export const PB_RENDER_ORDER = {
  juice: 0.5, glow: 3.2, refl: 3.5, rings: 5.5, dome: 5.6, collar: 5.7, carpet: 6.8, neroli: 7.5, lily: 7.6, cedarMotes: 7.9,
  crown: 10.5, neck: 10.5, glass: 11.5, drops: 12, studGlints: 13, sillage: 15, motes: 15, ribbon: 16, shock: 18, ui: 19, veil: 30,
}

// Textes (SPEC_PERFUME §5.6). Ne jamais écrire « disponible », un prix, ni d'appel à l'achat de BLEU INTERDIT.
export const PB_COPY = {
  hint: {
    introGlow: 'Touchez la lumière',
    enthroned: "Touchez le flacon · effleurez l'eau",
    knock0: 'Éveillez les trois notes · Oranger, Lotus ou Cèdre',
    knock1: 'Encore deux notes',
    knock2: 'Une dernière note',
    unlocked: 'Touchez Vaporiser · maintenez pour un nuage',
    signed: 'Glissez pour tourner · Rangez le flacon dans le jardin',
    closed: 'Touchez la porte pour rejouer',
  },
  cartel: { brand: 'YVES SAINT LAURENT', name: 'BLEU INTERDIT', type: 'Eau de Parfum' },
  // noms parlants (demande client) : ce qui apparaît dans le jardin à chaque coup, sans le jargon « tête / cœur / fond »
  notes: [
    { num: 'I', name: "Fleur d'oranger", tag: 'FLACON AGITÉ · LA LUMIÈRE', bezel: 'ORANGER' },
    { num: 'II', name: 'Lotus bleu', tag: "LE HEURTOIR · L'EAU", bezel: 'LOTUS' },
    { num: 'III', name: "Cèdre de l'Atlas & ambre", tag: 'LE COL OUVERT · LA PORTE', bezel: 'CÈDRE' },
  ],
  final: { line: 'Le secret est à vous', notes: "FLEUR D'ORANGER · LOTUS BLEU · CÈDRE", disclaimer: "Création imaginée pour l'expérience" },
  medallions: { spray: 'VAPORISER', ret: 'RANGER' },
  endCard: {
    brand: 'YVES SAINT LAURENT',
    name: 'Bleu Interdit',
    quote: '« Derrière chaque porte de Marrakech, un jardin. »',
    disclaimer: "Parfum imaginé pour l'expérience, non commercialisé",
    cta: 'Découvrez les parfums Yves Saint Laurent en boutique',
  },
  startGate: 'Visez la porte bleue · un flacon dort au fond du bassin · éveillez ses trois notes, le jardin vous répond',
  tagline: "Derrière chaque porte de Marrakech, un jardin. On ne l'ouvre pas : on frappe.",
}
