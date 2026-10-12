// Jardin Majorelle — « eau vivante » (runtime three.js r169, WebGL2 mobile).
//
// Contenu : surfaces d'eau (bassin long, bassin rond, eau de la vasque) en miroir bleu nuit, quasi
// immobile ; absorption SPECTRALE (le rouge disparaît en premier) appliquée par une passe multiplicative ;
// reflets par sondes cubemap à projection « boîte » (bakées dans Blender : public/majorelle/fx/probe_*.jpg,
// cf. blender/fx_bake_probes.py ; repli analytique sans sonde) ; paillettes du soleil en micro-facettes
// de 1 à 3 px ; rides de splash en paquets dispersifs de 2-3 crêtes ; caustiques chaudes + ombres au fond ;
// koï métalliques (corps + nageoires instanciés, ondulation dans le vertex shader, composités à travers la
// surface) ; nénuphars ; fleurs posées sur l'eau et boutons couchés ; jet de fontaine (colonne + couronne
// de filets) ; voile de débordement continu tout autour de la coupe, avec anneau d'écume ; gouttelettes ;
// bractées de bougainvillier (simples et en triades) qui tombent, flottent et s'accumulent aux bords ;
// sillage du doigt (water.wake, piloté par emergeFx.wake) : UNE onde lisse (étrave en V + sillon doux qui se comble),
// calculés dans le shader de l'eau (les reflets, les caustiques, la réfraction des koï, nénuphars et fleurs
// suivent) — aucun draw call en plus, rien à payer quand l'eau est calme (zone vide) ; nénuphars (et leurs
// fleurs) et bractées écartés par le doigt puis rappelés ; koi.flee(point, radius, seconds) : fuite des koï.
//
// Repère « jardin » three.js, en mètres : x à droite, y en haut, la cour s'étend vers -z.
// Le groupe retourné doit rester à l'identité sous `parent` (c'est `parent` que le lead place sous l'ancre).
// Tous les matériaux sont non tone-mappés (la scène bakée est unlit) ; aucun post-processing.
//
// Ordre de rendu (file transparente, renderOrder relatif à `renderOrder`) :
//   +1 caustiques (fond) → +2 eau : absorption (×) → +3 eau : reflets (+) → +4 corps des koï
//   → +5 nageoires → +6 nénuphars → +7 fleurs → +8 bractées → +9 jet/couronne/voile → +10 gouttes.
// Les koï sont dessinés APRÈS l'eau et calculent eux-mêmes le passage à travers la surface (reflet,
// absorption spectrale selon LEUR profondeur). Nénuphars, fleurs et bractées sont aussi dessinés après
// l'eau : l'eau ne peut jamais les recouvrir.
//
// Budget (fx.stats()) : 10 draw calls ; high 12 046 triangles (8 koï), medium 10 388 (7), low 8 742 (6) ;
// zéro allocation par image (états CPU préalloués, séparation des koï sans tableau temporaire).
// Sillage : tracé lissé du doigt, ≤ 32 / 24 / 16 points selon la qualité (uniformes uWk / uWkW, 64 vec4 + 5) ;
// la boucle n'est évaluée que dans la boîte uWkBox (zone agitée, bornée au bassin long) par l'eau, les
// caustiques et les sommets des koï / feuilles ; le nombre de points (uWkN) est un uniforme : aucune recompilation.

import * as THREE from 'three'

const TAU = Math.PI * 2
const G = 9.81
const DEG = Math.PI / 180

// ---------------------------------------------------------------------------------------------
// Valeurs par défaut (SPEC.md + build_majorelle.py)
// ---------------------------------------------------------------------------------------------
const DEFAULT_POOL = { x0: -0.8, x1: 0.8, z0: -6.3, z1: -1.7, waterY: 0, depth: 0.45, rimH: 0.08 }
const DEFAULT_FOUNTAIN = {
  x: 0, z: -7.55, basinR: 0.92, waterY: 0.42, bowlY: 1.14, bowlR: 0.44,
  floorY: 0.1,       // fond intérieur du bassin rond (build : z 0,10)
  rimY: 0.5,         // dessus du rebord marbre
  rimR: 1.03,        // rayon extérieur du rebord
  pedestalR: 0.073,  // pied de la vasque à la ligne d'eau (profil du build : r 0,0725 en z 0,42)
  cupOuterR: 0.47,   // rayon extérieur de la coupe (lèvre)
  cupBaseY: 0.96,    // bas de la coupe
  nozzleY: 1.16,     // sommet du fleuron = buse du jet (et point d'émergence du produit)
}
const DEFAULT_ROOM = { x0: -3.6, x1: 3.6, zBack: -9.6, zFront: -0.45, wallH: 4.0 }
const DEFAULT_SKY = { zenith: '#8fb4e0', horizon: '#efe6d8' }

/** Positions des sondes (repère jardin), identiques à blender/fx_bake_probes.py. */
export const MAJORELLE_PROBES = {
  pool: { position: [0, 0.25, -4.0], size: 768 },
  basin: { position: [0, 0.6, -6.95], size: 256 },
  cup: { position: [0, 1.3, -7.55], size: 256 },
}

// koi : 6 à 8 (SPEC) ; petals = nombre de bractées ; flowers/buds = fleurs ouvertes / boutons couchés
const QUALITY = {
  high: { koi: 8, drops: 1.0, petals: 24, flowers: 5, buds: 2, pads: 28, glitter: 1, lite: false },
  medium: { koi: 7, drops: 0.8, petals: 18, flowers: 4, buds: 1, pads: 24, glitter: 1, lite: false },
  low: { koi: 6, drops: 0.6, petals: 12, flowers: 3, buds: 1, pads: 18, glitter: 0, lite: true },
}

// Robes des koï : [type, échelle des nageoires (> 1 = koï « papillon »)]
// 0 kohaku (un seul, raffiné), 1 yamabuki ogon (or jaune), 2 orenji ogon (orange cuivré),
// 3 platinum ogon (crème platine chaude), 4 kin-gin-rin (or ocre pailleté)
const ROBES = [[1, 1.0], [4, 1.35], [3, 1.0], [0, 1.0], [2, 1.0], [1, 1.5], [4, 1.0], [3, 1.45]]

// Jet : hauteur 0,28 m à énergie 1 et ∝ e² (0,18 m à 0,8) ; couronne de filets au sommet
const JET_H_MAX = 0.28
const CROWN_ARCS = 10

// Sillage du doigt (water.wake) : UNE onde lisse, comme un bâton qu'on promène dans l'eau sans jamais la quitter
// (demande client : plus de chapelet d'anneaux, ni écume, ni particules). Le tracé lissé du doigt (≤ WAKE_NMAX points,
// du doigt vers le plus ancien) part au shader : chaque point a émis, à son passage, un front circulaire de rayon
// R = r0 + c·âge ; l'enveloppe de ces fronts (minima locaux de |p − X| − R le long du tracé, cf. wakeField) dessine
// les deux bras de l'étrave en V, une seule crête par côté, qui s'élargit et s'éteint ; + un sillon peu profond le
// long du tracé, qui se comble. Doigt immobile : plus rien n'est émis, le V meurt doucement (aucune pulsation).
// Doigt levé : le sillage s'efface seul (~2 s). Doigt qui se pose / tap : un seul anneau doux (uWkR).
const WAKE_NMAX = 32
const WAKE = {
  tiers: { high: { n: 32, dt: 0.066 }, medium: { n: 24, dt: 0.085 }, low: { n: 16, dt: 0.12 } }, // points, cadence (s) → vie ≈ 2,0 / 2,0 / 1,8 s
  vFull: 1.4,           // m/s : vitesse du doigt pour l'étrave pleine
  c0: 0.12, kc: 0.30,   // vitesse des fronts c = c0 + kc·Ū (m/s), Ū = vitesse du doigt lissée (uTau, ≤ 2 m/s) : les
  uTau: 0.4,            //   fronts voisins s'étalent au même rythme (sinon l'enveloppe se froisse en perles) ; demi-angle
                        //   du V = asin(c / U) : ≈ 20° à 1,4 m/s, ≈ 15° à 2,8 m/s (V long et large), petit V doux si lent
  r0: 0.04,             // rayon de l'étrave au doigt (m)
  w0: 0.065, kw: 0.10,  // demi-largeur de la crête (m), élargissement (m/s) : une houle large et douce (vue rasante)
  a: [0.0018, 0.0095],  // hauteur de crête à l'émission (m), lent → vif (pente ≤ ~0,15)
  tauA: 1.2,            // amortissement de la crête (s)
  b: [0.001, 0.0055], tauB: 0.8, wf0: 0.06, kf: 0.09, // sillon : creux (m), comblement (s), demi-largeur (m), étalement (m/s)
  dimple: 0.0012,       // doigt posé immobile : petite dépression (m), sans pulsation
  vRest: 0.05,          // m/s : en dessous, le doigt est « posé »
  eps: 0.01,            // m : déplacement minimal entre deux points du tracé
  ring: { c: 0.30, r0: 0.03, w0: 0.03, kw: 0.05, a: 0.0028, tau: 0.7, life: 1.6 }, // anneau unique et doux du doigt qui se pose (ou d'un tap)
}
const CROWN_VH = 0.30, CROWN_VY = 0.20  // vitesses de départ des filets (m/s, à énergie 1)

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
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const toColor = (c, fallback) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c ?? fallback))

// Houle basse fréquence — miroir JS exact de swell() côté GLSL (pour faire flotter pétales/nénuphars).
function swellHeight(x, z, t) {
  return 0.0016 * Math.sin((0.8 * x + 0.6 * z) * 7.0 + t * 1.25) +
    0.0012 * Math.sin((-0.45 * x + 0.89 * z) * 11.0 + t * 1.7) +
    0.0006 * Math.sin((0.97 * x - 0.24 * z) * 19.0 - t * 2.3)
}

// Distance entre deux segments 2D [A,B] et [C,D] ; écrit dans out la direction unitaire (de CD vers AB).
function segSegDist(ax, az, bx, bz, cx, cz, dx, dz, out) {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz
  const a = ux * ux + uz * uz, b = ux * vx + uz * vz, c = vx * vx + vz * vz, d = ux * wx + uz * wz, e = vx * wx + vz * wz
  const D = a * c - b * b
  let s = D > 1e-9 ? clamp((b * e - c * d) / D, 0, 1) : 0
  let t = c > 1e-9 ? (b * s + e) / c : 0
  if (t < 0) { t = 0; s = a > 1e-9 ? clamp(-d / a, 0, 1) : 0 } else if (t > 1) { t = 1; s = a > 1e-9 ? clamp((b - d) / a, 0, 1) : 0 }
  const px = ax + ux * s - (cx + vx * t), pz = az + uz * s - (cz + vz * t)
  const L = Math.hypot(px, pz)
  if (L > 1e-6) { out.x = px / L; out.z = pz / L } else { out.x = 1; out.z = 0 }
  return L
}

// ---------------------------------------------------------------------------------------------
// Textures procédurales (générées une fois, tuilables)
// ---------------------------------------------------------------------------------------------

/** Champ de pentes d'une hauteur h = Σ a·sin(2π(kx·u + ky·v) + φ) à vecteurs d'onde entiers (=> tuilable). */
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
  const focus = (1.15 / curvRms) * N
  const acc = new Float32Array(N * N)
  const S = 2
  for (let j = 0; j < N * S; j++) {
    for (let i = 0; i < N * S; i++) {
      const gi = (i / S) | 0, gj = (j / S) | 0
      const k = gj * N + gi
      const x = (i + 0.5) / S + focus * sx[k] - 0.5
      const y = (j + 0.5) / S + focus * sy[k] - 0.5
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
      const xa = ((x0 % N) + N) % N, xb = (xa + 1) % N, ya = ((y0 % N) + N) % N, yb = (ya + 1) % N
      acc[ya * N + xa] += (1 - fx) * (1 - fy); acc[ya * N + xb] += fx * (1 - fy)
      acc[yb * N + xa] += (1 - fx) * fy; acc[yb * N + xb] += fx * fy
    }
  }
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
  const d = new Uint8Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    const b = Math.round(255 * Math.min(1, out[i] / (S * S) / 4)) // stocke I/4 : la moyenne vaut ~0,25
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
  g.globalCompositeOperation = 'multiply'
  const sx = W / (pool.x1 - pool.x0), sz = H / (pool.z1 - pool.z0)
  for (const p of pads) {
    const x = (p.x - pool.x0) * sx, y = (p.z - pool.z0) * sz, r = p.r * sx
    const grd = g.createRadialGradient(x, y, r * 0.5, x, y, r * 1.3)
    grd.addColorStop(0, 'rgba(70,70,70,1)'); grd.addColorStop(1, 'rgba(255,255,255,1)')
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r * 1.3, 0, TAU); g.fill()
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
uniform vec4 uPoolW;     // niveau d'eau, profondeur, hauteur de margelle au-dessus de l'eau
uniform vec4 uFount;     // x, z, rayon d'eau du bassin, niveau d'eau du bassin
uniform vec4 uBowl;      // niveau d'eau de la vasque, rayon intérieur, rayon de retombée de la couronne, rayon du pied du voile
uniform vec4 uCup;       // rayon du pied, rayon ext. de la coupe, bas de coupe, haut de coupe
uniform vec4 uBasinRim;  // dessus du rebord, rayon ext. du rebord
uniform vec4 uRoom;      // x0, x1, zFond, zAvant
uniform float uWallH;
uniform float uShadows;
uniform vec4 uRip[8];    // rides : x, z, t0, amplitude
uniform float uRipY[8];  // niveau de l'eau de chaque ride
// sillage du doigt (water.wake, piloté par emergeFx.wake) — bassin long seulement. Tracé du doigt (0 = le doigt,
// puis du plus récent au plus ancien), grandeurs déjà vieillies côté CPU :
uniform vec4 uWk[${WAKE_NMAX}];   // point : x, z, rayon du front émis R (m), hauteur de crête A (m)
uniform vec4 uWkW[${WAKE_NMAX}];  // point : demi-largeur de crête w (m), creux du sillon B (m), demi-largeur du sillon (m),
                                 //   < 0 : début d'un autre tracé (doigt levé puis reposé), sinon 1
uniform float uWkN;              // points du tracé (0 ou ≥ 2 ; ≤ palier de qualité)
uniform float uWkCap;            // 1 : le point 0 est le doigt posé (étrave en demi-cercle devant lui)
uniform vec4 uWkR[2];            // anneaux isolés (doigt qui se pose) : x, z, R, A
uniform vec2 uWkRw;              // leurs demi-largeurs (m)
uniform vec4 uWkBox;             // zone agitée x0, x1, z0, z1 (x0 > x1 : eau calme, aucun calcul)
float gWakeSlope;                // pente du sillage au dernier waterGrad() (anti-crénelage des reflets)

// houle basse fréquence : (hauteur, dh/dx, dh/dz)
vec3 swell(vec2 p) {
  vec3 r = vec3(0.0);
  float ph;
  ph = dot(vec2(0.80, 0.60), p) * 7.0 + uTime * 1.25;
  r += vec3(0.0016 * sin(ph), vec2(0.80, 0.60) * (0.0112 * cos(ph)));
  ph = dot(vec2(-0.45, 0.89), p) * 11.0 + uTime * 1.70;
  r += vec3(0.0012 * sin(ph), vec2(-0.45, 0.89) * (0.0132 * cos(ph)));
  ph = dot(vec2(0.97, -0.24), p) * 19.0 - uTime * 2.30;
  r += vec3(0.0006 * sin(ph), vec2(0.97, -0.24) * (0.0114 * cos(ph)));
  return r;
}

// Rides (splash, bisous des koï, pétales qui touchent l'eau) : paquet DISPERSIF de 2-3 crêtes qui
// s'élargit et s'éteint. Longueur d'onde croissante avec le rayon (≈ 0,6 cm à 5 cm, ≈ 2 cm à 40 cm),
// crête de tête la plus forte, amplitude ∝ 1/√r · exp(−t / 1,2 s), rayon ≤ 0,5 m, durée ≤ 2,5 s.
// Renvoie (hauteur, dh/dx, dh/dz). fw = fwidth(p.xz) (0 dans les vertex shaders) : les crêtes plus
// fines que ~3 px (mesurées le long du rayon, donc raccourcies par la perspective) s'effacent.
vec3 ripples(vec3 p, vec2 fw) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 e = uRip[i];
    float age = uTime - e.z;
    if (e.w <= 0.0 || age <= 0.0 || age > 2.5 || abs(uRipY[i] - p.y) > 0.12) continue;
    vec2 d = p.xz - e.xy;
    float dist = length(d) + 1e-4;
    float front = 0.012 + 0.22 * age;                       // crête de tête (≈ vitesse min. des rides)
    float lam = 0.006 + 0.04 * max(dist - 0.05, 0.0);       // longueur d'onde locale
    // anti-crénelage : une crête n'est jamais plus fine que ~3 px (empreinte du pixel mesurée dans la
    // direction radiale, donc raccourcie par la perspective) ; au-delà elle s'élargit au lieu de créneler
    float fr = dot(abs(d) / dist, fw);
    float aa = 1.0 - 0.4 * smoothstep(1.0, 2.5, fr * 3.0 / lam);
    lam = max(lam, fr * 3.0);
    float psi = (front - dist) / lam;                       // nb de longueurs d'onde derrière le front
    if (psi < -0.6 || psi > 3.0 || dist > 0.55) continue;
    float env = smoothstep(-0.6, 0.0, psi) * exp(-0.9 * max(psi, 0.0)) * (1.0 - smoothstep(2.0, 3.0, psi));
    float S = e.w * 0.5 * sqrt(0.05 / max(dist, 0.05)) * exp(-age / 1.2) * (1.0 - smoothstep(0.38, 0.52, dist));
    float ph = 6.2832 * psi;
    r.x += S * lam * 0.159 * env * cos(ph);
    r.yz += (d / dist) * (S * env * aa * sin(ph));
  }
  return r;
}

// Sillage du doigt : (hauteur, dh/dx, dh/dz, 0). UNE onde lisse. Chaque point X du tracé a émis, à son passage, un
// front circulaire de rayon R ; en p, f(X) = |p − X| − R(X) le long du tracé : ses MINIMA LOCAUX sont les premiers
// fronts arrivés = l'enveloppe (f = 0 : les bras du V). On les cherche exactement sur la ligne brisée : point
// stationnaire intérieur à un segment (R linéaire sur le segment, formule fermée), ou sommet quand f décroît vers lui
// des deux côtés (éventail extérieur d'un virage), ou le doigt posé (étrave en demi-cercle de rayon r0). Une seule
// crête gaussienne e^(−(f/w)²) par minimum (aucun train d'ondes) ; à l'intérieur du V (f ≪ 0) l'eau est calme ; les
// bouts de tracé ont une hauteur nulle (fondu, sans anneau). Gradient exact (théorème de l'enveloppe : ∇f = unitaire
// de X vers p). + sillon : creux gaussien autour du tracé (projection orthogonale, mêmes règles, joints arrondis).
// Les minima se combinent par une moyenne « douce-max » (wkMix) : pas de doublement là où deux branches se
// rejoignent (intérieur d'un virage), pas de perle là où deux bras se croisent.
// fw = fwidth(p) (0 dans les vertex shaders) : une crête plus fine que ~1,5 px s'élargit au lieu de créneler.
// accumulateurs (millimètres) : S = (Σh, Σh²), G = (∇Σh, ∇Σh²), M = (Σh⁸, ∇) — « max » doux et dérivable
void wkAcc(float h, vec2 g, inout vec2 S, inout vec4 G, inout vec3 M) {
  S += vec2(h, h * h);
  G += vec4(g, 2.0 * h * g);
  float h2 = h * h, h7 = h2 * h2 * h2 * h;
  M += vec3(h7 * h, 8.0 * h7 * g);
}
// H = 2^¼·S2 / (S1⁴ + M⁴)^¼, M = (Σh⁸)^⅛, et son gradient (mm → m). Un seul minimum : H = h ; deux confondus : 1,17 h
vec3 wkMix(vec2 S, vec4 G, vec3 M) {
  if (S.x <= 1e-6 || M.x <= 1e-20) return vec3(0.0);
  float m = sqrt(sqrt(sqrt(M.x)));
  vec2 gm = m * M.yz / (8.0 * M.x);
  float s3 = S.x * S.x * S.x, m3 = m * m * m;
  float D = sqrt(sqrt(s3 * S.x + m3 * m));
  vec2 gD = (s3 * G.xy + m3 * gm) / (D * D * D);
  float H = S.y / D;
  return vec3(H, (G.zw - H * gD) / D) * 0.0011892;
}
// une crête (bras) émise en X : rayon R, hauteur A (mm), demi-largeur w
void wkArm(vec2 p, vec2 X, float R, float A, float w, vec2 fw, inout vec2 S, inout vec4 G, inout vec3 M) {
  if (A <= 0.0) return;
  vec2 dv = p - X;
  float dl = length(dv) + 1e-5;
  w = max(w, 1.5 * dot(abs(dv) / dl, fw));
  float del = 0.6 * w;                             // distance adoucie : pas d'arête sur le tracé
  float dist = sqrt(dl * dl + del * del);
  float x = (dist - R) / w;
  if (abs(x) < 3.2) {
    float e = A * exp(-x * x);
    wkAcc(e, -dv * (e * 2.0 * x / (w * dist)), S, G, M);
  }
}
// le sillon autour du point X du tracé : creux B (mm), demi-largeur W
void wkFurrow(vec2 p, vec2 X, float B, float W, vec2 fw, inout vec2 S, inout vec4 G, inout vec3 M) {
  if (B <= 0.0) return;
  vec2 dq = p - X;
  float dl = length(dq) + 1e-5;
  W = max(W, 1.5 * dot(abs(dq) / dl, fw));
  float y2 = dl * dl / (W * W);
  if (y2 < 10.0) {
    float e = B * exp(-y2);
    wkAcc(e, dq * (-e * 2.0 / (W * W)), S, G, M);
  }
}
vec4 wakeField(vec2 p, vec2 fw) {
  vec4 r = vec4(0.0);
  if (p.x < uWkBox.x || p.x > uWkBox.y || p.y < uWkBox.z || p.y > uWkBox.w) return r;
  vec2 aS = vec2(0.0), fS = vec2(0.0);
  vec4 aG = vec4(0.0), fG = vec4(0.0);
  vec3 aM = vec3(0.0), fM = vec3(0.0);
  float last = uWkN - 2.0;                       // indice du dernier segment
  float pTs = 0.0, pT0 = 0.0;                    // segment précédent (plus récent) : paramètres non bornés
  bool pOk = false;                              // … et relié à celui-ci
  // minimum intérieur du segment précédent, en attente : ajouté une fois le segment suivant connu. À l'intérieur d'un
  // virage, deux minima voisins se rejoignent au sommet et disparaissent (pli) : celui qui atteint le sommet s'efface
  // en douceur sur la moitié du segment (sinon une arête nette dans les reflets) ; sur un tracé droit, le relais au
  // sommet est exact et rien ne s'efface.
  vec4 qa = vec4(0.0); vec2 qa2 = vec2(0.0);     // bras : X, R, w | A (mm), t*
  vec4 qf = vec4(0.0); float qft = 0.0;          // sillon : X, B (mm), W | t
  for (int i = 0; i < ${WAKE_NMAX - 1}; i++) {
    if (float(i) > last) break;
    vec4 a = uWk[i], b = uWk[i + 1];
    vec4 aw = uWkW[i], bw = uWkW[i + 1];
    bool cap = i == 0 && uWkCap > 0.5;           // le doigt posé : étrave en demi-cercle (rayon r0) + petite dépression
    bool start = i == 0 || aw.w < 0.0;
    bool va = start ? cap : pOk;                 // le sommet a peut-il porter un minimum ?
    vec2 ab = b.xy - a.xy;
    float L2 = dot(ab, ab);
    // bw.w < 0 : b commence un autre tracé (doigt levé puis reposé) — pas de liaison ; segment nul (doigt qui vient de
    // se poser, ou posé immobile) : seulement l'étrave et la dépression du doigt
    if (bw.w < 0.0 || L2 < 1e-8) {
      wkArm(p, qa.xy, qa.z, qa2.x, qa.w, fw, aS, aG, aM); wkFurrow(p, qf.xy, qf.z, qf.w, fw, fS, fG, fM);
      qa2.x = 0.0; qf.z = 0.0;
      if (cap && bw.w >= 0.0) { wkArm(p, a.xy, a.z, a.w * 1000.0, aw.x, fw, aS, aG, aM); wkFurrow(p, a.xy, aw.y * 1000.0, aw.z, fw, fS, fG, fM); }
      pOk = false; continue;
    }
    float L = sqrt(L2), iL = 1.0 / L;
    vec2 q = p - a.xy;
    float t0 = dot(q, ab) * iL * iL;
    float dP = abs(q.x * ab.y - q.y * ab.x) * iL;
    // point stationnaire de f sur la droite du segment (fronts « supersoniques » |ΔR| < L) ; sinon f est monotone :
    // son minimum part vers le bout au plus grand front (le plus ancien, ΔR > 0)
    float dR = b.z - a.z;
    float mach = abs(dR) * iL;
    float ts = mach < 0.98 ? t0 + dR * dP / (L * sqrt(L2 - dR * dR)) : (dR > 0.0 ? 2.0 : -1.0);
    // le minimum en attente (segment précédent) : s'efface s'il atteint le sommet a alors que ce segment-ci a le sien
    if (pOk) {
      wkArm(p, qa.xy, qa.z, qa2.x * (1.0 - smoothstep(0.5, 1.0, qa2.y) * smoothstep(0.0, 0.3, ts)), qa.w, fw, aS, aG, aM);
      wkFurrow(p, qf.xy, qf.z * (1.0 - smoothstep(0.5, 1.0, qft) * smoothstep(0.0, 0.3, t0)), qf.w, fw, fS, fG, fM);
    }
    qa2.x = 0.0; qf.z = 0.0;
    if (ts >= 0.0 && ts < 1.0) {
      float A = mix(a.w, b.w, ts) * (1.0 - smoothstep(0.72, 0.95, mach)) * 1000.0;
      if (pOk) A *= 1.0 - (1.0 - smoothstep(0.0, 0.5, ts)) * (1.0 - smoothstep(0.7, 1.0, pTs));
      qa = vec4(a.xy + ab * ts, mix(a.z, b.z, ts), mix(aw.x, bw.x, ts)); qa2 = vec2(A, ts);
    } else if (ts < 0.0 && va && (cap || pTs >= 1.0)) {
      wkArm(p, a.xy, a.z, a.w * 1000.0, aw.x, fw, aS, aG, aM);   // minimum au sommet a (éventail, ou étrave)
    }
    if (t0 >= 0.0 && t0 < 1.0) {
      float B = mix(aw.y, bw.y, t0) * 1000.0;
      if (pOk) B *= 1.0 - (1.0 - smoothstep(0.0, 0.5, t0)) * (1.0 - smoothstep(0.7, 1.0, pT0));
      qf = vec4(a.xy + ab * t0, B, mix(aw.z, bw.z, t0)); qft = t0;
    } else if (t0 < 0.0 && va && (cap || pT0 >= 1.0)) {
      wkFurrow(p, a.xy, aw.y * 1000.0, aw.z, fw, fS, fG, fM);   // joint arrondi (ou bout au doigt)
    }
    pTs = ts; pT0 = t0; pOk = true;
  }
  wkArm(p, qa.xy, qa.z, qa2.x, qa.w, fw, aS, aG, aM); wkFurrow(p, qf.xy, qf.z, qf.w, fw, fS, fG, fM);
  vec3 arm = wkMix(aS, aG, aM), fur = wkMix(fS, fG, fM);
  r.xyz = arm - fur;
  // anneau unique du doigt qui se pose (une crête, très douce)
  for (int k = 0; k < 2; k++) {
    vec4 c = uWkR[k];
    if (c.w <= 0.0) continue;
    vec2 d = p - c.xy;
    float dl = length(d) + 1e-5;
    float w = max(k == 0 ? uWkRw.x : uWkRw.y, 1.5 * dot(abs(d) / dl, fw));
    float x = (dl - c.z) / w;
    if (abs(x) < 3.2) {
      float e = c.w * exp(-x * x);
      r.x += e;
      r.yz -= d * (e * 2.0 * x / (w * dl));
    }
  }
  return r;
}

