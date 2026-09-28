# Image Targets (marqueurs)

Ce dossier contient les **données de cible compilées** (JSON) que 8th Wall utilise
pour reconnaître un marqueur imprimé et y ancrer la scène 3D.

En mode **auto-hébergé** (8th Wall open-source), la cible n'est plus hébergée dans
le cloud : on fournit un **fichier JSON compilé** que le code charge via
`XR8.XrController.configure({ imageTargetData })` (voir `components/ARScan.js`).

## Générer une cible (`mascara.json`)

1. Installer **8th Wall Studio** (app desktop) : https://8thwall.org/docs/getting-started/installation
2. Créer/ouvrir un projet, ajouter une **Image Target** et **uploader l'image du
   marqueur** (le visuel qui sera imprimé : carte de visite, carte produit…).
   - Image nette, contrastée, riche en détails **non répétitifs** (mauvais : logo
     centré sur fond uni ; bon : motif texturé/asymétrique).
   - Ratio conservé, ~1024 px sur le grand côté.
3. Nommer la cible **exactement** `mascara-marker` (doit correspondre à `TARGET.name`
   dans `components/ARScan.js`).
4. **Exporter les données de cible** (target data) au format JSON et déposer le
   fichier ici sous le nom **`mascara.json`**.

> Tant que `mascara.json` est absent, l'app démarre quand même la caméra mais
> affiche un avertissement : aucune détection ne se produira.

## Marqueur de test rapide

Pour tester sans attendre les visuels définitifs du client : n'importe quelle image
riche en détails fait l'affiche (photo, illustration). Imprime-la ou affiche-la sur
un 2ᵉ écran, compile-la dans Studio, exporte le JSON ici.

## Convention multi-produits (plus tard)

Un JSON par produit (`mascara.json`, `rouge.json`, …) ou un JSON multi-cibles.
Chaque `name` de cible identifie le produit trouvé → alimente la logique de chasse
au trésor (compteur, localStorage) dans le hub.
