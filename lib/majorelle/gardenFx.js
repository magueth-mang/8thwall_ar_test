// Jardin Majorelle — « eau vivante » (runtime three.js r169, WebGL mobile).
//
// Contenu : surfaces d'eau (bassin long, bassin rond, eau de la vasque), caustiques + ombres au fond,
// koï (corps + nageoires instanciés, ondulation dans le vertex shader), nénuphars + fleurs, jet de
// fontaine (jet central, bouquet d'arcs, filets qui débordent de la vasque), gouttelettes scintillantes,
// rides concentriques, pétales de bougainvillier qui tombent et flottent.
//
// Repère « jardin » three.js, en mètres : x à droite, y en haut, la cour s'étend vers -z.
// Le groupe retourné doit rester à l'identité sous `parent` (c'est `parent` que le lead place sous l'ancre).
// Tous les matériaux sont non tone-mappés (la scène bakée est unlit) ; aucun post-processing.
// Budget (qualité high) : ~9 draw calls, ~12 k triangles, zéro allocation par image.

import * as THREE from 'three'

const TAU = Math.PI * 2
const G = 9.81

// ---------------------------------------------------------------------------------------------
// Valeurs par défaut (SPEC.md)
// ---------------------------------------------------------------------------------------------
const DEFAULT_POOL = { x0: -0.8, x1: 0.8, z0: -6.3, z1: -1.7, waterY: 0, depth: 0.45 }
const DEFAULT_FOUNTAIN = {
  x: 0, z: -7.55, basinR: 0.92, waterY: 0.42, bowlY: 1.14, bowlR: 0.44,
  floorY: 0.12,     // fond intérieur du bassin rond (hypothèse : à ajuster sur le build)
  pedestalR: 0.085, // pied de la vasque
  cupOuterR: 0.46,  // rayon extérieur de la coupe
  cupBaseY: 1.0,    // bas de la coupe
}
const DEFAULT_ROOM = { x0: -3.6, x1: 3.6, zBack: -9.6, zFront: -0.45, wallH: 4.0 }
const DEFAULT_SKY = { zenith: '#9fc3e6', horizon: '#eef0ea' }

const QUALITY = {
  high: { koi: 8, drops: 1.0, petals: 30, flowers: 5, pads: 16, glitter: 1 },
  medium: { koi: 7, drops: 0.75, petals: 22, flowers: 4, pads: 14, glitter: 1 },
  low: { koi: 6, drops: 0.5, petals: 14, flowers: 3, pads: 12, glitter: 0 },
}

// Robes des koï (type de motif, échelle des nageoires : > 1 = koï « papillon » à longues nageoires)
// 0 kohaku, 1 ogon (or métal), 2 orenji (orange métal), 3 hariwake platine/or, 4 tancho,
// 5 yamabuki (jaune or), 6 hariwake orange/blanc
const ROBES = [
  [1, 1.0], [0, 1.0], [2, 1.0], [3, 1.55], [5, 1.45], [4, 1.0], [0, 1.6], [6, 1.0],
]

// ---------------------------------------------------------------------------------------------
// Petits utilitaires
// ---------------------------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const toColor = (c, fallback) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c ?? fallback))

// Houle basse fréquence — miroir JS exact de swell() côté GLSL (pour faire flotter pétales/nénuphars).
function swellHeight(x, z, t) {
  return 0.0022 * Math.sin((0.8 * x + 0.6 * z) * 7.0 + t * 1.25) +
    0.0016 * Math.sin((-0.45 * x + 0.89 * z) * 11.0 + t * 1.7) +
    0.0009 * Math.sin((0.97 * x - 0.24 * z) * 19.0 - t * 2.3)
}

// ---------------------------------------------------------------------------------------------
// Textures procédurales (générées une fois, tuilables)
// ---------------------------------------------------------------------------------------------

/** Champ de pentes d'une hauteur h = Σ a·sin(2π(kx·u + ky·v) + φ) à vecteurs d'onde entiers (=> tuilable).
 *  Trigonométrie séparable : cos(A+B) = cosA·cosB − sinA·sinB, donc ~3 flops par onde et par texel. */
function slopeField(rng, N, K, k2min, k2max, power) {
  const sx = new Float32Array(N * N), sy = new Float32Array(N * N)
  const ci = new Float32Array(N), si = new Float32Array(N), cj = new Float32Array(N), sj = new Float32Array(N)
  let curv2 = 0
  for (let w = 0; w < K; w++) {
    let kx, ky, k2
    do { kx = Math.round((rng() * 2 - 1) * Math.sqrt(k2max)); ky = Math.round((rng() * 2 - 1) * Math.sqrt(k2max)); k2 = kx * kx + ky * ky } while (k2 < k2min || k2 > k2max)
    const amp = Math.pow(k2, -power / 2) * (0.55 + 0.9 * rng())
    const ph = rng() * TAU
    for (let i = 0; i < N; i++) { const a = (TAU * kx * i) / N; ci[i] = Math.cos(a); si[i] = Math.sin(a) }
    for (let j = 0; j < N; j++) { const b = (TAU * ky * j) / N + ph; cj[j] = Math.cos(b); sj[j] = Math.sin(b) }
    const ax = amp * TAU * kx, ay = amp * TAU * ky
    for (let j = 0; j < N; j++) {
      const cb = cj[j], sb = sj[j], row = j * N
      for (let i = 0; i < N; i++) { const c = ci[i] * cb - si[i] * sb; sx[row + i] += ax * c; sy[row + i] += ay * c }
    }
    curv2 += 0.5 * Math.pow(amp * TAU * TAU * k2, 2)
  }
  return { sx, sy, curvRms: Math.sqrt(curv2) }
}

function dataTexture(data, N) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

/** Carte de pentes de vaguelettes (RG = pentes normalisées). */
function makeRippleNormalTexture(rng, N = 128) {
  const { sx, sy } = slopeField(rng, N, 22, 4, 100, 1.6)
  let m = 1e-6
  for (let i = 0; i < N * N; i++) m = Math.max(m, Math.abs(sx[i]), Math.abs(sy[i]))
  const d = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    d[i * 4] = Math.round(127.5 + 127.5 * (sx[i] / m))
    d[i * 4 + 1] = Math.round(127.5 + 127.5 * (sy[i] / m))
    d[i * 4 + 2] = 128; d[i * 4 + 3] = 255
  }
  return dataTexture(d, N)
}

/** Caustiques « physiques » : on réfracte une grille de rayons à travers une surface ondulée tuilable
 *  et on accumule les photons sur le fond (splat bilinéaire), puis petit flou. */
function makeCausticTexture(rng, N = 256) {
  const { sx, sy, curvRms } = slopeField(rng, N, 26, 9, 170, 1.75)
  const focus = (1.15 / curvRms) * N // texels de déplacement par unité de pente
  const acc = new Float32Array(N * N)
  const S = 2 // 2×2 rayons par texel
  for (let j = 0; j < N * S; j++) {
    for (let i = 0; i < N * S; i++) {
      const gi = (i / S) | 0, gj = (j / S) | 0
      const k = gj * N + gi
      let x = (i + 0.5) / S + focus * sx[k] - 0.5
      let y = (j + 0.5) / S + focus * sy[k] - 0.5
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
      const xa = ((x0 % N) + N) % N, xb = (xa + 1) % N, ya = ((y0 % N) + N) % N, yb = (ya + 1) % N
      acc[ya * N + xa] += (1 - fx) * (1 - fy); acc[ya * N + xb] += fx * (1 - fy)
      acc[yb * N + xa] += (1 - fx) * fy; acc[yb * N + xb] += fx * fy
    }
  }
  // flou 3×3 (1 2 1) tuilable
  const out = new Float32Array(N * N)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const w = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1)
        s += w * acc[((j + dj + N) % N) * N + ((i + di + N) % N)]
      }
      out[j * N + i] = s / 16
    }
  }
  const mean = (S * S)
  const d = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    const v = Math.min(1, out[i] / mean / 4) // stocke I/4 : la moyenne vaut ~0,25
    const b = Math.round(255 * v)
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b; d[i * 4 + 3] = 255
  }
  return dataTexture(d, N)
}