// rayon / paroi de cylindre vertical creux : 1re paroi touchée entre y0 et y1, -1 sinon
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

// rayon / cylindre plein fermé : entrée du rayon dans le volume, -1 sinon (rayons montants)
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
  float ta = (y0 - P.y) / R.y, tb = (y1 - P.y) / R.y;
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
#ifndef LITE
  if (P.y < uCup.w - 0.02) {
    if (hitSolid(P, L, uFount.xy, uCup.y, uCup.z, uCup.w) > 0.0) v = 0.0;
    else if (hitSolid(P, L, uFount.xy, uCup.x, 0.0, uCup.z) > 0.0) v = 0.0;
  }
#endif
  return v;
}
`

const GLSL_NOISE = /* glsl */ `
float hash31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }
`

const GLSL_CAUSTIC = /* glsl */ `
uniform sampler2D uCaustTex;
// caustiques animées : deux couches qui glissent, combinées par min() (réseau qui « respire »)
float caustic(vec2 p) {
  vec2 w = swell(p).yz * 2.5;
  float a = texture2D(uCaustTex, p * 0.9 + vec2(uTime * 0.016, uTime * 0.010) + w).r;
  float b = texture2D(uCaustTex, p * 1.05 + vec2(-uTime * 0.012, uTime * 0.018) - w + 0.37).r;
  return min(a, b) * 4.0; // ~0,6 en moyenne, pics à ~3
}
`

// Micro-relief de la surface (vaguelettes). Bassin long : longueurs d'onde dominantes 25-40 cm,
// amplitude très faible (miroir glacé) ; fontaine : plus fin et plus agité.
const GLSL_SURF = /* glsl */ `
uniform sampler2D uNormTex;
uniform vec2 uWaveK;        // amplitude de la houle, des vaguelettes (bassin long)
vec2 microSlope(vec2 xz, float body) {
  float sA = body < 0.5 ? 0.45 : 1.1;
  float sB = body < 0.5 ? 1.1 : 2.7;
  vec2 dA = texture2D(uNormTex, xz * sA + vec2(uTime * 0.008, uTime * 0.006)).xy * 2.0 - 1.0;
  vec2 dB = texture2D(uNormTex, xz * sB + vec2(-uTime * 0.011, uTime * 0.017)).xy * 2.0 - 1.0;
  return dA * 0.010 + dB * 0.0055;
}
`

// Surface de l'eau : pentes, reflets (sondes ou analytique), paillettes, écume — partagé par l'eau,
// les koï et les nénuphars.
const GLSL_WATER = /* glsl */ `
uniform vec3 uScatter;      // diffusion du bassin long (bleu nuit)
uniform vec3 uScatterB;     // diffusion du bassin rond et de la coupe
uniform vec3 uAbsorbRGB;    // absorption spectrale (1/m) : le rouge part en premier
uniform vec3 uScatK;        // extinction « grise » du voile de diffusion bleu nuit (1/m) : bassin long, rond, coupe
uniform float uLightPath;   // part du trajet descendant de la lumière ajoutée au trajet de vue
uniform vec3 uBottomEst;    // couleur linéaire attendue du fond (carreaux cobalt sombres) pour le mélange
uniform vec3 uReflK;        // gain de réflectance (miroir légèrement « glossy ») : bassin long, rond, coupe
uniform vec2 uProbeRes;     // texels par radian des sondes (bassin long, fontaine)
uniform float uLodBias;
#ifdef PROBES
uniform samplerCube uProbe0;
uniform samplerCube uProbe1;
uniform samplerCube uProbe2;
uniform vec3 uProbeP0;
uniform vec3 uProbeP1;
uniform vec3 uProbeP2;
#else
uniform vec3 uWallCol;
uniform vec3 uCoping;
uniform vec3 uStucco;
uniform vec3 uMosaic;
uniform vec3 uZellige;
uniform vec3 uMarble;
uniform vec3 uStone;
#endif

// agitation propre à la fontaine : retombée de la couronne dans la coupe, pied du voile dans le bassin
vec2 fountainWaves(vec3 p, float body) {
  float e = uEnergy;
  if (e < 0.002) return vec2(0.0);
  vec2 d = p.xz - uFount.xy;
  float r = length(d) + 1e-4;
  vec2 n = d / r;
  float irr = 0.7 + 0.6 * vnoise(vec3(d * 14.0, uTime * 0.8));   // anneaux jamais parfaits
  vec2 g = vec2(0.0);
  if (body > 1.5) {
    // impacts des filets de la couronne (anneaux qui partent des deux côtés) + bouillon au pied du jet
    float rho = r - uBowl.z; float a = abs(rho);
    g += n * sign(rho) * cos(a * 150.0 - uTime * 15.0) * exp(-a * 22.0) * 0.08 * e * irr;
    g += n * cos(r * 260.0 - uTime * 19.0) * exp(-r * 60.0) * smoothstep(0.004, 0.012, r) * 0.05 * e;
  } else {
    // pied du voile : train d'ondes concentriques qui s'éloigne de la ligne de chute (2× la v1)
    float rho = r - uBowl.w; float a = abs(rho);
    g += n * sign(rho) * (cos(a * 62.0 - uTime * 9.0) * exp(-a * 5.0) * 0.085
                        + cos(a * 140.0 - uTime * 16.0) * exp(-a * 16.0) * 0.05) * e * irr;
  }
  return g;
}

// pente de la surface (dh/dx, dh/dz) ; rg = part due aux rides
vec2 waterGrad(vec3 P, float body, vec2 fw, out vec2 rg) {
  vec2 g = swell(P.xz).yz * uWaveK.x;
  // la coupe s'immobilise complètement quand la fontaine est coupée (révélation du produit)
  float calm = body < 0.5 ? uWaveK.y : (body < 1.5 ? 0.45 + 0.6 * uEnergy : 1.4 * uEnergy);
  if (body > 1.5) g *= uEnergy;
  g += microSlope(P.xz, body) * calm;
  rg = ripples(P, fw).yz;
  g += rg;
  if (body > 0.5) g += fountainWaves(P, body);
  gWakeSlope = 0.0;
#ifndef ABSORB_PASS
  // sillage du doigt (bassin long) : les reflets plient le long du tracé ; flou modéré (le dessin doit rester lisible)
  if (body < 0.5 && uWkBox.x <= uWkBox.y) {
    vec4 wk = wakeField(P.xz, fw);
    g += wk.yz;
    rg += wk.yz * 0.25;
    gWakeSlope = length(wk.yz);
  }
#endif
  return g;
}

// écume au pied du voile (bassin rond) et, plus discrète, à la retombée de la couronne (coupe) :
// x = dentelle de bulles blanches, y = eau aérée laiteuse dessous (les trous de l'écume restent clairs)
vec2 foamMask(vec3 P, float body) {
  if (body < 0.5 || uEnergy < 0.01) return vec2(0.0);
  vec2 d = P.xz - uFount.xy;
  float r = length(d);
  float x = body < 1.5 ? r - uBowl.w : r - uBowl.z;
  float wIn = body < 1.5 ? 0.012 : 0.008, wOut = body < 1.5 ? 0.055 : 0.02;
  float band = smoothstep(-wIn, 0.0, x) * (1.0 - smoothstep(0.0, wOut, x));
  float aer = smoothstep(-wIn, 0.0, x) * (1.0 - smoothstep(0.0, wOut * 1.6, x));
  float n = vnoise(vec3(d * 90.0, uTime * 1.6)) * 0.6 + vnoise(vec3(d * 230.0, uTime * 2.7 + 5.0)) * 0.4;
  float k = smoothstep(0.38, 0.75, n + 0.35 * (1.0 - clamp(x / wOut, 0.0, 1.0)));
  float e = smoothstep(0.05, 0.35, uEnergy) * (body < 1.5 ? 1.0 : 0.6);
  return vec2(band * k * 0.85, aer * 0.75) * e;
}

// Paillettes du soleil : micro-facettes hachées (cellules de 8 mm qui pivotent), chacune un point de
// 1 à 3 px quelle que soit la distance ; seules celles qui renvoient le soleil (cône étroit) brillent,
// d'où un chemin de scintillement étroit. Au loin (cellules < 2 px), un lobe étroit prend le relais.
float glitter(vec3 P, vec2 g, vec3 V, float fwPix) {
  float cs = 0.008;
  float px = fwPix / cs;                        // taille du pixel en cellules
  vec3 Nm = normalize(vec3(-g.x, 1.0, -g.y));
  float far = pow(max(dot(reflect(-V, Nm), uSunDir), 0.0), 300.0) * 0.3 * smoothstep(0.3, 0.6, px);
  float fade = 1.0 - smoothstep(0.3, 0.55, px);
  if (fade <= 0.0) return far;
  vec2 q = P.xz / cs;
  vec2 ci = floor(q);
  vec2 fq = fract(q) - 0.5;
  float h1 = hash12(ci), h2 = hash12(ci + 17.31), h3 = hash12(ci + 41.73);
  float ang = h1 * 6.2832 + uTime * (0.8 + 1.6 * h2);
  vec2 sl = vec2(cos(ang), sin(ang)) * (0.008 + 0.034 * h3);  // facettes peu inclinées : chemin étroit
  vec3 Nf = normalize(vec3(-(g.x + sl.x), 1.0, -(g.y + sl.y)));
  // une cellule sur cinq porte une facette, qui ne s'allume que par brefs éclats (scintillement rare)
  float flash = pow(0.5 + 0.5 * sin(uTime * (2.5 + 4.0 * h2) + h1 * 40.0), 10.0);
  float lit = pow(max(dot(reflect(-V, Nf), uSunDir), 0.0), 1400.0) * step(0.8, fract(h1 * 13.7)) * flash;
  vec2 off = (vec2(h2, h3) - 0.5) * 0.5;
  float dpx = length(fq - off) / max(px, 1e-4);  // distance au centre du point, en pixels
  float spot = 1.0 - smoothstep(0.5, 1.2, dpx);
  return min(lit * 4.0, 1.0) * spot * fade + far;
}

vec3 skyColor(vec3 R) {
  float h = clamp(R.y, 0.0, 1.0);
  return mix(uSkyHor, uSkyZen, pow(h, 0.5));
}

// sortie de la boîte de la cour (rayon montant depuis l'intérieur) ; face : 0 fond, 1 côtés, 2 porte, 3 ciel
float roomT(vec3 P, vec3 R, out float face) {
  float tx = R.x > 0.0 ? (uRoom.y - P.x) / max(R.x, 1e-4) : (uRoom.x - P.x) / min(R.x, -1e-4);
  float tz = R.z < 0.0 ? (uRoom.z - P.z) / min(R.z, -1e-4) : (uRoom.w - P.z) / max(R.z, 1e-4);
  float ty = (uWallH - P.y) / max(R.y, 1e-4);
  float t = min(min(tx, tz), ty);
  face = t == ty ? 3.0 : (tx < tz ? 1.0 : (R.z < 0.0 ? 0.0 : 2.0));
  return t;
}

// parois intérieures du bassin long (pour le bandeau de margelle vu en reflet)
float poolEdgeT(vec3 P, vec3 R) {
  float ex = R.x > 0.0 ? (uPool.y - P.x) / max(R.x, 1e-4) : (uPool.x - P.x) / min(R.x, -1e-4);
  float ez = R.z > 0.0 ? (uPool.w - P.z) / max(R.z, 1e-4) : (uPool.z - P.z) / min(R.z, -1e-4);
  return min(ex, ez);
}

// Couverture anti-crénelée d'un cylindre plein (axe vertical, haut y1) par un rayon : silhouette et
// arête du haut adoucies sur l'empreinte du pixel. te = distance d'entrée.
float cylCover(vec3 P, vec3 R, vec2 C, float rad, float y1, float fwR, out float te) {
  vec2 o = P.xz - C;
  float a = max(dot(R.xz, R.xz), 1e-6);
  float tca = -dot(o, R.xz) / a;                         // passage au plus près de l'axe
  float dmin = length(o + R.xz * tca);
  te = max(tca - sqrt(max(rad * rad - dmin * dmin, 0.0) / a), 1e-4);
  float w = 0.003 + fwR * max(te, 0.3) * 1.2;            // empreinte du pixel à cette distance
  float side = clamp((rad - dmin) / w + 0.5, 0.0, 1.0);
  float top = clamp((y1 - (P.y + R.y * te)) / w + 0.5, 0.0, 1.0);
  return tca > 0.0 ? side * top : 0.0;
}

#ifdef PROBES
vec3 probeAt(float body, vec3 H, float lod) {
  vec3 c;
  if (body < 0.5) c = textureLod(uProbe0, H - uProbeP0, lod).rgb;
  else if (body < 1.5) c = textureLod(uProbe1, H - uProbeP1, lod).rgb;
  else c = textureLod(uProbe2, H - uProbeP2, lod).rgb;
  return c;
}
#else
// --- repli analytique (sans sonde) : aplats anti-crénelés, sans végétation ni damier ---
float band(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
vec3 wallColorA(vec3 H, float face, float w) {
  float y = H.y;
  vec3 c = uWallCol * (face < 0.5 ? 1.0 : 0.85);
  if (face < 0.5) {
    float ax = abs(H.x);
    float archTop = 2.5 + 0.6 * sqrt(max(0.0, 1.0 - ax * ax / 0.7225));
    float frame = band(ax, -1.0, 0.85, w) * band(y, 0.3, archTop, w);
    c = mix(c, uStucco, frame);
    float inner = band(ax, -1.0, 0.62, w) * band(y, 0.48, archTop - 0.22, w);
    c = mix(c, uMosaic, inner);
    float sx = abs(ax - 2.4);
    c = mix(c, uCoping, band(sx, -1.0, 0.5, w) * band(y, 0.7, 2.9, w));
    c = mix(c, uStucco * 0.9, band(sx, -1.0, 0.4, w) * band(y, 0.8, 2.8, w));
  } else if (face < 1.5) {
    float sz = min(abs(H.z + 3.2), abs(H.z + 6.4));
    c = mix(c, uCoping, band(sz, -1.0, 0.7, w) * band(y, -1.0, 2.6, w));
    c = mix(c, uWallCol * 0.5, band(sz, -1.0, 0.58, w) * band(y, -1.0, 2.48, w));
  } else {
    c = mix(c, uStone * 0.35, band(abs(H.x), -1.0, 0.6, w) * band(y, -1.0, 2.6, w));
  }
  c = mix(c, uCoping, smoothstep(uWallH - 0.15 - w, uWallH - 0.15 + w, y));
  return c;
}
vec3 fountainColorA(vec3 H) {
  vec2 n = normalize(H.xz - uFount.xy);
  float lam = 0.72 + 0.28 * max(dot(vec3(n.x, 0.0, n.y), uSunDir), 0.0);
  return (H.y > uBasinRim.x - 0.02 ? uStone : mix(uZellige, uMarble, 0.4)) * lam;
}
#endif

// couleur de la cour au point H de la boîte (le « couvercle » de la boîte = ciel analytique : la sonde n'y
// voit que le faîte des murs, qui se projetterait en bandeau sombre sur l'eau)
vec3 roomColor(float body, vec3 H, vec3 R, float face, float lod, float t, float fwR) {
  if (face > 2.5) return skyColor(R);
#ifdef PROBES
  return probeAt(body, H, lod);
#else
  return wallColorA(H, face, 0.004 + t * (0.003 + fwR * 1.5));
#endif
}
vec3 proxyColor(float body, vec3 H, float lod) {
#ifdef PROBES
  return probeAt(body, H, lod);
#else
  return fountainColorA(H);
#endif
}

// reflet : boîte de la cour + volumes propres de la fontaine (bassin rond, pied, coupe) hors LITE
vec3 envRefl(vec3 P, vec3 R, float body, float lod, float fwR) {
  float face;
  float t = roomT(P, R, face);
  vec3 c = roomColor(body, P + R * t, R, face, lod, t, fwR);
#ifndef LITE
  vec2 C = uFount.xy;
  float tf = -1.0, cov = 0.0;
  if (body < 0.5) {
    // bassin rond : bord adouci (silhouette + arête) ; pied et coupe par-dessus, au-delà du rebord
    float tb;
    float cb = cylCover(P, R, C, uBasinRim.y, uBasinRim.x, fwR, tb);
    float tp = hitSolid(P, R, C, uCup.x, uBasinRim.x, uCup.z);
    float tc = hitSolid(P, R, C, uCup.y, uCup.z, uCup.w);
    float tv = 1e6;
    if (tp > 0.0) tv = tp;
    if (tc > 0.0) tv = min(tv, tc);
    if (tv < t && (cb < 0.5 || tv < tb)) { tf = tv; cov = 1.0; }
    else if (cb > 0.0 && tb < t) { tf = tb; cov = cb; }
  } else if (body < 1.5) {
    tf = hitCyl(P, R, C, uFount.z, uFount.w - 0.01, uBasinRim.x);
    float tp = hitSolid(P, R, C, uCup.x, uFount.w - 0.01, uCup.z);
    if (tp > 0.0 && (tf < 0.0 || tp < tf)) tf = tp;
    float tc = hitSolid(P, R, C, uCup.y, uCup.z, uCup.w);
    if (tc > 0.0 && (tf < 0.0 || tc < tf)) tf = tc;
    cov = tf > 0.0 && tf < t ? 1.0 : 0.0;
  } else {
    tf = hitCyl(P, R, C, uBowl.y, uBowl.x - 0.01, uCup.w + 0.006);
    cov = tf > 0.0 && tf < t ? 1.0 : 0.0;
  }
  if (cov > 0.0) c = mix(c, proxyColor(body, P + R * tf, lod), cov);
#endif
  // bandeau de margelle (bassin long) : fondu anti-crénelé sur l'arête du dessus
  if (body < 0.5) {
    float te = poolEdgeT(P, R);
    float top = uPoolW.x + uPoolW.z;
    float yh = P.y + R.y * te;
    float bw = 0.004 + te * (0.004 + fwR * 1.5);
    float eb = te < t ? smoothstep(top + bw, top - bw, yh) : 0.0;
    if (eb > 0.001) {
      vec3 He = P + R * te;
#ifdef PROBES
      c = mix(c, probeAt(body, He, lod), eb);
#else
      float s = He.x + He.z;
      vec3 zc = mix(uZellige, uMarble, smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(s * 28.0)) * (1.0 - smoothstep(0.2, 0.5, te * fwR * 28.0)));
      c = mix(c, zc, eb);
#endif
    }
  }
  return c;
}

