// Jardin Majorelle — « BLEU INTERDIT » : effets d'eau de l'émergence du flacon (WP4, SPEC_PERFUME §4.1–4.7 b, §2.5).
//
// Le flacon dort couché au fond du bassin long, se redresse comme un battant de porte, déchire le miroir,
// ruisselle puis flotte au-dessus de l'eau. Ce module apporte tout ce que gardenFx ne fait pas :
//   • fx.splash()      ORDONNANCEUR : unique chemin vers water.splash() (slot de gerbe partagé, 8 rides) ;
//                      re-cible les koï juste après chaque splash du bassin long (annule le rassemblement auto) ;
//   • fx.glow          lueur sous l'eau (silhouette de l'arc floutée, cœur Majorelle → liseré or) + tache de
//                      lumière à la surface + instance de réserve (bouton du nymphéa) — 1 draw call additif ;
//   • fx.rings         24 anneaux instanciés (crête + creux qui plient le reflet de la sonde) — remplacent les
//                      rides de gardenFx pour tous les petits événements (gouttes, battements, toc, bulles) ;
//   • fx.drops         gouttes (imposteurs sphériques étirés selon la vitesse, gouttes pendantes qui gonflent,
//                      s'étirent et tombent) + bulles du fond (P2) — 1 draw call, devant le verre ;
//   • fx.dome / crown / collar / neck (P1) : dôme d'eau avant la rupture, couronne de la rupture, collerette
//                      (ménisque + ondes) autour de la section à la ligne d'eau, colonne d'eau sous la base ;
//   • fx.carpet (P1)   tapis de 120 scintillements dorés sur l'axe du bassin (finale).
//   • fx.reflect (P2)  imposteur miroir de PB_ReflProxy (gl_FragDepth du point d'eau, depthWrite false),
//                      visible seulement quand le proxy dépasse de l'eau et hors traversée (collerette éteinte).
//   • fx.wake          sillage du doigt posé / glissé sur le bassin long : start(p) / move(p) / end() (+ poke) ;
//                      le doigt lissé part à water.wake.head à chaque image : UNE onde lisse (étrave en V + sillon
//                      doux) dessinée dans le shader de l'eau de gardenFx (0 draw call) ; un seul anneau très doux
//                      quand le doigt se pose ; ni chapelet d'anneaux, ni écume, ni particules ; koï qui fuient
//                      (water.koi.flee, ≤ 5 / s). N'appelle jamais water.splash : l'ordonnanceur et les gerbes
//                      scénarisées ne sont jamais touchés. fx.tapWater sur le bassin long = le même anneau doux.
//
// Repère « jardin » (mètres, three.js : x droite, y haut, la cour vers −z). Le groupe vit sous `parent`
// (= gardenRoot du directeur) et reste à l'identité. Tous les matériaux sont toneMapped: false et se composent
// en sortie (linearToOutputTexel) comme gardenFx : sonde « pool » projetée sur la boîte DEFAULT_ROOM
// (sonde en (0, 0.25, −4), couvercle = ciel analytique), Schlick n = 1.33 (F0 0.02, gain rasant ×2,2 comme
// le bassin long), soleil = sunDir, diffusion #0a1a44.
// Ordre de rendu (base renderOrderBase, PB_RENDER_ORDER) : glow 3.2 · refl 3.5 · rings 5.5 · dome 5.6 · collar 5.7 ·
// carpet 6.8 · wake 8.6 · crown/neck 10.5 · drops 12. Chaque pièce est visible = false au repos ; pic ≤ 6 draw calls
// (rupture : glow, rings, drops, dome, crown, collar) et < 3 k triangles ; le sillage ajoute ≤ 2 draw calls
// (sprites + anneaux s'ils étaient éteints), 128 triangles. Zéro allocation par image.
//
// Ordonnanceur (PB_CFG.splash) : ≤ maxInWindow splashes par fenêtre `window` s ; écart ≥ bigGap si le
// nouveau OU le précédent est « gros » (k ≥ bigK, protège la gerbe unique et les 8 rides), sinon ≥ smallGap.
// Priorités : 'high' attend jusqu'à queueMax s, 'normal' jusqu'à queueMax / 2, 'low' n'attend jamais.
// Un splash refusé laisse un anneau à sa place (option ring: false pour l'éviter) : aucun geste mort.
// Koï : option koi = { point, seconds } (cible explicite), false (laisser le rassemblement auto, ex. tap),
// ou rien (cible persistante koiTarget() si elle court encore). Le re-ciblage est émis dans le même appel,
// juste après water.splash(), donc avant la prochaine mise à jour des koï (≤ 1 image, exigence WP4).
//
// ---------------------------------------------------------------------------------------------------
// CROCHETS À DEMANDER AU PROPRIÉTAIRE DE gardenFx (additifs, rien n'en dépend) :
//   - ripple(point, amp, delay)   une ride seule, sans gerbe, ni koï, ni pétales ;
//   - koi.setObstacle({ x, z, r }) les koï contournent le flacon couché / qui se redresse ;
//   - koi.follow(point)            suivre un point mobile sans re-tirer les orbites (procession du glissé) ;
//   - export de RENDER_ORDER et de swellHeight() (la houle, pour faire flotter nos décors) ;
//   - 16 emplacements de rides au lieu de 8 ;
//   - une gerbe multi-emplacements (plusieurs uBurst) pour lever la règle « gros splash ≥ 1,2 s ».
// ---------------------------------------------------------------------------------------------------

import * as THREE from 'three'
import { PB_CFG, PB_RENDER_ORDER } from '@/lib/majorelle/perfumeConfig'

const TAU = Math.PI * 2
const G = 9.81
const DEG = Math.PI / 180
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x) }

const DEFAULT_POOL = { x0: -0.8, x1: 0.8, z0: -6.3, z1: -1.7, waterY: 0, depth: 0.45, rimH: 0.08 }
const DEFAULT_ROOM = { x0: -3.6, x1: 3.6, zBack: -9.6, zFront: -0.45, wallH: 4.0 }
const POOL_PROBE_POS = [0, 0.25, -4.0]
const DEFAULT_SPLASH = { window: 2.5, maxInWindow: 3, bigK: 0.7, bigGap: 1.2, smallGap: 0.6, queueMax: 0.4, tapGap: 0.7 }

const QUALITY = {
  high: { drops: 96, bubbles: 24, dome: true, crown: true, collar: true, neck: true, carpet: 120, glitter: 1, reflect: true, wakeSprites: 0 },
  medium: { drops: 96, bubbles: 16, dome: true, crown: true, collar: true, neck: true, carpet: 120, glitter: 1, reflect: true, wakeSprites: 0 },
  low: { drops: 48, bubbles: 0, dome: false, crown: false, collar: false, neck: false, carpet: 0, glitter: 0, reflect: false, wakeSprites: 0 },
}
const MAX_RINGS = 24
const MAX_DROPS = 96 + 24 // gouttes + bulles (même draw call)
const MAX_CARPET = 120
const MAX_PEND_PTS = 16
const MAX_WAKE_SPR = 64
// ordres de rendu propres à ce module quand perfumeConfig ne les définit pas (sillage : après les nénuphars,
// fleurs et bractées de gardenFx (+6..+8) — le test de profondeur cache ce qui passe derrière une feuille)
const LOCAL_RENDER_ORDER = { wake: 8.6 }
// sprites du sillage (écume, éclats, embruns) désactivés : ils lisaient comme de grosses billes claires — le sillage reste
// une déformation réaliste de l'eau (anneaux en V + sillon) dans le shader de gardenFx (demande client)

// couleurs (linéaires)
const C_MAJ = new THREE.Vector3(0.23, 0.36, 1.0)    // cœur Majorelle (= in-scatter du jus)
const C_GOLD = new THREE.Vector3(1.0, 0.85, 0.63)   // liseré or

// ---------------------------------------------------------------------------------------------
// Silhouette du flacon (SPEC_PERFUME §2.1), en cm, origine au centre de la base, CCW, bouchon compris.
// Exportée pour la page de test (maquette du flacon) ; le runtime lit perfume_meta.json, pas ceci.
// ---------------------------------------------------------------------------------------------
export function archSilhouette({ arcSteps = 14, cap = true } = {}) {
  const R = 3.8, cy = 5.212, off = 0.3
  const a0 = Math.asin((3.515 - cy) / R), a1 = Math.asin((8.75 - cy) / R)
  const pts = [[-3.1, 0], [3.1, 0], [3.1, 3.515]]
  for (let i = 1; i <= arcSteps; i++) { const a = a0 + ((a1 - a0) * i) / arcSteps; pts.push([-off + R * Math.cos(a), cy + R * Math.sin(a)]) }
  if (cap) pts.push([0.75, 8.75], [0.75, 9.0], [0.95, 9.0], [0.95, 9.5], [1.4, 9.5], [1.4, 12.6], [-1.4, 12.6], [-1.4, 9.5], [-0.95, 9.5], [-0.95, 9.0], [-0.75, 9.0], [-0.75, 8.75])
  else pts.push([0.75, 8.75], [0.75, 9.0], [-0.75, 9.0], [-0.75, 8.75])
  for (let i = arcSteps; i >= 1; i--) { const a = a0 + ((a1 - a0) * i) / arcSteps; pts.push([off - R * Math.cos(a), cy + R * Math.sin(a)]) }
  pts.push([-3.1, 3.515])
  return pts
}

// ---------------------------------------------------------------------------------------------
// Texture de la lueur : R = halo large, G = cœur (silhouette érodée), B = liseré. Données linéaires,
// couleurs composées dans le shader. Quad debout 0,55 × 1,1 m, flacon 0,699 m centré.
// ---------------------------------------------------------------------------------------------
function boxBlur(src, W, H, r, passes = 3) {
  const a = Float32Array.from(src), b = new Float32Array(src.length)
  const R = Math.max(1, Math.round(r))
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) { // horizontal a → b
      let acc = 0
      for (let x = -R; x <= R; x++) acc += a[y * W + clamp(x, 0, W - 1)]
      for (let x = 0; x < W; x++) {
        b[y * W + x] = acc / (2 * R + 1)
        acc += a[y * W + clamp(x + R + 1, 0, W - 1)] - a[y * W + clamp(x - R, 0, W - 1)]
      }
    }
    for (let x = 0; x < W; x++) { // vertical b → a
      let acc = 0
      for (let y = -R; y <= R; y++) acc += b[clamp(y, 0, H - 1) * W + x]
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / (2 * R + 1)
        acc += b[clamp(y + R + 1, 0, H - 1) * W + x] - b[clamp(y - R, 0, H - 1) * W + x]
      }
    }
  }
  return a
}

function makeArchGlowTexture(W = 128, H = 256, quadW = 0.55) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })
  const s = W / quadW, cm = 0.699 / 12.6
  const pts = archSilhouette({ arcSteps: 20 })
  const path = () => {
    g.beginPath()
    pts.forEach(([x, y], i) => { const px = W / 2 + x * cm * s, py = H / 2 - (y * cm - 0.3495) * s; i ? g.lineTo(px, py) : g.moveTo(px, py) })
    g.closePath()
  }
  const grab = () => { const d = g.getImageData(0, 0, W, H).data, o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4] / 255; return o }
  // remplissage
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; path(); g.fill()
  const fill = grab()
  // cœur : remplissage érodé de 5 px
  g.strokeStyle = '#000'; g.lineWidth = 10; g.lineJoin = 'round'; path(); g.stroke()
  const core = grab()
  // liseré
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.strokeStyle = '#fff'; g.lineWidth = 2.5; path(); g.stroke()
  const rim = grab()
  const halo = boxBlur(fill, W, H, 5), coreB = boxBlur(core, W, H, 3), rimB = boxBlur(rim, W, H, 1, 2)
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = ((H - 1 - y) * W + x) * 4 // rangée 0 = bas (convention GL)
    data[o] = Math.round(255 * clamp(halo[i], 0, 1))
    data[o + 1] = Math.round(255 * clamp(coreB[i], 0, 1))
    data[o + 2] = Math.round(255 * clamp(rimB[i] * 1.6, 0, 1))
    data[o + 3] = 255
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  t.colorSpace = THREE.NoColorSpace
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

// ---------------------------------------------------------------------------------------------
// GLSL partagé (réécrit d'après gardenFx : mêmes conventions, rien n'est importé)
// ---------------------------------------------------------------------------------------------
const EF_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;        // caméra, repère jardin
uniform vec3 uSunDir;     // vers le soleil
uniform vec3 uSunCol;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec3 uScatter;    // #0a1a44
uniform vec3 uWallCol;
uniform vec4 uPool;       // x0, x1, z0, z1
uniform float uWaterY;
uniform vec4 uRoom;       // x0, x1, zFond, zAvant (DEFAULT_ROOM)
uniform float uWallH;
uniform samplerCube uProbe;
uniform vec3 uProbeP;
uniform float uHasProbe;
uniform float uGlit;      // paillettes (palier)
uniform vec3 uBgEst;      // fond attendu (linéaire) pour les compositions corrigées du gamma

float efHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float efNoise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(efHash(i), efHash(i + vec2(1.0, 0.0)), f.x), mix(efHash(i + vec2(0.0, 1.0)), efHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 efSky(vec3 R) { return mix(uSkyHor, uSkyZen, pow(clamp(R.y, 0.0, 1.0), 0.5)); }
// reflet : sortie de la boîte de la cour, sonde projetée « boîte » ; couvercle = ciel analytique (gardenFx)
vec3 efEnv(vec3 P, vec3 R, float lod) {
  float tx = R.x > 0.0 ? (uRoom.y - P.x) / max(R.x, 1e-4) : (uRoom.x - P.x) / min(R.x, -1e-4);
  float tz = R.z < 0.0 ? (uRoom.z - P.z) / min(R.z, -1e-4) : (uRoom.w - P.z) / max(R.z, 1e-4);
  float th = min(tx, tz);
  if (R.y > 1e-4) {
    if ((uWallH - P.y) / R.y < th) return efSky(R);
  } else if (R.y < -1e-4) {
    float fy = P.y > uWaterY ? uWaterY : uWaterY - 0.45;
    th = min(th, (fy - P.y) / R.y);
  }
  vec3 H = P + R * max(th, 0.0);
  if (uHasProbe > 0.5) return textureLod(uProbe, H - uProbeP, lod).rgb;
  return mix(uWallCol, vec3(0.86, 0.62, 0.16), smoothstep(uWallH - 0.32, uWallH - 0.12, H.y)) * (H.y < 0.1 ? 0.45 : 1.0);
}
// Schlick n = 1,33 avec le gain rasant du bassin long (gardenFx uReflK.x = 2,2)
float efFresnel(float NdV) { return min(0.02 + 0.98 * pow(1.0 - NdV, 5.0) * mix(1.0, 2.2, smoothstep(0.38, 0.1, NdV)), 1.0); }
float efSchlick(float NdV) { return 0.02 + 0.98 * pow(1.0 - NdV, 5.0); }
// un point W sous l'eau vu depuis la caméra : (1 − F)·T(λ) (absorption spectrale de gardenFx)
vec3 efThrough(vec3 W) {
  float d = max(uWaterY - W.y, 0.0);
  float NdV = clamp(normalize(uCam - W).y, 0.0, 1.0);
  float F = efFresnel(NdV);
  float cosT = sqrt(max(1.0 - (1.0 - NdV * NdV) / 1.769, 0.0));
  float L = d / max(cosT, 0.2) + 0.25 * d;
  return (1.0 - F) * exp(-vec3(2.4, 0.9, 0.45) * L);
}
// paillettes du soleil (micro-facettes de 8 mm, comme gardenFx) ; fwPix = empreinte du pixel (m)
float efGlitter(vec3 P, vec3 N, vec3 V, float fwPix) {
  float cs = 0.008;
  float px = fwPix / cs;
  float far = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 300.0) * 0.3 * smoothstep(0.3, 0.6, px);
  float fade = 1.0 - smoothstep(0.3, 0.55, px);
  if (fade <= 0.0) return far * uGlit;
  vec2 q = P.xz / cs;
  vec2 ci = floor(q);
  vec2 fq = fract(q) - 0.5;
  float h1 = efHash(ci), h2 = efHash(ci + 17.31), h3 = efHash(ci + 41.73);
  float ang = h1 * 6.2832 + uTime * (0.8 + 1.6 * h2);
  vec2 sl = vec2(cos(ang), sin(ang)) * (0.02 + 0.06 * h3);
  vec3 Nf = normalize(N + vec3(sl.x, 0.0, sl.y));
  float flash = pow(0.5 + 0.5 * sin(uTime * (2.5 + 4.0 * h2) + h1 * 40.0), 10.0);
  float lit = pow(max(dot(reflect(-V, Nf), uSunDir), 0.0), 900.0) * step(0.75, fract(h1 * 13.7)) * flash;
  vec2 off = (vec2(h2, h3) - 0.5) * 0.5;
  float spot = 1.0 - smoothstep(0.5, 1.2, length(fq - off) / max(px, 1e-4));
  return (min(lit * 4.0, 1.0) * spot * fade + far) * uGlit;
}
`
// fragment seulement (linearToOutputTexel n'existe pas dans le préambule des vertex shaders)
const EF_FRAG = /* glsl */ `
// lumière ajoutée (linéaire) à un fond sombre attendu, encodée pour un mélange One/One
vec3 efAdd(vec3 lin) { return max(linearToOutputTexel(vec4(uBgEst + lin, 1.0)).rgb - linearToOutputTexel(vec4(uBgEst, 1.0)).rgb, 0.0); }
// sortie prémultipliée (mélange One / OneMinusSrcAlpha)
vec4 efPremul(vec3 lin, float a) { return vec4(linearToOutputTexel(vec4(lin, 1.0)).rgb * a, a); }
`

// ---------------------------------------------------------------------------------------------
// 1) Lueur : 3 quads instanciés, additifs. [0] panneau sous l'eau (arc), [1] tache de surface, [2] réserve.
// ---------------------------------------------------------------------------------------------
const GLOW_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aCorner;
attribute vec4 aG0;   // centre x, y, z, type (0 panneau, 1 surface, 2 réserve)
attribute vec4 aG1;   // largeur, hauteur, phi (rad), niveau
attribute vec4 aG2;   // teinte rgb, sous l'eau (0/1)
uniform float uLift;   // 0..1 : remontée à la profondeur apparente (réfraction) aux vues rasantes
varying vec2 vUv;
varying vec3 vW;      // position vraie (atténuation, découpe à la surface)
varying vec4 vI;      // type, niveau, sous l'eau, -
varying vec3 vTint;
void main() {
  vec3 C = aG0.xyz;
  float kind = aG0.w;
  float c = cos(aG1.z), s = sin(aG1.z);
  vec2 l = aCorner * aG1.xy;
  vec3 W;
  if (kind > 0.5 && kind < 1.5) {
    W = vec3(C.x + l.x, uWaterY + 0.002, C.z - l.y);           // tache horizontale sur l'eau
  } else {
    vec2 tc = uCam.xz - C.xz;                                   // panneau verrouillé en Y, face caméra
    float L = length(tc);
    vec2 f = L > 1e-4 ? tc / L : vec2(0.0, 1.0);
    vec2 r = kind < 0.5 ? vec2(l.x * c - l.y * s, l.x * s + l.y * c) : l;  // rotation dans le plan (phi)
    W = C + vec3(f.y, 0.0, -f.x) * r.x + vec3(0.0, r.y, 0.0);
  }
  vUv = aCorner + 0.5;
  vW = W;
  vI = vec4(kind, aG1.w, aG2.w, 0.0);
  vTint = aG2.rgb;
  // Vu en rasant, un objet immergé paraît remonté (profondeur apparente ≈ d·cosI / (n·cosT), 0,19·d à 80°).
  // L'eau de gardenFx ne réfracte pas le décor : on ne remonte la lueur qu'au-delà de ~75° d'incidence,
  // là où le flacon lui-même est caché par la margelle (caméra par défaut).
  // Incidence prise au droit du centre (compression uniforme : l'arc reste cohérent).
  float dy = W.y - uWaterY;
  if (dy < 0.0 && (kind < 0.5 || (kind > 1.5 && aG2.w > 0.5))) {
    float cosI = clamp(normalize(uCam - vec3(C.x, uWaterY, C.z)).y, 0.02, 1.0);
    float sinT = sqrt(1.0 - cosI * cosI) / 1.333;
    float f = cosI / (1.333 * sqrt(max(1.0 - sinT * sinT, 1e-4)));
    W.y = uWaterY + dy * mix(1.0, f, uLift * smoothstep(0.3, 0.2, cosI));
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(W, 1.0);
}
`
const GLOW_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform sampler2D uArch;
uniform vec3 uMaj;
uniform vec3 uGold;
uniform float uPhys;      // part physique de l'atténuation par l'eau (0 = émissif pur)
uniform float uGain;
uniform float uGraze;     // surcroît d'intensité aux vues rasantes (le miroir domine)
uniform float uVeil;      // part « par-dessus » aux vues rasantes : la lumière voile le reflet clair
varying vec2 vUv;
varying vec3 vW;
varying vec4 vI;
varying vec3 vTint;
// atténuation d'un point W sous l'eau ; aux vues rasantes on rend une partie de la perte de Fresnel
vec3 glowAtten(vec3 W, float NdV, float graze) {
  float d = max(uWaterY - W.y, 0.0);
  float F = efFresnel(NdV);
  float cosT = sqrt(max(1.0 - (1.0 - NdV * NdV) / 1.769, 0.0));
  float L = d / max(cosT, 0.2) + 0.25 * d;
  vec3 T = exp(-vec3(2.4, 0.9, 0.45) * L);
  return mix(vec3(1.0), T * mix(1.0 - F, 1.0, 0.75 * graze), uPhys);
}
void main() {
  float kind = vI.x;
  float NdV = clamp(normalize(uCam - vW).y, 0.0, 1.0);
  float graze = smoothstep(0.32, 0.17, NdV);
  vec3 col;
  vec2 q = (vUv - 0.5) * 2.0;
  float r2 = dot(q, q);
  if (kind < 0.5) {
    vec3 m = texture2D(uArch, vUv).rgb;                         // R halo, G cœur, B liseré
    m *= smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
    col = uGold * (m.r * 0.22 + m.b * 0.55) + uMaj * (m.g * 1.2 + m.r * 0.5);
    col *= 1.0 - smoothstep(-0.03, 0.01, vW.y - uWaterY);      // rien au-dessus de l'eau
    col *= glowAtten(vW, NdV, graze);
  } else if (kind < 1.5) {
    float g = exp(-r2 * 3.2) * (1.0 - smoothstep(0.8, 1.0, sqrt(r2)));   // ellipse douce
    col = mix(uGold * 0.8, uMaj, exp(-r2 * 4.0)) * g;
  } else {
    col = vTint * exp(-r2 * 3.5) * (1.0 - smoothstep(0.8, 1.0, sqrt(r2)));
    if (vI.z > 0.5) col *= (1.0 - smoothstep(-0.02, 0.01, vW.y - uWaterY)) * glowAtten(vW, NdV, graze);
  }
  col *= vI.y * uGain * (1.0 + uGraze * graze);
  float a = min(clamp(max(col.b, max(col.r, col.g)) * 2.2, 0.0, 0.6) * graze * uVeil, 0.85);
  if (max(col.b, max(col.r, col.g)) < 1e-4) discard;
  gl_FragColor = vec4(efAdd(col) + a * linearToOutputTexel(vec4(col / max(max(col.b, max(col.r, col.g)), 1e-3) * 0.12, 1.0)).rgb, a);
}
`

// ---------------------------------------------------------------------------------------------
// 2) Anneaux : 24 couronnes instanciées (32 segments), crête + creux qui plient le reflet de la sonde
// ---------------------------------------------------------------------------------------------
const RING_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aRing;     // angle, côté (−1 intérieur, +1 extérieur)
attribute vec4 aR0;       // x, z, t0, amplitude
attribute vec4 aR1;       // r1, durée, niveau d'eau, -
varying vec3 vW;
varying vec4 vR;          // centre x, z, rayon, demi-largeur du paquet
varying float vEnv;
void main() {
  float age = uTime - aR0.z;
  float life = max(aR1.y, 0.05);
  float u = clamp(age / life, 0.0, 1.0);
  float r1 = aR1.x;
  float r = mix(0.01, r1, 1.0 - pow(1.0 - u, 2.2));
  float w = 0.008 + 0.028 * u * clamp(r1 / 0.35, 0.4, 1.6);      // paquet dispersif qui s'élargit
  float rad = max(r + aRing.y * w * 2.6, 0.0);
  vec3 p = vec3(aR0.x + cos(aRing.x) * rad, aR1.z + 0.002, aR0.y + sin(aRing.x) * rad);
  vW = p;
  vR = vec4(aR0.xy, r, w);
  vEnv = aR0.w * pow(1.0 - u, 1.3) * smoothstep(0.0, 0.05, age) * sqrt(0.08 / max(r, 0.08)) * step(0.0, age) * step(age, life);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const RING_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
varying vec3 vW;
varying vec4 vR;
varying float vEnv;
void main() {
  vec2 d = vW.xz - vR.xy;
  float dist = length(d) + 1e-5;
  float fw = fwidth(dist);
  if (vEnv < 0.002) discard;
  vec2 dir = d / dist;
  float w = max(vR.w, fw * 1.6);          // jamais plus fin que ~3 px : s'élargit au lieu de créneler
  float aa = vR.w / w;
  float s = (dist - vR.z) / w;
  float env = exp(-s * s * 0.8);
  float ph = 3.6 * s;
  float dh = env * (-1.6 * s * cos(ph) - 3.6 * sin(ph));     // d/ds [env·cos] : crête, creux, 2e crête
  float slope = clamp(0.0035 * vEnv * aa * dh / w, -0.6, 0.6);
  vec3 N = normalize(vec3(-slope * dir.x, 1.0, -slope * dir.y));
  vec3 V = normalize(uCam - vW);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = efFresnel(NdV);
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.02); R = normalize(R);
  vec3 lin = F * efEnv(vW, R, 1.0) + (1.0 - F) * uScatter * 0.9;
  lin += uSunCol * pow(max(dot(R, uSunDir), 0.0), 500.0) * 3.0;
  float a = clamp(abs(slope) * 7.0, 0.0, 0.9) * (1.0 - smoothstep(1.6, 2.6, abs(s)));
  if (a < 0.003) discard;
  gl_FragColor = efPremul(lin, a);
}
`

