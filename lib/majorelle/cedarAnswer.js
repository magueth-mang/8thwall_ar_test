// « BLEU INTERDIT » — réponse du jardin à la note CÈDRE & AMBRE (GARDEN XL, SPEC §4).
//
// Une vague de lumière d'heure dorée entre par la porte et traverse toute la cour jusqu'au mur du fond
// (sol → margelle et bassin → fontaine → mur du fond, qu'elle gravit en diagonale), le bassin devient de l'or liquide,
// une rémanence dorée tient la cour quelques secondes puis tout revient exactement à la normale.
// Accent : un pollen d'or (poussière dans le rayon) s'allume au passage du front et monte doucement.
//
//   lumière  : uniforms partagés CEDAR_GOLD, lus par la cour (crochet opt-in de lib/majorelle/interior.js),
//              par l'eau (lib/majorelle/gardenFx.js, option `gold`) et par le ciel (P2). Neutres à z = w = 0 :
//              sortie identique bit à bit, et les deux crochets sautent leur calcul (branche sur uniform).
//   pollen   : THREE.Points, 1 draw call (caché hors réponse), 1 programme (à compiler dans le prewarm du directeur),
//              entièrement animé dans le vertex shader ; deux générations (la précédente s'éteint sans saut
//              quand on rejoue la note pendant la rémanence).
//
// Repère : `gardenRoot` (mètres jardin, +Z vers le visiteur). Front de la vague : s = −z + 0,55·y.
// Qualité : nombre de points par drawRange (120 / 80 / 48), aucun define. Zéro allocation par image
// (état dans un Float64Array, uniforms préalloués) ; `_debug().sample` (relecture) peut allouer, il n'est pas appelé en jeu.
//
// API : createCedarAnswer({ gardenRoot, quality, reduced, seed, renderOrder }) →
//   { objects, fire(), reprise(), release(dur), clear(), update(dt, camera), setQuality(q), setPrewarm(on),
//     active, stats(), _debug(), dispose() }

import * as THREE from 'three'

const TAU = Math.PI * 2
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }

// ---- réglages (gardés dans le module : perfumeConfig appartient à l'intégrateur) ------------------------------
export const CEDAR_CFG = {
  renderOrder: 7.9,                        // < 11.4 : vu à travers le flacon (copie d'écran avant le jus)
  width: 1.1,                              // largeur gaussienne de la bande (m, en s)
  s0: -1, s1: 13,                          // le front part du seuil et sort par le haut du mur du fond
  tint: [1.18, 0.97, 0.64],                // cour : teinte d'heure dorée (après AgX, la teinte est gardée sous le plafond)
  gain: 1.9,                               // cour : exposition à pleine rémanence (linéaire d'affichage)
  look: [1.1, 0.5, 0.12, 0.55],            // cour : exposition de bande (en plus), plafond du canal fort, dépassement dans la bande, feuille d'or
  // première réponse (SPEC §4.2) : front 0,3 → 2,3 s, rémanence 0,15 + 0,45, extinction 3,2 → 4,6 s, fin 4,8 s
  fire: { start: 0.3, frontDur: 2.0, amp: 1.0, ampOut: 0.6, after0: 0.15, after0Dur: 0.5, after: 0.45, afterAt: 0.5, afterDur: 0.8, fadeAt: 3.2, fadeDur: 1.4, end: 4.8, sky: 0.5, skyAt: 1.6, skyDur: 1.0, motes: 1.0 },
  // rappel (CÈDRE rejoué) : plus court et plus doux, 40 % du pollen, fin 3,2 s
  reprise: { start: 0.2, frontDur: 1.4, amp: 0.55, ampOut: 0.5, after0: 0.08, after0Dur: 0.4, after: 0.17, afterAt: 0.35, afterDur: 0.6, fadeAt: 1.9, fadeDur: 1.1, end: 3.2, sky: 0.25, skyAt: 1.0, skyDur: 0.8, motes: 0.4 },
  // prefers-reduced-motion : ni front ni pollen, une rémanence douce
  reduced: { after: 0.4, rise: 0.8, hold: 1.5, out: 1.2 },
  carry: 0.5,                              // rejouée pendant la rémanence : l'ancienne s'éteint sur 0,5 s (pas de saut)
  motes: {
    count: { high: 120, medium: 80, low: 48 },
    size: 0.024,                           // diamètre du cœur (m), × (0,7 + 0,6·graine)
    minPx: 3.0 / 844, maxPx: 6.0 / 844,    // cœur borné en fraction de la hauteur d'écran (3–6 pt sur 844 pt)
    halo: 2.2,                             // gl_PointSize = cœur × 2,2
    rise: [0.32, 0.30], life: [2.6, 1.2],  // vitesse 0,32 + 0,30·g (m/s), vie 2,6 + 1,2·g (s)
    col: [1.0, 0.62, 0.22], gainCol: 1.2, hot: [1.0, 0.9, 0.7], gainHot: 0.35,
  },
}