// niveau de mip des reflets : empreinte du pixel (fwidth) ; 0..1 sur eau calme, flou seulement là où
// la surface est réellement agitée (rides, fontaine)
float reflLod(float fwR, float tpr, vec2 rg, float body) {
  float base = clamp(log2(max(fwR * tpr, 1e-3)) + uLodBias, 0.0, 1.0);
  float agit = length(rg) * 10.0 + (body > 0.5 ? uEnergy * (body > 1.5 ? 0.8 : 0.5) : 0.0);
  return min(base + agit, 4.0);
}
`

// ---------------------------------------------------------------------------------------------
// 1) Surfaces d'eau : bassin long + bassin rond + vasque — 2 draw calls sur la même géométrie :
//    a) absorption : dst × T(λ)   (T spectral : le décor baké sous l'eau perd d'abord son rouge)
//    b) par-dessus : F·reflet + (1−F)·σ·bleu nuit (+ écume, paillettes), alpha a = F + (1−F)·σ,
//       σ = 1 − exp(−k·trajet) = voile de diffusion. Au final : fond × T(λ) × (1−F)(1−σ) + …
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
${GLSL_NOISE}
${GLSL_SURF}
${GLSL_WATER}
uniform float uGlitter;
uniform vec4 uGold;   // CÈDRE (lib/majorelle/cedarAnswer.js) : front s, largeur, amplitude de bande, rémanence ; neutre à z = w = 0
varying vec3 vPos;
varying vec2 vInfo;

// distance parcourue dans l'eau le long du rayon réfracté jusqu'au fond, aux parois ou au pied de la vasque
float pathLen(vec3 P, vec3 Td, float body, float depth) {
  float t = depth / max(-Td.y, 0.2);
  if (body < 0.5) {
    float tx = Td.x > 0.0 ? (uPool.y - P.x) / max(Td.x, 1e-4) : (uPool.x - P.x) / min(Td.x, -1e-4);
    float tz = Td.z > 0.0 ? (uPool.w - P.z) / max(Td.z, 1e-4) : (uPool.z - P.z) / min(Td.z, -1e-4);
    t = min(t, min(tx, tz));
  }
#ifndef LITE
  else if (body < 1.5) {
    float tw = hitCyl(P, Td, uFount.xy, uFount.z, uFount.w - depth - 0.02, uFount.w + 0.01);
    if (tw > 0.0) t = min(t, tw);
    float tp = hitSolid(P, Td, uFount.xy, uCup.x * 1.08, uFount.w - depth - 0.02, uFount.w + 0.01);
    if (tp > 0.0) t = min(t, tp);
  }
#endif
  return max(t, 0.0);
}

void main() {
  vec3 P = vPos;
  float body = vInfo.x;
  // dérivées en flot uniforme (avant tout branchement)
  vec2 fwP = fwidth(P.xz);
  float fwPix = max(fwP.x, fwP.y);
  vec2 rg;
  vec2 g = waterGrad(P, body, fwP, rg);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(uCam - P);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float rk = body < 0.5 ? uReflK.x : (body < 1.5 ? uReflK.y : uReflK.z);
  // Schlick, gain appliqué au seul terme rasant : la moitié lointaine devient un miroir sombre,
  // l'eau vue de haut reste transparente (F0 = 0,02)
  float F = min(0.02 + 0.98 * pow(1.0 - NdV, 5.0) * mix(1.0, rk, smoothstep(0.38, 0.1, NdV)), 1.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);
  R = normalize(R);
  float fwR = length(fwidth(R));
  vec2 fm = foamMask(P, body);
  float foam = fm.x;
#ifndef ABSORB_PASS
  // reflets dans le sillage : niveau de mip pris sur la variation réelle du rayon réfléchi (sinon les vagues
  // échantillonnent le carrelage de la sonde un pixel sur deux : grésillement)
  float lodW = gWakeSlope > 0.004 ? clamp(log2(max(fwR * (body < 0.5 ? uProbeRes.x : uProbeRes.y), 1e-3)) + uLodBias, 0.0, 4.0) * smoothstep(0.004, 0.03, gWakeSlope) : 0.0;
#endif
  // trajet optique : vue (rayon réfracté) + part du trajet descendant de la lumière
  vec3 Td = refract(-V, N, 0.7502);
  float path = pathLen(P, Td, body, vInfo.y);
  float L = path + uLightPath * min(path * max(-Td.y, 0.0), vInfo.y);
  vec3 T = exp(-uAbsorbRGB * L);
#ifdef ABSORB_PASS
  gl_FragColor = vec4(pow(T, vec3(1.0 / 2.2)), 1.0);   // tampon 8 bits encodé sRGB : × en sRGB = × linéaire
#else
  float tpr = body < 0.5 ? uProbeRes.x : uProbeRes.y;
  vec3 refl = envRefl(P, R, body, max(reflLod(fwR, tpr, rg, body), lodW), fwR);
  // CÈDRE : au passage de la vague dorée le reflet vire à l'or liquide (tous les corps d'eau) et les paillettes
  // s'intensifient ; jamais ajouté à sv (le bassin brûlerait au blanc). Branche sautée hors réponse.
  float gK = 0.0;
  if (uGold.z + uGold.w > 0.0) {
    float gS = -P.z + 0.55 * P.y;
    float gQ = (gS - uGold.x) / uGold.y;
    gK = clamp(uGold.z * exp(-gQ * gQ) * 1.2 + uGold.w * 1.25 * (1.0 - smoothstep(uGold.x - 1.4, uGold.x + 0.4, gS)), 0.0, 1.2);
    vec3 gR = refl * vec3(1.38, 1.06, 0.52) + vec3(0.12, 0.065, 0.0);
    gR = min(gR, 0.6) + 0.3 * (1.0 - exp(-max(gR - 0.6, 0.0) / 0.3));   // épaule : l'or ne s'écrête jamais (≤ 0,9)
    refl = mix(refl, gR, min(gK, 1.0));
  }
  float sv = sunVis(P);
  // voile de diffusion bleu nuit (gris en quantité, couleur = eau profonde), composé « par-dessus »
  float sig = 1.0 - exp(-(body < 0.5 ? uScatK.x : (body < 1.5 ? uScatK.y : uScatK.z)) * L);
  vec3 scat = (body < 0.5 ? uScatter : uScatterB) * (0.75 + 0.35 * sv);
  scat = mix(scat, vec3(0.30, 0.17, 0.05) * (0.75 + 0.35 * sv), 0.55 * min(gK, 1.0));   // CÈDRE : l'eau profonde vire à l'ambre
  float a = F + (1.0 - F) * sig;
  vec3 lin = (F * refl + (1.0 - F) * sig * scat) / max(a, 1e-3);
  // eau aérée laiteuse puis dentelle d'écume (presque opaque)
  float lit = 0.6 + 0.4 * sv;
  lin = mix(lin, vec3(0.42, 0.5, 0.6) * lit, fm.y * (1.0 - foam) * 0.6 / max(a + fm.y * 0.6, 1e-3));
  a = mix(a, 1.0, fm.y * 0.45);
  lin = mix(lin, vec3(0.86, 0.89, 0.92) * lit, foam);
  a = mix(a, 1.0, foam * 0.9);
  if (gK > 0.0) {
    // CÈDRE : nappe d'or (soleil rasant sur l'eau) composée par-dessus, moirée par les vagues ; chaude, jamais blanche
    float gn = vnoise(vec3(P.xz * 5.0 + g * 6.0, uTime * 0.5));
    float gF = min(gK, 1.0) * (0.52 + 0.28 * gn) * (0.6 + 0.4 * sv) * (1.0 - foam);
    vec3 gC = vec3(0.84, 0.53, 0.17) * (0.85 + 0.3 * gn);
    lin = (gC * gF + lin * a * (1.0 - gF)) / max(gF + a * (1.0 - gF), 1e-3);
    a = gF + a * (1.0 - gF);
  }
  float gl = 0.0;
#ifndef LITE
  gl = min(glitter(P, g, V, fwPix) * uGlitter * sv * (1.0 - foam) * (1.0 + 2.5 * gK), 1.0);
#endif
  // Composition « par-dessus » corrigée du gamma : le tampon est encodé sRGB, un mélange direct y
  // grisaillerait les reflets chauds sur le bleu nuit. On émet la couleur qui donne le mélange LINÉAIRE
  // exact pour le fond attendu E (carreaux cobalt sombres déjà absorbés par la passe a).
  vec3 E = uBottomEst * T;
  vec3 o = linearToOutputTexel(vec4(lin * a + E * (1.0 - a), 1.0)).rgb - linearToOutputTexel(vec4(E, 1.0)).rgb * (1.0 - a);
  o = max(o, vec3(0.0));
  // paillettes : fondu vers l'or du soleil (jamais au-delà de (1, 0.86, 0.68) affiché)
  o = mix(o, uSunCol * 0.96, gl);
  float ao = mix(a, 1.0, gl);
  gl_FragColor = vec4(o, ao);
#endif
}
`

function buildWater(ctx) {
  const { P, Fo, U, W } = ctx
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
  ring(Fo.x, Fo.z, Fo.bowlWaterY, 0.0, Fo.bowlR, 36, 2, 0.22) // profondeur optique (la coupe réelle est plate)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  const uniforms = { ...U, ...W, uGlitter: { value: ctx.Q.glitter } }
  const common = { uniforms, vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false, toneMapped: false }
  // a) absorption spectrale : dst × couleur
  const absorbMat = new THREE.ShaderMaterial({
    ...common, defines: { ...ctx.defines, ABSORB_PASS: 1 },
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })
  // b) reflets + voile de diffusion + écume + paillettes : « par-dessus » (alpha prémultiplié)
  const mat = new THREE.ShaderMaterial({
    ...common, defines: { ...ctx.defines },
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })
  const absorb = new THREE.Mesh(geo, absorbMat)
  absorb.name = 'MJ_WaterAbsorb'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'MJ_Water'
  return { absorb, mesh }
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
uniform float uCaustGain;
uniform float uCaustFade;
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
    float d = length(vec2(al / (0.52 * L), la / ((al > 0.0 ? 0.10 : 0.08) * L)));
    float soft = 0.25 + h * 2.2;
    lit *= 1.0 - 0.45 * (1.0 - smoothstep(1.0 - soft * 0.5, 1.0 + soft, d));
  }
  // sillage : le réseau de caustiques se décale avec la pente (réfraction) et se concentre doucement sous la
  // crête / s'éteint un peu sous le sillon (une bande continue, jamais de points chauds)
  vec2 cp = sp;
  float wl = 1.0;
  if (vInfo.y < 0.5 && uWkBox.x <= uWkBox.y) {
    vec4 wk = wakeField(sp, vec2(0.0));
    cp -= wk.yz * (0.25 + 1.2 * depth);
    wl = clamp(1.0 + wk.x * 80.0, 0.6, 1.5);
  }
  // scintillement chaud et doux, atténué avec la profondeur
  float c = caustic(cp) * wl * lit * exp(-depth * uCaustFade);
  gl_FragColor = vec4(uSunCol * (0.6 * uCaustGain * c), mix(0.72, 0.92, lit));
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
    v(Fo.x, yf, Fo.z, Fo.waterY, 1)
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
      uCaustGain: { value: 0.45 }, uCaustFade: { value: 1.2 },
    },
    defines: { ...ctx.defines, NKOI: Math.max(1, Q.koi) },
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
// 3) Koï : corps + nageoires, 2 draw calls instanciés, dessinés APRÈS l'eau.
//    Géométrie en « longueurs de corps » : nez en x = +0,5, pédoncule en x = −0,5, latéral = z.
//    Silhouette élancée (largeur 0,085 L), 16 anneaux × 18 segments = 576 triangles par corps.
// ---------------------------------------------------------------------------------------------
const KOI_W = 0.085, KOI_HT = 0.096, KOI_HB = 0.082
const KOI_EYE = { u: 0.088, y: 0.013, r: 0.0085 }

function koiProfile(u) {
  if (u < 0.28) { const a = 1 - u / 0.28; return Math.pow(Math.max(0, 1 - a * a), 0.5) }
  const b = (u - 0.28) / 0.72
  return 0.19 + 0.81 * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * b), 0.95)
}