/** Ombre douce des nénuphars projetée sur le fond du bassin long (texture alignée sur le rectangle). */
function makePadShadowTexture(pool, pads) {
  const W = 64, H = Math.round(64 * (pool.z1 - pool.z0) / (pool.x1 - pool.x0))
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  const sx = W / (pool.x1 - pool.x0), sz = H / (pool.z1 - pool.z0)
  for (const p of pads) {
    const x = (p.x - pool.x0) * sx, y = (p.z - pool.z0) * sz, r = p.r * sx
    const grd = g.createRadialGradient(x, y, r * 0.55, x, y, r * 1.25)
    grd.addColorStop(0, 'rgba(0,0,0,0.62)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r * 1.25, 0, TAU); g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.flipY = false
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

// ---------------------------------------------------------------------------------------------
// GLSL partagé
// ---------------------------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform vec3 uCam;       // caméra dans le repère jardin
uniform vec3 uSunDir;    // vers le soleil
uniform vec3 uSunRefr;   // vers le soleil, sous l'eau (réfracté)
uniform vec3 uSunCol;
uniform vec3 uSkyZen;
uniform vec3 uSkyHor;
uniform vec4 uPool;      // x0, x1, z0, z1
uniform vec4 uPoolW;     // niveau d'eau, profondeur
uniform vec4 uFount;     // x, z, rayon d'eau du bassin, niveau d'eau du bassin
uniform vec4 uBowl;      // niveau d'eau de la vasque, rayon intérieur, rayon d'impact des arcs, rayon d'impact des filets
uniform vec4 uCup;       // rayon du pied, rayon ext. de la coupe, bas de coupe, haut de coupe
uniform vec4 uRoom;      // x0, x1, zFond, zAvant
uniform float uWallH;
uniform float uShadows;
uniform vec4 uRip[8];    // rides : x, z, t0, amplitude
uniform float uRipY[8];  // niveau de l'eau de chaque ride

// houle basse fréquence : (hauteur, dh/dx, dh/dz)
vec3 swell(vec2 p) {
  vec3 r = vec3(0.0);
  float ph;
  ph = dot(vec2(0.80, 0.60), p) * 7.0 + uTime * 1.25;
  r += vec3(0.0022 * sin(ph), vec2(0.80, 0.60) * (0.0154 * cos(ph)));
  ph = dot(vec2(-0.45, 0.89), p) * 11.0 + uTime * 1.70;
  r += vec3(0.0016 * sin(ph), vec2(-0.45, 0.89) * (0.0176 * cos(ph)));
  ph = dot(vec2(0.97, -0.24), p) * 19.0 - uTime * 2.30;
  r += vec3(0.0009 * sin(ph), vec2(0.97, -0.24) * (0.0171 * cos(ph)));
  return r;
}

// rides concentriques (splash, bisous des koï, pétales qui touchent l'eau)
vec3 ripples(vec3 p) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 e = uRip[i];
    float age = uTime - e.z;
    if (e.w <= 0.0 || age < 0.0 || age > 3.5 || abs(uRipY[i] - p.y) > 0.12) continue;
    vec2 d = p.xz - e.xy;
    float dist = length(d) + 1e-4;
    float rho = dist - 0.34 * age;
    float w = 0.03 + 0.07 * age;
    float env = exp(-rho * rho / (w * w)) * exp(-age * 1.1) / (1.0 + 2.5 * dist);
    float A = e.w * 0.0055;
    r.x += A * env * sin(rho * 52.0);
    r.yz += (d / dist) * (A * 52.0 * env * cos(rho * 52.0));
  }
  return r;
}

// rayon / paroi de cylindre vertical creux (bassin) : 1re paroi touchée entre y0 et y1, -1 sinon
float hitCyl(vec3 P, vec3 R, vec2 C, float rad, float y0, float y1) {
  vec2 o = P.xz - C;
  float a = dot(R.xz, R.xz);
  if (a < 1e-6) return -1.0;
  float b = dot(o, R.xz);
  float c = dot(o, o) - rad * rad;
  float disc = b * b - a * c;
  if (disc < 0.0) return -1.0;
  float sq = sqrt(disc);
  float t1 = (-b - sq) / a, t2 = (-b + sq) / a;
  float y = P.y + R.y * t1;
  if (t1 > 1e-4 && y > y0 && y < y1) return t1;
  y = P.y + R.y * t2;
  if (t2 > 1e-4 && y > y0 && y < y1) return t2;
  return -1.0;
}

// rayon / cylindre plein fermé (coupe, pied) : entrée du rayon dans le volume, -1 sinon
float hitSolid(vec3 P, vec3 R, vec2 C, float rad, float y0, float y1) {
  vec2 o = P.xz - C;
  float a = dot(R.xz, R.xz);
  float b = dot(o, R.xz);
  float c = dot(o, o) - rad * rad;
  float t1 = -1e6, t2 = 1e6;
  if (a > 1e-6) {
    float disc = b * b - a * c;
    if (disc < 0.0) return -1.0;
    float sq = sqrt(disc);
    t1 = (-b - sq) / a; t2 = (-b + sq) / a;
  } else if (c > 0.0) return -1.0;
  float ta = (y0 - P.y) / R.y, tb = (y1 - P.y) / R.y; // R.y > 0 ici (rayons vers le haut)
  float tn = max(t1, min(ta, tb)), tf = min(t2, max(ta, tb));
  if (tn > tf || tf < 1e-4) return -1.0;
  return max(tn, 1e-4);
}

// le point P voit-il le soleil ? (murs de la cour + vasque/pied de la fontaine)
float sunVis(vec3 P) {
  if (uShadows < 0.5) return 1.0;
  vec3 L = uSunDir;
  float tx = L.x < 0.0 ? (uRoom.x - P.x) / min(L.x, -1e-4) : (uRoom.y - P.x) / max(L.x, 1e-4);
  float tz = L.z < 0.0 ? (uRoom.z - P.z) / min(L.z, -1e-4) : (uRoom.w - P.z) / max(L.z, 1e-4);
  float y = P.y + L.y * min(tx, tz);
  float v = smoothstep(uWallH - 0.12, uWallH + 0.12, y);
  if (P.y < uCup.w - 0.02) {
    if (hitSolid(P, L, uFount.xy, uCup.y, uCup.z - 0.06, uCup.w) > 0.0) v = 0.0;
    else if (hitSolid(P, L, uFount.xy, uCup.x, 0.0, uCup.z) > 0.0) v = 0.0;
  }
  return v;
}
`

const GLSL_CAUSTIC = /* glsl */ `
uniform sampler2D uCaustTex;
// caustiques animées : deux couches qui glissent, combinées par min() (réseau qui « respire »)
float caustic(vec2 p) {
  vec2 w = swell(p).yz * 2.5;
  float a = texture2D(uCaustTex, p * 1.35 + vec2(uTime * 0.021, uTime * 0.013) + w).r;
  float b = texture2D(uCaustTex, p * 1.58 + vec2(-uTime * 0.016, uTime * 0.024) - w + 0.37).r;
  return min(a, b) * 4.0; // ~0,6 en moyenne, pics à ~3
}
`

const GLSL_NOISE = /* glsl */ `
float hash31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
`

// ---------------------------------------------------------------------------------------------
// 1) Surfaces d'eau : bassin long + bassin rond + vasque (1 draw call)
// ---------------------------------------------------------------------------------------------
const WATER_VS = /* glsl */ `
attribute vec2 aInfo; // corps d'eau (0 bassin long, 1 bassin rond, 2 vasque), profondeur
varying vec3 vPos;
varying vec2 vInfo;
void main() {
  vPos = position;
  vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const WATER_FS = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uNormTex;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uWallCol;
uniform vec3 uCoping;
uniform vec3 uStucco;
uniform vec3 uMosaic;
uniform vec3 uLeafDark;
uniform vec3 uLeafLit;
uniform vec3 uBloom;
uniform vec3 uZellige;
uniform vec3 uMarble;
uniform vec3 uStone;
uniform float uAbsorb;
uniform float uGlitter;
uniform float uMinRefl;
uniform float uThreads;
varying vec3 vPos;
varying vec2 vInfo;

vec3 skyColor(vec3 R) {
  float h = clamp(R.y, 0.0, 1.0);
  vec3 c = mix(uSkyHor, uSkyZen, pow(h, 0.5));
  return c + uSunCol * pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.2;
}

// murs de la cour vus en reflet (id : 0 fond, 1 côtés, 2 mur de la porte), s = coordonnée le long du mur
vec3 wallColor(vec3 H, float id, float s) {
  float y = H.y;
  if (y > uWallH - 0.15) return uCoping;
  vec3 c = uWallCol * (id < 0.5 ? 1.0 : 0.82);
  if (id < 0.5) {
    float ax = abs(H.x);
    float archTop = 2.5 + 0.6 * sqrt(max(0.0, 1.0 - ax * ax / 0.7225));
    if (ax < 0.85 && y > 0.3 && y < archTop) {
      c = uStucco;
      if (ax < 0.62 && y > 0.48 && y < archTop - 0.22) c = uMosaic;
    }
    float sx = abs(ax - 2.4);
    if (sx < 0.5 && y > 0.7 && y < 2.9) { c = uCoping; if (sx < 0.4 && y > 0.8 && y < 2.8) c = uStucco * 0.9; }
  } else if (id < 1.5) {
    float sz = min(abs(H.z + 3.2), abs(H.z + 6.4));
    if (sz < 0.7 && y < 2.6) { c = uCoping; if (sz < 0.58 && y < 2.48) c = uWallCol * 0.5; }
  } else {
    if (abs(H.x) < 0.6 && y < 2.6) c = uStone * 0.35;
  }
  // silhouettes végétales (cactus, palmiers, agaves) au pied des murs
  float hv = 0.0;
  if (id < 0.5) {
    float side = smoothstep(1.05, 1.6, abs(s));
    hv = (0.75 + 0.45 * sin(s * 2.3 + 1.0) + 0.3 * sin(s * 5.7 + 2.0)) * side;
    hv += smoothstep(0.035, 0.012, abs(fract(s * 0.55 + 0.3) - 0.5)) * 1.9 * side;
  } else if (id < 1.5) {
    hv = 1.25 + 0.5 * sin(s * 1.9) + 0.35 * sin(s * 4.7 + 1.3) + 0.2 * sin(s * 11.0);
    hv += smoothstep(0.04, 0.015, abs(fract(s * 0.45 + 0.1) - 0.5)) * 1.6;
  }
  if (y < hv) c = mix(uLeafDark, uLeafLit, 0.3 + 0.3 * sin(s * 13.0 + y * 9.0));
  // bougainvillier en haut des murs latéraux, vers le fond
  if (id > 0.5 && id < 1.5) {
    float b = smoothstep(-4.2, -6.8, H.z) * smoothstep(2.3, 3.3, y);
    float n = 0.5 + 0.5 * sin(s * 7.0 + y * 5.0) * sin(s * 3.1 - y * 2.3);
    if (b * n > 0.3) c = mix(uLeafDark, uBloom, step(0.45, n));
  }
  return c;
}

// reflet analytique : cour (boîte) + fontaine (cylindres) + ciel
vec3 envColor(vec3 P, vec3 R, float body) {
  float tx = R.x > 0.0 ? (uRoom.y - P.x) / max(R.x, 1e-4) : (uRoom.x - P.x) / min(R.x, -1e-4);
  float tz = R.z < 0.0 ? (uRoom.z - P.z) / min(R.z, -1e-4) : (uRoom.w - P.z) / max(R.z, 1e-4);
  float t = min(tx, tz);
  vec3 H = P + R * t;
  vec3 col;
  if (H.y > uWallH + 0.12) col = skyColor(R);
  else if (tx < tz) col = wallColor(H, 1.0, H.z);
  else col = wallColor(H, R.z < 0.0 ? 0.0 : 2.0, H.x);
  float best = t;
  // la fontaine
  vec2 C = uFount.xy;
  float tb = hitCyl(P, R, C, uFount.z + 0.08, 0.0, uFount.w + 0.08);
  if (tb > 0.0 && tb < best) {
    vec3 h = P + R * tb; best = tb;
    vec2 n = normalize(h.xz - C);
    float lam = 0.7 + 0.3 * max(dot(vec3(n.x, 0.0, n.y), uSunDir), 0.0);
    float a = atan(n.y, n.x);
    float chk = step(0.5, fract(a * 9.0 + floor(h.y * 18.0) * 0.5));
    col = (h.y > uFount.w + 0.02 ? uMarble : mix(uZellige, uMarble, 0.25 + 0.35 * chk)) * lam;
  }
  float tp = hitSolid(P, R, C, uCup.x, uFount.w - 0.01, uCup.z);
  if (tp > 0.0 && tp < best) { best = tp; col = uStone * 0.9; }
  // la coupe : volume plein vue de l'extérieur, paroi intérieure vue depuis l'eau de la vasque
  float tc = body < 1.5 ? hitSolid(P, R, C, uCup.y, uCup.z - 0.05, uCup.w) : hitCyl(P, R, C, uCup.y, uCup.z - 0.05, uCup.w);
  if (tc > 0.0 && tc < best) {
    vec3 h = P + R * tc; best = tc;
    vec2 n = normalize(h.xz - C);
    col = uStone * (0.75 + 0.35 * max(dot(vec3(n.x, 0.0, n.y), uSunDir), 0.0));
  }
  // margelle du bassin long (zellige) vue en reflet près des bords
  if (body < 0.5) {
    float ex = R.x > 0.0 ? (uPool.y - P.x) / max(R.x, 1e-4) : (uPool.x - P.x) / min(R.x, -1e-4);
    float ez = R.z > 0.0 ? (uPool.w - P.z) / max(R.z, 1e-4) : (uPool.z - P.z) / min(R.z, -1e-4);
    float te = min(ex, ez);
    if (te < best && P.y + R.y * te < uPoolW.x + 0.08) col = mix(uZellige, uMarble, 0.45);
  }
  return col;
}

float edgeDist(vec3 P, float body) {
  if (body < 0.5) return min(min(P.x - uPool.x, uPool.y - P.x), min(P.z - uPool.z, uPool.w - P.z));
  float r = length(P.xz - uFount.xy);
  if (body < 1.5) return min(uFount.z - r, r - uCup.x);
  return uBowl.y - r;
}

// agitation propre à la fontaine : impacts des filets dans le bassin, des arcs et du jet dans la vasque
vec2 fountainWaves(vec3 p, float body) {
  vec2 d = p.xz - uFount.xy;
  float r = length(d) + 1e-4;
  vec2 n = d / r;
  float e = uEnergy;
  vec2 g = vec2(0.0);
  if (body > 1.5) {
    float rho = r - uBowl.z * e; float a = abs(rho);
    g += n * sign(rho) * cos(a * 95.0 - uTime * 12.0) * exp(-a * 11.0) * 0.08 * e;
    g += n * cos(r * 130.0 - uTime * 14.0) * exp(-r * 16.0) * 0.07 * e;
  } else {
    float rho = r - uBowl.w; float a = abs(rho);
    float ang = atan(d.y, d.x);
    float spokes = 0.5 + 0.5 * cos(ang * uThreads - 3.14159);
    g += n * sign(rho) * cos(a * 70.0 - uTime * 8.5) * exp(-a * 5.0) * 0.055 * e * (0.35 + 0.65 * spokes);
  }
  return g;
}

void main() {
  vec3 P = vPos;
  float body = vInfo.x;
  vec2 g = swell(P.xz).yz;
  vec2 dA = texture2D(uNormTex, P.xz * 1.1 + vec2(uTime * 0.020, uTime * 0.012)).xy * 2.0 - 1.0;
  vec2 dB = texture2D(uNormTex, P.xz * 2.7 + vec2(-uTime * 0.016, uTime * 0.027)).xy * 2.0 - 1.0;
  float agit = body < 0.5 ? 1.0 : 1.0 + uEnergy * 0.9;
  g += (dA * 0.016 + dB * 0.009) * agit;
  vec2 rg = ripples(P).yz;
  g += rg;
  if (body > 0.5) g += fountainWaves(P, body);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(uCam - P);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = mix(0.02 + 0.98 * pow(1.0 - NdV, 5.0), 1.0, uMinRefl);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  R = normalize(R);
  float ed = edgeDist(P, body);
  vec3 refl = envColor(P, R, body);
  // transmission : chemin dans l'eau selon l'angle réfracté
  float cosT = sqrt(max(1.0 - (1.0 - NdV * NdV) / 1.769, 0.0));
  float T = exp(-uAbsorb * vInfo.y / max(cosT, 0.2));
  float sv = sunVis(P);
  vec3 scatter = (body < 0.5 ? uDeep : uShallow) * (0.7 + 0.5 * sv);
  // bords : léger assombrissement de contact + ménisque lumineux
  float contact = exp(-max(ed, 0.0) / 0.05);
  float men = exp(-max(ed, 0.0) / 0.006);
  T *= 1.0 - 0.22 * contact;
  refl += uSkyHor * men * 0.5;
  F = max(F, men * 0.35);
  // les rides accrochent la lumière du ciel (lisibles même vues de dessus)
  float ring = clamp(length(rg) * 2.2, 0.0, 0.55);
  float a = 1.0 - (1.0 - F) * T * (1.0 - ring * 0.5);
  vec3 lin = (F * refl + (1.0 - F) * (1.0 - T) * scatter + uSkyHor * ring * 0.45) / max(a, 1e-3);
  // soleil : reflet net + scintillements (facettes plus raides)
  float sd = max(dot(R, uSunDir), 0.0);
  float spec = (pow(sd, 2400.0) * 4.0 + pow(sd, 160.0) * 0.06) * sv;
  // scintillements : micro-facettes haute fréquence (3e lecture de la carte de vaguelettes)
  vec2 dC = texture2D(uNormTex, P.xz * 9.0 + vec2(uTime * 0.07, -uTime * 0.05)).xy * 2.0 - 1.0;
  vec2 gg = g * 1.6 + dC * 0.16;
  vec3 Ng = normalize(vec3(-gg.x, 1.0, -gg.y));
  float gl = pow(max(dot(reflect(-V, Ng), uSunDir), 0.0), 1100.0) * uGlitter * sv * 5.0;
  vec3 sunOut = linearToOutputTexel(vec4(uSunCol, 1.0)).rgb;
  vec3 o = linearToOutputTexel(vec4(lin, 1.0)).rgb * a + sunOut * (spec + gl);
  gl_FragColor = vec4(o, clamp(a + (spec + gl) * 0.3, 0.0, 1.0));
}
`

function buildWater(ctx) {
  const { P, Fo, U, colors } = ctx
  const pos = [], info = [], idx = []
  const v = (x, y, z, body, depth) => { pos.push(x, y, z); info.push(body, depth); return pos.length / 3 - 1 }
  // bassin long : grille légère (meilleure interpolation des varyings sur mobile)
  const nx = 4, nz = 12
  const base0 = pos.length / 3
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) v(P.x0 + (P.x1 - P.x0) * i / nx, P.waterY, P.z0 + (P.z1 - P.z0) * j / nz, 0, P.depth)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = base0 + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  // anneau du bassin rond (entre le pied et la paroi) puis disque de la vasque
  const ring = (cx, cz, y, r0, r1, seg, body, depth) => {
    const b = pos.length / 3
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU, c = Math.cos(a), s = Math.sin(a)
      v(cx + c * r0, y, cz + s * r0, body, depth); v(cx + c * r1, y, cz + s * r1, body, depth)
    }
    for (let k = 0; k < seg; k++) { const i0 = b + k * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3) }
  }
  ring(Fo.x, Fo.z, Fo.waterY, Fo.pedestalR, Fo.basinR, 56, 1, Math.max(0.05, Fo.waterY - Fo.floorY))
  ring(Fo.x, Fo.z, Fo.bowlWaterY, 0.0, Fo.bowlR, 36, 2, 0.08)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uNormTex: { value: ctx.normTex },
      uDeep: { value: colors.deep }, uShallow: { value: colors.shallow },
      uWallCol: { value: colors.wall }, uCoping: { value: colors.coping }, uStucco: { value: colors.stucco },
      uMosaic: { value: colors.mosaic }, uLeafDark: { value: colors.leafDark }, uLeafLit: { value: colors.leafLit },
      uBloom: { value: colors.bloom }, uZellige: { value: colors.zellige }, uMarble: { value: colors.marble }, uStone: { value: colors.stone },
      uAbsorb: { value: 0.6 }, uGlitter: { value: ctx.Q.glitter }, uMinRefl: { value: 0.035 }, uThreads: { value: ctx.jet.nThreads },
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true, toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'MJ_Water'
  return mesh
}

// ---------------------------------------------------------------------------------------------
// 2) Caustiques + ombres (koï, nénuphars, murs, vasque) au fond des bassins — 1 draw call
//    Mélange : dst × (rgb + a)  →  rgb = lumière des caustiques, a = niveau d'ombre.
// ---------------------------------------------------------------------------------------------
const CAUSTIC_VS = /* glsl */ `
attribute vec2 aInfo; // niveau d'eau au-dessus, corps d'eau
varying vec3 vPos;
varying vec2 vInfo;
void main() {
  vPos = position; vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const CAUSTIC_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_CAUSTIC}
uniform sampler2D uPadShadow;
uniform vec4 uFish[NKOI];   // x, z, cos(cap), sin(cap)
uniform vec4 uFishB[NKOI];  // longueur, y, -, -
uniform vec3 uCaustTint;
uniform float uCaustGain;
varying vec3 vPos;
varying vec2 vInfo;
void main() {
  float wy = vInfo.x;
  float depth = max(wy - vPos.y, 0.0);
  vec2 k = uSunRefr.xz / uSunRefr.y;
  vec2 sp = vPos.xz + k * depth;               // où le rayon de soleil a traversé la surface
  float lit = sunVis(vec3(sp.x, wy, sp.y));
  if (vInfo.y < 0.5) {
    float e = min(min(sp.x - uPool.x, uPool.y - sp.x), min(sp.y - uPool.z, uPool.w - sp.y));
    lit *= smoothstep(-0.015, 0.03, e);         // la margelle ombre le fond côté soleil
    vec2 uv = (sp - uPool.xz) / vec2(uPool.y - uPool.x, uPool.w - uPool.z);
    lit *= texture2D(uPadShadow, uv).r;
  } else {
    lit *= smoothstep(uFount.z + 0.01, uFount.z - 0.05, length(sp - uFount.xy));
  }
  for (int i = 0; i < NKOI; i++) {
    vec4 f = uFish[i]; vec4 fb = uFishB[i];
    float h = fb.y - vPos.y;
    vec2 q = vPos.xz + k * h - f.xy;
    float al = dot(q, f.zw), la = dot(q, vec2(-f.w, f.z));
    float L = fb.x;
    float d = length(vec2(al / (0.52 * L), la / ((al > 0.0 ? 0.13 : 0.10) * L)));
    float soft = 0.25 + h * 2.2;
    lit *= 1.0 - 0.5 * (1.0 - smoothstep(1.0 - soft * 0.5, 1.0 + soft, d));
  }
  float c = caustic(sp) * lit;
  gl_FragColor = vec4(uCaustTint * c * uCaustGain, mix(0.6, 0.86, lit));
}
`

function buildCaustics(ctx) {
  const { P, Fo, U, Q } = ctx
  const pos = [], info = [], idx = []
  const v = (x, y, z, wy, body) => { pos.push(x, y, z); info.push(wy, body) }
  const yb = P.waterY - P.depth + 0.004
  v(P.x0, yb, P.z0, P.waterY, 0); v(P.x1, yb, P.z0, P.waterY, 0); v(P.x0, yb, P.z1, P.waterY, 0); v(P.x1, yb, P.z1, P.waterY, 0)
  idx.push(0, 2, 1, 1, 2, 3)
  const seg = 48, b = 4, yf = Fo.floorY + 0.004
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * TAU, c = Math.cos(a), s = Math.sin(a)
    v(Fo.x, yf, Fo.z, Fo.waterY, 1) // disque complet (le pied le masque de toute façon)
    v(Fo.x + c * Fo.basinR, yf, Fo.z + s * Fo.basinR, Fo.waterY, 1)
  }
  for (let k = 0; k < seg; k++) { const i0 = b + k * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3) }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U, uCaustTex: { value: ctx.caustTex }, uPadShadow: { value: ctx.padShadowTex },
      uCaustTint: { value: new THREE.Vector3(1.0, 0.95, 0.82) }, uCaustGain: { value: 0.75 },
    },
    defines: { NKOI: Math.max(1, Q.koi) },
    vertexShader: CAUSTIC_VS, fragmentShader: CAUSTIC_FS,
    transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'MJ_Caustics'
  return mesh
}

// ---------------------------------------------------------------------------------------------
// 3) Koï : corps (opaque) + nageoires (translucides), 2 draw calls instanciés
//    Géométrie en « longueurs de corps » : nez en x = +0,5, pédoncule en x = −0,5, latéral = z.
// ---------------------------------------------------------------------------------------------
const KOI_W = 0.118, KOI_HT = 0.1, KOI_HB = 0.088

function koiProfile(u) {
  if (u < 0.28) { const a = 1 - u / 0.28; return Math.sqrt(Math.max(0, 1 - a * a)) }
  const b = (u - 0.28) / 0.72
  return 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * b), 0.9)
}

function buildKoiBodyGeometry() {
  const NL = 20, NR = 16
  const pos = [], uu = [], idx = []
  pos.push(0.504, -0.006, 0); uu.push(0)
  for (let i = 1; i <= NL; i++) {
    const u = Math.pow(i / NL, 1.25)
    const p = koiProfile(u)
    const belly = 1 + 0.14 * Math.exp(-Math.pow((u - 0.42) / 0.16, 2))
    const yc = -0.006 * (1 - u)
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * TAU, cz = Math.cos(a), sy = Math.sin(a)
      const y = sy >= 0 ? sy * KOI_HT * p : sy * KOI_HB * belly * p
      pos.push(0.5 - u, y + yc, cz * KOI_W * p); uu.push(u)
    }
  }
  const tail = pos.length / 3
  pos.push(-0.504, 0, 0); uu.push(1)
  const ring = (i, j) => 1 + (i - 1) * NR + ((j + NR) % NR)
  for (let j = 0; j < NR; j++) idx.push(0, ring(1, j + 1), ring(1, j))
  for (let i = 1; i < NL; i++) for (let j = 0; j < NR; j++) {
    const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1)
    idx.push(a, b, c, b, d, c)
  }
  for (let j = 0; j < NR; j++) idx.push(tail, ring(NL, j), ring(NL, j + 1))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function buildKoiFinGeometry() {
  const pos = [], fin = [], root = [], idx = []
  const grid = (cols, rows, fn) => { // fn(c, r) -> [x,y,z, part, t, s, rx, ry, rz]
    const b = pos.length / 3
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const q = fn(c / (cols - 1), r / (rows - 1))
      pos.push(q[0], q[1], q[2]); fin.push(q[3], q[4], q[5], 0); root.push(q[6], q[7], q[8])
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = b + r * cols + c, bb = a + 1, cc = a + cols, d = cc + 1
      idx.push(a, cc, bb, bb, cc, d)
    }
  }
  // nageoires pectorales : éventail arrondi, attaché bas sur les flancs
  for (const side of [1, -1]) {
    const pR = koiProfile(0.24)
    const yR = -0.5 * KOI_HB * pR, zR = side * KOI_W * pR * 0.8
    grid(5, 3, (a, b) => {
      const rx = 0.5 - (0.2 + 0.08 * b), ry = yR, rz = zR
      const dx = -0.3 + (-0.95 + 0.3) * b, dy = -0.2 + 0.05 * b, dz = side * (1.0 - 0.45 * b)
      const dl = Math.hypot(dx, dy, dz)
      const len = 0.21 * (0.8 + 0.2 * Math.sin(Math.PI * b)) * (1 - 0.18 * b) * (1 - 0.25 * Math.pow(Math.abs(b - 0.45) * 2, 3) * a)
      return [rx + (dx / dl) * len * a, ry + (dy / dl) * len * a, rz + (dz / dl) * len * a, side > 0 ? 1 : 2, a, b, rx, ry, rz]
    })
  }
  // dorsale : bande basse le long du dos
  grid(10, 2, (s, r) => {
    const u = 0.3 + 0.42 * s
    const yTop = KOI_HT * koiProfile(u) * 0.95 - 0.006 * (1 - u)
    const h = 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)), 0.55) * (1 - 0.5 * s)
    const x = 0.5 - u
    return [x - 0.03 * r, yTop + h * r, 0, 3, r, s, x, yTop, 0]
  })
  // caudale : deux lobes souples légèrement fourchus
  grid(6, 7, (c, s) => {
    const sv = s * 2 - 1
    const len = 0.3 * (0.78 + 0.22 * sv * sv)
    const half = 0.02 + 0.15 * Math.pow(c, 0.8)
    return [-0.47 - c * len, sv * half, 0, 4, c, s, -0.47, 0, 0]
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 4))
  geo.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const KOI_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSwim;   // phase de nage, amplitude, courbure (virage), phase des pectorales
attribute vec4 aSwim2;  // amplitude pectorales, repli des pectorales
attribute vec4 aLook;   // robe, graine, échelle des nageoires
#ifdef KOI_FINS
attribute vec4 aFin;    // partie (1/2 pectorales, 3 dorsale, 4 caudale), t corde, s envergure
attribute vec3 aRoot;
varying vec4 vFin;
#else
attribute float aU;
#endif
varying vec3 vRest;
varying vec3 vN;
varying vec3 vW;
varying vec4 vLook;

const float KW = 6.2832 / 1.05; // longueur d'onde ≈ 1 corps
// onde latérale qui voyage du nez vers la queue (amplitude croissante vers la queue)
float koiLat(float u, float lag) {
  float env = 0.05 + 0.95 * u * u;
  return aSwim.y * env * sin(KW * u - aSwim.x - lag);
}
float koiSlope(float u, float lag) {
  float env = 0.05 + 0.95 * u * u;
  float ph = KW * u - aSwim.x - lag;
  return aSwim.y * (1.9 * u * sin(ph) + env * KW * cos(ph));
}
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

// flexion de virage : la colonne suit un arc de cercle exact (longueur conservée, centre du corps fixe).
// xa = abscisse d'ancrage sur la colonne (le sommet lui-même, ou la racine pour une pectorale)
vec3 bendArc(vec3 q, float xa, float k, inout vec3 n) {
  float s = -xa;          // abscisse curviligne depuis le centre du corps, positive vers la queue
  float a = k * s;
  vec3 B = abs(k) > 1e-3 ? vec3(-sin(a) / k, 0.0, (1.0 - cos(a)) / k) : vec3(-s, 0.0, 0.5 * k * s * s);
  mat3 R = rotY(a);
  n = R * n;
  return B + R * vec3(q.x - xa, q.y, q.z);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  float fs = aLook.z;
  float u;
  float lag = 0.0;
  float xa;
#ifdef KOI_FINS
  vec3 rel = p - aRoot;
  if (aFin.x < 2.5) {
    // pectorales : rament (battement qui ondule vers le bord) et se replient avec la vitesse
    float side = aFin.x < 1.5 ? 1.0 : -1.0;
    rel *= mix(1.0, fs, 0.8);
    float flap = aSwim2.x * sin(aSwim.w - aFin.y * 1.3 + side * 0.4);
    mat3 R = rotY(-side * aSwim2.y * (0.6 + 0.4 * aFin.y)) * rotX(-side * flap * (0.5 + 0.5 * aFin.y));
    rel = R * rel; n = R * n;
    p = aRoot + rel;
    u = 0.5 - aRoot.x;
    xa = aRoot.x;
  } else if (aFin.x < 3.5) {
    rel.y *= mix(1.0, fs, 0.6);
    p = aRoot + rel;
    u = 0.5 - p.x;
    lag = aFin.y * 0.7;
    xa = p.x;
  } else {
    rel *= fs;
    u = 0.5 - (aRoot.x + rel.x);
    lag = max(u - 1.0, 0.0) * (1.4 + 0.7 * fs); // la caudale traîne et ondule
    // la caudale vrille légèrement à chaque battement : elle s'ouvre et se referme vue de dessus
    float tw = clamp(aSwim.y * 6.0, 0.0, 0.5) * cos(KW * u - aSwim.x - lag) * smoothstep(0.0, 0.25, u - 0.97);
    rel = vec3(rel.x, rel.y * cos(tw), rel.y * sin(tw));
    n = vec3(n.x, n.y * cos(tw) - n.z * sin(tw), n.y * sin(tw) + n.z * cos(tw));
    p = aRoot + rel;
    xa = p.x;
  }
  vFin = aFin;
#else
  u = aU;
  xa = p.x;
#endif
  p.z += koiLat(u, lag);
  float sl = koiSlope(u, lag);
  n = normalize(vec3(n.x + sl * n.z, n.y, n.z));
  p = bendArc(p, xa, aSwim.z, n);
  vec4 w = instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(instanceMatrix) * n);
  // réfraction : l'image des poissons ondule avec la surface
  float depth = max(uPoolW.x - w.y, 0.0);
  w.xz -= swell(w.xz).yz * depth * 2.5;
  vW = w.xyz;
  vRest = position;
  vLook = aLook;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`

const KOI_LIGHT = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uWaterAmb;
// éclairage sous l'eau : soleil réfracté × caustiques, ambiance du ciel filtrée par l'eau
vec3 koiLight(vec3 N, vec3 W, out float sv) {
  float depth = max(uPoolW.x - W.y, 0.0);
  vec3 S = W + uSunRefr * (depth / uSunRefr.y);
  sv = sunVis(vec3(S.x, uPoolW.x, S.z));
  float c = caustic(S.xz);
  float ndl = dot(N, uSunRefr);
  float diff = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  vec3 amb = mix(uWaterAmb * 0.45, uWaterAmb, N.y * 0.5 + 0.5);
  return amb + uSunCol * diff * sv * (0.45 + 0.55 * c);
}
`

const KOI_BODY_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_CAUSTIC}
${GLSL_NOISE}
${KOI_LIGHT}
varying vec3 vRest;
varying vec3 vN;
varying vec3 vW;
varying vec4 vLook;

void robe(vec4 look, vec3 r, out vec3 alb, out float metal) {
  float type = look.x, seed = look.y;
  float top = smoothstep(-0.045, 0.03, r.y);
  float belly = 1.0 - smoothstep(-0.075, -0.02, r.y);
  float n = vnoise(r * vec3(7.0, 9.0, 9.0) + seed * 17.0) * 0.72 + vnoise(r * vec3(17.0, 21.0, 21.0) + seed * 5.0) * 0.28;
  vec3 white = s2l(vec3(0.965, 0.95, 0.92));
  vec3 hi = s2l(vec3(0.90, 0.27, 0.08));
  vec3 gold = s2l(vec3(0.95, 0.72, 0.30));
  vec3 orange = s2l(vec3(0.98, 0.50, 0.12));
  vec3 yellow = s2l(vec3(0.99, 0.84, 0.38));
  metal = 0.0;
  if (type < 0.5) {                 // kohaku : blanc nacré + hi rouge-orangé aux bords nets
    float m = smoothstep(0.58, 0.615, n + top * 0.12 - belly * 0.4) * top;
    alb = mix(white, hi, m);
  } else if (type < 1.5) {          // ogon : or métallique
    alb = mix(gold, gold * vec3(0.82, 0.66, 0.42), top * 0.55); metal = 1.0;
  } else if (type < 2.5) {          // orenji : orange métallique
    alb = mix(orange, orange * vec3(0.88, 0.6, 0.42), top * 0.5); metal = 0.9;
  } else if (type < 3.5) {          // hariwake : platine + or
    float m = smoothstep(0.47, 0.52, n + top * 0.16) * top;
    alb = mix(white, gold, m); metal = 0.85;
  } else if (type < 4.5) {          // tancho : blanc, disque rouge sur la tête
    float d = length(vec2(r.x - 0.33, r.z * 1.15));
    alb = mix(white, hi * 1.05, (1.0 - smoothstep(0.068, 0.078, d)) * step(0.0, r.y));
  } else if (type < 5.5) {          // yamabuki : jaune or
    alb = mix(yellow, yellow * vec3(0.9, 0.76, 0.55), top * 0.45); metal = 1.0;
  } else {                          // hariwake orange
    float m = smoothstep(0.48, 0.53, n + top * 0.1) * top;
    alb = mix(white, orange, m); metal = 0.55;
  }
  // écailles réticulées très discrètes (s'effacent avec la distance)
  float sc = abs(fract(r.x * 26.0 + (r.y + r.z) * 9.0) - 0.5) + abs(fract((r.y - r.z) * 13.0 - r.x * 9.0) - 0.5);
  float fw = fwidth(r.x * 26.0);
  alb *= 1.0 - 0.08 * smoothstep(0.75, 0.95, sc) * top * (1.0 - smoothstep(0.25, 0.6, fw));
  alb = mix(alb, white * 0.96, belly * 0.6);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 alb; float metal;
  robe(vLook, vRest, alb, metal);
  // œil
  float ed = length(vec2(vRest.x - 0.405, vRest.y - 0.008));
  float eye = (1.0 - smoothstep(0.013, 0.017, ed)) * step(0.03, abs(vRest.z));
  alb = mix(alb, vec3(0.012, 0.01, 0.01), eye);
  float sv;
  vec3 light = koiLight(N, vW, sv);
  vec3 col = alb * light;
  vec3 H = normalize(uSunRefr + V);
  float sp = pow(max(dot(N, H), 0.0), mix(36.0, 80.0, metal)) * sv;
  col += uSunCol * sp * mix(vec3(0.22), alb * 1.7, metal);
  col += uSunCol * eye * pow(max(dot(N, H), 0.0), 200.0) * 2.0 * sv;
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uSkyZen * fr * mix(0.06, 0.28, metal);
  float depth = max(uPoolW.x - vW.y, 0.0);
  col = mix(col, uDeep, 1.0 - exp(-depth * 1.1));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

const KOI_FIN_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_CAUSTIC}
${GLSL_NOISE}
${KOI_LIGHT}
varying vec3 vRest;
varying vec3 vN;
varying vec3 vW;
varying vec4 vLook;
varying vec4 vFin;
void main() {
  float type = vLook.x;
  vec3 c = s2l(vec3(0.97, 0.95, 0.92));
  if (type > 0.5 && type < 1.5) c = s2l(vec3(0.96, 0.76, 0.36));
  else if (type > 1.5 && type < 2.5) c = s2l(vec3(0.99, 0.58, 0.2));
  else if (type > 4.5 && type < 5.5) c = s2l(vec3(0.99, 0.87, 0.45));
  else if (type > 2.5 && type < 3.5) c = mix(c, s2l(vec3(0.96, 0.78, 0.42)), 0.4);
  float t = vFin.y;
  float rays = 0.86 + 0.14 * smoothstep(0.32, 0.0, abs(fract(vFin.z * (vFin.x > 3.5 ? 11.0 : 7.0)) - 0.5));
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  float sv;
  vec3 light = koiLight(N, vW, sv);
  // translucidité : le soleil traverse la nageoire
  float trans = pow(max(dot(-V, uSunRefr), 0.0), 3.0) * sv * 0.6;
  vec3 col = c * rays * (light + uSunCol * trans);
  col = mix(col, c * light * 1.15, smoothstep(0.75, 1.0, t) * 0.5); // liseré plus clair
  float depth = max(uPoolW.x - vW.y, 0.0);
  col = mix(col, uDeep, 1.0 - exp(-depth * 1.1));
  float a = mix(0.82, 0.3, smoothstep(0.0, 1.0, t)) * rays;
  if (vFin.x > 2.5 && vFin.x < 3.5) a = mix(0.8, 0.45, t);
  a *= 1.0 - smoothstep(0.9, 1.0, t) * 0.6;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`

function createKoi(ctx) {
  const { P, U, Q, rng, colors } = ctx
  const N = Q.koi
  const bodyGeo = buildKoiBodyGeometry()
  const finGeo = buildKoiFinGeometry()
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const swim2 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const look = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4)
  for (const g of [bodyGeo, finGeo]) { g.setAttribute('aSwim', swim); g.setAttribute('aSwim2', swim2); g.setAttribute('aLook', look) }
  const koiUniforms = { uDeep: { value: colors.deep }, uWaterAmb: { value: colors.waterAmb }, uCaustTex: { value: ctx.caustTex } }
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...koiUniforms }, vertexShader: KOI_VS, fragmentShader: KOI_BODY_FS, toneMapped: false,
  })
  const finMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...koiUniforms }, defines: { KOI_FINS: 1 }, vertexShader: KOI_VS, fragmentShader: KOI_FIN_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })
  const body = new THREE.InstancedMesh(bodyGeo, bodyMat, N)
  const fins = new THREE.InstancedMesh(finGeo, finMat, N)
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  fins.instanceMatrix = body.instanceMatrix // un seul upload par image pour les deux
  body.frustumCulled = fins.frustumCulled = false
  body.name = 'MJ_KoiBodies'; fins.name = 'MJ_KoiFins'

  // --- état de nage (CPU) ---
  const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2, hx = (P.x1 - P.x0) / 2, hz = (P.z1 - P.z0) / 2
  const yMin = P.waterY - P.depth + 0.1
  const fish = []
  for (let i = 0; i < N; i++) {
    const [type, fs] = ROBES[i % ROBES.length]
    const L = 0.31 + 0.1 * rng()
    const m = (0.47 + 0.3 * fs) * L + 0.02 // marge centre → mur : le corps + la queue ne touchent jamais
    let x, z, ok, tries = 0
    do {
      x = cx + (rng() * 2 - 1) * Math.max(0.01, hx - m); z = cz + (rng() * 2 - 1) * Math.max(0.01, hz - m)
      ok = fish.every((f) => Math.hypot(f.x - x, f.z - z) > 0.45)
    } while (!ok && ++tries < 40)
    fish.push({
      x, z, y: P.waterY - (0.1 + 0.2 * rng()), vy: 0, th: rng() * TAU, om: 0, v: 0.06, vT: 0.06 + 0.06 * rng(), acc: 0,
      ph: rng() * TAU, amp: 0.05, curv: 0, fph: rng() * TAU, finAmp: 0.3, fold: 0.4,
      L, m, fs, yMax: P.waterY - 0.22 * L - 0.012, timer: rng() * 4, yT: P.waterY - (0.1 + 0.2 * rng()),
      w1: 0.13 + 0.12 * rng(), w2: 0.31 + 0.2 * rng(), seed: rng() * 100, orbit: rng() < 0.5 ? -1 : 1,
      delay: 0, kiss: 0.5 + rng() * 2, dist: 9,
    })
    look.setXYZW(i, type, rng() * 10, fs, 0)
  }
  const gather = { x: 0, z: 0, time: 0, elapsed: 0 }
  let activity = 1
  const euler = new THREE.Euler(), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), mat = new THREE.Matrix4()

  function update(dt, t) {
    if (gather.time > 0) { gather.time -= dt; gather.elapsed += dt }
    const n = fish.length
    for (let i = 0; i < n; i++) {
      const f = fish[i]
      const c = Math.cos(f.th), s = Math.sin(f.th)
      // humeur : vitesse de croisière, petites accélérations, flâneries, profondeur
      f.timer -= dt
      if (f.timer <= 0) {
        const r = ctx.rnd()
        if (r < 0.14) { f.vT = 0.19 + 0.06 * ctx.rnd(); f.timer = 0.9 + 0.8 * ctx.rnd() }
        else if (r < 0.32) { f.vT = 0.025 + 0.025 * ctx.rnd(); f.timer = 2.5 + 3 * ctx.rnd() }
        else { f.vT = 0.06 + 0.07 * ctx.rnd(); f.timer = 3 + 5 * ctx.rnd() }
        f.yT = P.waterY - (0.1 + 0.22 * ctx.rnd())
      }
      // direction souhaitée = cap + errance + bords + voisins (+ rassemblement)
      let dx = c, dz = s
      const w = 0.55 * Math.sin(t * f.w1 + f.seed) + 0.35 * Math.sin(t * f.w2 + f.seed * 2.3)
      dx += -s * w; dz += c * w
      const hxI = Math.max(0.01, hx - f.m), hzI = Math.max(0.01, hz - f.m)
      const la = 0.16 + f.v * 2.0 + f.L * 0.35
      const qx = f.x + c * la - cx, qz = f.z + s * la - cz
      const band = 0.26
      const ox = Math.abs(qx) - hxI + band, oz = Math.abs(qz) - hzI + band
      let urg = 0
      if (ox > 0) { const k = Math.min(1.5, ox / band); dx -= Math.sign(qx) * k * k * 3.0; urg = Math.max(urg, Math.min(1, k)) }
      if (oz > 0) { const k = Math.min(1.5, oz / band); dz -= Math.sign(qz) * k * k * 3.0; urg = Math.max(urg, Math.min(1, k)) }
      let ax = 0, az = 0, mx = 0, mz = 0, nb = 0, brake = 0, sepY = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const g = fish[j]
        const ddx = f.x - g.x, ddz = f.z - g.z, d2 = ddx * ddx + ddz * ddz
        if (d2 > 0.81) continue
        nb++; ax += Math.cos(g.th); az += Math.sin(g.th); mx += g.x; mz += g.z
        const R = 0.2 + 0.36 * (f.L + g.L)
        const dy = f.y - g.y
        if (d2 < R * R && Math.abs(dy) < 0.14) {
          const d = Math.sqrt(d2) + 1e-4, k = 1 - d / R
          dx += (ddx / d) * k * 3.2; dz += (ddz / d) * k * 3.2
          // ils se croisent à des profondeurs différentes (le plus haut monte, l'autre plonge)
          sepY += (dy > 0 || (dy === 0 && i < j) ? 1 : -1) * k * 0.09
          // un voisin juste devant : on lève la nageoire, on ralentit
          if (-(ddx * c + ddz * s) > 0.3 * d) brake = Math.max(brake, k)
        }
      }
      if (nb) { dx += (ax / nb) * 0.2 + (mx / nb - f.x) * 0.1; dz += (az / nb) * 0.2 + (mz / nb - f.z) * 0.1 }
      let vTarget = f.vT, yTarget = f.yT, gathering = 0
      if (gather.time > 0 && gather.elapsed > f.delay) {
        const tx = gather.x - f.x, tz = gather.z - f.z, d = Math.hypot(tx, tz) + 1e-4
        const ring = 0.14 + 0.06 * (i % 4) // chacun son orbite : ils se pressent sans s'empiler
        const pull = clamp((d - ring) * 4, -2, 3)
        dx += (tx / d) * pull - (tz / d) * 0.7 * f.orbit
        dz += (tz / d) * pull + (tx / d) * 0.7 * f.orbit
        vTarget = d > 0.45 ? 0.17 : 0.04 + 0.02 * Math.sin(t * 1.3 + i)
        yTarget = P.waterY - 0.07
        gathering = 1
        f.dist = d
      }
      // virage doux, vitesse angulaire limitée (plus vive près d'un mur)
      let da = Math.atan2(dz, dx) - f.th
      da = Math.atan2(Math.sin(da), Math.cos(da))
      const omMax = 0.75 + urg * 1.6 + gathering * 0.6
      f.om += (clamp(da * 1.5, -omMax, omMax) - f.om) * Math.min(1, dt * (2.2 + urg * 3))
      f.th += f.om * dt
      if (f.th > Math.PI) f.th -= TAU; else if (f.th < -Math.PI) f.th += TAU
      const vT = vTarget * (1 - Math.min(0.5, Math.abs(f.om) * 0.22)) * (1 - 0.7 * brake) * activity
      f.acc = vT - f.v
      f.v += f.acc * Math.min(1, dt * (f.acc > 0 ? 1.1 : 0.6))
      f.x += Math.cos(f.th) * f.v * dt; f.z += Math.sin(f.th) * f.v * dt
      // garde-fou absolu : jamais dans les parois
      const rx = f.x - cx, rz = f.z - cz
      if (rx > hxI) f.x = cx + hxI; else if (rx < -hxI) f.x = cx - hxI
      if (rz > hzI) f.z = cz + hzI; else if (rz < -hzI) f.z = cz - hzI
      // profondeur
      f.vy += ((yTarget - f.y) * 0.5 + sepY - f.vy) * Math.min(1, dt * 1.6)
      f.y = clamp(f.y + f.vy * dt, yMin, f.yMax) // le dos et la dorsale restent sous la surface
      // ondulation : fréquence ∝ vitesse, amplitude ∝ poussée (glisse quand il ralentit)
      const beat = 0.55 + f.v * 10 + Math.abs(f.om) * 0.5
      f.ph = (f.ph + TAU * beat * dt) % TAU
      const thrust = clamp(f.acc * 7 + 0.28 + Math.abs(f.om) * 0.35, 0.1, 1)
      const ampT = (0.022 + 0.06 * thrust) * (f.v < 0.04 ? 0.6 : 1)
      f.amp += (ampT - f.amp) * Math.min(1, dt * 2)
      const kap = clamp((f.om / Math.max(f.v, 0.05)) * f.L, -1.4, 1.4)
      f.curv += (kap - f.curv) * Math.min(1, dt * 5)
      // pectorales : rament à basse vitesse, se plaquent en vitesse
      const slow = 1 - clamp(f.v / 0.16, 0, 1)
      f.fph = (f.fph + TAU * (0.7 + 1.1 * slow + gathering * 0.8) * dt) % TAU
      f.finAmp += (0.1 + 0.36 * slow + 0.18 * gathering - f.finAmp) * Math.min(1, dt * 2)
      f.fold += (0.15 + 0.8 * (1 - slow) - f.fold) * Math.min(1, dt * 2)
      // instance
      euler.set(f.om * 0.07, -f.th, clamp(f.vy * 3, -0.22, 0.22), 'YZX')
      quat.setFromEuler(euler)
      mat.compose(pos.set(f.x, f.y, f.z), quat, scl.setScalar(f.L))
      body.setMatrixAt(i, mat)
      swim.setXYZW(i, f.ph, f.amp, f.curv, f.fph)
      swim2.setXYZW(i, f.finAmp, f.fold, 0, 0)
      U.uFish.value[i].set(f.x, f.z, Math.cos(f.th), Math.sin(f.th))
      U.uFishB.value[i].set(f.L * 1.12, f.y, 1, 0)
      // « bisous » à la surface pendant le rassemblement
      if (gathering && f.dist < 0.4 && f.y > f.yMax - 0.03) {
        f.kiss -= dt
        if (f.kiss <= 0) {
          f.kiss = 1.4 + ctx.rnd() * 2.4
          ctx.emitRipple(f.x + Math.cos(f.th) * f.L * 0.5, f.z + Math.sin(f.th) * f.L * 0.5, P.waterY, 0.22, 0)
        }
      }
    }
    body.instanceMatrix.needsUpdate = true
    swim.needsUpdate = true
    swim2.needsUpdate = true
  }

  return {
    body, fins, fish, update,
    count: N,
    /** Les koï convergent vers un point (repère jardin) et tournent autour pendant `seconds`. */
    gather(point, seconds = 6) {
      const inset = 0.22
      gather.x = clamp(point.x, P.x0 + inset, P.x1 - inset)
      gather.z = clamp(point.z, P.z0 + inset, P.z1 - inset)
      gather.time = seconds; gather.elapsed = 0
      for (const f of fish) { f.delay = 0.15 + Math.hypot(f.x - gather.x, f.z - gather.z) * 0.3 + ctx.rnd() * 0.4; f.kiss = 0.4 + ctx.rnd() * 1.5 }
    },
    /** Multiplicateur de vitesse global (1 = normal). */
    setActivity(k) { activity = clamp(k, 0, 2) },
  }
}