/** Uniforms partagés de la lumière dorée (singleton du module, pilotés UNIQUEMENT par createCedarAnswer).
 *  uMjGold : x front s (m), y largeur de bande (m), z amplitude de bande, w rémanence. */
export const CEDAR_GOLD = {
  uMjGold: { value: new THREE.Vector4(-99, CEDAR_CFG.width, 0, 0) },
  uMjGoldTint: { value: new THREE.Color(...CEDAR_CFG.tint) },
  uMjGoldGain: { value: CEDAR_CFG.gain },
  uMjGoldK: { value: new THREE.Vector4(...CEDAR_CFG.look) },
  uMjGoldSky: { value: new THREE.Vector2(0, 0) },          // x : réchauffement du ciel (P2) — vec2 : écrire un float
                                                            // dans un uniform scalaire alloue une boîte par image (V8)
  uMjFrame: { value: new THREE.Vector4(0, 0, 1, 0) },        // X_OFF, Z_OFF, 1/K — rempli par applyMajorelleMaterials
}

// ---- pollen : zones de naissance (m jardin, comptes du palier haut) -------------------------------------------
// Mesuré dans la vue visiteur (SPEC §1.3) : flacon centré, la cour se lit au-dessus du capuchon (air 2–2,6 m clair à
// 60–93 %), sur les deux bandes latérales et dans la bande du bassin. Les plates-bandes latérales du SPEC (|x| > 1,4,
// z > −8) sont hors du cône de la porte depuis le téléphone : leurs points vont à la poussière en suspension qui
// s'allume au passage du rayon (y 1,2–2,9 m), au fond et aux bords visibles.
// [type, nombre, ...] : 'rect' x0 x1 y0 y1 z0 z1 | 'ring' cx cz r0 r1 y0 y1 ; mul = vitesse de montée relative
const SPAWN = [
  { n: 30, kind: 'rect', a: [-0.75, 0.75, 0.01, 0.01, -6.2, -2.1], mul: 1.0 },          // eau du bassin long
  { n: 5, kind: 'rect', a: [-0.62, 0.55, 0.09, 0.09, -1.66, -1.52], mul: 1.0 },         // margelle, côté porte
  { n: 5, kind: 'rect', a: [-0.99, -0.83, 0.09, 0.09, -6.2, -3.3], mul: 1.0 },          // margelle gauche
  { n: 4, kind: 'rect', a: [-0.7, 0.7, 0.09, 0.09, -6.48, -6.34], mul: 1.0 },           // margelle du fond
  { n: 8, kind: 'rect', a: [-0.6, 0.55, 0.005, 0.005, -1.45, -0.9], mul: 1.0 },         // sol devant le bassin
  { n: 8, kind: 'ring', a: [0, -7.55, 0.95, 1.03, 0.5, 0.5], mul: 1.0 },                // rebord de la fontaine
  { n: 6, kind: 'ring', a: [0, -7.55, 0.43, 0.47, 1.14, 1.14], mul: 0.8 },              // lèvre de la vasque
  { n: 12, kind: 'rect', a: [-1.5, 1.15, 0.3, 1.0, -9.35, -8.6], mul: 1.0 },            // plates-bandes du mur du fond
  { n: 42, kind: 'air', a: [1.2, 2.9, -8.8, -0.9], mul: 0.35 },                         // poussière dans le rayon
]