function buildKoiBodyGeometry() {
  // 16 anneaux : 4 dans la tête (calotte du museau = simple éventail), 12 jusqu'au pédoncule
  const NH = 4, NT = 12, NR = 18
  const us = []
  for (let i = 1; i <= NH; i++) us.push(0.25 * Math.pow(i / NH, 1.4))
  for (let i = 1; i <= NT; i++) us.push(0.25 + 0.75 * Math.pow(i / NT, 1.05))
  const NL = us.length
  const pos = [], uu = [], idx = []
  pos.push(0.502, -0.008, 0); uu.push(0)
  for (const u of us) {
    const p = koiProfile(u)
    const belly = 1 + 0.12 * Math.exp(-Math.pow((u - 0.42) / 0.16, 2))
    const yc = -0.008 * (1 - u)
    for (let j = 0; j < NR; j++) {
      const a = (j / NR) * TAU, cz = Math.cos(a), sy = Math.sin(a)
      // dos légèrement caréné, ventre plein
      const y = sy >= 0 ? sy * KOI_HT * p * (1 + 0.06 * Math.pow(sy, 6)) : sy * KOI_HB * belly * p
      pos.push(0.5 - u, y + yc, cz * KOI_W * p * (1 - 0.06 * sy * sy)); uu.push(u)
    }
  }
  const tail = pos.length / 3
  pos.push(-0.503, 0, 0); uu.push(1)
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
  const grid = (cols, rows, fn) => {
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
  // pectorales : éventail arrondi, attaché bas sur les flancs
  for (const side of [1, -1]) {
    const pR = koiProfile(0.24)
    const yR = -0.5 * KOI_HB * pR, zR = side * KOI_W * pR * 0.8
    grid(5, 3, (a, b) => {
      const rx = 0.5 - (0.2 + 0.08 * b), ry = yR, rz = zR
      const dx = -0.3 + (-0.95 + 0.3) * b, dy = -0.2 + 0.05 * b, dz = side * (1.0 - 0.45 * b)
      const dl = Math.hypot(dx, dy, dz)
      const len = 0.19 * (0.8 + 0.2 * Math.sin(Math.PI * b)) * (1 - 0.18 * b) * (1 - 0.25 * Math.pow(Math.abs(b - 0.45) * 2, 3) * a)
      return [rx + (dx / dl) * len * a, ry + (dy / dl) * len * a, rz + (dz / dl) * len * a, side > 0 ? 1 : 2, a, b, rx, ry, rz]
    })
  }
  // dorsale : bande basse le long du dos
  grid(10, 2, (s, r) => {
    const u = 0.3 + 0.42 * s
    const yTop = KOI_HT * koiProfile(u) * 0.95 - 0.008 * (1 - u)
    const h = 0.072 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)), 0.55) * (1 - 0.5 * s)
    const x = 0.5 - u
    return [x - 0.03 * r, yTop + h * r, 0, 3, r, s, x, yTop, 0]
  })
  // caudale : deux lobes souples légèrement fourchus
  grid(6, 7, (c, s) => {
    const sv = s * 2 - 1
    const len = 0.3 * (0.76 + 0.24 * sv * sv)
    const half = 0.017 + 0.13 * Math.pow(c, 0.8)
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
${GLSL_SURF}
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

// flexion de virage : la colonne suit un arc de cercle exact (longueur conservée, centre du corps fixe)
vec3 bendArc(vec3 q, float xa, float k, inout vec3 n) {
  float s = -xa;
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
  // réfraction : la silhouette ondule avec la pente de la surface au-dessus (2 à 4 mm)
  float depth = max(uPoolW.x - w.y, 0.0);
  vec2 gs = swell(w.xz).yz * uWaveK.x + microSlope(w.xz, 0.0) * uWaveK.y + ripples(vec3(w.x, uPoolW.x, w.z), vec2(0.0)).yz;
  gs += wakeField(w.xz, vec2(0.0)).yz;
  w.xz -= gs * (0.35 + 0.6 * depth);
  vW = w.xyz;
  vRest = position;
  vLook = aLook;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`

// éclairage sous l'eau + passage à travers la surface (mêmes reflets/pentes/absorption que l'eau)
const KOI_LIGHT = /* glsl */ `
uniform vec3 uWaterAmb;
uniform float uGlitter;
// éclairage sous l'eau : soleil réfracté × caustiques chaudes, ambiance du ciel filtrée par l'eau
vec3 koiLight(vec3 N, vec3 W, out float sv) {
  float depth = max(uPoolW.x - W.y, 0.0);
  vec3 S = W + uSunRefr * (depth / uSunRefr.y);
  sv = sunVis(vec3(S.x, uPoolW.x, S.z));
  float c = caustic(S.xz);
  float ndl = dot(N, uSunRefr);
  float diff = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  vec3 amb = mix(uWaterAmb * 0.4, uWaterAmb, N.y * 0.5 + 0.5);
  return amb + uSunCol * diff * sv * (0.5 + 0.5 * c);
}
// la couleur c (linéaire) d'un point W sous l'eau, vue depuis la caméra à travers la surface :
// F·reflet + (1−F)·(T(λ)·(1−σ)·c + σ·bleu nuit), T spectral selon la profondeur du point.
// gl = paillettes du soleil (à ajouter en espace de sortie).
vec3 throughWater(vec3 c, vec3 W, out float gl) {
  vec3 Vd = W - uCam;
  float ts = (uPoolW.x - uCam.y) / min(Vd.y, -1e-4);
  vec3 S = uCam + Vd * clamp(ts, 0.0, 1.0);
  S.y = uPoolW.x;
  vec2 fwS = fwidth(S.xz);
  float fwPix = max(fwS.x, fwS.y);
  vec2 rg;
  vec2 g = waterGrad(S, 0.0, fwS, rg);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(uCam - S);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = min(0.02 + 0.98 * pow(1.0 - NdV, 5.0) * mix(1.0, uReflK.x, smoothstep(0.38, 0.1, NdV)), 1.0);
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.02); R = normalize(R);
  float fwR = length(fwidth(R));
  vec3 refl = envRefl(S, R, 0.0, reflLod(fwR, uProbeRes.x, rg, 0.0), fwR);
  float cosT = sqrt(max(1.0 - (1.0 - NdV * NdV) / 1.769, 0.0));
  float d = max(uPoolW.x - W.y, 0.0);
  float L = d / max(cosT, 0.2) + uLightPath * d;
  vec3 T = exp(-uAbsorbRGB * L);
  float sig = 1.0 - exp(-uScatK.x * L);
  float svS = sunVis(S);
  vec3 scat = uScatter * (0.75 + 0.35 * svS);
  gl = 0.0;
#ifndef LITE
  gl = min(glitter(S, g, V, fwPix) * uGlitter * svS, 1.0);
#endif
  return F * refl + (1.0 - F) * (T * c * (1.0 - sig) + scat * sig);
}
`

const KOI_BODY_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CAUSTIC}
${GLSL_SURF}
${GLSL_WATER}
${KOI_LIGHT}
varying vec3 vRest;
varying vec3 vN;
varying vec3 vW;
varying vec4 vLook;

// robe : albédo (linéaire), métal (0..1), paillettes (kin-gin-rin)
void robe(vec4 look, vec3 r, float fwn, out vec3 alb, out float metal, out float sparkle) {
  float type = look.x, seed = look.y;
  float top = smoothstep(-0.045, 0.03, r.y);
  float n = vnoise(r * vec3(7.0, 9.0, 9.0) + seed * 17.0) * 0.72 + vnoise(r * vec3(17.0, 21.0, 21.0) + seed * 5.0) * 0.28;
  vec3 white = s2l(vec3(0.95, 0.94, 0.90));
  sparkle = 0.0;
  if (type < 0.5) {                 // kohaku raffiné : blanc nacré, hi vermillon aux bords nets (anti-crénelés)
    float e = n + top * 0.1 - (1.0 - top) * 0.5 + smoothstep(0.38, 0.5, r.x) * 0.06;
    float m = smoothstep(0.585 - fwn, 0.585 + fwn, e) * top;
    alb = mix(white, s2l(vec3(0.78, 0.20, 0.10)), m);
    metal = 0.15;
  } else if (type < 1.5) {          // yamabuki ogon : or jaune, dos plus soutenu
    vec3 c = s2l(vec3(0.95, 0.79, 0.44));
    alb = mix(c, c * vec3(0.86, 0.7, 0.48), top * 0.55); metal = 0.9;
  } else if (type < 2.5) {          // orenji ogon : cuivre orangé désaturé (écaille métallique mouillée)
    vec3 c = s2l(vec3(0.88, 0.55, 0.30));
    alb = mix(c, c * vec3(0.86, 0.68, 0.52), top * 0.5); metal = 0.85;
  } else if (type < 3.5) {          // platinum ogon : crème platine chaude
    vec3 c = s2l(vec3(0.96, 0.89, 0.74));
    alb = mix(c, c * vec3(0.96, 0.9, 0.8), top * 0.35); metal = 0.55;
  } else {                          // kin-gin-rin : or ocre, écailles pailletées
    vec3 c = s2l(vec3(0.90, 0.69, 0.36));
    alb = mix(c, c * vec3(0.84, 0.68, 0.48), top * 0.5); metal = 0.9; sparkle = 1.0;
  }
  // ventre plus pâle
  float belly = 1.0 - smoothstep(-0.07, -0.02, r.y);
  alb = mix(alb, white * vec3(1.0, 0.97, 0.9), belly * 0.5);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 r = vRest;
  // --- écailles (coordonnées corps : le long, autour) ; dérivées en flot uniforme ---
  float around = atan(r.y, r.z);
  vec2 sc = vec2(-r.x * 34.0, around * 3.5);
  vec2 fwS = fwidth(sc);
  float fwn = max(fwidth(r.x), fwidth(r.y)) * 12.0 + 0.004;
  float row = floor(sc.y);
  sc.x += 0.5 * mod(row, 2.0);
  vec2 cell = floor(sc);
  vec2 f = fract(sc) - vec2(0.62, 0.5);
  float dS = length(f * vec2(1.0, 0.95));
  float zone = smoothstep(0.2, 0.3, 0.5 - r.x) * smoothstep(0.98, 0.9, 0.5 - r.x) * smoothstep(-0.06, -0.02, r.y);
  float scaleAA = zone * (1.0 - smoothstep(0.3, 0.6, max(fwS.x, fwS.y)));
  float edge = smoothstep(0.36, 0.5, dS);
  vec3 alb; float metal; float sparkle;
  robe(vLook, r, fwn, alb, metal, sparkle);
  alb *= 1.0 - 0.07 * edge * scaleAA;                  // modulation 6-8 % au bord des écailles
  alb *= 1.0 + 0.03 * (hash12(cell + vLook.y) - 0.5) * scaleAA;
  // --- œil : iris doré cerclé, pupille sombre, reflet humide ---
  float ed = length(vec2(r.x - (0.5 - ${KOI_EYE.u.toFixed(3)}), r.y - ${KOI_EYE.y.toFixed(3)}));
  float side = step(0.032, abs(r.z));
  float fe = fwidth(ed) + 1e-4;
  float eye = (1.0 - smoothstep(${KOI_EYE.r.toFixed(4)} - fe, ${KOI_EYE.r.toFixed(4)} + fe, ed)) * side;
  float pupil = (1.0 - smoothstep(0.0050 - fe, 0.0050 + fe, ed)) * side;
  vec3 iris = s2l(vec3(0.78, 0.6, 0.28)) * (0.75 + 0.5 * smoothstep(0.005, 0.0085, ed));
  alb = mix(alb, iris, eye);
  alb = mix(alb, s2l(vec3(0.03, 0.03, 0.05)), pupil);
  metal = mix(metal, 0.4, eye);
  // --- éclairage ---
  float sv;
  vec3 light = koiLight(N, vW, sv);
  vec3 col = alb * (1.0 - 0.45 * metal) * light;
  vec3 H = normalize(uSunRefr + V);
  float NdH = max(dot(N, H), 0.0);
  // reflet du soleil large et doux (écaille mouillée), jamais un trait blanc
  float sp = pow(NdH, mix(20.0, 40.0, metal)) * sv;
  col += uSunCol * sp * mix(vec3(0.05), alb * 0.5, metal);
  // reflets d'écailles : facettes légèrement désorientées, très vives pour le kin-gin-rin
  float hs = hash12(cell * 1.7 + vLook.y * 3.1);
  vec3 Nt = normalize(N + (vec3(hash12(cell + 0.31), hash12(cell + 0.73), hash12(cell + 0.17)) - 0.5) * 0.5);
  float core = 1.0 - smoothstep(0.08, 0.26, dS);
  float gls = pow(max(dot(Nt, H), 0.0), 160.0) * sv * step(0.82 - 0.22 * sparkle, hs) * core * scaleAA;
  col += uSunCol * gls * mix(0.25, 0.9, sparkle) * mix(vec3(1.0), alb * 1.3, metal * 0.6);
  // lustre métallique : l'eau environnante et la lumière chaude se reflètent dans la robe
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 envU = mix(uScatter * 2.0, mix(uWaterAmb, uSunCol, 0.35) * 0.8, N.y * 0.5 + 0.5);
  col += metal * alb * envU * (0.25 + 0.5 * fr) * 0.6;
  // pupille : reflet humide
  col += uSunCol * pupil * pow(NdH, 300.0) * 2.0 * sv + vec3(0.5) * pupil * smoothstep(0.0024, 0.0008, length(vec2(r.x - (0.5 - ${KOI_EYE.u.toFixed(3)}) - 0.0018, r.y - ${KOI_EYE.y.toFixed(3)} - 0.0018)));
  // --- à travers la surface ---
  float gl;
  vec3 o = throughWater(col, vW, gl);
  gl_FragColor = vec4(mix(linearToOutputTexel(vec4(o, 1.0)).rgb, uSunCol * 0.96, gl), 1.0);
}
`

const KOI_FIN_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CAUSTIC}
${GLSL_SURF}
${GLSL_WATER}
${KOI_LIGHT}
varying vec3 vRest;
varying vec3 vN;
varying vec3 vW;
varying vec4 vLook;
varying vec4 vFin;
void main() {
  float type = vLook.x;
  vec3 c = s2l(vec3(0.95, 0.94, 0.9));
  if (type > 0.5 && type < 1.5) c = s2l(vec3(0.96, 0.83, 0.52));
  else if (type > 1.5 && type < 2.5) c = s2l(vec3(0.92, 0.66, 0.42));
  else if (type > 2.5 && type < 3.5) c = s2l(vec3(0.95, 0.9, 0.8));
  else if (type > 3.5) c = s2l(vec3(0.93, 0.76, 0.44));
  float t = vFin.y;
  float rays = 0.86 + 0.14 * smoothstep(0.32, 0.0, abs(fract(vFin.z * (vFin.x > 3.5 ? 11.0 : 7.0)) - 0.5));
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  float sv;
  vec3 light = koiLight(N, vW, sv);
  // translucidité : le soleil traverse la nageoire
  float trans = pow(max(dot(-V, uSunRefr), 0.0), 3.0) * sv * 0.6;
  vec3 col = c * rays * (light * 0.85 + uSunCol * trans);
  col = mix(col, c * light, smoothstep(0.75, 1.0, t) * 0.4); // liseré plus clair
  float a = mix(0.8, 0.28, smoothstep(0.0, 1.0, t)) * rays;
  if (vFin.x > 2.5 && vFin.x < 3.5) a = mix(0.78, 0.42, t);
  a *= 1.0 - smoothstep(0.9, 1.0, t) * 0.6;
  float gl;
  vec3 o = throughWater(col, vW, gl);
  gl_FragColor = vec4(mix(linearToOutputTexel(vec4(o, 1.0)).rgb, uSunCol * 0.96, gl), mix(a, 1.0, gl));
}
`

function createKoi(ctx) {
  const { P, U, W, Q, rng, colors } = ctx
  const N = Q.koi
  const bodyGeo = buildKoiBodyGeometry()
  const finGeo = buildKoiFinGeometry()
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const swim2 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage)
  const look = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4)
  for (const g of [bodyGeo, finGeo]) { g.setAttribute('aSwim', swim); g.setAttribute('aSwim2', swim2); g.setAttribute('aLook', look) }
  const koiUniforms = { uWaterAmb: { value: colors.waterAmb }, uCaustTex: { value: ctx.caustTex }, uGlitter: { value: Q.glitter } }
  ctx.koiUniforms = koiUniforms
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...W, ...koiUniforms }, defines: { ...ctx.defines },
    vertexShader: KOI_VS, fragmentShader: KOI_BODY_FS, toneMapped: false,
    transparent: true, blending: THREE.NoBlending, depthWrite: true,
  })
  const finMat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...W, ...koiUniforms }, defines: { ...ctx.defines, KOI_FINS: 1 },
    vertexShader: KOI_VS, fragmentShader: KOI_FIN_FS,
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
  // zone d'errance privilégiée : z −2,0 → −5,2 (le banc s'étire le long du bassin, la moitié du fond
  // reste aux nénuphars et aux explorateurs)
  const homeZ0 = clamp(-5.2, P.z0 + 0.35, P.z1 - 0.35), homeZ1 = clamp(-2.0, P.z0 + 0.35, P.z1 - 0.3)
  const fish = []
  for (let i = 0; i < N; i++) {
    const [type, fs] = ROBES[i % ROBES.length]
    const L = 0.24 + 0.08 * rng()           // 24 à 32 cm : ≈ 1/6 de la largeur du bassin
    const m = (0.47 + 0.3 * fs) * L + 0.02 // marge centre → mur : le corps + la queue ne touchent jamais
    const explorer = i % 4 === 3            // 2 sur 8 parcourent tout le bassin
    let x, z, ok, tries = 0
    do {
      x = cx + (rng() * 2 - 1) * Math.max(0.01, hx - m)
      z = explorer ? cz + (rng() * 2 - 1) * Math.max(0.01, hz - m) : homeZ0 + (homeZ1 - homeZ0) * rng()
      z = clamp(z, cz - hz + m, cz + hz - m)
      ok = fish.every((f) => Math.hypot(f.x - x, f.z - z) > 0.42)
    } while (!ok && ++tries < 80)
    fish.push({
      x, z, y: P.waterY - (0.08 + 0.14 * rng()), vy: 0, th: rng() * TAU, om: 0, v: 0.06, vT: 0.06 + 0.06 * rng(), acc: 0,
      ph: rng() * TAU, amp: 0.05, curv: 0, fph: rng() * TAU, finAmp: 0.3, fold: 0.4,
      L, m, fs, yMax: P.waterY - 0.2 * L - 0.012, timer: rng() * 4, yT: P.waterY - (0.08 + 0.14 * rng()),
      w1: 0.13 + 0.12 * rng(), w2: 0.31 + 0.2 * rng(), seed: rng() * 100, orbit: rng() < 0.5 ? -1 : 1,
      delay: 0, kiss: 0.5 + rng() * 2, dist: 9, explorer, hx: x, hz: z, homeT: rng() * 8,
      slot: i, orbitR: 0.2, layerY: P.waterY - 0.1, gd: 0, gathering: 0,
      fleeT: 0, fleeDur: 1, fleeK: 0, fleeX: 0, fleeZ: 0, panic: 0,
    })
    look.setXYZW(i, type, rng() * 10, fs, 0)
  }
  const gather = { x: 0, z: 0, time: 0, elapsed: 0 }
  let activity = 1
  const euler = new THREE.Euler(), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), mat = new THREE.Matrix4()

  // colonne vertébrale en 2 segments (nez → milieu → bout de la caudale), arc de virage compris
  const SP = new Float32Array(N * 6)
  const SPX = [0.45, 0.0, -0.66]
  function spine(f, i) {
    const c = Math.cos(f.th), s = Math.sin(f.th), k = f.curv
    for (let j = 0; j < 3; j++) {
      const ss = -SPX[j]
      let bx, bz
      if (Math.abs(k) > 1e-3) { bx = -Math.sin(k * ss) / k; bz = (1 - Math.cos(k * ss)) / k } else { bx = -ss; bz = 0.5 * k * ss * ss }
      SP[i * 6 + j * 2] = f.x + f.L * (bx * c - bz * s)
      SP[i * 6 + j * 2 + 1] = f.z + f.L * (bx * s + bz * c)
    }
  }
  const dir = { x: 0, z: 0 }, best = { x: 0, z: 0 }
  // Séparation dure après intégration : aucun corps ne traverse un autre (même pendant les rassemblements).
  // Critère 1 : centres à moins de 0,55·(Li+Lj)/2 ; critère 2 : capsules nez→queue (rayon 0,115 L).
  // Seulement pour des koï à moins de 8 cm l'un de l'autre en profondeur (fondu jusqu'à 14 cm).
  let minGap = Infinity // diagnostic : plus petit écart restant (m) entre capsules à la même profondeur
  function separate(n) {
    for (let i = 0; i < n; i++) spine(fish[i], i)
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = fish[i], b = fish[j]
        const ady = Math.abs(a.y - b.y)
        if (ady >= 0.14) continue
        const wy = ady < 0.08 ? 1 : 1 - (ady - 0.08) / 0.06
        let pen = 0, nx = 0, nz = 0
        const ddx = a.x - b.x, ddz = a.z - b.z, dc = Math.hypot(ddx, ddz) + 1e-6
        const Rc = 0.55 * (a.L + b.L) / 2
        if (dc < Rc) { pen = Rc - dc; nx = ddx / dc; nz = ddz / dc }
        const rr = 0.115 * (a.L + b.L)
        let dmin = Infinity
        for (let sa = 0; sa < 2; sa++) for (let sb = 0; sb < 2; sb++) {
          const ia = i * 6 + sa * 2, ib = j * 6 + sb * 2
          const d = segSegDist(SP[ia], SP[ia + 1], SP[ia + 2], SP[ia + 3], SP[ib], SP[ib + 1], SP[ib + 2], SP[ib + 3], dir)
          if (d < dmin) { dmin = d; best.x = dir.x; best.z = dir.z }
        }
        if (dmin < rr && rr - dmin > pen) { pen = rr - dmin; nx = best.x; nz = best.z }
        if (pen <= 0) continue
        const push = 0.5 * pen * wy + 1e-4
        a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push
        // amortit la vitesse d'approche (chacun freine s'il avance vers l'autre)
        const va = Math.cos(a.th) * nx + Math.sin(a.th) * nz
        if (va < 0) a.v *= 1 - Math.min(0.5, -va * 0.6 * wy)
        const vb = -(Math.cos(b.th) * nx + Math.sin(b.th) * nz)
        if (vb < 0) b.v *= 1 - Math.min(0.5, -vb * 0.6 * wy)
        spine(a, i); spine(b, j)
      }
      // les parois restent absolues
      for (let i = 0; i < n; i++) {
        const f = fish[i], rx = f.x - cx, rz = f.z - cz
        const hxF = Math.max(0.01, hx - f.m), hzF = Math.max(0.01, hz - f.m)
        if (rx > hxF) f.x = cx + hxF; else if (rx < -hxF) f.x = cx - hxF
        if (rz > hzF) f.z = cz + hzF; else if (rz < -hzF) f.z = cz - hzF
        spine(f, i)
      }
    }
    // diagnostic (sans allocation) : écart minimal restant entre capsules à moins de 8 cm en profondeur
    minGap = Infinity
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(fish[i].y - fish[j].y) >= 0.08) continue
      for (let sa = 0; sa < 2; sa++) for (let sb = 0; sb < 2; sb++) {
        const ia = i * 6 + sa * 2, ib = j * 6 + sb * 2
        const d = segSegDist(SP[ia], SP[ia + 1], SP[ia + 2], SP[ia + 3], SP[ib], SP[ib + 1], SP[ib + 2], SP[ib + 3], dir) - 0.115 * (fish[i].L + fish[j].L)
        if (d < minGap) minGap = d
      }
    }
  }

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
        if (r < 0.14) { f.vT = 0.17 + 0.06 * ctx.rnd(); f.timer = 0.9 + 0.8 * ctx.rnd() }
        else if (r < 0.34) { f.vT = 0.02 + 0.025 * ctx.rnd(); f.timer = 2.5 + 3 * ctx.rnd() }
        else { f.vT = 0.055 + 0.065 * ctx.rnd(); f.timer = 3 + 5 * ctx.rnd() }
        f.yT = P.waterY - (0.07 + 0.17 * ctx.rnd())
      }
      const hxI = Math.max(0.01, hx - f.m), hzI = Math.max(0.01, hz - f.m)
      // point d'attache : change de temps en temps (zone d'errance, sauf les explorateurs)
      f.homeT -= dt
      if (f.homeT <= 0) {
        f.homeT = 6 + 10 * ctx.rnd()
        f.hx = cx + (ctx.rnd() * 2 - 1) * hxI * 0.85
        f.hz = f.explorer ? cz + (ctx.rnd() * 2 - 1) * hzI : homeZ0 + (homeZ1 - homeZ0) * ctx.rnd()
      }
      // direction souhaitée = cap + errance + attache + bords + voisins (+ rassemblement)
      let dx = c, dz = s
      const w = 0.55 * Math.sin(t * f.w1 + f.seed) + 0.35 * Math.sin(t * f.w2 + f.seed * 2.3)
      dx += -s * w; dz += c * w
      const hdx = f.hx - f.x, hdz = f.hz - f.z, hd = Math.hypot(hdx, hdz) + 1e-4
      const hw = (f.explorer ? 0.15 : 0.45) * clamp((hd - 0.3) / 0.9, 0, 1)
      dx += (hdx / hd) * hw; dz += (hdz / hd) * hw
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
        const R = 0.2 + 0.4 * (f.L + g.L)
        const dy = f.y - g.y
        if (d2 < R * R && Math.abs(dy) < 0.14) {
          const d = Math.sqrt(d2) + 1e-4, k = 1 - d / R
          dx += (ddx / d) * k * 3.2; dz += (ddz / d) * k * 3.2
          // ils se croisent à des profondeurs différentes (le plus haut monte, l'autre plonge)
          sepY += (dy > 0 || (dy === 0 && i < j) ? 1 : -1) * k * 0.09
          if (-(ddx * c + ddz * s) > 0.3 * d) brake = Math.max(brake, k)
        }
      }
      // banc : légère cohésion/alignement
      if (nb) { dx += (ax / nb) * 0.25 + (mx / nb - f.x) * 0.1; dz += (az / nb) * 0.25 + (mz / nb - f.z) * 0.1 }
      let vTarget = f.vT, yTarget = f.yT, gathering = 0
      // fuite (koi.flee) : départ en C, sprint à l'opposé de la menace, puis retour au calme ; prime sur le
      // rassemblement (qui continue de décompter et reprend ensuite)
      let panic = 0
      if (f.fleeT > 0) {
        f.fleeT -= dt
        const u = 1 - clamp(f.fleeT / f.fleeDur, 0, 1)
        panic = f.fleeK * (1 - u * u * (3 - 2 * u))
        const ex = f.x - f.fleeX, ez = f.z - f.fleeZ, ed = Math.hypot(ex, ez) + 1e-4
        // près d'un mur, la fuite longe le mur au lieu de s'y écraser
        const away = (2.2 + 7 * panic) * (1 - 0.55 * urg)
        dx += (ex / ed) * away; dz += (ez / ed) * away
        vTarget = Math.max(vTarget, 0.08 + 0.62 * panic)
        yTarget = f.yT - 0.09 * panic
      }
      f.panic = panic
      if (panic < 0.05 && gather.time > 0 && gather.elapsed > f.delay) {
        // chacun son orbite (0,18 + 0,07·k) et sa profondeur : le cercle autour du splash n'empile jamais
        const tx = gather.x - f.x, tz = gather.z - f.z, d = Math.hypot(tx, tz) + 1e-4
        const pull = clamp((d - f.orbitR) * 4, -2, 3)
        dx += (tx / d) * pull - (tz / d) * 0.7 * f.orbit
        dz += (tz / d) * pull + (tx / d) * 0.7 * f.orbit
        vTarget = d > f.orbitR + 0.3 ? 0.16 : 0.04 + 0.02 * Math.sin(t * 1.3 + i)
        yTarget = f.layerY
        gathering = 1
        f.dist = d
      }
      // virage doux, vitesse angulaire limitée (plus vive près d'un mur)
      let da = Math.atan2(dz, dx) - f.th
      da = Math.atan2(Math.sin(da), Math.cos(da))
      const omMax = 0.75 + urg * 1.6 + gathering * 0.6 + panic * 5.5
      f.om += (clamp(da * (1.5 + panic * 4), -omMax, omMax) - f.om) * Math.min(1, dt * (2.2 + urg * 3 + panic * 14))
      f.th += f.om * dt
      if (f.th > Math.PI) f.th -= TAU; else if (f.th < -Math.PI) f.th += TAU
      const vT = vTarget * (1 - Math.min(0.5, Math.abs(f.om) * 0.22) * (1 - panic)) * (1 - 0.7 * brake * (1 - panic)) * Math.max(activity, Math.min(1, panic * 3))
      f.acc = vT - f.v
      f.v += f.acc * Math.min(1, dt * (f.acc > 0 ? 1.1 + panic * 12 : 0.6 + panic * 0.6))
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
      f.gathering = gathering
    }
    separate(n)
    for (let i = 0; i < n; i++) {
      const f = fish[i]
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
      if (f.gathering && f.dist < f.orbitR + 0.2 && f.y > f.yMax - 0.03) {
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
    /** Diagnostic : écart minimal (m) entre capsules de koï à la même profondeur après la dernière image. */
    minGap: () => minGap,
    /** Les koï convergent vers un point (repère jardin) et tournent autour pendant `seconds`. */
    gather(point, seconds = 6) {
      const inset = 0.22
      gather.x = clamp(point.x, P.x0 + inset, P.x1 - inset)
      gather.z = clamp(point.z, P.z0 + inset, P.z1 - inset)
      gather.time = seconds; gather.elapsed = 0
      // rang de chaque koï selon sa distance au point : orbite et profondeur propres (sans allocation)
      for (const f of fish) f.gd = Math.hypot(f.x - gather.x, f.z - gather.z)
      fish.forEach((f, i) => {
        let k = 0
        for (let j = 0; j < fish.length; j++) { const g = fish[j]; if (g.gd < f.gd || (g.gd === f.gd && j < i)) k++ }
        f.slot = k
        f.orbitR = 0.18 + 0.07 * k
        f.layerY = clamp(P.waterY - 0.065 - 0.034 * k, yMin, f.yMax)
        f.delay = 0.15 + f.gd * 0.3 + ctx.rnd() * 0.4
        f.kiss = 0.4 + ctx.rnd() * 1.5
      })
    },
    /** Multiplicateur de vitesse global (1 = normal). */
    setActivity(k) { activity = clamp(k, 0, 2) },
    /**
     * Les koï à moins de `radius` m du point (repère jardin ; Vector3, {x, z} ou [x, z] / [x, y, z]) détalent :
     * virage en C, sprint (≤ 0,7 m/s) à l'opposé, petite plongée, puis retour au calme en `seconds` s et
     * reprise du comportement normal. Prime sur gather() le temps de la fuite (le rassemblement continue
     * de décompter et reprend ensuite). Appel répété (glissé) : la menace se met à jour, la panique ne fait
     * que monter. Renvoie le nombre de koï effrayés.
     */
    flee(point, radius = 1.2, seconds = 2.5) {
      if (!point) return 0
      const px = Array.isArray(point) ? point[0] : point.x
      const pz = Array.isArray(point) ? point[point.length >= 3 ? 2 : 1] : point.z
      if (!(px === px) || !(pz === pz)) return 0
      const R = Math.max(radius || 0, 0.05), dur = Math.max(seconds || 0, 0.3)
      let n = 0
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i]
        const d = Math.hypot(f.x - px, f.z - pz) - 0.35 * f.L
        if (d > R) continue
        const k = clamp(1.15 - Math.max(d, 0) / R, 0.25, 1)
        const cur = f.fleeT > 0 ? f.panic : 0
        f.fleeX = px; f.fleeZ = pz
        f.fleeK = Math.max(k, cur)
        f.fleeDur = dur; f.fleeT = dur
        n++
      }
      return n
    },
  }
}

// ---------------------------------------------------------------------------------------------
// 4) Nénuphars : radeaux denses qui se chevauchent — 1 draw call instancié (InstancedBufferGeometry)
// ---------------------------------------------------------------------------------------------
function layoutPads(P, Q, rng) {
  const pads = []
  const inPool = (x, z, r) => x - r > P.x0 + 0.015 && x + r < P.x1 - 0.015 && z - r > P.z0 + 0.015 && z + r < P.z1 - 0.015
  const nSingles = Q.pads >= 26 ? 4 : 3
  const nRaft = Q.pads - nSingles
  const rafts = [
    { x: -0.08, z: -3.9, rx: 0.6, rz: 0.36, n: Math.round(nRaft * 0.48) },
    { x: 0.12, z: -5.6, rx: 0.6, rz: 0.42, n: nRaft - Math.round(nRaft * 0.48) },
  ]
  for (const R of rafts) {
    let made = 0, tries = 0
    while (made < R.n && tries++ < 3000) {
      // densité plus forte au cœur du radeau
      const a = rng() * TAU, d = Math.pow(rng(), 0.75)
      const x = R.x + Math.cos(a) * d * R.rx, z = R.z + Math.sin(a) * d * R.rz
      const r = 0.08 + 0.1 * Math.pow(rng(), 0.9) * (1 - 0.35 * d)
      if (!inPool(x, z, r)) continue
      // chevauchements légers autorisés, mais jamais deux centres trop proches
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.66)) continue
      pads.push({ x, z, r }); made++
    }
  }
  const singles = [[0.5, -2.55, 0.11], [-0.52, -4.75, 0.13], [0.48, -6.0, 0.1], [-0.5, -2.95, 0.09]]
  for (let i = 0; i < nSingles; i++) {
    const [x, z, r] = singles[i]
    if (inPool(x, z, r) && !pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.9)) pads.push({ x, z, r })
  }
  // empilement : chaque feuille passe juste au-dessus de celles qu'elle chevauche (pas de z-fighting)
  pads.forEach((p, i) => {
    let y = 0.0004
    for (let j = 0; j < i; j++) { const q = pads[j]; if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r) y = Math.max(y, q.y + 0.0011) }
    p.y = Math.min(y, 0.007)
    p.rot = rng() * TAU; p.seed = rng(); p.tint = rng()
    p.up = 0.003 + 0.004 * rng()                         // relevé du bord 3-7 mm
    p.flip = rng() < 0.22 ? 0.01 + 0.012 * rng() : 0      // quelques bords nettement recourbés
    p.flipA = rng() * TAU
    p.aged = 0
  })
  // 2-3 feuilles vieillissantes : bord ocre jaune ou roussâtre
  const nAged = Math.min(pads.length, Q.pads >= 26 ? 3 : 2)
  for (let k = 0; k < nAged; k++) pads[Math.floor(rng() * pads.length)].aged = k % 2 ? 2 : 1
  return pads
}

function buildPadGeometry(seg = 20) {
  const notch = 12 * DEG // encoche en V étroite
  const rings = [0.5, 0.86, 1.0]
  const pos = [0, 0, 0], pad = [0, 0], idx = []
  for (const r of rings) {
    for (let k = 0; k <= seg; k++) {
      const a = notch / 2 + ((TAU - notch) * k) / seg
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); pad.push(r, a)
    }
  }
  const row = seg + 1
  for (let k = 0; k < seg; k++) idx.push(0, 1 + k + 1, 1 + k)
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let k = 0; k < seg; k++) {
      const a = 1 + ri * row + k, b = a + 1, c = a + row, d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aPad', new THREE.Float32BufferAttribute(pad, 2))
  geo.setIndex(idx)
  return geo
}

const PAD_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec2 aPad;   // rayon relatif, angle
attribute vec4 aI0;    // x, z, rayon (m), rotation
attribute vec4 aI1;    // graine, décalage y, relevé du bord (m), teinte
attribute vec4 aI2;    // recourbement (m), angle du recourbement, vieillissement (0, 1 ocre, 2 roux), -
varying vec2 vLoc;
varying vec3 vW;
varying vec3 vN;
varying vec4 vInfo;    // rayon (m), graine, teinte, recourbement
varying float vRot;
varying float vAged;
void main() {
  float rr = aPad.x, ang = aPad.y;
  float seed = aI1.x;
  // contour irrégulier (±6 %)
  float rn = 1.0 + 0.06 * (0.55 * sin(ang * 3.0 + seed * 6.1) + 0.3 * sin(ang * 7.0 + seed * 13.7) + 0.15 * sin(ang * 13.0 + seed * 3.3)) * smoothstep(0.4, 1.0, rr);
  float R = aI0.z * rn;
  // bord relevé (3-7 mm, ondulé) + quelques bords recourbés
  float s = clamp((rr - 0.86) / 0.14, 0.0, 1.0);
  float sm = s * s * (3.0 - 2.0 * s);
  float dsm = 6.0 * s * (1.0 - s) / 0.14;
  float flip = pow(max(cos(ang - aI2.y), 0.0), 2.0) * aI2.x;
  float amp = aI1.z * (1.0 + 0.35 * sin(ang * 4.0 + seed * 9.0)) + flip;
  float up = amp * sm;
  // dérive lente en lacet
  float sw = 0.05 * sin(uTime * 0.21 + seed * 6.2832) + 0.03 * sin(uTime * 0.47 + seed * 17.0);
  float rot = aI0.w + sw;
  float wa = ang + rot;
  vec2 dir = vec2(cos(wa), sin(wa));
  vec3 o = vec3(aI0.x, uPoolW.x, aI0.y);
  // sillage : la feuille (rigide) monte, descend et bascule avec la pente de l'eau sous son centre
  vec4 wk = wakeField(o.xz, vec2(0.0));
  vec2 lp = dir * rr * R;
  vec3 w = vec3(aI0.x + lp.x, uPoolW.x + aI1.y + up + swell(o.xz).x * 0.9 + ripples(o, vec2(0.0)).x + wk.x + dot(wk.yz, lp) * 0.8, aI0.y + lp.y);
  float dhdr = amp * dsm / max(R, 1e-3);
  vN = normalize(vec3(-dhdr * dir.x - wk.y * 0.8, 1.0, -dhdr * dir.y - wk.z * 0.8));
  vW = w;
  vLoc = vec2(cos(ang), sin(ang)) * rr;
  vRot = rot;
  vInfo = vec4(R, seed, aI1.w, clamp(aI2.x / 0.02, 0.0, 1.0));
  vAged = aI2.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`

const PAD_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_SURF}
${GLSL_WATER}
uniform vec3 uPadA;
uniform vec3 uPadB;
uniform vec3 uPadUnder;
uniform vec3 uAgeA;
uniform vec3 uAgeB;
varying vec2 vLoc;
varying vec3 vW;
varying vec3 vN;
varying vec4 vInfo;
varying float vRot;
varying float vAged;
void main() {
  float rr = length(vLoc);
  float ang = atan(vLoc.y, vLoc.x);
  float fwA = length(fwidth(vLoc)) / max(rr, 0.03);
  float fwr = fwidth(rr) + 1e-4;
  vec3 N = normalize(vN);
  float seed = vInfo.y;
  // nervures radiales à peine visibles (3-5 %), effacées quand elles deviennent sous-pixel
  float K = 11.0;
  float cK = cos(ang * K), sK = sin(ang * K);
  float vein = pow(abs(cK), 14.0);
  float dvein = -14.0 * pow(abs(cK), 13.0) * sign(cK) * sK * K;
  float aa = 1.0 - smoothstep(0.25, 0.7, fwA * K);
  float zone = smoothstep(0.05, 0.22, rr) * (1.0 - smoothstep(0.8, 0.93, rr)) * aa;
  float wa = ang + vRot;
  vec3 tg = vec3(-sin(wa), 0.0, cos(wa));
  N = normalize(N + tg * dvein * 0.0009 / max(rr, 0.12) * zone);
  // couleur : vert sauge / gris-vert mat, variation douce + jitter par feuille (teinte et valeur ±8 %)
  float n = vnoise(vec3(vW.xz * 22.0, seed * 7.0)) * 0.6 + vnoise(vec3(vW.xz * 61.0, seed * 3.0)) * 0.4;
  vec3 alb = mix(uPadA, uPadB, clamp(0.15 + 0.5 * n + 0.45 * vInfo.z - 0.2, 0.0, 1.0));
  float hj = (fract(seed * 7.13) - 0.5) * 0.16;
  alb = mix(alb, hj > 0.0 ? alb * vec3(1.12, 1.04, 0.78) : alb * vec3(0.86, 0.98, 1.1), abs(hj) * 6.0);
  alb *= 1.0 + (fract(seed * 3.71) - 0.5) * 0.16;
  alb *= 1.0 + 0.04 * vein * zone;
  alb *= 0.9 + 0.1 * smoothstep(0.0, 0.45, rr);
  // feuilles vieillissantes : bord ocre jaune ou roussâtre, irrégulier
  if (vAged > 0.5) {
    // seulement un secteur du bord (jamais un liseré complet), frontière irrégulière
    float sect = smoothstep(0.4, 0.7, vnoise(vec3(vLoc * 1.8 + seed * 9.0, seed * 3.0)));
    float m = smoothstep(0.6, 0.95, rr + 0.16 * (vnoise(vec3(vLoc * 9.0, seed * 5.0)) - 0.5)) * sect;
    alb = mix(alb, vAged < 1.5 ? uAgeA : uAgeB, m * 0.75);
  }
  // bord mouillé plus sombre (2-3 mm)
  float rimW = 0.0026 / max(vInfo.x, 0.03);
  float wet = smoothstep(1.0 - rimW * 1.6 - fwr, 1.0 - rimW * 0.4, rr);
  alb *= 1.0 - 0.32 * wet;
  if (!gl_FrontFacing) { N = -N; alb = uPadUnder; }
  vec3 V = normalize(uCam - vW);
  float sv = sunVis(vW);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 col = alb * (uSkyZen * 0.42 + uSunCol * ndl * sv * 0.8);
  // cuticule : léger voile du ciel (fresnel 4-8 % de face, un peu plus en rasant) + brillance douce
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float fr = 0.045 + 0.2 * pow(1.0 - NdV, 5.0) + 0.1 * wet;
  vec3 R = reflect(-V, N); R.y = max(R.y, 0.02); R = normalize(R);
  vec3 env = envRefl(vW, R, 0.0, 2.0, 0.0);
  col = mix(col, env, fr);
  vec3 H = normalize(uSunDir + V);
  float s = pow(max(dot(N, H), 0.0), 90.0) * (0.12 + 0.2 * wet) * sv;
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb + linearToOutputTexel(vec4(uSunCol, 1.0)).rgb * min(s, 1.0), 1.0);
}
`

function createPads(ctx, pads) {
  const { U, W, colors } = ctx
  const geo = buildPadGeometry()
  const n = pads.length
  const i0 = new Float32Array(n * 4), i1 = new Float32Array(n * 4), i2 = new Float32Array(n * 4)
  pads.forEach((p, i) => {
    i0.set([p.x, p.z, p.r, p.rot], i * 4); i1.set([p.seed, p.y, p.up, p.tint], i * 4); i2.set([p.flip, p.flipA, p.aged, 0], i * 4)
  })
  geo.setAttribute('aI0', new THREE.InstancedBufferAttribute(i0, 4).setUsage(THREE.DynamicDrawUsage)) // poussées par le sillage
  geo.setAttribute('aI1', new THREE.InstancedBufferAttribute(i1, 4))
  geo.setAttribute('aI2', new THREE.InstancedBufferAttribute(i2, 4))
  geo.instanceCount = n
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U, ...W, uPadA: { value: colors.padA }, uPadB: { value: colors.padB }, uPadUnder: { value: colors.padUnder },
      uAgeA: { value: colors.ageA }, uAgeB: { value: colors.ageB },
    },
    defines: { ...ctx.defines },
    vertexShader: PAD_VS, fragmentShader: PAD_FS, toneMapped: false, side: THREE.DoubleSide,
    transparent: true, blending: THREE.NoBlending, depthWrite: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'MJ_LilyPads'
  return mesh
}

// ---------------------------------------------------------------------------------------------
// 5) Fleurs de nénuphar (posées dans l'encoche d'une feuille ou juste à côté, sans tige) + boutons
//    couchés à demi immergés — 1 draw call instancié.
//    3 couronnes (8/8/6) de pétales creusés, étamines dorées, anneau humide sombre au contact de l'eau.
// ---------------------------------------------------------------------------------------------
const FLOWER_RINGS = [ // n, longueur, largeur, rayon de départ, décalage angulaire
  [8, 0.08, 0.03, 0.011, 0.0],
  [8, 0.068, 0.026, 0.009, 0.39],
  [6, 0.05, 0.021, 0.006, 0.2],
]

function buildFlowerGeometry() {
  const pos = [], nrm = [], pet = [], uvl = [], idx = []
  // pétales : chacun dans son repère local (x le long, y normale/creux, z en travers), normales lisses
  FLOWER_RINGS.forEach(([n, len, wid, r0, off], ri) => {
    for (let p = 0; p < n; p++) {
      const az = (p / n) * TAU + off
      const NLs = 4, NA = 3
      const b = pos.length / 3
      const tmp = []
      for (let i = 0; i < NLs; i++) {
        const l = i / (NLs - 1)
        for (let j = 0; j < NA; j++) {
          const s = (j / (NA - 1)) * 2 - 1
          // largeur : ovale allongé à pointe effilée
          const half = wid * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, l * 0.86 + 0.14)), 0.7) * (1 - 0.3 * l * l)
          const x = l * len
          const z = s * half
          const y = s * s * wid * 0.42 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, l * 1.1))) - l * l * len * 0.05 // creux + pointe à peine retombée
          tmp.push([x, y, z])
          pet.push(ri, az, r0); uvl.push(l, s)
        }
      }
      // normales lisses calculées localement (différences finies sur la grille)
      for (let i = 0; i < NLs; i++) for (let j = 0; j < NA; j++) {
        const q = (ii, jj) => tmp[clamp(ii, 0, NLs - 1) * NA + clamp(jj, 0, NA - 1)]
        const a = q(i + 1, j), bq = q(i - 1, j), c = q(i, j + 1), d = q(i, j - 1)
        const tx = [a[0] - bq[0], a[1] - bq[1], a[2] - bq[2]], tz = [c[0] - d[0], c[1] - d[1], c[2] - d[2]]
        let nx = tz[1] * tx[2] - tz[2] * tx[1], ny = tz[2] * tx[0] - tz[0] * tx[2], nz = tz[0] * tx[1] - tz[1] * tx[0]
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz }
        const L = Math.hypot(nx, ny, nz) || 1
        const pt = tmp[i * NA + j]
        pos.push(pt[0], pt[1], pt[2]); nrm.push(nx / L, ny / L, nz / L)
      }
      for (let i = 0; i < NLs - 1; i++) for (let j = 0; j < NA - 1; j++) {
        const a = b + i * NA + j, bb = a + 1, c = a + NA, d = c + 1
        idx.push(a, bb, c, bb, d, c)
      }
    }
  })
  // étamines : couronne évasée (12 côtés) + cœur
  {
    const seg = 12, b = pos.length / 3
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU, c = Math.cos(a), s = Math.sin(a)
      pos.push(c * 0.007, 0.004, s * 0.007); nrm.push(c, 0.3, s); pet.push(-1, a, 0); uvl.push(0, k / seg)
      pos.push(c * 0.0125, 0.017, s * 0.0125); nrm.push(c, 0.3, s); pet.push(-1, a, 0); uvl.push(1, k / seg)
    }
    for (let k = 0; k < seg; k++) { const a = b + k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
    const cb = pos.length / 3
    pos.push(0, 0.012, 0); nrm.push(0, 1, 0); pet.push(-1.5, 0, 0); uvl.push(0, 0)
    for (let k = 0; k < seg; k++) { const a = (k / seg) * TAU; pos.push(Math.cos(a) * 0.0068, 0.009, Math.sin(a) * 0.0068); nrm.push(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4); pet.push(-1.5, a, 0); uvl.push(1, 0) }
    for (let k = 0; k < seg; k++) idx.push(cb, cb + 1 + ((k + 1) % seg), cb + 1 + k)
  }
  // zone humide de contact : disque plan (éventail de 12), posé sur l'eau dans le shader
  {
    const seg = 12, b = pos.length / 3
    pos.push(0, 0, 0); nrm.push(0, 1, 0); pet.push(-3, 0, 0); uvl.push(0, 0)
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * TAU
      pos.push(Math.cos(a), 0, Math.sin(a)); nrm.push(0, 1, 0); pet.push(-3, a, 0); uvl.push(1, 0)
    }
    for (let k = 0; k < seg; k++) idx.push(b, b + 1 + ((k + 1) % seg), b + 1 + k)
  }
  // le disque est dessiné en premier (sous les pétales dans le même draw call)
  const ringStart = idx.length - 12 * 3
  const ordered = idx.slice(ringStart).concat(idx.slice(0, ringStart))
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setAttribute('aPet', new THREE.Float32BufferAttribute(pet, 3))
  geo.setAttribute('aUV', new THREE.Float32BufferAttribute(uvl, 2))
  geo.setIndex(ordered)
  return geo
}

const FLOWER_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec3 aPet;   // couronne (0..2 pétales, -1 étamines, -1.5 cœur, -3 anneau humide), azimut, rayon de départ
attribute vec2 aUV;    // l (le long), s (en travers)
attribute vec4 aF0;    // x, z, échelle, rotation
attribute vec4 aF1;    // ouverture (0 bouton fermé .. 1), inclinaison (bouton couché), graine, hauteur de la base
varying vec4 vP;       // partie, couronne, l, s
varying vec3 vN;
varying vec3 vW;
varying vec2 vF;       // ouverture, graine
vec3 rotYv(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
vec3 rotZv(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
float h11(float x) { return fract(sin(x * 91.17) * 43758.55); }
void main() {
  float open = aF1.x;
  float seed = aF1.z;
  float sc = aF0.z;
  vec3 p = position;
  vec3 n = normal;
  float part = aPet.x < -2.0 ? 3.0 : (aPet.x < -0.5 ? 1.0 : 0.0);
  float ring = max(aPet.x, 0.0);
  vec3 o = vec3(aF0.x, uPoolW.x, aF0.y);
  float bob = swell(o.xz).x * 0.9 + ripples(o, vec2(0.0)).x + wakeField(o.xz, vec2(0.0)).x;
  vec3 w;
  if (part > 2.5) {
    // zone humide : sur l'eau, sous la fleur (rayon ≈ pointe des pétales extérieurs + 1 cm) ;
    // pour un bouton couché, centrée sur le corps du bouton
    float R = open > 0.3 ? 0.072 * sc * open + 0.012 : 0.026 * sc + 0.01;
    vec2 c = aF0.xy + vec2(cos(aF0.w), sin(aF0.w)) * sin(aF1.y) * 0.03 * sc;
    w = vec3(c.x + p.x * R, uPoolW.x + 0.0006 + bob, c.y + p.z * R);
    n = vec3(0.0, 1.0, 0.0);
  } else {
    if (part < 0.5) {
      // pétales : élévation selon la couronne et l'ouverture (bouton : presque verticaux) ;
      // la couronne extérieure s'incline jusqu'à toucher l'eau ; jitter par pétale (longueur, élévation)
      float hp = h11(aPet.y * 7.3 + seed * 13.1 + ring);
      float eOpen = ring < 0.5 ? -0.04 : (ring < 1.5 ? 0.62 : 1.1);   // fleur en coupe : cœur relevé
      float eClosed = ring < 0.5 ? 1.32 : (ring < 1.5 ? 1.42 : 1.5);
      float e = mix(eClosed, eOpen, open) + (hp - 0.5) * 0.16;
      p.x *= 0.9 + 0.2 * h11(hp * 31.7 + seed);
      float ce = cos(e), se = sin(e);
      p = vec3(p.x * ce - p.y * se, p.x * se + p.y * ce, p.z);
      n = vec3(n.x * ce - n.y * se, n.x * se + n.y * ce, n.z);
      p.x += aPet.z;
      p = rotYv(p, aPet.y + (hp - 0.5) * 0.12); n = rotYv(n, aPet.y + (hp - 0.5) * 0.12);
      p.y += 0.004;
    } else {
      p.y *= mix(0.35, 1.0, open);
    }
    // bouton couché sur l'eau (inclinaison autour d'un axe horizontal)
    p = rotZv(p, -aF1.y); n = rotZv(n, -aF1.y);
    p = rotYv(p * sc, aF0.w);
    n = rotYv(n, aF0.w);
    w = vec3(aF0.x, uPoolW.x + aF1.w + bob, aF0.y) + p;
  }
  vP = vec4(part, aPet.x, aUV.x, aUV.y);
  vN = normalize(n);
  vW = w;
  vF = vec2(open, seed);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
}
`