// ---------------------------------------------------------------------------------------------
// 4) Nénuphars (feuilles) + fleurs roses — 2 draw calls instanciés
// ---------------------------------------------------------------------------------------------
function buildPadGeometry() {
  const seg = 26, notch = 0.22
  const pos = [0, 0.01, 0], rr = [0, 0], idx = []
  const radii = [0.5, 1.0]
  for (const r of radii) {
    for (let k = 0; k <= seg; k++) {
      const a = notch / 2 + ((TAU - notch) * k) / seg
      const y = 0.01 + 0.03 * Math.pow(r, 5)
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r); rr.push(r, a)
    }
  }
  const R0 = 1, R1 = 1 + seg + 1
  for (let k = 0; k < seg; k++) {
    idx.push(0, R0 + k + 1, R0 + k)
    const a = R0 + k, b = a + 1, c = R1 + k, d = c + 1
    idx.push(a, b, c, b, d, c)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aPad', new THREE.Float32BufferAttribute(rr, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function buildFlowerGeometry() {
  const pos = [], pet = [], idx = []
  const rings = [ // n pétales, longueur, largeur, élévation, rayon de départ, décalage angulaire
    [10, 0.068, 0.024, 0.32, 0.008, 0.0],
    [9, 0.056, 0.022, 0.72, 0.007, 0.3],
    [7, 0.04, 0.018, 1.08, 0.006, 0.1],
  ]
  rings.forEach(([n, len, wid, elev, r0, off], ri) => {
    for (let p = 0; p < n; p++) {
      const al = (p / n) * TAU + off + (ri * 0.17)
      const ca = Math.cos(al), sa = Math.sin(al)
      const b = pos.length / 3
      const NLs = 5, NA = 3
      for (let i = 0; i < NLs; i++) {
        const l = i / (NLs - 1)
        for (let j = 0; j < NA; j++) {
          const s = (j / (NA - 1)) * 2 - 1
          const half = wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, l * 0.92 + 0.08)), 0.75)
          const f = l * len, side = s * half
          const yl = s * s * wid * 0.32 + l * l * len * 0.18 // creux + pointe relevée
          const ce = Math.cos(elev), se = Math.sin(elev)
          const rad = r0 + f * ce - yl * se, y = f * se + yl * ce
          pos.push(ca * rad - sa * side, y + 0.004, sa * rad + ca * side)
          pet.push(ri, l, s)
        }
      }
      for (let i = 0; i < NLs - 1; i++) for (let j = 0; j < NA - 1; j++) {
        const a = b + i * NA + j, bb = a + 1, c = a + NA, d = c + 1
        idx.push(a, c, bb, bb, c, d)
      }
    }
  })
  // cœur jaune (étamines)
  const cb = pos.length / 3
  pos.push(0, 0.024, 0); pet.push(-1, 0, 0)
  const seg = 10
  for (let k = 0; k < seg; k++) { const a = (k / seg) * TAU; pos.push(Math.cos(a) * 0.014, 0.012, Math.sin(a) * 0.014); pet.push(-1, 1, 0) }
  for (let k = 0; k < seg; k++) idx.push(cb, cb + 1 + ((k + 1) % seg), cb + 1 + k)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aPet', new THREE.Float32BufferAttribute(pet, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const FLOAT_VS = /* glsl */ `
