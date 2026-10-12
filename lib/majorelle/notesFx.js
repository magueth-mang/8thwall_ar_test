// « BLEU INTERDIT » — les trois notes qui répondent aux trois coups (SPEC_PERFUME §5.3, §5.5, §2.5).
//
//   TÊTE  · néroli   : une pluie de fleurs d'oranger sur TOUT le bassin (78 fleurs + 14 pétales au palier haut, 54 + 10
//                      moyen, 34 + 6 bas) : 77 % sur l'eau (et sur les feuilles), 17 % sur la margelle, 6 % sur le sol
//                      devant le bassin. Chute « en feuille morte » (balancier, inclinaison dans le sens de la course,
//                      souffle commun, culbute des pétales ; deux fleurs voisines à l'écran s'écartent, jamais de grappe),
//                      départ concentré au début ; sur l'eau elles s'enfoncent un peu, dérivent et roulent sur la houle ;
//                      sur la pierre elles rebondissent à peine, glissent de 2 cm et restent à plat. Évaporation après 9 s
//                      (12 / 9 / 6 survivantes).                               InstancedMesh 112 × 48 tris, ordre 7.5
//   CŒUR  · nymphéas : un champ de 6 nymphéas bleus (Nymphaea caerulea) sur tout le bassin, éclos en vague depuis le
//                      héros (près → loin, 0 → 1,6 s). Pour chacun : l'eau se soulève et écarte les fleurs flottantes (0,5 s,
//                      disque gardé libre ensuite) ; le bouton monte du fond (ressort), penché, se redresse en perçant,
//                      sa feuille se déroule, puis ses 16 pétales s'ouvrent chacun à son tour (ressorts sous-amortis,
//                      la pointe suit la base) autour d'une couronne d'étamines d'or.
//                      1 draw call instancié (6 × 464 tris), ordre 7.6
//   FOND  · ambre    : 40 grains d'ambre quittent les battants ouverts en deux courants qui ondulent (champ
//                      tourbillonnaire) et s'enroulent dans le col.        traînées instanciées (repère marqueur), ordre 15
//
// 3 draw calls au maximum, chacun masqué quand il est inactif. Zéro allocation par image.
// Néroli et nymphéa vivent sous `gardenRoot` (mètres jardin) et sont dessinés APRÈS l'eau de gardenFx
// (eau +2/+3, feuilles +6, fleurs +7) ; l'ambre vit sous `anchor` (unités marqueur).
// Matériaux non tone-mappés, éclairés comme gardenFx (soleil chaud, ciel #8fb4e0, diffusion #0a1a44).
//
// Texture `textures.petals` = T_PB_petals.png (1024×512, RGBA) : trois colonnes
//   néroli | nymphéa | bande d'étamines  (base des pétales en bas, pointe en haut).
// Tant que le fichier n'est pas publié (WP2), un atlas procédural de même disposition est peint sur canvas.
//
// Options en plus de la signature du SPEC (toutes facultatives) : sunDir (vers le soleil, repère jardin),
// water (gardenFx : sa debug.uniforms.uTime cale la houle, lecture protégée), pool { x0, x1, z0, z1, waterY }.

import * as THREE from 'three'
import { PB_RENDER_ORDER, PB_CFG } from '@/lib/majorelle/perfumeConfig'

const TAU = Math.PI * 2
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = (x) => clamp(x, 0, 1)
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3)

// --- valeurs de la cour (gardenFx DEFAULT_POOL / MJ_CFG.sunDir) ----------------------------------
const DEFAULT_POOL = { x0: -0.8, x1: 0.8, z0: -6.3, z1: -1.7, waterY: 0 }
const DEFAULT_SUN = [-0.52, 0.76, 0.38]
const QUALITY = {
  high: { neroli: 18, motes: 40, petals: 6 },
  medium: { neroli: 18, motes: 32, petals: 4 },
  low: { neroli: 12, motes: 24, petals: 3 },
}
const MAX_BLOSSOMS = 112   // GARDEN XL : une pluie (92 au palier haut) + les survivantes d'un lot précédent
const MAX_MOTES = 40

// Atlas T_PB_petals.png (1024×512) — disposition publiée par WP2 (public/majorelle/perfume/textures.json) :
// cellules (u0, v0, u1, v1) en v vers le haut (flipY par défaut) ; pétales centrés sur leur cellule,
// base à v = 0,04 et pointe à v = 0,96 de la cellule ; demi-largeur ≤ 0,23 (néroli) / 0,155 (nymphéa) × longueur.
export const PETAL_ATLAS = {
  size: [1024, 512],
  neroli: [0.0, 0.0, 0.375, 1.0],
  lily: [0.375, 0.0, 0.75, 1.0],
  stamen: [0.75, 0.5, 1.0, 1.0],     // frange d'étamines (vue de côté), base en bas
  heart: [0.75, 0.0, 1.0, 0.5],      // cœur du néroli vu de dessus (pistil vert, filaments, anthères)
  base: 0.04, tip: 0.96,
  halfW: { neroli: 0.23, lily: 0.155 },
}
// demi-largeur u (fraction de la cellule autour de son axe) qui contient le pétale, et rapport
// demi-largeur géométrique / longueur qui conserve les proportions de la texture
function petalFrame(cell, halfW) {
  const cw = (cell[2] - cell[0]) * PETAL_ATLAS.size[0], ch = (cell[3] - cell[1]) * PETAL_ATLAS.size[1]
  const Lpx = (PETAL_ATLAS.tip - PETAL_ATLAS.base) * ch
  const h = Math.min(0.5, (halfW * Lpx) / cw + 0.02)
  return { h, k: (h * cw) / Lpx }
}
const NEROLI_FRAME = petalFrame(PETAL_ATLAS.neroli, PETAL_ATLAS.halfW.neroli)
const LILY_FRAME = petalFrame(PETAL_ATLAS.lily, PETAL_ATLAS.halfW.lily)

// COPIE documentée de swellHeight() de lib/majorelle/gardenFx.js (houle basse fréquence : trois sinus).
// Ne pas importer : gardenFx n'exporte pas cette fonction. Garder synchronisé si gardenFx change.
function swellHeight(x, z, t) {
  return 0.0016 * Math.sin((0.8 * x + 0.6 * z) * 7.0 + t * 1.25) +
    0.0012 * Math.sin((-0.45 * x + 0.89 * z) * 11.0 + t * 1.7) +
    0.0006 * Math.sin((0.97 * x - 0.24 * z) * 19.0 - t * 2.3)
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------
// Atlas procédural (repli si T_PB_petals.png manque) — même disposition et même cadre que WP2
// ---------------------------------------------------------------------------------------------
export function makeFallbackPetalAtlas() {
  const [W, H] = PETAL_ATLAS.size
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  g.clearRect(0, 0, W, H)
  const rng = mulberry32(1337)
  // cellule (v vers le haut) → rectangle canvas (y vers le bas)
  const rect = (cell) => ({ x: cell[0] * W, y: (1 - cell[3]) * H, w: (cell[2] - cell[0]) * W, h: (cell[3] - cell[1]) * H })
  const petal = (cell, halfW, prof, paint) => {
    const r = rect(cell), cx = r.x + r.w / 2
    const bot = r.y + r.h * (1 - PETAL_ATLAS.base), top = r.y + r.h * (1 - PETAL_ATLAS.tip), L = bot - top
    const N = 48
    g.save()
    g.beginPath()
    for (let i = 0; i <= N; i++) { const v = i / N; g[i ? 'lineTo' : 'moveTo'](cx - prof(v) * halfW * L, bot - L * v) }
    for (let i = N; i >= 0; i--) { const v = i / N; g.lineTo(cx + prof(v) * halfW * L, bot - L * v) }
    g.closePath(); g.clip()
    paint(r, cx, top, bot, L)
    g.restore()
  }
  // néroli : oblong arrondi, cireux, onglet vert-jaune, nervures translucides, glandes à huile
  petal(PETAL_ATLAS.neroli, PETAL_ATLAS.halfW.neroli,
    (v) => Math.max(Math.pow(Math.max(0, 1 - Math.pow((v - 0.56) / 0.44, 2)), 0.6), v < 0.2 ? 0.3 - v : 0),
    (r, cx, top, bot, L) => {
      const gr = g.createLinearGradient(0, bot, 0, top)
      gr.addColorStop(0, '#ccdb8c'); gr.addColorStop(0.12, '#e8edc6'); gr.addColorStop(0.25, '#f9f6ed'); gr.addColorStop(1, '#fbf8f0')
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h)
      g.lineWidth = 1.2
      for (let k = -5; k <= 5; k++) {
        g.strokeStyle = `rgba(190,190,165,${k === 0 ? 0.32 : 0.14 + 0.05 * rng()})`
        g.beginPath(); g.moveTo(cx, bot); g.bezierCurveTo(cx + k * L * 0.03, bot - L * 0.4, cx + k * L * 0.04, bot - L * 0.75, cx + k * L * 0.02, top + L * 0.05); g.stroke()
      }
      for (let k = 0; k < 120; k++) {
        const x = cx + (rng() - 0.5) * L * 0.4, y = bot - L * (0.2 + 0.75 * rng()), rr = 1 + 2 * rng()
        g.fillStyle = `rgba(214,214,190,${0.15 + 0.2 * rng()})`; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill()
      }
    })
  // nymphéa : lancéolé pointu, base #EAF0FF → pointe #5A7BFF, nervures plus soutenues, nervure médiane pâle
  petal(PETAL_ATLAS.lily, PETAL_ATLAS.halfW.lily,
    (v) => Math.max(Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + 0.97 * Math.pow(v, 0.72))), 0.7) * (1 - 0.15 * v), v < 0.1 ? 0.2 : 0),
    (r, cx, top, bot, L) => {
      const gr = g.createLinearGradient(0, bot, 0, top)
      gr.addColorStop(0, '#eaf0ff'); gr.addColorStop(0.35, '#c4d2ff'); gr.addColorStop(0.7, '#86a0ff'); gr.addColorStop(1, '#5a7bff')
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h)
      g.lineWidth = 1
      for (let k = -6; k <= 6; k++) {
        g.strokeStyle = k === 0 ? 'rgba(245,248,255,0.5)' : `rgba(70,100,230,${0.1 + 0.06 * rng()})`
        g.beginPath(); g.moveTo(cx + k * 1.5, bot); g.bezierCurveTo(cx + k * L * 0.022, bot - L * 0.45, cx + k * L * 0.016, bot - L * 0.75, cx, top); g.stroke()
      }
    })
  // frange d'étamines (base en bas) : filaments or #E8B84A, anthères #FAD66B
  {
    const r = rect(PETAL_ATLAS.stamen)
    for (let k = 0; k < 70; k++) {
      const x = r.x + 3 + rng() * (r.w - 6), top = r.y + r.h * (0.08 + 0.3 * rng()), bend = (rng() - 0.5) * 12
      g.strokeStyle = `rgba(${220 + 12 * rng()},${170 + 20 * rng()},${70 + 20 * rng()},1)`
      g.lineWidth = 2 + 1.5 * rng()
      g.beginPath(); g.moveTo(x, r.y + r.h); g.quadraticCurveTo(x + bend, (r.y + r.h + top) / 2, x + bend * 0.6, top); g.stroke()
      g.fillStyle = '#fad66b'; g.beginPath(); g.ellipse(x + bend * 0.6, top, 3.2, 8, 0, 0, TAU); g.fill()
    }
  }
  // cœur du néroli vu de dessus : filaments blancs rayonnants, anthères jaunes, pistil vert
  {
    const r = rect(PETAL_ATLAS.heart), cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w * 0.38
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * TAU + rng() * 0.1, rr = R * (0.85 + 0.15 * rng())
      g.strokeStyle = '#f3f0e0'; g.lineWidth = 4
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); g.stroke()
      g.fillStyle = '#f6c838'; g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 8, 0, TAU); g.fill()
    }
    const gr = g.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, R * 0.28)
    gr.addColorStop(0, '#d8e46a'); gr.addColorStop(0.5, '#86a83a'); gr.addColorStop(1, '#5d7d2a')
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.26, 0, TAU); g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.userData.fallback = true
  return t
}

// ---------------------------------------------------------------------------------------------
// GLSL partagé : éclairage « jardin » (même modèle que les fleurs de gardenFx)
// ---------------------------------------------------------------------------------------------
const GLSL_LIGHT = /* glsl */ `
uniform vec3 uCam;      // caméra, repère jardin
uniform vec3 uSunDir;   // vers le soleil
uniform vec3 uSunCol;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uScatter;
uniform float uWaterY;
uniform float uTime;
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// pétale cireux : diffus enveloppant, transmission (soleil + ciel à travers le pétale), lustre doux
vec3 petalLight(vec3 alb, vec3 N, vec3 V, float trans, float wrapK, float sheen) {
  float ndl = dot(N, uSunDir);
  float wrap = max((ndl + wrapK) / (1.0 + wrapK), 0.0);
  vec3 sky = mix(uSkyHor, uSkyZen, 0.5 + 0.5 * N.y);
  vec3 col = alb * (sky * (0.34 + 0.2 * max(N.y, 0.0)) + uSunCol * wrap * 0.82);
  // lumière qui traverse le pétale (vue de l'autre face) : teinte saturée (albédo²)
  vec3 thru = uSunCol * max(-ndl, 0.0) * 0.75 + uSkyZen * max(-N.y, 0.0) * 0.55;
  col += alb * alb * thru * trans;
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), 28.0) * sheen;
  float F = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 R = reflect(-V, N);
  col += mix(uSkyHor, uSkyZen, clamp(R.y, 0.0, 1.0)) * F * 0.16;
  return col;
}
// partie immergée : se fond dans l'eau (même formule que gardenFx)
vec4 underwater(vec3 col, float y) {
  float d = uWaterY - y;
  if (d <= 0.0) return vec4(col, 1.0);
  col = mix(col * vec3(0.55, 0.75, 0.85), uScatter, 1.0 - exp(-d * 30.0));
  return vec4(col, exp(-d * 40.0));
}
`

// ---------------------------------------------------------------------------------------------
// 1) Néroli — fleur d'oranger : 5 pétales courbes (2×2 segments) + cœur (disque vu de dessus + 3 franges croisées) ;
//    la même géométrie sert aux pétales détachés (instance « pétale » : seul le pétale 0 reste, recentré)
//    = 40 + 8 = 48 tris ; proportions du rendu approuvé renders/perfume_notes_v1.png
// ---------------------------------------------------------------------------------------------
function buildBlossomGeometry() {
  const pos = [], nrm = [], uv = [], info = [], idx = []
  const A = PETAL_ATLAS.neroli, S = PETAL_ATLAS.stamen, Hc = PETAL_ATLAS.heart
  const r0 = 0.005, len = 0.052, halfW = NEROLI_FRAME.k * len
  const ucell = (s) => A[0] + (0.5 + s * NEROLI_FRAME.h) * (A[2] - A[0])
  const vcell = (l) => A[1] + (PETAL_ATLAS.base + l * (PETAL_ATLAS.tip - PETAL_ATLAS.base)) * (A[3] - A[1])
  // profil le long du pétale (angle au-dessus de l'horizontale) : se dresse au cœur, s'arque, pointe retroussée
  const ang = [0.98, 0.42, -0.34]
  for (let p = 0; p < 5; p++) {
    const az = (p / 5) * TAU + (p % 2 ? 0.06 : -0.05)
    const ca = Math.cos(az), sa = Math.sin(az)
    const b = pos.length / 3
    const grid = []
    for (let i = 0; i < 3; i++) {
      let x = r0, y = 0.003
      for (let k = 0; k < i; k++) { const e = (ang[k] + ang[k + 1]) / 2; x += Math.cos(e) * len * 0.5; y += Math.sin(e) * len * 0.5 }
      const l = i / 2
      for (let j = 0; j < 3; j++) {
        const s = j - 1
        const cup = s * s * halfW * 0.42 * (1 - 0.5 * l)              // pétale creusé, plus à la base
        const e = ang[i]
        const lx = x - Math.sin(e) * cup, ly = y + Math.cos(e) * cup
        const lz = s * halfW * (0.9 + 0.1 * l)
        grid.push([lx * ca - lz * sa, ly, lx * sa + lz * ca])
        uv.push(ucell(s), vcell(l))
        info.push(0, l, s, p)
      }
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const q = (ii, jj) => grid[clamp(ii, 0, 2) * 3 + clamp(jj, 0, 2)]
      const a = q(i + 1, j), bq = q(i - 1, j), c = q(i, j + 1), d = q(i, j - 1)
      const tx = [a[0] - bq[0], a[1] - bq[1], a[2] - bq[2]], tz = [c[0] - d[0], c[1] - d[1], c[2] - d[2]]
      let nx = tz[1] * tx[2] - tz[2] * tx[1], ny = tz[2] * tx[0] - tz[0] * tx[2], nz = tz[0] * tx[1] - tz[1] * tx[0]
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz }
      const L = Math.hypot(nx, ny, nz) || 1
      const pt = grid[i * 3 + j]
      pos.push(pt[0], pt[1], pt[2]); nrm.push(nx / L, ny / L, nz / L)
    }
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const a = b + i * 3 + j, bb = a + 1, c = a + 3, d = c + 1
      idx.push(a, bb, c, bb, d, c)
    }
  }
  // cœur vu de dessus : un carré horizontal (texture « heart »), un peu au-dessus des onglets
  {
    const b = pos.length / 3, R = 0.0125, y = 0.0105
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (const [x, z] of cs) {
      pos.push(x * R, y, z * R); nrm.push(0, 1, 0)
      uv.push(Hc[0] + (x * 0.5 + 0.5) * (Hc[2] - Hc[0]), Hc[1] + (z * 0.5 + 0.5) * (Hc[3] - Hc[1])); info.push(2, 1, 0, 5)
    }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2)
  }
  // 3 franges d'étamines croisées (à 60°) : la touffe se lit de profil, au ras de l'eau
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI + 0.3, c = Math.cos(a) * 0.0105, s = Math.sin(a) * 0.0105
    const b = pos.length / 3
    const nx = -Math.sin(a), nz = Math.cos(a)
    pos.push(-c, 0.002, -s); nrm.push(nx, 0.3, nz); uv.push(S[0], S[1]); info.push(1, 0, 0, 6)
    pos.push(c, 0.002, s); nrm.push(nx, 0.3, nz); uv.push(S[2], S[1]); info.push(1, 0, 0, 6)
    pos.push(-c * 1.15, 0.0175, -s * 1.15); nrm.push(nx, 0.3, nz); uv.push(S[0], S[3]); info.push(1, 1, 0, 6)
    pos.push(c * 1.15, 0.0175, s * 1.15); nrm.push(nx, 0.3, nz); uv.push(S[2], S[3]); info.push(1, 1, 0, 6)
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4))
  // centre du pétale 0 (repère de la fleur) : un pétale détaché tourne autour de lui
  const pc = new THREE.Vector3()
  for (let i = 0; i < 9; i++) { pc.x += pos[i * 3] / 9; pc.y += pos[i * 3 + 1] / 9; pc.z += pos[i * 3 + 2] / 9 }
  geo.userData.petalC = pc
  geo.setIndex(idx)
  return geo
}