const FLOWER_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
uniform vec3 uScatter;
uniform vec3 uPetalBase;
uniform vec3 uPetalTip;
varying vec4 vP;
varying vec3 vN;
varying vec3 vW;
varying vec2 vF;
void main() {
  float part = vP.x;
  if (part > 2.5) {
    // zone humide sombre au contact des pétales et de l'eau, bord très doux (jamais un liseré)
    float r = vP.z;  // 0 au centre → 1 au bord (interpolé)
    float a = (1.0 - smoothstep(0.45, 1.0, r)) * 0.42;
    gl_FragColor = vec4(linearToOutputTexel(vec4(uScatter * 0.35, 1.0)).rgb, a);
    return;
  }
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  vec3 alb;
  float trans = 0.5;
  if (part < 0.5) {
    float l = vP.z, s = vP.w, ring = max(vP.y, 0.0);
    // dégradé blanc rosé (base #F6EEF0) → rose (pointe #E58BB4), plus pâle au cœur de la fleur
    alb = mix(uPetalBase, uPetalTip, smoothstep(0.18, 1.0, l) * (1.0 - 0.25 * ring) * (0.85 + 0.3 * fract(vF.y * 9.7)));
    alb *= 0.95 + 0.05 * (1.0 - abs(s));                                    // nervure médiane
    alb *= 1.0 - 0.035 * pow(abs(sin(s * 7.0 + l * 2.0)), 6.0);             // fines nervures
    // bouton : sépales verts à l'extérieur de la 1re couronne
    if (!gl_FrontFacing && ring < 0.5) alb = mix(alb, s2l(vec3(0.42, 0.50, 0.32)), (1.0 - vF.x) * (1.0 - smoothstep(0.5, 0.95, l)));
  } else {
    float l = vP.z;
    // étamines dorées : filaments + anthères plus claires
    float fil = 0.75 + 0.25 * smoothstep(0.2, 0.0, abs(fract(vP.w * 18.0) - 0.5));
    alb = mix(s2l(vec3(0.86, 0.6, 0.16)), s2l(vec3(0.98, 0.82, 0.32)), smoothstep(0.5, 1.0, l)) * fil;
    if (vP.y < -1.25) alb = s2l(vec3(0.80, 0.72, 0.30)); // cœur (pistil)
    trans = 0.2;
  }
  float sv = sunVis(vW);
  float ndl = max(dot(N, uSunDir), 0.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0) * trans;     // pétales translucides à contre-jour
  vec3 col = alb * (uSkyZen * 0.45 + uSunCol * (ndl * 0.8 + back + 0.14) * sv);
  vec3 H = normalize(uSunDir + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), 40.0) * 0.04 * sv;
  // partie immergée (bouton à demi couché, pointes qui trempent) : se fond dans l'eau
  float a = 1.0;
  float d = uPoolW.x - vW.y;
  if (d > 0.0) {
    col = mix(col * vec3(0.55, 0.75, 0.85), uScatter, 1.0 - exp(-d * 30.0));
    a = exp(-d * 40.0);
    if (a < 0.03) discard;
  }
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb, a);
}
`

function createFlowers(ctx, pads) {
  const { P, U, W, Q, rng, colors } = ctx
  // fleurs ouvertes : dans l'encoche d'une des plus grandes feuilles, ou juste à côté
  const hosts = [...pads].sort((a, b) => b.r - a.r).slice(0, Math.min(Q.flowers, pads.length))
  const items = hosts.map((p, k) => {
    const inNotch = k % 3 !== 2
    const a = inNotch ? p.rot : p.rot + Math.PI * (0.6 + 0.8 * rng())   // encoche : angle 0 de la feuille
    const d = inNotch ? p.r * 0.72 : p.r * 0.98 + 0.03
    return {
      x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, scale: 0.72 + 0.42 * rng(), rot: rng() * TAU,
      open: 0.6 + 0.4 * rng(), tilt: 0, seed: rng(), y: p.y + 0.005 + 0.01 * rng(), host: pads.indexOf(p),
    }
  })
  // boutons couchés, à demi immergés, au bord d'une feuille
  for (let i = 0; i < Q.buds; i++) {
    const p = pads[Math.floor(rng() * pads.length)]
    const a = rng() * TAU
    let x = p.x + Math.cos(a) * (p.r + 0.035), z = p.z + Math.sin(a) * (p.r + 0.035)
    x = clamp(x, P.x0 + 0.06, P.x1 - 0.06); z = clamp(z, P.z0 + 0.06, P.z1 - 0.06)
    items.push({ x, z, scale: 0.62 + 0.12 * rng(), rot: rng() * TAU, open: 0.05 + 0.06 * rng(), tilt: 1.2 + 0.25 * rng(), seed: rng(), y: -0.004, host: pads.indexOf(p) })
  }
  const geo = buildFlowerGeometry()
  const n = items.length
  const f0 = new Float32Array(n * 4), f1 = new Float32Array(n * 4)
  items.forEach((it, i) => { f0.set([it.x, it.z, it.scale, it.rot], i * 4); f1.set([it.open, it.tilt, it.seed, it.y], i * 4) })
  geo.setAttribute('aF0', new THREE.InstancedBufferAttribute(f0, 4).setUsage(THREE.DynamicDrawUsage)) // suit sa feuille poussée par le sillage
  geo.setAttribute('aF1', new THREE.InstancedBufferAttribute(f1, 4))
  geo.instanceCount = n
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uScatter: W.uScatter, uPetalBase: { value: colors.petalBase }, uPetalTip: { value: colors.petalTip } },
    defines: { ...ctx.defines },
    vertexShader: FLOWER_VS, fragmentShader: FLOWER_FS,
    side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'MJ_LilyFlowers'
  return { mesh, items }
}

// ---------------------------------------------------------------------------------------------
// 6) Fontaine — 1 draw call : colonne du jet (ruban face caméra, 1,0-1,4 cm à la buse, cœur lumineux),
//    couronne de filets qui retombent dans la coupe, voile CONTINU autour de toute la lèvre (épouse la
//    lèvre, petite parabole de 1-2 cm, se défait en fils et gouttes dans son tiers inférieur).
// ---------------------------------------------------------------------------------------------
const VEIL_COLS = 40
const VEIL_ROWS_T = [0, 0.07, 0.14, 0.24, 0.36, 0.5, 0.65, 0.82, 1.0]

const STREAM_VS = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aS;     // t (0..1 le long), côté (−1/+1, voile : 0), type (0 jet, 1 couronne, 2 voile), aléa
attribute float aA;    // angle (couronne, voile)
uniform vec4 uJet;     // y de la buse, hauteur actuelle du jet, vitesse horizontale et verticale de la couronne
uniform vec4 uVeilP;   // rayon de départ sur la lèvre, y de la lèvre, rayon d'enroulement, durée de chute
uniform float uVeilVout;
varying vec4 vS;       // t, côté, type, aléa
varying vec3 vP;
varying vec3 vNrm;
varying float vFade;
varying float vAng;
vec3 sideOf(vec3 p, vec3 tg) {
  vec3 s = cross(tg, normalize(uCam - p));
  float l = length(s);
  return l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
}
void main() {
  float kind = aS.z, t = aS.x, side = aS.y;
  float e = uEnergy;
  vec3 base = vec3(uFount.x, uJet.x, uFount.y);
  vec3 p, nrm;
  float fade;
  if (kind < 0.5) {
    // colonne : hauteur balistique y = H(2τ − τ²), sommets plus serrés vers l'apex où l'eau ralentit
    float H = uJet.y;
    float y = H * (2.0 * t - t * t);
    p = base + vec3(0.0, y, 0.0);
    float wob = (sin(y * 90.0 - uTime * 9.0) * 0.0007 + sin(y * 37.0 + uTime * 3.7) * 0.0005) * smoothstep(0.0, 0.5, t);
    p.x += wob; p.z += wob * 0.6;
    float W0 = 0.0125 * (0.82 + 0.18 * e);
    float w = W0 * (1.0 - 0.5 * t) * (1.0 + 0.8 * smoothstep(0.8, 1.0, t));
    vec3 sd = sideOf(p, vec3(0.0, 1.0, 0.0));
    p += sd * side * w * 0.5;
    nrm = normalize(uCam - p);
    fade = smoothstep(0.02, 0.12, e);
  } else if (kind < 1.5) {
    // couronne : chaque filet part de l'apex et retombe en parabole dans la coupe
    float rnd = aS.w;
    float ang = aA + 0.25 * sin(uTime * 0.7 + rnd * 19.0);
    float vh = uJet.z * (0.7 + 0.6 * rnd);
    float vy = uJet.w * (0.6 + 0.8 * fract(rnd * 7.31));
    float drop = uJet.y + uJet.x - uBowl.x;
    float T = (vy + sqrt(vy * vy + 19.62 * max(drop, 0.0))) / 9.81;
    float tau = t * T;
    vec2 dir = vec2(cos(ang), sin(ang));
    p = base + vec3(dir.x * (0.003 + vh * tau), uJet.y + vy * tau - 4.905 * tau * tau, dir.y * (0.003 + vh * tau));
    vec3 tg = normalize(vec3(dir.x * vh, vy - 9.81 * tau, dir.y * vh));
    float w = 0.0034 * (1.0 + 0.5 * (1.0 - t));
    p += sideOf(p, tg) * side * w * 0.5;
    nrm = normalize(uCam - p);
    fade = smoothstep(0.08, 0.3, e);
  } else {
    // voile : épouse l'arrondi de la lèvre (quart de cercle), puis chute libre légèrement évasée
    vec2 dir = vec2(cos(aA), sin(aA));
    float r0 = uVeilP.x, y0 = uVeilP.y, rho = uVeilP.z, Tf = uVeilP.w;
    float tc = 0.14;
    float r, y; vec2 tn;
    if (t < tc) {
      float ph = (t / tc) * 1.5708;
      r = r0 - rho + rho * sin(ph);
      y = y0 - rho + rho * cos(ph);
      tn = vec2(cos(ph), -sin(ph));
    } else {
      float tau = (t - tc) / (1.0 - tc) * Tf;
      r = r0 + uVeilVout * tau;
      y = y0 - rho - 0.12 * tau - 4.905 * tau * tau;
      tn = normalize(vec2(uVeilVout, -0.12 - 9.81 * tau));
    }
    // la nappe ondule doucement autour de la lèvre
    r += 0.0025 * sin(aA * 9.0 + uTime * 1.3) * smoothstep(0.2, 1.0, t);
    p = vec3(uFount.x + dir.x * r, y, uFount.y + dir.y * r);
    nrm = normalize(vec3(dir.x * -tn.y, tn.x, dir.y * -tn.y));
    fade = smoothstep(0.04, 0.35, e);
  }
  vS = aS; vP = p; vNrm = nrm; vFade = fade; vAng = aA;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`