${GLSL_COMMON}
attribute float aPhase;
#ifdef FLOWER
attribute vec3 aPet;
varying vec3 vPet;
#else
attribute vec2 aPad;
varying vec2 vPad;
#endif
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 p = position;
  // dérive lente en lacet
  float sw = 0.05 * sin(uTime * 0.21 + aPhase * 6.2832) + 0.03 * sin(uTime * 0.47 + aPhase * 17.0);
  float c = cos(sw), s = sin(sw);
  p.xz = mat2(c, -s, s, c) * p.xz;
  vec3 n = normal; n.xz = mat2(c, -s, s, c) * n.xz;
  vec4 w = instanceMatrix * vec4(p, 1.0);
  vec3 o = vec3(instanceMatrix[3][0], uPoolW.x, instanceMatrix[3][2]);
  w.y += swell(o.xz).x * 0.9 + ripples(o).x;
  vW = w.xyz;
  vN = normalize(mat3(instanceMatrix) * n);
#ifdef FLOWER
  vPet = aPet;
#else
  vPad = aPad;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`

const PAD_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
uniform vec3 uPadA;
uniform vec3 uPadB;
uniform vec3 uPadRim;
varying vec2 vPad;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 N = normalize(vN);
  float r = vPad.x;
  float a = vPad.y;
  float n = vnoise(vW * 22.0) * 0.6 + vnoise(vW * 63.0) * 0.4;
  vec3 alb = mix(uPadA, uPadB, 0.2 + 0.55 * n);
  float veins = pow(abs(cos(a * 11.0)), 24.0) * smoothstep(0.08, 0.35, r) * (1.0 - smoothstep(0.8, 0.98, r));
  alb = mix(alb, uPadB * 1.15, veins * 0.2);
  alb = mix(alb, uPadRim, smoothstep(0.9, 1.0, r) * 0.5);
  alb *= 0.92 + 0.08 * (1.0 - r);
  vec3 V = normalize(uCam - vW);
  float sv = sunVis(vW);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 col = alb * (uSkyZen * 0.45 + uSunCol * ndl * sv * 0.9);
  // cuticule cireuse : reflet du ciel en incidence rasante + brillance du soleil
  float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col = mix(col, uSkyHor * 0.8, fr * 0.35);
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), 90.0) * 0.25 * sv;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

const FLOWER_FS = /* glsl */ `
${GLSL_COMMON}
varying vec3 vPet;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  vec3 pink = pow(vec3(0.93, 0.42, 0.66), vec3(2.2));
  vec3 blush = pow(vec3(0.99, 0.88, 0.93), vec3(2.2));
  vec3 alb;
  if (vPet.x < -0.5) alb = pow(vec3(0.98, 0.78, 0.25), vec3(2.2));
  else {
    float ring = vPet.x;
    alb = mix(blush, pink, smoothstep(0.05, 0.95, vPet.y) * (0.9 - ring * 0.18));
    alb *= 0.92 + 0.08 * (1.0 - abs(vPet.z)); // nervure centrale
  }
  float sv = sunVis(vW);
  float ndl = max(dot(N, uSunDir), 0.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0) * 0.5; // pétales translucides à contre-jour
  vec3 col = alb * (uSkyZen * 0.5 + uSunCol * (ndl * 0.85 + back + 0.15) * sv);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