const NEROLI_VS = /* glsl */ `
attribute vec4 aInfo;   // partie (0 pétale, 1 frange d'étamines, 2 cœur), l (le long), s (en travers), pièce (0..4 pétales, 5 cœur, 6 franges)
attribute vec4 aB;      // dissolution (0..1), battement des pétales, graine, éclat d'atterrissage
attribute vec4 aK;      // genre (0 fleur, 1 pétale détaché), reflet chaud, enfoncement (0..1), opacité (apparition)
uniform float uTime;
uniform vec3 uPetalC;   // centre du pétale 0
varying vec2 vUv;
varying vec3 vInfo;
varying vec4 vB;
varying vec4 vK;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 p = position;
  vec3 n = normal;
  float isPetal = step(0.5, aK.x);
  // pétale détaché : les autres pièces s'effondrent en un point (triangles dégénérés), le pétale est recentré
  if (isPetal > 0.5) {
    if (aInfo.w > 0.5) p = uPetalC;
    p -= uPetalC;
    p.y *= 0.45;                        // détaché, le pétale s'aplatit (il n'est plus tenu par le réceptacle)
  }
  // dans l'air, la traînée relève les pétales (corolle en coupe) avec un léger frémissement ; posée sur l'eau,
  // la fleur se rouvre (aB.y passe de 1 à 0 en oscillant un peu sous zéro : les pétales s'étalent puis reviennent)
  float az = atan(position.z, position.x);
  float ph = aB.z * 40.0 + az * 2.0;
  float air = aB.y;
  float vib = 0.6 * sin(uTime * 8.5 + ph) + 0.4 * sin(uTime * 13.7 + az * 3.0 + aB.z * 9.0);
  float lift = aInfo.y * aInfo.y * step(aInfo.x, 0.5);
  p.y += lift * (air * mix(0.008, 0.007, isPetal) + max(air, 0.0) * vib * 0.0025);
  p.xz *= 1.0 - 0.07 * air * lift * (1.0 - isPetal);
  vec4 w = instanceMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(instanceMatrix) * n);
  vUv = uv; vInfo = aInfo.xyz; vB = aB; vK = aK;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`
const NEROLI_FS = /* glsl */ `
${GLSL_LIGHT}
uniform sampler2D uPetals;
varying vec2 vUv;
varying vec3 vInfo;
varying vec4 vB;
varying vec4 vK;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec4 tex = texture2D(uPetals, vUv);
  // évaporation : le pétale s'érode des pointes vers le cœur (bruit), seuil alpha 0.4
  float diss = vB.x;
  float nz = h12(floor(vUv * vec2(260.0, 130.0)) + vB.z * 17.0);
  float thr = 0.4 + diss * (1.25 * vInfo.y + 0.45 + 0.6 * nz);
  if (tex.a < thr) discard;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  vec3 alb = tex.rgb;
  vec3 col;
  vec3 WARM = vec3(1.0, 0.80, 0.52);
  if (vInfo.x < 0.5) {
    // cire : ombre douce au creux, translucide, lustre satiné
    alb *= mix(vec3(0.8, 0.83, 0.72), vec3(1.0), smoothstep(0.0, 0.55, vInfo.y));
    col = petalLight(alb, N, V, 1.0, 0.55, 0.10);
    // contre-jour chaud : la cire s'allume sur les bords (fins) quand le pétale se présente de chant
    float rim = pow(1.0 - abs(dot(N, V)), 2.5);
    col += alb * WARM * rim * (0.18 + 0.22 * vInfo.y);
    // reflet du soleil sur la cire : petites étincelles quand la fleur bascule (heure dorée)
    vec3 H = normalize(uSunDir + V);
    float sp = pow(max(dot(N, H), 0.0), 64.0);
    col += uSunCol * WARM * sp * (0.35 + 1.1 * vK.y);
  } else if (vInfo.x < 1.5) {
    // frange : filaments plus clairs que ceux du nymphéa (néroli : filaments blancs, anthères jaunes)
    col = petalLight(mix(alb, vec3(1.0, 0.95, 0.75), 0.35), N, V, 0.3, 0.3, 0.25);
  } else {
    col = petalLight(alb, N, V, 0.2, 0.4, 0.15) + alb * 0.08;
  }
  col += alb * WARM * vB.w * 0.3;   // éclat bref et chaud à l'atterrissage
  vec4 o = underwater(col, vW.y);
  float a = smoothstep(thr, thr + 0.18, tex.a) * o.a * vK.w;
  gl_FragColor = vec4(linearToOutputTexel(vec4(o.rgb, 1.0)).rgb * a, a);
}
`

// ---------------------------------------------------------------------------------------------
// 2) Nymphéa bleu — 16 pétales (2 × 6 segments, 384 tris) + couronne d'étamines (24) + cœur doré (8)
//    + feuille fendue (48) = 464 tris ; proportions du rendu approuvé renders/perfume_notes_v1.png
//    Champ de lotus (GARDEN XL §3.3) : la même géométrie en InstancedBufferGeometry ; chaque lotus est une instance
//    (iCenter, iAnim, iBloom, iTilt, iPad remplacent les anciens uniforms) → un seul draw call, aucun programme de plus.
// ---------------------------------------------------------------------------------------------
const MAX_LOTUS = 6
const PAD_SEG = 16, PAD_NOTCH = 0.24
// Échelle du héros de la note II (revue DA : lisible au téléphone dans la vue du visiteur) : la fleur ×1,3, la feuille ×1,25
// (le rayon `radius` du directeur reste la référence 0,21 → échelle 1 ; ces facteurs s'y ajoutent).
const LILY_BLOOM_K = 1.3, LILY_PAD_K = 1.25
// le bouton part de 20 cm sous l'eau (invisible dans la diffusion), se tient à 3 cm au-dessus (repère : échelle 1)
const LILY_C0 = -0.20, LILY_C1 = 0.03
// géométrie qui en découle (échelle 1) : hauteur de la pointe du bouton au-dessus de son centre, portée de la corolle
// ouverte (verticille extérieur), portée de la feuille (décalage + rayon)
const LILY_BUD_TIP = 0.10 * LILY_BLOOM_K
const LILY_REACH = 0.205 * LILY_BLOOM_K
const LILY_PAD_REACH = 0.17 * LILY_PAD_K + 0.022
const LILY_FOOT = Math.max(LILY_REACH, LILY_PAD_REACH)
// montée : la pointe du bouton perce la surface à cette valeur du ressort de montée
const LILY_SURF = (-LILY_BUD_TIP - LILY_C0) / (LILY_C1 - LILY_C0)
function buildLilyGeometry(rng) {
  const pos = [], pet = [], ls = [], idx = []
  // pétales : verticille extérieur (0) puis intérieur (1), 8 chacun, décalés d'un demi-pas
  for (let w = 0; w < 2; w++) {
    for (let p = 0; p < 8; p++) {
      const az = (p / 8) * TAU + (w ? TAU / 16 : 0) + (rng() - 0.5) * 0.08
      const jit = rng()
      // ordre d'éclosion : verticille extérieur d'abord, puis l'intérieur ; dans chaque verticille, les pétales
      // s'ouvrent l'un après l'autre à ≈ 135° d'écart (phyllotaxie), jamais tous ensemble
      const delay = w * 0.45 + ((p * 3) % 8) * 0.06 + jit * 0.04
      const b = pos.length / 3
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) {
        pos.push(0, 0, 0)
        pet.push(w, az, jit)
        ls.push(i / 6, j - 1, delay)
      }
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
        const a = b + i * 3 + j, bb = a + 1, c = a + 3, d = c + 1
        idx.push(a, bb, c, bb, d, c)
      }
    }
  }
  // couronne d'étamines : bande évasée de 12 côtés
  {
    const b = pos.length / 3
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * TAU
      pos.push(0, 0, 0); pet.push(2, a, k / 12); ls.push(0, 0, 0)
      pos.push(0, 0, 0); pet.push(2, a, k / 12); ls.push(1, 0, 0)
    }
    for (let k = 0; k < 12; k++) { const a = b + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  // cœur (carpelle) : petit dôme doré, éventail de 8
  {
    const b = pos.length / 3
    pos.push(0, 0, 0); pet.push(4, 0, 0); ls.push(0, 0, 0)
    for (let k = 0; k < 8; k++) { pos.push(0, 0, 0); pet.push(4, (k / 8) * TAU, 0); ls.push(1, 0, 0) }
    for (let k = 0; k < 8; k++) idx.push(b, b + 1 + ((k + 1) % 8), b + 1 + k)
  }
  // feuille fendue : centre + 2 anneaux de 17 sommets (encoche en V) ; polygone circonscrit, le cercle
  // exact (bord légèrement ondulé) est découpé dans le fragment
  const padStart = idx.length
  {
    const b = pos.length / 3
    pos.push(0, 0, 0); pet.push(3, 0, 0); ls.push(0, 0, 0)
    for (const rr of [0.62, 1.0]) for (let k = 0; k <= PAD_SEG; k++) { pos.push(0, 0, 0); pet.push(3, k / PAD_SEG, 0); ls.push(rr, 0, 0) }
    for (let k = 0; k < PAD_SEG; k++) idx.push(b, b + 1 + k + 1, b + 1 + k)
    for (let k = 0; k < PAD_SEG; k++) { const a = b + 1 + k, bb = a + 1, c = a + PAD_SEG + 1, d = c + 1; idx.push(a, bb, c, bb, d, c) }
  }
  // la feuille d'abord (dessous), puis les pétales et le cœur dans le même draw call
  const ordered = idx.slice(padStart).concat(idx.slice(0, padStart))
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aPet', new THREE.Float32BufferAttribute(pet, 3))
  geo.setAttribute('aLS', new THREE.Float32BufferAttribute(ls, 3))
  geo.setIndex(ordered)
  // une instance par lotus (Float32 × 4, réécrits à chaque image : DynamicDraw)
  for (const name of ['iCenter', 'iAnim', 'iBloom', 'iTilt', 'iPad']) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LOTUS * 4), 4)
    a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute(name, a)
  }
  geo.instanceCount = 0
  return geo
}