const STREAM_FS = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
uniform vec4 uVeilP;
#ifdef PROBES
uniform samplerCube uProbe1;
vec3 envColor(vec3 R) { return textureLod(uProbe1, R, 2.0).rgb; }
#else
uniform vec3 uWallCol;
vec3 envColor(vec3 R) { return R.y > 0.05 ? mix(uSkyHor, uSkyZen, sqrt(R.y)) : uWallCol * 0.6; }
#endif
varying vec4 vS;
varying vec3 vP;
varying vec3 vNrm;
varying float vFade;
varying float vAng;
void main() {
  if (vFade < 0.003) discard;
  float sv = sunVis(vP);
  vec3 V = normalize(uCam - vP);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);       // contre-jour : l'eau s'illumine
  vec3 col; float a; float cov;
  if (vS.z < 1.5) {
    // jet et filets : tube d'eau, normale de cylindre dans le plan (côté, vue)
    float x = vS.y, t = vS.x;
    float nz = sqrt(max(1.0 - x * x, 0.0));
    vec3 sd = normalize(cross(vec3(0.0, 1.0, 0.0), V) + vec3(1e-5));
    vec3 N = normalize(sd * x + V * nz);
    float F = 0.02 + 0.98 * pow(1.0 - nz, 5.0);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 40.0);
    float core = exp(-x * x * 5.0);
    float edge = 1.0 - smoothstep(0.7, 1.0, abs(x));        // bords doux
    float keep = 1.0;
    if (vS.z < 0.5) {
      // sommet de la colonne : se défait en bouillon irrégulier
      float n = vnoise(vec3(x * 2.0 + 3.0, t * 24.0 - uTime * 11.0, 0.0)) * 0.6 + vnoise(vec3(x * 4.0, t * 60.0 - uTime * 21.0, 4.0)) * 0.4;
      keep = smoothstep(smoothstep(0.8, 1.0, t) * 0.8, smoothstep(0.8, 1.0, t) * 0.8 + 0.15, n) * (1.0 - smoothstep(0.96, 1.0, t));
    } else {
      // filets : continus en haut, se brisent en gouttes avant de toucher l'eau
      float n = vnoise(vec3(vS.w * 50.0, t * 14.0 - uTime * 9.0, 2.0));
      keep = mix(1.0, smoothstep(0.35, 0.6, n), smoothstep(0.45, 0.9, t)) * smoothstep(0.0, 0.08, t);
    }
    float flow = 0.8 + 0.2 * sin(t * 80.0 - uTime * 28.0 + x * 2.0);
    vec3 Rv = normalize(vec3(R.x, max(R.y, 0.12), R.z));
    // verre argenté : le ciel et les murs sur tout le diamètre, arêtes fresnel, cœur lumineux
    vec3 glass = mix(envColor(Rv), uSkyHor, 0.45) * (0.5 + 0.7 * F);
    col = glass + uSkyHor * core * 0.3
        + uSunCol * sv * (spec * 0.9 * flow + core * (0.25 + 0.9 * back) * flow);
    cov = edge * keep * vFade;
    a = (0.42 + 0.3 * core + 0.3 * F) * cov;
  } else {
    // voile : nappe mince et claire ; arêtes fresnel brillantes, mur bleu vu au travers
    float t = vS.x;
    vec2 q = vec2(cos(vAng), sin(vAng)) * uVeilP.x;          // position sur la lèvre (sans couture)
    float n1 = vnoise(vec3(q * 55.0, t * 4.0 - uTime * 2.6));
    float n2 = vnoise(vec3(q * 150.0, t * 9.0 - uTime * 4.2));
    float n3 = vnoise(vec3(q * 260.0, t * 30.0 - uTime * 13.0));
    float lower = smoothstep(0.55, 0.95, t);                  // tiers inférieur : fils et gouttes
    float thread = smoothstep(0.42, 0.72, n2 * 0.65 + n1 * 0.35);
    cov = mix(0.9 + 0.1 * n1, thread, lower);
    cov = max(cov * (1.0 - smoothstep(0.9, 1.0, t)), step(0.68, n3) * lower * (1.0 - smoothstep(0.97, 1.0, t)));
    cov *= smoothstep(0.0, 0.04, t) * vFade;
    // micro-ondulations horizontales qui descendent avec l'eau (normale perturbée)
    vec3 N = normalize(vNrm) * (gl_FrontFacing ? 1.0 : -1.0);
    N = normalize(N + vec3(0.0, (n2 - 0.5) * 0.5, 0.0));
    float NdV = abs(dot(N, V));
    float F = 0.03 + 0.97 * pow(1.0 - NdV, 4.0);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSunDir), 0.0), 60.0) * (0.4 + n1);
    vec3 Rv = normalize(vec3(R.x, max(R.y, 0.12), R.z));     // la nappe reflète murs et ciel, pas l'eau sombre
    col = (envColor(Rv) * 0.85 + uSkyHor * 0.3) * F
        + uSunCol * sv * (spec * 0.7 + back * 0.25 * (0.6 + 0.4 * n2));
    a = (0.035 + 0.45 * F) * cov;
  }
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb * cov, a);
}
`

function createStreams(ctx) {
  const { U, W, jet, rng } = ctx
  const S = [], A = [], idx = []
  // 0) colonne : ruban face caméra
  const nJ = 22
  for (let i = 0; i <= nJ; i++) for (const side of [-1, 1]) { S.push(i / nJ, side, 0, 0); A.push(0) }
  for (let i = 0; i < nJ; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  // 1) couronne : CROWN_ARCS filets
  const nA = 7
  for (let k = 0; k < CROWN_ARCS; k++) {
    const b = S.length / 4, r = rng(), ang = (k / CROWN_ARCS) * TAU + (rng() - 0.5) * 0.5
    for (let i = 0; i <= nA; i++) for (const side of [-1, 1]) { S.push(i / nA, side, 1, r); A.push(ang) }
    for (let i = 0; i < nA; i++) { const a = b + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  // 2) voile continu : VEIL_COLS colonnes tout autour (la dernière recouvre la première, sans couture)
  {
    const b = S.length / 4, cols = VEIL_COLS + 1, rows = VEIL_ROWS_T.length
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { S.push(VEIL_ROWS_T[j], 0, 2, 0); A.push((i / VEIL_COLS) * TAU) }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = b + j * cols + i, bb = a + 1, c = a + cols, d = c + 1
      idx.push(a, c, bb, bb, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(A.length * 3), 3)) // calculée dans le shader
  geo.setAttribute('aS', new THREE.Float32BufferAttribute(S, 4))
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(A, 1))
  geo.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uProbe1: W.uProbe1, uWallCol: W.uWallCol, uJet: jet.uJet, uVeilP: jet.uVeilP, uVeilVout: { value: jet.veilVout } },
    defines: { ...ctx.defines },
    vertexShader: STREAM_VS, fragmentShader: STREAM_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'MJ_FountainStreams'
  return mesh
}

// ---------------------------------------------------------------------------------------------
// 7) Gouttelettes (paramétriques, 100 % GPU) — 1 draw call : bouquet serré autour de l'apex du jet,
//    rebonds au pied du voile et dans la coupe, gerbe du splash()
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
uniform vec4 uJet;      // y buse, hauteur du jet, vitesses de la couronne
varying float vA;
void main() {
  float e = uEnergy;
  float k = sqrt(max(e, 1e-4));
  vec3 p = vec3(0.0);
  float a = 0.0;
  float size = uSize;
  if (aKind < 0.5) {                     // apex : gouttes qui se détachent du bouquet et retombent
    float life = 0.3 + 0.4 * aSeed.w;
    float age = fract(uTime / life + aSeed.x) * life;
    float ang = aSeed.y * 6.2832;
    float sp = (0.02 + 0.3 * aSeed.z * aSeed.z) * e;
    vec3 v = vec3(cos(ang) * sp, (0.02 + 0.32 * aSeed.w) * e, sin(ang) * sp);
    p = vec3(uFount.x, uJet.x + uJet.y * (0.93 + 0.06 * aSeed.z), uFount.y) + v * age;
    p.y -= 4.905 * age * age;
    a = step(uBowl.x, p.y) * smoothstep(0.03, 0.15, e);
    size *= 0.8 + 0.5 * aSeed.z;
  } else if (aKind < 1.5) {              // rebonds au pied du voile, tout autour du bassin
    float ang = aSeed.y * 6.2832;
    float life = 0.24 + 0.2 * aSeed.w;
    float age = fract(uTime / life + aSeed.x) * life;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec3 v = vec3(dir.x * (0.03 + 0.06 * aSeed.z), 0.22 + 0.3 * fract(aSeed.w * 7.3), dir.y * (0.03 + 0.06 * aSeed.z));
    p = vec3(uFount.x + dir.x * uBowl.w, uFount.w, uFount.y + dir.y * uBowl.w) + v * age;
    p.y -= 4.905 * age * age;
    a = step(uFount.w, p.y) * smoothstep(0.08, 0.4, e);
    size *= 0.7;
  } else if (aKind < 2.5) {              // rebonds dans la coupe, là où retombent les filets
    float life = 0.2 + 0.16 * aSeed.w;
    float age = fract(uTime / life + aSeed.x) * life;
    float ang = aSeed.y * 6.2832;
    float r = uBowl.z + (aSeed.z - 0.5) * 0.03;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec3 v = vec3(dir.x * 0.05, 0.18 + 0.2 * aSeed.w, dir.y * 0.05) * k;
    p = vec3(uFount.x + dir.x * r, uBowl.x, uFount.y + dir.y * r) + v * age;
    p.y -= 4.905 * age * age;
    a = step(uBowl.x, p.y) * smoothstep(0.05, 0.3, e);
    size *= 0.65;
  } else {                               // gerbe du splash()
    float age = uTime - uBurst.w;
    float ang = aSeed.x * 6.2832;
    float sp = (0.1 + 0.35 * aSeed.y) * uBurstK;
    vec3 v = vec3(cos(ang) * sp, (0.55 + 0.8 * aSeed.z) * uBurstK, sin(ang) * sp);
    p = uBurst.xyz + v * age;
    p.y -= 4.905 * age * age;
    a = step(0.0, age) * step(age, 1.4) * step(uBurst.y - 0.004, p.y) * step(aSeed.w, 0.35 + 0.65 * uBurstK);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.75 + 1.3 * pow(0.5 + 0.5 * sin(uTime * (9.0 + 14.0 * aSeed.w) + aSeed.x * 61.0), 8.0);
  vA = a * tw;
  // taille en unités monde (même esprit que worldSizedPoints de lib/ysl/effects.js), 2 px minimum
  gl_PointSize = a > 0.0 ? clamp(size * uWorldScale * projectionMatrix[1][1] * uPx / max(-mv.z, 0.01), 2.0, 6.0) : 0.0;
}
`
const DROP_FS = /* glsl */ `
uniform vec3 uDropCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  float f = exp(-d2 * 5.0) + 0.08 * exp(-d2 * 1.5);
  float a = min(f * vA * 1.1, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uDropCol * a, a * 0.8);
}
`

function createDroplets(ctx) {
  const { U, Q, rng, jet } = ctx
  const counts = [64, 28, 18, 30].map((c, i) => (i === 3 ? c : Math.round(c * Q.drops)))
  const total = counts.reduce((a, b) => a + b, 0)
  const seeds = new Float32Array(total * 4), kinds = new Float32Array(total)
  let n = 0
  counts.forEach((c, kind) => { for (let i = 0; i < c; i++, n++) { for (let j = 0; j < 4; j++) seeds[n * 4 + j] = rng(); kinds[n] = kind } })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1))
  const extra = {
    uSize: { value: 0.0055 }, uPx: { value: 800 }, uWorldScale: { value: 1 },
    uBurst: { value: new THREE.Vector4(0, -10, 0, -100) }, uBurstK: { value: 1 },
    uJet: jet.uJet,
    uDropCol: { value: new THREE.Color(1.0, 0.94, 0.82) },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...extra }, defines: { ...ctx.defines }, vertexShader: DROP_VS, fragmentShader: DROP_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true, toneMapped: false,
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
  return { points, extra, count: total }
}

// ---------------------------------------------------------------------------------------------
// 8) Bractées de bougainvillier (40 × 32 mm, papier translucide, bord #D0287A) : simples ou en triades
//    (3 bractées soudées à la base) ; tombent en virevoltant, flottent, dérivent vers les bords et les
//    coins où elles s'accumulent, puis coulent — 1 draw call, 8 triangles par bractée
// ---------------------------------------------------------------------------------------------
const BRACT_HL = 0.02, BRACT_HW = 0.016 // demi-longueur / demi-largeur

function buildBractGeometry() {
  // grille 3×3 incurvée (bractée légèrement creusée), contour en cœur découpé dans le shader
  const pos = [], idx = []
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    pos.push(i * BRACT_HL, 0.0032 * (0.55 * i * i + j * j) - 0.0007 * i, j * BRACT_HW)
  }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