// ---------------------------------------------------------------------------------------------
// 3) Gouttes / bulles : quads face caméra, imposteur sphérique, étirés selon la vitesse ; taille ≥ uMinPx
// ---------------------------------------------------------------------------------------------
const DROP_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aCorner;
attribute vec4 aD0;   // x, y, z, rayon (m)
attribute vec4 aD1;   // vitesse xyz, alpha
attribute vec4 aD2;   // type (0 goutte, 1 bulle), étirement imposé, graine, -
uniform float uPx;
uniform float uWorldScale;
uniform float uMinPx;
varying vec2 vC;
varying vec3 vAx;
varying vec3 vAw;
varying vec3 vVd;
varying vec3 vP;
varying vec3 vI;      // alpha, type, graine
varying float vSt;    // étirement
void main() {
  vec3 P = aD0.xyz;
  vec3 Vd = normalize(P - uCam);
  vec3 v = aD1.xyz;
  vec3 u = v - dot(v, Vd) * Vd;
  float vl = length(u);
  vec3 ax = vl > 1e-5 ? u / vl : normalize(vec3(0.0, 1.0, 0.0) - Vd.y * Vd);
  vec3 aw = normalize(cross(Vd, ax));                     // (aw, ax) direct vu de la caméra : face avant
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  float pxPerM = projectionMatrix[1][1] * uPx * uWorldScale / max(-mv.z, 1e-3);
  float rPx = aD0.w * pxPerM;
  float k = max(1.0, uMinPx / max(rPx, 1e-4));
  float rad = aD0.w * k;
  float st = max(clamp(1.0 + vl * 0.014 / rad, 1.0, 3.2), aD2.y);
  vec3 W = P + ax * (aCorner.y * rad * st) + aw * (aCorner.x * rad);
  vC = aCorner;
  vSt = st;
  vAx = ax; vAw = aw; vVd = Vd; vP = P;
  vI = vec3(aD1.w * mix(0.5, 1.0, clamp(rPx / uMinPx, 0.0, 1.0)), aD2.x, aD2.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(W, 1.0);
}
`
const DROP_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
varying vec2 vC;
varying vec3 vAx;
varying vec3 vAw;
varying vec3 vVd;
varying vec3 vP;
varying vec3 vI;
varying float vSt;
void main() {
  float d2 = dot(vC, vC);
  float fw = fwidth(d2);
  float cov = 1.0 - smoothstep(1.0 - fw * 1.5, 1.0, d2);
  if (cov <= 0.0) discard;
  float nz = sqrt(max(1.0 - d2, 0.0));
  vec3 V = -vVd;
  vec3 N = normalize(vC.x * vAw + vC.y * vAx + nz * V);
  vec3 R = reflect(-V, N);
  vec3 col;
  float a;
  if (vI.y < 0.5) {
    // goutte = lentille boule : le rayon qui entre à la distance s de l'axe ressort dévié de
    // δ = 2(θi − θt) vers l'axe ; l'image est renversée (le bas de la goutte montre le ciel et les murs)
    float F = efSchlick(nz);
    float sp = sqrt(d2);
    vec3 nd = sp > 1e-4 ? (N - nz * V) / sp : vec3(0.0);
    float dl = 2.0 * (asin(clamp(sp, 0.0, 1.0)) - asin(clamp(sp / 1.333, 0.0, 1.0)));
    vec3 D = normalize(-V * cos(dl) - nd * sin(dl));
    vec3 trans = efEnv(vP, D, 1.5) * vec3(0.95, 0.98, 1.0) * 1.2 + efSky(vec3(0.0, 1.0, 0.0)) * 0.08;
    vec3 refl = efEnv(vP, R, 1.0);
    col = mix(trans, refl, F) + refl * smoothstep(0.82, 0.98, d2) * 0.35;   // liseré clair (Fresnel du bord)
    float sd = max(dot(R, uSunDir), 0.0);
    col += uSunCol * (pow(sd, 260.0) * 9.0 + pow(sd, 40.0) * 1.2 + pow(sd, 8.0) * 0.12);   // éclat + halo lisible à 4 px
    a = mix(0.85, 1.0, F) / sqrt(max(vSt, 1.0));    // filé : même énergie, plus transparent
  } else {
    // bulle sous l'eau : creuse, liseré argenté (réflexion totale), vue à travers la surface
    float rim = smoothstep(0.3, 0.95, d2);
    vec3 refl = efEnv(vP, R, 2.0);
    col = mix(uScatter * 0.8, refl * 1.3 + vec3(0.06, 0.08, 0.1), rim) + uSunCol * pow(max(dot(N, uSunDir), 0.0), 40.0) * 0.6;
    vec3 thr = efThrough(vP);
    col *= thr / max(max(thr.r, max(thr.g, thr.b)), 1e-3);
    a = mix(0.2, 0.85, rim) * max(max(thr.r, thr.g), thr.b);
  }
  a *= cov * vI.x;
  gl_FragColor = efPremul(col, a);
}
`

// ---------------------------------------------------------------------------------------------
// 4) Dôme : disque polaire 24 × 8, bosse gaussienne + creux qui suit, normales analytiques
// ---------------------------------------------------------------------------------------------
const DOME_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aPol;      // rho 0..1, angle
uniform vec4 uDome;       // x, z, R, h
varying vec3 vW;
varying vec3 vN;
varying float vRho;
varying float vG;
void main() {
  float R = max(uDome.z, 0.02);
  float r = aPol.x * R * 1.45;
  float sig = 0.55 * R;
  float g = exp(-r * r / (sig * sig));
  float tw = 0.22 * R, tc = 1.08 * R;
  float e = (r - tc) / tw;
  float tr = exp(-e * e);
  float y = uDome.w * (g - 0.2 * tr);
  float dy = uDome.w * (g * (-2.0 * r / (sig * sig)) - 0.2 * tr * (-2.0 * (r - tc) / (tw * tw)));
  vec2 dir = vec2(cos(aPol.y), sin(aPol.y));
  vW = vec3(uDome.x + dir.x * r, uWaterY + 0.001 + y, uDome.y + dir.y * r);
  vN = normalize(vec3(-dy * dir.x, 1.0, -dy * dir.y));
  vRho = aPol.x;
  vG = abs(dy) + g * 0.6;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
}
`
const DOME_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform vec4 uDomeK;      // niveau, -, -, -
varying vec3 vW;
varying vec3 vN;
varying float vRho;
varying float vG;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = efFresnel(NdV);
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.02); R = normalize(R);
  vec3 refl = efEnv(vW, R, 1.6 + 2.0 * (1.0 - smoothstep(0.05, 0.25, NdV)));   // flou sur le versant rasant (pas de zébrures)
  float sig = 0.16;
  float a = F + (1.0 - F) * sig;
  vec3 lin = (F * refl + (1.0 - F) * sig * uScatter) / max(a, 1e-3);
  vec2 fw = fwidth(vW.xz);
  float gl = efGlitter(vW, N, V, max(fw.x, fw.y));
  lin = mix(lin, uSunCol, min(gl, 1.0));
  a = mix(a, 1.0, min(gl, 1.0));
  a *= clamp(vG * 6.0, 0.0, 1.0) * (1.0 - smoothstep(0.72, 1.0, vRho)) * uDomeK.x * smoothstep(0.02, 0.14, NdV);
  if (a < 0.003) discard;
  gl_FragColor = efPremul(lin, a);
}
`

// ---------------------------------------------------------------------------------------------
// 5) Couronne : lame tournée 16 × 4, s'évase puis s'effondre en 0,45 s, bord déchiré
// ---------------------------------------------------------------------------------------------
const CROWN_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aLat;      // angle, v (0 eau → 1 bord)
uniform vec4 uCrown;      // x, z, R final, k
uniform vec4 uCrownT;     // âge, fondu, graine, -
varying vec3 vW;
varying vec3 vN;
varying vec2 vL;
void main() {
  float u = clamp(uCrownT.x / 0.45, 0.0, 1.0);
  float grow = 1.0 - pow(1.0 - u, 2.5);
  float k = uCrown.w;
  float rr = 0.03 + (uCrown.z - 0.03) * grow;
  vec2 dir = vec2(cos(aLat.x), sin(aLat.x));
  float n = efNoise(dir * 2.3 + uCrownT.z * 11.0);
  float H = 0.08 * k * sin(3.14159 * min(u * 1.2, 1.0)) * (0.7 + 0.6 * n);
  float v = aLat.y;
  float fl = 0.04 * k * (0.3 + grow);
  float r = rr - 0.008 * v + fl * v * v;
  float drdv = -0.008 + 2.0 * fl * v;
  vW = vec3(uCrown.x + dir.x * r, uWaterY + H * v, uCrown.y + dir.y * r);
  vec3 Tv = vec3(dir.x * drdv, max(H, 1e-4), dir.y * drdv);
  vec3 Tt = vec3(-dir.y, 0.0, dir.x);
  vN = normalize(cross(Tv, Tt));
  vL = vec2(aLat.x, v);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
}
`
const CROWN_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform vec4 uCrownT;
varying vec3 vW;
varying vec3 vN;
varying vec2 vL;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float v = vL.y;
  vec2 dir = vec2(cos(vL.x), sin(vL.x));
  float n = efNoise(dir * 5.0 + vec2(uCrownT.z * 13.0, v * 2.5));
  float cut = smoothstep(0.5, 1.0, v) * (0.55 + 0.6 * clamp(uCrownT.x / 0.45, 0.0, 1.0));
  if (n < cut) discard;                                            // doigts et trous du bord
  vec3 V = normalize(uCam - vW);
  float NdV = abs(dot(N, V));
  float F = efSchlick(NdV);
  vec3 R = reflect(-V, N);
  vec3 refl = efEnv(vW, R, 1.2);
  float foam = smoothstep(0.45, 1.0, v) * (0.55 + 0.45 * efNoise(dir * 14.0 + vec2(v * 7.0, uTime * 3.0)));
  vec3 lin = mix(uScatter * 1.8 + vec3(0.04, 0.05, 0.07), refl, 0.35 + 0.65 * F);
  lin = mix(lin, vec3(0.86, 0.9, 0.94) * (0.75 + 0.25 * uSunCol), foam * 0.7);
  lin += uSunCol * pow(max(dot(R, uSunDir), 0.0), 120.0) * 2.5;
  float a = (0.3 + 0.6 * F + foam * 0.45) * uCrownT.y * smoothstep(0.0, 0.15, v + 0.03);
  gl_FragColor = efPremul(lin, clamp(a, 0.0, 1.0));
}
`

// ---------------------------------------------------------------------------------------------
// 6) Collerette : anneau « stade » (48 segments) autour de la section à la ligne d'eau — ménisque
//    qui grimpe sur le verre (liseré argenté) + ondes sortantes qui s'éteignent à 0,3 m
// ---------------------------------------------------------------------------------------------
const COLLAR_VS = /* glsl */ `
${EF_COMMON}
attribute vec4 aCol;      // partie (0 avant, 1 bout droit, 2 arrière, 3 bout gauche), t, distance (m), hauteur (× lèvre)
uniform vec4 uSec;        // x0, x1, zc, demi-profondeur
uniform vec4 uColK;       // lèvre (m), niveau, -, -
varying vec3 vW;
varying vec2 vN2;
varying vec2 vD;
void main() {
  float part = aCol.x, t = aCol.y;
  float L = max(uSec.y - uSec.x, 0.0), hd = max(uSec.w, 0.005);
  vec2 p, n;
  if (part < 0.5) { p = vec2(uSec.x + L * t, uSec.z + hd); n = vec2(0.0, 1.0); }
  else if (part < 1.5) { float a = 1.5708 - 3.14159 * t; n = vec2(cos(a), sin(a)); p = vec2(uSec.y, uSec.z) + n * hd; }
  else if (part < 2.5) { p = vec2(uSec.y - L * t, uSec.z - hd); n = vec2(0.0, -1.0); }
  else { float a = -1.5708 - 3.14159 * t; n = vec2(cos(a), sin(a)); p = vec2(uSec.x, uSec.z) + n * hd; }
  float d = aCol.z + 0.003;                                         // décollé de 3 mm du verre
  vW = vec3(p.x + n.x * d, uWaterY + max(aCol.w * uColK.x, 0.0015), p.y + n.y * d);
  vN2 = n;
  vD = aCol.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
}
`
const COLLAR_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform vec4 uColK;
varying vec3 vW;
varying vec2 vN2;
varying vec2 vD;
void main() {
  vec3 V = normalize(uCam - vW);
  vec3 no = vec3(vN2.x, 0.0, vN2.y);
  float d = vD.x;
  vec3 lin;
  float a;
  if (d < 0.0125) {
    // film du ménisque : vertical contre le verre, horizontal 1,2 cm plus loin
    float k = clamp(vD.y, 0.0, 1.0);
    vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), no, 0.3 + 0.65 * k));
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    float F = efFresnel(NdV);
    vec3 R = reflect(-V, N);
    vec3 refl = efEnv(vW, R, 0.6);
    float line = smoothstep(0.55, 0.9, k) * (1.0 - smoothstep(0.93, 1.0, k));   // liseré argenté en haut du film
    lin = F * refl + (1.0 - F) * uScatter + vec3(0.85, 0.9, 0.95) * line * 0.45;
    lin += uSunCol * pow(max(dot(R, uSunDir), 0.0), 60.0) * 1.0;
    a = clamp(0.22 + 0.5 * F + line * 0.35, 0.0, 1.0) * (1.0 - 0.7 * smoothstep(0.93, 1.0, k));
  } else {
    // ondes sortantes (cos), longueur d'onde 3,2 cm, éteintes à 0,3 m
    float x = d - 0.0125;
    float ph = 6.2832 * x / 0.032 - uTime * 11.0;
    float env = exp(-x / 0.09) * (1.0 - smoothstep(0.18, 0.3, d));
    float slope = clamp(-0.0016 * env * 196.0 * sin(ph), -0.5, 0.5);
    vec3 N = normalize(vec3(-slope * no.x, 1.0, -slope * no.z));
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    float F = efFresnel(NdV);
    vec3 R = reflect(-V, N); R.y = max(R.y, 0.02); R = normalize(R);
    lin = F * efEnv(vW, R, 1.0) + (1.0 - F) * uScatter * 0.9;
    a = clamp(abs(slope) * 6.0, 0.0, 0.85) * (0.4 + 0.6 * env) + smoothstep(0.03, 0.0125, d) * 0.35;
  }
  a *= uColK.y;
  if (a < 0.003) discard;
  gl_FragColor = efPremul(lin, a);
}
`

// ---------------------------------------------------------------------------------------------
// 7) Colonne d'eau sous la base : tour 12 × 8, r de 0,09 m qui s'étrangle jusqu'à 0, ≤ 0,16 m
// ---------------------------------------------------------------------------------------------
const NECK_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aLat;      // angle, v (0 eau → 1 base)
uniform vec4 uNeck;       // base x, y, z, niveau
varying vec3 vW;
varying vec3 vN;
varying float vV;
float neckR(float v, float k) {
  float rW = mix(0.045, 0.004, pow(k, 0.7));                       // taille qui s'étrangle
  float rT = mix(0.065, 0.014, k);                                  // attache sous la base
  float foot = pow(max(1.0 - v / 0.62, 0.0), 2.2);
  return v < 0.62 ? rW + (0.09 - rW) * foot : mix(rW, rT, smoothstep(0.62, 1.0, v));
}
void main() {
  float H = max(uNeck.y - uWaterY, 0.002);
  float k = clamp(H / 0.16, 0.0, 1.0);
  float v = aLat.y;
  float r = neckR(v, k);
  float drdv = (neckR(min(v + 0.02, 1.0), k) - neckR(max(v - 0.02, 0.0), k)) / (min(v + 0.02, 1.0) - max(v - 0.02, 0.0));
  vec2 dir = vec2(cos(aLat.x), sin(aLat.x));
  float sway = 0.004 * sin(uTime * 7.0 + v * 4.0) * v;
  vW = vec3(uNeck.x + dir.x * r + sway, uWaterY + H * v, uNeck.z + dir.y * r);
  vec3 Tv = vec3(dir.x * drdv, H, dir.y * drdv);
  vec3 Tt = vec3(-dir.y, 0.0, dir.x);
  vN = normalize(cross(Tv, Tt));
  vV = v;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vW, 1.0);
}
`
const NECK_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform vec4 uNeck;
varying vec3 vW;
varying vec3 vN;
varying float vV;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = efSchlick(NdV);
  vec3 R = reflect(-V, N);
  vec3 refl = efEnv(vW, R, 1.0);
  float edge = pow(1.0 - NdV, 2.0);
  vec3 lin = mix(efSky(vec3(0.0, 1.0, 0.0)) * 0.55, refl * 1.15, 0.45 + 0.55 * edge);
  lin += uSunCol * pow(max(dot(R, uSunDir), 0.0), 90.0) * 2.0;
  float a = (0.22 + 0.65 * edge + 0.25 * F) * uNeck.w * smoothstep(0.0, 0.18, vV);
  gl_FragColor = efPremul(lin, clamp(a, 0.0, 1.0));
}
`

// ---------------------------------------------------------------------------------------------
// 8) Tapis de scintillements (finale) : 120 points dorés sur l'eau le long d'un segment
// ---------------------------------------------------------------------------------------------
const CARPET_VS = /* glsl */ `
${EF_COMMON}
attribute vec4 aS;        // abscisse 0..1, latéral −1..1, phase, taille (m)
uniform vec4 uSeg;        // x0, z0, x1, z1
uniform vec4 uCarp;       // t0, durée, niveau, demi-largeur (m)
uniform float uPx;
uniform float uWorldScale;
varying float vI;
void main() {
  vec2 A = uSeg.xy, B = uSeg.zw;
  vec2 dir = B - A;
  float L = max(length(dir), 1e-4);
  dir /= L;
  vec2 q = A + dir * L * aS.x + vec2(-dir.y, dir.x) * aS.y * uCarp.w;
  vec3 P = vec3(q.x, uWaterY + 0.004, q.y);
  float lt = uTime - uCarp.x;
  float st = aS.x * 0.45 * uCarp.y;
  float env = smoothstep(st, st + 0.35, lt) * (1.0 - smoothstep(uCarp.y - 0.9, uCarp.y, lt));
  float tw = 0.18 + 1.6 * pow(0.5 + 0.5 * sin(uTime * (4.0 + 7.0 * fract(aS.z * 7.3)) + aS.z * 40.0), 10.0);
  vI = env * tw * uCarp.z;
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aS.w * uWorldScale * projectionMatrix[1][1] * uPx / max(-mv.z, 1e-3);
  gl_PointSize = vI > 0.003 ? clamp(px * (0.7 + 0.4 * tw), 2.0, 9.0) : 0.0;
}
`
const CARPET_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform vec3 uGold;
varying float vI;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float core = exp(-r2 * 6.0);
  float rays = exp(-abs(c.x) * 26.0) * exp(-abs(c.y) * 4.0) + exp(-abs(c.y) * 26.0) * exp(-abs(c.x) * 4.0);
  float i = (core + 0.45 * rays) * vI;
  if (i < 0.003) discard;
  gl_FragColor = vec4(efAdd(uGold * i), 0.0);
}
`

