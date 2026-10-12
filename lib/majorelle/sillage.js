// « BLEU INTERDIT » — le sillage (SPEC_PERFUME §5.4, §5.5, §2.5).
//
// Une pression : un jet fin jaillit de la buse, s'épanouit en une grosse nuée de parfum (bouffées douces qui
// gonflent, s'éclaircissent et roulent sur un champ de rotationnel), éclairée en contre-jour or par le soleil
// couchant, nacrée sur ses bords minces, piquée de micro-gouttelettes qui accrochent la lumière. Puis la nuée
// s'enroule et est aspirée par la porte (onCross → le directeur fait vibrer le portail) ; dans l'embrasure les
// gouttelettes deviennent lumière : un fil d'or dessine l'arc scanné (door_arch_path.json, de la naissance
// gauche à la clé puis à la naissance droite), puis se défait en poussière d'or qui pleut sur le bassin.
//
//   Nuée     : quads instanciés face caméra (1 draw call), triés de l'arrière vers l'avant, prémultipliés
//              (bouffées « over » légèrement additives ; gouttelettes, braises : additives).
//              ≤ 560 instances (high) / 400 (medium) / 280 (low). Bouffées : atlas 2×2 T_PB_mist.png
//              (densité en gris : cumulus, voile déchiré, volute étirée, nappe), éclairage par échantillon
//              décalé vers le soleil, lueur de contre-jour, irisation nacrée ; gouttelettes procédurales
//              (cœur + croix fine pour les reflets). Taille à l'écran plafonnée (26 % de la hauteur pour
//              une bouffée, l'alpha baisse d'autant), effacées à moins de 0,25 marqueur de la caméra.  ordre 15
//   Ruban    : bande face caméra de 128 segments (256 tris) posée sur le chemin de l'arc à z 0,006,
//              uProgress (tracé) / uFade (dissolution), cœur or #F3DFA8, additif.               ordre 16
//   Voile    : quad plein écran (depthTest off), opacité ≤ 0,15, ≤ 0,8 s.                       ordre 30
// ≤ 3 draw calls, chacun masqué quand il est inactif. Zéro allocation par image (tri par insertion sur un
// ordre persistant, tampons préalloués).
//
// Repère : tout est sous `anchor` en unités marqueur ; la pluie convertit le jardin → marqueur avec gardenMeta
// (x' = X_OFF + K·x, y' = Z_OFF + K·y, z' = K·z).
// Phases d'une particule : brume → aspiration → suspension (dans l'embrasure) → fil → perle → poussière → posée.
// Les bouffées ne quittent jamais la brume : aspirées, elles se resserrent et s'éteignent en passant la porte ;
// seules les gouttelettes et braises (la « lumière ») suivent le fil puis la pluie.
// Chaque appel accepte les particules de toutes les phases précédentes (mini-vaporisation : spray → pour → rain).

import * as THREE from 'three'
import { PB_RENDER_ORDER, PB_CFG } from '@/lib/majorelle/perfumeConfig'

const TAU = Math.PI * 2
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const clamp01 = (x) => clamp(x, 0, 1)
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)

const CAP = { high: 560, medium: 400, low: 280 }
const MAX = 560
// budget d'une pression longue (hold 1,4 s) ; une pression brève (0,6 s) en émet ≈ 62 %
const BUDGET = {
  high: { puff: 84, jet: 40, drop: 300 },
  medium: { puff: 64, jet: 30, drop: 200 },
  low: { puff: 48, jet: 22, drop: 130 },
}
// 1 mm réel du flacon → unités marqueur à la taille vitrine (heroOut = 0,40 pour un flacon de 12,6 cm)
const MM = (PB_CFG.heroOut ?? 0.4) / 0.126 / 1000
const NEAR_FADE = 0.25
const MAX_FRAC = 0.22       // diamètre max d'une bouffée à l'écran (fraction de la hauteur du tampon)
const PATH_N = 96          // cibles du fil (comme door_arch_path.json)
const RIBBON_SEG = 128
const MIST_URL = `${PB_CFG.texBase || '/majorelle/perfume/'}T_PB_mist.png`

// phases
const DEAD = 0, MIST = 1, ATTRACT = 2, HOVER = 3, THREAD = 4, PEARL = 5, DUST = 6, LANDED = 7
// natures
const K_PUFF = 0, K_JET = 1, K_DROP = 2, K_EMBER = 3
// codes GPU (iA.z) : 0..3 tuile de bouffée, 4 gouttelette, 5 braise
const G_DROP = 4, G_EMBER = 5
const GLINT_ROT = 0.26     // les reflets en croix partagent une même orientation (filtre étoile)

// Repli du chemin de l'arc (analysis/door_outline.json lissé, pixels de l'image 1792×2400) :
// naissance gauche → clé → naissance droite. Utilisé tant que door_arch_path.json (WP2) n'est pas publié.
const FALLBACK_ARCH_PX = [
  [633, 1205], [628, 1175], [619, 1145], [611, 1110], [607, 1070], [607, 1035], [609, 1000], [614, 968],
  [622, 938], [633, 907], [646, 877], [662, 849], [682, 822], [706, 797], [736, 776], [772, 762],
  [812, 754], [856, 749], [890, 747], [926, 749], [966, 754], [1004, 763], [1038, 780], [1066, 801],
  [1090, 823], [1110, 847], [1128, 872], [1150, 893], [1168, 912], [1180, 938], [1189, 965], [1194, 995],
  [1197, 1030], [1197, 1065], [1194, 1100], [1188, 1135], [1180, 1160], [1173, 1185], [1167, 1205],
]

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------
// Atlas de brume de repli (le temps que T_PB_mist.png arrive, ou s'il manque) : 4 bouffées douces en lobes,
// densité dans tous les canaux. Même disposition que le PNG (haut-gauche cumulus, haut-droite voile,
// bas-gauche volute étirée en u, bas-droite nappe).
// ---------------------------------------------------------------------------------------------
export function makeFallbackMistAtlas(N = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const h = N / 2
  const rng = mulberry32(77)
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N)
  g.globalCompositeOperation = 'lighter'
  const blob = (cx, cy, rx, ry, a) => {
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx)
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx)
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore()
  }
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * h + h / 2, oy = Math.floor(t / 2) * h + h / 2
    g.save(); g.beginPath(); g.rect(ox - h / 2, oy - h / 2, h, h); g.clip()
    const n = t === 3 ? 6 : 16
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, d = Math.pow(rng(), 0.7) * h * (t === 3 ? 0.08 : 0.17)
      const r = h * (t === 3 ? 0.3 : 0.1 + 0.1 * rng())
      const sx = t === 2 ? 2.2 : 1
      blob(ox + Math.cos(a) * d * sx, oy + Math.sin(a) * d / sx, r * sx, r / sx, t === 3 ? 0.35 : 0.22 + 0.12 * rng())
    }
    g.restore()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.userData.fallback = true
  return tex
}