const LILY_VS = /* glsl */ `
attribute vec3 aPet;   // partie (0 ext., 1 int., 2 étamines, 3 feuille, 4 cœur), azimut (feuille : fraction), aléa
attribute vec3 aLS;    // l (le long / rayon relatif), s (en travers), retard d'éclosion du pétale (s)
// par lotus (instance)
attribute vec4 iCenter;  // x, z, échelle (rayon / 0.21 ; 0 : lotus pas encore parti → rien n'est dessiné), lacet
attribute vec4 iAnim;    // montée (0 fond → 1 posé, dépassement possible), ouverture permise (1 ; → 0 à la fermeture), feuille, respiration
attribute vec4 iBloom;   // temps depuis le début de l'éclosion (s), temps depuis le rappel (s, < 0 : aucun), mouillé (0..1), lueur
attribute vec4 iTilt;    // axe horizontal (x, z) unitaire, angle (rad) : le bouton penche puis se redresse ; w : houle au centre
attribute vec4 iPad;     // décalage x, z de la feuille, rayon (m), direction de l'encoche
uniform float uTime;
uniform float uWaterY;
uniform vec4 uAtlasL;  // cellule nymphéa
uniform vec4 uAtlasS;  // cellule frange d'étamines
uniform vec4 uFrame;   // demi-largeur u (fraction de cellule), demi-largeur / longueur, v base, v pointe
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vP;       // partie, l, s, aléa
varying float vOpen;
varying float vGlow;   // lueur du lotus (rappel + naissance)
varying float vWet;    // pétales mouillés (0..1)
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
// inclinaison du bouton (Rodrigues autour d'un axe horizontal passant par la base)
vec3 tilt(vec3 v) {
  vec3 k = vec3(iTilt.x, 0.0, iTilt.y);
  float c = cos(iTilt.z), s = sin(iTilt.z);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
// position le long d'un pétale dont l'angle varie linéairement de a0 à a1 (intégrale exacte)
vec2 arcPos(float a0, float a1, float l) {
  float b = a1 - a0;
  if (abs(b) < 1e-3) return vec2(cos(a0), sin(a0)) * l;
  float a = a0 + b * l;
  return vec2(sin(a) - sin(a0), cos(a0) - cos(a)) / b;
}
// réponse d'un ressort sous-amorti (départ à vitesse nulle, léger dépassement, s'apaise en oscillant)
float spring(float t, float w, float z) {
  if (t <= 0.0) return 0.0;
  float wd = w * sqrt(1.0 - z * z);
  return 1.0 - exp(-z * w * t) * (cos(wd * t) + (z * w / wd) * sin(wd * t));
}
// rappel : une inspiration (la corolle s'ouvre un peu plus) puis l'expiration, en vague autour de la fleur
float breath(float d) {
  float t = iBloom.y - d;
  return t <= 0.0 ? 0.0 : smoothstep(0.0, 0.45, t) * (1.0 - smoothstep(0.45, 1.7, t));
}
void main() {
  float part = aPet.x;
  float sc = iCenter.z;
  vGlow = iBloom.w; vWet = iBloom.z;
  // lotus pas encore parti (retard de la vague) : tous ses sommets hors du volume de vue → aucun fragment
  if (sc <= 0.0) { vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vUv = vec2(0.0); vP = vec4(0.0); vOpen = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // le bouton monte du fond (−20 cm, quelle que soit sa taille : invisible dans la diffusion) et se tient 3 cm × échelle
  // au-dessus de l'eau (dépassement du ressort : il remonte un peu trop puis se pose)
  vec3 C = vec3(iCenter.x, uWaterY + iTilt.w + mix(${LILY_C0.toFixed(3)}, ${LILY_C1.toFixed(3)} * sc, iAnim.x), iCenter.y);
  float bk = sc * ${LILY_BLOOM_K.toFixed(3)};
  vec3 p, n;
  vec2 uvv = vec2(0.0);
  float l = aLS.x, s = aLS.y;
  float o = 0.0;
  if (part < 1.5) {
    float w = part;
    float jit = aPet.z;
    float d = aLS.z;
    // chaque pétale s'ouvre à son tour ; la pointe suit la base avec un temps de retard (le pétale se déroule)
    float pk = breath(d * 0.35) * 0.09;
    float ob = spring(iBloom.x - d, 4.2, 0.58) * iAnim.y + pk;
    float ot = spring(iBloom.x - d - 0.14, 4.0, 0.55) * iAnim.y + pk * 1.25;
    o = ob;
    float oc = clamp(o, 0.0, 1.0);
    float len = (w < 0.5 ? 0.20 : 0.15) * mix(0.56, 1.0, smoothstep(0.0, 0.6, oc)) * (0.95 + 0.1 * jit) - 0.012;
    float wid = 2.0 * uFrame.y * len * mix(0.9, 1.0, oc);
    float br = iAnim.w * 0.05 * oc * sin(uTime * 0.9 + aPet.y * 2.0);
    // bouton : ovoïde pointu (les pointes se rejoignent sur l'axe) ; ouvert : étoile (ext. 29°→15°, int. 58°→45°)
    float a0 = mix(w < 0.5 ? 1.20 : 1.30, w < 0.5 ? 0.52 : 0.96, ob) + br + (jit - 0.5) * 0.08 * oc;
    float a1 = mix(w < 0.5 ? 2.25 : 2.30, w < 0.5 ? 0.26 : 0.78, ot) + br;
    vec2 q = arcPos(a0, a1, l) * len;
    float a = mix(a0, a1, l);
    vec2 np = vec2(-sin(a), cos(a));                                   // normale du pétale (face intérieure)
    float halfW = wid * 0.5;
    float cup = s * s * wid * mix(0.36, 0.2, oc) * (1.0 - 0.35 * l);
    float r0 = (w < 0.5 ? 0.02 : 0.016);
    vec3 lp = vec3(r0 + q.x + np.x * cup, 0.006 + q.y + np.y * cup, s * halfW);
    vec3 T = vec3(cos(a), sin(a), 0.0);
    vec3 B = vec3(np * (2.0 * s * wid * mix(0.36, 0.2, oc)), halfW);
    vec3 ln = normalize(cross(B, T));
    if (ln.x * np.x + ln.y * np.y < 0.0) ln = -ln;
    p = tilt(rotY(lp, aPet.y + iCenter.w)) * bk;
    n = tilt(rotY(ln, aPet.y + iCenter.w));
    uvv = vec2(mix(uAtlasL.x, uAtlasL.z, 0.5 + s * uFrame.x), mix(uAtlasL.y, uAtlasL.w, mix(uFrame.z, uFrame.w, l)));
  } else if (part < 2.5) {
    // couronne d'étamines : se dresse et s'évase quand le verticille intérieur s'écarte, frémit au rappel
    o = spring(iBloom.x - 0.8, 3.8, 0.6) * iAnim.y + breath(0.15) * 0.12;
    float rb = 0.012, rt = mix(0.014, 0.046, o), hh = mix(0.02, 0.072, o);
    float r = mix(rb, rt, l);
    vec3 d = vec3(cos(aPet.y + iCenter.w), 0.0, sin(aPet.y + iCenter.w));
    p = tilt(d * r + vec3(0.0, 0.006 + l * hh, 0.0)) * bk;
    n = tilt(normalize(d * hh * 0.4 + vec3(0.0, 1.0, 0.0) * (rt - rb) + d * 0.02));
    uvv = vec2(mix(uAtlasS.x, uAtlasS.z, aPet.z), mix(uAtlasS.y, uAtlasS.w, l));
  } else if (part > 3.5) {
    // cœur doré (carpelle), petit dôme
    o = spring(iBloom.x - 0.85, 3.8, 0.6) * iAnim.y;
    vec3 d = vec3(cos(aPet.y), 0.0, sin(aPet.y));
    p = tilt(d * 0.0135 * l + vec3(0.0, 0.016 - 0.006 * l, 0.0)) * bk;
    n = tilt(normalize(d * 0.5 * l + vec3(0.0, 1.0, 0.0)));
  } else {
    // feuille fendue : se déroule sur l'eau dès que le bouton a percé (bords roulés qui s'aplatissent, quart de tour)
    o = iAnim.z;
    float oc = clamp(o, 0.0, 1.0);
    float ang = iPad.w + (1.0 - oc) * 0.7 + ${PAD_NOTCH.toFixed(3)} * 0.5 + (6.28318 - ${PAD_NOTCH.toFixed(3)}) * aPet.y;
    float R = iPad.z * sc * ${LILY_PAD_K.toFixed(3)} * mix(0.25, 1.0, o);
    float up = smoothstep(0.55, 1.0, l) * 0.004 * (1.0 + (1.0 - oc) * 6.0);
    vec2 cxz = vec2(iCenter.x, iCenter.y) + iPad.xy * sc * ${LILY_PAD_K.toFixed(3)};
    float circ = l > 0.99 ? 1.02 : 1.0;                                // polygone circonscrit (16 côtés)
    p = vec3(cos(ang), 0.0, sin(ang)) * l * R * circ;
    vec3 Wp = vec3(cxz.x, uWaterY + iTilt.w * 0.8 + 0.0012, cxz.y) + p + vec3(0.0, up - (1.0 - oc) * 0.006, 0.0);
    vW = Wp;
    vN = normalize(vec3(-cos(ang) * up * 3.0, 1.0, -sin(ang) * up * 3.0));
    vUv = vec2(cos(ang - iPad.w - (1.0 - oc) * 0.7), sin(ang - iPad.w - (1.0 - oc) * 0.7)) * l * circ;   // repère de la feuille, rayon 1 = bord
    vP = vec4(part, l, aPet.y, 0.0);
    vOpen = oc;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(Wp, 1.0);
    return;
  }
  vW = C + p;
  vN = n;
  vUv = uvv;
  vP = vec4(part, l, s, aPet.z);
  vOpen = o;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
}
`
const LILY_FS = /* glsl */ `
${GLSL_LIGHT}
uniform sampler2D uPetals;
uniform vec3 uPadA;
uniform vec3 uPadB;
uniform vec3 uGold;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vP;
varying float vOpen;
varying float vGlow;
varying float vWet;
void main() {
  float part = vP.x;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  vec3 col;
  float a = 1.0;
  if (part < 1.5) {
    vec4 tex = texture2D(uPetals, vUv);
    // nervures adoucies (le rendu approuvé les montre à peine) : mélange avec un niveau de mip plus flou
    tex.rgb = mix(texture2D(uPetals, vUv, 2.5).rgb, tex.rgb, 0.45);
    // bouton : la base des pétales est pleine (enveloppée par les sépales), pas de couronne de pointes
    float bud = 1.0 - clamp(vOpen, 0.0, 1.0);
    float ta = max(tex.a, bud * (1.0 - smoothstep(0.12, 0.4, vP.y)));
    if (ta < 0.4) discard;
    a = smoothstep(0.4, 0.62, ta);
    // bleu plus dense que l'albédo brut (le rendu approuvé : translucidité qui sature) ; base nacrée
    vec3 alb = pow(tex.rgb, vec3(1.75, 1.75, 1.5));                    // pervenche, jamais bleu électrique
    alb *= 0.92 + 0.16 * vP.w;                                          // chaque pétale a sa valeur
    alb = mix(alb, alb * 1.06 + vec3(0.02, 0.025, 0.03), part);         // verticille intérieur un peu plus clair
    float sep = 0.0;
    if (!gl_FrontFacing) {
      alb *= vec3(0.78, 0.84, 1.0);                                     // revers plus soutenu
      // sépales du bouton (revers du verticille extérieur) : vert bronze moucheté, qui s'efface à l'ouverture
      sep = (1.0 - part) * bud * (1.0 - smoothstep(0.45, 0.95, vP.y));
      vec3 sepal = vec3(0.05, 0.09, 0.035) * (0.7 + 0.6 * h12(floor(vUv * vec2(90.0, 160.0))));
      alb = mix(alb, sepal, sep);
    }
    alb *= mix(0.62, 1.0, smoothstep(0.0, 0.45, vP.y));                 // ombre au cœur de la fleur
    col = petalLight(alb, N, V, 1.25, 0.5, 0.08);
    // translucidité : les bords et les pointes (plus fins) s'allument quand le pétale se présente de chant
    float thin = 0.55 + 0.45 * abs(vP.z) + 0.3 * vP.y;
    float rim = pow(1.0 - abs(dot(N, V)), 2.2) * (1.0 - sep);
    col += mix(vec3(0.62, 0.74, 1.0), alb * 1.8, 0.65) * rim * thin * 0.22;
    // juste sorti de l'eau : pétales mouillés, reflets vifs du soleil qui sèchent en quelques secondes
    vec3 Hh = normalize(uSunDir + V);
    col += uSunCol * pow(max(dot(N, Hh), 0.0), 70.0) * (0.15 + 0.9 * vWet);
    // lueur intérieure : la base s'illumine doucement (blanc bleuté)
    float g = 0.16 * (1.0 - 0.8 * sep);
    col += mix(vec3(0.62, 0.74, 1.0), alb, smoothstep(0.0, 0.8, vP.y)) * g * 0.5;
    // respiration (rappel, naissance) : une lumière cobalt monte du cœur ; les clairs sont tirés vers la pervenche
    // au lieu de s'additionner → la fleur s'allume en bleu, jamais en blanc
    float gp = vGlow * (1.0 - 0.8 * sep);
    vec3 inner = vec3(0.22, 0.40, 1.0) * (1.0 - 0.55 * smoothstep(0.1, 0.9, vP.y));
    col = col * (1.0 - 0.3 * gp) + inner * gp * 0.5;
  } else if (part < 2.5) {
    vec4 tex = texture2D(uPetals, vUv);
    if (tex.a < 0.4) discard;
    a = smoothstep(0.4, 0.62, tex.a);
    vec3 alb = tex.rgb * vec3(1.12, 1.02, 0.82);
    col = petalLight(alb, N, V, 0.35, 0.45, 0.5);
    // pollen : scintillement d'or (les anthères accrochent le soleil), plus vif au rappel
    float tw = h12(floor(vUv * 180.0) + floor(uTime * 6.0));
    col += uSunCol * vec3(1.0, 0.84, 0.52) * pow(tw, 12.0) * (1.1 + 1.6 * vGlow) * vP.y;   // or chaud, jamais blanc
    vec3 Hs = normalize(uSunDir + V);
    col += uSunCol * vec3(1.0, 0.85, 0.5) * pow(max(dot(N, Hs), 0.0), 24.0) * 0.6 * vP.y;
    col += alb * (0.36 + vGlow * 0.7);                                   // l'or des étamines rayonne un peu
  } else if (part > 3.5) {
    // carpelle : dôme jaune d'or, stries rayonnantes du stigmate
    vec3 alb = mix(uGold, vec3(0.98, 0.82, 0.32), 0.5) * (0.85 + 0.15 * vP.y);
    col = petalLight(alb, N, V, 0.2, 0.5, 0.35) + alb * (0.15 + vGlow * 0.5);
  } else {
    // feuille : vert franc (rendu approuvé), nervures rayonnantes, bord humide, cercle exact découpé
    float rr = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    float edge = 0.985 + 0.018 * sin(ang * 5.0 + 1.3);
    float fw = fwidth(rr) * 1.5 + 1e-4;
    float cut = 1.0 - smoothstep(edge - fw, edge, rr);
    if (cut < 0.01) discard;
    float vein = pow(abs(cos(ang * 11.0)), 14.0) * smoothstep(0.08, 0.3, rr) * (1.0 - smoothstep(0.82, 0.96, rr));
    vec3 alb = mix(uPadA, uPadB, 0.45 + 0.25 * sin(ang * 2.0 + 0.7) * rr);
    alb *= 1.0 + 0.16 * vein;
    alb *= 0.9 + 0.1 * smoothstep(0.0, 0.4, rr);
    alb *= 1.0 - 0.28 * smoothstep(edge - 0.08, edge, rr);
    float ndl = max(dot(N, uSunDir), 0.0);
    col = alb * (uSkyZen * 0.42 + uSunCol * ndl * 0.8);
    float F = 0.045 + 0.2 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    vec3 R = reflect(-V, N);
    col = mix(col, mix(uSkyHor, uSkyZen, clamp(R.y, 0.0, 1.0)), F);
    vec3 H = normalize(uSunDir + V);
    col += uSunCol * pow(max(dot(N, H), 0.0), 80.0) * 0.12;
    a = smoothstep(0.0, 0.35, vOpen) * cut;
  }
  vec4 o = underwater(col, vW.y);
  a *= o.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(linearToOutputTexel(vec4(o.rgb, 1.0)).rgb * a, a);
}
`

// ---------------------------------------------------------------------------------------------
// 3) Ambre — grains chauds (repère marqueur) : un courant organique (champ tourbillonnaire) qui quitte les battants
//    et s'enroule dans le col. Chaque grain est une traînée orientée selon sa vitesse (flou de mouvement doux).
// ---------------------------------------------------------------------------------------------
const MOTE_VS = /* glsl */ `
attribute vec3 iP;      // position (repère marqueur)
attribute vec3 iT;      // traînée : position − position ≈ 70 ms plus tôt
attribute vec4 iA;      // alpha, rayon (unités marqueur), chaleur (0..1), graine
varying vec3 vQ;        // x le long (en rayons), y en travers, demi-longueur (en rayons)
varying vec4 vA;
void main() {
  vec4 mp = modelViewMatrix * vec4(iP, 1.0);
  vec3 tl = (modelViewMatrix * vec4(iP - iT, 1.0)).xyz;
  vec3 n = normalize(mp.xyz);
  vec3 d = mp.xyz - tl;
  d -= n * dot(d, n);
  float L = length(d);
  vec3 ax = L > 1e-6 ? d / L : vec3(1.0, 0.0, 0.0);
  vec3 sd = normalize(cross(n, ax));
  float w = iA.x > 0.001 ? iA.y : 0.0;
  float hl = 0.5 * L / max(iA.y, 1e-6);
  vec3 c = mp.xyz - ax * (0.5 * L);
  vec3 p = c + ax * position.x * (0.5 * L + w) + sd * position.y * w;
  vQ = vec3(position.x * (hl + 1.0), position.y, hl);
  vA = iA;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`