// ---------------------------------------------------------------------------------------------
// 9) Reflet (P2) : imposteur miroir de PB_ReflProxy par rapport au plan d'eau. Le fragment prend le
//    point où le rayon caméra → point miroir traverse l'eau : hors du bassin il est rejeté, sinon il
//    écrit la profondeur de CE point (gl_FragDepth, depthWrite false) : le flacon réel, la margelle et
//    tout ce qui est devant l'eau le masquent correctement. Fresnel de l'eau × 0,9. Ondule avec la houle.
// ---------------------------------------------------------------------------------------------
const REFL_VS = /* glsl */ `
${EF_COMMON}
uniform mat4 uToGarden;   // objet → jardin, miroir compris (S · G⁻¹ · matrixWorld du proxy)
uniform mat4 uGardenVP;   // jardin → clip (projection · vue · G)
uniform float uReflWob;
varying vec3 vW;          // point miroir (sous l'eau), repère jardin
varying vec3 vN;          // normale du point RÉEL correspondant
varying vec3 vC;
void main() {
#if defined(USE_COLOR_ALPHA)
  vC = color.rgb;
#elif defined(USE_COLOR)
  vC = color;
#else
  vC = vec3(0.07, 0.16, 0.62);
#endif
  vec3 W = (uToGarden * vec4(position, 1.0)).xyz;
  vec3 n = normalize(mat3(uToGarden) * normal);
  vN = vec3(n.x, -n.y, n.z);
  // houle de gardenFx (dérivée exacte de swellHeight) : le reflet se décale de 2·d·pente
  float d = max(uWaterY - W.y, 0.0);
  float a1 = (0.8 * W.x + 0.6 * W.z) * 7.0 + uTime * 1.25;
  float a2 = (-0.45 * W.x + 0.89 * W.z) * 11.0 + uTime * 1.7;
  float a3 = (0.97 * W.x - 0.24 * W.z) * 19.0 - uTime * 2.3;
  vec2 g = vec2(0.00896, 0.00672) * cos(a1) + vec2(-0.00594, 0.011748) * cos(a2) + vec2(0.011058, -0.002736) * cos(a3);
  W.xz += 2.0 * d * g * uReflWob;
  vW = W;
  gl_Position = uGardenVP * vec4(W, 1.0);
}
`
const REFL_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
uniform mat4 uGardenVP;
uniform float uReflA;
varying vec3 vW;
varying vec3 vN;
varying vec3 vC;
void main() {
  vec3 d = vW - uCam;
  if (d.y > -1e-5) discard;
  float t = (uWaterY - uCam.y) / d.y;
  if (t <= 0.0 || t >= 1.0) discard;                 // partie réelle sous l'eau : pas de reflet
  vec3 H = uCam + d * t;
  float m = 0.012;
  float edge = smoothstep(uPool.x, uPool.x + m, H.x) * smoothstep(uPool.y, uPool.y - m, H.x)
             * smoothstep(uPool.z, uPool.z + m, H.z) * smoothstep(uPool.w, uPool.w - m, H.z);
  if (edge <= 0.0) discard;
  vec4 c = uGardenVP * vec4(H, 1.0);
  gl_FragDepth = clamp(0.5 * c.z / c.w + 0.5, 0.0, 1.0);
  // le point réel, vu depuis H (= depuis la caméra miroir)
  vec3 Pr = vec3(vW.x, 2.0 * uWaterY - vW.y, vW.z);
  vec3 V = normalize(H - Pr);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  float lam = max(dot(N, uSunDir), 0.0);
  float gold = step(vC.b, vC.r);
  vec3 env = efEnv(Pr, R, 2.0);
  vec3 col;
  if (gold > 0.5) {
    col = vC * (env * 1.1 + uSunCol * lam * 0.35) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 60.0) * 1.5;
  } else {
    float Fg = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
    col = vC * 0.42 * (0.35 + 0.65 * lam) + env * Fg + uSunCol * pow(max(dot(R, uSunDir), 0.0), 200.0) * 2.0;
  }
  // L'eau de gardenFx contient déjà F·(reflet de la cour) : un simple « F par-dessus » ne l'atténue que de
  // (1 − F) et un flacon sombre disparaît dans le miroir clair. On REMPLACE donc le pixel d'eau comme les
  // anneaux : F·flacon + (A − F)·transmis estimé (#0a1a44), alpha A = 3F (≈ 0 en plongée, 0,95 en rasant).
  float NdVw = clamp(normalize(uCam - H).y, 0.0, 1.0);
  float F = efFresnel(NdVw) * 0.9;
  float A = clamp(F * 3.0, 0.0, 0.95);
  vec3 lin = (F * col + max(A - F, 0.0) * uScatter * 0.9) / max(A, 1e-3);
  float a = A * uReflA * edge * (1.0 - 0.35 * smoothstep(0.2, 0.9, uWaterY - vW.y));
  if (a < 0.003) discard;
  gl_FragColor = efPremul(lin, a);
}
`

// ---------------------------------------------------------------------------------------------
// 10) Sillage du doigt : éclats d'écume, scintillements et embruns — quads face caméra instanciés
//     (anneau tournant de 64), 1 draw call. Trajectoires calculées dans le vertex shader (le CPU n'écrit
//     qu'à la naissance d'un sprite). Taille ≥ uMinPx px (comme les gouttes) : lisible à 8-13 m.
// ---------------------------------------------------------------------------------------------
const WAKE_VS = /* glsl */ `
${EF_COMMON}
attribute vec2 aCorner;
attribute vec4 aS0;   // x, y, z, t0
attribute vec4 aS1;   // vitesse xyz, durée de vie
attribute vec4 aS2;   // taille (m), type (0 écume, 1 éclat, 2 embrun), graine, -
uniform float uPx;
uniform float uWorldScale;
uniform float uMinPx;
varying vec2 vC;
varying vec4 vI;      // alpha, type, graine, âge relatif
void main() {
  float life = max(aS1.w, 0.05);
  float age = uTime - aS0.w;
  float u = age / life;
  float kind = aS2.y;
  vec3 P = aS0.xyz;
  float a = step(0.0, age) * step(age, life);
  if (kind < 1.5) {
    // écume / éclat : posés sur l'eau, chassés par le doigt puis freinés
    P.xz += aS1.xz * (1.0 - exp(-age * 2.2)) / 2.2;
    P.y = uWaterY + 0.006;
  } else {
    // embrun : balistique, éteint sous la surface
    P += aS1.xyz * age;
    P.y -= 4.905 * age * age;
    a *= step(uWaterY, P.y);
  }
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  float pxPerM = projectionMatrix[1][1] * uPx * uWorldScale / max(-mv.z, 1e-3);
  float size = aS2.x * (kind < 0.5 ? 0.6 + 0.9 * sqrt(clamp(u, 0.0, 1.0)) : 1.0);
  float minPx = kind > 0.5 && kind < 1.5 ? uMinPx * 1.3 : uMinPx;
  float rPx = size * pxPerM;
  float k = max(1.0, minPx / max(rPx, 1e-4));
  float rad = size * k;
  if (kind < 0.5) a *= smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.45, 1.0, u));
  else if (kind < 1.5) a *= sin(3.14159 * clamp(u, 0.0, 1.0)) * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (17.0 + 23.0 * aS2.z) + aS2.z * 40.0), 4.0));
  else a *= 1.0 - smoothstep(0.75, 1.0, u);
  a *= mix(0.55, 1.0, clamp(rPx / minPx, 0.0, 1.0));     // même énergie quand la taille est relevée
  // écume couchée sur l'eau : aplatie selon l'angle de vue (vue rasante ⇒ ellipse fine, ≥ minPx)
  vec2 sc = vec2(rad);
  if (kind < 0.5) {
    float el = clamp(abs(normalize(uCam - P).y), 0.2, 1.0);
    sc.y = max(rad * el, minPx / pxPerM);
  }
  mv.xy += aCorner * sc * uWorldScale;                     // tailles en m jardin → repère vue (échelle du groupe)
  vC = aCorner;
  vI = vec4(a, kind, aS2.z, u);
  gl_Position = projectionMatrix * (a > 0.0 ? mv : vec4(0.0, 0.0, 2.0, 1.0));
}
`
const WAKE_FS = /* glsl */ `
${EF_COMMON}
${EF_FRAG}
varying vec2 vC;
varying vec4 vI;
void main() {
  float r2 = dot(vC, vC);
  if (r2 > 1.0 || vI.x < 0.003) discard;
  float kind = vI.y;
  if (kind > 0.5 && kind < 1.5) {
    // éclat de soleil : cœur + croix, additif
    float rays = exp(-abs(vC.x) * 14.0) * exp(-abs(vC.y) * 2.2) + exp(-abs(vC.y) * 14.0) * exp(-abs(vC.x) * 2.2);
    gl_FragColor = vec4(efAdd(uSunCol * (exp(-r2 * 16.0) * 2.4 + rays * 0.8) * vI.x), 0.0);
    return;
  }
  vec3 col;
  float a;
  if (kind < 0.5) {
    // écume : tache laiteuse au bord irrégulier, éclairée par le soleil et le ciel
    float n = efNoise(vC * 2.5 + vI.z * 31.0);
    float m = smoothstep(1.0, 0.35, r2 + (n - 0.5) * 0.55);
    col = vec3(0.84, 0.88, 0.93) * (0.55 + 0.45 * uSunCol) + efSky(vec3(0.0, 1.0, 0.0)) * 0.12;
    a = m * vI.x * 0.9;
  } else {
    // embrun : goutte claire, reflet du ciel et point de soleil
    float m = 1.0 - smoothstep(0.55, 1.0, r2);
    col = mix(efSky(vec3(0.0, 1.0, 0.0)), vec3(0.95), 0.4) + uSunCol * exp(-r2 * 6.0) * 1.2;
    a = m * vI.x * 0.85;
  }
  if (a < 0.003) discard;
  gl_FragColor = efPremul(col, a);
}
`

// ---------------------------------------------------------------------------------------------
// Géométries
// ---------------------------------------------------------------------------------------------
function quadInstanced(corners, maxInstances) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.instanceCount = 0
  g.userData.max = maxInstances
  return g
}
function instAttr(g, name, n, size) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size)
  a.setUsage(THREE.DynamicDrawUsage)
  g.setAttribute(name, a)
  return a
}
function buildRingGeometry(seg = 32) {
  const g = new THREE.InstancedBufferGeometry()
  const ring = [], idx = []
  for (let k = 0; k <= seg; k++) { const a = (k / seg) * TAU; ring.push(a, -1, a, 1) }
  for (let k = 0; k < seg; k++) { const i = k * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3) } // CCW vu d'en haut
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((seg + 1) * 2 * 3), 3))
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 2))
  g.setIndex(idx)
  g.instanceCount = 0
  return g
}
function buildPolarGeometry(na = 24, nr = 8) {
  const pol = [], idx = []
  for (let j = 0; j <= nr; j++) for (let i = 0; i <= na; i++) pol.push(j / nr, (i / na) * TAU)
  for (let j = 0; j < nr; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1
    if (j === 0) idx.push(a, d, c); else idx.push(a, b, c, b, d, c) // CCW vu d'en haut
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((nr + 1) * (na + 1) * 3), 3))
  g.setAttribute('aPol', new THREE.Float32BufferAttribute(pol, 2))
  g.setIndex(idx)
  return g
}
function buildLatheGeometry(na, nv) {
  const lat = [], idx = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= na; i++) lat.push((i / na) * TAU, j / nv)
  for (let j = 0; j < nv; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1
    idx.push(a, c, b, b, c, d) // CCW vu de l'extérieur
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((nv + 1) * (na + 1) * 3), 3))
  g.setAttribute('aLat', new THREE.Float32BufferAttribute(lat, 2))
  g.setIndex(idx)
  return g
}
function buildCollarGeometry() {
  // 48 points du périmètre (12 par partie) × 5 rangées (distance au verre, hauteur × lèvre)
  const ROWS = [[0.0, 1.0], [0.004, 0.35], [0.0125, 0.0], [0.08, 0.0], [0.3, 0.0]]
  const N = 48, col = [], idx = []
  for (const [d, h] of ROWS) for (let k = 0; k < N; k++) col.push(Math.floor(k / 12), (k % 12) / 12, d, h)
  for (let r = 0; r < ROWS.length - 1; r++) for (let k = 0; k < N; k++) {
    const a = r * N + k, b = r * N + ((k + 1) % N), c = a + N, d = b + N
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ROWS.length * N * 3), 3))
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 4))
  g.setIndex(idx)
  return g
}

// petit interpolateur (sans allocation)
function tween(v = 0) { return { v, from: v, to: v, t: 0, dur: 0 } }
function tweenTo(tw, to, dur) { tw.from = tw.v; tw.to = to; tw.t = 0; tw.dur = Math.max(dur || 0, 0) ; if (tw.dur === 0) tw.v = to }
function tweenStep(tw, dt) {
  if (tw.v === tw.to) return tw.v
  tw.t += dt
  tw.v = tw.dur > 0 && tw.t < tw.dur ? tw.from + (tw.to - tw.from) * smooth01(tw.t / tw.dur) : tw.to
  return tw.v
}
const setV3 = (out, p, y) => {
  if (!p) return out
  if (Array.isArray(p) || ArrayBuffer.isView(p)) return p.length >= 3 ? out.set(p[0], p[1], p[2]) : out.set(p[0], y ?? out.y, p[1])
  return out.set(p.x, p.y ?? y ?? out.y, p.z)
}

// ---------------------------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {THREE.Object3D} o.parent        gardenRoot (repère jardin, mètres)
 * @param {object} [o.water]               instance createGardenFX (API publique seulement)
 * @param {object} [o.probes]              résultat de loadReflectionProbes() (ou CubeTexture du bassin long)
 * @param {THREE.Vector3|number[]} [o.sunDir]  direction VERS le soleil (repère jardin)
 * @param {'high'|'medium'|'low'} [o.quality]
 * @param {number} [o.renderOrderBase]     base des renderOrder (0 = celle de gardenFx)
 * @param {object} [o.splashRules]         PB_CFG.splash
 * @param {object} [o.pool], [o.room]      surcharges des rectangles du bassin long / de la cour
 * @param {(entry) => void} [o.onLog]      journal de l'ordonnanceur (page de test)
 */
export function createEmergeFX({
  parent, water = null, probes = null, sunDir, quality = 'high', renderOrderBase = 0,
  splashRules = PB_CFG.splash, pool = {}, room = {}, onLog = null, seed = 11,
} = {}) {
  const P = { ...DEFAULT_POOL, ...pool }
  const Ro = { ...DEFAULT_ROOM, ...room }
  const rules = { ...DEFAULT_SPLASH, ...(splashRules || {}) }
  let Q = QUALITY[quality] || QUALITY.high
  let qName = QUALITY[quality] ? quality : 'high'
  // état du générateur dans un Int32Array : un int32 hors de la plage SMI (31 bits) dans une variable de
  // fermeture serait ré-alloué (HeapNumber) à chaque tirage
  const rngS = new Int32Array(1)
  rngS[0] = seed | 0
  const rnd = () => { const s = (rngS[0] = (rngS[0] + 0x6d2b79f5) | 0); let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

  const sun = (sunDir ? (Array.isArray(sunDir) ? new THREE.Vector3(...sunDir) : new THREE.Vector3().copy(sunDir)) : new THREE.Vector3(-0.52, 0.76, 0.38)).normalize()
  if (sun.y < 0) sun.negate()

  const probeTex = probes ? (probes.isTexture ? probes : probes.pool?.texture || null) : null
  const probePos = probes && !probes.isTexture && probes.pool?.position ? probes.pool.position : POOL_PROBE_POS

  const U = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3(0, 1.64, 6.66) },
    uSunDir: { value: sun },
    uSunCol: { value: new THREE.Color().setRGB(1.0, 0.86, 0.68) },
    uSkyZen: { value: new THREE.Color('#8fb4e0') },
    uSkyHor: { value: new THREE.Color('#efe6d8') },
    uScatter: { value: new THREE.Color('#0a1a44') },
    uWallCol: { value: new THREE.Color('#2546d8') },
    uPool: { value: new THREE.Vector4(P.x0, P.x1, P.z0, P.z1) },
    uWaterY: { value: P.waterY },
    uRoom: { value: new THREE.Vector4(Ro.x0, Ro.x1, Ro.zBack, Ro.zFront) },
    uWallH: { value: Ro.wallH },
    uProbe: { value: probeTex },
    uProbeP: { value: new THREE.Vector3().fromArray(probePos) },
    uHasProbe: { value: probeTex ? 1 : 0 },
    uGlit: { value: Q.glitter },
    uBgEst: { value: new THREE.Vector3(0.006, 0.012, 0.045) },
    uPx: { value: 800 },
    uWorldScale: { value: 1 },
  }
  const RO = (k) => renderOrderBase + (PB_RENDER_ORDER[k] ?? LOCAL_RENDER_ORDER[k])
  const group = new THREE.Group()
  group.name = 'PB_EmergeFX'
  const shaderMat = (vs, fs, extra = {}, opts = {}) => new THREE.ShaderMaterial({
    uniforms: { ...U, ...extra }, vertexShader: vs, fragmentShader: fs,
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    ...opts,
  })
  const additive = { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }
  const meshes = []
  const addMesh = (m, ro, name) => { m.renderOrder = ro; m.frustumCulled = false; m.visible = false; m.name = name; group.add(m); meshes.push(m); return m }
  const pxBuf = new THREE.Vector2()
  const pxHook = (renderer) => { renderer.getDrawingBufferSize(pxBuf); U.uPx.value = pxBuf.y * 0.5; U.uWorldScale.value = group.matrixWorld.getMaxScaleOnAxis() }

  // ============================== glow ==============================
  const archTex = makeArchGlowTexture()
  const glowGeo = quadInstanced([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 3)
  const gA0 = instAttr(glowGeo, 'aG0', 3, 4), gA1 = instAttr(glowGeo, 'aG1', 3, 4), gA2 = instAttr(glowGeo, 'aG2', 3, 4)
  glowGeo.instanceCount = 3
  const glowU = { uArch: { value: archTex }, uMaj: { value: C_MAJ }, uGold: { value: C_GOLD }, uPhys: { value: 0.55 }, uGain: { value: 0.42 }, uLift: { value: 1.0 }, uGraze: { value: 0.4 }, uVeil: { value: 1.6 } }
  // additif (alpha 0) ; aux vues rasantes un peu d'alpha « par-dessus » voile le miroir (cf. GLOW_FS)
  const glowMesh = addMesh(new THREE.Mesh(glowGeo, shaderMat(GLOW_VS, GLOW_FS, glowU)), RO('glow'), 'PB_EmergeGlow')
  const glow = {
    lvl: tween(0), x: 0.02, y: -0.24, z: -2.68, phi: -90 * DEG,
    beatP: 0, beatAmp: 1, phase: 0,
    patch: tween(0), sx: 0, sz: -2.8,
    spare: tween(0), px: 0, py: -0.1, pz: -2.0, pr: 0.25, pc: new THREE.Vector3(0.55, 0.7, 1.0), pUnder: 1,
    displayed: 0,
  }
  const spareCol = new THREE.Color()

  // ============================== rings ==============================
  const ringGeo = buildRingGeometry(32)
  const rA0 = instAttr(ringGeo, 'aR0', MAX_RINGS, 4), rA1 = instAttr(ringGeo, 'aR1', MAX_RINGS, 4)
  const ringMesh = addMesh(new THREE.Mesh(ringGeo, shaderMat(RING_VS, RING_FS)), RO('rings'), 'PB_EmergeRings')
  const RG = { x: new Float32Array(MAX_RINGS), z: new Float32Array(MAX_RINGS), y: new Float32Array(MAX_RINGS), t0: new Float32Array(MAX_RINGS), amp: new Float32Array(MAX_RINGS), r1: new Float32Array(MAX_RINGS), life: new Float32Array(MAX_RINGS), n: 0, dirty: false, total: 0 }

  // ============================== drops ==============================
  const dropGeo = quadInstanced([-1, -1, 1, -1, 1, 1, -1, 1], MAX_DROPS)
  const dA0 = instAttr(dropGeo, 'aD0', MAX_DROPS, 4), dA1 = instAttr(dropGeo, 'aD1', MAX_DROPS, 4), dA2 = instAttr(dropGeo, 'aD2', MAX_DROPS, 4)
  const dropU = { uMinPx: { value: 2.4 } }
  const dropMesh = addMesh(new THREE.Mesh(dropGeo, shaderMat(DROP_VS, DROP_FS, dropU)), RO('drops'), 'PB_EmergeDrops')
  dropMesh.onBeforeRender = pxHook
  const DR = {
    mode: new Uint8Array(MAX_DROPS),          // 0 libre, 1 chute, 2 pendante, 3 bulle
    px: new Float32Array(MAX_DROPS), py: new Float32Array(MAX_DROPS), pz: new Float32Array(MAX_DROPS),
    vx: new Float32Array(MAX_DROPS), vy: new Float32Array(MAX_DROPS), vz: new Float32Array(MAX_DROPS),
    size: new Float32Array(MAX_DROPS), sizeT: new Float32Array(MAX_DROPS), age: new Float32Array(MAX_DROPS),
    anchor: new Int16Array(MAX_DROPS), stretch: new Float32Array(MAX_DROPS), seed: new Float32Array(MAX_DROPS),
    ax: new Float32Array(MAX_DROPS), ay: new Float32Array(MAX_DROPS), az: new Float32Array(MAX_DROPS),
    nDrops: 0, nBubbles: 0, landed: 0,
  }
  const pend = { fn: null, rate: 0, acc: 0, pts: Array.from({ length: MAX_PEND_PTS }, () => new THREE.Vector3()), n: 0 }

  // ============================== dome ==============================
  const domeU = { uDome: { value: new THREE.Vector4(0, -2.8, 0.25, 0) }, uDomeK: { value: new THREE.Vector4(1, 0, 0, 0) } }
  const domeMesh = addMesh(new THREE.Mesh(buildPolarGeometry(24, 8), shaderMat(DOME_VS, DOME_FS, domeU)), RO('dome'), 'PB_EmergeDome')
  const dome = { h: tween(0), on: false }

  // ============================== crown ==============================
  const crownU = { uCrown: { value: new THREE.Vector4(0, -2.8, 0.12, 0.9) }, uCrownT: { value: new THREE.Vector4(0, 0, 0, 0) } }
  const crownMesh = addMesh(new THREE.Mesh(buildLatheGeometry(16, 4), shaderMat(CROWN_VS, CROWN_FS, crownU, { side: THREE.DoubleSide })), RO('crown'), 'PB_EmergeCrown')
  const crown = { on: false, t: 0, spawned: false, x: 0, z: 0, R: 0.12, k: 0.9 }

  // ============================== collar ==============================
  const collarU = { uSec: { value: new THREE.Vector4(-0.1, 0.1, -2.8, 0.095) }, uColK: { value: new THREE.Vector4(0.025, 0, 0, 0) } }
  const collarMesh = addMesh(new THREE.Mesh(buildCollarGeometry(), shaderMat(COLLAR_VS, COLLAR_FS, collarU)), RO('collar'), 'PB_EmergeCollar')
  const collar = { lvl: tween(0) }

  // ============================== neck ==============================
  const neckU = { uNeck: { value: new THREE.Vector4(0, 0, -2.8, 0) } }
  const neckMesh = addMesh(new THREE.Mesh(buildLatheGeometry(12, 8), shaderMat(NECK_VS, NECK_FS, neckU)), RO('neck'), 'PB_EmergeNeck')
  const neck = { fn: null, lvl: tween(0), H: 0, p: new THREE.Vector3() }

  // ============================== carpet ==============================
  const carpetGeo = new THREE.BufferGeometry()
  {
    const s = new Float32Array(MAX_CARPET * 4)
    for (let i = 0; i < MAX_CARPET; i++) s.set([rnd(), (rnd() * 2 - 1) * Math.pow(rnd(), 0.6), rnd(), 0.004 + 0.006 * rnd()], i * 4)
    carpetGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_CARPET * 3), 3))
    carpetGeo.setAttribute('aS', new THREE.Float32BufferAttribute(s, 4))
  }
  const carpetU = { uSeg: { value: new THREE.Vector4(0, -1.9, 0, -4.6) }, uCarp: { value: new THREE.Vector4(-100, 3, 1, 0.22) }, uGold: { value: new THREE.Vector3(1.0, 0.84, 0.52) } }
  const carpetMesh = addMesh(new THREE.Points(carpetGeo, shaderMat(CARPET_VS, CARPET_FS, carpetU, additive)), RO('carpet'), 'PB_EmergeCarpet')
  carpetMesh.onBeforeRender = pxHook
  const carpet = { on: false, end: 0 }

  // ============================== reflect (P2) ==============================
  // Géométrie de remplacement (couleurs vec4 comme COLOR_0 du GLB) : le programme se compile au prewarm.
  const reflPh = new THREE.BufferGeometry()
  reflPh.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  reflPh.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3))
  reflPh.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12), 4))
  const reflU = { uToGarden: { value: new THREE.Matrix4() }, uGardenVP: { value: new THREE.Matrix4() }, uReflA: { value: 0 }, uReflWob: { value: 1 } }
  // le miroir inverse l'ordre des sommets : BackSide garde exactement les faces avant de l'image
  const reflMesh = addMesh(new THREE.Mesh(reflPh, shaderMat(REFL_VS, REFL_FS, reflU, { side: THREE.BackSide, vertexColors: true })), RO('refl'), 'PB_EmergeReflect')
  const MIRROR = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 2 * P.waterY, 0, 0, 1, 0, 0, 0, 0, 1)
  const refl = { obj: null, op: 1, a: 0, box: new THREE.Box3(), m: new THREE.Matrix4(), inv: new THREE.Matrix4(), c: new THREE.Vector3() }
  const reflToGarden = () => {
    refl.inv.copy(group.matrixWorld).invert()
    reflU.uToGarden.value.copy(MIRROR).multiply(refl.inv).multiply(refl.obj.matrixWorld)
  }
  reflMesh.onBeforeRender = (renderer, scene, camera) => {
    // au moment du rendu les matrices monde sont à jour (scene.updateMatrixWorld) : pas de retard d'une image
    reflU.uGardenVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.matrixWorld)
    if (refl.obj) reflToGarden()
  }

  // ============================== wake : sprites (écume, éclats, embruns) ==============================
  const wsGeo = quadInstanced([-1, -1, 1, -1, 1, 1, -1, 1], MAX_WAKE_SPR)
  const wsA0 = instAttr(wsGeo, 'aS0', MAX_WAKE_SPR, 4), wsA1 = instAttr(wsGeo, 'aS1', MAX_WAKE_SPR, 4), wsA2 = instAttr(wsGeo, 'aS2', MAX_WAKE_SPR, 4)
  wsA0.array.fill(-100) // t0 très ancien : tous éteints
  wsGeo.instanceCount = MAX_WAKE_SPR
  const wsU = { uMinPx: { value: 2.2 } }
  const wsMesh = addMesh(new THREE.Mesh(wsGeo, shaderMat(WAKE_VS, WAKE_FS, wsU)), RO('wake'), 'PB_EmergeWake')
  wsMesh.onBeforeRender = pxHook
  const WS = { cursor: 0, end: -1, dirty: false, spawned: 0 }

  if (parent) parent.add(group)

  // ============================== état commun ==============================
  const clk = new Float64Array(1) // horloge : un double dans une variable de fermeture serait réalloué à chaque image
  let frame = 0
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3()
  const invM = new THREE.Matrix4(), camW = new THREE.Vector3()
  const inPool = (x, z, m = 0) => x >= P.x0 + m && x <= P.x1 - m && z >= P.z0 + m && z <= P.z1 - m

  // ============================== rings API ==============================
  function ringAdd(x, z, amp = 0.5, opts) { return ringRaw(x, z, amp, opts?.r1 ?? 0.35, opts?.life ?? 1.6, opts?.y ?? P.waterY) }
  function ringRaw(x, z, amp, r1, life, y) {
    let i = RG.n
    if (i >= MAX_RINGS) { // remplace le plus ancien
      let best = 0
      for (let j = 1; j < MAX_RINGS; j++) if (RG.t0[j] < RG.t0[best]) best = j
      i = best
    } else RG.n++
    RG.x[i] = x; RG.z[i] = z; RG.y[i] = y; RG.t0[i] = clk[0]; RG.amp[i] = clamp(amp, 0, 1.5); RG.r1[i] = r1; RG.life[i] = life
    RG.dirty = true
    RG.total++
    return i
  }
  function ringsUpdate() {
    for (let i = RG.n - 1; i >= 0; i--) {
      if (clk[0] - RG.t0[i] > RG.life[i]) {
        const l = --RG.n
        if (i !== l) { RG.x[i] = RG.x[l]; RG.z[i] = RG.z[l]; RG.y[i] = RG.y[l]; RG.t0[i] = RG.t0[l]; RG.amp[i] = RG.amp[l]; RG.r1[i] = RG.r1[l]; RG.life[i] = RG.life[l] }
        RG.dirty = true
      }
    }
    if (RG.dirty) {
      const a0 = rA0.array, a1 = rA1.array
      for (let i = 0; i < RG.n; i++) {
        a0[i * 4] = RG.x[i]; a0[i * 4 + 1] = RG.z[i]; a0[i * 4 + 2] = RG.t0[i]; a0[i * 4 + 3] = RG.amp[i]
        a1[i * 4] = RG.r1[i]; a1[i * 4 + 1] = RG.life[i]; a1[i * 4 + 2] = RG.y[i]; a1[i * 4 + 3] = 0
      }
      rA0.needsUpdate = true; rA1.needsUpdate = true // envoi complet (384 o) : addUpdateRange() alloue un objet par appel
      RG.dirty = false
    }
    ringGeo.instanceCount = RG.n
    ringMesh.visible = RG.n > 0
  }

  // ============================== drops API ==============================
  function dropSlot(mode) {
    const cap = mode === 3 ? Q.bubbles : Q.drops
    if ((mode === 3 ? DR.nBubbles : DR.nDrops) >= cap) return -1
    for (let i = 0; i < MAX_DROPS; i++) if (DR.mode[i] === 0) { DR.mode[i] = mode; if (mode === 3) DR.nBubbles++; else DR.nDrops++; return i }
    return -1
  }
  function dropKill(i) { if (DR.mode[i] === 3) DR.nBubbles--; else if (DR.mode[i]) DR.nDrops--; DR.mode[i] = 0 }
  function dropSpawn(p, v, size = 0.004) {
    const i = dropSlot(1)
    if (i < 0) return -1
    setV3(v3, p, 0); DR.px[i] = v3.x; DR.py[i] = v3.y; DR.pz[i] = v3.z
    if (v) { setV3(v3, v, 0); DR.vx[i] = v3.x; DR.vy[i] = v3.y; DR.vz[i] = v3.z } else { DR.vx[i] = DR.vy[i] = DR.vz[i] = 0 }
    DR.size[i] = DR.sizeT[i] = size; DR.age[i] = 0; DR.stretch[i] = 1; DR.seed[i] = rnd(); DR.anchor[i] = -1
    return i
  }
  function readPendant() {
    pend.n = 0
    if (!pend.fn) return
    let pts = null
    try { pts = pend.fn(pend.pts) } catch { pts = null }
    if (!pts) return
    const n = Math.min(pts.length ?? 0, MAX_PEND_PTS)
    for (let k = 0; k < n; k++) { const p = pts[k]; if (p !== pend.pts[k]) setV3(pend.pts[k], p, 0) }
    pend.n = n
  }
  function spawnPendant() {
    // une goutte naît sur un point émergé (au moins 4 mm au-dessus de l'eau), au hasard parmi eux
    let valid = 0
    for (let k = 0; k < pend.n; k++) if (pend.pts[k].y > P.waterY + 0.004) valid++
    if (!valid) return
    let pick = Math.floor(rnd() * valid)
    let idx = -1
    for (let k = 0; k < pend.n; k++) if (pend.pts[k].y > P.waterY + 0.004 && pick-- === 0) { idx = k; break }
    const i = dropSlot(2)
    if (i < 0) return
    const a = pend.pts[idx]
    DR.anchor[i] = idx; DR.age[i] = 0; DR.size[i] = 0; DR.sizeT[i] = 0.0032 + 0.0026 * rnd(); DR.stretch[i] = 1; DR.seed[i] = rnd()
    DR.ax[i] = a.x; DR.ay[i] = a.y; DR.az[i] = a.z
    DR.px[i] = a.x; DR.py[i] = a.y; DR.pz[i] = a.z; DR.vx[i] = DR.vy[i] = DR.vz[i] = 0
  }
  function bubbleSpawn(x, z, n = 6) {
    let made = 0
    for (let k = 0; k < n; k++) {
      const i = dropSlot(3)
      if (i < 0) break
      const a = rnd() * TAU, r = 0.05 * Math.sqrt(rnd())
      DR.px[i] = clamp(x + Math.cos(a) * r, P.x0 + 0.02, P.x1 - 0.02); DR.pz[i] = clamp(z + Math.sin(a) * r, P.z0 + 0.02, P.z1 - 0.02)
      DR.py[i] = P.waterY - P.depth + 0.01 - 0.04 * k * rnd() // départs étagés sous le fond : ils sortent du sol l'un après l'autre
      DR.vx[i] = 0; DR.vz[i] = 0; DR.vy[i] = 0.24 + 0.1 * rnd()
      DR.size[i] = DR.sizeT[i] = 0.004 + 0.004 * rnd(); DR.age[i] = 0; DR.stretch[i] = 1; DR.seed[i] = rnd(); DR.anchor[i] = -1
      made++
    }
    return made
  }
  function dropsUpdate(dt) {
    if (pend.fn) {
      readPendant()
      pend.acc += dt * pend.rate
      while (pend.acc >= 1) { pend.acc -= 1; spawnPendant() }
    }
    const a0 = dA0.array, a1 = dA1.array, a2 = dA2.array
    const floorKill = P.waterY + P.rimH
    let n = 0
    for (let i = 0; i < MAX_DROPS; i++) {
      const m = DR.mode[i]
      if (!m) continue
      DR.age[i] += dt
      let alpha = 1, kind = 0, st = 1
      if (m === 2) {
        // pendante : gonfle 0,3 s, s'étire 0,14 s, se détache
        const idx = DR.anchor[i]
        if (idx < 0 || idx >= pend.n || !pend.fn) { DR.mode[i] = 1; DR.vy[i] = -0.1 }
        else {
          const a = pend.pts[idx]
          if (a.y < P.waterY) { dropKill(i); continue } // le point est retourné sous l'eau
          const inv = dt > 1e-5 ? 1 / dt : 0
          DR.vx[i] = (a.x - DR.ax[i]) * inv; DR.vy[i] = (a.y - DR.ay[i]) * inv; DR.vz[i] = (a.z - DR.az[i]) * inv
          DR.ax[i] = a.x; DR.ay[i] = a.y; DR.az[i] = a.z
          const age = DR.age[i]
          DR.size[i] = DR.sizeT[i] * Math.sqrt(smooth01(age / 0.3))
          st = 1 + 0.9 * smooth01((age - 0.3) / 0.14)
          DR.stretch[i] = st
          DR.px[i] = a.x; DR.py[i] = a.y - DR.size[i] * st; DR.pz[i] = a.z
          if (age >= 0.44) { DR.mode[i] = 1; DR.vx[i] *= 0.6; DR.vy[i] = Math.min(DR.vy[i] * 0.6, 0) - 0.12; DR.vz[i] *= 0.6; DR.stretch[i] = 1 }
        }
      }
      if (DR.mode[i] === 1) {
        DR.vy[i] -= G * dt
        const drag = 1 - Math.min(0.5, dt * 0.4)
        DR.vx[i] *= drag; DR.vz[i] *= drag
        DR.px[i] += DR.vx[i] * dt; DR.py[i] += DR.vy[i] * dt; DR.pz[i] += DR.vz[i] * dt
        if (DR.py[i] <= P.waterY && DR.vy[i] < 0) {
          if (inPool(DR.px[i], DR.pz[i])) {
            ringRaw(DR.px[i], DR.pz[i], clamp(0.25 * DR.size[i] / 0.004, 0.12, 0.5), 0.22 + 0.3 * DR.size[i] / 0.006, 1.3, P.waterY)
            DR.landed++
          }
          dropKill(i); continue
        }
        if (DR.py[i] <= floorKill && !inPool(DR.px[i], DR.pz[i], -0.02)) { dropKill(i); continue }
        if (DR.age[i] > 5) { dropKill(i); continue }
        st = DR.stretch[i]
      } else if (DR.mode[i] === 3) {
        kind = 1
        const wob = Math.sin(DR.age[i] * 14 + DR.seed[i] * 40) * 0.03
        DR.px[i] += wob * dt; DR.py[i] += DR.vy[i] * dt
        DR.vy[i] = Math.min(DR.vy[i] + 0.25 * dt, 0.42)
        if (DR.py[i] < P.waterY - P.depth) alpha = 0 // encore sous le fond
        if (DR.py[i] >= P.waterY - DR.size[i]) {
          ringRaw(DR.px[i], DR.pz[i], 0.2, 0.12, 0.8, P.waterY)
          dropKill(i); continue
        }
      }
      const o = n * 4
      a0[o] = DR.px[i]; a0[o + 1] = DR.py[i]; a0[o + 2] = DR.pz[i]; a0[o + 3] = DR.size[i]
      if (DR.mode[i] === 2) { a1[o] = 0; a1[o + 1] = -1e-3; a1[o + 2] = 0 } else { a1[o] = DR.vx[i]; a1[o + 1] = DR.vy[i]; a1[o + 2] = DR.vz[i] }
      a1[o + 3] = alpha
      a2[o] = kind; a2[o + 1] = st; a2[o + 2] = DR.seed[i]; a2[o + 3] = 0
      n++
    }
    if (n) { dA0.needsUpdate = true; dA1.needsUpdate = true; dA2.needsUpdate = true } // envoi complet (≤ 1,9 ko chacun), sans allocation
    dropGeo.instanceCount = n
    dropMesh.visible = n > 0
  }

  // ============================== glow update ==============================
  function glowUpdate(dt) {
    const lv = tweenStep(glow.lvl, dt)
    let beatK = 1
    if (glow.beatP > 0 && lv > 0.001) {
      const prev = glow.phase
      glow.phase += dt / glow.beatP
      if (prev < 0.5 && glow.phase >= 0.5) ringRaw(glow.sx, glow.sz, 0.32 * Math.min(lv, 1) * glow.beatAmp + 0.08, 0.42, 1.9, P.waterY)
      if (glow.phase >= 1) glow.phase -= Math.floor(glow.phase)
      const e = Math.pow(Math.abs(Math.sin(Math.PI * glow.phase)), 6)
      beatK = 1 - glow.beatAmp + glow.beatAmp * (0.3 + 1.0 * e)
    }
    glow.displayed = lv * beatK
    const pl = tweenStep(glow.patch, dt), sl = tweenStep(glow.spare, dt)
    const g0 = gA0.array, g1 = gA1.array, g2 = gA2.array
    // [0] panneau sous l'eau (arc), tourné de phi dans son plan
    g0[0] = glow.x; g0[1] = glow.y; g0[2] = glow.z; g0[3] = 0
    g1[0] = 0.55; g1[1] = 1.1; g1[2] = glow.phi; g1[3] = glow.displayed
    g2[0] = 1; g2[1] = 1; g2[2] = 1; g2[3] = 1
    // [1] tache sur l'eau : étirée selon x (empreinte du flacon couché ou debout)
    const sp = Math.abs(Math.sin(glow.phi))
    g0[4] = glow.sx; g0[5] = P.waterY; g0[6] = glow.sz; g0[7] = 1
    g1[4] = 0.62 + 0.4 * sp; g1[5] = 0.44; g1[6] = 0; g1[7] = pl * (0.7 + 0.3 * beatK)
    g2[4] = 1; g2[5] = 1; g2[6] = 1; g2[7] = 0
    // [2] réserve (bouton du nymphéa, tache de soleil)
    g0[8] = glow.px; g0[9] = glow.py; g0[10] = glow.pz; g0[11] = 2
    g1[8] = glow.pr * 2; g1[9] = glow.pr * 2; g1[10] = 0; g1[11] = sl
    g2[8] = glow.pc.x; g2[9] = glow.pc.y; g2[10] = glow.pc.z; g2[11] = glow.pUnder
    gA0.needsUpdate = gA1.needsUpdate = gA2.needsUpdate = true
    glowMesh.visible = glow.displayed > 0.001 || pl > 0.001 || sl > 0.001
  }

  // ============================== P1 updates ==============================
  function domeUpdate(dt) {
    const h = tweenStep(dome.h, dt)
    domeU.uDome.value.w = h
    if (dome.on && Math.abs(h) < 1e-4 && dome.h.to === 0) dome.on = false
    domeMesh.visible = dome.on && Q.dome
  }
  function crownUpdate(dt) {
    if (!crown.on) { crownMesh.visible = false; return }
    crown.t += dt
    const u = crown.t / 0.45
    crownU.uCrownT.value.x = crown.t
    crownU.uCrownT.value.y = 1 - smooth01((u - 0.6) / 0.4)
    if (!crown.spawned && crown.t >= 0.3) {
      crown.spawned = true
      // à 0,3 s le bord lâche 12 gouttes
      const r = 0.03 + (crown.R - 0.03) * (1 - Math.pow(1 - 0.3 / 0.45, 2.5))
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + rnd() * 0.4
        const c = Math.cos(a), s = Math.sin(a), sp = (0.25 + 0.3 * rnd()) * crown.k
        dropSpawn(v3.set(crown.x + c * r, P.waterY + 0.05 * crown.k, crown.z + s * r), v3b.set(c * sp, (0.7 + 0.6 * rnd()) * crown.k, s * sp), 0.0028 + 0.003 * rnd())
      }
    }
    if (crown.t >= 0.45) crown.on = false
    crownMesh.visible = crown.on && Q.crown
  }
  function collarUpdate(dt) {
    const l = tweenStep(collar.lvl, dt)
    collarU.uColK.value.y = l
    collarMesh.visible = l > 0.002 && Q.collar
  }
  function neckUpdate(dt) {
    if (neck.fn) {
      let p = null
      try { p = neck.fn(neck.p) } catch { p = null }
      if (!p) neckHide(0.1)
      else {
        if (p !== neck.p) setV3(neck.p, p, 0)
        neck.H = Math.max(neck.p.y - P.waterY, 0)
        neckU.uNeck.value.set(neck.p.x, neck.p.y, neck.p.z, neckU.uNeck.value.w)
        if (neck.H > 0.16) neckPinch()
      }
    }
    neckU.uNeck.value.w = tweenStep(neck.lvl, dt)
    neckMesh.visible = neckU.uNeck.value.w > 0.002 && Q.neck
  }
  function neckHide(dur = 0.1) { neck.fn = null; tweenTo(neck.lvl, 0, dur) }
  function neckPinch() {
    if (!neck.fn && neck.lvl.v < 0.01) return false
    const x = neck.p.x, z = neck.p.z, y = P.waterY + neck.H * 0.62
    neck.fn = null
    tweenTo(neck.lvl, 0, 0.04)
    // une goutte qui tombe de la base, quatre gouttelettes qui jaillissent de l'étranglement
    dropSpawn(v3.set(x, P.waterY + neck.H * 0.9, z), v3b.set(0, -0.05, 0), 0.006)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + rnd() * 0.8, sp = 0.15 + 0.2 * rnd()
      dropSpawn(v3.set(x, y, z), v3b.set(Math.cos(a) * sp, 0.25 + 0.35 * rnd(), Math.sin(a) * sp), 0.0022 + 0.001 * rnd())
    }
    return true
  }
  function carpetUpdate() {
    if (carpet.on && clk[0] > carpet.end) carpet.on = false
    carpetMesh.visible = carpet.on && Q.carpet > 0
  }
  function reflUpdate(dt) {
    let want = 0
    if (refl.obj && Q.reflect && refl.op > 0) {
      // hauteur de la boîte englobante du proxy (repère jardin) : rien à refléter tant qu'il est sous l'eau ;
      // éteint pendant la traversée (collerette visible) : la ligne d'eau est déchirée et le pic reste ≤ 6 draw calls
      refl.obj.updateWorldMatrix(true, false)
      refl.inv.copy(group.matrixWorld).invert()
      refl.m.multiplyMatrices(refl.inv, refl.obj.matrixWorld)
      const b = refl.box
      let top = -1e9, cx = 0, cz = 0
      for (let k = 0; k < 8; k++) {
        refl.c.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(refl.m)
        if (refl.c.y > top) top = refl.c.y
        cx += refl.c.x * 0.125; cz += refl.c.z * 0.125
      }
      // hors du bassin (vitrine devant la porte, vol) : aucun fragment ne toucherait l'eau → pas de draw call
      const over = inPool(cx, cz, -0.35) && top < P.waterY + 2.5
      // traversée (dôme, couronne ou collerette) : coupé net. La boîte englobante tournée dépasse de l'eau
      // avant le vrai flacon ; le reflet d'un flacon qui traverse est de toute façon déchiré.
      if (domeMesh.visible || crownMesh.visible || collarMesh.visible || collar.lvl.v > 0.002) refl.a = 0
      else want = over ? refl.op * smooth01((top - P.waterY) / 0.03) : 0
    }
    refl.a += (want - refl.a) * Math.min(1, dt * 6)
    if (want === 0 && refl.a < 0.004) refl.a = 0
    reflU.uReflA.value = refl.a
    reflMesh.visible = !!refl.obj && refl.a > 0.003
  }

  // ============================== ordonnanceur de splashs ==============================
  const HN = 16
  const hist = { t: new Float64Array(HN).fill(-1e9), k: new Float32Array(HN), head: 0, lastT: -1e9, lastK: 0, fired: 0 }
  const QN = 6
  const queue = Array.from({ length: QN }, () => ({ on: false, x: 0, y: 0, z: 0, k: 0, pri: 1, tq: 0, koiMode: 0, kx: 0, ky: 0, kz: 0, ks: 0, ring: true }))
  const PRI = { low: 0, normal: 1, high: 2 }
  const PRI_NAME = ['low', 'normal', 'high']
  const koiT = { on: false, x: 0, y: 0, z: 0, seconds: 0, t0: 0, resumeAt: -1 }
  const LN = 40
  const log = Array.from({ length: LN }, () => ({ t: 0, frame: 0, x: 0, z: 0, k: 0, pri: '', res: '', why: '', wait: 0 }))
  let logHead = 0, logCount = 0
  const lastKoi = { t: -1, frame: -1, x: 0, z: 0, s: 0, n: 0 }
  const splashP = new THREE.Vector3(), koiP = new THREE.Vector3(), tapHit = new THREE.Vector3()
  const hasWater = () => !!(water && typeof water.splash === 'function')

  function addLog(x, z, k, pri, res, why, wait) {
    const e = log[logHead]
    e.t = clk[0]; e.frame = frame; e.x = x; e.z = z; e.k = k; e.pri = PRI_NAME[pri]; e.res = res; e.why = why || ''; e.wait = wait || 0
    logHead = (logHead + 1) % LN; logCount = Math.min(logCount + 1, LN)
    if (onLog) { try { onLog(e) } catch {} }
  }
  function blockReason(k) {
    let n = 0
    for (let i = 0; i < HN; i++) if (clk[0] - hist.t[i] < rules.window - 1e-6) n++
    if (n >= rules.maxInWindow) return 'window'
    const need = k >= rules.bigK || hist.lastK >= rules.bigK ? rules.bigGap : rules.smallGap
    if (clk[0] - hist.lastT < need - 1e-6) return 'gap'
    return null
  }
  function gatherKoi(x, y, z, s) {
    if (!water?.koi || typeof water.koi.gather !== 'function') return
    water.koi.gather(koiP.set(x, y, z), s)
    lastKoi.t = clk[0]; lastKoi.frame = frame; lastKoi.x = x; lastKoi.z = z; lastKoi.s = s; lastKoi.n++
  }
  function fire(x, y, z, k, koiMode, kx, ky, kz, ks) {
    const ok = water.splash(splashP.set(x, y, z), k)
    if (!ok) return false
    hist.t[hist.head] = clk[0]; hist.k[hist.head] = k; hist.head = (hist.head + 1) % HN
    hist.lastT = clk[0]; hist.lastK = k; hist.fired++
    // re-ciblage des koï : gardenFx vient d'appeler koi.gather(point, 6.5) ; on rétablit la cible scénarisée
    if (inPool(x, z)) {
      if (koiMode === 1) gatherKoi(kx, ky, kz, ks)
      else if (koiMode === 0 && koiT.on) {
        const rem = koiT.seconds - (clk[0] - koiT.t0)
        if (rem > 0.25) gatherKoi(koiT.x, koiT.y, koiT.z, Math.max(rem, 1))
        else koiT.on = false
      } else if (koiMode === 2 && koiT.on) koiT.resumeAt = clk[0] + 4 // le tap attire les koï, la cible reprend ensuite
    }
    return true
  }
  function splash(point, k = 0.5, opts = {}) {
    setV3(v3, point, P.waterY)
    const x = v3.x, y = v3.y, z = v3.z
    const pri = PRI[opts.priority] ?? 1
    const ring = opts.ring !== false
    let koiMode = 0, kx = 0, ky = 0, kz = 0, ks = 0
    if (opts.koi === false) koiMode = 2
    else if (opts.koi && (opts.koi.point || opts.koi.x !== undefined || Array.isArray(opts.koi))) {
      const kp = opts.koi.point || opts.koi
      setV3(v3b, kp, P.waterY); kx = v3b.x; ky = v3b.y; kz = v3b.z; ks = opts.koi.seconds ?? 6; koiMode = 1
    }
    if (!hasWater()) { addLog(x, z, k, pri, 'dropped', 'no-water'); if (ring && inPool(x, z)) ringAdd(x, z, Math.min(k, 1) * 0.8); return 'dropped' }
    const why = blockReason(k)
    if (!why) {
      if (fire(x, y, z, k, koiMode, kx, ky, kz, ks)) { addLog(x, z, k, pri, 'done', null, 0); return 'done' }
      addLog(x, z, k, pri, 'dropped', 'off-water'); return 'dropped'
    }
    if (pri > 0) {
      // file d'attente (≤ queueMax pour 'high', ≤ queueMax / 2 pour 'normal')
      let slot = -1
      for (let i = 0; i < QN; i++) if (!queue[i].on) { slot = i; break }
      if (slot < 0) { // file pleine : on remplace la plus faible priorité la plus ancienne, si elle est plus faible
        let worst = -1
        for (let i = 0; i < QN; i++) if (queue[i].pri < pri && (worst < 0 || queue[i].pri < queue[worst].pri || (queue[i].pri === queue[worst].pri && queue[i].tq < queue[worst].tq))) worst = i
        if (worst >= 0) { const q = queue[worst]; addLog(q.x, q.z, q.k, q.pri, 'dropped', 'evicted', clk[0] - q.tq); if (q.ring && inPool(q.x, q.z)) ringAdd(q.x, q.z, Math.min(q.k, 1) * 0.8); q.on = false; slot = worst }
      }
      if (slot >= 0) {
        const q = queue[slot]
        q.on = true; q.x = x; q.y = y; q.z = z; q.k = k; q.pri = pri; q.tq = clk[0]; q.koiMode = koiMode; q.kx = kx; q.ky = ky; q.kz = kz; q.ks = ks; q.ring = ring
        addLog(x, z, k, pri, 'queued', why, 0)
        return 'queued'
      }
    }
    addLog(x, z, k, pri, 'dropped', why, 0)
    if (ring && inPool(x, z)) ringAdd(x, z, Math.min(k, 1) * 0.8)
    return 'dropped'
  }
  function schedulerUpdate() {
    for (let pass = 0; pass < QN; pass++) {
      // la plus haute priorité, puis la plus ancienne
      let best = -1
      for (let i = 0; i < QN; i++) {
        const q = queue[i]
        if (!q.on) continue
        if (best < 0 || q.pri > queue[best].pri || (q.pri === queue[best].pri && q.tq < queue[best].tq)) best = i
      }
      if (best < 0) break
      const q = queue[best]
      const maxWait = q.pri === 2 ? rules.queueMax : rules.queueMax * 0.5
      const why = blockReason(q.k)
      if (!why) {
        q.on = false
        if (hasWater() && fire(q.x, q.y, q.z, q.k, q.koiMode, q.kx, q.ky, q.kz, q.ks)) addLog(q.x, q.z, q.k, q.pri, 'done', 'queued', clk[0] - q.tq)
        else addLog(q.x, q.z, q.k, q.pri, 'dropped', 'off-water', clk[0] - q.tq)
        continue
      }
      // la tête de file est bloquée : on purge les entrées périmées, puis on attend
      let purged = false
      for (let i = 0; i < QN; i++) {
        const e = queue[i]
        if (!e.on) continue
        const mw = e.pri === 2 ? rules.queueMax : rules.queueMax * 0.5
        if (clk[0] - e.tq > mw + 1e-6) {
          e.on = false; purged = true
          addLog(e.x, e.z, e.k, e.pri, 'dropped', 'timeout', clk[0] - e.tq)
          if (e.ring && inPool(e.x, e.z)) ringAdd(e.x, e.z, Math.min(e.k, 1) * 0.8)
        }
      }
      if (!purged || maxWait < 0) break
    }
    if (koiT.resumeAt > 0 && clk[0] >= koiT.resumeAt) {
      koiT.resumeAt = -1
      const rem = koiT.seconds - (clk[0] - koiT.t0)
      if (koiT.on && rem > 0.5) gatherKoi(koiT.x, koiT.y, koiT.z, rem)
    }
  }
  const queueLen = () => { let n = 0; for (let i = 0; i < QN; i++) if (queue[i].on) n++; return n }
  let lastTap = -1e9
  function tapWater(ray) {
    if (!water || typeof water.intersectWater !== 'function' || !ray) return false
    const h = water.intersectWater(ray, tapHit)
    if (!h) return false
    // bassin long : grosse ride + bouillon + embruns + koï qui détalent (canal du sillage : jamais l'ordonnanceur)
    if (hasWake() && onPool(h.x, h.y, h.z)) { wakePoke(h.x, h.z, 1); return true }
    return tapOther(h)
  }
  // bassin rond / vasque (ou gardenFx sans sillage) : gerbe de priorité basse via l'ordonnanceur, comme avant
  function tapOther(h) {
    if (clk[0] - lastTap < rules.tapGap) { if (inPool(h.x, h.z)) ringAdd(h.x, h.z, 0.45, { r1: 0.25, life: 1.2 }); return true } // jamais de tap mort
    lastTap = clk[0]
    splash(h, 0.5, { priority: 'low', koi: false })
    return true
  }

  // ============================== sillage du doigt (wake) ==============================
  // Doigt posé puis glissé sur le bassin long : UNE onde lisse, comme un bâton qu'on promène dans l'eau sans jamais
  // la quitter (demande client : plus de « petites ondulations »). Le doigt (lissé ~40 ms, vitesse lissée ~0,1 s) part
  // à water.wake.head à chaque image ; gardenFx en garde le tracé et dessine l'étrave en V + le sillon doux dans le
  // shader de l'eau (reflets, caustiques, koï, nénuphars suivent ; 0 draw call). Doigt qui se pose : un seul anneau
  // très doux. Doigt immobile : rien n'est émis, le V s'éteint (aucune pulsation). Doigt levé : le sillage s'efface
  // seul (~2 s). Ni anneaux en chapelet, ni écume, ni éclats, ni embruns (sprites éteints). Koï qui fuient
  // (koi.flee ≤ 5 / s). Aucun appel à water.splash. Zéro allocation.
  const WCFG = {
    follow: 25, vel: 10,                       // lissage du doigt et de sa vitesse (1/s)
    fleeEvery: 0.2, fleeR: 1.2, fleeS: 2.5, holdFleeR: 0.9, tapFleeR: 0.8, tapFleeS: 1.6,
    touchRing: 0.8, tapRing: 1.0,
  }
  const WKS = {
    down: false, wet: false, tx: 0, ty: 0, tz: 0, hx: 0, hz: 0, px: 0, pz: 0, vx: 0, vz: 0, sp: 0,
    t0: 0, path: 0, amp: 0, fleeT: -1e9, starts: 0, flees: 0, scared: 0, headOn: false,
  }
  const hasWake = () => !!(water && water.wake && typeof water.wake.add === 'function')
  const onPool = (x, y, z) => inPool(x, z) && Math.abs(y - P.waterY) < 0.06
  const wkRingOpt = { ring: 0.3, solo: true }
  function wkRingAt(x, z, k) {
    if (typeof water.wake.ring === 'function') water.wake.ring(x, z, k)
    else { wkRingOpt.ring = 0.3 * k; water.wake.add(x, z, wkRingOpt) } // ancien gardenFx
  }
  function wkFlee(x, z, r, s) {
    WKS.fleeT = clk[0]
    if (!water?.koi || typeof water.koi.flee !== 'function') return
    WKS.scared = water.koi.flee(koiP.set(x, P.waterY, z), r, s) || 0
    WKS.flees++
  }
  function wsUpdate() {
    if (WS.dirty) { wsA0.needsUpdate = true; wsA1.needsUpdate = true; wsA2.needsUpdate = true; WS.dirty = false } // envoi complet (3 × 1 ko), sans allocation
    wsMesh.visible = clk[0] < WS.end
  }
  // impact ponctuel (tap sur le bassin long, fx.wake.poke) : un anneau doux, nénuphars écartés, koï qui fuient
  function wakePoke(x, z, k = 1, fleeR = WCFG.tapFleeR, fleeS = WCFG.tapFleeS) {
    wkRingAt(x, z, WCFG.tapRing * k)
    water.wake.kick(x, z, 0.45, 0.18 * k)
    wkFlee(x, z, fleeR, fleeS)
  }
  function wakeStart(point) {
    if (!point || !hasWake()) return false
    setV3(v3, point, P.waterY)
    if (WKS.down) wakeEnd()
    WKS.down = true; WKS.starts++
    WKS.t0 = clk[0]; WKS.path = 0
    WKS.tx = WKS.hx = WKS.px = v3.x; WKS.ty = v3.y; WKS.tz = WKS.hz = WKS.pz = v3.z
    WKS.vx = WKS.vz = WKS.sp = 0
    WKS.wet = false
    if (onPool(v3.x, v3.y, v3.z)) wakeEnter(true)
    else if (v3.y > P.waterY + 0.06 && hasWater()) tapOther(v3) // doigt posé sur le bassin rond / la vasque : le tap d'origine
    return WKS.wet
  }
  function wakeEnter(touch) {
    WKS.wet = true; WKS.amp = 1
    if (touch) { // le doigt se pose : un seul anneau très doux, nénuphars à peine écartés, koï qui s'écartent
      wkRingAt(WKS.hx, WKS.hz, WCFG.touchRing)
      water.wake.kick(WKS.hx, WKS.hz, 0.4, 0.12)
      wkFlee(WKS.hx, WKS.hz, 1.0, 2.2)
    }
    water.wake.head(WKS.hx, WKS.hz, 1, 0, 0, 0.1); WKS.headOn = true
  }
  function wakeLeave() {
    WKS.wet = false; WKS.amp = 0
    // le tracé se ferme au dernier point du doigt et s'efface seul
    if (typeof water.wake.close === 'function') water.wake.close(); else water.wake.head(WKS.hx, WKS.hz, 0)
    WKS.headOn = false
  }
  function wakeMove(point) {
    if (!WKS.down || !point) return
    setV3(v3, point, P.waterY)
    WKS.tx = v3.x; WKS.ty = v3.y; WKS.tz = v3.z
  }
  function wakeEnd() {
    if (!WKS.down) return
    WKS.down = false
    if (WKS.wet) wakeLeave()
  }
  function wakeUpdate(dt) {
    if (!hasWake()) return
    if (WKS.down) {
      const wetNow = onPool(WKS.tx, WKS.ty, WKS.tz)
      if (wetNow) {
        if (!WKS.wet) { WKS.hx = WKS.px = WKS.tx; WKS.hz = WKS.pz = WKS.tz; WKS.vx = WKS.vz = WKS.sp = 0; wakeEnter(false) } // retour sur l'eau : nouveau tracé, sans anneau
        else {
          // le doigt, lissé (pas de tremblement), et sa vitesse (lissée)
          const k = 1 - Math.exp(-dt * WCFG.follow)
          WKS.hx += (WKS.tx - WKS.hx) * k; WKS.hz += (WKS.tz - WKS.hz) * k
        }
      } else if (WKS.wet) wakeLeave()
      if (dt > 1e-5 && WKS.wet) {
        const dx = WKS.hx - WKS.px, dz = WKS.hz - WKS.pz
        const s = 1 - Math.exp(-dt * WCFG.vel)
        WKS.vx += (dx / dt - WKS.vx) * s; WKS.vz += (dz / dt - WKS.vz) * s
        WKS.sp = Math.hypot(WKS.vx, WKS.vz)
        WKS.path += Math.hypot(dx, dz)
      }
      WKS.px = WKS.hx; WKS.pz = WKS.hz
    } else {
      WKS.vx = WKS.vz = WKS.sp = 0
    }
    if (WKS.down && WKS.wet) {
      water.wake.head(WKS.hx, WKS.hz, 1, WKS.vx, WKS.vz, 0.1)
      WKS.headOn = true
      // koï : fuite entretenue (≤ 5 appels / s)
      if (clk[0] - WKS.fleeT >= WCFG.fleeEvery) wkFlee(WKS.hx, WKS.hz, WKS.sp > 0.15 ? WCFG.fleeR : WCFG.holdFleeR, WCFG.fleeS)
    } else if (WKS.headOn) { WKS.headOn = false; water.wake.head(WKS.hx, WKS.hz, 0) }
  }
  if (hasWake() && typeof water.wake.setQuality === 'function') water.wake.setQuality(qName)

  // ============================== API publique ==============================
  const api = {
    group,
    splash,
    koiTarget(point, seconds = 6) {
      if (!point) { koiT.on = false; koiT.resumeAt = -1; return }
      setV3(v3, point, P.waterY)
      koiT.on = true; koiT.x = v3.x; koiT.y = v3.y; koiT.z = v3.z; koiT.seconds = seconds; koiT.t0 = clk[0]; koiT.resumeAt = -1
    },
    tapWater,
    /**
     * Sillage du doigt sur le bassin long (repère jardin, mètres ; Vector3, [x, y, z] ou {x, y, z} — le point
     * n'est jamais conservé, ex. water.intersectWater(ray, out) directement). À brancher sur les
     * pointerDown / Move / Up du doigt posé sur l'eau ; un point hors du bassin long (bassin rond, vasque,
     * sol) suspend le tracé sans le casser. start() fait aussi l'impact d'un tap.
     */
    wake: {
      /** doigt posé : un seul anneau très doux, tracé ouvert, koï qui fuient. → true si sur le bassin long */
      start: wakeStart,
      /** doigt glissé (appeler à chaque pointermove ; ré-échantillonné à chaque image dans update) */
      move: wakeMove,
      /** doigt levé (ou pointercancel) : le tracé se ferme, le sillage s'éteint seul en ~2 s */
      end: wakeEnd,
      /** tap isolé au point (sans doigt posé) : un anneau doux, comme tapWater */
      poke(point, k = 1) { if (!point || !hasWake()) return false; setV3(v3, point, P.waterY); if (!inPool(v3.x, v3.z)) return false; wakePoke(v3.x, v3.z, k); return true },
      get active() { return WKS.down && WKS.wet },
      get state() { return { down: WKS.down, wet: WKS.wet, x: WKS.hx, z: WKS.hz, speed: WKS.sp, amp: WKS.amp, path: WKS.path, starts: WKS.starts, flees: WKS.flees, scared: WKS.scared, sprites: WS.spawned } },
      cfg: WCFG,
    },
    glow: {
      /** level ≈ 0,35–0,8 ; at = [x, z], [x, y, z] ou Vector3 (seuls x et z comptent) ; y = centre du panneau
       *  (défaut −0,24 : flacon couché) ; phi en DEGRÉS (−90 = couché, bouchon vers +x) ; dur en s. */
      set(level, { at, phi, dur = 1.0, y } = {}) {
        if (at) {
          // at ne donne que x / z (E = [0, 0, −2.80] a y = 0 : ce n'est pas la hauteur du panneau)
          setV3(v3, at, 0)
          glow.x = v3.x; glow.z = v3.z + 0.12 // 0,12 m vers la caméra
          glow.sx = v3.x; glow.sz = v3.z
        }
        if (y !== undefined && y !== null) glow.y = y
        if (phi !== undefined && phi !== null) glow.phi = phi * DEG
        if (level !== undefined && level !== null) tweenTo(glow.lvl, Math.max(level, 0), dur)
      },
      /** battement de cœur : période (s), amplitude 0..1 (0,5 sous prefers-reduced-motion) ; période 0 = arrêt. Un anneau par battement. */
      beat(period, amp = 1) {
        if (!period || period <= 0) { glow.beatP = 0; return }
        glow.beatP = Math.max(period, 0.34) // ≤ 3 Hz
        glow.beatAmp = clamp(amp, 0, 1)
      },
      /** tache de lumière sur l'eau, sous le flacon (repère x/z du dernier set()). */
      patch(level, dur = 0.6) { tweenTo(glow.patch, Math.max(level || 0, 0), dur) },
      /** instance de réserve (bouton du nymphéa, tache de soleil) : at = [x, y, z], couleur linéaire. */
      spare(level, { at, dur = 0.4, radius = 0.25, color, underwater } = {}) {
        if (at) { setV3(v3, at, -0.1); glow.px = v3.x; glow.py = v3.y; glow.pz = v3.z }
        glow.pr = radius
        if (color) { spareCol.set(color); glow.pc.set(spareCol.r, spareCol.g, spareCol.b) }
        glow.pUnder = underwater === undefined ? (glow.py < P.waterY ? 1 : 0) : underwater ? 1 : 0
        tweenTo(glow.spare, Math.max(level || 0, 0), dur)
      },
      get level() { return glow.displayed },
    },
    rings: { add: ringAdd, get count() { return RG.n } },
    drops: {
      spawn: dropSpawn,
      /** gouttes pendantes : getPointsFn(outArray) → tableau de points jardin (≤ 16) ; ratePerSec. */
      pendant(getPointsFn, ratePerSec = 6) { pend.fn = getPointsFn || null; pend.rate = Math.max(ratePerSec || 0, 0); if (!pend.fn) pend.n = 0 },
      setRate(ratePerSec) { pend.rate = Math.max(ratePerSec || 0, 0) },
      stop() { pend.fn = null; pend.n = 0; pend.acc = 0 },
      get count() { return DR.nDrops },
    },
    dome: {
      set(x, z, R = 0.25, h = 0.04, dur = 0.16) {
        if (!Q.dome) return
        domeU.uDome.value.x = x; domeU.uDome.value.y = z; domeU.uDome.value.z = R
        dome.on = true; tweenTo(dome.h, h, dur)
      },
      hide(dur = 0.1) { tweenTo(dome.h, 0, dur) },
    },
    crown: {
      fire(x, z, R = 0.12, k = 0.9) {
        if (!Q.crown) { // palier bas : la gerbe seule
          for (let i = 0; i < 10; i++) { const a = rnd() * TAU, sp = 0.2 + 0.3 * rnd(); dropSpawn(v3.set(x, P.waterY + 0.02, z), v3b.set(Math.cos(a) * sp, (0.8 + 0.6 * rnd()) * k, Math.sin(a) * sp), 0.003 + 0.003 * rnd()) }
          return
        }
        crown.on = true; crown.t = 0; crown.spawned = false; crown.x = x; crown.z = z; crown.R = R; crown.k = k
        crownU.uCrown.value.set(x, z, R, k)
        crownU.uCrownT.value.set(0, 1, rnd() * 10, 0)
      },
    },
    collar: {
      /** section = perfume.waterSection(0) → { ok, x0, x1, zc, halfDepth } ; lip = montée du ménisque (m). */
      set(section, lip = 0.025) {
        if (!section || section.ok === false) { tweenTo(collar.lvl, 0, 0.1); return }
        collarU.uSec.value.set(Math.min(section.x0, section.x1), Math.max(section.x0, section.x1), section.zc, section.halfDepth)
        collarU.uColK.value.x = lip
        if (collar.lvl.to !== 1) tweenTo(collar.lvl, 1, 0.08)
      },
      hide(dur = 0.1) { tweenTo(collar.lvl, 0, dur) },
    },
    neck: {
      /** getPointFn(outVector3) → centre de la base (jardin) ou null. */
      attach(getPointFn) { if (!Q.neck || !getPointFn) return; neck.fn = getPointFn; neck.H = 0; tweenTo(neck.lvl, 1, 0.08) },
      pinch: neckPinch,
      hide: neckHide,
      get length() { return neck.fn ? neck.H : 0 },
    },
    carpet: {
      sparkle(segment, dur = 3) {
        if (!Q.carpet) return
        const s = segment || [0, -1.9, 0, -4.6]
        carpetU.uSeg.value.set(s[0], s[1], s[2], s[3])
        carpetU.uCarp.value.set(clk[0], dur, 1, 0.22)
        carpetGeo.setDrawRange(0, Math.min(Q.carpet, MAX_CARPET))
        carpet.on = true; carpet.end = clk[0] + dur
      },
    },
    bubbles: { spawn(x, z, n = 6) { return bubbleSpawn(x, z, n) } },
    reflect: {
      /** object3D = le Mesh PB_ReflProxy (caché ; ses matrices monde restent à jour) ou un parent qui le
       *  contient ; null = arrêt. opacity 0..1. Le reflet apparaît seul quand une partie du proxy est
       *  au-dessus de l'eau et que la collerette est éteinte ; fondu 0,3 s. Renvoie true si un mesh est suivi. */
      track(object3D, opacity = 1) {
        let mesh = null
        if (object3D) {
          if (object3D.isMesh) mesh = object3D
          else object3D.traverse((o) => { if (!mesh && o.isMesh && /ReflProxy/.test(o.name)) mesh = o })
        }
        refl.op = clamp(opacity ?? 1, 0, 1)
        if (!mesh) { refl.obj = null; reflMesh.geometry = reflPh; reflMesh.visible = false; refl.a = 0; return false }
        if (refl.obj !== mesh) {
          refl.obj = mesh
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
          refl.box.copy(mesh.geometry.boundingBox)
          reflMesh.geometry = mesh.geometry // partagée, jamais libérée ici
        }
        return true
      },
      setOpacity(opacity) { refl.op = clamp(opacity || 0, 0, 1) },
      get enabled() { return !!refl.obj && Q.reflect },
      get level() { return refl.a },
    },
    /** Remplace les sondes (ex. capture runtime water.captureReflections()) ; même format que createEmergeFX. */
    setProbes(pr) {
      const tex = pr ? (pr.isTexture ? pr : pr.pool?.texture || null) : null
      U.uProbe.value = tex
      U.uHasProbe.value = tex ? 1 : 0
      const pos = pr && !pr.isTexture && pr.pool?.position
      if (pos) { if (Array.isArray(pos)) U.uProbeP.value.fromArray(pos); else U.uProbeP.value.copy(pos) }
    },

    update(dt, camera) {
      dt = clamp(dt || 0, 0, 0.1)
      clk[0] += dt
      frame++
      U.uTime.value = clk[0]
      if (camera) {
        group.updateWorldMatrix(true, false)
        invM.copy(group.matrixWorld).invert()
        camera.getWorldPosition(camW)
        U.uCam.value.copy(camW.applyMatrix4(invM))
      }
      schedulerUpdate()
      glowUpdate(dt)
      wakeUpdate(dt) // avant les anneaux : le sillage en émet
      dropsUpdate(dt) // avant les anneaux : les gouttes qui touchent l'eau en créent
      ringsUpdate()
      wsUpdate()
      domeUpdate(dt); crownUpdate(dt); collarUpdate(dt); neckUpdate(dt); carpetUpdate()
      reflUpdate(dt) // après la collerette (il s'éteint pendant la traversée)
    },
    clear() {
      for (const q of queue) q.on = false
      koiT.on = false; koiT.resumeAt = -1
      tweenTo(glow.lvl, 0, 0); tweenTo(glow.patch, 0, 0); tweenTo(glow.spare, 0, 0); glow.beatP = 0; glow.phase = 0; glow.displayed = 0
      RG.n = 0; RG.dirty = true
      for (let i = 0; i < MAX_DROPS; i++) DR.mode[i] = 0
      DR.nDrops = DR.nBubbles = 0
      pend.fn = null; pend.n = 0; pend.acc = 0
      dome.on = false; tweenTo(dome.h, 0, 0)
      crown.on = false
      tweenTo(collar.lvl, 0, 0)
      neck.fn = null; neck.H = 0; tweenTo(neck.lvl, 0, 0)
      carpet.on = false
      refl.a = 0 // le suivi du proxy (reflect.track) est conservé : c'est un branchement, pas un effet
      WKS.down = false; WKS.wet = false; WKS.amp = 0; WKS.headOn = false; WKS.vx = WKS.vz = WKS.sp = 0; WKS.path = 0
      if (hasWake()) water.wake.clear()
      wsA0.array.fill(-100); WS.dirty = true; WS.end = -1; wsUpdate()
      dropGeo.instanceCount = 0; ringGeo.instanceCount = 0
      for (const m of meshes) m.visible = false
      // l'historique des splashs est conservé : il reflète l'état réel des rides / de la gerbe de gardenFx
    },
    stats(verbose = false) {
      let calls = 0, tris = 0
      for (const m of meshes) {
        if (!m.visible) continue
        calls++
        if (m.isPoints) continue
        const g = m.geometry
        const t = (g.index ? g.index.count : g.attributes.position.count) / 3
        tris += t * (g.isInstancedBufferGeometry ? g.instanceCount : 1)
      }
      return {
        drawCalls: calls, triangles: Math.round(tris), quality: qName,
        rings: RG.n, drops: DR.nDrops, bubbles: DR.nBubbles, queue: queueLen(),
        splashes: hist.fired, glow: Math.round(glow.displayed * 1000) / 1000,
        wake: WKS.down ? (WKS.wet ? 'drag' : 'dry') : WKS.amp > 0 ? 'fade' : 'off',
        visible: verbose ? meshes.filter((m) => m.visible).map((m) => m.name) : undefined,
      }
    },
    /** Journal de l'ordonnanceur, du plus ancien au plus récent (copie ; page de test). */
    splashLog() {
      const out = []
      for (let i = 0; i < logCount; i++) { const e = log[(logHead - logCount + i + LN) % LN]; out.push({ ...e }) }
      return out
    },
    /** Dernier re-ciblage des koï émis par l'ordonnanceur (diagnostic). */
    lastKoiGather: () => ({ ...lastKoi }),
    get time() { return clk[0] },
    get frame() { return frame },
    setQuality(q) {
      if (!QUALITY[q]) return
      Q = QUALITY[q]; qName = q
      U.uGlit.value = Q.glitter
      if (hasWake() && typeof water.wake.setQuality === 'function') water.wake.setQuality(q) // sillage : points du tracé
      // au-delà des nouveaux plafonds : on éteint les plus récentes
      for (let i = MAX_DROPS - 1; i >= 0 && (DR.nDrops > Q.drops || DR.nBubbles > Q.bubbles); i--) {
        if ((DR.mode[i] === 3 && DR.nBubbles > Q.bubbles) || ((DR.mode[i] === 1 || DR.mode[i] === 2) && DR.nDrops > Q.drops)) dropKill(i)
      }
      if (!Q.dome) dome.on = false
      if (!Q.crown) crown.on = false
      if (!Q.collar) tweenTo(collar.lvl, 0, 0)
      if (!Q.neck) { neck.fn = null; tweenTo(neck.lvl, 0, 0) }
      if (!Q.carpet) carpet.on = false
      if (!Q.reflect) { refl.a = 0; reflMesh.visible = false }
    },
    /** Compile tous les programmes (à appeler depuis le prewarm du directeur). */
    prewarm(renderer, scene, camera) {
      const vis = meshes.map((m) => m.visible)
      meshes.forEach((m) => { m.visible = true })
      const counts = [ringGeo.instanceCount, dropGeo.instanceCount]
      ringGeo.instanceCount = 1; dropGeo.instanceCount = 1
      try { renderer.compile(scene, camera) } catch (e) { console.warn('[emergeFx] prewarm', e) }
      meshes.forEach((m, i) => { m.visible = vis[i] })
      ringGeo.instanceCount = counts[0]; dropGeo.instanceCount = counts[1]
    },
    dispose() {
      if (group.parent) group.parent.remove(group)
      for (const m of meshes) { if (m !== reflMesh) m.geometry.dispose(); m.material.dispose() }
      reflPh.dispose() // la géométrie suivie appartient au flacon
      refl.obj = null
      archTex?.dispose()
    },
    debug: { uniforms: U, rules, hist, queue, koiT, meshes, glowU, dropU, ringMesh, glow, DR, pend, refl, reflU, WKS, WS, wsU, wsMesh },
  }
  return api
}