function createLilies(ctx) {
  const { P, U, Q, rng, colors } = ctx
  // amas : milieu et fond du bassin, quelques feuilles isolées ; l'avant reste dégagé pour voir les koï
  const clusters = [
    { z: -3.95, n: Math.round(Q.pads * 0.42), spread: 0.32 },
    { z: -5.7, n: Math.round(Q.pads * 0.42), spread: 0.36 },
    { z: -2.45, n: Q.pads - 2 * Math.round(Q.pads * 0.42), spread: 0.25 },
  ]
  const pads = []
  for (const cl of clusters) {
    let made = 0, tries = 0
    while (made < cl.n && tries++ < 400) {
      const r = 0.085 + 0.075 * rng()
      const x = P.x0 + r + 0.03 + rng() * (P.x1 - P.x0 - 2 * r - 0.06)
      const z = cl.z + (rng() * 2 - 1) * cl.spread
      if (z - r < P.z0 + 0.03 || z + r > P.z1 - 0.03) continue
      if (cl.z > -3 && Math.abs(x) < 0.4) continue // pas au milieu de l'avant
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.97)) continue
      pads.push({ x, z, r, rot: rng() * TAU, phase: rng() }); made++
    }
  }
  const padGeo = buildPadGeometry()
  const padPhase = new THREE.InstancedBufferAttribute(new Float32Array(pads.length), 1)
  padGeo.setAttribute('aPhase', padPhase)
  const padMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uPadA: { value: colors.padA }, uPadB: { value: colors.padB }, uPadRim: { value: colors.padRim } },
    vertexShader: FLOAT_VS, fragmentShader: PAD_FS, toneMapped: false,
  })
  const padMesh = new THREE.InstancedMesh(padGeo, padMat, pads.length)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3()
  pads.forEach((p, i) => {
    q.setFromEuler(e.set(0, p.rot, 0))
    m.compose(v.set(p.x, P.waterY + 0.0015 + i * 0.0002, p.z), q, s.set(p.r, p.r, p.r))
    padMesh.setMatrixAt(i, m); padPhase.setX(i, p.phase)
  })
  padMesh.frustumCulled = false
  padMesh.name = 'MJ_LilyPads'

  // fleurs : posées sur les plus grandes feuilles
  const hosts = [...pads].sort((a, b) => b.r - a.r).slice(0, Math.min(Q.flowers, pads.length))
  const flGeo = buildFlowerGeometry()
  const flPhase = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, hosts.length)), 1)
  flGeo.setAttribute('aPhase', flPhase)
  const flMat = new THREE.ShaderMaterial({
    uniforms: { ...U }, defines: { FLOWER: 1 }, vertexShader: FLOAT_VS, fragmentShader: FLOWER_FS,
    side: THREE.DoubleSide, toneMapped: false,
  })
  const flMesh = new THREE.InstancedMesh(flGeo, flMat, Math.max(1, hosts.length))
  hosts.forEach((p, i) => {
    const a = rng() * TAU, d = p.r * 0.28
    const sc = 0.85 + 0.35 * rng()
    q.setFromEuler(e.set((rng() - 0.5) * 0.12, rng() * TAU, (rng() - 0.5) * 0.12))
    m.compose(v.set(p.x + Math.cos(a) * d, P.waterY + 0.01, p.z + Math.sin(a) * d), q, s.set(sc, sc, sc))
    flMesh.setMatrixAt(i, m); flPhase.setX(i, p.phase)
  })
  flMesh.count = hosts.length
  flMesh.frustumCulled = false
  flMesh.name = 'MJ_LilyFlowers'
  return { pads, padMesh, flMesh }
}