const MOTE_FS = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uHot;
varying vec3 vQ;
varying vec4 vA;
void main() {
  float x = vQ.x, y = vQ.y, hl = vQ.z;
  float dx = max(abs(x) - hl, 0.0);
  float d2 = dx * dx + y * y;
  float core = exp(-d2 * 10.0);
  float halo = exp(-d2 * 2.4) * 0.42;
  float along = mix(0.3, 1.0, smoothstep(-hl - 0.5, hl + 0.5, x));   // la tête du grain mène, la traînée s'éteint
  float k = (core + halo) * along * vA.x;
  if (k < 0.004) discard;
  vec3 col = mix(uCol, uHot, clamp(core * (0.3 + 0.5 * vA.z), 0.0, 1.0));
  // prémultiplié, en partie couvrant : reste ambré sur le ciel rose comme sur le bleu
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb * k, clamp(k * 0.62, 0.0, 1.0));
}
`

// ---------------------------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------------------------
export function createNotesFX({
  gardenRoot, anchor, gardenMeta, textures = {}, quality = 'high', sunDir, water = null, pool = {}, seed = 11,
  pads = null, staticFlowers = null,
} = {}) {
  const padsOpt = pads, staticFlowersOpt = staticFlowers
  const RO = PB_RENDER_ORDER
  const P = { ...DEFAULT_POOL, ...pool }
  const rng = mulberry32(seed)
  let Q = QUALITY[quality] || QUALITY.high
  const ownTextures = []
  let petalTex = textures.petals || null
  if (!petalTex) { petalTex = makeFallbackPetalAtlas(); ownTextures.push(petalTex) }

  const sun = new THREE.Vector3(...(sunDir ? [sunDir.x, sunDir.y, sunDir.z] : DEFAULT_SUN)).normalize()
  const U = {
    uCam: { value: new THREE.Vector3(0, 1.6, 6.6) },
    uSunDir: { value: sun },
    uSunCol: { value: new THREE.Color().setRGB(1.0, 0.86, 0.68) },
    uSkyZen: { value: new THREE.Color('#8fb4e0') },
    uSkyHor: { value: new THREE.Color('#efe6d8') },
    uScatter: { value: new THREE.Color('#0a1a44') },
    uWaterY: { value: P.waterY },
    uTime: { value: 0 },
    uPetals: { value: petalTex },
  }

  // ---- néroli ---------------------------------------------------------------------------------
  // GARDEN XL (SPEC garden_xl §2) : une pluie de fleurs d'oranger sur TOUT le bassin, quelques-unes sur la margelle et sur
  // le sol devant le bassin. fire() calcule un plan d'atterrissage (zones de PB_CFG.notes.neroli : eau, bande proche,
  // quatre bandes de margelle, sol ; échantillonnage stratifié jitteré avec espacement minimal ; une fleur qui tombe sur une
  // feuille statique s'y pose ; disques des nymphéas et fleurs statiques évités), puis un départ concentré au début (loi de
  // puissance : la moitié est partie à 1 s) — les premières naissent déjà dans le champ, au-dessus du flacon.
  // Chute « feuille morte » : descente à vitesse limite (départ du repos, arrivée amortie), balancier latéral (la fleur
  // s'incline dans le sens de sa course, avec un temps de retard), spirale qui se resserre, souffle d'air commun ; les
  // pétales détachés culbutent puis se mettent à plat avant de toucher l'eau.
  // Posées — eau : léger enfoncement, dérive avec l'élan de la chute, roulis sur la houle, rotation lente ;
  //          pierre (margelle, sol) : petit rebond, glissade freinée (≤ 2 cm), à plat, immobile — jamais de houle ;
  //          feuille : posée sur la feuille (suit sa houle), sans dérive.
  // Un seul InstancedMesh (MAX_BLOSSOMS × 48 tris), ordre 7.5, aucun programme de plus. Zéro allocation par image :
  // tout (plan, occupation, lots) est préalloué ici.
  const blossomGeo = buildBlossomGeometry()
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOSSOMS * 4), 4)
  aB.setUsage(THREE.DynamicDrawUsage)
  blossomGeo.setAttribute('aB', aB)
  const aK = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOSSOMS * 4), 4)
  aK.setUsage(THREE.DynamicDrawUsage)
  blossomGeo.setAttribute('aK', aK)
  const neroliMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uPetalC: { value: blossomGeo.userData.petalC } }, vertexShader: NEROLI_VS, fragmentShader: NEROLI_FS,
    side: THREE.DoubleSide, transparent: true, depthWrite: true, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const neroliMesh = new THREE.InstancedMesh(blossomGeo, neroliMat, MAX_BLOSSOMS)
  neroliMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  neroliMesh.name = 'PB_NeroliBlossoms'
  neroliMesh.renderOrder = RO.neroli
  neroliMesh.frustumCulled = false
  neroliMesh.count = 0
  neroliMesh.visible = false
  if (gardenRoot) gardenRoot.add(neroliMesh)

  // surfaces d'atterrissage (b.surf) et leurs noms (4e argument de onLand)
  const SURF_WATER = 0, SURF_COPING = 1, SURF_FLOOR = 2, SURF_PAD = 3
  const SURF_NAMES = ['water', 'coping', 'floor', 'pad']

  const B = Array.from({ length: MAX_BLOSSOMS }, () => ({
    state: 0,           // 0 libre, 1 attente, 2 chute, 3 posée (eau / feuille), 4 s'évapore, 5 posée sur la pierre
    kind: 0,            // 0 fleur, 1 pétale détaché
    surf: 0, ys: 0, padI: -1,   // surface visée (SURF_*), hauteur de repos (pierre), feuille statique (index)
    birth: 0, t: 0, delay: 0, T: 3.4, y0: 2.6, xS: 0, zS: 0, xL: 0, zL: 0, appear: 0.3,
    R0: 0.15, om: 2.5, ph: 0, swA: 0.1, swW: 2.4, swPh: 0, swDx: 1, swDz: 0, wob: 0.2, face: 0.4, prec: 2, psi: 0,
    spin: 0, spinV: 1, scale: 1, seed: 0, batch: 0,
    tum: 0, tumW: 6, tumAx: 0,
    x: 0, y: 0, z: 0, px: 0, pz: 0, has: false, tx: 0, tz: 0, vxF: 0, vzF: 0,
    vx: 0, vz: 0, yaw: 0, yawV: 0, land: 0, ltx: 0, ltz: 0, fade: 0, fadeAt: 0, survivor: false, flash: 0, glint: 0,
    sv: 0, sdx: 0, sdz: 0,      // glissade sur la pierre : vitesse (m/s), direction
    ox: 0, oy: 0,       // écart en vol (x, hauteur) : deux fleurs voisines à l'écran s'écartent doucement l'une de l'autre
    bob: -1, bobA: 0, bdx: 1, bdz: 0, rOff: 0, bobD: -1,   // onde d'un nymphéa : temps depuis son passage, amplitude, direction, rayon propre, disque
    pd0: -1, pr: 0, pv: 0, pi: -1,                         // écartement : distance quand l'onde l'a prise (−1 : libre), rayon, vitesse, disque porteur
  }))

  // ---- réglages (PB_CFG.notes.neroli, valeurs du SPEC garden_xl §7 en repli) ----
  const NCFG = PB_CFG.notes.neroli || {}
  const NDEF = {
    tiers: {
      high: { flowers: 78, petals: 14, reprise: 20, reprisePetals: 3, survivors: 12, inView: 10 },
      medium: { flowers: 54, petals: 10, reprise: 14, reprisePetals: 2, survivors: 9, inView: 7 },
      low: { flowers: 34, petals: 6, reprise: 9, reprisePetals: 2, survivors: 6, inView: 5 },
    },
    split: { water: 0.77, floor: 0.06 },
    water: { rect: [-0.73, 0.73, -6.23, -2.05], near: [-0.73, 0.73, -2.05, -1.82], nearShare: 0.08, leftX: -0.10, leftShare: 0.55, spacing: 0.16, petalSpacing: 0.10, flowerClear: 0.13, budClear: 0.09, padEdge: 0.045 },
    coping: { y: 0.083, width: 0.22, spacing: 0.18, strips: [[-0.62, 0.55, -1.66, -1.52, 0.38], [-0.99, -0.83, -6.20, -3.30, 0.30], [-0.70, 0.70, -6.48, -6.34, 0.17], [0.83, 0.99, -6.20, -2.00, 0.15]] },
    floor: { y: 0.003, rect: [-0.55, 0.50, -1.42, -1.12], spacing: 0.20, zMax: -1.40, zMin: -0.50 },
    launch: { dur: 3.6, power: 2.4, jitter: 0.12, inViewY: [2.1, 2.7], inViewDelay: 0.35, inViewFall: [1.6, 2.1], inViewX: 0.5, inViewZ: [-5.5, -2.3], spawnY: [2.9, 3.5], appear: 0.30 },
    fall: [2.5, 3.3], petalFall: [2.8, 3.5], scale: [1.25, 1.75], farBoost: 0.15, petalScale: [0.95, 1.25],
    reprise: { water: [-0.73, 0.60, -4.80, -2.20], copingShare: 0.15, spawnY: [2.3, 2.9], dur: 1.4, fall: [2.0, 2.6], petalFall: [2.3, 3.0], survivors: 2 },
    stone: { hop: 0.006, hopT: 0.20, hop2: 0.0015, hop2T: 0.10, slideK: 0.3, slideMax: 0.18, friction: 0.9, edge: 0.03, flash: 0.6 },
    sepLanded: 0.13, wallMargin: 0.09, fadeAfter: 9, extraSurvivors: 2, stoneSurvivors: 2,
  }
  const nget = (k) => (NCFG[k] !== undefined ? NCFG[k] : NDEF[k])
  const NW = { ...NDEF.water, ...(NCFG.water || {}) }, NCOP = { ...NDEF.coping, ...(NCFG.coping || {}) }, NFL = { ...NDEF.floor, ...(NCFG.floor || {}) }
  const NL = { ...NDEF.launch, ...(NCFG.launch || {}) }, NREP = { ...NDEF.reprise, ...(NCFG.reprise || {}) }, NST = { ...NDEF.stone, ...(NCFG.stone || {}) }
  const NSPLIT = { ...NDEF.split, ...(NCFG.split || {}) }
  const NTIERS = nget('tiers')
  const N_FALL = nget('fall'), N_PFALL = nget('petalFall'), N_SCALE = nget('scale'), N_PSCALE = nget('petalScale'), N_FARB = nget('farBoost')
  const N_SEP = nget('sepLanded'), N_SEP2 = N_SEP * N_SEP, N_WALL = nget('wallMargin'), N_FADE = nget('fadeAfter')
  const N_XSURV = nget('extraSurvivors'), N_STSURV = nget('stoneSurvivors')
  // margelle : anneau entre le bord du bassin (intérieur) et le bord extérieur (largeur NCOP.width)
  const COP_IN = { x0: P.x0, x1: P.x1, z0: P.z0, z1: P.z1 }
  const COP_OUT = { x0: P.x0 - NCOP.width, x1: P.x1 + NCOP.width, z0: P.z0 - NCOP.width, z1: P.z1 + NCOP.width }
  // lancers (fire / reprise) : tables de paramètres préallouées
  const LAUNCH_FIRE = { dur: NL.dur, power: NL.power, jitter: NL.jitter, spawnY: NL.spawnY, fall: N_FALL, petalFall: N_PFALL }
  const LAUNCH_REP = { dur: NREP.dur, power: NL.power, jitter: NL.jitter, spawnY: NREP.spawnY, fall: NREP.fall, petalFall: NREP.petalFall }
  function tierNow() {
    let name = 'high'
    for (const k in QUALITY) if (QUALITY[k] === Q) { name = k; break }
    return NTIERS[name] || NTIERS.high
  }

  // feuilles et fleurs statiques de gardenFx (options pads / staticFlowers, sinon water.debug ; lecture protégée)
  const EMPTY = []
  function padsList() {
    if (padsOpt) return padsOpt
    try { const p = water && water.debug && water.debug.pads; return p || EMPTY } catch { return EMPTY }
  }
  function flowersList() {
    if (staticFlowersOpt) return staticFlowersOpt
    try { const f = water && water.debug && water.debug.flowers; return f || EMPTY } catch { return EMPTY }
  }

  // ---- disques gardés libres par les nymphéas actifs (SPEC §2.5, §3.4) --------------------------------------------------
  // Table remplie à chaque image (et à chaque fire / reprise) par collectDiscs() : c'est le SEUL point de contact entre les
  // fleurs et les nymphéas. uid : un par lotus et par montée (une onde ne fait danser une fleur qu'une fois).
  // Une entrée par lotus actif du champ, avec ses propres x, z, clearR, front, wave et t (t < 0 : la vague ne l'a pas encore
  // atteint ; son disque est déjà réservé pour le plan d'atterrissage et les fleurs en vol, mais il n'écarte encore rien).
  const MAX_DISCS = 8
  const PD = Array.from({ length: MAX_DISCS }, () => ({ uid: -1, x: 0, z: 0, clearR: 0, front: 0, wave: 0, t: 0 }))
  let nPD = 0, lilySerial = 0
  function collectDiscs() {
    nPD = 0
    if (!FIELD.active) return
    for (let k = 0; k < FIELD.n && nPD < MAX_DISCS; k++) {
      const L = LOT[k]
      if (!L.active || !(L.clearR > 0)) continue
      const D = PD[nPD++], wait = L.phase === 'wait'
      D.uid = L.uid; D.x = L.x; D.z = L.z; D.clearR = L.clearR; D.front = wait ? 0 : L.front; D.wave = wait ? -1 : L.wave; D.t = L.t
    }
  }

  // ---- lots (fire / reprise) : anneau préalloué ----
  const NBATCH = 8
  const NB = Array.from({ length: NBATCH }, () => ({ id: 0, t0: 0, live: false, cap: 0 }))
  let landOrder = 0, batchId = 0, onLandCb = null
  function newBatch(cap) {
    let s = -1, oldest = Infinity
    for (let k = 0; k < NBATCH; k++) { if (!NB[k].live) { s = k; break } if (NB[k].t0 < oldest) { oldest = NB[k].t0; s = k } }
    const bt = NB[s]
    bt.id = ++batchId; bt.t0 = time; bt.live = true; bt.cap = cap
    return bt.id
  }

  const mat4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion()
  const axis = new THREE.Vector3(), vpos = new THREE.Vector3(), vscl = new THREE.Vector3(), YAX = new THREE.Vector3(0, 1, 0)
  const landP = new THREE.Vector3()
  let time = 0

  // ---- plan d'atterrissage (préalloué) ----
  // LX/LZ : point visé ; LSF : surface ; LPAD : feuille ; LKIND : 0 fleur / 1 pétale ; ORD : ordre de départ des fleurs
  const LX = new Float32Array(MAX_BLOSSOMS), LZ = new Float32Array(MAX_BLOSSOMS)
  const LSF = new Uint8Array(MAX_BLOSSOMS), LPAD = new Int16Array(MAX_BLOSSOMS), LKIND = new Uint8Array(MAX_BLOSSOMS)
  const ORD = new Int16Array(MAX_BLOSSOMS), USED = new Uint8Array(MAX_BLOSSOMS), DEL = new Float32Array(MAX_BLOSSOMS)
  // occupation pour l'espacement : points du plan + fleurs déjà posées (classe 0 eau/feuille, 1 margelle, 2 sol)
  const OCC_MAX = MAX_BLOSSOMS * 2
  const OX = new Float32Array(OCC_MAX), OZ = new Float32Array(OCC_MAX), OC = new Uint8Array(OCC_MAX)
  let nPlan = 0, nOcc = 0
  const cand = { x: 0, z: 0, surf: 0, pad: -1, score: 0 }, best = { x: 0, z: 0, surf: 0, pad: -1, score: -1e9 }
  const fireRes = { n: 0, petals: 0, lastLandAt: 0, water: 0, coping: 0, floor: 0, pad: 0 }
  const repRes = { n: 0, petals: 0, lastLandAt: 0, water: 0, coping: 0, floor: 0, pad: 0 }

  function beginPlan() {
    nPlan = 0; nOcc = 0
    // les fleurs déjà posées (survivantes, reprise pendant une pluie) occupent leur place
    for (let i = 0; i < MAX_BLOSSOMS && nOcc < OCC_MAX; i++) {
      const b = B[i]
      if (b.state === 0 || b.kind !== 0) continue
      const x = b.state >= 3 ? b.x : b.xL, z = b.state >= 3 ? b.z : b.zL
      OX[nOcc] = x; OZ[nOcc] = z; OC[nOcc] = b.surf === SURF_COPING ? 1 : b.surf === SURF_FLOOR ? 2 : 0; nOcc++
    }
  }
  // note un point candidat : contraintes dures (disque d'un nymphéa, fleur statique, bord d'une feuille) + espacement
  function evalCand(x, z, cls, sp) {
    let pen = 0, surf = cls === 1 ? SURF_COPING : cls === 2 ? SURF_FLOOR : SURF_WATER, pad = -1
    if (cls === 0) {
      for (let k = 0; k < nPD; k++) { const D = PD[k]; if (Math.hypot(x - D.x, z - D.z) < D.clearR + 0.03) pen += 10 }
      const fl = flowersList()
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i], r = f.tilt > 0.5 ? NW.budClear : NW.flowerClear
        if (Math.abs(x - f.x) < r && Math.abs(z - f.z) < r && Math.hypot(x - f.x, z - f.z) < r) pen += 5
      }
      const pd = padsList()
      let onY = -1, edge = false
      for (let i = 0; i < pd.length; i++) {
        const p = pd[i], d = Math.hypot(x - p.x, z - p.z)
        if (d < 0.85 * p.r) { const py = p.y || 0; if (py > onY) { onY = py; pad = i } } else if (d < p.r + NW.padEdge) edge = true
      }
      if (pad >= 0) surf = SURF_PAD; else if (edge) pen += 3
    }
    let dmin = 9
    for (let i = 0; i < nOcc; i++) {
      if (OC[i] !== cls) continue
      const dx = x - OX[i]
      if (dx > dmin || dx < -dmin) continue
      const d = Math.hypot(dx, z - OZ[i])
      if (d < dmin) dmin = d
    }
    cand.x = x; cand.z = z; cand.surf = surf; cand.pad = pad
    cand.score = Math.min(dmin / sp, 1.5) - pen
    return pen === 0 && dmin >= sp
  }
  // k points dans [x0, x1] × [z0, z1] : grille jitterée (une cellule par point, réparties sur la grille), 12 essais
  // au plus (6 dans la cellule, 6 dans toute la zone), sinon le meilleur essai
  function sampleZone(k, x0, x1, z0, z1, cls, sp, kind) {
    if (k <= 0) return
    const w = x1 - x0, h = z1 - z0
    const cols = Math.max(1, Math.round(Math.sqrt((k * w) / Math.max(0.01, h)))), rows = Math.max(1, Math.ceil(k / cols))
    const nc = cols * rows
    for (let i = 0; i < k && nPlan < MAX_BLOSSOMS; i++) {
      const ci = Math.min(nc - 1, Math.floor(((i + rng()) * nc) / k))
      const cx = ci % cols, cz = (ci / cols) | 0
      best.score = -1e9
      for (let t = 0; t < 12; t++) {
        const x = t < 6 ? x0 + ((cx + 0.08 + 0.84 * rng()) / cols) * w : x0 + rng() * w
        const z = t < 6 ? z0 + ((cz + 0.08 + 0.84 * rng()) / rows) * h : z0 + rng() * h
        const ok = evalCand(x, z, cls, sp)
        if (ok || cand.score > best.score) { best.x = cand.x; best.z = cand.z; best.surf = cand.surf; best.pad = cand.pad; best.score = cand.score }
        if (ok) break
      }
      LX[nPlan] = best.x; LZ[nPlan] = best.z; LSF[nPlan] = best.surf; LPAD[nPlan] = best.pad; LKIND[nPlan] = kind; nPlan++
      if (nOcc < OCC_MAX) { OX[nOcc] = best.x; OZ[nOcc] = best.z; OC[nOcc] = cls; nOcc++ }
    }
  }
  // répartition d'un total selon des parts (plus forts restes) : écrit dans SHARE_N
  const SHARE_N = new Int16Array(8)
  function apportion(total, strips) {
    let sum = 0, s = 0
    for (let i = 0; i < strips.length; i++) s += strips[i][4]
    for (let i = 0; i < strips.length; i++) { SHARE_N[i] = Math.floor((total * strips[i][4]) / s); sum += SHARE_N[i] }
    while (sum < total) {
      let bi = 0, br = -1
      for (let i = 0; i < strips.length; i++) { const r = (total * strips[i][4]) / s - SHARE_N[i]; if (r > br) { br = r; bi = i } }
      SHARE_N[bi]++; sum++
    }
  }
  // ordre de départ des fleurs [0, nF) : d'abord `inView` points étalés (eau / feuille, x < 0,5, z dans la bande lisible),
  // puis chaque fleur part loin (surtout en x, l'écart à l'écran) des deux précédentes → jamais de grappe
  const ordDist = (a, b) => Math.abs(LX[a] - LX[b]) + 0.45 * Math.abs(LZ[a] - LZ[b])
  function orderPlan(nF, inView) {
    for (let j = 0; j < nF; j++) USED[j] = 0
    let k = 0
    for (; k < inView; k++) {
      let bi = -1, bs = -1
      for (let j = 0; j < nF; j++) {
        if (USED[j] || (LSF[j] !== SURF_WATER && LSF[j] !== SURF_PAD) || LX[j] >= NL.inViewX || LZ[j] < NL.inViewZ[0] || LZ[j] > NL.inViewZ[1]) continue
        let dmin = 9
        for (let m = 0; m < k; m++) { const d = ordDist(j, ORD[m]); if (d < dmin) dmin = d }
        const s = dmin + rng() * 0.15
        if (s > bs) { bs = s; bi = j }
      }
      if (bi < 0) break
      USED[bi] = 1; ORD[k] = bi
    }
    const nIV = k
    for (; k < nF; k++) {
      let bi = -1, bs = -1
      for (let j = 0; j < nF; j++) {
        if (USED[j]) continue
        let s = rng() * 0.06
        if (k > 0) s += Math.min(ordDist(j, ORD[k - 1]), k > 1 ? 1.5 * ordDist(j, ORD[k - 2]) : 9)
        if (s > bs) { bs = s; bi = j }
      }
      USED[bi] = 1; ORD[k] = bi
    }
    return nIV
  }

  function freeSlot() {
    for (let i = 0; i < MAX_BLOSSOMS; i++) if (B[i].state === 0) return i
    // recycle d'abord une fleur qui s'évapore, puis un pétale posé, la plus ancienne fleur posée, une fleur en attente,
    // et en tout dernier une fleur en vol ; jamais une survivante
    let best = -1, bt = Infinity
    for (let i = 0; i < MAX_BLOSSOMS; i++) {
      const b = B[i]
      if (b.survivor) continue
      const st = b.state
      const key = b.birth + (st === 4 ? -1e7 : st >= 3 ? (b.kind === 1 ? -1e6 : -1e5) : st === 1 ? -1e4 : 0)
      if (key < bt) { bt = key; best = i }
    }
    return best
  }

  const urand = (r) => r[0] + rng() * (r[1] - r[0])
  // lance le plan : nF fleurs (ordre ORD, les nIV premières déjà dans le champ) puis nP pétales ; renvoie la dernière
  // arrivée (s depuis maintenant)
  function launchPlan(nF, nP, nIV, batch, L) {
    let last = 0
    const tot = nF + nP
    for (let k = 0; k < tot; k++) {
      const petal = k >= nF
      const j = petal ? k : ORD[k]
      const i = freeSlot()
      if (i < 0) break
      const b = B[i]
      b.kind = petal ? 1 : 0
      b.surf = LSF[j]; b.padI = LPAD[j]
      b.ys = b.surf === SURF_COPING ? NCOP.y : b.surf === SURF_FLOOR ? NFL.y : 0
      b.xL = LX[j]; b.zL = LZ[j]
      if (b.surf === SURF_WATER) {
        b.xL = clamp(b.xL, P.x0 + N_WALL, P.x1 - N_WALL); b.zL = clamp(b.zL, P.z0 + N_WALL, P.z1 - N_WALL)
      }
      // cadence : loi de puissance (départ concentré au début) ; les premières naissent dans le champ, au-dessus du flacon
      if (!petal) {
        if (k < nIV) { b.delay = rng() * NL.inViewDelay; b.y0 = urand(NL.inViewY); b.T = urand(NL.inViewFall) } else {
          // u = k / (nF − 1) : la dernière part à L.dur pile ; elle tombe le plus lentement → dernière arrivée ≈ L.dur + chute
          // max, la même à tous les paliers (l'aparté du directeur se cale dessus)
          b.delay = Math.max(0, L.dur * (1 - Math.pow(1 - k / Math.max(1, nF - 1), 1 / L.power)) + (rng() - 0.5) * L.jitter)
          b.y0 = urand(L.spawnY); b.T = k === nF - 1 ? L.fall[1] : urand(L.fall)
        }
        DEL[k] = b.delay
      } else {
        const fk = Math.min(nF - 1, Math.floor(((k - nF) * nF) / Math.max(1, nP)))
        b.delay = DEL[fk] + 0.25; b.y0 = urand(L.spawnY); b.T = urand(L.petalFall)
      }
      b.appear = NL.appear
      last = Math.max(last, b.delay + b.T)
      // départ décalé dans le vent
      const da = rng() * TAU, dr = 0.12 + rng() * 0.22
      b.xS = b.xL + Math.cos(da) * dr + 0.12; b.zS = b.zL + Math.sin(da) * dr * 0.6
      b.R0 = (petal ? 0.06 : 0.07) + rng() * 0.1
      b.om = (1.4 + rng() * 1.2) * (rng() < 0.5 ? -1 : 1)
      b.ph = rng() * TAU
      b.swA = (petal ? 0.12 : 0.07) + rng() * 0.08
      b.swW = (petal ? 2.6 : 2.0) + rng() * 0.9
      b.swPh = rng() * TAU
      const sa = rng() * TAU
      b.swDx = Math.cos(sa); b.swDz = Math.sin(sa) * 0.7
      b.wob = 0.14 + rng() * 0.22
      b.face = 0.75 + rng() * 0.35
      b.prec = (1.2 + rng() * 1.4) * (rng() < 0.5 ? -1 : 1)
      b.psi = rng() * TAU
      b.spin = rng() * TAU
      b.spinV = (0.5 + rng() * 1.3) * (rng() < 0.5 ? -1 : 1) * (petal ? 1.8 : 1)
      b.tum = rng() * TAU; b.tumW = (5 + rng() * 4) * (rng() < 0.5 ? -1 : 1); b.tumAx = rng() * TAU
      // fleurs ×1,25–1,75 (lisibles au téléphone), les plus lointaines un peu plus grandes (≥ 10 px)
      b.scale = petal ? urand(N_PSCALE) : urand(N_SCALE) * (1 + N_FARB * smooth((-b.zL - 2) / 4))
      b.seed = rng()
      b.batch = batch
      b.t = 0; b.vx = 0; b.vz = 0; b.land = 0; b.fade = 0; b.fadeAt = 0; b.survivor = false; b.flash = 0; b.glint = 0
      b.has = false; b.tx = 0; b.tz = 0; b.vxF = 0; b.vzF = 0; b.yawV = 0; b.ltx = 0; b.ltz = 0; b.sv = 0; b.sdx = 0; b.sdz = 0
      b.ox = 0; b.oy = 0; b.bob = -1; b.bobA = 0; b.bobD = -1; b.rOff = rng() * 0.04; b.pd0 = -1; b.pi = -1
      b.x = b.xS; b.y = b.y0; b.z = b.zS
      b.birth = time
      b.state = 1
    }
    return last
  }
  function countPlan(res, nF) {
    res.water = 0; res.coping = 0; res.floor = 0; res.pad = 0
    for (let j = 0; j < nF; j++) { const s = LSF[j]; if (s === SURF_WATER) res.water++; else if (s === SURF_COPING) res.coping++; else if (s === SURF_FLOOR) res.floor++; else res.pad++ }
  }

  const neroli = {
    /** Pluie de fleurs d'oranger sur tout le bassin et sur ses bords (comptes du palier, PB_CFG.notes.neroli.tiers).
     *  onLand(ordre, pGarden, index, surf) à chaque fleur posée, surf ∈ 'water' | 'coping' | 'floor' | 'pad'.
     *  `count` (facultatif) plafonne le nombre de fleurs ; `area` / `spawnY` (ancienne API) sont ignorés : le plan de
     *  zones de PB_CFG les remplace. Renvoie { n, petals, lastLandAt (s depuis maintenant), water, coping, floor, pad }
     *  (objet réutilisé : lire tout de suite). */
    fire({ count = 0, onLand = null } = {}) {
      onLandCb = onLand
      landOrder = 0
      const T = tierNow()
      const nF = Math.max(1, Math.min(T.flowers, count > 0 ? count : T.flowers, MAX_BLOSSOMS - T.petals))
      const nP = Math.min(T.petals, MAX_BLOSSOMS - nF)
      const id = newBatch(T.survivors)
      collectDiscs()
      beginPlan()
      // répartition : eau (dont la bande proche, et 55 % du reste côté gauche, dégagé quand le flacon est en aparté),
      // sol devant le bassin, margelle (le reste, en quatre bandes)
      const nW = Math.round(NSPLIT.water * nF), nFl = Math.max(1, Math.round(NSPLIT.floor * nF)), nC = Math.max(0, nF - nW - nFl)
      const nNear = Math.round(NW.nearShare * nW), nMain = nW - nNear, nLeft = Math.round(NW.leftShare * nMain)
      const R = NW.rect, Rn = NW.near
      sampleZone(nLeft, R[0], NW.leftX, R[2], R[3], 0, NW.spacing, 0)
      sampleZone(nMain - nLeft, NW.leftX, R[1], R[2], R[3], 0, NW.spacing, 0)
      sampleZone(nNear, Rn[0], Rn[1], Rn[2], Rn[3], 0, NW.spacing, 0)
      apportion(nC, NCOP.strips)
      for (let s = 0; s < NCOP.strips.length; s++) { const S = NCOP.strips[s]; sampleZone(SHARE_N[s], S[0], S[1], S[2], S[3], 1, NCOP.spacing, 0) }
      sampleZone(nFl, NFL.rect[0], NFL.rect[1], NFL.rect[2], NFL.rect[3], 2, NFL.spacing, 0)
      const nFp = nPlan
      sampleZone(nP, R[0], R[1], R[2], R[3], 0, NW.petalSpacing, 1)
      const nIV = orderPlan(nFp, T.inView)
      fireRes.lastLandAt = launchPlan(nFp, nPlan - nFp, nIV, id, LAUNCH_FIRE)
      fireRes.n = nFp; fireRes.petals = nPlan - nFp
      countPlan(fireRes, nFp)
      return fireRes
    },
    /** Reprise (rappel de la note, finale) : n fleurs (défaut : palier) sur l'eau proche et la margelle proche, départ
     *  dans le champ, plus quelques pétales. Mêmes onLand que le dernier fire(). Renvoie { n, lastLandAt, … }. */
    reprise(n) {
      const T = tierNow()
      const nF = Math.max(1, Math.min(n > 0 ? n : T.reprise, MAX_BLOSSOMS - 4))
      const nP = Math.min(T.reprisePetals, MAX_BLOSSOMS - nF)
      const id = newBatch(NREP.survivors)
      collectDiscs()
      beginPlan()
      const nC = Math.round(NREP.copingShare * nF), nW = nF - nC
      const R = NREP.water, S = NCOP.strips[0]
      sampleZone(nW, R[0], R[1], R[2], R[3], 0, NW.spacing, 0)
      sampleZone(nC, S[0], S[1], S[2], S[3], 1, NCOP.spacing, 0)
      const nFp = nPlan
      sampleZone(nP, R[0], R[1], R[2], R[3], 0, NW.petalSpacing, 1)
      orderPlan(nFp, 0)
      repRes.lastLandAt = launchPlan(nFp, nPlan - nFp, 0, id, LAUNCH_REP)
      repRes.n = nFp; repRes.petals = nPlan - nFp
      countPlan(repRes, nFp)
      return repRes
    },
    clear() {
      for (let i = 0; i < MAX_BLOSSOMS; i++) { const b = B[i]; b.state = 0; b.survivor = false; b.fadeAt = 0 }
      for (let k = 0; k < NBATCH; k++) NB[k].live = false
      neroliMesh.count = 0; neroliMesh.visible = false
    },
    get active() { for (let i = 0; i < MAX_BLOSSOMS; i++) if (B[i].state > 0) return true; return false },
    /** Nombre de fleurs vivantes par état / surface (tests). */
    census(out) {
      out.live = 0; out.air = 0; out.water = 0; out.coping = 0; out.floor = 0; out.pad = 0
      for (let i = 0; i < MAX_BLOSSOMS; i++) {
        const b = B[i]
        if (b.state === 0) continue
        out.live++
        if (b.state <= 2) { out.air++; continue }
        if (b.kind) continue
        if (b.surf === SURF_WATER) out.water++; else if (b.surf === SURF_COPING) out.coping++; else if (b.surf === SURF_FLOOR) out.floor++; else out.pad++
      }
      return out
    },
  }

  // survivantes : les fleurs les mieux réparties (point le plus éloigné, glouton) parmi celles posées du lot, de
  // préférence près de la porte ; au plus N_STSURV sur la pierre (et seulement sur la margelle proche) ; plafond global
  // = survivantes du palier + N_XSURV (les reprises successives n'accumulent pas)
  function pickSurvivors(batch, cap) {
    let have = 0, haveStone = 0
    for (let i = 0; i < MAX_BLOSSOMS; i++) {
      const b = B[i]
      if (b.state > 0 && b.survivor) { have++; if (b.surf === SURF_COPING || b.surf === SURF_FLOOR) haveStone++ }
    }
    const need = Math.min(cap, tierNow().survivors + N_XSURV - have)
    for (let k = 0; k < need; k++) {
      let best = -1, bd = -1
      for (let i = 0; i < MAX_BLOSSOMS; i++) {
        const b = B[i]
        if ((b.state !== 3 && b.state !== 5) || b.survivor || b.batch !== batch || b.kind !== 0) continue
        if (b.surf === SURF_FLOOR) continue
        if (b.surf === SURF_COPING && (haveStone >= N_STSURV || b.z < P.z1 - 0.05)) continue
        let dmin = 9
        for (let j = 0; j < MAX_BLOSSOMS; j++) { const o = B[j]; if (o.state > 0 && o.survivor) dmin = Math.min(dmin, Math.hypot(o.x - b.x, o.z - b.z)) }
        const score = dmin + (b.z + 3.2) * 0.08 + b.seed * 0.03
        if (score > bd) { bd = score; best = i }
      }
      if (best < 0) break
      B[best].survivor = true
      if (B[best].surf === SURF_COPING) haveStone++
    }
  }

  // souffle commun (deux bouffées lentes) : toutes les fleurs dérivent ensemble, chacune à sa mesure
  const gust = { x: 0, z: 0 }
  function gustAt(t) {
    gust.x = 0.06 * Math.sin(t * 0.55 + 0.7) + 0.035 * Math.sin(t * 1.27 + 2.1)
    gust.z = 0.03 * Math.sin(t * 0.43 + 1.9) + 0.02 * Math.sin(t * 1.05)
    return gust
  }
  // hauteur de repos sur une feuille statique (même empilement que gardenFx : p.y + bord relevé, houle × 0,9)
  function padRestY(b, h) {
    const pd = padsList(), p = b.padI >= 0 && b.padI < pd.length ? pd[b.padI] : null
    return P.waterY + (p && p.y ? p.y : 0.002) + 0.0045 + 0.9 * h
  }
  // une fleur posée sur la pierre reste sur la margelle (marge au bord extérieur, jamais au-dessus de l'eau) ou sur le sol
  function clampStone(b) {
    if (b.surf === SURF_COPING) {
      const m = NST.edge
      b.x = clamp(b.x, COP_OUT.x0 + m, COP_OUT.x1 - m); b.z = clamp(b.z, COP_OUT.z0 + m, COP_OUT.z1 - m)
      const xi0 = COP_IN.x0 - 0.01, xi1 = COP_IN.x1 + 0.01, zi0 = COP_IN.z0 - 0.01, zi1 = COP_IN.z1 + 0.01
      if (b.x > xi0 && b.x < xi1 && b.z > zi0 && b.z < zi1) {
        const dl = b.x - xi0, dr = xi1 - b.x, df = b.z - zi0, dn = zi1 - b.z, mn = Math.min(dl, dr, df, dn)
        if (mn === dl) b.x = xi0; else if (mn === dr) b.x = xi1; else if (mn === df) b.z = zi0; else b.z = zi1
      }
    } else b.z = clamp(b.z, NFL.zMax, NFL.zMin)
  }

  function updateBlossoms(dt, swellT) {
    // évaporation : après fadeAfter s, chaque lot ne garde que ses survivantes
    for (let k = 0; k < NBATCH; k++) {
      const bt = NB[k]
      if (!bt.live || time - bt.t0 < N_FADE) continue
      pickSurvivors(bt.id, bt.cap)
      for (let i = 0; i < MAX_BLOSSOMS; i++) { const b = B[i]; if (b.state > 0 && b.batch === bt.id && !b.survivor) b.fadeAt = time + rng() * 1.6 }
      bt.live = false
    }
    gustAt(time)
    collectDiscs()
    let n = 0
    const idt = dt > 1e-5 ? 1 / dt : 0
    const cam = U.uCam.value
    // avant la chute / en vol : (a) deux fleurs à la même hauteur s'écartent en x (à l'écran, jamais de grappe) ;
    // (b) un point d'atterrissage (eau, feuille) dans le disque d'un nymphéa glisse doucement hors du disque
    for (let i = 0; i < MAX_BLOSSOMS; i++) {
      const b = B[i]
      if (b.state !== 1 && b.state !== 2) continue
      if (b.surf === SURF_WATER || b.surf === SURF_PAD) {
        for (let k = 0; k < nPD; k++) {
          const D = PD[k]
          const dx = b.xL - D.x, dz = b.zL - D.z, d = Math.hypot(dx, dz), R = D.clearR + 0.02
          if (d >= R + b.seed * 0.06) continue
          const ux = d > 1e-4 ? dx / d : Math.cos(b.seed * TAU), uz = d > 1e-4 ? dz / d : Math.sin(b.seed * TAU)
          const tx = D.x + ux * (R + b.seed * 0.06), tz = D.z + uz * (R + b.seed * 0.06)
          b.surf = SURF_WATER; b.padI = -1
          if (b.state === 1) { b.xS += tx - b.xL; b.zS += tz - b.zL; b.xL = tx; b.zL = tz } else {
            const ddx = tx - b.xL, ddz = tz - b.zL, dd = Math.hypot(ddx, ddz), mv = Math.min(dd, 0.3 * dt)
            if (dd > 1e-6) { b.xL += (ddx / dd) * mv; b.zL += (ddz / dd) * mv }
          }
        }
      }
      if (b.state !== 2) continue
      // séparation À L'ÉCRAN (directions vues de la caméra : deux fleurs à des profondeurs différentes peuvent se
      // recouvrir) : une dérive lente qui s'accumule tant que deux fleurs se recouvrent, puis se relâche très lentement
      const bz = Math.max(0.3, cam.z - b.z), bax = (b.x - cam.x) / bz, bay = (b.y - cam.y) / bz, br = (0.065 * b.scale) / bz
      let px = 0, py = 0
      for (let j = 0; j < MAX_BLOSSOMS; j++) {
        const o = B[j]
        if (j === i || o.state !== 2) continue
        const oz = Math.max(0.3, cam.z - o.z), R = (br + (0.065 * o.scale) / oz) * 1.25
        const dx = bax - (o.x - cam.x) / oz, adx = Math.abs(dx)
        if (adx > R) continue
        const dy = bay - (o.y - cam.y) / oz, ady = Math.abs(dy)
        if (ady > R) continue
        const w = (1 - adx / R) * (1 - ady / R)
        const sx = dx > 0 ? 1 : dx < 0 ? -1 : i < j ? 1 : -1, sy = dy > 0 ? 1 : dy < 0 ? -1 : i < j ? 1 : -1
        px += sx * w; py += sy * w * 0.6
      }
      b.ox = clamp(b.ox + (px * 0.55 - b.ox * 0.25) * dt, -0.26, 0.26)
      b.oy = clamp(b.oy + (py * 0.45 - b.oy * 0.25) * dt, -0.2, 0.2)
    }
    for (let i = 0; i < MAX_BLOSSOMS; i++) {
      const b = B[i]
      if (b.state === 0) continue
      b.t += dt
      let flutter = 0, dissolve = 0, sink = 0
      if (b.fadeAt > 0 && time >= b.fadeAt && b.state >= 3 && b.state !== 4) { b.state = 4; b.fade = 0 }
      if (b.state === 1) {
        if (b.t < b.delay) continue
        b.state = 2; b.t = 0
      }
      const stone = b.surf === SURF_COPING || b.surf === SURF_FLOOR
      if (b.state === 2) {
        const u = clamp01(b.t / b.T)
        // descente : départ du repos, vitesse limite, arrivée amortie (pente finale 0,45)
        const f = -2 * u * u * u + 3 * u * u + 0.45 * (u * u * u - u * u)
        const yw = stone ? b.ys : b.surf === SURF_PAD ? padRestY(b, swellHeight(b.xL, b.zL, swellT)) : P.waterY + swellHeight(b.xL, b.zL, swellT) + 0.002
        const dec = Math.pow(1 - u, 0.85)                               // tout le mouvement latéral s'éteint à l'arrivée
        const g = smooth(u)
        const ang = b.ph + b.om * b.t
        const R = b.R0 * dec
        const sw = Math.sin(b.swW * b.t + b.swPh) * b.swA * dec
        const gk = dec * (0.6 + 0.8 * b.seed)
        // l'écart en vol se résorbe à l'arrivée (pierre, feuille : exactement au point visé ; eau : en partie)
        const oxk = b.surf === SURF_WATER ? 0.35 + 0.65 * dec : dec
        b.x = b.xS + (b.xL - b.xS) * g + R * Math.cos(ang) + sw * b.swDx + gust.x * gk + b.ox * oxk
        b.z = b.zS + (b.zL - b.zS) * g + R * Math.sin(ang) * 0.8 + sw * b.swDz + gust.z * gk
        // le balancier remonte un peu aux extrémités (vol plané), sinon descente régulière
        b.y = b.y0 + (yw - b.y0) * f + Math.cos(2 * (b.swW * b.t + b.swPh)) * b.swA * 0.22 * dec + b.oy * dec
        // vitesse horizontale (filtrée) → inclinaison dans le sens de la course, avec retard
        if (!b.has) { b.px = b.x; b.pz = b.z; b.has = true }
        const vx = (b.x - b.px) * idt, vz = (b.z - b.pz) * idt
        b.px = b.x; b.pz = b.z
        const kf = Math.min(1, dt * 7)
        b.vxF += (vx - b.vxF) * kf; b.vzF += (vz - b.vzF) * kf
        const lev = 1 - smooth((u - 0.8) / 0.2)                        // se remet à plat juste avant de se poser
        const kt = (b.kind ? 1.0 : 1.7) * lev
        b.tx += (clamp(b.vxF * kt, -0.85, 0.85) - b.tx) * Math.min(1, dt * 5)
        b.tz += (clamp(b.vzF * kt, -0.85, 0.85) - b.tz) * Math.min(1, dt * 5)
        // inclinaison = vers la vitesse + nutation propre + la fleur se présente un peu au visiteur (+z) : on lit
        // une étoile qui tournoie, pas une silhouette de profil
        const wb = b.wob * lev
        const pa = b.psi + b.prec * b.t
        const ix = b.tx + Math.cos(pa) * wb, iz = b.tz + Math.sin(pa) * wb + (b.kind ? 0 : b.face * lev)
        const th = Math.hypot(ix, iz)
        if (th > 1e-5) { axis.set(iz / th, 0, -ix / th); qa.setFromAxisAngle(axis, th) } else qa.identity()
        b.yawV = b.spinV * (0.35 + 0.65 * dec)
        b.yaw = b.spin + b.spinV * b.t * (1 - 0.35 * u)
        qb.setFromAxisAngle(YAX, b.yaw)
        qa.multiply(qb)
        if (b.kind === 1) {
          // pétale : culbute, puis le couple de rappel le met à plat (face ou revers) avant l'eau
          const settle = smooth((u - 0.55) / 0.35)
          b.tum += b.tumW * (1 - settle) * dt
          const flat = Math.round(b.tum / Math.PI) * Math.PI
          b.tum += (flat - b.tum) * Math.min(1, dt * 6 * settle)
          axis.set(Math.cos(b.tumAx), 0, Math.sin(b.tumAx))
          qc.setFromAxisAngle(axis, b.tum)
          qa.multiply(qc)
          b.glint = 0.35 + 0.65 * Math.abs(Math.sin(b.tum))
        } else b.glint = 0.25 + 0.5 * Math.min(1, Math.hypot(b.tx, b.tz) * 1.5)
        flutter = 0.55 + 0.45 * lev
        if (u >= 1) {
          b.t = 0; b.land = 0
          b.ltx = b.tx + 0.12 * (b.seed - 0.5); b.ltz = b.tz + 0.12 * (0.5 - b.seed)
          b.yawV = b.spinV * 0.35
          let sy = P.waterY
          if (stone) {
            // pierre : petit rebond, glissade freinée dans le sens de l'arrivée, puis immobile
            b.state = 5; b.flash = NST.flash; b.vx = 0; b.vz = 0
            const vh = Math.hypot(b.vxF, b.vzF)
            b.sv = Math.min(NST.slideMax, NST.slideK * vh)
            b.sdx = vh > 1e-5 ? b.vxF / vh : 0; b.sdz = vh > 1e-5 ? b.vzF / vh : 0
            clampStone(b)
            sy = b.ys
          } else {
            // eau : l'élan de la chute devient une dérive ; feuille : posée, sans dérive
            b.state = 3; b.flash = 1
            if (b.surf === SURF_PAD) { b.vx = 0; b.vz = 0; sy = b.y } else { b.vx = b.vxF * 0.35; b.vz = b.vzF * 0.35 }
          }
          if (b.kind === 0) {
            if (onLandCb) { landP.set(b.x, sy, b.z); try { onLandCb(landOrder, landP, i, SURF_NAMES[b.surf]) } catch (e) { console.warn('[notesFx] onLand', e) } }
            landOrder++
          }
        }
      }
      if (b.state >= 3) {
        b.land += dt
        const L = b.land
        if (stone) {
          // ---- pierre (margelle, sol) : rebond de 6 mm puis 1,5 mm, glissade ≤ 2 cm, à plat, aucune houle ----
          if (b.sv > 0) {
            const s0 = b.sv
            b.sv = Math.max(0, s0 - NST.friction * dt)
            const mv = (s0 + b.sv) * 0.5 * dt
            b.x += b.sdx * mv; b.z += b.sdz * mv
            clampStone(b)
          }
          const h1 = NST.hopT, h2 = NST.hop2T
          b.y = b.ys + (L < h1 ? NST.hop * Math.sin((Math.PI * L) / h1) : L < h1 + h2 ? NST.hop2 * Math.sin((Math.PI * (L - h1)) / h2) : 0)
          const st = Math.exp(-10 * L) * Math.cos(18 * L)
          const ix = b.ltx * st, iz = b.ltz * st
          const th = Math.hypot(ix, iz)
          if (th > 1e-6) { axis.set(iz / th, 0, -ix / th); qa.setFromAxisAngle(axis, th) } else qa.identity()
          b.yawV *= Math.exp(-dt * 14)
          b.yaw += dt * b.yawV
          qb.setFromAxisAngle(YAX, b.yaw)
          qa.multiply(qb)
          if (b.kind === 1) { axis.set(Math.cos(b.tumAx), 0, Math.sin(b.tumAx)); qc.setFromAxisAngle(axis, b.tum); qa.multiply(qc) }
          flutter = Math.exp(-6 * L) * Math.cos(9 * L)
        } else {
          // une fleur posée sur une feuille que l'onde d'un nymphéa atteint (dans son disque) est poussée à l'eau
          if (b.surf === SURF_PAD) {
            for (let k = 0; k < nPD; k++) {
              const D = PD[k]
              if (D.uid === b.bobD || D.t >= PART_DUR + 1.8) continue
              const d = Math.hypot(b.x - D.x, b.z - D.z)
              if (D.wave >= d && d < D.clearR + b.rOff) { b.surf = SURF_WATER; b.padI = -1; break }
            }
          }
          let bt = 0, hc = 0
          if (b.surf === SURF_PAD) {
            // ---- feuille : posée, suit la houle de la feuille, pas de dérive ----
            hc = swellHeight(b.x, b.z, swellT)
            sink = (1 - Math.exp(-L * 9)) * Math.exp(-L * 1.7)
            b.y = padRestY(b, hc) - 0.002 * sink
            b.yawV *= Math.exp(-dt * 3)
            b.yaw += dt * b.yawV
          } else {
            // ---- eau : dérive lente (errance + séparation + bords du bassin + nymphéas) ----
            const wx = Math.sin(time * 0.31 + b.seed * 40) * 0.004, wz = Math.cos(time * 0.27 + b.seed * 23) * 0.004
            b.vx += wx * dt; b.vz += wz * dt
            for (let j = 0; j < MAX_BLOSSOMS; j++) {
              if (j === i) continue
              const o = B[j]
              if (o.state < 3 || o.surf !== SURF_WATER) continue
              const dx = b.x - o.x
              if (dx > N_SEP || dx < -N_SEP) continue
              const dz = b.z - o.z
              if (dz > N_SEP || dz < -N_SEP) continue
              const d2 = dx * dx + dz * dz
              if (d2 < N_SEP2 && d2 > 1e-8) { const d = Math.sqrt(d2), k = ((N_SEP - d) * 0.6) / d; b.vx += dx * k * dt; b.vz += dz * k * dt }
            }
            // nymphéas : l'eau qui se soulève écarte les fleurs (le front les porte jusqu'au bord du disque gardé, 0,5 s),
            // l'onde les fait danser en passant ; ensuite chaque disque reste libre (contrainte dure, deux passes)
            let carried = false, carrier = false
            for (let k = 0; k < nPD; k++) {
              const D = PD[k]
              let dx = b.x - D.x, dz = b.z - D.z
              const d = Math.hypot(dx, dz)
              if (d > 1e-4) { dx /= d; dz /= d } else { dx = Math.cos(b.seed * TAU); dz = Math.sin(b.seed * TAU) }
              const Rb = D.clearR + b.rOff
              if (b.bobD !== D.uid && D.t < PART_DUR + 1.8 && D.wave >= d) {
                b.bobD = D.uid; b.bob = 0; b.bobA = 0.0055 * Math.exp(-Math.max(0, d - Rb) / 0.12); b.bdx = dx; b.bdz = dz
                if (d < Rb && b.pd0 < 0) { b.pi = D.uid; b.pd0 = d; b.pr = d; b.pv = 0 }
              }
              if (b.pd0 >= 0 && b.pi === D.uid) {
                carrier = true
                // suiveur critique (ω 16) du front : départ à vitesse nulle, aucune saccade, arrivée sans rebond
                const target = Math.max(b.pd0, D.front * (Rb / D.clearR))
                const w = 16, hh = dt * 0.5
                for (let s = 0; s < 2; s++) { b.pv += (w * w * (target - b.pr) - 2 * w * b.pv) * hh; b.pr += b.pv * hh }
                b.x = D.x + dx * b.pr; b.z = D.z + dz * b.pr
                b.vx = dx * Math.min(0.05, b.pv * 0.25); b.vz = dz * Math.min(0.05, b.pv * 0.25)   // il reste un glissement
                carried = true
                if (D.t > PART_DUR && Math.abs(target - b.pr) < 0.002 && Math.abs(b.pv) < 0.03) { b.pd0 = -1; b.pi = -1 }
              }
            }
            if (b.pd0 >= 0 && !carrier) { b.pd0 = -1; b.pi = -1 }   // le disque porteur a disparu
            if (!carried) {
              for (let pass = 0; pass < 2; pass++) {
                for (let k = 0; k < nPD; k++) {
                  const D = PD[k]
                  if (D.t <= PART_DUR) continue
                  let dx = b.x - D.x, dz = b.z - D.z
                  const d = Math.hypot(dx, dz)
                  const Rc = D.clearR + 0.004                    // marge : le pas de dérive (≤ 1,7 mm) ne repasse jamais dedans
                  if (d >= Rc) continue
                  if (d > 1e-4) { dx /= d; dz /= d } else { dx = Math.cos(b.seed * TAU); dz = Math.sin(b.seed * TAU) }
                  b.x = D.x + dx * Rc; b.z = D.z + dz * Rc
                  const vn = b.vx * dx + b.vz * dz
                  if (vn < 0) { b.vx -= vn * dx; b.vz -= vn * dz }
                }
              }
            }
            const m = N_WALL
            if (b.x < P.x0 + m) b.vx += (P.x0 + m - b.x) * 2 * dt
            if (b.x > P.x1 - m) b.vx -= (b.x - P.x1 + m) * 2 * dt
            if (b.z < P.z0 + m) b.vz += (P.z0 + m - b.z) * 2 * dt
            if (b.z > P.z1 - m) b.vz -= (b.z - P.z1 + m) * 2 * dt
            const damp = Math.exp(-dt * 0.9)
            b.vx *= damp; b.vz *= damp
            const sp = Math.hypot(b.vx, b.vz)
            if (sp > 0.05) { b.vx *= 0.05 / sp; b.vz *= 0.05 / sp }
            if (!carried) { b.x += b.vx * dt; b.z += b.vz * dt }
            hc = swellHeight(b.x, b.z, swellT)
            // posée en douceur : s'enfonce un peu (≈ 5 mm), remonte, un dernier petit rebond
            sink = (1 - Math.exp(-L * 9)) * Math.exp(-L * 1.7)
            b.y = P.waterY + hc + 0.002 - 0.0055 * sink + 0.0011 * Math.sin(L * 7.5) * Math.exp(-L * 2.6)
            // l'onde d'un nymphéa : la fleur monte sur la crête, bascule vers l'extérieur puis se repose en oscillant
            if (b.bob >= 0 && b.bob < 3) {
              b.bob += dt
              const e = Math.exp(-b.bob * 3.2) * smooth(b.bob / 0.15)
              b.y += b.bobA * Math.sin(b.bob * 8.5) * e
              bt = b.bobA * 24 * Math.cos(b.bob * 8.5) * e
            }
            // rotation lente sur l'eau : l'élan de la chute s'éteint, il reste une dérive à peine perceptible
            b.yawV = b.yawV * Math.exp(-dt * 1.4)
            b.yaw += dt * (b.yawV + 0.05 * (b.seed < 0.5 ? -1 : 1))
          }
          // roulis sur la houle (la feuille : 0,9) + inclinaison d'arrivée qui se résorbe en oscillant
          const hk = b.surf === SURF_PAD ? 12.6 : 14
          const gx = (swellHeight(b.x + 0.02, b.z, swellT) - hc) * hk, gz = (swellHeight(b.x, b.z + 0.02, swellT) - hc) * hk
          const st = Math.exp(-L * 3.2) * Math.cos(L * 7.0)
          const ix = -gx + b.ltx * st + b.bdx * bt, iz = -gz + b.ltz * st + b.bdz * bt
          const th = Math.hypot(ix, iz)
          if (th > 1e-6) { axis.set(iz / th, 0, -ix / th); qa.setFromAxisAngle(axis, th) } else qa.identity()
          qb.setFromAxisAngle(YAX, b.yaw)
          qa.multiply(qb)
          if (b.kind === 1) { axis.set(Math.cos(b.tumAx), 0, Math.sin(b.tumAx)); qc.setFromAxisAngle(axis, b.tum); qa.multiply(qc) }
          flutter = Math.exp(-L * 2.8) * Math.cos(L * 5.5)
        }
        b.flash = Math.max(0, b.flash - dt * 2.2)
        b.glint = 0.25 + 0.35 * Math.exp(-L * 1.5)
        if (b.state === 4) {
          b.fade += dt / 1.5
          dissolve = smooth(b.fade)
          if (b.fade >= 1) { b.state = 0; continue }
        }
      }
      if (b.state < 2) continue
      // apparition : si la fleur naît dans le champ, elle se dévoile en fondu au lieu de surgir
      const appear = b.state === 2 ? smooth(b.t / b.appear) : 1
      vpos.set(b.x, b.y, b.z)
      const s = b.scale * (1 - 0.15 * dissolve)
      vscl.set(s, s, s)
      mat4.compose(vpos, qa, vscl)
      neroliMesh.setMatrixAt(n, mat4)
      aB.array[n * 4] = dissolve
      aB.array[n * 4 + 1] = flutter
      aB.array[n * 4 + 2] = b.seed
      aB.array[n * 4 + 3] = b.flash
      aK.array[n * 4] = b.kind
      aK.array[n * 4 + 1] = b.glint
      aK.array[n * 4 + 2] = sink
      aK.array[n * 4 + 3] = appear
      n++
    }
    neroliMesh.count = n
    neroliMesh.visible = n > 0
    if (n > 0) { neroliMesh.instanceMatrix.needsUpdate = true; aB.needsUpdate = true; aK.needsUpdate = true }
  }

  // ---- nymphéas : un champ de lotus (GARDEN XL §3) ------------------------------------------------------------------
  // Chaque lotus suit la chronologie du nymphéa d'origine, décalée de son retard (une vague qui part du héros, près →
  // loin, gauche / droite en alternance) : l'eau se soulève et écarte les fleurs flottantes (PART_DUR), le bouton monte
  // sur ressort (il remonte un peu trop puis se pose), penché sous l'eau puis redressé en oscillant quand il perce ; la
  // feuille se déroule ; les 16 pétales s'ouvrent chacun à son tour (ressorts sous-amortis évalués dans le vertex shader,
  // la pointe suit la base), puis la couronne d'étamines. Le rappel est une respiration en vague : d'un lotus au suivant
  // (rang × pulseWave) et, dans chaque fleur, autour de la corolle.
  // Une instance par lotus (un seul draw call), triées loin → près une fois par montée ; un lotus pas encore parti a une
  // échelle 0 et le shader le rejette hors du volume de vue. Tout est préalloué ici : zéro allocation par image.
  const LCFG = PB_CFG.notes.lily || {}
  const LDEF_FIELD = [
    { at: [-0.45, -2.15], sc: 1.00, delay: 0.00 }, { at: [-0.27, -3.22], sc: 0.70, delay: 0.45 },
    { at: [0.30, -2.95], sc: 0.78, delay: 0.70 }, { at: [-0.15, -4.60], sc: 0.72, delay: 1.10 },
    { at: [0.55, -4.70], sc: 0.60, delay: 1.35 }, { at: [-0.58, -5.45], sc: 0.55, delay: 1.60 },
  ]
  const L_FIELD = Array.isArray(LCFG.field) && LCFG.field.length ? LCFG.field : LDEF_FIELD
  const L_WAVE = LCFG.pulseWave ?? 0.12
  const L_COUNT = LCFG.count || { high: MAX_LOTUS, medium: MAX_LOTUS, low: MAX_LOTUS }
  const L_NOF = {}
  const lilyGeo = buildLilyGeometry(mulberry32(seed * 31 + 5))
  const LA = {
    center: lilyGeo.attributes.iCenter, anim: lilyGeo.attributes.iAnim, bloom: lilyGeo.attributes.iBloom,
    tilt: lilyGeo.attributes.iTilt, pad: lilyGeo.attributes.iPad,
  }
  const LU = {
    uAtlasL: { value: new THREE.Vector4(...PETAL_ATLAS.lily) },
    uAtlasS: { value: new THREE.Vector4(...PETAL_ATLAS.stamen) },
    uFrame: { value: new THREE.Vector4(LILY_FRAME.h, LILY_FRAME.k, PETAL_ATLAS.base, PETAL_ATLAS.tip) },
    uPadA: { value: new THREE.Color('#2b6a4a') },
    uPadB: { value: new THREE.Color('#4a8a5c') },
    uGold: { value: new THREE.Color('#e8b84a') },
  }
  const lilyMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...LU }, vertexShader: LILY_VS, fragmentShader: LILY_FS,
    side: THREE.DoubleSide, transparent: true, depthWrite: true, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const lilyMesh = new THREE.Mesh(lilyGeo, lilyMat)
  lilyMesh.name = 'PB_Nymphea'
  lilyMesh.renderOrder = RO.lily
  lilyMesh.frustumCulled = false
  lilyMesh.visible = false
  if (gardenRoot) gardenRoot.add(lilyMesh)
  const LILY_TRIS = lilyGeo.index.count / 3

  // ressort sous-amorti côté CPU (même forme que celui du shader)
  const springStep = (t, w, z) => {
    if (t <= 0) return 0
    const wd = w * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
  }
  // chronologie d'un lotus (s depuis son départ) — RISE_AT : l'eau se soulève d'abord (les fleurs flottantes
  // s'écartent), le bouton monte ensuite ; OPEN_AT → onOpen ; SETTLED_AT : posé
  const RISE_AT = 0.25, BLOOM_AT = 0.9, OPEN_AT = 2.9, SETTLED_AT = 4.3, PART_DUR = 0.5
  // un lotus ; rank = index dans le champ = ordre d'éclosion (0 : le héros)
  const LOT = Array.from({ length: MAX_LOTUS }, (_, k) => ({
    active: false, phase: 'idle', rank: k, uid: -1, t: 0, ct: 0, delay: 0,
    x: 0, z: 0, sc: 1, radius: 0.21, open: 1, rise: 0, pad: 0, surfR: LILY_SURF,
    surfaced: false, opened: false, glowOn: false, glowT: -1, glow: 0, closeDur: 1, close0: [0, 0, 0], yaw0: 0, swayPh: 0,
    tSurf: 0, tiltA: 0, tiltX: 1, tiltZ: 0, tilt: 0, bloomT: -10, wet: 1,
    padX: 0.012, padZ: -0.018, padR: 0.17, padW: 0,
    clearR: 0, front: 0, wave: 0,   // disque gardé libre (centre des fleurs flottantes), front de l'onde qui les écarte
  }))
  // le champ : n lotus, rappels (onSurface / onOpen par lotus, onAllOpen une fois)
  const FIELD = { active: false, t: 0, n: 0, openedCount: 0, allOpen: false, perLotus: true, onSurface: null, onOpen: null, onAllOpen: null }
  const SLOT = new Int8Array(MAX_LOTUS)                 // instance → lotus (loin → près)
  const lilyP = new THREE.Vector3(), lilyC = new THREE.Vector3()
  const CENTERS = Array.from({ length: MAX_LOTUS }, () => new THREE.Vector3())
  CENTERS.count = 0
  // front de l'onde de montée : vitesse nulle au départ et à l'arrivée, pic à 40 % (l'eau se soulève puis s'étale)
  const partEase = (u) => { u = clamp01(u); return 1 - Math.pow(1 - u, 2.5) * (1 + 2.5 * u) }
  function tierLotus() {
    let name = 'high'
    for (const k in QUALITY) if (QUALITY[k] === Q) { name = k; break }
    return L_COUNT[name] ?? MAX_LOTUS
  }
  function lotusCall(fn, L, k) {
    lilyP.set(L.x, P.waterY, L.z)
    try { fn(lilyP, k) } catch (e) { console.warn('[notesFx] lotus callback', e) }
  }
  // attributs d'instance (triés loin → près) ; un lotus en attente ou éteint : échelle 0 → rien n'est dessiné
  function writeLotus(swellT) {
    const C = LA.center.array, An = LA.anim.array, Bl = LA.bloom.array, Ti = LA.tilt.array, Pd = LA.pad.array
    for (let s = 0; s < FIELD.n; s++) {
      const L = LOT[SLOT[s]], o = s * 4
      const vis = L.active && L.phase !== 'wait'
      C[o] = L.x; C[o + 1] = L.z; C[o + 2] = vis ? L.sc : 0; C[o + 3] = L.yaw0 + 0.035 * Math.sin(time * 0.23 + L.swayPh)
      An[o] = L.rise; An[o + 1] = L.open; An[o + 2] = L.pad; An[o + 3] = 1
      Bl[o] = L.bloomT; Bl[o + 1] = L.glowOn && L.glowT >= 0 ? L.glowT : -10; Bl[o + 2] = L.wet; Bl[o + 3] = L.glow
      Ti[o] = L.tiltX; Ti[o + 1] = L.tiltZ; Ti[o + 2] = L.tilt; Ti[o + 3] = swellHeight(L.x, L.z, swellT) * 0.9
      Pd[o] = L.padX; Pd[o + 1] = L.padZ; Pd[o + 2] = L.padR; Pd[o + 3] = L.padW
    }
    LA.center.needsUpdate = true; LA.anim.needsUpdate = true; LA.bloom.needsUpdate = true; LA.tilt.needsUpdate = true; LA.pad.needsUpdate = true
  }
  const lily = {
    /** Champ de lotus (PB_CFG.notes.lily.field, l'ordre du tableau est l'ordre d'éclosion) ; le lotus 0 (héros) se place
     *  en `p` (rayon `radius`). Pour chacun : l'eau se soulève et écarte les fleurs flottantes (0,5 s), le bouton perce la
     *  surface (≈ 0,5 s → onSurface(p, i)), 16 pétales s'ouvrent à leur tour (2,9 s → onOpen(p, i)) ; onAllOpen() quand le
     *  dernier est ouvert (≈ 4,5 s : la fin de l'aparté). `p` des rappels est réutilisé : le lire tout de suite.
     *  Chaque lotus se place au moins 0,215 m + sa feuille derrière la margelle côté visiteur et à distance des bords.
     *  Compatibilité (ancien directeur, sans onAllOpen) : onSurface(p, 0) pour le seul héros, onOpen(p, 0) une fois,
     *  quand tout le champ est ouvert. `perLotus: true | false` force l'un ou l'autre mode. */
    rise(p, { radius = LCFG.radius ?? 0.21, field = L_FIELD, count = 0, onSurface = null, onOpen = null, onAllOpen = null, perLotus } = {}) {
      const fl = Array.isArray(field) && field.length ? field : L_FIELD
      const n = Math.max(1, Math.min(MAX_LOTUS, fl.length, count > 0 ? count : tierLotus()))
      FIELD.active = true; FIELD.t = 0; FIELD.n = n; FIELD.openedCount = 0; FIELD.allOpen = false
      FIELD.onSurface = onSurface; FIELD.onOpen = onOpen; FIELD.onAllOpen = onAllOpen
      FIELD.perLotus = perLotus !== undefined ? !!perLotus : typeof onAllOpen === 'function'
      for (let i = 0; i < MAX_BLOSSOMS; i++) { B[i].bob = -1; B[i].pd0 = -1; B[i].pi = -1 }
      for (let k = 0; k < MAX_LOTUS; k++) {
        const L = LOT[k]
        L.active = false; L.phase = 'idle'; L.clearR = 0; L.front = 0; L.wave = 0; L.glowOn = false
        if (k >= n) continue
        const f = fl[k] || L_NOF
        const sc = k === 0 ? (radius / 0.21) * (f.sc ?? 1) : (f.sc ?? 0.7)
        const px = k === 0 && p ? p.x : f.at ? f.at[0] : 0, pz = k === 0 && p ? p.z : f.at ? f.at[1] : -3.5
        const foot = LILY_FOOT * sc
        L.x = clamp(px, P.x0 + foot + 0.03, P.x1 - foot - 0.03)
        L.z = Math.max(P.z0 + foot + 0.03, Math.min(pz, P.z1 - (LILY_PAD_REACH * sc + 0.215)))
        L.sc = sc; L.radius = 0.21 * sc
        // les fleurs flottantes gardent leur centre hors de ce disque : portée de la corolle + 6 cm + une demi-fleur
        L.clearR = foot + 0.09
        L.delay = Math.max(0, f.delay ?? k * 0.3)
        L.active = true; L.phase = 'wait'; L.t = -L.delay; L.ct = 0; L.uid = ++lilySerial
        // la pointe du bouton perce la surface à cette valeur du ressort de montée (départ à −20 cm quelle que soit la taille)
        L.surfR = (-LILY_BUD_TIP * sc - LILY_C0) / (LILY_C1 * sc - LILY_C0)
        L.surfaced = false; L.opened = false
        L.rise = 0; L.open = 1; L.pad = 0; L.glowT = -1; L.glow = 0; L.bloomT = -10; L.tSurf = 0; L.wet = 1; L.tilt = 0
        L.yaw0 = rng() * TAU; L.swayPh = rng() * TAU
        // le bouton monte penché (vers un côté au hasard) et se redresse en perçant
        const ta = rng() * TAU
        L.tiltX = Math.cos(ta); L.tiltZ = Math.sin(ta); L.tiltA = 0.26 + rng() * 0.08
        // feuille centrée sous la fleur, encoche tournée vers le visiteur (+z), comme le rendu approuvé
        L.padX = 0.012; L.padZ = -0.018; L.padR = 0.17; L.padW = Math.PI / 2 + (rng() - 0.5) * 0.7
      }
      // instances triées loin → près (la caméra est toujours côté +z) : pétales semi-transparents bien composés
      for (let k = 0; k < n; k++) SLOT[k] = k
      for (let a = 1; a < n; a++) {
        const v = SLOT[a]
        let b = a - 1
        while (b >= 0 && LOT[SLOT[b]].z > LOT[v].z) { SLOT[b + 1] = SLOT[b]; b-- }
        SLOT[b + 1] = v
      }
      lilyGeo.instanceCount = n
      writeLotus(swellTime())
      lilyMesh.visible = true
    },
    /** Rappel de la note : tous les lotus s'illuminent et respirent, en vague (rang r : départ à r × pulseWave s). */
    pulse() {
      if (!FIELD.active) return
      for (let k = 0; k < FIELD.n; k++) {
        const L = LOT[k]
        if (!L.active || L.phase === 'wait' || L.phase === 'close') continue
        L.glowOn = true; L.glowT = -L.rank * L_WAVE
      }
    },
    /** Tous les lotus se referment et redescendent (puis le champ se masque). */
    close(dur = 1.0) {
      if (!FIELD.active) return
      for (let k = 0; k < FIELD.n; k++) {
        const L = LOT[k]
        if (!L.active) continue
        L.clearR = 0; L.front = 0; L.wave = 0
        if (L.phase === 'wait') { L.active = false; continue }
        L.phase = 'close'; L.ct = 0; L.closeDur = Math.max(0.05, dur)
        L.close0[0] = L.rise; L.close0[1] = L.open; L.close0[2] = L.pad
      }
    },
    /** Éteint tout de suite le champ. */
    clear() {
      FIELD.active = false; FIELD.allOpen = false; FIELD.onSurface = null; FIELD.onOpen = null; FIELD.onAllOpen = null
      for (let k = 0; k < MAX_LOTUS; k++) { const L = LOT[k]; L.active = false; L.phase = 'idle'; L.clearR = 0; L.front = 0; L.wave = 0; L.glowOn = false }
      lilyGeo.instanceCount = 0
      lilyMesh.visible = false
    },
    get active() { return FIELD.active },
    /** Nombre de lotus actifs. */
    get count() { let c = 0; if (FIELD.active) for (let k = 0; k < FIELD.n; k++) if (LOT[k].active) c++; return c },
    /** Tous les lotus du champ sont ouverts (onAllOpen a eu lieu). */
    get allOpen() { return FIELD.allOpen },
    /** Centre réel du héros (repère jardin, sur l'eau) — pour les koï / la lueur du directeur. */
    get center() { return lilyC.set(LOT[0].x, P.waterY, LOT[0].z) },
    /** Centres des lotus (Vector3[6] préalloués, ordre du champ ; `.count` = nombre de lotus du champ, 0 s'il est éteint). */
    get centers() {
      const n = FIELD.active ? FIELD.n : 0
      for (let k = 0; k < n; k++) CENTERS[k].set(LOT[k].x, P.waterY, LOT[k].z)
      CENTERS.count = n
      return CENTERS
    },
  }

  function updateLotus(dt, swellT) {
    if (!FIELD.active) { if (lilyMesh.visible || lilyGeo.instanceCount) { lilyMesh.visible = false; lilyGeo.instanceCount = 0 } return }
    FIELD.t += dt
    let live = 0
    for (let k = 0; k < FIELD.n; k++) {
      const L = LOT[k]
      if (!L.active) continue
      L.t = FIELD.t - L.delay
      if (L.phase === 'close') {
        L.ct += dt
        const c = smooth(L.ct / L.closeDur)
        L.open = L.close0[1] * (1 - smooth(c * 1.4))
        L.rise = L.close0[0] * (1 - smooth((c - 0.35) / 0.65))
        L.pad = L.close0[2] * (1 - smooth((c - 0.2) / 0.8))
        L.bloomT += dt
        if (L.ct >= L.closeDur) { L.active = false; L.phase = 'idle'; continue }
      } else if (L.t < 0) {
        // la vague ne l'a pas encore atteint : invisible, son disque est déjà réservé (aucune fleur n'y atterrit)
        L.phase = 'wait'; L.front = 0; L.wave = 0; L.glow = 0
        live++
        continue
      } else {
        const t = L.t
        if (L.phase === 'wait') L.phase = 'rise'
        if (L.phase === 'rise') {
          // montée : ressort (ω 4,5, ζ 0,62 → dépassement ≈ 8 % de la course), la feuille se déroule, puis l'éclosion
          L.rise = springStep(t - RISE_AT, 4.5, 0.62)
          L.pad = springStep(t - 0.62, 3.4, 0.6)
          L.bloomT = t - BLOOM_AT
          if (!L.surfaced && L.rise >= L.surfR) {
            L.surfaced = true; L.tSurf = t
            if (FIELD.onSurface && (FIELD.perLotus || k === 0)) lotusCall(FIELD.onSurface, L, k)
          }
          if (!L.opened && t >= OPEN_AT) {
            L.opened = true; FIELD.openedCount++
            if (FIELD.onOpen && FIELD.perLotus) lotusCall(FIELD.onOpen, L, k)
            if (!FIELD.allOpen && FIELD.openedCount >= FIELD.n) {
              FIELD.allOpen = true
              if (FIELD.onAllOpen) { try { FIELD.onAllOpen() } catch (e) { console.warn('[notesFx] onAllOpen', e) } }
              if (FIELD.onOpen && !FIELD.perLotus) lotusCall(FIELD.onOpen, LOT[0], 0)
            }
          }
          if (t >= SETTLED_AT) { L.phase = 'idle'; L.rise = 1; L.pad = 1 }
        } else L.bloomT = Math.min(L.bloomT + dt, 60)
        // l'onde de montée : le front écarte les fleurs jusqu'au bord du disque gardé, puis s'éloigne en s'affaiblissant
        L.front = L.clearR * partEase(t / PART_DUR)
        L.wave = t < PART_DUR ? L.front : L.clearR + 0.35 * (t - PART_DUR)
        // penché sous l'eau, il se redresse en perçant puis oscille un peu sur l'eau
        const ts = L.surfaced ? t - L.tSurf : 0
        L.wet = L.surfaced ? Math.exp(-ts / 2.2) : 1
        L.tilt = L.tiltA * (1 - smooth(L.rise / 0.84)) + (L.surfaced ? 0.11 * Math.exp(-ts * 2.6) * Math.sin(ts * 6.2) : 0)
      }
      // rappel : respiration de 1,7 s (lueur + corolle qui s'ouvre un peu plus, en vague) ; départ décalé selon le rang
      let glow = 0
      if (L.glowOn) {
        L.glowT += dt
        if (L.glowT >= 0) glow = L.glowT < 0.45 ? smooth(L.glowT / 0.45) : 1 - smooth((L.glowT - 0.45) / 1.4)
        if (L.glowT > 2.4) { L.glowOn = false; L.glowT = -1 }
      }
      // lueur de naissance pendant l'éclosion
      const birth = L.phase === 'rise' ? 0.35 * Math.sin(Math.PI * clamp01((L.t - 0.4) / 2.8)) : 0
      L.glow = glow * 0.9 + birth
      live++
    }
    if (!live) { FIELD.active = false; lilyMesh.visible = false; lilyGeo.instanceCount = 0; return }
    writeLotus(swellT)
    lilyMesh.visible = true
  }

  // ---- ambre -------------------------------------------------------------------------------------
  // traînées instanciées (quad orienté selon la vitesse) ; 1 draw call, MAX_MOTES instances
  const moteGeo = new THREE.InstancedBufferGeometry()
  moteGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  moteGeo.setIndex([0, 1, 2, 0, 2, 3])
  const iP = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MOTES * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const iT = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MOTES * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MOTES * 4), 4).setUsage(THREE.DynamicDrawUsage)
  moteGeo.setAttribute('iP', iP); moteGeo.setAttribute('iT', iT); moteGeo.setAttribute('iA', iA)
  moteGeo.instanceCount = MAX_MOTES
  const motePos = iP.array, moteTr = iT.array, moteA = iA.array
  const MU = { uCol: { value: new THREE.Color(1.0, 0.36, 0.06) }, uHot: { value: new THREE.Color(1.0, 0.72, 0.36) } }
  const moteMat = new THREE.ShaderMaterial({
    uniforms: MU, vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const motes = new THREE.Mesh(moteGeo, moteMat)
  motes.name = 'PB_AmberMotes'
  motes.renderOrder = RO.motes
  motes.frustumCulled = false
  motes.visible = false
  if (anchor) anchor.add(motes)

  const M = Array.from({ length: MAX_MOTES }, () => ({
    on: false, t: 0, delay: 0, T: 1.4, s: new THREE.Vector3(), c1: new THREE.Vector3(), off: new THREE.Vector3(),
    spin: 0, size: 1, seed: 0, done: false, flash: 0, pw: 1, amp: 0.03, px: 0, py: 0, pz: 0, has: false,
    e1: new THREE.Vector3(), e2: new THREE.Vector3(), hr: 0, hw: 0, hp: 0,
  }))
  const amberState = { active: false, t: 0, dur: 1.6, toFn: null, onAbsorbed: null, absorbed: false, from: [], n: 0, swirl: 1 }
  const tgt = new THREE.Vector3(), mp = new THREE.Vector3(), c2 = new THREE.Vector3(), t0v = new THREE.Vector3()
  const srcC = [new THREE.Vector3(), new THREE.Vector3()], srcN = [0, 0], srcLo = [0, 0], srcHi = [0, 0]

  function fireMotes(from, toFn, dur, n, onAbsorbed) {
    const A = amberState
    if (!from || !from.length || !toFn) return
    A.active = true; A.t = 0; A.dur = Math.max(0.4, dur); A.toFn = toFn; A.onAbsorbed = onAbsorbed; A.absorbed = false; A.n = n
    if (A.from !== from) A.from = from.map((v) => v.clone())
    A.swirl = rng() < 0.5 ? -1 : 1                                   // un seul sens de tourbillon autour du col
    toFn(t0v)
    // deux courants (un par battant) : chaque grain suit le chemin commun de son courant, décalé dans le temps et
    // un peu sur le côté ; le courant ondule dans un champ tourbillonnaire lent → un filet de poudre d'or, pas une gerbe
    // source de chaque courant : le milieu du battant (centre des points fournis de ce côté, hauteur ± 20 %)
    for (let k = 0; k < 2; k++) { srcC[k].set(0, 0, 0); srcN[k] = 0; srcLo[k] = 1e9; srcHi[k] = -1e9 }
    for (const f of A.from) {
      const k = f.x < t0v.x ? 0 : 1
      srcC[k].add(f); srcN[k]++; srcLo[k] = Math.min(srcLo[k], f.y); srcHi[k] = Math.max(srcHi[k], f.y)
    }
    for (let k = 0; k < 2; k++) if (srcN[k]) srcC[k].multiplyScalar(1 / srcN[k])
    const both = srcN[0] > 0 && srcN[1] > 0
    for (let i = 0; i < MAX_MOTES; i++) {
      const m = M[i]
      m.on = i < n
      if (!m.on) continue
      const k = both ? i & 1 : (srcN[0] ? 0 : 1)
      const side = k ? 1 : -1
      const span = Math.max(0.02, srcHi[k] - srcLo[k])
      m.s.copy(srcC[k]).add(mp.set((rng() - 0.5) * 0.012, (rng() - 0.5) * span * 0.4, (rng() - 0.5) * 0.012))
      // la chaleur soulève le courant, qui vient vers le visiteur en s'écartant à peine du battant
      m.c1.set(srcC[k].x - side * 0.02, srcC[k].y + 0.13, srcC[k].z + 0.16).add(mp.set((rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01))
      // approche : de côté et au-dessus du col, puis le tourbillon (même sens pour les deux courants : une double hélice)
      m.off.set(side * 0.11, 0.1, -0.03)
      m.spin = A.swirl * 1.9
      const order = (Math.floor(i / 2) + 0.5) / Math.ceil(n / 2)
      m.delay = order * A.dur * 0.42 + rng() * 0.05
      m.T = A.dur * 0.56 * (0.92 + 0.16 * rng())
      m.pw = 0.95 + rng() * 0.1
      m.size = 0.0045 + rng() * 0.006
      m.amp = 0.03
      // décalage latéral dans le filet (repère perpendiculaire au trajet), qui tourne lentement et se resserre au col
      m.e1.subVectors(t0v, m.s).normalize()
      m.e2.set(0, 1, 0).cross(m.e1).normalize()
      m.e1.cross(m.e2).normalize()
      m.hr = 0.003 + rng() * 0.009
      m.hw = A.swirl * (0.5 + rng() * 0.5)
      m.hp = rng() * TAU
      m.seed = rng() * 100
      m.t = 0; m.done = false; m.flash = 0; m.has = false
    }
    motes.visible = true
  }
  const amber = {
    /** 40 grains montent des battants (fromAnchor, repère marqueur) et rejoignent toAnchorFn(out) en `dur` s. */
    fire({ fromAnchor = [], toAnchorFn = null, dur = 1.6, onAbsorbed = null } = {}) {
      fireMotes(fromAnchor, toAnchorFn, dur, Q.motes, onAbsorbed)
    },
    /** Rappel : n grains, mêmes sources et cible que le dernier fire(). */
    reprise(n = 16) {
      const A = amberState
      if (!A.from.length || !A.toFn) return
      fireMotes(A.from, A.toFn, 1.2, Math.min(n, MAX_MOTES), null)
    },
    clear() { amberState.active = false; for (const m of M) m.on = false; motes.visible = false },
    get active() { return amberState.active },
  }

  // champ tourbillonnaire cohérent (deux fonctions de courant, plans xy et yz) : les grains voisins ondulent ensemble
  function curlAt(x, y, z, t, out) {
    const a1 = 14.0, b1 = 11.0, a2 = 10.0, b2 = 15.0
    const sx = Math.sin(a1 * x + t * 0.9 + 1.3), cx = Math.cos(a1 * x + t * 0.9 + 1.3)
    const sy = Math.sin(b1 * y - t * 0.7), cy = Math.cos(b1 * y - t * 0.7)
    const sy2 = Math.sin(a2 * y + t * 0.6 + 0.4), cy2 = Math.cos(a2 * y + t * 0.6 + 0.4)
    const sz = Math.sin(b2 * z - t * 0.8 + 2.1), cz = Math.cos(b2 * z - t * 0.8 + 2.1)
    return out.set(sx * cy, -cx * sy + 0.6 * sy2 * cz, -0.6 * cy2 * sz)
  }
  const cv = new THREE.Vector3()

  function updateMotes(dt) {
    const A = amberState
    if (!A.active) { motes.visible = false; return }
    A.t += dt
    A.toFn(tgt)
    let live = 0
    const trK = dt > 1e-4 ? 0.035 / dt : 0
    for (let i = 0; i < MAX_MOTES; i++) {
      const m = M[i], o3 = i * 3, o4 = i * 4
      if (!m.on) { moteA[o4] = 0; motePos[o3] = 9999; continue }
      const u = (A.t - m.delay) / m.T
      if (u < 0) { moteA[o4] = 0; motePos[o3] = m.s.x; motePos[o3 + 1] = m.s.y; motePos[o3 + 2] = m.s.z; live++; continue }
      if (!m.done) {
        const e = Math.pow(clamp01(u), m.pw)
        const k = e * e * (1.5 - 0.5 * e)                               // départ doux, aspiré à la fin
        const ang = m.spin * (1 - e) * (1 - e) * 2.4
        const ca = Math.cos(ang), sa = Math.sin(ang)
        c2.set(m.off.x * ca - m.off.z * sa, m.off.y, m.off.x * sa + m.off.z * ca).multiplyScalar(1 - e * 0.6).add(tgt)
        const v = 1 - k
        mp.set(0, 0, 0).addScaledVector(m.s, v * v * v).addScaledVector(m.c1, 3 * v * v * k).addScaledVector(c2, 3 * v * k * k).addScaledVector(tgt, k * k * k)
        // ondulation organique du courant entier (champ commun, évalué sur le chemin) : nulle au départ et à l'arrivée
        const env = smooth(e / 0.25) * (1 - smooth((e - 0.45) / 0.45))
        curlAt(mp.x, mp.y, mp.z, A.t * 0.6, cv)
        mp.addScaledVector(cv, m.amp * env)
        // place du grain dans le filet : s'évase en montant, se resserre en entrant dans le col
        const hph = m.hp + m.hw * TAU * e, hk = m.hr * (0.35 + 0.65 * smooth(e / 0.3)) * (1 - smooth((e - 0.5) / 0.45))
        mp.addScaledVector(m.e2, Math.cos(hph) * hk).addScaledVector(m.e1, Math.sin(hph) * hk)
        if (!m.has) { m.px = mp.x; m.py = mp.y; m.pz = mp.z; m.has = true }
        let tx = (mp.x - m.px) * trK, ty = (mp.y - m.py) * trK, tz = (mp.z - m.pz) * trK
        const tl = Math.hypot(tx, ty, tz)
        if (tl > 0.022) { const q = 0.022 / tl; tx *= q; ty *= q; tz *= q }
        m.px = mp.x; m.py = mp.y; m.pz = mp.z
        motePos[o3] = mp.x; motePos[o3 + 1] = mp.y; motePos[o3 + 2] = mp.z
        moteTr[o3] = tx; moteTr[o3 + 1] = ty; moteTr[o3 + 2] = tz
        const tw = 0.82 + 0.18 * Math.sin(A.t * 11 + m.seed) * Math.sin(A.t * 4.3 + m.seed * 1.7)
        moteA[o4] = smooth(u / 0.16) * tw * (0.7 + 0.45 * e)
        moteA[o4 + 1] = m.size * (1 - 0.3 * e)
        moteA[o4 + 2] = e
        moteA[o4 + 3] = m.seed
        if (u >= 1) { m.done = true; m.flash = 0 }
        live++
      } else {
        // absorbé : petite floraison au col, qui s'éteint
        m.flash += dt / 0.22
        motePos[o3] = tgt.x; motePos[o3 + 1] = tgt.y; motePos[o3 + 2] = tgt.z
        moteTr[o3] = 0; moteTr[o3 + 1] = 0; moteTr[o3 + 2] = 0
        const f = Math.min(1, m.flash)
        moteA[o4] = (1 - f) * (1 - f) * 1.3
        moteA[o4 + 1] = m.size * (1 + 0.5 * f)
        moteA[o4 + 2] = 1
        if (m.flash >= 1) { m.on = false; moteA[o4] = 0 } else live++
      }
    }
    if (!A.absorbed && A.t >= A.dur) {
      A.absorbed = true
      if (A.onAbsorbed) { try { A.onAbsorbed() } catch (e) { console.warn('[notesFx] onAbsorbed', e) } }
    }
    if (!live && A.absorbed) { A.active = false; motes.visible = false; return }
    motes.visible = true
    iP.needsUpdate = true; iT.needsUpdate = true; iA.needsUpdate = true
  }

  // ---- boucle ----------------------------------------------------------------------------------
  const invM = new THREE.Matrix4(), camW = new THREE.Vector3()
  function swellTime() {
    try { const u = water && water.debug && water.debug.uniforms && water.debug.uniforms.uTime; if (u && typeof u.value === 'number') return u.value } catch {}
    return time
  }

  return {
    neroli, lily, amber,
    /** Objets créés (pour un éventuel prewarm du directeur). */
    objects: [neroliMesh, lilyMesh, motes],
    clear() { neroli.clear(); amber.clear(); lily.clear() },
    update(dt, camera) {
      dt = Math.min(Math.max(dt, 0), 0.1)
      time += dt
      U.uTime.value = time
      if (camera && gardenRoot) {
        gardenRoot.updateWorldMatrix(true, false)
        invM.copy(gardenRoot.matrixWorld).invert()
        camera.getWorldPosition(camW)
        U.uCam.value.copy(camW.applyMatrix4(invM))
      }
      const st = swellTime()
      updateBlossoms(dt, st)
      updateLotus(dt, st)
      updateMotes(dt)
    },
    stats() {
      let drawCalls = 0, triangles = 0, points = 0
      if (neroliMesh.visible && neroliMesh.count) { drawCalls++; triangles += neroliMesh.count * 48 }
      if (lilyMesh.visible && lilyGeo.instanceCount) { drawCalls++; triangles += LILY_TRIS * lilyGeo.instanceCount }
      if (motes.visible) { drawCalls++; for (let i = 0; i < MAX_MOTES; i++) if (M[i].on) { points++; triangles += 2 } }
      return { drawCalls, triangles, points, blossoms: neroliMesh.count, lily: FIELD.active, lotus: lily.count, quality: Object.keys(QUALITY).find((k) => QUALITY[k] === Q) }
    },
    setQuality(q) { Q = QUALITY[q] || QUALITY.high },
    /** Inspection (tests) : états internes, lecture seule. */
    _debug: () => ({ blossoms: B, lily: LOT[0], lotus: LOT, field: FIELD, motes: M, amber: amberState }),
    /** Branche la vraie texture T_PB_petals dès qu'elle est chargée (sans recompiler). */
    setPetalTexture(tex) {
      if (!tex) return
      U.uPetals.value = tex
      for (const t of ownTextures) t.dispose()
      ownTextures.length = 0
    },
    dispose() {
      for (const o of [neroliMesh, lilyMesh, motes]) { if (o.parent) o.parent.remove(o); o.geometry.dispose(); o.material.dispose() }
      for (const t of ownTextures) t.dispose()
    },
  }
}