// ---------------------------------------------------------------------------------------------
// Chemin de l'arc : lissage Catmull-Rom centripète + rééchantillonnage à abscisse curviligne constante
// ---------------------------------------------------------------------------------------------
function catmull(p0, p1, p2, p3, t, out) {
  // centripète (alpha 0,5)
  const d01 = Math.max(1e-6, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])))
  const d12 = Math.max(1e-6, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])))
  const d23 = Math.max(1e-6, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])))
  for (let k = 0; k < 2; k++) {
    let m1 = (p2[k] - p1[k]) + d12 * ((p1[k] - p0[k]) / d01 - (p2[k] - p0[k]) / (d01 + d12))
    let m2 = (p2[k] - p1[k]) + d12 * ((p3[k] - p2[k]) / d23 - (p3[k] - p1[k]) / (d12 + d23))
    const t2 = t * t, t3 = t2 * t
    out[k] = (2 * t3 - 3 * t2 + 1) * p1[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[k] + (t3 - t2) * m2
  }
  return out
}
function resamplePath(pts, n) {
  const dense = []
  const tmp = [0, 0]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    const steps = 12
    for (let s = 0; s < steps; s++) { catmull(p0, p1, p2, p3, s / steps, tmp); dense.push([tmp[0], tmp[1]]) }
  }
  dense.push([pts[pts.length - 1][0], pts[pts.length - 1][1]])
  const cum = [0]
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const total = cum[cum.length - 1]
  const out = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * total
    while (j < cum.length - 2 && cum[j + 1] < s) j++
    const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])
    out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f])
  }
  return { points: out, length: total }
}
/** Chemin normalisé : { z, raw: [[x,y]…] (tel que publié), path: Float32Array(PATH_N·3), ribbon: Float32Array((SEG+1)·3), length, fallback } */
export function buildArchPath(archPath, door = null) {
  let raw = null, z = 0.006, fallback = false
  if (archPath && Array.isArray(archPath.points) && archPath.points.length >= 8) {
    raw = archPath.points.map((p) => [Number(p[0]), Number(p[1])])
    if (typeof archPath.z === 'number') z = archPath.z
  } else {
    fallback = true
    raw = FALLBACK_ARCH_PX.map(([x, y]) => [x / 1792 - 0.5, (1200 - y) / 1792])
  }
  const r1 = resamplePath(raw, PATH_N), r2 = resamplePath(raw, RIBBON_SEG + 1)
  const path = new Float32Array(PATH_N * 3), ribbon = new Float32Array((RIBBON_SEG + 1) * 3)
  r1.points.forEach((p, i) => path.set([p[0], p[1], z], i * 3))
  r2.points.forEach((p, i) => ribbon.set([p[0], p[1], z], i * 3))
  return { z, raw, path, ribbon, length: r1.length, fallback, door }
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
const MIST_VS = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iCol;
attribute vec4 iA;     // alpha, diamètre (marqueur), code (0..3 tuile, 4 gouttelette, 5 braise), part additive
attribute vec4 iB;     // rotation, étirement selon la vitesse, graine, reflet (0..1)
attribute vec3 iVel;   // vitesse (repère de l'ancre), pour l'étirement du jet
uniform float uPx;     // demi-hauteur du tampon (px)
uniform float uWorldScale;
uniform float uMaxPx;  // diamètre max d'une bouffée (px)
uniform vec3 uCamL;    // caméra dans le repère de l'ancre
uniform float uNear;
uniform vec3 uSunL;    // direction du soleil dans le repère de l'ancre
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vA;
varying vec4 vB;
varying vec2 vL;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float depth = max(-mv.z, 0.005);
  float size = iA.y * uWorldScale;
  float kpx = projectionMatrix[1][1] * uPx / depth;
  float pxD = size * kpx;
  bool lightK = iA.z > 3.5;
  float a = iA.x * smoothstep(uNear * 0.35, uNear, length(iPos - uCamL));
  float maxPx = lightK ? uMaxPx * 0.3 : uMaxPx;
  if (pxD > maxPx) { float r = maxPx / pxD; a *= lightK ? 1.0 : r * sqrt(r); size *= r; pxD = maxPx; }
  // plancher : une gouttelette garde un cœur net de ~1,5 px, son éclat baisse d'autant
  float minPx = lightK ? (iB.w > 0.5 ? 14.0 : 6.0) : 3.0;
  if (pxD < minPx) { float r = pxD / minPx; a *= r * r; size /= r; pxD = minPx; }
  if (a < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 ax = vec2(cos(iB.x), sin(iB.x));
  float st = 1.0;
  if (iB.y > 0.0) {
    // vitesse projetée à l'écran (dérivée de mv.xy / profondeur)
    vec3 vv = mat3(modelViewMatrix) * iVel;
    vec2 sv = (vv.xy + mv.xy * vv.z / depth) / depth;
    float sl = length(sv);
    if (sl > 1e-4) { ax = sv / sl; st = 1.0 + min(iB.y * sl * 1.4, 2.6); }
  }
  vec2 ay = vec2(-ax.y, ax.x);
  // bouffées : le quad est resserré sur le disque utile de la tuile (Ø 0,86) → −26 % de fragments
  float qs = lightK ? 1.0 : 0.86;
  vec2 q = position.xy;
  mv.xy += (q.x * ax * st + q.y * ay * inversesqrt(st)) * size * 0.5 * qs;
  // bouffées avancées vers la caméra d'un tiers de leur diamètre : moins de coupes nettes sur le flacon
  if (!lightK) mv.z += size * 0.3;
  gl_Position = projectionMatrix * mv;
  vUv = q * 0.5 * qs + 0.5;
  vec2 ls = (modelViewMatrix * vec4(uSunL, 0.0)).xy;
  float ll = length(ls);
  ls = ll > 1e-4 ? ls / ll : vec2(0.0, 1.0);
  vL = vec2(dot(ls, ax), dot(ls, ay));
  vCol = iCol;
  vA = vec4(a, pxD, iA.z, iA.w);
  vB = iB;
}
`
const MIST_FS = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uLit;      // face au soleil : blanc doré
uniform vec3 uShade;    // ombre propre : nacre lilas (le ciel et les murs bleus)
uniform vec3 uGlow;     // contre-jour : or chaud dans les bords minces
uniform float uIrid;
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vA;
varying vec4 vB;
varying vec2 vL;
void main() {
  float code = vA.z;
  if (code < 3.5) {
    vec2 off = vec2(mod(code, 2.0) * 0.5, 0.5 - floor(code * 0.5) * 0.5);
    vec2 uv = clamp(vUv, 0.0, 1.0);
    float d = texture2D(uAtlas, off + uv * 0.5).r;
    float a = pow(d, 1.2) * vA.x * 1.12;
    if (a < 0.003) discard;
    // densité vers le soleil : plus il y a de brume entre ce point et la lumière, plus il est dans l'ombre
    float dl = texture2D(uAtlas, off + clamp(uv + vL * 0.09, 0.0, 1.0) * 0.5).r;
    float lit = clamp(0.55 + (d - dl) * 3.8, 0.0, 1.0);
    vec3 col = mix(uShade, uLit, lit);
    // bords minces : la lumière les traverse (lueur or) et la nacre s'y irise
    float thin = clamp(d * (1.0 - d) * 4.0, 0.0, 1.0) * (1.0 - 0.6 * d);
    col += uGlow * thin * (0.35 + 0.65 * lit);
    vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + d * 1.6 + vB.z + uTime * 0.05));
    col *= mix(vec3(1.0), 0.8 + 0.4 * irid, uIrid * thin);
    col *= vCol;
    gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb * a, a * (1.0 - vA.w));
  } else {
    // gouttelette (cœur net + halo) ; reflet : croix fine qui accroche le soleil ; braise : halo plus large
    vec2 c = vUv * 2.0 - 1.0;
    float r2 = dot(c, c);
    float g = vB.w;
    float ember = step(4.5, code);
    float core = exp(-r2 * mix(mix(16.0, 70.0, g), 9.0, ember));
    float halo = exp(-r2 * mix(6.0, 3.0, ember)) * mix(0.06, 0.32, ember) * (1.0 - g * 0.6);
    float rays = (exp(-abs(c.x) * 3.2) * exp(-c.y * c.y * 900.0) + exp(-abs(c.y) * 3.2) * exp(-c.x * c.x * 900.0)) * g;
    float a = (core + halo + rays * 0.9) * vA.x;
    if (a < 0.003) discard;
    gl_FragColor = vec4(linearToOutputTexel(vec4(vCol, 1.0)).rgb * a, a * (1.0 - vA.w));
  }
}
`
const RIB_VS = /* glsl */ `
attribute vec3 aT;     // tangente du chemin
attribute vec2 aUV;    // u (abscisse 0..1), côté (−1..1)
uniform float uHalfW;  // demi-largeur (marqueur)
uniform float uWorldScale;
uniform float uPx;     // demi-hauteur du tampon de rendu (px)
varying vec2 vUV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 tw = normalize(mat3(modelMatrix) * aT);
  vec3 vd = normalize(cameraPosition - wp.xyz);
  vec3 sd = cross(tw, vd);
  float l = length(sd);
  sd = l > 1e-5 ? sd / l : vec3(0.0, 1.0, 0.0);
  // jamais plus fin que ~2,2 px de demi-largeur (lisible de loin)
  float minW = 2.2 * length(cameraPosition - wp.xyz) / (projectionMatrix[1][1] * uPx);
  wp.xyz += sd * aUV.y * max(uHalfW * uWorldScale, minW);
  vUV = aUV;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const RIB_FS = /* glsl */ `
uniform float uProgress;
uniform float uFade;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uGlow;
varying vec2 vUV;
float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float u = vUV.x, v = vUV.y;
  float behind = uProgress - u;
  if (behind < -0.004) discard;
  // fil d'or : âme métallique (or saturé), filet de lumière au centre, halo ambré
  float body = exp(-v * v * 7.0);
  float line = exp(-v * v * 45.0);
  float glow = exp(-v * v * 2.2);
  float head = exp(-behind * behind * 1400.0) * step(uProgress, 0.999);
  // l'or « coule » le long du fil : reflets qui glissent de la tête vers l'arrière
  float flowK = 0.5 + 0.5 * sin(u * 70.0 - uTime * 5.0);
  float shimmer = 0.8 + 0.2 * flowK * (0.6 + 0.4 * sin(u * 23.0 + uTime * 1.7));
  // dissolution en poussière : la clé d'abord, puis les deux retombées ; grain de 90 cellules
  float n = h11(floor(u * 90.0) + 3.1);
  float order = 0.55 * abs(u - 0.5) * 2.0 + 0.45 * n;
  float keep = 1.0 - smoothstep(order - 0.12, order + 0.02, uFade * 1.1);
  float ends = smoothstep(0.0, 0.012, u) * smoothstep(1.0, 0.988, u);
  float on = keep * ends * smoothstep(-0.004, 0.0, behind);
  // juste tracé : plus chaud et plus vif, puis se pose
  float fresh = exp(-max(behind, 0.0) * 9.0);
  vec3 gold = mix(uGlow, uCore, 0.55 + 0.45 * flowK);
  vec3 col = gold * body * (0.85 + 0.6 * fresh) * shimmer
           + vec3(1.0, 0.95, 0.82) * line * (0.55 + 0.5 * fresh + 2.2 * head)
           + uGlow * glow * (0.22 + 0.35 * fresh + 1.1 * head);
  col *= on;
  // l'âme recouvre le fond (l'or se lit sur le stuc clair comme sur le bleu) ; le halo reste additif
  float cover = body * on * 0.82;
  if (cover < 0.003 && max(col.r, max(col.g, col.b)) < 0.003) discard;
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb, cover);
}
`
const VEIL_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const VEIL_FS = /* glsl */ `
uniform float uK;
uniform float uTime;
uniform vec3 uCol;
varying vec2 vUv;
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q * vec2(1.0, 1.25));
  float n = vn(vUv * 3.0 + vec2(uTime * 0.07, -uTime * 0.05)) * 0.6 + vn(vUv * 7.0 - uTime * 0.11) * 0.4;
  // brume plus dense sur les bords (on regarde à travers le nuage), centre dégagé
  float a = uK * (0.45 + 0.55 * smoothstep(0.15, 0.75, r)) * (0.7 + 0.6 * n);
  gl_FragColor = vec4(linearToOutputTexel(vec4(uCol, 1.0)).rgb * a, a);
}
`

// ---------------------------------------------------------------------------------------------
// Champ de rotationnel analytique (divergence nulle) : rot(A) avec A = Σ sinus croisés, deux octaves dont
// la seconde dans un repère tourné. Les bouffées voisines roulent ensemble (volutes cohérentes).
// ---------------------------------------------------------------------------------------------
const CF = { x: 0, y: 0, z: 0 }
function curlField(x, y, z, t) {
  const f = 11.0, g = 16.0
  let cx = -Math.sin(g * y + 1.3 * t) - Math.cos(f * z + t)
  let cy = -Math.sin(g * z - t) - Math.cos(f * x - 0.8 * t)
  let cz = -Math.sin(g * x + 0.7 * t) - Math.cos(f * y + 1.1 * t)
  // octave 2 dans un repère tourné (rotation autour de y puis de x), amplitude 0,5
  const X = 0.8 * x + 0.6 * z, Z = -0.6 * x + 0.8 * z
  const Y = 0.8 * y - 0.6 * Z, Z2 = 0.6 * y + 0.8 * Z
  const f2 = 27.0, g2 = 35.0, t2 = t * 1.6 + 2.0
  const ax = -Math.sin(g2 * Y + t2) - Math.cos(f2 * Z2 - t2)
  const ay = -Math.sin(g2 * Z2 + 0.6 * t2) - Math.cos(f2 * X + t2)
  const az = -Math.sin(g2 * X - t2) - Math.cos(f2 * Y + 0.9 * t2)
  // retour dans le repère de l'ancre (transposée des deux rotations)
  const bx = ax, by = 0.8 * ay + 0.6 * az, bz = -0.6 * ay + 0.8 * az
  cx += 0.5 * (0.8 * bx - 0.6 * bz); cy += 0.5 * by; cz += 0.5 * (0.6 * bx + 0.8 * bz)
  CF.x = cx * 0.33; CF.y = cy * 0.33; CF.z = cz * 0.33
  return CF
}

// ---------------------------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {THREE.Object3D} o.anchor        repère marqueur
 * @param {THREE.Texture} [o.atlas]         ancien atlas T_PB_sillage (accepté, inutilisé : la nuée a son propre atlas)
 * @param {THREE.Texture|string} [o.mistAtlas] atlas de brume (défaut : T_PB_mist.png chargé ici, repli procédural)
 * @param {number[]} [o.sunDir]             direction du soleil (repère jardin ≈ marqueur), défaut MJ_CFG.sunDir
 */
export function createSillage({ anchor, gardenRoot = null, gardenMeta, door = null, archPath = null, atlas = null, mistAtlas = null, quality = 'high', seed = 5, entry = null, sunDir = null } = {}) { // eslint-disable-line no-unused-vars
  const RO = PB_RENDER_ORDER
  const GM = gardenMeta || { K: 0.3002661401098901, X_OFF: 0.005859375, Z_OFF: -0.5323660714285714 }
  const D = door || { seamX: 904 / 1792 - 0.5, y0: (1200 - 2154) / 1792, y1: (1200 - 755) / 1792, halfW: 0.1794 }
  let tier = CAP[quality] ? quality : 'high'
  let cap = CAP[tier]
  const rng = mulberry32(seed)
  const ownTextures = []
  let arch = buildArchPath(archPath, D)

  const group = new THREE.Group()
  group.name = 'PB_Sillage'
  if (anchor) anchor.add(group)

  // ---- atlas de brume ----------------------------------------------------------------------------
  let mistTex = null
  if (mistAtlas && mistAtlas.isTexture) mistTex = mistAtlas
  else {
    mistTex = makeFallbackMistAtlas(); ownTextures.push(mistTex)
    const url = typeof mistAtlas === 'string' ? mistAtlas : MIST_URL
    try {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.NoColorSpace
        t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
        t.needsUpdate = true
        api.setMistAtlas(t, true)
      }, undefined, () => console.warn('[sillage] atlas de brume manquant, repli procédural', url))
    } catch (e) { /* hors navigateur : le repli suffit */ }
  }

  // ---- particules (SoA, préallouées) ----------------------------------------------------------
  const F = () => new Float32Array(MAX)
  const px = F(), py = F(), pz = F(), vx = F(), vy = F(), vz = F()
  const age = F(), life = F(), size0 = F(), size1 = F(), sz = F(), sd = F(), tPh = F(), dly = F(), dur = F()
  const ax = F(), ay = F(), az = F(), bx = F(), by = F(), bz = F(), cx = F(), cy = F(), cz = F(), dx = F(), dy = F(), dz = F()
  const kIdx = F(), grp = F(), add = F(), alpha = F(), cr = F(), cg = F(), cb = F(), rot = F(), rotV = F(), orb = F(), orbV = F()
  const gain = F()   // éclat propre (gouttelettes fines ≈ 0,5, reflets ≈ 1)
  const a0 = F(), glint = F(), stretch = F(), fadeT = F(), tile = F(), ox = F(), oy = F(), oz = F()
  const ph = new Uint8Array(MAX), kind = new Uint8Array(MAX), captured = new Uint8Array(MAX), crossedZ = new Uint8Array(MAX)
  // tour suivant planifié : 1 = fil (horloge du tracé), 2 = poussière (horloge de la pluie) ; la particule garde
  // son comportement actuel jusqu'à pendAt
  const pend = new Uint8Array(MAX), pendAt = F()
  // tri arrière → avant : ordre persistant (presque trié d'une image à l'autre → insertion ≈ linéaire)
  const order = new Uint16Array(MAX), listed = new Uint8Array(MAX), key = F()
  let nOrd = 0

  // ---- quads instanciés ----------------------------------------------------------------------------
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  const iPos = new Float32Array(MAX * 3), iCol = new Float32Array(MAX * 3), iA = new Float32Array(MAX * 4), iB = new Float32Array(MAX * 4), iVel = new Float32Array(MAX * 3)
  const IA = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage)
  const attrs = { iPos: IA(iPos, 3), iCol: IA(iCol, 3), iA: IA(iA, 4), iB: IA(iB, 4), iVel: IA(iVel, 3) }
  for (const k in attrs) geo.setAttribute(k, attrs[k])
  // envoi complet à chaque image (≤ 560 × 17 flottants ≈ 38 ko) : pas de plages, donc pas de tri ni d'objets côté three
  const attrList = Object.values(attrs)
  geo.instanceCount = 0
  const SUN = new THREE.Vector3(...(sunDir || [-0.52, 0.76, 0.38])).normalize()
  const PU = {
    uAtlas: { value: mistTex }, uPx: { value: 800 }, uWorldScale: { value: 1 }, uMaxPx: { value: 400 },
    uCamL: { value: new THREE.Vector3(0, 0, 2) }, uNear: { value: NEAR_FADE }, uSunL: { value: SUN },
    uLit: { value: new THREE.Color('#fff5e8').multiplyScalar(1.04) },
    uShade: { value: new THREE.Color('#c4c6e6').multiplyScalar(0.86) },
    uGlow: { value: new THREE.Color('#ffb85e').multiplyScalar(0.55) },
    uIrid: { value: 0.55 }, uTime: { value: 0 },
  }
  const ptMat = new THREE.ShaderMaterial({
    uniforms: PU, vertexShader: MIST_VS, fragmentShader: MIST_FS,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  const points = new THREE.Mesh(geo, ptMat)
  points.name = 'PB_SillageMist'
  points.renderOrder = RO.sillage
  points.frustumCulled = false
  points.visible = false
  const pxBuf = new THREE.Vector2()
  points.onBeforeRender = function (renderer) {
    renderer.getDrawingBufferSize(pxBuf)
    PU.uPx.value = pxBuf.y * 0.5
    PU.uMaxPx.value = pxBuf.y * MAX_FRAC
    PU.uWorldScale.value = this.matrixWorld.getMaxScaleOnAxis()
  }
  group.add(points)

  // ---- ruban d'or ------------------------------------------------------------------------------
  const ribGeo = new THREE.BufferGeometry()
  const NV = RIBBON_SEG + 1
  const ribPos = new Float32Array(NV * 2 * 3), ribT = new Float32Array(NV * 2 * 3), ribUV = new Float32Array(NV * 2 * 2)
  const ribIdx = []
  for (let i = 0; i < RIBBON_SEG; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; ribIdx.push(a, c, b, b, c, d) }
  ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3))
  ribGeo.setAttribute('aT', new THREE.BufferAttribute(ribT, 3))
  ribGeo.setAttribute('aUV', new THREE.BufferAttribute(ribUV, 2))
  ribGeo.setIndex(ribIdx)
  function fillRibbon() {
    const R = arch.ribbon
    for (let i = 0; i < NV; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NV - 1, i + 1)
      let tx = R[i1 * 3] - R[i0 * 3], ty = R[i1 * 3 + 1] - R[i0 * 3 + 1]
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L
      for (let s = 0; s < 2; s++) {
        const k = i * 2 + s
        ribPos.set([R[i * 3], R[i * 3 + 1], R[i * 3 + 2]], k * 3)
        ribT.set([tx, ty, 0], k * 3)
        ribUV.set([i / (NV - 1), s ? 1 : -1], k * 2)
      }
    }
    ribGeo.attributes.position.needsUpdate = true
    ribGeo.attributes.aT.needsUpdate = true
    ribGeo.attributes.aUV.needsUpdate = true
  }
  fillRibbon()
  const RU = {
    uProgress: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uHalfW: { value: 0.009 }, uWorldScale: { value: 1 }, uPx: { value: 800 },
    uCore: { value: new THREE.Color('#F3DFA8') }, uGlow: { value: new THREE.Color(1.0, 0.58, 0.18) },
  }
  const ribMat = new THREE.ShaderMaterial({
    uniforms: RU, vertexShader: RIB_VS, fragmentShader: RIB_FS,
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const ribbon = new THREE.Mesh(ribGeo, ribMat)
  ribbon.name = 'PB_GoldThread'
  ribbon.renderOrder = RO.ribbon
  ribbon.frustumCulled = false
  ribbon.visible = false
  ribbon.onBeforeRender = function (renderer) {
    RU.uWorldScale.value = this.matrixWorld.getMaxScaleOnAxis()
    renderer.getDrawingBufferSize(pxBuf); RU.uPx.value = pxBuf.y * 0.5
  }
  group.add(ribbon)

  // ---- voile -----------------------------------------------------------------------------------
  const VU = { uK: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(1.0, 0.93, 0.82) } }
  const veilMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: VU, vertexShader: VEIL_VS, fragmentShader: VEIL_FS,
    transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }))
  veilMesh.name = 'PB_MistVeil'
  veilMesh.renderOrder = RO.veil
  veilMesh.frustumCulled = false
  veilMesh.visible = false
  group.add(veilMesh)

  // ---- état ------------------------------------------------------------------------------------
  let time = 0, alive = 0, cursor = 0
  const emit = {
    on: false, t: 0, hold: 0.6, scale: 1, hs: 1, comp: 1,
    nP: 0, nJ: 0, nD: 0, dP: 0, dJ: 0, dD: 0,
    nozzle: new THREE.Vector3(), dir: new THREE.Vector3(), u: new THREE.Vector3(), w: new THREE.Vector3(),
  }
  const pour = { on: false, t: 0, dur: 1.1, onCross: null, crossed: false, nCross: 0, nIn: 0, gx: 0, gy: 0, gz: 0, axx: 0, axy: 0, axz: 1, r0: 0.1 }
  const trace = { on: false, t: 0, dur: 1.2, onDone: null, done: false }
  const rainS = { on: false, t: 0, spacing: 0.8, onLand: null, n: 0, fired: 0, T0: 0.85, fadeT: 0 }
  const landM = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const landG = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const veil = { t: -1, dur: 0.8, k: 0 }
  // Point d'entrée de l'aspiration. Le SPEC vise le centre de la porte (seamX, doorMidY, 0), mais en pose
  // finale le flacon (outPos, 0,40) masque tout le bas de l'embrasure jusqu'à y ≈ 0,08 : la brume entre donc
  // par le haut de l'arc, au-dessus du bouchon, là où on la voit (option `entry` pour revenir au centre).
  const C = entry ? entry.clone() : new THREE.Vector3(D.seamX - 0.015, D.y1 - 0.09, 0)
  const C2 = new THREE.Vector3(C.x + 0.035, C.y - 0.01, -0.12)            // suspension, dans l'embrasure
  const camW = new THREE.Vector3(), inv = new THREE.Matrix4()
  const waterYm = GM.Z_OFF                                                  // y du plan d'eau (y jardin 0) en marqueur
  const isLight = (i) => kind[i] === K_DROP || kind[i] === K_EMBER
  // centre et rayon de la nuée (image précédente) : ombre propre à l'échelle du nuage, côté soleil doré,
  // côté opposé nacre fraîche — c'est ce qui donne du volume à l'ensemble des bouffées
  const cloud = { x: 0, y: 0, z: 0, r: 0.05 }
  // flux moyen du champ sur la nuée (image précédente), retranché : le rotationnel fait rouler les bouffées
  // les unes autour des autres sans emporter tout le nuage d'un côté
  const meanF = { x: 0, y: 0, z: 0 }

  function alloc() {
    for (let n = 0; n < cap; n++) {
      const i = cursor; cursor = (cursor + 1) % cap
      if (ph[i] === DEAD) return i
    }
    return -1
  }
  function kill(i) { if (ph[i] !== DEAD) { ph[i] = DEAD; alive-- } alpha[i] = 0; pend[i] = 0 }
  function resetCommon(i) {
    captured[i] = 0; crossedZ[i] = 0; grp[i] = 0; kIdx[i] = 0; pend[i] = 0; fadeT[i] = 0; dly[i] = -1
    ox[i] = oy[i] = oz[i] = 0; stretch[i] = 0; glint[i] = 0; age[i] = 0; alpha[i] = 0
    sd[i] = rng() * 100
  }
  // direction tirée dans un cône de demi-angle `deg` autour de la buse ; écrit dans (vx, vy, vz) × vitesse
  function coneVel(i, deg, sp, lat) {
    const cosT = 1 - rng() * (1 - Math.cos(deg * Math.PI / 180)), sinT = Math.sqrt(1 - cosT * cosT), phi = rng() * TAU
    const cp = Math.cos(phi), sp2 = Math.sin(phi)
    const E = emit
    const ex = E.dir.x * cosT + (E.u.x * cp + E.w.x * sp2) * sinT
    const ey = E.dir.y * cosT + (E.u.y * cp + E.w.y * sp2) * sinT
    const ez = E.dir.z * cosT + (E.u.z * cp + E.w.z * sp2) * sinT
    // composante latérale libre (entraînement de l'air) : ouvre la nuée bien au-delà du cône du jet
    const psi = rng() * TAU, l = lat * Math.sqrt(rng())
    const lx = (E.u.x * Math.cos(psi) + E.w.x * Math.sin(psi)) * l
    const ly = (E.u.y * Math.cos(psi) + E.w.y * Math.sin(psi)) * l
    const lz = (E.u.z * Math.cos(psi) + E.w.z * Math.sin(psi)) * l
    vx[i] = ex * sp + lx; vy[i] = ey * sp + ly; vz[i] = ez * sp + lz
  }
  function spawnAtNozzle(i, jit) {
    const sc = emit.scale
    px[i] = emit.nozzle.x + emit.dir.x * 0.004 + (rng() - 0.5) * jit * sc
    py[i] = emit.nozzle.y + emit.dir.y * 0.004 + (rng() - 0.5) * jit * sc
    pz[i] = emit.nozzle.z + emit.dir.z * 0.004 + (rng() - 0.5) * jit * sc
  }

  // bouffée du nuage : part vite et étroite, ralentit, gonfle (10 → 55..95 mm), s'éclaircit, roule
  function spawnPuff() {
    const i = alloc(); if (i < 0) return
    ph[i] = MIST; alive++; kind[i] = K_PUFF; resetCommon(i)
    const sc = emit.scale, hs = emit.hs, comp = emit.comp
    spawnAtNozzle(i, 0.004)
    coneVel(i, 12, (0.6 + 0.6 * rng()) * hs * sc, (0.1 + 0.26 * rng()) * hs * sc)
    vy[i] += 0.1 * sc * hs   // la brume chaude monte : le nuage s'élève au-dessus du bouchon
    life[i] = 2.7 + 1.0 * rng()
    size0[i] = (8 + 6 * rng()) * MM * sc
    size1[i] = (36 + 30 * rng()) * MM * sc * hs * comp
    sz[i] = size0[i]
    const r = rng()
    tile[i] = r < 0.28 ? 0 : r < 0.7 ? 1 : r < 0.82 ? 2 : 3
    a0[i] = (0.42 + 0.14 * rng()) * Math.sqrt(comp)
    // ~15 % des bouffées sont un voile ample et très léger : la nuée se prolonge en brume autour de son cœur
    if (rng() < 0.15) { size1[i] *= 1.5; a0[i] *= 0.42; tile[i] = rng() < 0.5 ? 1 : 3 }
    const w = rng()
    cr[i] = 1.0; cg[i] = 0.975 + 0.025 * w; cb[i] = 0.94 + 0.06 * w; add[i] = 0.03
    rot[i] = rng() * TAU; rotV[i] = (rng() - 0.5) * 0.7
    stretch[i] = 0.35
  }
  // jet : filets étirés, rapides et brefs, au ras de la buse (le « pschitt »)
  function spawnJet() {
    const i = alloc(); if (i < 0) return
    ph[i] = MIST; alive++; kind[i] = K_JET; resetCommon(i)
    const sc = emit.scale, hs = emit.hs
    spawnAtNozzle(i, 0.002)
    coneVel(i, 9, (1.5 + 1.1 * rng()) * hs * sc, 0.06 * sc)
    life[i] = 0.32 + 0.26 * rng()
    size0[i] = (3 + 2 * rng()) * MM * sc
    size1[i] = (14 + 10 * rng()) * MM * sc * hs
    sz[i] = size0[i]
    tile[i] = rng() < 0.7 ? 2 : 1
    a0[i] = 0.5 + 0.2 * rng()
    cr[i] = 1.0; cg[i] = 0.98; cb[i] = 0.95; add[i] = 0.35
    rot[i] = rng() * TAU; rotV[i] = 0
    stretch[i] = 1
  }
  // micro-gouttelette : poussière liquide qui accroche la lumière ; ~14 % font un reflet en croix
  function spawnDrop() {
    const i = alloc(); if (i < 0) return
    ph[i] = MIST; alive++; kind[i] = K_DROP; resetCommon(i)
    const sc = emit.scale, hs = emit.hs
    spawnAtNozzle(i, 0.004)
    coneVel(i, 14, (0.7 + 0.9 * rng()) * hs * sc, (0.08 + 0.26 * rng()) * hs * sc)
    life[i] = 1.8 + 1.4 * rng()
    const gl = rng() < 0.06
    glint[i] = gl ? 1 : 0
    size0[i] = size1[i] = sz[i] = (gl ? 6 + 3 * rng() : 1.8 + 1.6 * rng()) * MM * sc
    gain[i] = gl ? 0.9 + 0.3 * rng() : 0.6 + 0.5 * rng()
    // or blanc, quelques reflets nacrés (rose, aqua, or)
    const t = rng()
    if (t < 0.12) { cr[i] = 1.55; cg[i] = 1.2; cb[i] = 1.3 } else if (t < 0.22) { cr[i] = 1.15; cg[i] = 1.45; cb[i] = 1.5 } else if (t < 0.45) { cr[i] = 1.6; cg[i] = 1.32; cb[i] = 0.9 } else { cr[i] = 1.55; cg[i] = 1.45; cb[i] = 1.25 }
    add[i] = 1
    rot[i] = GLINT_ROT; rotV[i] = 0
  }

  // aspiration vers la porte (bézier : position → tourbillon → couronne devant la porte → embrasure)
  function toAttract(i) {
    ph[i] = ATTRACT; tPh[i] = 0
    const puff = kind[i] === K_PUFF
    dur[i] = pour.dur * (puff ? 1.0 + 0.6 * rng() : 0.72 + 0.45 * rng())
    ax[i] = px[i]; ay[i] = py[i]; az[i] = pz[i]
    // tourbillon : rotation de 90° de (p − G) autour de l'axe G → C, plus l'élan
    const rx = px[i] - pour.gx, ry = py[i] - pour.gy, rz = pz[i] - pour.gz
    const sxv = pour.axy * rz - pour.axz * ry, syv = pour.axz * rx - pour.axx * rz, szv = pour.axx * ry - pour.axy * rx
    const sw = puff ? 0.2 : 1.3
    bx[i] = px[i] + sxv * sw + vx[i] * 0.12 + (C.x - px[i]) * 0.2
    by[i] = py[i] + syv * sw + vy[i] * 0.12 + (C.y - py[i]) * 0.2 + (puff ? 0.06 : 0)
    bz[i] = pz[i] + szv * sw + vz[i] * 0.12 + (C.z - pz[i]) * 0.2
    const a = rng() * TAU, rr = puff ? 0.07 + rng() * 0.1 : 0.03 + rng() * 0.045
    cx[i] = C.x + Math.cos(a) * rr; cy[i] = C.y + Math.sin(a) * rr * 1.2; cz[i] = 0.07 + rng() * 0.06
    const b = rng() * TAU, q = puff ? 0.02 + rng() * 0.03 : 0.012 + rng() * 0.03
    dx[i] = C2.x + Math.cos(b) * q; dy[i] = C2.y + Math.sin(b) * q * 1.2; dz[i] = C2.z + (rng() - 0.5) * 0.03
    size0[i] = sz[i]
    if (puff) { size1[i] = sz[i] * (0.55 + 0.15 * rng()); a0[i] = alpha[i]; stretch[i] = 0.8 }
    else size1[i] = sz[i]
    ox[i] = oy[i] = oz[i] = 0
    orb[i] = rng() * TAU; orbV[i] = (rng() < 0.5 ? -1 : 1) * (2.2 + rng() * 2.2)
    pour.nIn++
  }
  function becomeLight(i) {
    // la brume franchit la porte et devient lumière
    if (kind[i] === K_DROP || kind[i] === K_JET) {
      kind[i] = K_EMBER; glint[i] = 0
      size1[i] = (3.5 + 3 * rng()) * MM; sz[i] = Math.min(sz[i], size1[i] * 2)
      rot[i] = GLINT_ROT
    }
    cr[i] = 1.4; cg[i] = 1.1; cb[i] = 0.68
  }

  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d }

  function toThread(i, k, ts, ta) {
    pend[i] = 1; pendAt[i] = ts
    kIdx[i] = k
    dur[i] = Math.max(0.12, ta - ts)
  }

  function setupDust(i, g, ts, ta) {
    pend[i] = 2; pendAt[i] = ts
    grp[i] = g; dur[i] = Math.max(0.45, ta - ts)
  }
  function spawnLight(i, phase) {
    ph[i] = phase; alive++; resetCommon(i); tPh[i] = 0
    kind[i] = K_EMBER; vx[i] = vy[i] = vz[i] = 0
    add[i] = 1; rot[i] = GLINT_ROT; rotV[i] = 0; life[i] = 99
  }

  // ---- API -------------------------------------------------------------------------------------
  const api = {
    group, points, ribbon, veilMesh,
    /** Pschitt : nozzle et dir dans le repère de l'ancre ; hold 0,6..1,4 s (plus long = nuage plus ample et plus dense). */
    spray({ nozzle, dir, hold = 0.6, scale = 1 } = {}) {
      if (!nozzle || !dir) return
      // une nouvelle pression clôt l'aspiration précédente (sinon la nouvelle nuée serait happée aussitôt)
      pour.on = false
      emit.on = true; emit.t = 0
      emit.hold = clamp(hold, 0.25, 1.6)
      emit.scale = scale
      const hk = clamp01((emit.hold - 0.6) / 0.8)
      emit.hs = 0.88 + 0.26 * hk
      const B = BUDGET[tier]
      emit.comp = Math.pow(BUDGET.high.puff / B.puff, 0.3) // moins de bouffées → bouffées un peu plus grandes
      const n = 0.62 + 0.38 * hk
      emit.nP = Math.round(B.puff * n); emit.nJ = Math.round(B.jet * n); emit.nD = Math.round(B.drop * n)
      emit.dP = emit.dJ = emit.dD = 0
      emit.nozzle.copy(nozzle)
      emit.dir.copy(dir).normalize()
      emit.u.set(0, 1, 0)
      if (Math.abs(emit.dir.y) > 0.9) emit.u.set(1, 0, 0)
      emit.w.crossVectors(emit.dir, emit.u).normalize()
      emit.u.crossVectors(emit.w, emit.dir).normalize()
      points.visible = true
    },
    /** La brume s'enroule et est aspirée par la porte ; onCross() quand le flux franchit le plan du poster. */
    pourToDoor({ dur: d = 1.1, onCross = null } = {}) {
      pour.on = true; pour.t = 0; pour.dur = d; pour.onCross = onCross; pour.crossed = false; pour.nCross = 0; pour.nIn = 0
      // barycentre de la brume et axe du tourbillon
      let n = 0, gx = 0, gy = 0, gz = 0
      for (let i = 0; i < MAX; i++) if (ph[i] === MIST && kind[i] === K_PUFF) { gx += px[i]; gy += py[i]; gz += pz[i]; n++ }
      if (n) { gx /= n; gy /= n; gz /= n } else { gx = emit.nozzle.x; gy = emit.nozzle.y; gz = emit.nozzle.z }
      pour.gx = gx; pour.gy = gy; pour.gz = gz
      pour.r0 = Math.max(0.03, cloud.r)
      let axv = C.x - gx, ayv = C.y - gy, azv = C.z - gz
      const L = Math.hypot(axv, ayv, azv) || 1
      pour.axx = axv / L; pour.axy = ayv / L; pour.axz = azv / L
      // la nuée ne part pas d'un bloc : chaque bouffée est happée à son tour (les plus proches de la porte d'abord)
      for (let i = 0; i < MAX; i++) {
        if (ph[i] !== MIST) continue
        const dd = Math.hypot(px[i] - C.x, py[i] - C.y, pz[i] - C.z)
        dly[i] = kind[i] === K_PUFF ? clamp(dd * 0.7, 0, 0.3) + rng() * 0.25 : rng() * 0.25
      }
    },
    /** Le fil d'or dessine l'arc (naissance gauche → clé → naissance droite) en `dur` s. */
    traceArch({ dur: d = 1.2, onDone = null } = {}) {
      trace.on = true; trace.t = 0; trace.dur = d; trace.onDone = onDone; trace.done = false
      RU.uProgress.value = 0; RU.uFade.value = 0
      ribbon.visible = true
      // la lumière disponible (gouttelettes, braises) → indices du chemin répartis uniformément (ordre aléatoire)
      const avail = (i) => { const p = ph[i]; return (p === MIST || p === ATTRACT || p === HOVER) && isLight(i) && fadeT[i] <= 0 }
      let n = 0
      for (let i = 0; i < MAX; i++) if (avail(i)) n++
      let j = 0
      const off = rng()
      for (let i = 0; i < MAX; i++) {
        if (!avail(i)) continue
        const k = clamp(((j + off) / Math.max(1, n)) * (PATH_N - 1) + (rng() - 0.5) * 0.8, 0, PATH_N - 1)
        j++
        const tk = (k / (PATH_N - 1)) * d
        toThread(i, k, Math.max(0, tk - 0.34), tk)
      }
      // brins de lumière supplémentaires pour un fil dense (jusqu'à 1 par cible)
      const extra = Math.min(cap - alive, Math.max(0, PATH_N - n))
      for (let e = 0; e < extra; e++) {
        const i = alloc()
        if (i < 0) break
        spawnLight(i, HOVER)
        const k = clamp(((e + 0.5) / extra) * (PATH_N - 1), 0, PATH_N - 1)
        const a = rng() * TAU, q = 0.01 + rng() * 0.03
        px[i] = C2.x + Math.cos(a) * q; py[i] = C2.y + Math.sin(a) * q; pz[i] = C2.z
        ax[i] = px[i] - C2.x; ay[i] = py[i] - C2.y; az[i] = 0; crossedZ[i] = 1
        sz[i] = size0[i] = size1[i] = (3 + 3 * rng()) * MM
        cr[i] = 1.4; cg[i] = 1.1; cb[i] = 0.68
        orb[i] = rng() * TAU; orbV[i] = 3
        const tk = (k / (PATH_N - 1)) * d
        toThread(i, k, Math.max(0, tk - 0.3), tk)
      }
      points.visible = true
    },
    /** Le fil se défait en poussière d'or qui pleut sur le bassin ; onLand(i, pGarden) à chaque impact. */
    rain({ landings = PB_CFG.rain.map((p) => new THREE.Vector3(...p)), spacing = PB_CFG.rainSpacing ?? 0.8, onLand = null } = {}) {
      const G = Math.min(landings.length, landG.length)
      if (!G) return
      rainS.on = true; rainS.t = 0; rainS.spacing = spacing; rainS.onLand = onLand; rainS.n = G; rainS.fired = 0
      rainS.fadeT = 0
      for (let g = 0; g < G; g++) {
        const L = landings[g]
        landG[g].set(L.x, L.y ?? 0, L.z)
        landM[g].set(GM.X_OFF + GM.K * L.x, GM.Z_OFF + GM.K * (L.y ?? 0), GM.K * L.z)
      }
      // poussière : toute la lumière vivante + braises détachées du fil ; les bouffées restantes s'évanouissent
      const T0 = rainS.T0
      let j = 0
      for (let i = 0; i < MAX; i++) {
        const p = ph[i]
        if (p === DEAD || p === DUST || p === LANDED) continue
        if (kind[i] === K_PUFF) { if (fadeT[i] <= 0) fadeT[i] = 1e-4; continue }
        const onArc = p === PEARL || p === THREAD
        const u = onArc ? kIdx[i] / (PATH_N - 1) : 0.5
        const ts = onArc ? 0.3 * Math.abs(u - 0.5) * 2 + rng() * 0.12 : rng() * 0.15
        const g = j++ % G
        const ta = T0 + g * spacing + (rng() - 0.5) * spacing * 0.55
        becomeLight(i)
        setupDust(i, g, ts, ta)
      }
      if (ribbon.visible) {
        const extra = Math.min(cap - alive, 140)
        const R = arch.path
        for (let e = 0; e < extra; e++) {
          const i = alloc()
          if (i < 0) break
          spawnLight(i, PEARL)
          const k = Math.floor(rng() * PATH_N)
          px[i] = dx[i] = R[k * 3]; py[i] = dy[i] = R[k * 3 + 1]; pz[i] = dz[i] = R[k * 3 + 2]
          if (rng() < 0.25) glint[i] = 0.6
          sz[i] = size0[i] = size1[i] = (2.5 + 3 * rng()) * MM
          cr[i] = 1.4; cg[i] = 1.08; cb[i] = 0.64
          kIdx[i] = k
          const u = k / (PATH_N - 1)
          const ts = 0.3 * Math.abs(u - 0.5) * 2 + 0.05 + rng() * 0.2
          const g = j++ % G
          setupDust(i, g, ts, T0 + g * spacing + (rng() - 0.5) * spacing * 0.55)
        }
      }
      points.visible = true
    },
    /** Voile de brume plein écran (k ≤ 0,15, dur ≤ 0,8 s). La caméra n'est pas nécessaire (quad en espace écran). */
    veil(k = 0.12, d = 0.8, camera = null) { // eslint-disable-line no-unused-vars
      veil.k = clamp(k, 0, 0.15); veil.dur = clamp(d, 0.1, 0.8); veil.t = 0
      veilMesh.visible = true
    },
    clear() {
      for (let i = 0; i < MAX; i++) { ph[i] = DEAD; alpha[i] = 0; pend[i] = 0; listed[i] = 0 }
      alive = 0; nOrd = 0; geo.instanceCount = 0
      meanF.x = meanF.y = meanF.z = 0
      emit.on = false; pour.on = false; trace.on = false; rainS.on = false; veil.t = -1
      points.visible = false; ribbon.visible = false; veilMesh.visible = false
      RU.uProgress.value = 0; RU.uFade.value = 0
    },
    update(dt, camera) {
      dt = Math.min(Math.max(dt, 0), 0.1)
      time += dt
      RU.uTime.value = time
      VU.uTime.value = time
      PU.uTime.value = time
      if (camera) {
        group.updateWorldMatrix(true, false)
        inv.copy(group.matrixWorld).invert()
        camera.getWorldPosition(camW)
        PU.uCamL.value.copy(camW.applyMatrix4(inv))
      }
      // émission : bouffée initiale (42 % en 0,12 s) puis débit régulier jusqu'à la fin de la pression ;
      // le jet est concentré au début (il s'éteint avant la fin de la pression)
      if (emit.on) {
        emit.t += dt
        const f = emit.t < 0.12 ? 0.42 * emit.t / 0.12 : 0.42 + 0.58 * clamp01((emit.t - 0.12) / Math.max(0.05, emit.hold - 0.12))
        const fj = Math.min(1, f * 1.3)
        const wP = Math.round(emit.nP * f), wJ = Math.round(emit.nJ * fj), wD = Math.round(emit.nD * f)
        while (emit.dJ < wJ) { spawnJet(); emit.dJ++ }
        while (emit.dP < wP) { spawnPuff(); emit.dP++ }
        while (emit.dD < wD) { spawnDrop(); emit.dD++ }
        if (emit.t >= emit.hold) emit.on = false
      }
      if (pour.on) pour.t += dt
      // tracé du fil
      if (trace.on) {
        trace.t += dt
        RU.uProgress.value = clamp01(trace.t / trace.dur)
        if (!trace.done && trace.t >= trace.dur) {
          trace.done = true
          if (trace.onDone) { try { trace.onDone() } catch (e) { console.warn('[sillage] onDone', e) } }
        }
        // sécurité : sans pluie (directeur interrompu), le fil se défait seul 4 s après le tracé
        if (!rainS.on && trace.t > trace.dur + 4) {
          RU.uFade.value = clamp01((trace.t - trace.dur - 4) / 1.2)
          if (RU.uFade.value >= 1) { ribbon.visible = false; trace.on = false }
        }
      }
      // pluie : dissolution du ruban + impacts
      if (rainS.on) {
        rainS.t += dt
        RU.uFade.value = clamp01(rainS.t / 0.9)
        if (RU.uFade.value >= 1) { ribbon.visible = false; trace.on = false }
        while (rainS.fired < rainS.n && rainS.t >= rainS.T0 + rainS.fired * rainS.spacing) {
          const g = rainS.fired++
          if (rainS.onLand) { try { rainS.onLand(g, landG[g]) } catch (e) { console.warn('[sillage] onLand', e) } }
        }
        if (rainS.fired >= rainS.n && alive === 0) rainS.on = false
      }
      // voile
      if (veil.t >= 0) {
        veil.t += dt
        const u = veil.t / veil.dur
        VU.uK.value = veil.k * (u < 0.25 ? smooth(u / 0.25) : 1 - smooth((u - 0.25) / 0.75))
        if (u >= 1) { veil.t = -1; VU.uK.value = 0; veilMesh.visible = false }
      }
      if (!alive && !emit.on) {
        if (points.visible) { points.visible = false; geo.instanceCount = 0 }
        for (let j = 0; j < nOrd; j++) listed[order[j]] = 0
        nOrd = 0
        return
      }
      points.visible = true

      const R = arch.path
      const tf = time * 0.55
      // nuée aspirée : elle se resserre, donc chaque bouffée s'efface d'autant (la couverture totale ne monte pas)
      const sq = cloud.r / pour.r0
      const squeeze = pour.on ? clamp(sq * Math.sqrt(sq), 0.12, 1) : 1
      let gN = 0, gX = 0, gY = 0, gZ = 0, gR = 0, fN = 0, fX = 0, fY = 0, fZ = 0
      for (let i = 0; i < MAX; i++) {
        if (ph[i] === DEAD) continue
        // tour planifié atteint : on bascule (capture de la position courante au premier pas)
        if (pend[i] === 1 && trace.on && trace.t >= pendAt[i]) { pend[i] = 0; ph[i] = THREAD; tPh[i] = 0; captured[i] = 0 }
        else if (pend[i] === 2 && rainS.on && rainS.t >= pendAt[i]) { pend[i] = 0; ph[i] = DUST; tPh[i] = 0; captured[i] = 0 }
        const p = ph[i]
        age[i] += dt
        tPh[i] += dt
        rot[i] += rotV[i] * dt
        let a = 0
        const k = kind[i]
        if (p === MIST) {
          const sc = emit.scale
          const ag = age[i]
          if (k === K_PUFF) {
            // jet freiné en ~0,3 s, puis la bouffée roule sur le champ, monte doucement et dérive vers l'axe de la porte
            const e = Math.exp(-3.1 * dt)
            vx[i] *= e; vy[i] *= e; vz[i] *= e
            curlField(px[i], py[i], pz[i], tf + sd[i] * 0.002)
            const ta = 0.08 * emit.hs * sc * smooth(ag / 0.45)
            fN++; fX += CF.x * ta; fY += CF.y * ta; fZ += CF.z * ta
            px[i] += (vx[i] + CF.x * ta - meanF.x + (C.x - px[i]) * 0.05) * dt
            py[i] += (vy[i] + CF.y * ta - meanF.y + 0.06 * sc * smooth(ag / 0.6)) * dt
            pz[i] += (vz[i] + CF.z * ta - meanF.z) * dt
            sz[i] = size0[i] + (size1[i] - size0[i]) * (1 - Math.exp(-ag / 0.5)) + 0.012 * sc * ag
            // même quantité de brume sur une surface qui grandit : la bouffée s'éclaircit en s'ouvrant
            const thin = Math.min(1, Math.pow(size0[i] / sz[i], 0.8))
            const L = life[i]
            const env = smooth(ag / 0.05) * (dly[i] >= 0 ? 1 : 1 - smooth((ag - L * 0.55) / (L * 0.45)))
            a = a0[i] * (0.3 + 0.7 * thin) * env
          } else if (k === K_JET) {
            const e = Math.exp(-5.0 * dt)
            vx[i] *= e; vy[i] *= e; vz[i] *= e
            px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt
            const u = ag / life[i]
            sz[i] = size0[i] + (size1[i] - size0[i]) * easeOut(u)
            a = a0[i] * smooth(ag / 0.03) * (1 - smooth(u))
            if (u >= 1) { kill(i); continue }
          } else {
            // gouttelettes : moins freinées (elles constellent la nuée), retombent à peine, scintillent
            const e = Math.exp(-2.8 * dt)
            vx[i] *= e; vy[i] *= e; vz[i] *= e
            curlField(px[i], py[i], pz[i], tf + 7.0)
            const ta = 0.075 * emit.hs * sc * smooth(ag / 0.5)
            px[i] += (vx[i] + CF.x * ta - meanF.x + (C.x - px[i]) * 0.04) * dt
            py[i] += (vy[i] + CF.y * ta - meanF.y + 0.02 * sc) * dt
            pz[i] += (vz[i] + CF.z * ta - meanF.z) * dt
            const L = life[i]
            const env = smooth(ag / 0.08) * (dly[i] >= 0 || pend[i] ? 1 : 1 - smooth((ag - L * 0.5) / (L * 0.5)))
            if (glint[i] > 0) {
              const fl = 0.5 + 0.5 * Math.sin(ag * (5 + (sd[i] % 4)) + sd[i])
              a = gain[i] * env * (0.12 + 1.1 * fl * fl * fl * fl)
            } else {
              const tw = 0.5 + 0.5 * Math.sin(ag * (6 + (sd[i] % 5)) + sd[i]), tw2 = tw * tw
              a = gain[i] * env * (0.1 + 0.9 * tw2 * tw2 * tw)
            }
          }
          // la brume mûre rejoint l'aspiration à son tour
          if (pour.on && dly[i] >= 0 && age[i] > 0.12 && pour.t >= dly[i]) toAttract(i)
          else if (pour.on && dly[i] < 0 && k !== K_JET) dly[i] = pour.t + rng() * 0.3   // née pendant l'aspiration
          else if (age[i] >= life[i] && !pend[i] && dly[i] < 0) { kill(i); continue }
        } else if (p === ATTRACT) {
          const u = clamp01(tPh[i] / dur[i])
          const e = u * u * (3 - 2 * u)
          let bxv = bez(ax[i], bx[i], cx[i], dx[i], e), byv = bez(ay[i], by[i], cy[i], dy[i], e), bzv = bez(az[i], bz[i], cz[i], dz[i], e)
          if (k === K_PUFF) {
            // la bouffée continue de rouler pendant qu'on l'aspire, puis se resserre en un filet qui s'éteint
            curlField(px[i], py[i], pz[i], tf + sd[i] * 0.002)
            const ta = 0.07 * (1 - e)
            ox[i] += CF.x * ta * dt; oy[i] += CF.y * ta * dt; oz[i] += CF.z * ta * dt
            const kk = 1 - e
            bxv += ox[i] * kk; byv += oy[i] * kk; bzv += oz[i] * kk
            sz[i] = size0[i] + (size1[i] - size0[i]) * e
            const zf = bzv < 0.02 ? 1 - smooth((0.02 - bzv) / 0.09) : 1
            a = a0[i] * squeeze * (1 - 0.6 * smooth(u * 1.25)) * (1 - smooth((u - 0.55) / 0.45)) * zf
            cr[i] += (1.0 - cr[i]) * Math.min(1, dt * 1.5); cg[i] += (0.93 - cg[i]) * Math.min(1, dt * 1.5); cb[i] += (0.82 - cb[i]) * Math.min(1, dt * 1.5)
            add[i] += (0.1 - add[i]) * Math.min(1, dt * 2)
          } else {
            sz[i] = size0[i] + (size1[i] - size0[i]) * e
            cr[i] += (1.25 - cr[i]) * Math.min(1, dt * 2); cg[i] += (0.98 - cg[i]) * Math.min(1, dt * 2); cb[i] += (0.62 - cb[i]) * Math.min(1, dt * 2)
            a = 0.6 * (0.7 + 0.3 * Math.sin(age[i] * 17 + sd[i])) * (glint[i] > 0 ? 0.9 : gain[i])
          }
          vx[i] = (bxv - px[i]) / Math.max(dt, 1e-3); vy[i] = (byv - py[i]) / Math.max(dt, 1e-3); vz[i] = (bzv - pz[i]) / Math.max(dt, 1e-3)
          px[i] = bxv; py[i] = byv; pz[i] = bzv
          if (!crossedZ[i] && pz[i] < 0) {
            crossedZ[i] = 1; pour.nCross++
            // passée la porte, une gouttelette sur trois seulement devient braise (le cœur lumineux reste lisible) ;
            // les autres s'éteignent
            if (k === K_DROP && rng() < 0.66) { if (fadeT[i] <= 0) fadeT[i] = 1e-4 } else if (k !== K_PUFF) becomeLight(i)
            if (!pour.crossed && pour.nCross >= Math.max(3, pour.nIn * 0.12)) {
              pour.crossed = true
              if (pour.onCross) { try { pour.onCross() } catch (err) { console.warn('[sillage] onCross', err) } }
            }
          }
          if (u >= 1) {
            if (k === K_PUFF) { kill(i); continue }
            ph[i] = HOVER; tPh[i] = 0
            ax[i] = px[i] - C2.x; ay[i] = py[i] - C2.y; az[i] = pz[i] - C2.z
            if (!crossedZ[i]) { crossedZ[i] = 1; becomeLight(i) }
          }
        } else if (p === HOVER) {
          // suspension : orbites autour du cœur lumineux, dans l'embrasure
          orb[i] += orbV[i] * dt
          const c = Math.cos(orb[i] * 0.35), s = Math.sin(orb[i] * 0.35)
          px[i] = C2.x + ax[i] * c - az[i] * s
          py[i] = C2.y + ay[i] + Math.sin(time * 1.7 + sd[i]) * 0.004
          pz[i] = C2.z + ax[i] * s + az[i] * c
          a = 0.85 * (0.6 + 0.4 * Math.sin(age[i] * 13 + sd[i])) * Math.min(1, alpha[i] + dt * 4)
          if (tPh[i] > 5 && !pend[i]) { kill(i); continue }
        } else if (p === THREAD) {
          // vol vers sa cible sur l'arc ; arrivée quand la tête du fil y passe
          if (!captured[i]) {
            captured[i] = 1
            becomeLight(i)
            add[i] = 1
            ax[i] = px[i]; ay[i] = py[i]; az[i] = pz[i]
            const kk = Math.round(kIdx[i])
            const tx = R[kk * 3], ty = R[kk * 3 + 1], tz = R[kk * 3 + 2]
            // vers l'intérieur de l'embrasure (approx. : vers le centre de la porte)
            let nx = C.x - tx, ny = C.y - ty
            const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L
            bx[i] = ax[i] + (tx - ax[i]) * 0.2; by[i] = ay[i] + (ty - ay[i]) * 0.2; bz[i] = az[i] + 0.05
            cx[i] = tx + nx * 0.03; cy[i] = ty + ny * 0.03; cz[i] = tz + 0.035
            // cible sur le chemin : ≤ 2 mm de travers, ≤ 1 mm en profondeur
            const jn = (rng() - 0.5) * 0.004
            dx[i] = tx + nx * jn; dy[i] = ty + ny * jn; dz[i] = tz + (rng() - 0.5) * 0.002
          }
          const u = clamp01(tPh[i] / dur[i])
          const e = u * u * (3 - 2 * u)
          px[i] = bez(ax[i], bx[i], cx[i], dx[i], e); py[i] = bez(ay[i], by[i], cy[i], dy[i], e); pz[i] = bez(az[i], bz[i], cz[i], dz[i], e)
          sz[i] += ((glint[i] > 0 ? 5 : 3.2) * MM - sz[i]) * Math.min(1, dt * 4)
          a = 0.9
          if (u >= 1) { ph[i] = PEARL; tPh[i] = 0 }
        } else if (p === PEARL) {
          const tw = 0.5 + 0.5 * Math.sin(age[i] * (9 + (sd[i] % 7)) + sd[i])
          px[i] = dx[i]; py[i] = dy[i]; pz[i] = dz[i] + Math.sin(time * 2 + sd[i]) * 0.0008
          a = (0.55 + 0.45 * tw * tw) * Math.min(1, alpha[i] + dt * 5)
          if (tPh[i] > 6 && !pend[i]) { kill(i); continue }
        } else if (p === DUST) {
          if (!captured[i]) {
            captured[i] = 1
            becomeLight(i)
            add[i] = 1
            ax[i] = px[i]; ay[i] = py[i]; az[i] = pz[i]
            const L = landM[grp[i]]
            bx[i] = ax[i] + (D.seamX - ax[i]) * 0.08; by[i] = ay[i] - 0.06 - rng() * 0.04; bz[i] = Math.min(az[i], 0) - 0.16 - rng() * 0.1
            cx[i] = ax[i] + (L.x - ax[i]) * (0.35 + 0.2 * rng()); cy[i] = L.y + 0.1 + rng() * 0.08; cz[i] = L.z + 0.1 + rng() * 0.1
            const r = Math.sqrt(rng()) * 0.045, th = rng() * TAU
            dx[i] = L.x + Math.cos(th) * r * 0.8; dy[i] = waterYm + GM.K * 0.002; dz[i] = L.z + Math.sin(th) * r * 1.3
          }
          const u = clamp01(tPh[i] / dur[i])
          const e = Math.pow(u, 1.35)
          px[i] = bez(ax[i], bx[i], cx[i], dx[i], e); py[i] = bez(ay[i], by[i], cy[i], dy[i], e); pz[i] = bez(az[i], bz[i], cz[i], dz[i], e)
          px[i] += Math.sin(age[i] * 3 + sd[i]) * 0.003 * (1 - u)
          sz[i] += ((glint[i] > 0 ? 6 : 4.5) * MM - sz[i]) * Math.min(1, dt * 3)
          a = 0.95 * (0.65 + 0.35 * Math.sin(age[i] * 19 + sd[i]))
          if (u >= 1) { ph[i] = LANDED; tPh[i] = 0; life[i] = 0.35 + rng() * 0.6 }
        } else if (p === LANDED) {
          const u = tPh[i] / life[i]
          a = (1 - smooth(u)) * (0.6 + 0.4 * Math.sin(age[i] * 31 + sd[i])) * 1.1
          if (u >= 1) { kill(i); continue }
        }
        // extinction forcée (pluie) : 0,45 s
        if (fadeT[i] > 0) {
          fadeT[i] += dt
          a *= 1 - smooth(fadeT[i] / 0.45)
          if (fadeT[i] >= 0.45) { kill(i); continue }
        }
        alpha[i] = a
        if (k === K_PUFF && (p === MIST || p === ATTRACT)) {
          const ddx = px[i] - cloud.x, ddy = py[i] - cloud.y, ddz = pz[i] - cloud.z
          gN++; gX += px[i]; gY += py[i]; gZ += pz[i]; gR += ddx * ddx + ddy * ddy + ddz * ddz
        }
      }
      if (fN) { meanF.x = fX / fN; meanF.y = fY / fN; meanF.z = fZ / fN } else { meanF.x = meanF.y = meanF.z = 0 }
      if (gN) { cloud.x = gX / gN; cloud.y = gY / gN; cloud.z = gZ / gN; cloud.r = Math.max(0.03, Math.sqrt(gR / gN)) }
      else { cloud.x = emit.nozzle.x; cloud.y = emit.nozzle.y; cloud.z = emit.nozzle.z; cloud.r = 0.03 }

      // ---- tri arrière → avant et écriture des instances ----------------------------------------
      const cl = PU.uCamL.value
      let n = 0
      for (let j = 0; j < nOrd; j++) { const i = order[j]; if (ph[i] !== DEAD) order[n++] = i; else listed[i] = 0 }
      for (let i = 0; i < MAX; i++) if (ph[i] !== DEAD && !listed[i]) { listed[i] = 1; order[n++] = i }
      nOrd = n
      for (let j = 0; j < n; j++) { const i = order[j]; const ddx = px[i] - cl.x, ddy = py[i] - cl.y, ddz = pz[i] - cl.z; key[i] = ddx * ddx + ddy * ddy + ddz * ddz }
      for (let j = 1; j < n; j++) {
        const i = order[j], kv = key[i]
        let m = j - 1
        while (m >= 0 && key[order[m]] < kv) { order[m + 1] = order[m]; m-- }
        order[m + 1] = i
      }
      for (let j = 0; j < n; j++) {
        const i = order[j], j3 = j * 3, j4 = j * 4
        iPos[j3] = px[i]; iPos[j3 + 1] = py[i]; iPos[j3 + 2] = pz[i]
        const k = kind[i]
        if (k === K_PUFF || k === K_JET) {
          const lf = clamp01(0.5 + 0.6 * ((px[i] - cloud.x) * SUN.x + (py[i] - cloud.y) * SUN.y + (pz[i] - cloud.z) * SUN.z) / cloud.r)
          iCol[j3] = cr[i] * (0.8 + 0.24 * lf); iCol[j3 + 1] = cg[i] * (0.8 + 0.2 * lf); iCol[j3 + 2] = cb[i] * (0.92 + 0.03 * lf)
        } else { iCol[j3] = cr[i]; iCol[j3 + 1] = cg[i]; iCol[j3 + 2] = cb[i] }
        iA[j4] = alpha[i]; iA[j4 + 1] = sz[i]; iA[j4 + 2] = k === K_PUFF || k === K_JET ? tile[i] : k === K_DROP ? G_DROP : G_EMBER; iA[j4 + 3] = add[i]
        iB[j4] = rot[i]; iB[j4 + 1] = ph[i] === MIST || ph[i] === ATTRACT ? stretch[i] : 0; iB[j4 + 2] = sd[i] * 0.01; iB[j4 + 3] = glint[i]
        iVel[j3] = vx[i]; iVel[j3 + 1] = vy[i]; iVel[j3 + 2] = vz[i]
      }
      geo.instanceCount = n
      for (let a = 0; a < attrList.length; a++) attrList[a].needsUpdate = true
    },
    stats() {
      let drawCalls = 0, triangles = 0, puffs = 0
      for (let i = 0; i < MAX; i++) if (ph[i] !== DEAD && kind[i] === K_PUFF) puffs++
      if (points.visible) { drawCalls++; triangles += geo.instanceCount * 2 }
      if (ribbon.visible) { drawCalls++; triangles += RIBBON_SEG * 2 }
      if (veilMesh.visible) { drawCalls++; triangles += 2 }
      return { drawCalls, triangles, points: alive, puffs, instances: geo.instanceCount, cap, archFallback: arch.fallback, mistAtlas: mistTex && !mistTex.userData.fallback }
    },
    setQuality(q) { if (CAP[q]) { tier = q; cap = CAP[q]; cursor = cursor % cap } },
    /** Ancien branchement de T_PB_sillage : sans effet sur la nuée (elle a son propre atlas, T_PB_mist). */
    setAtlas(tex) { void tex },
    /** Remplace l'atlas de brume (4 tuiles de densité en gris, même disposition que T_PB_mist.png). */
    setMistAtlas(tex, own = false) {
      if (!tex) return
      PU.uAtlas.value = tex
      for (const t of ownTextures) if (t !== tex) t.dispose()
      ownTextures.length = 0
      if (own) ownTextures.push(tex)
      mistTex = tex
    },
    /** Remplace le chemin de l'arc (door_arch_path.json chargé plus tard). */
    setArchPath(json) { arch = buildArchPath(json, D); fillRibbon() },
    /** Chemin utilisé (repère marqueur) : { raw, path (96 × xyz), ribbon (129 × xyz), z, fallback }. */
    get arch() { return arch },
    /** Lecture seule (banc d'essai) : phases et positions des particules (repère marqueur). */
    _debug: () => ({ ph, kind, px, py, pz, sz, alpha, alive, cap, PHASES: { DEAD, MIST, ATTRACT, HOVER, THREAD, PEARL, DUST, LANDED }, KINDS: { K_PUFF, K_JET, K_DROP, K_EMBER } }),
    dispose() {
      if (group.parent) group.parent.remove(group)
      geo.dispose(); ptMat.dispose(); ribGeo.dispose(); ribMat.dispose(); veilMesh.geometry.dispose(); veilMesh.material.dispose()
      for (const t of ownTextures) t.dispose()
      ownTextures.length = 0
    },
  }
  return api
}