// ---------------------------------------------------------------------------------------------
// 5) Jet de fontaine : jet central, bouquet d'arcs, filets qui débordent — 1 draw call (rubans)
// ---------------------------------------------------------------------------------------------
const STREAM_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec3 aO;     // origine
attribute vec4 aV;     // vitesse initiale (énergie 1), durée de vol
attribute vec4 aS;     // t (0..1), côté (−1/+1), largeur, type (0 jet, 1 arc, 2 filet)
attribute float aR;    // aléa par filet
varying vec2 vS;
varying float vFlow;
varying float vFade;
varying float vR;
varying vec3 vP;
void main() {
  float kind = aS.w;
  float k = kind < 1.5 ? sqrt(max(uEnergy, 1e-4)) : 1.0;
  float T = aV.w * k;
  float t = aS.x * T;
  vec3 v0 = aV.xyz * k;
  vec3 p = aO + v0 * t;
  p.y -= 4.905 * t * t;
  // les filets ne sont pas des fils rigides : légère ondulation qui descend avec l'eau
  if (kind > 0.5) {
    vec3 perp = normalize(vec3(-aV.z, 0.0, aV.x) + vec3(1e-4, 0.0, 0.0));
    float wob = sin(t * 26.0 - uTime * 6.5 + aR * 9.0) * (kind > 1.5 ? 0.005 : 0.003) * aS.x;
    p += perp * wob;
  }
  vec3 tang = normalize(v0 + vec3(0.0, -9.81 * t, 0.0) + vec3(0.0, 1e-4, 0.0));
  vec3 view = normalize(uCam - p);
  vec3 side = cross(tang, view);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = aS.z * (kind < 0.5 ? mix(1.0, 0.55, aS.x) : (kind < 1.5 ? mix(1.0, 0.75, aS.x) : mix(0.8, 1.15, aS.x)));
  p += side * aS.y * w * 0.5;
  float fade = kind < 1.5 ? smoothstep(0.03, 0.18, uEnergy) : smoothstep(0.04, 0.35, uEnergy);
  if (kind < 0.5) fade *= 1.0 - smoothstep(0.8, 1.0, aS.x);       // le haut du jet se défait en gouttes
  else if (kind < 1.5) fade *= smoothstep(0.0, 0.06, aS.x) * (1.0 - 0.45 * smoothstep(0.6, 1.0, aS.x));
  vS = vec2(aS.y, aS.x); vFlow = t; vFade = fade; vR = aR; vP = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const STREAM_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uDeepStream;
varying vec2 vS;
varying float vFlow;
varying float vFade;
varying float vR;
varying vec3 vP;
void main() {
  // coupe d'un cylindre d'eau : bords sombres (réfraction), reflet du ciel, filet de soleil, cœur clair
  float x = vS.x, ax = abs(x);
  float edge = 1.0 - smoothstep(0.7, 1.0, ax);
  float fres = ax * ax;
  float fl = vFlow - uTime;                       // motif advecté avec l'eau
  float pulse = 0.5 + 0.5 * sin(fl * 52.0 + vR * 17.0) * sin(fl * 21.0 + vR * 5.0);
  vec3 sky = mix(uSkyHor, uSkyZen, 0.3 + 0.3 * x);
  float rim = smoothstep(0.45, 0.85, ax);
  vec3 refl = mix(sky * 0.9, uDeepStream, rim * 0.7);
  float streak = exp(-pow((x + 0.3) * 4.5, 2.0)) * (0.55 + 0.45 * pulse);
  float sv = sunVis(vP);
  float a = (0.28 + 0.5 * rim) * edge * mix(0.8, 1.0, pulse) * vFade;
  vec3 o = linearToOutputTexel(vec4(refl, 1.0)).rgb * a;
  o += linearToOutputTexel(vec4(uSunCol, 1.0)).rgb * streak * (0.35 + 0.75 * sv) * vFade * edge;
  gl_FragColor = vec4(o, a);
}
`

function createStreams(ctx) {
  const { Fo, U, jet } = ctx
  const O = [], Vv = [], S = [], Rr = [], idx = []
  const addStream = (o, v, T, width, kind, segs, rnd) => {
    const b = O.length / 3
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      for (const side of [-1, 1]) { O.push(o[0], o[1], o[2]); Vv.push(v[0], v[1], v[2], T); S.push(t, side, width, kind); Rr.push(rnd) }
    }
    for (let i = 0; i < segs; i++) { const a = b + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  const C = [Fo.x, Fo.bowlWaterY, Fo.z]
  addStream(C, [0, jet.vJet, 0], jet.vJet / G, 0.024, 0, 20, 0.3)
  for (let k = 0; k < jet.nArcs; k++) {
    const a = ((k + 0.5) / jet.nArcs) * TAU + 0.3
    addStream([C[0] + Math.cos(a) * 0.01, C[1], C[2] + Math.sin(a) * 0.01], [Math.cos(a) * jet.arcVh, jet.arcVy, Math.sin(a) * jet.arcVh], jet.arcT, 0.012, 1, 24, k * 0.37)
  }
  for (let k = 0; k < jet.nThreads; k++) {
    const a = ((k + 0.5) / jet.nThreads) * TAU
    addStream([Fo.x + Math.cos(a) * jet.threadR0, jet.threadY0, Fo.z + Math.sin(a) * jet.threadR0],
      [Math.cos(a) * jet.threadVOut, jet.threadVy0, Math.sin(a) * jet.threadVOut], jet.threadT, 0.011, 2, 16, k * 0.61)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(O.length), 3)) // non utilisée (calculée dans le shader)
  geo.setAttribute('aO', new THREE.Float32BufferAttribute(O, 3))
  geo.setAttribute('aV', new THREE.Float32BufferAttribute(Vv, 4))
  geo.setAttribute('aS', new THREE.Float32BufferAttribute(S, 4))
  geo.setAttribute('aR', new THREE.Float32BufferAttribute(Rr, 1))
  geo.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uDeepStream: { value: new THREE.Color('#5a6f86') } }, vertexShader: STREAM_VS, fragmentShader: STREAM_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'MJ_FountainStreams'
  return mesh
}

// ---------------------------------------------------------------------------------------------
// 6) Gouttelettes scintillantes (paramétriques, 100 % GPU) — 1 draw call
// ---------------------------------------------------------------------------------------------
const DROP_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSeed;
attribute float aKind;
uniform float uSize;
uniform float uPx;
uniform float uWorldScale;
uniform vec4 uBurst;    // x, y, z, t0
uniform float uBurstK;
uniform vec4 uJet;      // vJet, arcVy, arcVh, nb filets
uniform vec4 uJet2;     // r0 filet, y0 filet, vitesse sortante, vy0
uniform float uArcs;
varying float vA;
void main() {
  float e = uEnergy;
  float k = sqrt(max(e, 1e-4));
  vec3 C = vec3(uFount.x, uBowl.x, uFount.y);
  vec3 p = C;
  float a = 0.0;
  float size = uSize;
  if (aKind < 0.5) {                     // couronne du jet central
    float life = 0.55 + 0.3 * aSeed.w;
    float age = fract(uTime / life + aSeed.x) * life;
    float H = uJet.x * uJet.x / 19.62 * e;
    float ang = aSeed.y * 6.2832;
    float sp = (0.04 + 0.2 * aSeed.z) * k;
    vec3 v = vec3(cos(ang) * sp, (0.05 + 0.4 * aSeed.w) * k, sin(ang) * sp);
    p = C + vec3(0.0, H * 0.96, 0.0) + v * age;
    p.y -= 4.905 * age * age;
    a = step(uBowl.x, p.y) * step(aSeed.z, e * 1.3);
    size *= 1.15;
  } else if (aKind < 1.5) {              // perles qui se détachent des arcs
    float idx = floor(aSeed.x * uArcs);
    float ang = (idx + 0.5) / uArcs * 6.2832 + 0.3;
    float T = 2.0 * uJet.y / 9.81 * k;
    float tt = fract(uTime / max(T, 0.05) * 0.85 + aSeed.y) * T;
    vec3 v = vec3(cos(ang) * uJet.z, uJet.y, sin(ang) * uJet.z) * k;
    v.xz += (aSeed.zw - 0.5) * 0.14 * k;
    p = C + v * tt;
    p.y -= 4.905 * tt * tt;
    a = step(uBowl.x, p.y) * smoothstep(0.4, 0.75, tt / max(T, 1e-3)) * step(0.05, e);
  } else if (aKind < 2.5) {              // perles le long des filets
    float idx = floor(aSeed.x * uJet.w);
    float ang = (idx + 0.5) / uJet.w * 6.2832;
    vec2 dir = vec2(cos(ang), sin(ang));
    float vy0 = uJet2.w;
    float dy = uJet2.y - uFount.w;
    float T = (vy0 + sqrt(vy0 * vy0 + 19.62 * dy)) / 9.81;
    float tt = fract(uTime * 1.2 + aSeed.y) * T;
    float vo = uJet2.z * (0.9 + 0.25 * aSeed.z);
    float r = uJet2.x + vo * tt;
    p = vec3(uFount.x + dir.x * r, uJet2.y + vy0 * tt - 4.905 * tt * tt, uFount.y + dir.y * r);
    p.xz += vec2(-dir.y, dir.x) * (aSeed.w - 0.5) * 0.012;
    a = step(uFount.w, p.y) * smoothstep(0.04, 0.35, e) * step(0.45, aSeed.z + 0.5 * e) * smoothstep(0.15, 0.5, tt / T);
    size *= 0.8;
  } else if (aKind < 3.5) {              // rebonds aux points d'impact
    float life = 0.26 + 0.2 * aSeed.w;
    float age = fract(uTime / life + aSeed.x) * life;
    float ang, r, y0;
    if (aSeed.y < 0.6) { float idx = floor(aSeed.y / 0.6 * uJet.w); ang = (idx + 0.5) / uJet.w * 6.2832; r = uBowl.w; y0 = uFount.w; }
    else { ang = aSeed.y * 47.0; r = uBowl.z * e; y0 = uBowl.x; }
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 jit = (vec2(fract(aSeed.z * 13.1), fract(aSeed.w * 7.7)) - 0.5);
    vec3 v = vec3(dir.x * 0.07 + jit.x * 0.12, 0.38 + 0.4 * aSeed.z, dir.y * 0.07 + jit.y * 0.12);
    p = vec3(uFount.x + dir.x * r + jit.x * 0.02, y0, uFount.y + dir.y * r + jit.y * 0.02) + v * age;
    p.y -= 4.905 * age * age;
    a = step(y0, p.y) * smoothstep(0.05, 0.4, e);
    size *= 0.75;
  } else {                               // gerbe du splash()
    float age = uTime - uBurst.w;
    float ang = aSeed.x * 6.2832;
    float sp = (0.12 + 0.4 * aSeed.y) * uBurstK;
    vec3 v = vec3(cos(ang) * sp, (0.6 + 0.9 * aSeed.z) * uBurstK, sin(ang) * sp);
    p = uBurst.xyz + v * age;
    p.y -= 4.905 * age * age;
    a = step(0.0, age) * step(age, 1.4) * step(uBurst.y - 0.004, p.y) * step(aSeed.w, 0.35 + 0.65 * uBurstK);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.3 + 1.4 * pow(0.5 + 0.5 * sin(uTime * (10.0 + 18.0 * aSeed.w) + aSeed.x * 61.0), 10.0);
  vA = a * tw;
  gl_PointSize = a > 0.0 ? size * uWorldScale * projectionMatrix[1][1] * uPx / max(-mv.z, 0.01) : 0.0;
}
`
const DROP_FS = /* glsl */ `
uniform vec3 uDropCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float f = exp(-d2 * 5.0) + 0.12 * exp(-d2 * 1.2);
  float a = f * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uDropCol, min(a, 1.0));
}
`

function createDroplets(ctx) {
  const { U, Q, rng, jet } = ctx
  const counts = [70, 56, 48, 50, 44].map((c, i) => (i === 4 ? c : Math.round(c * Q.drops)))
  const total = counts.reduce((a, b) => a + b, 0)
  const seeds = new Float32Array(total * 4), kinds = new Float32Array(total)
  let n = 0
  counts.forEach((c, kind) => { for (let i = 0; i < c; i++, n++) { for (let j = 0; j < 4; j++) seeds[n * 4 + j] = rng(); kinds[n] = kind } })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1))
  const extra = {
    uSize: { value: 0.012 }, uPx: { value: 800 }, uWorldScale: { value: 1 },
    uBurst: { value: new THREE.Vector4(0, -10, 0, -100) }, uBurstK: { value: 1 },
    uJet: { value: new THREE.Vector4(jet.vJet, jet.arcVy, jet.arcVh, jet.nThreads) },
    uJet2: { value: new THREE.Vector4(jet.threadR0, jet.threadY0, jet.threadVOut, jet.threadVy0) },
    uArcs: { value: jet.nArcs },
    uDropCol: { value: new THREE.Color(1.0, 0.96, 0.86) },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...extra }, vertexShader: DROP_VS, fragmentShader: DROP_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.name = 'MJ_Droplets'
  const buf = new THREE.Vector2()
  // taille des points en unités monde (même esprit que worldSizedPoints de lib/ysl/effects.js)
  points.onBeforeRender = function (renderer) {
    renderer.getDrawingBufferSize(buf)
    extra.uPx.value = buf.y * 0.5
    extra.uWorldScale.value = this.matrixWorld.getMaxScaleOnAxis()
  }
  return { points, extra }
}

