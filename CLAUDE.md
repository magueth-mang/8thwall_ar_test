# CLAUDE.md — WebAR Pop-up Store Cosmétique (version 8th Wall)

> Ce fichier est le **brief de projet** pour un **nouveau repo** où l'on construit
> l'expérience WebAR avec **8th Wall**. Il condense tout le contexte, les décisions
> et les pièges déjà identifiés dans un prototype précédent. **Lis-le en entier
> avant de coder.**

---

## 1. Objectif du projet

Créer une **expérience WebAR pour un pop-up store d'une marque de cosmétique de
luxe** (direction artistique type **Yves Saint Laurent Beauty**).

**Concept : une chasse au trésor.** Des **marqueurs** (QR codes / visuels imprimés)
sont disséminés dans le magasin (sur des tables, des cadres, des cartes…). Le
visiteur les scanne avec son téléphone → **une scène 3D animée apparaît, ancrée sur
le marqueur**. Quand il a **trouvé tous les produits**, il **gagne une récompense**
(code promo).

Contraintes : **web** (pas d'app à installer), **déployable sur Vercel**, doit
marcher sur **iPhone (Safari) ET Android (Chrome)**.

---

## 2. Décision technique CENTRALE : 8th Wall (image tracking)

### Ce que veut le client (exemples concrets qu'il a donnés)
1. Une **carte de visite** avec un QR : on la scanne, du contenu 3D apparaît **collé
   dessus**, et **on peut la prendre en main, l'incliner** → l'animation **reste
   collée à la carte qui bouge**.
2. Un **cadre** avec un QR : on le scanne, ça « casse » le QR comme un mur et
   **ouvre un portail** (espace, vaisseaux…) ; quand on se déplace, **ça reste
   parfaitement en place**.

👉 Ces deux exemples = **IMAGE TRACKING** (contenu ancré à un marqueur physique, qui
**suit** le marqueur en temps réel). C'est **la** techno à utiliser.

### Pourquoi 8th Wall
- **8th Wall** (Niantic) fait du tracking image + monde par caméra, **dans le
  navigateur**, sur **iOS Safari ET Android** — c'est l'outil derrière les démos
  « waouh » que le client admire (le portail-vers-l'espace est une démo culte 8th Wall).
- **Devenu gratuit + open-source début 2026** (moteur/SLAM en binaire libre, usage
  commercial OK, **auto-hébergé**). Vérifier l'état actuel du licensing/hébergement.
- Qualité **très supérieure à Zappar** (voir §3).

### Intégration
- Utiliser **8th Wall + Three.js** (le client veut des scènes Three.js animées avec
  effets). 8th Wall expose une scène/caméra Three.js ; on garde la main sur tout.
- Vérifier la doc 8th Wall à jour pour : setup projet, image targets, hébergement
  du binaire moteur, et le combo Next.js (bundling du moteur + WASM).

---

## 3. Ce qu'on a appris — NE PAS relitiger

Un long prototype a exploré toutes les pistes. Conclusions fermes :

- **Quick Look (iOS) / Scene Viewer (Android) = ÉCARTÉ pour ce projet.**
  Rendu natif superbe et fluide, MAIS : ancrage **au monde/au sol uniquement**
  (l'objet reste fixe dans la pièce), **PAS** collé à un marqueur qu'on tient/bouge.
  L'« image anchoring » natif de Quick Look existe mais est **peu fiable / dépendant
  de la version iOS**. → **Incapable de faire les 2 exemples du client.**
  *(Une version Quick Look fonctionnelle est gardée de côté comme repli, voir §8.)*

- **Zappar = ÉCARTÉ.** Fonctionne mais rendu **« moche et pas fluide »** dans nos
  tests (world tracking JS lourd en CPU : vidéo qui rame, tracking approximatif).

- **Pseudo-AR maison** (caméra + `deviceorientation` + Three.js) = ÉCARTÉ.
  Pas de vrai tracking spatial → **l'objet suit la caméra / dérive** quand on marche.

- **WebXR** = ÉCARTÉ pour iOS. Parfait sur **Android** (ARCore, gratuit) mais
  **non supporté par Safari iOS**. Pas cross-platform.

- **MindAR** (open source, gratuit) : fait de l'image tracking, gratuit, marche sur
  iOS Safari. **Moins robuste/beau que 8th Wall.** Utile pour un **prototype gratuit
  rapide** de l'effet « contenu collé au marqueur », mais pas pour la qualité finale.

**Concepts à garder clairs :**
- **Image tracking** : contenu **collé au marqueur**, le suit quand il bouge → CE QU'ON VEUT.
- **Plane anchoring** (Quick Look) : contenu **verrouillé au monde** (posé une fois,
  reste fixe même si on bouge la caméra) → pas ce qu'on veut ici.
- **QR = déclencheur** (ouvre une URL/identifie un produit) ≠ **QR = ancre**
  (le contenu se pose dessus). Le client veut le **2ᵉ** (ancre) → image tracking.

---

## 4. Le DESIGN de l'app (à conserver tel quel)

Direction artistique **haute couture, noir & or**, très épurée.

### Palette
```
GOLD       = #C9A45C   (or principal)
GOLD_SOFT  = #D8BE86   (or clair / dégradés)
CREAM      = #EFE9DC   (texte principal, blanc chaud)
Fond       = radial-gradient(120% 80% at 50% -10%, #1a1710 0%, #0a0a0a 45%, #000 100%)
```

### Typographie
- **Titres** : serif haute couture → `'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif`
  (Didot est natif sur iOS → rendu YSL parfait sur iPhone).
- **Corps / labels** : `'Helvetica Neue', Arial, sans-serif`.
- **Labels** : UPPERCASE + `letter-spacing` large (0.2em à 0.55em). Penser à ajouter
  un `padding-left` égal au letter-spacing pour recentrer optiquement.

### Écrans
1. **Accueil / hub** :
   - Wordmark `YVES SAINT LAURENT` (letter-spacing ~0.42em) + filet or + `B E A U T Y`.
   - Titre hero : « La Chasse » / « *aux Trésors* » (2ᵉ ligne en **italique or**), Didot ~46px.
   - Sous-titre uppercase discret : « Découvrez la collection en réalité augmentée ».
   - **Compteur** `00 / 07` (Didot, grand chiffre or) + label « PRODUITS DÉCOUVERTS »
     + **barre de progression** fine (piste or 22% opacité, remplissage dégradé or).
   - **Grille de 7 collectibles** (3 colonnes) : cases verrouillées (bordure or 22%,
     `N°1…N°7` en or) qui **s'illuminent** une fois trouvées (bordure or pleine,
     léger fond dégradé or, ombre douce, emoji/visuel du produit).
   - **Bouton CTA** pleine largeur, **fond or dégradé, texte noir**, uppercase
     letter-spacing 0.22em : « SCANNER UN PRODUIT » (+ petite icône scan SVG).
   - Footer discret : « Édition limitée · En boutique uniquement ».
2. **Vue scan** (à construire avec 8th Wall) : caméra plein écran, détection du
   marqueur, révélation de la scène 3D ancrée.
3. **Récompense** (overlay, quand 7/7) : fond noir + carte à **bordure or**,
   wordmark, « **Félicitations** » (Didot ~34px), texte, **code promo** dans un
   **cadre pointillé or** (ex. `YSL-BEAUTY-2026`), « Présentez ce code en boutique »,
   bouton « FERMER » (outline or).

> Le composant React exact existe dans le repo de sauvegarde Quick Look :
> **`components/Hunt.js`** (styles inline, objet `s`). **Le copier** pour repartir du
> même design (juste rebrancher le bouton scan sur la caméra 8th Wall).

### Produits de démo (7)
Mascara Lash Clash · Rouge Pur Couture · Libre Eau de Parfum · Touche Éclat ·
Couture Mini Clutch · Vernis à Lèvres · Crayon Yeux Waterproof.

---

## 5. Logique « chasse au trésor »

- État : `found` (nb trouvés), liste des produits trouvés → **persister en
  `localStorage`** (le score survit si on ferme/rouvre).
- Flux : bouton « Scanner » → caméra 8th Wall → **détection du marqueur** →
  identifier le produit → marquer trouvé (compteur +1, case illuminée) → afficher la
  **scène 3D ancrée** → retour au hub.
- **Un produit à la fois** (chaque marqueur révèle SON produit). Pas d'accumulation
  de plusieurs objets dans une même vue.
- Quand `found === total` → **écran récompense**.
- Toute la logique (progression, récompense, événements) vit dans **notre app** =
  liberté totale.

---

## 6. Pipeline des assets 3D

- Source fournie par le modélisateur : **`.glb`** (avec animations bakées).
  Pour 8th Wall/Three.js on utilise **le `.glb` directement** (plus besoin d'`.usdz`,
  qui était spécifique à Quick Look).
- **Budgets AR mobile (impératif)** : ≤ **150k triangles**, textures **1K–2K
  compressées**, fichier final **< 5–10 Mo** par scène. Demander au modélisateur des
  assets **« AR-ready / game-ready »**.
- ⚠️ Retour d'expérience : un modèle Lancôme fourni faisait **86 Mo / 390k triangles
  / textures 4K** → **inutilisable** tel quel. Il a fallu l'optimiser dans Blender
  (décimation ~35%, textures réduites en 1024, conversion WebP→PNG) pour tomber à ~14 Mo.
- **Blender 4.4** est dispo sur la machine de dev et scriptable en headless
  (`blender --background --python script.py`) : import glb, animation, décimation,
  réduction textures, export. (Des scripts existent dans le repo de sauvegarde :
  `scripts/animate_mascara.py`, `scripts/animate_lancome.py`.)
- Animations d'ouverture (ex. mascara : le sous-ensemble « HC HAUT » = capuchon +
  brosse se soulève hors du tube « HC BAS ») : à faire dans Blender, export glb animé.

---

## 7. Stack & setup dev

- **Next.js 14** (App Router), composants AR en **`dynamic(..., { ssr: false })`**
  (les libs caméra/AR sont client-only).
- **8th Wall + Three.js**.
- **HTTPS obligatoire** pour la caméra :
  - Local : `next dev -H 0.0.0.0 --experimental-https` (certificat auto-signé).
  - Test téléphone sans déployer : tunnel **cloudflared**
    (`cloudflared tunnel --url http://localhost:3000`) → URL `https://…trycloudflare.com`.
    ⚠️ L'URL du tunnel **change** à chaque lancement.
- **Windows / dev** : `npm install --ignore-scripts` si une dépendance a un module
  natif qui casse (ex. `canvas`). Prévoir l'équivalent côté Vercel.
- ⚠️ Ne **jamais** lancer `next build` pendant que `next dev` tourne (ça corrompt
  le dossier `.next` → page blanche / chunks 404). Couper le dev d'abord.
- Pour vérifier un rendu sans téléphone : screenshots via **puppeteer-core** +
  Chrome système (headless). Pour valider une caméra/AR headless :
  `--use-fake-device-for-media-stream` + WebGL logiciel
  (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`).

---

## 8. La version Quick Look (gardée de côté — repli)

Un repo/branche **Quick Look** fonctionnel est conservé **au cas où** (expérience
simple « voir le produit en AR » sans marqueur, rendu natif superbe) :
- `components/QuickLookAR.js` : bouton « Voir en AR » via `<a rel="ar">` (Safari) /
  lien direct `.usdz` (Chrome iOS).
- `.usdz` animés générés via Blender (mascara qui s'ouvre, rouge à lèvres qui tourne).
- MIME `model/vnd.usdz+zip` servi via `next.config.js` headers.
- **Limites** : iOS only (Android = Scene Viewer/`.glb`), UI d'Apple fermée,
  ancrage au monde (pas au marqueur), pas d'effets temps réel.

Ne pas repartir dessus pour la vision « image tracking » — c'est juste un repli.

---

## 9. Prochaines étapes (nouveau repo 8th Wall)

1. Setup Next.js + 8th Wall + Three.js, HTTPS, tunnel.
2. Copier le design (`components/Hunt.js`) → hub luxe YSL (compteur, grille, récompense).
3. Intégrer la **caméra 8th Wall + image target** (marqueur de test d'abord).
4. Brancher le flux : scan marqueur → produit identifié → scène 3D animée **ancrée
   sur le marqueur** → compteur/récompense (localStorage).
5. Optimiser les assets (§6) et tester sur iPhone **et** Android.
6. À la fin seulement : générer les **QR/marqueurs définitifs** (pointant vers le
   domaine Vercel) et déployer.

---

*Rappel de ton : le client parle français, veut du concret et déteste tourner en
rond. Être direct et honnête sur ce qui est faisable ou non.*