const VS = /* glsl */ `
attribute vec4 aSeed;   // x naissance, y vie, z vitesse / taille, w coupe du rappel + scintillement
attribute float aRise;  // vitesse de montée relative (poussière en suspension : lente)
uniform vec4 uGA;       // génération courante : t (s), intensité, fraction gardée, vitesse du front (m/s)
uniform vec4 uGA2;      //   fin (s), départ du front (s), s0 (m), s1 − s0 (m)
uniform vec4 uGB;       // génération précédente (s'éteint)
uniform vec4 uGB2;
uniform vec4 uPx;       // x : P11 · H/2 · échelle du repère jardin ; y : cœur min (px) ; z : cœur max (px) ; w : halo
uniform vec4 uMote;     // x : taille (m), y : vitesse de base, z : vitesse aléatoire, w : -
uniform vec2 uLife;     // vie : base, aléa
varying float vA;
float moteAt(vec4 g, vec4 g2, out vec3 p) {
  p = position;
  if (aSeed.w >= g.z || g.y <= 0.0) return 0.0;
  float s = -position.z + 0.55 * position.y;
  float birth = g2.y + (s - g2.z) / g.w + 0.35 * aSeed.x - 0.12;
  float age = g.x - birth;
  float life = min(uLife.x + uLife.y * aSeed.y, g2.x - birth);
  if (age <= 0.0 || age >= life) return 0.0;
  float a = age / life;
  float v = (uMote.y + uMote.z * aSeed.z) * aRise;
  p.y += age * v;
  p.x += 0.12 * sin(1.3 * age + 6.2831853 * aSeed.x) * a;
  p.z += 0.06 * cos(1.1 * age + 6.2831853 * aSeed.y) * a;
  float tw = 0.75 + 0.25 * sin(9.0 * g.x + 40.0 * aSeed.w);
  // la poussière s'allume quand le rayon la traverse (éclat de naissance), puis reste dorée dans la rémanence
  float u = clamp((g.x - g2.y) * g.w / g2.w, 0.0, 1.0);
  float fr = g2.z + g2.w * (0.5 * u * u * (3.0 - 2.0 * u) + 0.5 * u);
  float q = (-p.z + 0.55 * p.y - fr) / 1.1;
  float lit = 0.6 + 0.8 * exp(-q * q) + 0.6 * exp(-5.0 * age);
  return smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.6, 1.0, a)) * tw * lit * g.y;
}
void main() {
  vec3 pA, pB;
  float aA = moteAt(uGA, uGA2, pA);
  float aB = moteAt(uGB, uGB2, pB);
  vec3 p = aA >= aB ? pA : pB;
  vA = max(aA, aB);
  if (vA < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float core = uMote.x * (0.7 + 0.6 * aSeed.z) * uPx.x / max(-mv.z, 1e-3);
  core = clamp(core, uPx.y, uPx.z);
  gl_PointSize = core * uPx.w;
  gl_Position = projectionMatrix * mv;
}
`
const FS = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uHot;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  float core = exp(-16.0 * r2);
  float halo = 0.4 * exp(-5.0 * r2);
  vec2 aq = abs(q);
  float star = exp(-30.0 * aq.x) * exp(-3.5 * aq.y) + exp(-30.0 * aq.y) * exp(-3.5 * aq.x);
  float k = (core + halo + 0.25 * star) * vA;
  if (k < 0.003) discard;
  gl_FragColor = vec4(uCol * k + uHot * core * vA, 1.0);   // additif, couleurs d'affichage (jamais blanc)
}
`

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// cône visible par la porte (x ±0,597 au plan du mur, z 0 … −0,45) depuis la vue visiteur par défaut et la vue proche :
// la poussière en suspension naît dedans (marge 0,1 m pour le balancement)
const VIEW_CAMS = [[0.15, 6.66], [-0.02, 3.16]]
function coneX(z, out) {
  let x0 = 1e9, x1 = -1e9
  for (const [cx, cz] of VIEW_CAMS) {
    const t = (cz + 0.45) / (cz - z)              // plan arrière du tableau (le plus restrictif)
    x0 = Math.min(x0, cx + (-0.597 - cx) / t); x1 = Math.max(x1, cx + (0.597 - cx) / t)
  }
  out[0] = Math.max(x0 + 0.1, -2.8); out[1] = Math.min(x1 - 0.1, 2.8)
  return out
}

export function createCedarAnswer({ gardenRoot, quality = 'high', reduced = false, seed = 23, renderOrder = CEDAR_CFG.renderOrder } = {}) {
  const C = CEDAR_CFG, MC = C.motes
  const rng = mulberry32(seed)
  const MAX = MC.count.high

  // ---- géométrie du pollen (ordre entrelacé : tout préfixe — palier moyen, bas — échantillonne toutes les zones) ----
  const pts = []
  const cx = [0, 0]
  for (const z of SPAWN) {
    const list = []
    for (let i = 0; i < z.n; i++) {
      const u = (i + rng()) / z.n                  // stratifié le long de la plus grande dimension
      let x, y, zz
      if (z.kind === 'rect') {
        const [x0, x1, y0, y1, z0, z1] = z.a
        if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) { x = x0 + (x1 - x0) * u; zz = z0 + (z1 - z0) * rng() } else { zz = z0 + (z1 - z0) * u; x = x0 + (x1 - x0) * rng() }
        y = y0 + (y1 - y0) * rng()
      } else if (z.kind === 'ring') {
        const [rcx, rcz, r0, r1, y0, y1] = z.a
        const a = (u - 0.5) * Math.PI * 1.25 + Math.PI / 2   // côté visiteur (+z) : l'arrière est caché par la vasque
        const r = r0 + (r1 - r0) * rng()
        x = rcx + Math.cos(a) * r; zz = rcz + Math.sin(a) * r; y = y0 + (y1 - y0) * rng()
      } else {
        const [y0, y1, z0, z1] = z.a
        zz = z0 + (z1 - z0) * u
        coneX(zz, cx)
        x = cx[0] + (cx[1] - cx[0]) * rng()
        y = y0 + (y1 - y0) * rng()
      }
      list.push([x, y, zz, z.mul])
    }
    pts.push(list)
  }
  // entrelacement proportionnel (Bresenham sur les zones)
  const order = []
  const taken = pts.map(() => 0)
  for (let k = 0; k < MAX; k++) {
    let best = -1, bestD = -1e9
    for (let j = 0; j < pts.length; j++) {
      if (taken[j] >= pts[j].length) continue
      const d = (k + 1) * pts[j].length / MAX - taken[j]
      if (d > bestD) { bestD = d; best = j }
    }
    order.push(pts[best][taken[best]++])
  }
  const pos = new Float32Array(MAX * 3), sd = new Float32Array(MAX * 4), rise = new Float32Array(MAX)
  for (let i = 0; i < MAX; i++) {
    const p = order[i]
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]
    sd[i * 4] = rng(); sd[i * 4 + 1] = rng(); sd[i * 4 + 2] = rng()
    sd[i * 4 + 3] = (i + rng()) / MAX              // coupe du rappel : régulière le long de l'ordre entrelacé
    rise[i] = p[3]
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4))
  geo.setAttribute('aRise', new THREE.BufferAttribute(rise, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, -5), 7)

  const U = {
    uGA: { value: new THREE.Vector4(0, 0, 1, 7) }, uGA2: { value: new THREE.Vector4(0, 0.3, C.s0, C.s1 - C.s0) },
    uGB: { value: new THREE.Vector4(0, 0, 1, 7) }, uGB2: { value: new THREE.Vector4(0, 0.3, C.s0, C.s1 - C.s0) },
    uPx: { value: new THREE.Vector4(800, 2, 6, MC.halo) },
    uMote: { value: new THREE.Vector4(MC.size, MC.rise[0], MC.rise[1], 0) },
    uLife: { value: new THREE.Vector2(MC.life[0], MC.life[1]) },
    uCol: { value: new THREE.Color(MC.col[0] * MC.gainCol, MC.col[1] * MC.gainCol, MC.col[2] * MC.gainCol) },
    uHot: { value: new THREE.Color(MC.hot[0] * MC.gainHot, MC.hot[1] * MC.gainHot, MC.hot[2] * MC.gainHot) },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  })
  const points = new THREE.Points(geo, mat)
  points.name = 'PB_CedarPollen'
  points.renderOrder = renderOrder
  points.frustumCulled = false
  points.visible = false
  const pxBuf = new THREE.Vector2()
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(pxBuf)
    const H = pxBuf.y
    U.uPx.value.x = camera.projectionMatrix.elements[5] * H * 0.5 * points.matrixWorld.getMaxScaleOnAxis()
    U.uPx.value.y = MC.minPx * H
    U.uPx.value.z = MC.maxPx * H
  }
  if (gardenRoot) gardenRoot.add(points)

  let count = MC.count[quality] || MC.count.high
  geo.setDrawRange(0, count)

  // ---- état (doubles dans un tableau typé : aucune boîte par image) ----------------------------------------------
  // 0 t, 1 mode (0 inactif, 1 réponse, 2 rappel, 3 réduit), 2 release écoulé, 3 durée du release (0 = aucun),
  // 4 rémanence reprise, 5 t de la génération B, 6 intensité B au départ, 7 temps depuis la bascule B,
  // 8 front affiché, 9 amplitude affichée, 10 rémanence affichée, 11 ciel affiché, 12 prewarm
  const S = new Float64Array(16)
  let prof = C.fire
  let profB = C.fire
  const T = 0, MODE = 1, REL = 2, RELD = 3, CARRY = 4, TB = 5, KB = 6, TSW = 7, FRONT = 8, AMP = 9, AFTER = 10, SKY = 11, PREWARM = 12

  const frontV = (p) => (C.s1 - C.s0) / p.frontDur

  function neutral() {
    CEDAR_GOLD.uMjGold.value.set(-99, C.width, 0, 0)
    CEDAR_GOLD.uMjGoldSky.value.x = 0
    U.uGA.value.y = 0; U.uGB.value.y = 0
    points.visible = S[PREWARM] > 0
    S[FRONT] = -99; S[AMP] = 0; S[AFTER] = 0; S[SKY] = 0
  }

  function start(p, mode) {
    // rejouée pendant la réponse précédente : la rémanence affichée s'éteint sur 0,5 s (max avec la nouvelle courbe),
    // le pollen encore en vol passe en génération B et s'éteint avec elle
    const was = S[MODE] > 0
    S[CARRY] = was ? S[AFTER] : 0
    if (was && S[MODE] !== 3) {
      profB = prof
      S[TB] = S[T]; S[KB] = U.uGA.value.y * (S[RELD] > 0 ? 1 - smooth(S[REL] / S[RELD]) : 1); S[TSW] = 0
      U.uGB.value.set(S[TB], S[KB], U.uGA.value.z, U.uGA.value.w)
      U.uGB2.value.copy(U.uGA2.value)
    } else { S[KB] = 0; U.uGB.value.y = 0 }
    prof = p
    S[T] = 0; S[MODE] = mode; S[REL] = 0; S[RELD] = 0
    U.uGA.value.set(0, mode === 3 ? 0 : 1, p.motes, frontV(p))
    U.uGA2.value.set(p.fadeAt + p.fadeDur - 0.1, p.start, C.s0, C.s1 - C.s0)
    points.visible = mode !== 3
    write(0)
  }

  // Courbes du SPEC §4.2 écrites en ligne (smoothstep développé) : une fonction qui renvoie un double, si V8 ne
  // l'inline pas, emboîte sa valeur à chaque image (mesuré : ~1 boîte / image) ; ici, aucune allocation.
  function write(dt) {
    const t = S[T], p = prof
    let front = 99, amp = 0, after = 0, sky = 0, k = 0, m = 0
    if (S[MODE] === 3) {
      const R = C.reduced
      k = t / R.rise; k = k < 0 ? 0 : k > 1 ? 1 : k
      m = (t - R.rise - R.hold) / R.out; m = m < 0 ? 0 : m > 1 ? 1 : m
      after = R.after * k * k * (3 - 2 * k) * (1 - m * m * (3 - 2 * m))
    } else {
      k = (t - p.start) / p.frontDur; k = k < 0 ? 0 : k > 1 ? 1 : k                       // front(t)
      front = C.s0 + (C.s1 - C.s0) * (0.5 * k * k * (3 - 2 * k) + 0.5 * k)
      k = t / 0.3; k = k < 0 ? 0 : k > 1 ? 1 : k                                             // amp(t)
      m = (t - p.start - p.frontDur) / p.ampOut; m = m < 0 ? 0 : m > 1 ? 1 : m
      amp = p.amp * k * k * (3 - 2 * k) * (1 - m * m * (3 - 2 * m))
      m = (t - p.fadeAt) / p.fadeDur; m = m < 0 ? 0 : m > 1 ? 1 : m                         // fade(t)
      const fade = 1 - m * m * (3 - 2 * m)
      k = t / p.after0Dur; k = k < 0 ? 0 : k > 1 ? 1 : k                                     // after(t)
      m = (t - p.afterAt) / p.afterDur; m = m < 0 ? 0 : m > 1 ? 1 : m
      after = (p.after0 * k * k * (3 - 2 * k) + p.after * m * m * (3 - 2 * m)) * fade
      k = (t - p.skyAt) / p.skyDur; k = k < 0 ? 0 : k > 1 ? 1 : k                           // sky(t) (P2)
      sky = p.sky * k * k * (3 - 2 * k) * fade
    }
    if (S[CARRY] > 0) {   // rejouée : l'ancienne rémanence s'éteint sur C.carry s, sans saut
      k = t / C.carry; k = k < 0 ? 0 : k > 1 ? 1 : k
      m = S[CARRY] * (1 - k * k * (3 - 2 * k))
      if (m > after) after = m
    }
    let rel = 1
    if (S[RELD] > 0) { k = S[REL] / S[RELD]; k = k < 0 ? 0 : k > 1 ? 1 : k; rel = 1 - k * k * (3 - 2 * k) }
    amp *= rel; after *= rel; sky *= rel
    S[FRONT] = front; S[AMP] = amp; S[AFTER] = after; S[SKY] = sky
    CEDAR_GOLD.uMjGold.value.set(front, C.width, amp, after)
    CEDAR_GOLD.uMjGoldSky.value.x = sky
    // pollen : génération courante
    U.uGA.value.x = t
    U.uGA.value.y = S[MODE] === 3 ? 0 : rel
    // génération précédente : continue son temps, s'éteint en C.carry s
    if (S[KB] > 0) {
      S[TB] += dt; S[TSW] += dt
      k = S[TSW] / C.carry; k = k < 0 ? 0 : k > 1 ? 1 : k
      m = S[KB] * (1 - k * k * (3 - 2 * k)) * rel
      U.uGB.value.x = S[TB]; U.uGB.value.y = m
      if (m <= 0) S[KB] = 0
    } else U.uGB.value.y = 0
  }

  const api = {
    objects: [points],
    points,
    /** Réponse complète (startAnswer(2)). */
    fire() { start(C.fire, reduced ? 3 : 1) },
    /** Rappel (CÈDRE rejoué) : amplitude 0,55, rémanence 0,25, front en 1,4 s, 40 % du pollen, fin 3,2 s. */
    reprise() { start(C.reprise, reduced ? 3 : 2) },
    /** Retour au calme en `dur` s (RANGER : les battants se referment sans lumière dorée). */
    release(dur = 0.6) {
      if (S[MODE] === 0) return
      if (dur <= 0) { api.clear(); return }
      if (S[RELD] > 0 && S[REL] / S[RELD] > 0) {   // déjà en extinction : on garde la plus courte
        const left = S[RELD] - S[REL]
        if (left <= dur) return
      }
      S[REL] = 0; S[RELD] = dur
    },
    /** Coupe tout, uniforms remis EXACTEMENT au neutre, pollen caché. */
    clear() { S[MODE] = 0; S[T] = 0; S[REL] = 0; S[RELD] = 0; S[CARRY] = 0; S[KB] = 0; neutral() },
    update(dt) {
      if (S[MODE] === 0) return
      S[T] += dt
      if (S[RELD] > 0) S[REL] += dt
      const p = prof
      const end = S[MODE] === 3 ? C.reduced.rise + C.reduced.hold + C.reduced.out + 0.05 : p.end
      if (S[T] >= end || (S[RELD] > 0 && S[REL] >= S[RELD])) { api.clear(); return }
      write(dt)
    },
    setQuality(q) {
      count = MC.count[q] || count
      geo.setDrawRange(0, count)
    },
    /** Compilation au chargement : visible le temps du prewarm du directeur (le programme existe dès `ready`). */
    setPrewarm(on) { S[PREWARM] = on ? 1 : 0; points.visible = !!on || (S[MODE] > 0 && S[MODE] !== 3) },
    get active() { return S[MODE] > 0 },
    stats() { return { drawCalls: points.visible ? 1 : 0, motes: count, t: S[T], mode: S[MODE], front: S[FRONT], amp: S[AMP], after: S[AFTER], sky: S[SKY] } },
    /** Relecture (revue) : sample(t, i, out) rejoue la formule du vertex shader pour la génération courante —
     *  renvoie l'alpha du point i au temps t (0 s'il est éteint) et sa position jardin dans `out`. Peut allouer. */
    _debug() {
      return {
        t: S[T], mode: S[MODE], count, cfg: C, gold: CEDAR_GOLD, uniforms: U,
        sample(t = S[T], i = 0, out = new THREE.Vector3()) {
          const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2]
          out.set(px, py, pz)
          if (i >= count) return 0
          const g = U.uGA.value, g2 = U.uGA2.value
          if (sd[i * 4 + 3] >= g.z || S[MODE] === 0 || S[MODE] === 3) return 0
          const s = -pz + 0.55 * py
          const birth = g2.y + (s - g2.z) / g.w + 0.35 * sd[i * 4] - 0.12
          const age = t - birth
          const life = Math.min(MC.life[0] + MC.life[1] * sd[i * 4 + 1], g2.x - birth)
          if (age <= 0 || age >= life) return 0
          const a = age / life
          const v = (MC.rise[0] + MC.rise[1] * sd[i * 4 + 2]) * rise[i]
          out.set(px + 0.12 * Math.sin(1.3 * age + TAU * sd[i * 4]) * a, py + age * v, pz + 0.06 * Math.cos(1.1 * age + TAU * sd[i * 4 + 1]) * a)
          const sm = (e0, e1, x) => { const k = clamp01((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k) }
          const tw = 0.75 + 0.25 * Math.sin(9 * t + 40 * sd[i * 4 + 3])
          const u = clamp01((t - g2.y) * g.w / g2.w)
          const fr = g2.z + g2.w * (0.5 * u * u * (3 - 2 * u) + 0.5 * u)
          const q = (-out.z + 0.55 * out.y - fr) / 1.1
          const lit = 0.6 + 0.8 * Math.exp(-q * q) + 0.6 * Math.exp(-5 * age)
          return sm(0, 0.12, age) * (1 - sm(0.6, 1, a)) * tw * lit * g.y
        },
        spawn: pos, seeds: sd,
      }
    },
    dispose() { if (points.parent) points.parent.remove(points); geo.dispose(); mat.dispose(); api.clear() },
  }
  neutral()
  return api
}