// ---------------------------------------------------------------------------------------------
// 7) Pétales de bougainvillier : tombent en virevoltant, flottent, dérivent, coulent — 1 draw call
// ---------------------------------------------------------------------------------------------
function buildBractGeometry() {
  const pos = [0, 0.0015, 0], idx = []
  const n = 10, L = 0.016, W = 0.013
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, c = Math.cos(a), s = Math.sin(a)
    const x = L * c * (1 + 0.18 * c) + (c > 0 ? 0.004 * c * c * c : 0) // pointe
    const z = W * s * (0.8 + 0.2 * c)
    pos.push(x, 0.0035 * s * s, z)
  }
  for (let k = 0; k < n; k++) idx.push(0, 1 + ((k + 1) % n), 1 + k)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const PETAL_VS = /* glsl */ `
attribute float aTint;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying vec2 vL;
void main() {
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vTint = aTint; vL = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`
const PETAL_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uBloomA;
uniform vec3 uBloomB;
varying vec3 vN;
varying vec3 vW;
varying float vTint;
varying vec2 vL;
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  vec3 alb = mix(uBloomA, uBloomB, vTint);
  alb *= 0.9 + 0.1 * smoothstep(0.004, 0.0, abs(vL.y)); // nervure
  float sv = sunVis(vW);
  float ndl = abs(dot(N, uSunDir));
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0) * 0.6; // bractée de papier, très translucide
  vec3 col = alb * (uSkyZen * 0.45 + uSunCol * (ndl * 0.8 + back + 0.1) * sv);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

function createPetals(ctx) {
  const { P, Fo, U, Q, colors } = ctx
  const N = Q.petals
  const geo = buildBractGeometry()
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(N), 1)
  geo.setAttribute('aTint', tint)
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uBloomA: { value: colors.bloom }, uBloomB: { value: colors.bloomLight } },
    vertexShader: PETAL_VS, fragmentShader: PETAL_FS, side: THREE.DoubleSide, toneMapped: false,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, N)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.name = 'MJ_Petals'

  const rnd = ctx.rnd
  const basinIn = Fo.cupOuterR + 0.03, basinOut = Fo.basinR - 0.03 // pas sous la coupe : on les veut visibles
  // niveau d'eau en (x, z), ou NaN hors de l'eau
  const levelAt = (x, z) => {
    if (x > P.x0 + 0.01 && x < P.x1 - 0.01 && z > P.z0 + 0.01 && z < P.z1 - 0.01) return P.waterY
    const r = Math.hypot(x - Fo.x, z - Fo.z)
    if (r > basinIn && r < basinOut) return Fo.waterY
    return NaN
  }
  const pickWaterPoint = (out) => {
    if (rnd() < 0.78) { out.x = P.x0 + 0.08 + rnd() * (P.x1 - P.x0 - 0.16); out.z = P.z0 + 0.08 + rnd() * (P.z1 - P.z0 - 0.16) }
    else { const a = rnd() * TAU, r = basinIn + 0.05 + rnd() * (basinOut - basinIn - 0.1); out.x = Fo.x + Math.cos(a) * r; out.z = Fo.z + Math.sin(a) * r }
    return out
  }
  const tmp = { x: 0, z: 0 }
  const S = Array.from({ length: N }, (_, i) => ({
    i, state: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, wx: 0, wz: 0, fall: 0.3, yaw: rnd() * TAU, spin: 0, tilt: 0, tiltB: 0,
    t: 0, life: 0, phase: rnd() * TAU, freq: 2 + rnd() * 1.5, size: 0.8 + rnd() * 0.5, scale: 1, level: 0,
  }))
  // 0 = tombe, 1 = flotte, 2 = coule, 3 = au sol (fondu)
  const spawnFalling = (p, progress) => {
    pickWaterPoint(tmp)
    const y0 = 2.6 + rnd() * 1.4
    const fall = 0.3 + 0.08 * rnd()
    const T = (y0 - 0.2) / fall
    const side = tmp.x > 0 ? 1 : -1
    const sx = side * (2.4 + rnd() * 0.9), sz = tmp.z + (rnd() * 2 - 1) * 1.2
    p.state = 0; p.wx = (tmp.x - sx) / T; p.wz = (tmp.z - sz) / T; p.fall = fall
    p.x = sx + p.wx * T * progress; p.z = sz + p.wz * T * progress; p.y = y0 - (y0 - 0.2) * progress
    p.t = rnd() * 10; p.spin = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd()); p.scale = 1
  }
  const startFloating = (p, x, z, level, life) => {
    p.state = 1; p.x = x; p.z = z; p.level = level; p.y = level; p.vx = 0; p.vz = 0
    p.life = life; p.spin = (rnd() - 0.5) * 0.12; p.scale = 1
  }
  S.forEach((p, i) => {
    tint.setX(i, rnd())
    if (i < N * 0.65) { pickWaterPoint(tmp); startFloating(p, tmp.x, tmp.z, levelAt(tmp.x, tmp.z) || P.waterY, 8 + rnd() * 60) }
    else spawnFalling(p, rnd() * 0.9)
  })

  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4()
  const impulse = { x: 0, z: 0, level: 0, k: 0, t: -1 }

  function update(dt, time, energy) {
    const hasImpulse = impulse.k > 0
    for (let i = 0; i < N; i++) {
      const p = S[i]
      if (p.state === 0) {
        p.t += dt
        const sw = Math.sin(p.t * p.freq + p.phase)
        p.x += (p.wx + 0.16 * sw * Math.cos(p.yaw)) * dt
        p.z += (p.wz + 0.16 * sw * Math.sin(p.yaw)) * dt
        p.y -= (p.fall + 0.1 * Math.abs(Math.cos(p.t * p.freq + p.phase))) * dt
        p.yaw += p.spin * dt
        p.tilt = 0.9 * sw; p.tiltB = 0.4 * Math.cos(p.t * p.freq * 0.5)
        const lv = levelAt(p.x, p.z)
        if (lv === lv && p.y <= lv + 0.004) {
          startFloating(p, p.x, p.z, lv, 30 + rnd() * 45)
          ctx.emitRipple(p.x, p.z, lv, 0.12, 0)
        } else if (p.y <= 0.004 && p.y > -1) { p.state = 3; p.y = 0.004; p.life = 2.5 }
      } else if (p.state === 1 || p.state === 2) {
        // courant doux + ondes du splash + agitation des filets de la fontaine
        const cvx = 0.011 * Math.sin(p.z * 1.3 + time * 0.07 + p.phase) + 0.006 * Math.cos(p.x * 2.1 - time * 0.05)
        const cvz = 0.009 * Math.cos(p.x * 1.7 + time * 0.06 + p.phase) + 0.005 * Math.sin(p.z * 2.3 + time * 0.04)
        p.vx += (cvx - p.vx) * Math.min(1, dt * 0.6); p.vz += (cvz - p.vz) * Math.min(1, dt * 0.6)
        if (hasImpulse && Math.abs(p.level - impulse.level) < 0.1) {
          const dx = p.x - impulse.x, dz = p.z - impulse.z, d = Math.hypot(dx, dz) + 1e-3
          const front = (time - impulse.t) * 0.34
          if (Math.abs(d - front) < 0.06 && d < 0.9) { const k = impulse.k * 0.06 * (1 - d / 0.9) * dt * 10; p.vx += (dx / d) * k; p.vz += (dz / d) * k }
        }
        if (p.level > P.waterY + 0.1) {
          const dx = p.x - Fo.x, dz = p.z - Fo.z, r = Math.hypot(dx, dz) + 1e-3
          const push = Math.exp(-Math.pow((r - ctx.jet.threadLandR) / 0.08, 2)) * 0.03 * energy
          p.vx += (dx / r) * push * dt * 3; p.vz += (dz / r) * push * dt * 3
          p.vx += (-dz / r) * 0.004 * energy * dt * 3; p.vz += (dx / r) * 0.004 * energy * dt * 3 // légère giration
        }
        p.x += p.vx * dt; p.z += p.vz * dt
        p.yaw += p.spin * dt
        if (p.level < P.waterY + 0.1) {
          if (p.x < P.x0 + 0.015) { p.x = P.x0 + 0.015; p.vx = Math.abs(p.vx) * 0.3 } else if (p.x > P.x1 - 0.015) { p.x = P.x1 - 0.015; p.vx = -Math.abs(p.vx) * 0.3 }
          if (p.z < P.z0 + 0.015) { p.z = P.z0 + 0.015; p.vz = Math.abs(p.vz) * 0.3 } else if (p.z > P.z1 - 0.015) { p.z = P.z1 - 0.015; p.vz = -Math.abs(p.vz) * 0.3 }
        } else {
          const dx = p.x - Fo.x, dz = p.z - Fo.z, r = Math.hypot(dx, dz) + 1e-3
          const rc = clamp(r, basinIn, basinOut)
          if (rc !== r) { p.x = Fo.x + (dx / r) * rc; p.z = Fo.z + (dz / r) * rc; p.vx *= 0.3; p.vz *= 0.3 }
        }
        const h = swellHeight(p.x, p.z, time)
        p.y = p.level + 0.0025 + h
        p.tilt = (swellHeight(p.x + 0.02, p.z, time) - h) * 12; p.tiltB = (swellHeight(p.x, p.z + 0.02, time) - h) * 12
        p.life -= dt
        if (p.state === 1 && p.life <= 0) { p.state = 2; p.life = 2.5 }
        if (p.state === 2) { p.scale = Math.max(0, p.life / 2.5); p.y -= (1 - p.scale) * 0.012; if (p.life <= 0) spawnFalling(p, 0) }
      } else if (p.state === 3) {
        p.life -= dt; p.scale = Math.max(0, p.life / 2.5)
        if (p.life <= 0) spawnFalling(p, 0)
      }
      q.setFromEuler(e.set(p.tilt, p.yaw, p.tiltB, 'YXZ'))
      m.compose(v.set(p.x, p.y, p.z), q, s.setScalar(p.size * p.scale + 1e-5))
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (hasImpulse && time - impulse.t > 3) impulse.k = 0
  }
  return {
    mesh, update,
    push(x, z, level, k, time) { impulse.x = x; impulse.z = z; impulse.level = level; impulse.k = k; impulse.t = time },
  }
}