const PETAL_VS = /* glsl */ `
attribute vec2 aState;   // teinte (0..1), immersion (0 flotte .. 1 coulée)
varying vec3 vN;
varying vec3 vW;
varying vec2 vL;
varying vec2 vState;
void main() {
  vec4 w = instanceMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal);
  vL = vec2(position.x / ${BRACT_HL}, position.z / ${BRACT_HW});
  vState = aState;
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`
const PETAL_FS = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uBloomEdge;
uniform vec3 uBloomPale;
uniform vec3 uBloomDeep;
uniform vec3 uScatter;
varying vec3 vN;
varying vec3 vW;
varying vec2 vL;
varying vec2 vState;
// bractée en cœur arrondi : base échancrée en x = -1, pointe arrondie en x = +1
float bractShape(vec2 p) {
  p.y = abs(p.y);
  float x = p.x;
  float hw = 0.95 * sqrt(max(0.0, 1.0 - x * x)) * (1.0 - 0.3 * smoothstep(-0.3, 1.0, x)) + 0.03;
  float d = (p.y - hw) * 0.8;
  d = max(d, x - 0.97);
  float notch = 0.2 - length(vec2(x + 1.02, p.y * 1.3));
  return max(d, notch);
}
void main() {
  float d = bractShape(vL);
  float fw = fwidth(d) + 1e-4;
  float cov = 1.0 - smoothstep(-fw, fw, d);
  if (cov < 0.02) discard;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(uCam - vW);
  float tint = vState.x;
  // deux tons : bord magenta #D0287A (variations par grappe), cœur plus pâle et translucide
  vec3 edgeC = mix(uBloomDeep, uBloomEdge, smoothstep(0.0, 0.6, tint)) * (0.94 + 0.12 * fract(tint * 7.3));
  float inner = smoothstep(0.0, 0.42, -d);                  // 0 au bord → 1 au cœur (dégradé doux)
  vec3 alb = mix(edgeC, uBloomPale, inner * 0.55);
  // nervures fines : médiane + latérales arquées vers la pointe
  float mid = smoothstep(0.07, 0.0, abs(vL.y)) * smoothstep(1.0, 0.2, vL.x);
  float lat = smoothstep(0.08, 0.0, abs(fract((vL.x - abs(vL.y) * 1.1) * 2.6) - 0.5)) * smoothstep(0.05, 0.25, abs(vL.y));
  alb *= 1.0 - 0.1 * max(mid, lat * 0.7);
  float sv = sunVis(vW);
  float ndl = abs(dot(N, uSunDir));
  // papier translucide : la lumière traverse surtout le cœur (contre-jour)
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.0) * (0.35 + 0.65 * inner);
  vec3 col = alb * (uSkyZen * 0.42 + uSunCol * (ndl * 0.65 + 0.2) * sv) + uBloomPale * uSunCol * back * 0.55 * sv;
  // coulée : plus sombre, désaturée, puis noyée dans le bleu nuit
  float sunk = vState.y;
  float g = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(g) * 0.45, sunk * 0.7);
  float dep = max(uPoolW.x - vW.y, 0.0);
  col = mix(col, uScatter, 1.0 - exp(-dep * 25.0));
  float a = cov * mix(1.0, 0.8, inner) * (1.0 - smoothstep(0.02, 0.06, dep));
  gl_FragColor = vec4(linearToOutputTexel(vec4(col, 1.0)).rgb, a);
}
`

function createPetals(ctx, pads) {
  const { P, Fo, U, W, Q, colors } = ctx
  const N = Q.petals
  const rnd = ctx.rnd
  // grappes : ≈ 1/3 de triades, le reste en bractées simples
  const nTriads = Math.round(N * 0.2)
  const clusters = []
  for (let first = 0, c = 0; first < N; c++) {
    const n = c < nTriads && first + 3 <= N ? 3 : 1
    clusters.push({ first, n })
    first += n
  }
  const geo = buildBractGeometry()
  const state = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aState', state)
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uBloomEdge: { value: colors.bloomEdge }, uBloomPale: { value: colors.bloomPale }, uBloomDeep: { value: colors.bloomDeep }, uScatter: W.uScatter },
    defines: { ...ctx.defines },
    vertexShader: PETAL_VS, fragmentShader: PETAL_FS, side: THREE.DoubleSide, toneMapped: false,
    transparent: true, depthWrite: true,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, N)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.name = 'MJ_Petals'

  // matrices locales (fixes) : triade = 3 bractées à ~120°, base commune, pointes un peu relevées
  const local = []
  for (const C of clusters) {
    for (let k = 0; k < C.n; k++) {
      const m = new THREE.Matrix4()
      if (C.n > 1) {
        const yaw = k * (TAU / 3) + (rnd() - 0.5) * 0.5
        m.makeRotationY(yaw)
          .multiply(new THREE.Matrix4().makeTranslation(BRACT_HL * 0.9, 0.0012 * k, 0))
          .multiply(new THREE.Matrix4().makeRotationZ(0.1 + 0.08 * rnd()))
      }
      local.push(m)
    }
  }

  const basinIn = Fo.cupOuterR + 0.06, basinOut = Fo.basinR - 0.03
  const levelAt = (x, z) => {
    if (x > P.x0 + 0.01 && x < P.x1 - 0.01 && z > P.z0 + 0.01 && z < P.z1 - 0.01) return P.waterY
    const r = Math.hypot(x - Fo.x, z - Fo.z)
    if (r > basinIn && r < basinOut) return Fo.waterY
    return NaN
  }
  // dessus d'une feuille de nénuphar à cet endroit (les bractées s'y posent au lieu de la traverser)
  const padTop = (x, z) => {
    let y = -1
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i]
      const dx = x - p.x, dz = z - p.z
      if (dx * dx + dz * dz < p.r * p.r * 0.85) y = Math.max(y, p.y + 0.004)
    }
    return y
  }
  // « mouillage » au bord : le long des parois et surtout dans les coins (comme dans le concept)
  const pickBerth = (out, level, big) => {
    if (level > P.waterY + 0.1) {
      const a = rnd() * TAU, r = basinOut - (big ? 0.03 : 0.012) - 0.02 * rnd()
      out.x = Fo.x + Math.cos(a) * r; out.z = Fo.z + Math.sin(a) * r
      return out
    }
    const m = (big ? 0.045 : 0.018) + 0.025 * rnd()
    const k = rnd()
    if (k < 0.45) { // coins
      out.x = rnd() < 0.5 ? P.x0 + m + 0.06 * rnd() : P.x1 - m - 0.06 * rnd()
      out.z = rnd() < 0.5 ? P.z0 + m + 0.14 * rnd() : P.z1 - m - 0.14 * rnd()
    } else if (k < 0.82) { // longs côtés
      out.x = rnd() < 0.5 ? P.x0 + m : P.x1 - m
      out.z = P.z0 + 0.1 + rnd() * (P.z1 - P.z0 - 0.2)
    } else { // petits côtés
      out.z = rnd() < 0.5 ? P.z0 + m : P.z1 - m
      out.x = P.x0 + 0.1 + rnd() * (P.x1 - P.x0 - 0.2)
    }
    return out
  }
  const tmp = { x: 0, z: 0 }
  const S = clusters.map((C, i) => ({
    i, first: C.first, n: C.n, state: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, wx: 0, wz: 0, fall: 0.3, yaw: rnd() * TAU, spin: 0, tilt: 0, tiltB: 0,
    t: 0, life: 0, phase: rnd() * TAU, freq: 2 + rnd() * 1.5, size: 0.88 + rnd() * 0.24, level: 0, sunk: 0,
    bx: 0, bz: 0, tint: rnd(),
  }))
  // 0 = tombe, 1 = flotte (dérive vers son mouillage), 2 = coule
  const spawnFalling = (p, progress) => {
    // cible : de préférence près des bords du bassin long (d'où viennent les bougainvilliers)
    if (rnd() < 0.85) { tmp.x = P.x0 + 0.06 + rnd() * (P.x1 - P.x0 - 0.12); tmp.z = P.z0 + 0.1 + rnd() * (P.z1 - P.z0 - 0.2) }
    else { const a = rnd() * TAU, r = basinIn + 0.05 + rnd() * (basinOut - basinIn - 0.1); tmp.x = Fo.x + Math.cos(a) * r; tmp.z = Fo.z + Math.sin(a) * r }
    const y0 = 2.6 + rnd() * 1.4
    const fall = (p.n > 1 ? 0.36 : 0.3) + 0.08 * rnd()
    const T = (y0 - 0.2) / fall
    const side = tmp.x > 0 ? 1 : -1
    const sx = side * (2.4 + rnd() * 0.9), sz = tmp.z + (rnd() * 2 - 1) * 1.2
    p.state = 0; p.wx = (tmp.x - sx) / T; p.wz = (tmp.z - sz) / T; p.fall = fall
    p.x = sx + p.wx * T * progress; p.z = sz + p.wz * T * progress; p.y = y0 - (y0 - 0.2) * progress
    p.t = rnd() * 10; p.spin = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd()); p.sunk = 0
  }
  const startFloating = (p, x, z, level, life) => {
    p.state = 1; p.x = x; p.z = z; p.level = level; p.y = level; p.vx = 0; p.vz = 0
    p.life = life; p.spin = (rnd() - 0.5) * 0.1; p.sunk = 0
    pickBerth(tmp, level, p.n > 1); p.bx = tmp.x; p.bz = tmp.z
  }
  S.forEach((p, i) => {
    if (i < S.length * 0.82) {
      // au départ : la plupart déjà accumulées le long des bords et dans les coins, quelques-unes en chemin
      const lvl = rnd() < 0.88 ? P.waterY : Fo.waterY
      pickBerth(tmp, lvl, p.n > 1)
      let x = tmp.x, z = tmp.z
      if (rnd() < 0.2) { x += (rnd() - 0.5) * 0.3; z += (rnd() - 0.5) * 0.3 }
      if (!(levelAt(x, z) === levelAt(x, z))) { x = tmp.x; z = tmp.z }
      startFloating(p, x, z, lvl, 20 + rnd() * 80)
    } else spawnFalling(p, rnd() * 0.9)
  })

  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4(), mm = new THREE.Matrix4()
  const impulse = { x: 0, z: 0, level: 0, k: 0, t: -1 }

  function update(dt, time, energy) {
    const hasImpulse = impulse.k > 0
    for (let i = 0; i < S.length; i++) {
      const p = S[i]
      const big = p.n > 1
      if (p.state === 0) {
        p.t += dt
        const sw = Math.sin(p.t * p.freq + p.phase)
        p.x += (p.wx + 0.16 * sw * Math.cos(p.yaw)) * dt
        p.z += (p.wz + 0.16 * sw * Math.sin(p.yaw)) * dt
        p.y -= (p.fall + 0.1 * Math.abs(Math.cos(p.t * p.freq + p.phase))) * dt
        p.yaw += p.spin * dt
        p.tilt = (big ? 0.5 : 0.9) * sw; p.tiltB = 0.4 * Math.cos(p.t * p.freq * 0.5)
        const lv = levelAt(p.x, p.z)
        if (lv === lv && p.y <= lv + 0.004) {
          startFloating(p, p.x, p.z, lv, 40 + rnd() * 60)
          ctx.emitRipple(p.x, p.z, lv, 0.12, 0)
        } else if (p.y <= 0.0) spawnFalling(p, 0) // tombée sur le sol : le décor baké s'en charge
      } else {
        // dérive lente vers le mouillage (vent + courant de surface), puis immobile au bord
        const dx = p.bx - p.x, dz = p.bz - p.z, d = Math.hypot(dx, dz) + 1e-4
        const go = clamp(d / 0.08, 0, 1) * 0.011
        const cvx = (dx / d) * go + 0.004 * Math.sin(p.z * 1.3 + time * 0.07 + p.phase)
        const cvz = (dz / d) * go + 0.004 * Math.cos(p.x * 1.7 + time * 0.06 + p.phase)
        p.vx += (cvx - p.vx) * Math.min(1, dt * 0.5); p.vz += (cvz - p.vz) * Math.min(1, dt * 0.5)
        if (hasImpulse && Math.abs(p.level - impulse.level) < 0.1) {
          const ix = p.x - impulse.x, iz = p.z - impulse.z, id = Math.hypot(ix, iz) + 1e-3
          const front = (time - impulse.t) * 0.22
          if (Math.abs(id - front) < 0.06 && id < 0.6) { const k = impulse.k * 0.06 * (1 - id / 0.6) * dt * 10; p.vx += (ix / id) * k; p.vz += (iz / id) * k }
        }
        // sillage du doigt : écartées par le doigt et entraînées dans son sillage (bassin long)
        const wh = ctx.wakeHead
        if (wh.amp > 0.01 && p.level < P.waterY + 0.1) {
          const ix = p.x - wh.x, iz = p.z - wh.z, id = Math.hypot(ix, iz) + 1e-3
          if (id < 0.4) {
            const k = 1 - id / 0.4, g = wh.amp * dt * 4
            p.vx += ((ix / id) * (0.25 + 0.35 * Math.min(wh.sp, 1.5)) * k * k + wh.vx * k * 0.5) * g
            p.vz += ((iz / id) * (0.25 + 0.35 * Math.min(wh.sp, 1.5)) * k * k + wh.vz * k * 0.5) * g
            p.spin += (rnd() - 0.5) * k * dt * 4
          }
        }
        if (p.level > P.waterY + 0.1) {
          // légère giration entretenue par le voile de la fontaine
          const rx = p.x - Fo.x, rz = p.z - Fo.z, r = Math.hypot(rx, rz) + 1e-3
          p.vx += (-rz / r) * 0.004 * energy * dt; p.vz += (rx / r) * 0.004 * energy * dt
        }
        p.x += p.vx * dt; p.z += p.vz * dt
        p.yaw += p.spin * dt * (d > 0.05 ? 1 : 0.2)
        const mg = big ? 0.04 : 0.016
        if (p.level < P.waterY + 0.1) {
          if (p.x < P.x0 + mg) { p.x = P.x0 + mg; p.vx = Math.abs(p.vx) * 0.2 } else if (p.x > P.x1 - mg) { p.x = P.x1 - mg; p.vx = -Math.abs(p.vx) * 0.2 }
          if (p.z < P.z0 + mg) { p.z = P.z0 + mg; p.vz = Math.abs(p.vz) * 0.2 } else if (p.z > P.z1 - mg) { p.z = P.z1 - mg; p.vz = -Math.abs(p.vz) * 0.2 }
        } else {
          const rx = p.x - Fo.x, rz = p.z - Fo.z, r = Math.hypot(rx, rz) + 1e-3
          const rc = clamp(r, basinIn, basinOut - (big ? 0.02 : 0))
          if (rc !== r) { p.x = Fo.x + (rx / r) * rc; p.z = Fo.z + (rz / r) * rc; p.vx *= 0.3; p.vz *= 0.3 }
        }
        const h = swellHeight(p.x, p.z, time)
        let y = p.level + 0.002 + h
        if (p.level < P.waterY + 0.1) { const pt = padTop(p.x, p.z); if (pt > 0) y = Math.max(y, P.waterY + pt + h * 0.9) }
        p.tilt = (swellHeight(p.x + 0.02, p.z, time) - h) * 12; p.tiltB = (swellHeight(p.x, p.z + 0.02, time) - h) * 12
        p.life -= dt
        if (p.state === 1 && p.life <= 0) { p.state = 2; p.life = 6 }
        if (p.state === 2) {
          p.sunk = clamp(1 - p.life / 6, 0, 1)
          y -= p.sunk * 0.07
          if (p.life <= 0) spawnFalling(p, 0)
        }
        p.y = y
      }
      q.setFromEuler(e.set(p.tilt, p.yaw, p.tiltB, 'YXZ'))
      m.compose(v.set(p.x, p.y, p.z), q, s.setScalar(p.size))
      for (let k = 0; k < p.n; k++) {
        mesh.setMatrixAt(p.first + k, mm.multiplyMatrices(m, local[p.first + k]))
        state.setXY(p.first + k, p.tint, p.sunk)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    state.needsUpdate = true
    if (hasImpulse && time - impulse.t > 3) impulse.k = 0
  }
  return {
    mesh, update, clusters: clusters.length, triads: nTriads,
    push(x, z, level, k, time) { impulse.x = x; impulse.z = z; impulse.level = level; impulse.k = k; impulse.t = time },
    /** poussée radiale immédiate (toucher du doigt) : bractées flottantes du bassin long à moins de `radius` m */
    kick(x, z, radius, speed) {
      for (let i = 0; i < S.length; i++) {
        const p = S[i]
        if (p.state === 0 || p.level > P.waterY + 0.1) continue
        const ix = p.x - x, iz = p.z - z, id = Math.hypot(ix, iz) + 1e-3
        if (id >= radius) continue
        const k = speed * (1 - id / radius)
        p.vx += (ix / id) * k; p.vz += (iz / id) * k
      }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Sondes de reflet
// ---------------------------------------------------------------------------------------------
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

/**
 * Charge les sondes bakées par blender/fx_bake_probes.py (faces JPEG déjà en convention cubemap GL).
 * Fichiers attendus : <baseUrl>/probe_<pool|basin|cup>_<px|nx|py|ny|pz|nz>.jpg (pool 768 px, autres 256 px).
 * @returns {Promise<{pool?, basin?, cup?}>} chaque entrée = { texture: THREE.CubeTexture, position, size }
 */
export function loadReflectionProbes(baseUrl = '/majorelle/fx/', names = ['pool', 'basin', 'cup']) {
  const loader = new THREE.CubeTextureLoader()
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  return Promise.all(names.map((name) => new Promise((resolve) => {
    loader.load(FACE_ORDER.map((f) => `${base}probe_${name}_${f}.jpg`), (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.needsUpdate = true
      resolve([name, { texture: tex, position: MAJORELLE_PROBES[name].position, size: tex.image?.[0]?.width || MAJORELLE_PROBES[name].size }])
    }, undefined, () => resolve([name, null]))
  }))).then((list) => {
    const out = {}
    for (const [name, p] of list) if (p) out[name] = p
    return out
  })
}

// ---------------------------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {THREE.Object3D} o.parent   repère jardin (mètres)
 * @param {object} [o.pool]           { x0, x1, z0, z1, waterY, depth, rimH? }
 * @param {object} [o.fountain]       { x, z, basinR, waterY, bowlY, bowlR, floorY?, rimY?, rimR?, pedestalR?, cupOuterR?, cupBaseY?, nozzleY? }
 * @param {THREE.Vector3} [o.sunDir]  direction VERS le soleil (repère jardin) ; inversée si elle pointe vers le bas
 * @param {object} [o.sky]            { zenith, horizon } (couleurs CSS / hex / THREE.Color)
 * @param {'high'|'medium'|'low'} [o.quality]   'low' = chemin d'eau économique (ni volumes ni paillettes)
 * @param {object|THREE.CubeTexture} [o.reflectionCube]  sondes de reflet : CubeTexture unique (bassin long)
 *        ou { pool, basin, cup } (CubeTexture ou { texture, position }) — cf. loadReflectionProbes().
 *        Sans sonde : repli analytique (cour schématique anti-crénelée).
 * @param {object} [o.room]           { x0, x1, zBack, zFront, wallH } : boîte de la cour (reflets + ombres)
 * @param {number} [o.renderOrder]    base de renderOrder (cf. en-tête)
 * @param {boolean} [o.shadows]       ombres analytiques des murs / de la vasque sur l'eau et le fond
 * @param {number} [o.energy]         énergie initiale de la fontaine (0..1)
 */
export function createGardenFX({
  parent, pool = {}, fountain = {}, sunDir, sky = {}, quality = 'high', room = {}, renderOrder = 0,
  shadows = true, energy = 0.75, seed = 7, sunColor, reflectionCube = null,
  gold = null, // CÈDRE : CEDAR_GOLD.uMjGold (lib/majorelle/cedarAnswer.js), partagé avec la cour ; sinon neutre
} = {}) {
  const P = { ...DEFAULT_POOL, ...pool }
  const Fo = { ...DEFAULT_FOUNTAIN, ...fountain }
  Fo.bowlWaterY = Fo.bowlWaterY ?? Fo.bowlY - 0.016
  Fo.cupOuterR = Math.max(Fo.cupOuterR, Fo.bowlR + 0.01)
  const Ro = { ...DEFAULT_ROOM, ...room }
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

  // fontaine : jet (hauteur ∝ e²), couronne, voile continu qui épouse la lèvre puis chute (1-2 cm d'évasement)
  const jet = { y0: Math.max(Fo.nozzleY, Fo.bowlWaterY) }
  jet.veilR0 = Fo.cupOuterR - 0.004          // la nappe part du dessus de la lèvre…
  jet.veilY0 = Fo.bowlY + 0.003
  jet.veilRho = 0.01                         // …et s'enroule sur son arrondi (rayon 1 cm)
  jet.veilVout = 0.045                       // vitesse d'évasement (m/s) → ≈ 1,7 cm sur la chute
  const fallH = jet.veilY0 - jet.veilRho - Fo.waterY
  jet.veilT = (-0.12 + Math.sqrt(0.0144 + 4 * 4.905 * Math.max(fallH, 0.01))) / (2 * 4.905)
  jet.veilLandR = jet.veilR0 + jet.veilVout * jet.veilT
  jet.uJet = { value: new THREE.Vector4(jet.y0, 0, 0, 0) }
  jet.uVeilP = { value: new THREE.Vector4(jet.veilR0, jet.veilY0, jet.veilRho, jet.veilT) }

  const colors = {
    scatter: new THREE.Color('#0a1a44'), scatterB: new THREE.Color('#0c2448'),
    wall: new THREE.Color('#2546d8'), coping: new THREE.Color('#f2c94c'), stucco: new THREE.Color('#efe6d4'),
    mosaic: new THREE.Color('#8fa2c4'), zellige: new THREE.Color('#3f5fc4'),
    marble: new THREE.Color('#f4eee2'), stone: new THREE.Color('#e8d3a8'),
    padA: new THREE.Color('#5e7a4e'), padB: new THREE.Color('#7a8c62'), padUnder: new THREE.Color('#6b4a3c'),
    ageA: new THREE.Color('#b8943f'), ageB: new THREE.Color('#94503a'),
    petalBase: new THREE.Color('#f6eef0'), petalTip: new THREE.Color('#e58bb4'),
    bloomEdge: new THREE.Color('#d0287a'), bloomDeep: new THREE.Color('#b01e66'), bloomPale: new THREE.Color('#f6b9d5'),
    waterAmb: new THREE.Color('#8fa3b0'),   // ambiance sous l'eau, peu bleutée (les robes claires restent chaudes)
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
    uPoolW: { value: new THREE.Vector4(P.waterY, P.depth, P.rimH, 0) },
    uFount: { value: new THREE.Vector4(Fo.x, Fo.z, Fo.basinR, Fo.waterY) },
    uBowl: { value: new THREE.Vector4(Fo.bowlWaterY, Fo.bowlR, 0.06, jet.veilLandR) },
    uCup: { value: new THREE.Vector4(Fo.pedestalR, Fo.cupOuterR, Fo.cupBaseY, Fo.bowlY) },
    uBasinRim: { value: new THREE.Vector4(Fo.rimY, Fo.rimR, 0, 0) },
    uRoom: { value: new THREE.Vector4(Ro.x0, Ro.x1, Ro.zBack, Ro.zFront) },
    uWallH: { value: Ro.wallH },
    uShadows: { value: shadows ? 1 : 0 },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uRipY: { value: new Array(8).fill(-100) },
    uFish: { value: Array.from({ length: Math.max(1, Q.koi) }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uFishB: { value: Array.from({ length: Math.max(1, Q.koi) }, () => new THREE.Vector4(0.3, -10, 0, 0)) },
    uWk: { value: Array.from({ length: WAKE_NMAX }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uWkW: { value: Array.from({ length: WAKE_NMAX }, () => new THREE.Vector4(0.05, 0, 0.05, 0)) },
    uWkN: { value: 0 },
    uWkCap: { value: 0 },
    uWkR: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] },
    uWkRw: { value: new THREE.Vector2(0.03, 0.03) },
    uWkBox: { value: new THREE.Vector4(1, -1, 1, -1) },
    uGold: gold || { value: new THREE.Vector4(-99, 1, 0, 0) }, // lu par l'eau seulement (crochet CÈDRE)
  }
  // uniformes de la surface (partagés par l'eau, les koï, les nénuphars et le voile)
  const W = {
    uNormTex: { value: null },
    uWaveK: { value: new THREE.Vector2(0.5, 0.26) },          // bassin long : vaguelettes −60 % (miroir)
    uScatter: { value: colors.scatter }, uScatterB: { value: colors.scatterB },
    uAbsorbRGB: { value: new THREE.Vector3(2.4, 0.9, 0.45) }, // 1/m : le rouge est absorbé en premier
    uScatK: { value: new THREE.Vector3(0.7, 2.6, 1.0) },       // voile de diffusion (1/m) : long, rond, coupe
    uLightPath: { value: 0.25 },
    uReflK: { value: new THREE.Vector3(2.2, 1.5, 1.4) },
    uBottomEst: { value: new THREE.Vector3(0.004, 0.008, 0.035) },
    uProbeRes: { value: new THREE.Vector2(768 * 0.6366, 256 * 0.6366) },
    uLodBias: { value: 0.0 },
    uProbe0: { value: null }, uProbe1: { value: null }, uProbe2: { value: null },
    uProbeP0: { value: new THREE.Vector3(...MAJORELLE_PROBES.pool.position) },
    uProbeP1: { value: new THREE.Vector3(...MAJORELLE_PROBES.basin.position) },
    uProbeP2: { value: new THREE.Vector3(...MAJORELLE_PROBES.cup.position) },
    uWallCol: { value: colors.wall }, uCoping: { value: colors.coping }, uStucco: { value: colors.stucco },
    uMosaic: { value: colors.mosaic }, uZellige: { value: colors.zellige }, uMarble: { value: colors.marble }, uStone: { value: colors.stone },
  }

  let time = 0
  let ripCursor = 0
  const emitRipple = (x, z, level, amp, delay = 0) => {
    U.uRip.value[ripCursor].set(x, z, time + delay, amp)
    U.uRipY.value[ripCursor] = level
    ripCursor = (ripCursor + 1) % 8
  }

  const defines = {}
  if (Q.lite) defines.LITE = 1
  // doigt posé sur le bassin long (water.wake.head) : lu par les bractées et les nénuphars
  const wakeHead = { x: 0, z: 0, amp: 0, vx: 0, vz: 0, sp: 0, R: 0.1 }
  const ctx = { P, Fo, Ro, Q, U, W, rng, rnd, colors, jet, emitRipple, defines, wakeHead }
  ctx.normTex = makeRippleNormalTexture(rng)
  ctx.caustTex = makeCausticTexture(rng)
  W.uNormTex.value = ctx.normTex

  const group = new THREE.Group()
  group.name = 'MJ_GardenFX'
  const pads = layoutPads(P, Q, rng)
  ctx.padShadowTex = makePadShadowTexture(P, pads)
  const padMesh = createPads(ctx, pads)
  const flowers = createFlowers(ctx, pads)
  const water = buildWater(ctx)
  const caustics = buildCaustics(ctx)
  const koi = createKoi(ctx)
  const streams = createStreams(ctx)
  const drops = createDroplets(ctx)
  const petals = createPetals(ctx, pads)

  caustics.renderOrder = renderOrder + 1
  water.absorb.renderOrder = renderOrder + 2
  water.mesh.renderOrder = renderOrder + 3
  koi.body.renderOrder = renderOrder + 4
  koi.fins.renderOrder = renderOrder + 5
  padMesh.renderOrder = renderOrder + 6
  flowers.mesh.renderOrder = renderOrder + 7
  petals.mesh.renderOrder = renderOrder + 8
  streams.renderOrder = renderOrder + 9
  drops.points.renderOrder = renderOrder + 10
  group.add(caustics, water.absorb, water.mesh, koi.body, koi.fins, padMesh, flowers.mesh, petals.mesh, streams, drops.points)
  if (parent) parent.add(group)

  const materials = []
  group.traverse((o) => { if (o.material && !materials.includes(o.material)) materials.push(o.material) })

  // --- sondes de reflet ---
  function setReflectionCube(rc) {
    const norm = (p, name) => {
      if (!p) return null
      if (p.isTexture) return { texture: p, position: MAJORELLE_PROBES[name].position, size: p.image?.[0]?.width || MAJORELLE_PROBES[name].size }
      return { texture: p.texture, position: p.position || MAJORELLE_PROBES[name].position, size: p.size || p.texture?.image?.[0]?.width || MAJORELLE_PROBES[name].size }
    }
    let pr = null
    if (rc) {
      if (rc.isTexture) pr = { pool: norm(rc, 'pool') }
      else pr = { pool: norm(rc.pool, 'pool'), basin: norm(rc.basin, 'basin'), cup: norm(rc.cup, 'cup') }
    }
    const has = !!(pr && pr.pool && pr.pool.texture)
    if (has) {
      const pool0 = pr.pool, basin0 = pr.basin || pool0, cup0 = pr.cup || basin0
      W.uProbe0.value = pool0.texture; W.uProbe1.value = basin0.texture; W.uProbe2.value = cup0.texture
      const setP = (u, p) => (Array.isArray(p) ? u.value.fromArray(p) : u.value.copy(p))
      setP(W.uProbeP0, pool0.position); setP(W.uProbeP1, basin0.position); setP(W.uProbeP2, cup0.position)
      W.uProbeRes.value.set((pool0.size || 768) * 0.6366, (basin0.size || 256) * 0.6366)
    }
    for (const m of materials) {
      const had = !!m.defines.PROBES
      if (has) m.defines.PROBES = 1; else delete m.defines.PROBES
      if (had !== has) m.needsUpdate = true
    }
    return has
  }
  if (reflectionCube) setReflectionCube(reflectionCube)

  let energyTarget = energy, energyNow = energy
  const invM = new THREE.Matrix4(), camW = new THREE.Vector3()
  const hit = new THREE.Vector3()

  // --- sillage du doigt : tracé lissé du doigt (cf. wakeField) ----------------------------------------------
  // Pendant que le doigt glisse, un point est enregistré à cadence fixe (palier de qualité) AVEC UN PAS DE RETARD :
  // le point en attente (pend) est le doigt au pas précédent, si bien que le segment du doigt n'est jamais dégénéré
  // (aucun « pompage » quand un point s'ajoute). Doigt posé immobile : le point en attente le suit et n'émet rien.
  // Chaque point garde sa vitesse d'émission ; rayon du front, hauteurs, largeurs sont vieillis ici puis envoyés au
  // shader (uWk / uWkW), du doigt vers le plus ancien. Plusieurs tracés (doigt levé puis reposé) coexistent : le
  // premier point de chacun porte un drapeau (uWkW.w) qui coupe la liaison avec le précédent. Zéro allocation.
  const wkTier0 = typeof quality === 'string' && WAKE.tiers[quality] ? quality : 'high'
  const WK = {
    x: new Float32Array(WAKE_NMAX), z: new Float32Array(WAKE_NMAX), t: new Float64Array(WAKE_NMAX).fill(-100),
    c: new Float32Array(WAKE_NMAX), a: new Float32Array(WAKE_NMAX), b: new Float32Array(WAKE_NMAX), cid: new Int32Array(WAKE_NMAX),
    head: 0, n: 0, chain: 0, live: false, lastT: -100,
    pend: false, rest: false, px: 0, pz: 0, pt: 0, pc: 0, pa: 0, pb: 0,
    ec: 0, ea: 0, eb: 0,                                        // émission à la vitesse courante (wakeEmit)
    rx: new Float32Array(2), rz: new Float32Array(2), rt: new Float64Array(2).fill(-100), rk: new Float32Array(2), rCur: 0,
    tier: WAKE.tiers[wkTier0], tierName: wkTier0, life: Math.min(2.4, (WAKE.tiers[wkTier0].n - 1) * WAKE.tiers[wkTier0].dt),
    up: 0, active: false, added: 0, lastAmp: 0, uSlow: 0, age: new Float32Array(WAKE_NMAX),
  }
  const inLongPool = (x, z) => x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1
  // ce qu'émet le doigt à la vitesse sp (m/s) : lent → petit V doux, vif → V plus long, plus large au bout
  function wakeEmit(sp) {
    const k = clamp(sp / WAKE.vFull, 0, 1), on = sstep(0.03, 0.2, sp)
    WK.ec = WAKE.c0 + WAKE.kc * Math.min(WK.uSlow, 2)
    WK.ea = (WAKE.a[0] + (WAKE.a[1] - WAKE.a[0]) * k) * on
    WK.eb = (WAKE.b[0] + (WAKE.b[1] - WAKE.b[0]) * k) * on
  }
  function wakePush(x, z, t, c, a, b) {
    const i = WK.head
    WK.x[i] = x; WK.z[i] = z; WK.t[i] = t; WK.c[i] = c; WK.a[i] = a; WK.b[i] = b; WK.cid[i] = WK.chain
    WK.head = (i + 1) % WAKE_NMAX
    if (WK.n < WAKE_NMAX) WK.n++
    WK.added++
  }
  // suivi du doigt (à chaque image, depuis wakeHead) : début / fin de tracé, points à cadence fixe
  function wakeTrack(dt) {
    const h = wakeHead
    const live = h.amp > 0
    WK.uSlow = live ? WK.uSlow + (h.sp - WK.uSlow) * (1 - Math.exp(-dt / WAKE.uTau)) : 0
    if (live && !WK.live) {
      // doigt qui se pose (ou revient sur le bassin) : nouveau tracé
      WK.chain++
      WK.pend = true; WK.rest = false; WK.px = h.x; WK.pz = h.z; WK.pt = time; WK.pc = WAKE.c0; WK.pa = 0; WK.pb = 0
      WK.lastT = time
    } else if (live) {
      if (time - WK.lastT >= WK.tier.dt) {
        WK.lastT = time
        const moved = Math.hypot(h.x - WK.px, h.z - WK.pz)
        if (moved >= WAKE.eps) {
          if (WK.rest) { WK.pt = time - Math.min(WK.tier.dt, moved / Math.max(h.sp, 0.05)); WK.pa = 0; WK.pb = 0; WK.pc = WAKE.c0; WK.rest = false }
          wakePush(WK.px, WK.pz, WK.pt, WK.pc, WK.pa, WK.pb)
          wakeEmit(h.sp)
          WK.px = h.x; WK.pz = h.z; WK.pt = time; WK.pc = WK.ec; WK.pa = WK.ea; WK.pb = WK.eb
        } else if (h.sp < WAKE.vRest) {
          // doigt posé : le point en attente le suit, reste frais et n'émet rien (le V s'éteint, sans pulsation)
          WK.rest = true; WK.px = h.x; WK.pz = h.z; WK.pt = time; WK.pc = WAKE.c0; WK.pa = 0; WK.pb = 0
        }
      }
    } else if (WK.live) {
      // doigt levé (ou sorti du bassin long) : le tracé se ferme au dernier point du doigt, puis s'éteint seul
      if (WK.pend && !WK.rest && Math.hypot(h.x - WK.px, h.z - WK.pz) >= WAKE.eps) wakePush(WK.px, WK.pz, WK.pt, WK.pc, WK.pa, WK.pb)
      wakeEmit(h.sp)
      wakePush(h.x, h.z, time, WK.ec, WK.ea, WK.eb + WAKE.dimple * WK.lastAmp)
      WK.pend = false; WK.rest = false
    }
    WK.live = live
    if (live) WK.lastAmp = Math.min(h.amp, 1)
  }
  // anneau unique et très doux (doigt qui se pose, tap) ; k = force 0..1,5
  function wakeRing(x, z, k = 1) {
    if (!(x === x) || !(z === z)) return -1
    const i = WK.rCur
    WK.rCur = (i + 1) % 2
    WK.rx[i] = x; WK.rz[i] = z; WK.rt[i] = time; WK.rk[i] = clamp(k, 0, 1.5)
    return i
  }
  function wakeHeadSet(x, z, amp = 1, vx = 0, vz = 0, radius = 0.1) {
    const a = clamp(amp || 0, 0, 2)
    if (a > 0 && x === x && z === z) {
      wakeHead.x = x; wakeHead.z = z; wakeHead.vx = vx || 0; wakeHead.vz = vz || 0
      wakeHead.sp = Math.hypot(wakeHead.vx, wakeHead.vz); wakeHead.R = radius
      wakeHead.amp = a
    } else wakeHead.amp = 0
  }
  // nénuphars (et leurs fleurs) écartés par le doigt, puis rappelés lentement à leur place (≈ 5 s)
  const padAttr = padMesh.geometry.attributes.aI0, flowerAttr = flowers.mesh.geometry.attributes.aF0
  const NP = pads.length
  const PM = { ox: new Float32Array(NP), oz: new Float32Array(NP), vx: new Float32Array(NP), vz: new Float32Array(NP), sp: new Float32Array(NP), om: new Float32Array(NP), moving: false }
  const flowerHost = Int16Array.from(flowers.items.map((it) => (it.host >= 0 ? it.host : -1)))
  function padKick(x, z, radius, speed) {
    for (let i = 0; i < NP; i++) {
      const p = pads[i], dx = p.x + PM.ox[i] - x, dz = p.z + PM.oz[i] - z, d = Math.hypot(dx, dz) + 1e-4
      const R = radius + p.r
      if (d >= R) continue
      const k = speed * (1 - d / R)
      PM.vx[i] += (dx / d) * k; PM.vz[i] += (dz / d) * k
      PM.om[i] += (rnd() - 0.5) * k * 3
      PM.moving = true
    }
  }
  function padsUpdate(dt) {
    const h = wakeHead
    if (!PM.moving && h.amp <= 0.01) return
    let moving = false
    const a = padAttr.array
    for (let i = 0; i < NP; i++) {
      const p = pads[i]
      let ax = -PM.ox[i] * 0.55 - PM.vx[i] * 1.15, az = -PM.oz[i] * 0.55 - PM.vz[i] * 1.15
      if (h.amp > 0.01) {
        const dx = p.x + PM.ox[i] - h.x, dz = p.z + PM.oz[i] - h.z, d = Math.hypot(dx, dz) + 1e-4
        const R = p.r + 0.24
        if (d < R) {
          const k = 1 - d / R, push = (1.4 + 2.6 * Math.min(h.sp, 1.5)) * k * k * h.amp
          ax += (dx / d) * push + (h.vx - PM.vx[i]) * k * 1.8 * h.amp
          az += (dz / d) * push + (h.vz - PM.vz[i]) * k * 1.8 * h.amp
          PM.om[i] += ((dx * h.vz - dz * h.vx) / d) * k * dt * 2.5
        }
      }
      PM.vx[i] += ax * dt; PM.vz[i] += az * dt
      let ox = PM.ox[i] + PM.vx[i] * dt, oz = PM.oz[i] + PM.vz[i] * dt
      // reste dans le bassin, et jamais à plus de 0,5 m de sa place
      const lx0 = P.x0 + p.r * 0.9 - p.x, lx1 = P.x1 - p.r * 0.9 - p.x, lz0 = P.z0 + p.r * 0.9 - p.z, lz1 = P.z1 - p.r * 0.9 - p.z
      if (ox < lx0) { ox = lx0; PM.vx[i] *= -0.2 } else if (ox > lx1) { ox = lx1; PM.vx[i] *= -0.2 }
      if (oz < lz0) { oz = lz0; PM.vz[i] *= -0.2 } else if (oz > lz1) { oz = lz1; PM.vz[i] *= -0.2 }
      const L = Math.hypot(ox, oz)
      if (L > 0.5) { ox *= 0.5 / L; oz *= 0.5 / L }
      PM.ox[i] = ox; PM.oz[i] = oz
      PM.om[i] += (-PM.sp[i] * 0.25 - PM.om[i] * 0.9) * dt
      PM.sp[i] += PM.om[i] * dt
      a[i * 4] = p.x + ox; a[i * 4 + 1] = p.z + oz; a[i * 4 + 3] = p.rot + PM.sp[i]
      if (Math.abs(ox) + Math.abs(oz) > 2e-4 || Math.abs(PM.vx[i]) + Math.abs(PM.vz[i]) > 2e-4 || Math.abs(PM.sp[i]) + Math.abs(PM.om[i]) > 2e-4) moving = true
      else { PM.ox[i] = PM.oz[i] = PM.vx[i] = PM.vz[i] = PM.sp[i] = PM.om[i] = 0; a[i * 4] = p.x; a[i * 4 + 1] = p.z; a[i * 4 + 3] = p.rot }
    }
    padAttr.needsUpdate = true
    const f = flowerAttr.array, items = flowers.items
    for (let j = 0; j < items.length; j++) {
      const hI = flowerHost[j]
      if (hI < 0) continue
      f[j * 4] = items[j].x + PM.ox[hI]; f[j * 4 + 1] = items[j].z + PM.oz[hI]
    }
    flowerAttr.needsUpdate = true
    PM.moving = moving || h.amp > 0.01
  }
  // vieillit le tracé et l'envoie au shader (du doigt vers le plus ancien), + anneaux ; boîte de la zone agitée
  let wkX0 = 0, wkX1 = 0, wkZ0 = 0, wkZ1 = 0
  function wakeBox(x, z, r) {
    if (x - r < wkX0) wkX0 = x - r
    if (x + r > wkX1) wkX1 = x + r
    if (z - r < wkZ0) wkZ0 = z - r
    if (z + r > wkZ1) wkZ1 = z + r
  }
  function wakeUpdate(dt) {
    wakeTrack(dt)
    const uk = U.uWk.value, uw = U.uWkW.value, h = wakeHead
    const life = WK.life, cap = WK.tier.n
    wkX0 = 1e9; wkX1 = -1e9; wkZ0 = 1e9; wkZ1 = -1e9
    let k = 0, prevCid = -1
    if (WK.live) {
      // le doigt lui-même (âge 0) ; tant que son tracé n'a aucun point enregistré, le point en attente le suit
      wakeEmit(h.sp)
      const am = Math.min(h.amp, 1)
      uk[0].set(h.x, h.z, WAKE.r0, WK.ea * 0.6 * am)
      uw[0].set(WAKE.w0, (WK.eb + WAKE.dimple) * am, WAKE.wf0, -1)
      wakeBox(h.x, h.z, WAKE.r0 + 3 * WAKE.w0)
      k = 1; prevCid = WK.chain
      const newest = (WK.head - 1 + WAKE_NMAX) % WAKE_NMAX
      if (WK.pend && (WK.n === 0 || WK.cid[newest] !== WK.chain)) {
        uk[1].set(WK.px, WK.pz, WAKE.r0, WK.pa * 0.6)
        uw[1].set(WAKE.w0, WK.pb, WAKE.wf0, 1)
        k = 2
      }
    }
    for (let j = 0; j < WK.n && k < cap; j++) {
      const i = (WK.head - 1 - j + 2 * WAKE_NMAX) % WAKE_NMAX
      const tau = time - WK.t[i]
      if (tau > life) break                                     // les suivants sont plus anciens
      const tail = 1 - sstep(0.6 * life, life, tau)
      const R = WAKE.r0 + WK.c[i] * tau
      const A = WK.a[i] * (0.6 + 0.4 * sstep(0, 0.25, tau)) * Math.exp(-tau / WAKE.tauA) * tail
      const w = WAKE.w0 + WAKE.kw * tau
      const B = WK.b[i] * Math.exp(-tau / WAKE.tauB) * tail
      const wf = WAKE.wf0 + WAKE.kf * tau
      uk[k].set(WK.x[i], WK.z[i], R, A)
      uw[k].set(w, B, wf, WK.cid[i] !== prevCid ? -1 : 1)
      WK.age[k] = tau
      prevCid = WK.cid[i]
      wakeBox(WK.x[i], WK.z[i], Math.max(R + 3.2 * w, 3.2 * wf))
      k++
    }
    if (WK.live && k === 1 && WK.pend) {
      // doigt posé depuis longtemps (tracé entièrement éteint) : le point en attente le suit → petite dépression seule
      uk[1].set(WK.px, WK.pz, WAKE.r0, 0)
      uw[1].set(WAKE.w0, 0, WAKE.wf0, 1)
      k = 2
    }
    WK.up = k >= 2 ? k : 0
    U.uWkN.value = WK.up
    U.uWkCap.value = WK.live ? 1 : 0
    // bouts de tracé : hauteur nulle (fondu, jamais d'anneau) ; le bout d'un tracé fermé (doigt levé) s'éteint en 0,3 s
    for (let j = 0; j < WK.up; j++) {
      if (j + 1 >= WK.up || uw[j + 1].w < 0) { uk[j].w = 0; uw[j].y = 0 }
      else if (uw[j].w < 0 && !(j === 0 && WK.live)) { const f = 1 - sstep(0, 0.3, WK.age[j]); uk[j].w *= f; uw[j].y *= f }
    }
    // anneaux du doigt qui se pose
    const rg = WAKE.ring
    let rings = false
    for (let i = 0; i < 2; i++) {
      const tau = time - WK.rt[i], u = U.uWkR.value[i]
      if (tau < 0 || tau > rg.life || WK.rk[i] <= 0) { u.w = 0; continue }
      const R = rg.r0 + rg.c * tau, w = rg.w0 + rg.kw * tau
      u.set(WK.rx[i], WK.rz[i], R, rg.a * WK.rk[i] * sstep(0, 0.08, tau) * Math.exp(-tau / rg.tau) * (1 - sstep(0.5 * rg.life, rg.life, tau)))
      if (i === 0) U.uWkRw.value.x = w; else U.uWkRw.value.y = w
      wakeBox(WK.rx[i], WK.rz[i], R + 3.2 * w)
      rings = true
    }
    const any = WK.up > 0 || rings
    // limité au bassin long (marge 2 cm) : la vasque et le bassin rond ne paient jamais le sillage
    if (any) U.uWkBox.value.set(Math.max(wkX0, P.x0 - 0.02), Math.min(wkX1, P.x1 + 0.02), Math.max(wkZ0, P.z0 - 0.02), Math.min(wkZ1, P.z1 + 0.02))
    else U.uWkBox.value.set(1, -1, 1, -1)
    WK.active = any
  }
  function wakeSetQuality(q) {
    if (!WAKE.tiers[q]) return
    WK.tier = WAKE.tiers[q]; WK.tierName = q
    WK.life = Math.min(2.4, (WK.tier.n - 1) * WK.tier.dt)
  }

  // jet : hauteur, vitesses de la couronne et rayon de retombée dans la coupe selon l'énergie
  function updateJet(e) {
    const H = JET_H_MAX * e * e
    const vh = CROWN_VH * e, vy = CROWN_VY * e
    jet.uJet.value.set(jet.y0, H, vh, vy)
    const drop = H + jet.y0 - Fo.bowlWaterY
    const T = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(drop, 0))) / G
    U.uBowl.value.z = clamp(0.003 + vh * T, 0.02, Fo.bowlR - 0.06)
  }
  updateJet(energy)

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
      if (energyTarget === 0 && energyNow < 0.002) energyNow = 0
      U.uEnergy.value = energyNow
      updateJet(energyNow)
      if (camera) {
        group.updateWorldMatrix(true, false)
        invM.copy(group.matrixWorld).invert()
        camera.getWorldPosition(camW)
        U.uCam.value.copy(camW.applyMatrix4(invM))
      }
      koi.update(dt, time)
      petals.update(dt, time, energyNow)
      wakeUpdate(dt)
      padsUpdate(dt)
    },
    /**
     * Sillage du doigt sur le bassin long (piloté par emergeFx.wake ; repère jardin, mètres) : UNE onde lisse,
     * étrave en V + sillon doux, sans anneaux en chapelet, écume ni particules. Rien n'est alloué ; sans doigt ni
     * tracé vivant, l'eau ne paie rien (zone vide).
     *  - head(x, z, amp = 1, vx = 0, vz = 0, radius) : doigt posé sur l'eau, à chaque image (position lissée,
     *    vitesse en m/s) ; amp 0 = levé / sorti du bassin long : le tracé se ferme et s'éteint seul (~2 s).
     *  - close() : même chose que head(…, 0).
     *  - ring(x, z, k = 1) : un seul anneau très doux (doigt qui se pose, tap) ; k = force 0..1,5.
     *  - add(x, z, { ring }) : compatibilité (ancien chapelet) → un anneau doux, k = ring / 0,3.
     *  - kick(x, z, radius = 0.5, speed = 0.3) : poussée radiale immédiate des nénuphars et bractées.
     *  - setQuality('high' | 'medium' | 'low') : nombre de points du tracé (24 / 16 / 12), par uniforme.
     *  - clear() ; active (eau agitée) ; samples (points enregistrés) ; params ; trail (diagnostic) ; inPool.
     */
    wake: {
      head: wakeHeadSet,
      close() { wakeHeadSet(wakeHead.x, wakeHead.z, 0) },
      ring: wakeRing,
      add(x, z, o) { return wakeRing(x, z, clamp(((o && o.ring) ?? 0.3) / 0.3, 0.2, 1.5)) },
      kick(x, z, radius = 0.5, speed = 0.3) {
        if (!(x === x) || !(z === z)) return
        padKick(x, z, radius, speed)
        petals.kick(x, z, radius, speed * 0.8)
      },
      setQuality: wakeSetQuality,
      clear() {
        WK.n = 0; WK.head = 0; WK.t.fill(-100); WK.live = false; WK.pend = false; WK.rest = false
        WK.rt.fill(-100); WK.rk.fill(0)
        wakeHead.amp = 0
        wakeUpdate(0)
      },
      get active() { return WK.active },
      get samples() { return WK.added },
      get params() { return WAKE },
      get trail() { return { points: WK.up, stored: WK.n, live: WK.live, rest: WK.rest, chain: WK.chain, tier: WK.tierName, life: WK.life } },
      inPool: inLongPool,
    },
    /** Rides + gerbe + koï qui se rassemblent. `point` en repère jardin (THREE.Vector3). */
    splash(point, strength = 1) {
      const body = waterBodyAt(point.x, point.z, point.y)
      if (!body) return false
      const level = body === 'pool' ? P.waterY : body === 'basin' ? Fo.waterY : Fo.bowlWaterY
      emitRipple(point.x, point.z, level, 1.0 * strength, 0)
      emitRipple(point.x, point.z, level, 0.5 * strength, 0.28)
      drops.extra.uBurst.value.set(point.x, level, point.z, time)
      drops.extra.uBurstK.value = clamp(strength, 0.2, 1.5)
      petals.push(point.x, point.z, level, strength, time)
      if (body === 'pool') koi.gather(point, 6.5)
      return true
    },
    /** 0 = fontaine au repos (coupe parfaitement immobile), 1 = jet plein (28 cm). */
    setEnergy(v) { energyTarget = clamp(v, 0, 1) },
    getEnergy: () => energyNow,
    /** Branche (ou retire avec null) les sondes de reflet ; cf. loadReflectionProbes(). */
    setReflectionCube,
    /**
     * Bake des sondes au runtime depuis la scène (repli si les cubemaps Blender ne sont plus à jour).
     * Le groupe FX est masqué pendant la capture ; les cubes sont orientés dans le repère jardin.
     */
    captureReflections(renderer, scene, { size = 256 } = {}) {
      const out = {}
      const wasVisible = group.visible
      group.visible = false
      group.updateWorldMatrix(true, false)
      const wq = new THREE.Quaternion(), ws = new THREE.Vector3(), wp = new THREE.Vector3()
      group.matrixWorld.decompose(wp, wq, ws)
      for (const name of ['pool', 'basin', 'cup']) {
        const s = name === 'pool' ? size * 2 : size
        const rt = new THREE.WebGLCubeRenderTarget(s, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, type: THREE.HalfFloatType })
        const cam = new THREE.CubeCamera(0.01 * ws.x, 100 * ws.x, rt)
        cam.position.fromArray(MAJORELLE_PROBES[name].position).multiply(ws).applyQuaternion(wq).add(wp)
        cam.quaternion.copy(wq)
        cam.updateMatrixWorld(true)
        cam.update(renderer, scene)
        out[name] = { texture: rt.texture, position: MAJORELLE_PROBES[name].position, size: s, renderTarget: rt }
      }
      group.visible = wasVisible
      setReflectionCube(out)
      return out
    },
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
    /** Stats du module : draw calls, triangles (instances comprises) et contenu. */
    stats() {
      let calls = 0, tris = 0
      group.traverse((o) => {
        if (!o.visible || !(o.isMesh || o.isPoints)) return
        calls++
        if (o.isPoints) return
        const g = o.geometry
        const t = (g.index ? g.index.count : g.attributes.position.count) / 3
        const inst = o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1)
        tris += t * inst
      })
      return {
        drawCalls: calls, triangles: Math.round(tris), koi: koi.count, pads: pads.length,
        flowers: Q.flowers, buds: Q.buds, petals: Q.petals, petalTriads: petals.triads, droplets: drops.count,
      }
    },
    dispose() {
      if (group.parent) group.parent.remove(group)
      group.traverse((o) => { if (o.geometry) o.geometry.dispose() })
      for (const m of materials) m.dispose()
      for (const t of [ctx.normTex, ctx.caustTex, ctx.padShadowTex]) t.dispose()
    },
    /** Accès debug (textures procédurales, uniformes). */
    debug: { normTex: ctx.normTex, caustTex: ctx.caustTex, padShadowTex: ctx.padShadowTex, uniforms: U, water: W, koi: ctx.koiUniforms, pads, flowers: flowers.items, jet },
  }
}