// ---------------------------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {THREE.Object3D} o.parent   repère jardin (mètres)
 * @param {object} [o.pool]           { x0, x1, z0, z1, waterY, depth }
 * @param {object} [o.fountain]       { x, z, basinR, waterY, bowlY, bowlR, floorY?, pedestalR?, cupOuterR?, cupBaseY? }
 * @param {THREE.Vector3} [o.sunDir]  direction VERS le soleil (repère jardin) ; inversée si elle pointe vers le bas
 * @param {object} [o.sky]            { zenith, horizon } (couleurs CSS / hex / THREE.Color)
 * @param {'high'|'medium'|'low'} [o.quality]
 * @param {object} [o.room]           { x0, x1, zBack, zFront, wallH } : boîte de la cour (reflets + ombres)
 * @param {number} [o.renderOrder]    base de renderOrder (caustiques +1, nageoires +2, eau +3, jet +4, gouttes +5)
 * @param {boolean} [o.shadows]       ombres analytiques des murs / de la vasque sur l'eau et le fond
 * @param {number} [o.energy]         énergie initiale de la fontaine (0..1)
 */
export function createGardenFX({
  parent, pool = {}, fountain = {}, sunDir, sky = {}, quality = 'high', room = {}, renderOrder = 0,
  shadows = true, energy = 0.75, seed = 7, sunColor,
} = {}) {
  const P = { ...DEFAULT_POOL, ...pool }
  const Fo = { ...DEFAULT_FOUNTAIN, ...fountain }
  Fo.bowlWaterY = Fo.bowlWaterY ?? Fo.bowlY - 0.016
  Fo.cupOuterR = Math.max(Fo.cupOuterR, Fo.bowlR + 0.01)
  const Ro = { ...DEFAULT_ROOM, ...room }
  // ciel : { zenith, horizon } ou une seule couleur (l'horizon en est alors une version pâle et chaude)
  sky = sky || {}
  if ((sky.isColor || typeof sky === 'string' || typeof sky === 'number')) {
    const z = toColor(sky)
    sky = { zenith: z, horizon: z.clone().lerp(new THREE.Color('#f3efe6'), 0.75) }
  }
  const Q = typeof quality === 'object' ? { ...QUALITY.high, ...quality }
    : typeof quality === 'number' ? QUALITY[quality < 0.34 ? 'low' : quality < 0.67 ? 'medium' : 'high']
    : QUALITY[quality] || QUALITY.high
  const rng = mulberry32(seed)
  const rnd = mulberry32(seed * 7919 + 13) // aléa « runtime » (séparé de la construction)

  // soleil
  const sun = (sunDir ? new THREE.Vector3().copy(sunDir) : new THREE.Vector3(-0.5, 0.7071, -0.5)).normalize()
  if (sun.y < 0) sun.negate()
  const n1 = 1.0, n2 = 1.333
  const ct = Math.sqrt(1 - Math.pow(n1 / n2, 2) * (1 - sun.y * sun.y))
  const sunRefr = new THREE.Vector3(sun.x * (n1 / n2), 0, sun.z * (n1 / n2)); sunRefr.y = ct; sunRefr.normalize()

  // jet de fontaine (valeurs à énergie 1)
  const JET_H = 0.42, ARC_H = 0.3, ARC_R = 0.27
  const jet = { nArcs: 6, nThreads: 10 }
  jet.vJet = Math.sqrt(2 * G * JET_H)
  jet.arcVy = Math.sqrt(2 * G * ARC_H); jet.arcT = (2 * jet.arcVy) / G; jet.arcVh = Math.min(ARC_R, Fo.bowlR - 0.08) / jet.arcT
  jet.threadR0 = Fo.cupOuterR + 0.004; jet.threadY0 = Fo.bowlY - 0.006; jet.threadVOut = 0.2; jet.threadVy0 = -0.03
  const dy = jet.threadY0 - Fo.waterY
  jet.threadT = (jet.threadVy0 + Math.sqrt(jet.threadVy0 * jet.threadVy0 + 2 * G * dy)) / G
  jet.threadLandR = jet.threadR0 + jet.threadVOut * jet.threadT

  const colors = {
    deep: new THREE.Color('#0d2c5c'), shallow: new THREE.Color('#2a6f8c'),
    wall: new THREE.Color('#2546d8'), coping: new THREE.Color('#f2c94c'), stucco: new THREE.Color('#efe6d4'),
    mosaic: new THREE.Color('#9fb0c9'), leafDark: new THREE.Color('#2b5a3e'), leafLit: new THREE.Color('#6f9a5a'),
    bloom: new THREE.Color('#d0287a'), bloomLight: new THREE.Color('#e4589c'), zellige: new THREE.Color('#3f5fc4'),
    marble: new THREE.Color('#f4eee2'), stone: new THREE.Color('#e8d3a8'),
    padA: new THREE.Color('#5a8148'), padB: new THREE.Color('#94ad6e'), padRim: new THREE.Color('#a4563c'),
    waterAmb: new THREE.Color('#7fa4c8'),
  }

  const U = {
    uTime: { value: 0 },
    uEnergy: { value: energy },
    uCam: { value: new THREE.Vector3(0, 1.6, 1) },
    uSunDir: { value: sun },
    uSunRefr: { value: sunRefr },
    uSunCol: { value: sunColor ? toColor(sunColor) : new THREE.Color().setRGB(1.0, 0.86, 0.68) },
    uSkyZen: { value: toColor(sky.zenith, DEFAULT_SKY.zenith) },
    uSkyHor: { value: toColor(sky.horizon, DEFAULT_SKY.horizon) },
    uPool: { value: new THREE.Vector4(P.x0, P.x1, P.z0, P.z1) },
    uPoolW: { value: new THREE.Vector4(P.waterY, P.depth, 0, 0) },
    uFount: { value: new THREE.Vector4(Fo.x, Fo.z, Fo.basinR, Fo.waterY) },
    uBowl: { value: new THREE.Vector4(Fo.bowlWaterY, Fo.bowlR, Math.min(ARC_R, Fo.bowlR - 0.08), jet.threadLandR) },
    uCup: { value: new THREE.Vector4(Fo.pedestalR, Fo.cupOuterR, Fo.cupBaseY, Fo.bowlY) },
    uRoom: { value: new THREE.Vector4(Ro.x0, Ro.x1, Ro.zBack, Ro.zFront) },
    uWallH: { value: Ro.wallH },
    uShadows: { value: shadows ? 1 : 0 },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uRipY: { value: new Array(8).fill(-100) },
    uFish: { value: Array.from({ length: Math.max(1, Q.koi) }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uFishB: { value: Array.from({ length: Math.max(1, Q.koi) }, () => new THREE.Vector4(0.3, -10, 0, 0)) },
  }

  let time = 0
  let ripCursor = 0
  const emitRipple = (x, z, level, amp, delay = 0) => {
    U.uRip.value[ripCursor].set(x, z, time + delay, amp)
    U.uRipY.value[ripCursor] = level
    ripCursor = (ripCursor + 1) % 8
  }

  const ctx = { P, Fo, Ro, Q, U, rng, rnd, colors, jet, emitRipple }
  ctx.normTex = makeRippleNormalTexture(rng)
  ctx.caustTex = makeCausticTexture(rng)

  const group = new THREE.Group()
  group.name = 'MJ_GardenFX'
  const lilies = createLilies(ctx)
  ctx.padShadowTex = makePadShadowTexture(P, lilies.pads)
  const water = buildWater(ctx)
  const caustics = buildCaustics(ctx)
  const koi = createKoi(ctx)
  const streams = createStreams(ctx)
  const drops = createDroplets(ctx)
  const petals = createPetals(ctx)

  caustics.renderOrder = renderOrder + 1
  koi.fins.renderOrder = renderOrder + 2
  water.renderOrder = renderOrder + 3
  streams.renderOrder = renderOrder + 4
  drops.points.renderOrder = renderOrder + 5
  for (const o of [koi.body, lilies.padMesh, lilies.flMesh, petals.mesh]) o.renderOrder = renderOrder
  group.add(caustics, koi.body, koi.fins, lilies.padMesh, lilies.flMesh, petals.mesh, water, streams, drops.points)
  if (parent) parent.add(group)

  const materials = []
  group.traverse((o) => { if (o.material && !materials.includes(o.material)) materials.push(o.material) })

  let energyTarget = energy, energyNow = energy
  const invM = new THREE.Matrix4(), camW = new THREE.Vector3()
  const hit = new THREE.Vector3()

  // classe un point du repère jardin : 'pool' | 'basin' | 'bowl' | null
  function waterBodyAt(x, z, y) {
    const r = Math.hypot(x - Fo.x, z - Fo.z)
    if (y !== undefined && y > Fo.waterY + 0.3 && r < Fo.bowlR) return 'bowl'
    if (x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return 'pool'
    if (r <= Fo.basinR && r >= Fo.pedestalR) return 'basin'
    if (r < Fo.bowlR) return 'bowl'
    return null
  }

  return {
    group,
    koi,
    materials,
    /** À appeler à chaque image. dt en secondes, camera = caméra de rendu (pour fresnel/billboards). */
    update(dt, camera) {
      dt = Math.min(Math.max(dt, 0), 0.1)
      time += dt
      U.uTime.value = time
      energyNow += (energyTarget - energyNow) * Math.min(1, dt * 1.6)
      U.uEnergy.value = energyNow
      if (camera) {
        group.updateWorldMatrix(true, false)
        invM.copy(group.matrixWorld).invert()
        camera.getWorldPosition(camW)
        U.uCam.value.copy(camW.applyMatrix4(invM))
      }
      koi.update(dt, time)
      petals.update(dt, time, energyNow)
    },
    /** Rides + gerbe + koï qui se rassemblent. `point` en repère jardin (THREE.Vector3). */
    splash(point, strength = 1) {
      const body = waterBodyAt(point.x, point.z, point.y)
      if (!body) return false
      const level = body === 'pool' ? P.waterY : body === 'basin' ? Fo.waterY : Fo.bowlWaterY
      emitRipple(point.x, point.z, level, 1.0 * strength, 0)
      emitRipple(point.x, point.z, level, 0.55 * strength, 0.22)
      drops.extra.uBurst.value.set(point.x, level, point.z, time)
      drops.extra.uBurstK.value = clamp(strength, 0.2, 1.5)
      petals.push(point.x, point.z, level, strength, time)
      if (body === 'pool') koi.gather(point, 6.5)
      return true
    },
    /** 0 = fontaine au repos (eau calme), 1 = jet plein. */
    setEnergy(v) { energyTarget = clamp(v, 0, 1) },
    getEnergy: () => energyNow,
    /** Intersection d'un rayon (repère jardin) avec les surfaces d'eau → Vector3 ou null. */
    intersectWater(ray, target = new THREE.Vector3()) {
      let best = Infinity
      const test = (y, accept) => {
        if (Math.abs(ray.direction.y) < 1e-6) return
        const t = (y - ray.origin.y) / ray.direction.y
        if (t <= 0 || t >= best) return
        ray.at(t, hit)
        if (accept(hit)) { best = t; target.copy(hit) }
      }
      test(P.waterY, (h) => h.x >= P.x0 && h.x <= P.x1 && h.z >= P.z0 && h.z <= P.z1)
      test(Fo.waterY, (h) => { const r = Math.hypot(h.x - Fo.x, h.z - Fo.z); return r <= Fo.basinR && r >= Fo.pedestalR })
      test(Fo.bowlWaterY, (h) => Math.hypot(h.x - Fo.x, h.z - Fo.z) <= Fo.bowlR)
      return best < Infinity ? target : null
    },
    /** Stats du module : draw calls et triangles (instances comprises). */
    stats() {
      let calls = 0, tris = 0
      group.traverse((o) => {
        if (!o.visible || !(o.isMesh || o.isPoints)) return
        calls++
        if (o.isPoints) return
        const g = o.geometry
        const t = (g.index ? g.index.count : g.attributes.position.count) / 3
        tris += t * (o.isInstancedMesh ? o.count : 1)
      })
      return { drawCalls: calls, triangles: Math.round(tris) }
    },
    dispose() {
      if (group.parent) group.parent.remove(group)
      group.traverse((o) => { if (o.geometry) o.geometry.dispose() })
      for (const m of materials) m.dispose()
      for (const t of [ctx.normTex, ctx.caustTex, ctx.padShadowTex]) t.dispose()
    },
    /** Accès debug (textures procédurales). */
    debug: { normTex: ctx.normTex, caustTex: ctx.caustTex, padShadowTex: ctx.padShadowTex, uniforms: U },
  }
}
