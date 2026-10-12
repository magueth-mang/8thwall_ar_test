// « BLEU INTERDIT » : le flacon au heurtoir (SPEC_PERFUME §2.4, §2.5, §3 ; WP3).
//
// Conventions de lib/ysl/hero.js : `root` (origine = centre de la base, échelle = hauteur en unités marqueur),
// `spin` (lacet propre), `norm` (GLB en mètres réels × 1 / meta.height). Le pivot du capuchon vit dans `root`
// (un capuchon rangé n'orbite pas). Aucune allocation par image.
//
// 5 appels de rendu : PB_Juice (0.5), PB_Glass (11.5), PB_Gold, PB_Cap (file opaque), StudGlints (13).
// Aucune transmission. Les niveaux de qualité sont des uniforms (aucune recompilation).
//
//   const tex = await loadPerfumeTextures('/majorelle/perfume/')
//   const studioCube = makeStudioCube(renderer, hdrEquirect, 256)
//   const p = createPerfume(gltf, { meta, textures: tex, probes, studioCube, gardenMeta, lights: { key, rim }, quality })
//   chaque image : p.update(dt, { camera, anchor, gardenRoot })

import * as THREE from 'three'
import { PB_NAMES, PB_RENDER_ORDER } from '@/lib/majorelle/perfumeConfig'
import {
  PB_SHELL_VERTEX, PB_GLASS_FRAGMENT, PB_JUICE_FRAGMENT, patchGoldMaterial, PB_GLINT_VERTEX, PB_GLINT_FRAGMENT,
} from '@/lib/majorelle/perfumeShaders'
import { createScreenGrab } from '@/lib/majorelle/screenRefraction'

const D2R = Math.PI / 180
const TIERS = { low: 0, medium: 1, high: 2 }
// Seuil des éclats de clous : la spec dit 0,985 avec les normales du méta, mais elles valent toutes +Z (aucun éclat
// sauf si la caméra est dans le miroir de la clé). Les clous martelés ont ici chacun une normale propre (±0,5 rad) et
// le seuil est 0,94 (R à moins de 20° de la clé) : 0 à 3 éclats qui voyagent sur l'arc quand le flacon se balance.
const GLINT_COS = 0.94
const A75 = 75 * D2R
const SLOSH_LIM = Math.tan(25 * D2R)
const TAU = Math.PI * 2
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }
const smoother = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10) }
const easeOutCubic = (x) => { x = Math.max(0, Math.min(1, x)); return 1 - (1 - x) * (1 - x) * (1 - x) }
const easeInOutSine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)))
const easeInOutCubic = (x) => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

// ---- heurtoir (ÉCLOSION) : la main soulève l'anneau sans hâte, le tient un instant, le laisse tomber ; la frappe
// rend la main à la physique (pendule contre le verre, rebonds amortis). Angles en rad, temps en s.
const KNOCK = { lift: 0.38, hang: 0.12, fall: 0.11, top: 44 * D2R, extra: 3 * D2R, rebound: 1.45, restitution: 0.35 }
KNOCK.strikeAt = KNOCK.lift + KNOCK.hang + KNOCK.fall
// pendule secondaire du heurtoir dans le plan de la face (roulis autour de l'œil) : il pend vers la gravité apparente
const RING_G = 42, RING_W2 = 10.5 * 10.5, RING_ROLL_MAX = 0.55
// capuchon « rituel » (CÈDRE) : unités de root (1 = hauteur du flacon). Un tour de filetage, décollage, arc vers la place.
// Place : au-dessus de l'épaule droite, à côté du col, dans l'embrasure de la porte (jamais sur le cartel) ; plan du flacon.
const CAP = { pitch: 0.028, liftOff: 0.09, park: [0.235, 0.66, 0.0], parkTilt: -0.12, turn: 0.75 * TAU, over: 0.3 }
// angle de repos garé : le prolongement du dévissage (+0,25 rad), jamais de retour en arrière
CAP.parkTurn = CAP.turn + CAP.over + 0.25
const CAP_OPEN = { grip: 0.08, unscrew: 0.80, lift: 1.02, park: 1.58 }
// retour en 0,62 s (aussi posé que le départ), descente, vissage qui ralentit, dernier seizième de tour sec (clic)
const CAP_CLOSE = { back: 0.62, down: 0.78, screw: 1.34, snap: 1.40 }

// ---- or du jus (CÈDRE) : injecté dans PB_JUICE_FRAGMENT / PB_GLASS_FRAGMENT (perfumeShaders.js reste intact).
//  1. couche d'or vivante au pied du jus (uCharge) : interface ondulante, stries lentes. Son temps propre (uSwirl.w) avance
//     pendant le panache puis s'apaise en ≈ 3 s (la couche se fige, ondulée) ; un ballottement la réveille un instant ;
//  2. panache d'or (uSwirl = intensité, hauteur de la tête 1.15 → −0.2, temps du panache, temps de la couche) : un filet
//     « encre dans l'eau » descend du col ; sa tête est un nuage asymétrique déchiré en filaments fins (crêtes d'un bruit
//     déformé deux fois, advecté vers le bas) qui s'amincissent en tombant, puis s'éteint dans la couche qu'il nourrit.
//  Le cobalt reste entre les filaments (lapis-lazuli et pyrite, jamais lilas). Programmes compilés au prewarm, comme avant.
const KC_OLD = 'float kc = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.0, 0.16, hN ) ), 0.0, 1.0 );'
const KC_NEW = /* glsl */`float kc, kcLine, kcTop;
    vec3 PmS = mix( vPl, Pe, 0.45 );
    {
      float xs = PmS.x / 0.026, stir = 1.0 + 0.8 * uSwirl.x, wt = uSwirl.w;
      float hw = hN - ( 0.010 * sin( xs * 4.3 + wt * 0.83 ) + 0.006 * sin( xs * 9.7 - wt * 1.31 + 1.3 ) + 0.0035 * sin( xs * 17.0 + wt * 2.1 + 0.4 ) ) * stir;
      // une vraie couche liquide : interface nette (et non un dégradé de poussière), un fil de lumière à sa surface
      kc = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.05, 0.145, hw ) ), 0.0, 1.0 );
      kc *= 0.86 + 0.14 * sin( xs * 9.0 + hN * 30.0 - wt * 0.7 + 2.0 * sin( xs * 3.0 + wt * 0.4 ) );
      kcLine = exp( -pbSq( ( hw - 0.118 ) / 0.011 ) ) * clamp( uCharge * 2.0, 0.0, 1.0 );
      kcTop = smoothstep( -0.02, 0.12, hw );
    }`
const SWIRL_ANCHOR = 'col = mix( col, vec3( 1.0, 0.74, 0.32 ) * ( 0.75 + 0.45 * kc ), kc * 0.9 );'
const SWIRL_GLSL = /* glsl */`col = mix( col, vec3( 0.95, 0.63, 0.21 ) * ( 0.5 + 0.3 * kc + 0.3 * kcTop ), kc * 0.88 );
    col += vec3( 1.0, 0.82, 0.5 ) * kcLine * 0.35;
    if ( uSwirl.x > 0.002 ) {
      vec2 p = vec2( PmS.x / 0.026, ( PmS.y - uFloorY ) / max( uFillY - uFloorY, 1e-3 ) );
      float st = uSwirl.z, hd = uSwirl.y, fk = clamp( ( 1.15 - hd ) / 1.4, 0.0, 1.0 );
      // déformation du domaine (2 octaves, advectée vers le bas) : l'or est entraîné par le jus, jamais une forme dessinée
      vec2 a = vec2( p.x * 1.9, p.y * 2.3 + st * 0.45 );
      vec2 w1 = vec2( pbVN( a ), pbVN( a + vec2( 5.2, 1.3 ) ) ) - 0.5;
      vec2 b = vec2( p.x * 4.1, p.y * 4.8 + st * 0.8 ) + w1 * 1.7;
      vec2 w2 = vec2( pbVN( b + vec2( 1.7, 9.2 ) ), pbVN( b + vec2( 8.3, 2.8 ) ) ) - 0.5;
      vec2 q = p + w1 * ( 0.07 + 0.16 * fk ) + w2 * ( 0.03 + 0.06 * fk );
      float above = q.y - hd;
      // tige : fil torsadé qui ondule du col jusqu'à la tête, dense près de la tête, se dilue en remontant
      float wob = 0.05 * sin( q.y * 6.0 - st * 2.0 ) + 0.025 * sin( q.y * 11.0 + st * 1.5 );
      float sw = 0.022 + 0.04 * clamp( above, 0.0, 1.0 );
      float stem = exp( -pbSq( ( q.x - wob ) / sw ) ) * smoothstep( -0.02, 0.1, above ) * ( 0.3 + 0.7 * smoothstep( 0.9, 0.2, above ) );
      stem *= 0.55 + 0.45 * pbVN( vec2( ( q.x - wob ) * 14.0, q.y * 3.0 - st * 1.2 ) );
      // tête : anneau tourbillonnaire qui tombe — un chapeau dense en tête, liseré clair sur le front, penché d'un côté ;
      // derrière lui, un voile de filaments qui traînent et s'évasent (de plus en plus fins à mesure qu'il tombe)
      float lean = 0.12 * fk * sin( 1.3 + st * 0.35 );
      float cx = wob * 0.6 + lean, rx = 0.08 + 0.26 * fk;
      vec2 dc = vec2( ( q.x - cx ) / rx, ( above - 0.03 ) / ( 0.05 + 0.07 * fk ) );
      float cap = exp( -dot( dc, dc ) * 1.7 );
      float rim = exp( -pbSq( ( length( dc ) - 0.8 ) / 0.25 ) ) * smoothstep( 0.5, -0.5, dc.y );
      float side = ( q.x - cx ) * lean >= 0.0 ? 1.25 : 0.8;
      float vw = rx * side * ( 0.75 + 1.7 * clamp( above, 0.0, 0.6 ) );
      float u = ( q.x - cx ) / vw;
      float veil = exp( -u * u * 1.5 ) * smoothstep( -0.01, 0.07, above ) * smoothstep( 0.5 + 0.3 * fk, 0.04, above );
      vec2 r = vec2( u * 3.4 + w2.x * 1.3, above * 1.7 - st * 0.3 + w1.y * 0.9 );
      float n = pbVN( r ) * 0.66 + pbVN( r * 2.03 + vec2( 3.1, 0.7 ) ) * 0.34;
      float strands = pow( 1.0 - abs( 2.0 * n - 1.0 ), mix( 4.0, 9.0, fk ) );
      float head = cap * ( 0.5 + 0.5 * strands ) * ( 1.1 - 0.4 * fk ) + rim * 0.45 * ( 1.0 - 0.5 * fk ) + veil * strands * 1.15;
      float body = clamp( stem * 0.9 + head, 0.0, 1.0 );
      float halo = ( cap + veil * 0.6 ) * 0.5 * ( 1.0 - 0.4 * fk ) + exp( -pbSq( ( q.x - wob ) / ( sw * 3.2 + 0.07 ) ) ) * smoothstep( -0.15, 0.2, above ) * smoothstep( 1.1, 0.4, above ) * 0.4;
      float gh = pbHash( floor( p * vec2( 34.0, 26.0 ) ) + 7.0 );
      float glit = step( 0.93, gh ) * pow( 0.5 + 0.5 * sin( st * 7.0 + gh * 40.0 ), 3.0 );
      float m = uSwirl.x * smoothstep( 1.22, 1.0, p.y ) * smoothstep( -0.05, 0.08, p.y );
      col = mix( col, vec3( 0.95, 0.62, 0.20 ) * ( 0.6 + 0.55 * body ), clamp( body * m, 0.0, 1.0 ) * 0.9 );
      col += vec3( 0.55, 0.32, 0.08 ) * halo * m * 0.2;
      col += vec3( 1.0, 0.8, 0.45 ) * glit * body * m * 0.8;
    }`
const VN_GLSL = /* glsl */`
float pbVN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pbHash( i ), pbHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pbHash( i + vec2( 0.0, 1.0 ) ), pbHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {`
// verre : la teinte du jus vue sous le satin suit la même interface ondulante et le même or
const KCG_OLD = 'float kcG = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.0, 0.16, ( Q.y - uFloorY ) / max( uFillY - uFloorY, 1e-3 ) ) ), 0.0, 1.0 );'
const KCG_NEW = /* glsl */`float kcG;
    {
      float xs = Q.x / 0.026, hq = ( Q.y - uFloorY ) / max( uFillY - uFloorY, 1e-3 ), stir = 1.0 + 0.8 * uSwirl.x, wt = uSwirl.w;
      float hw = hq - ( 0.010 * sin( xs * 4.3 + wt * 0.83 ) + 0.006 * sin( xs * 9.7 - wt * 1.31 + 1.3 ) + 0.0035 * sin( xs * 17.0 + wt * 2.1 + 0.4 ) ) * stir;
      kcG = clamp( uCharge * 2.2 * ( 1.0 - smoothstep( 0.05, 0.145, hw ) ), 0.0, 1.0 );
    }`
const JT_OLD = 'juiceTone = mix( juiceTone, vec3( 1.0, 0.72, 0.35 ) * ( 0.55 + 0.35 * kcG ), kcG * 0.85 );'
const JT_NEW = 'juiceTone = mix( juiceTone, vec3( 0.95, 0.64, 0.22 ) * ( 0.55 + 0.3 * kcG ), kcG * 0.85 );'

// ---- roulis du heurtoir : injecté après le patch or de perfumeShaders.js (rotation autour de +Z par l'œil) --------
const ROLL_NORMAL = /* glsl */`
  {
    float pbRc = cos( uRingRoll ), pbRs = sin( uRingRoll );
    vec3 rn2 = vec3( pbRc * objectNormal.x - pbRs * objectNormal.y, pbRs * objectNormal.x + pbRc * objectNormal.y, objectNormal.z );
    objectNormal = mix( objectNormal, rn2, aFlags.r );
  }
  #include <defaultnormal_vertex>`
const ROLL_POS = /* glsl */`
  {
    float pbRc = cos( uRingRoll ), pbRs = sin( uRingRoll );
    vec3 q2 = transformed - uRingPivot;
    q2 = vec3( pbRc * q2.x - pbRs * q2.y, pbRs * q2.x + pbRc * q2.y, q2.z ) + uRingPivot;
    transformed = mix( transformed, q2, aFlags.r );
  }
  #include <project_vertex>`
// chasse symétrique (uChaseSym = 1) : la vague monte des deux pieds de l'arc à la fois jusqu'au médaillon
const CHASE_OLD = 'exp( -pow2( ( vPbUv1.x - uChase ) * 12.0 ) )'
const CHASE_NEW = 'exp( -pow2( ( mix( vPbUv1.x, min( vPbUv1.x, 1.0 - vPbUv1.x ) * 2.0, uChaseSym ) - uChase ) * 12.0 ) )'
// Les uniforms scalaires commencent par un champ `pbNum` : leur forme cachée V8 (distincte de { value } des
// uniforms objets) ne voit que des nombres, donc `value` reste un double mutable en place (aucune boîte allouée).

// ---------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------
function dataTex(r, g, b, a = 255, srgb = false) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.needsUpdate = true
  t.userData.pbFallback = true
  return t
}

/**
 * Charge les textures du flacon (WP2). Les fichiers manquants retombent sur des textures 1×1 neutres (avertissement).
 * T_PB_glass : alpha stocké en 128..255 (facette, décodée par pbFacet) pour que WebKit garde le RGB ; flipY = false (les shaders lisent 1 − v).
 * @returns {Promise<{ masks, rosette, goldN, poster, doorMask }>}
 */
export async function loadPerfumeTextures(base = '/majorelle/perfume/') {
  const b = base.endsWith('/') ? base : base + '/'
  const tl = new THREE.TextureLoader()
  const load = (file, fallback, setup) => new Promise((resolve) => {
    tl.load(b + file, (t) => { setup(t); t.needsUpdate = true; resolve(t) }, undefined, () => {
      console.warn(`[perfume] texture manquante : ${b + file} (repli neutre)`)
      resolve(fallback)
    })
  })
  const data = (t) => { t.colorSpace = THREE.NoColorSpace }
  const loadMasks = async () => {
    const setup = (t) => {
      t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.premultiplyAlpha = false
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
      t.anisotropy = 4
    }
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
      try {
        const r = await fetch(b + 'T_PB_glass.png')
        if (!r.ok) throw new Error(String(r.status))
        const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
        const t = new THREE.Texture(bmp)
        setup(t); t.needsUpdate = true
        return t
      } catch (e) { /* repli TextureLoader */ }
    }
    return load('T_PB_glass.png', dataTex(0, 128, 0, 0), setup)
  }
  const [masks, rosette, goldN, poster, doorMask] = await Promise.all([
    loadMasks(),
    load('T_PB_rosette.png', dataTex(0, 0, 0), data),
    load('T_PB_gold_n.png', dataTex(128, 128, 255), (t) => { data(t); t.anisotropy = 4 }),
    load('backdrop_poster_512.jpg', dataTex(128, 128, 128, 255, true), (t) => { t.colorSpace = THREE.SRGBColorSpace }),
    load('door_mask_256.png', dataTex(0, 0, 0), data),
  ])
  return { masks, rosette, goldN, poster, doorMask }
}

const EQUIRECT_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize( ( modelMatrix * vec4( position, 0.0 ) ).xyz );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`
const EQUIRECT_FS = /* glsl */`
uniform sampler2D tEquirect;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec2 uv = vec2( atan( d.z, d.x ) * 0.15915494309189535 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * 0.3183098861837907 + 0.5 );
  gl_FragColor = vec4( texture2D( tEquirect, uv ).rgb, 1.0 );
}`

/**
 * Cube studio 256 px mipmappé depuis l'équirectangulaire HDR (photo_studio_01_1k.hdr). HalfFloat, ou UnsignedByte
 * si le half-float n'est pas rendu (iOS). Ne modifie pas la texture source (l'appelant la libère ensuite).
 */
export function makeStudioCube(renderer, hdrEquirect, size = 256) {
  if (!renderer || !hdrEquirect) return null
  const ext = renderer.extensions
  const half = !!(ext && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')))
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  })
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace
  const mat = new THREE.ShaderMaterial({
    uniforms: { tEquirect: { value: hdrEquirect } }, vertexShader: EQUIRECT_VS, fragmentShader: EQUIRECT_FS,
    side: THREE.BackSide, blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
  })
  const box = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), mat)
  const cam = new THREE.CubeCamera(0.1, 10, rt)
  const prevTM = renderer.toneMapping
  cam.update(renderer, box)
  renderer.toneMapping = prevTM
  box.geometry.dispose(); mat.dispose()
  rt.texture.userData.renderTarget = rt
  rt.texture.userData.halfFloat = half
  return rt.texture
}

function makeStarTexture() {
  if (typeof document === 'undefined') return dataTex(255, 255, 255)
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S)
  g.globalCompositeOperation = 'lighter'
  const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.22)
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.35, 'rgba(255,255,255,0.45)'); core.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = core; g.fillRect(0, 0, S, S)
  // 4 rayons fins (pas d'étoile à 8 branches)
  for (let k = 0; k < 2; k++) {
    g.save(); g.translate(S / 2, S / 2); g.rotate(k * Math.PI / 2)
    const lg = g.createLinearGradient(-S / 2, 0, S / 2, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = lg
    g.beginPath(); g.moveTo(-S / 2, 0); g.lineTo(0, -1.3); g.lineTo(S / 2, 0); g.lineTo(0, 1.3); g.closePath(); g.fill()
    g.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

function makeGreyCube() {
  if (typeof document === 'undefined') return null
  const faces = []
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas'); c.width = c.height = 4
    const g = c.getContext('2d'); g.fillStyle = i === 2 ? '#8a96b8' : i === 3 ? '#2a3150' : '#4a5888'; g.fillRect(0, 0, 4, 4)
    faces.push(c)
  }
  const t = new THREE.CubeTexture(faces)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

// ---------------------------------------------------------------------------------------------------------
// Volume de la cavité : quantiles par direction (le plan de remplissage reste horizontal quand le flacon roule)
// ---------------------------------------------------------------------------------------------------------
function buildFillQuantiles(meta) {
  const O = meta.outline || []
  const cav = meta.cavity || {}
  const inset = cav.inset ?? 0.005, y0 = cav.floorY ?? 0.012, y1 = cav.topY ?? 0.0825
  const n0 = O.length
  const inside = (x, y) => {
    let c = false
    for (let i = 0, j = n0 - 1; i < n0; j = i++) {
      const xi = O[i][0], yi = O[i][1], xj = O[j][0], yj = O[j][1]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const dist2 = (x, y) => {
    let best = 1e9
    for (let i = 0, j = n0 - 1; i < n0; j = i++) {
      const ax = O[j][0], ay = O[j][1], bx = O[i][0] - ax, by = O[i][1] - ay
      const l2 = bx * bx + by * by || 1e-12
      const t = clamp(((x - ax) * bx + (y - ay) * by) / l2, 0, 1)
      const dx = x - ax - bx * t, dy = y - ay - by * t
      const d = dx * dx + dy * dy
      if (d < best) best = d
    }
    return best
  }
  const pts = []
  const st = 0.001
  if (n0 > 2) {
    for (let y = y0 + st / 2; y < y1; y += st) {
      for (let x = -0.036 + st / 2; x < 0.036; x += st) {
        if (inside(x, y) && dist2(x, y) >= inset * inset) pts.push(x, y)
      }
    }
  }
  if (pts.length < 20) { // repli : rectangle de la cavité nominale
    for (let y = y0 + st / 2; y < y1; y += st) for (let x = -0.026 + st / 2; x < 0.026; x += st) pts.push(x, y)
  }
  const n = pts.length / 2
  const ANG = 72
  const tables = []
  for (let k = 0; k < ANG; k++) {
    const a = (k / ANG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
    const arr = new Float32Array(n)
    for (let i = 0; i < n; i++) arr[i] = pts[2 * i] * c + pts[2 * i + 1] * s
    arr.sort()
    tables.push(arr)
  }
  return { tables, n, ANG }
}

// ---------------------------------------------------------------------------------------------------------
// createPerfume
// ---------------------------------------------------------------------------------------------------------
/**
 * @param {object} gltf  résultat de GLTFLoader (perfume.glb)
 * @param {object} o     { meta, textures, probes, studioCube, gardenMeta, lights: { key, rim }, quality,
 *                         onStrike, onTink, onCapClick, anchor?, gardenRoot? }
 */
export function createPerfume(gltf, o = {}) {
  const meta = o.meta
  if (!meta) throw new Error('[perfume] meta (perfume_meta.json) requis')
  const tex = o.textures || {}
  const gm = o.gardenMeta || { K: 0.3002661401098901, X_OFF: 0.005859375, Z_OFF: -0.5323660714285714 }
  const lights = o.lights || {}
  const own = [] // ressources créées ici (libérées par dispose)
  const fb = (t, make) => { if (t) return t; const f = make(); own.push(f); return f }

  const H = meta.height || 0.126
  const cav = meta.cavity || {}

  // ---- hiérarchie ---------------------------------------------------------------------------------------
  const model = gltf.scene
  model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.set(1, 1, 1)
  const root = new THREE.Group(); root.name = 'PB_Root'
  const spin = new THREE.Group(); spin.name = 'PB_Spin'
  const norm = new THREE.Group(); norm.name = 'PB_Norm'
  const s0 = 1 / H
  norm.scale.setScalar(s0)
  root.add(spin); spin.add(norm); norm.add(model)
  const byName = (n) => model.getObjectByName(n)
  const glass = byName(PB_NAMES.glass), juice = byName(PB_NAMES.juice), gold = byName(PB_NAMES.gold)
  const cap = byName(PB_NAMES.cap), refl = byName(PB_NAMES.proxy)
  if (!glass || !juice || !gold || !cap) console.warn('[perfume] nœuds manquants dans le GLB', { glass: !!glass, juice: !!juice, gold: !!gold, cap: !!cap })
  if (refl) refl.visible = false

  // capuchon : pivot dans root (pas dans spin)
  const seat = new THREE.Vector3().fromArray(meta.capSeat || [0, 0.095, 0])
  const capPivot = new THREE.Group(); capPivot.name = 'PB_CapPivotRT'
  capPivot.position.set(0, seat.y * s0, 0)
  capPivot.scale.setScalar(s0)
  const seatN = seat.y * s0
  root.add(capPivot)
  if (cap) { capPivot.add(cap); cap.position.set(0, 0, 0); cap.quaternion.identity(); cap.scale.set(1, 1, 1) }

  // drapeaux de l'or : COLOR_0 → aFlags (three ne s'en sert jamais comme teinte)
  if (gold) {
    const g = gold.geometry
    if (g.attributes.color && !g.attributes.aFlags) { g.setAttribute('aFlags', g.attributes.color); g.deleteAttribute('color') }
  }

  // ---- uniforms partagés ----------------------------------------------------------------------------------
  const probeTex = o.probes?.pool?.texture || o.studioCube || fb(null, makeGreyCube)
  const studioTex = o.studioCube || o.probes?.pool?.texture || probeTex
  const U = {
    uWorldToGarden: { value: new THREE.Matrix4() },
    uWorldToMarker: { value: new THREE.Matrix4() },
    uCamLocal: { value: new THREE.Vector3() },
    uOutside: { pbNum: 1, value: 0 },
    uProbe: { value: probeTex },
    uProbePos: { value: new THREE.Vector3().fromArray(o.probes?.pool?.position || [0, 0.25, -4.0]) },
    uRoomMin: { value: new THREE.Vector3(-3.6, 0, -9.6) },
    uRoomMax: { value: new THREE.Vector3(3.6, 4.0, -0.45) },
    uProbeGain: { pbNum: 1, value: 1.15 },
    uStudio: { value: studioTex },
    uStudioGain: { pbNum: 1, value: 1.0 },
    uPoster: { value: fb(tex.poster, () => dataTex(128, 128, 128, 255, true)) },
    uDoorMask: { value: fb(tex.doorMask, () => dataTex(0, 0, 0)) },
    uPosterGain: { value: new THREE.Vector3(1, 1, 1) },
    uMarkerAspect: { pbNum: 1, value: 1.3393 },
    uGardenMeta: { value: new THREE.Vector3(gm.K, gm.X_OFF, gm.Z_OFF) },
    uPool: { value: new THREE.Vector4(-0.8, 0.8, -6.3, -1.7) },
    uWaterY: { pbNum: 1, value: 0 },
    uClip: { pbNum: 1, value: 0 },
    uFillP: { value: new THREE.Vector3(0, cav.fillY ?? 0.077, 0) },
    uFillN: { value: new THREE.Vector3(0, 1, 0) },
    uKeyDir: { value: new THREE.Vector3(0.35, 0.8, 0.5).normalize() },
    uKeyCol: { value: new THREE.Color(1, 1, 1) },
    uRimDir: { value: new THREE.Vector3(-0.2, 0.5, -0.85).normalize() },
    uRimCol: { value: new THREE.Color(0, 0, 0) },
    uReveal: { pbNum: 1, value: 2 },
    uScanOrigin: { value: new THREE.Vector3() },
    uScanAxis: { value: new THREE.Vector3(0, 1, 0) },
    uScanHeight: { pbNum: 1, value: 1 },
    uBandColor: { value: new THREE.Color(1.0, 0.78, 0.42).multiplyScalar(2.2) },
    uTier: { pbNum: 1, value: TIERS[o.quality] ?? 2 },
    uTime: { pbNum: 1, value: 0 },
    uGlow: { pbNum: 1, value: 0 },
  }
  // fond réel copié (screenRefraction.js) : le verre et le jus partagent les mêmes uniforms
  const screen = createScreenGrab()
  Object.assign(U, screen.uniforms)
  const GU = { // verre
    uMasks: { value: fb(tex.masks, () => dataTex(0, 128, 0, 0)) },
    uDryT: { pbNum: 1, value: 2 },
    uSheet: { pbNum: 1, value: 0 },
    uShock: { value: new THREE.Vector4(0, 0, -1, 0) },
    uSigmaB: { pbNum: 1, value: 0.03 },
    uGlassAbs: { value: new THREE.Vector3(0.004, 0.0015, 0.0025) },
    uKR: { pbNum: 1, value: 0.7 },
    uKRFacet: { pbNum: 1, value: 0.9 },
    uSatinAlpha: { pbNum: 1, value: 0.55 },
    uSatinScatter: { pbNum: 1, value: 0.18 },
    uF0: { pbNum: 1, value: 0.04 },
    uTirK: { pbNum: 1, value: 0.6 },
    uGlintK: { pbNum: 1, value: 6.0 },
    uCavC: { value: new THREE.Vector3(0, ((cav.floorY ?? 0.012) + (cav.topY ?? 0.0825)) / 2, 0) },
    uCavHalfDepth: { pbNum: 1, value: cav.halfDepth ?? 0.0136 },
    uJuiceTone: { value: new THREE.Vector3(0.012, 0.02, 0.75) },
    uInnerK: { pbNum: 1, value: 1.0 },
    uEdgeK: { pbNum: 1, value: 1.0 },
    uCreaseK: { pbNum: 1, value: 0.8 },
    uDebug: { pbNum: 1, value: 0 },
  }
  const JU = { // jus
    uRosette: { value: fb(tex.rosette, () => dataTex(0, 0, 0)) },
    uSigma: { value: new THREE.Vector3(1.67, 1.40, 0.05) },
    uHalfDepth: { pbNum: 1, value: cav.halfDepth ?? 0.0136 },
    uFloorY: { pbNum: 1, value: cav.floorY ?? 0.012 },
    uFillY: { pbNum: 1, value: cav.fillY ?? 0.077 },
    uCharge: { pbNum: 1, value: 0 },
    uSwirl: { value: new THREE.Vector4(0, 1.15, 0, 0) },
    uRing: { value: new THREE.Vector4(0, 0, -1, 0) },
    uMenW: { pbNum: 1, value: 0.0006 },
    uInScatter: { value: new THREE.Vector3(0.12, 0.16, 1.0) },
    uInScatterK: { pbNum: 1, value: 0.15 },
    uRosetteK: { pbNum: 1, value: 0.06 },
    uScreenLumaK: { pbNum: 1, value: 0.6 },
  }
  const AU = { // or
    uRingPivot: { value: new THREE.Vector3().fromArray(meta.ringPivot || [0, 0.0713, 0.0205]) },
    uRingAngle: { pbNum: 1, value: 0 },
    uRingRoll: { pbNum: 1, value: 0 },
    uChaseSym: { pbNum: 1, value: 0 },
    uPump: { pbNum: 1, value: 0 },
    uPumpTravel: { pbNum: 1, value: meta.actuator?.pumpTravel ?? 0.002 },
    uGardenMix: { pbNum: 1, value: 1 },
    uStrikeFlash: { pbNum: 1, value: 0 },
    uChase: { pbNum: 1, value: -1 },
    uChaseK: { pbNum: 1, value: 0 },
    uAOK: { pbNum: 1, value: 1 },
    uSoftK: { pbNum: 1, value: 2.4 },
    uWarmDir: { value: new THREE.Vector3(0, -0.3, 1).normalize() },
    uWarmCol: { value: new THREE.Color(1.0, 0.80, 0.55).multiplyScalar(0.9) },
    uSoftDir: { value: new THREE.Vector3(-0.5, 0.5, 0.7).normalize() },
    uSoftCol: { value: new THREE.Color(1, 1, 1).multiplyScalar(2.2) },
  }

  // ---- matériaux -----------------------------------------------------------------------------------------
  // or vivant (KC_NEW) : le verre suit la même interface ondulante ; shader d'origine si une ancre manque
  let glassFS = PB_GLASS_FRAGMENT
  if ([KCG_OLD, JT_OLD, 'uniform float uCharge;'].every((k) => glassFS.includes(k))) {
    glassFS = glassFS.replace('uniform float uCharge;', 'uniform float uCharge;\nuniform vec4 uSwirl;').replace(KCG_OLD, KCG_NEW).replace(JT_OLD, JT_NEW)
  } else console.warn('[perfume] or vivant : ancre absente de PB_GLASS_FRAGMENT')
  const glassMat = new THREE.ShaderMaterial({
    name: 'PB_Glass_RT', uniforms: { ...U, ...GU, uCharge: JU.uCharge, uFloorY: JU.uFloorY, uFillY: JU.uFillY, uSwirl: JU.uSwirl }, vertexShader: PB_SHELL_VERTEX, fragmentShader: glassFS,
    side: THREE.FrontSide, transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  // veines d'or (CÈDRE) : injectées une fois à la création (même programme compilé au prewarm, aucun coût hors note)
  let juiceFS = PB_JUICE_FRAGMENT
  if ([SWIRL_ANCHOR, KC_OLD, 'uniform float uCharge;', 'void main() {'].every((k) => juiceFS.includes(k))) {
    juiceFS = juiceFS.replace('uniform float uCharge;', 'uniform float uCharge;\nuniform vec4 uSwirl;').replace('void main() {', VN_GLSL)
      .replace(KC_OLD, KC_NEW).replace(SWIRL_ANCHOR, SWIRL_GLSL)
  } else console.warn('[perfume] veines d\'or : ancre absente de PB_JUICE_FRAGMENT (charge en bande seule)')
  const juiceMat = new THREE.ShaderMaterial({
    name: 'PB_Juice_RT', uniforms: { ...U, ...JU }, vertexShader: PB_SHELL_VERTEX, fragmentShader: juiceFS,
    side: THREE.DoubleSide, transparent: true, blending: THREE.NoBlending, depthWrite: true, depthTest: true,
  })
  const goldU = { ...U, ...AU }
  const goldMat = patchGoldMaterial(new THREE.MeshPhysicalMaterial({
    name: 'PB_Gold_RT', color: 0xd8b25a, metalness: 1, roughness: 0.14, clearcoat: 0,
    normalMap: tex.goldN || null, envMapIntensity: 0.6,
    // liste transparente (opacité 1, rendu identique) dès la création — basculer plus tard recompilerait (OPAQUE) :
    // hors de la cour l'or est dessiné APRÈS la copie d'écran, sinon il se refléterait en double dans le cristal
    transparent: true,
  }), goldU, true)
  { // roulis du heurtoir + chasse symétrique, par-dessus le patch de perfumeShaders.js (repli silencieux si absent)
    const base = goldMat.onBeforeCompile
    goldMat.onBeforeCompile = (sh, r) => {
      base(sh, r)
      const vs = sh.vertexShader
      if (vs.includes('aFlags.r') && vs.includes('#include <defaultnormal_vertex>') && vs.includes('#include <project_vertex>')) {
        sh.vertexShader = vs.replace('#include <common>', '#include <common>\nuniform float uRingRoll;')
          .replace('#include <defaultnormal_vertex>', ROLL_NORMAL).replace('#include <project_vertex>', ROLL_POS)
      }
      if (sh.fragmentShader.includes(CHASE_OLD)) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uChaseSym;').replace(CHASE_OLD, CHASE_NEW)
      }
    }
    goldMat.customProgramCacheKey = () => 'pb-gold-flags-v2-roll'
  }
  const capMat = patchGoldMaterial(new THREE.MeshPhysicalMaterial({
    name: 'PB_Cap_RT', color: 0xd8b25a, metalness: 1, roughness: 0.08, clearcoat: 0,
    normalMap: tex.goldN || null, envMapIntensity: 0.6,
    transparent: true,
  }), goldU, false)
  own.push(glassMat, juiceMat, goldMat, capMat, screen)
  // la copie de l'écran se fait juste avant le premier des deux qui est dessiné (une fois par image)
  if (juice) juice.onBeforeRender = (r) => screen.grab(r)
  if (glass) glass.onBeforeRender = (r) => screen.grab(r)
  if (glass) { glass.material = glassMat; glass.renderOrder = PB_RENDER_ORDER.glass }
  if (juice) { juice.material = juiceMat; juice.renderOrder = PB_RENDER_ORDER.juice }
  if (gold) { gold.material = goldMat; gold.renderOrder = 0 }
  if (cap) { cap.material = capMat; cap.renderOrder = 0 }
  ;[glass, juice, gold, cap].forEach((m) => { if (m) m.frustumCulled = false })

  // ---- clous : reflets étoilés (3 instances additives) -----------------------------------------------------
  const studs = meta.studs || []
  const NS = studs.length
  const studP = [], studN = []
  for (let i = 0; i < NS; i++) {
    const s = studs[i]
    studP.push(new THREE.Vector3(s[0], s[1], s[2]))
    // normale « martelée » propre à chaque clou : les éclats voyagent le long de l'arc quand le flacon se balance
    // répartition en spirale dorée sur un disque de 0,55 rad : une facette martelée attrape la clé presque partout
    const r = 0.55 * Math.sqrt((((i * 7) % NS) + 0.5) / NS), th = i * 2.39996323
    studN.push(new THREE.Vector3(s[3] + r * Math.cos(th), s[4] + r * Math.sin(th), s[5]).normalize())
  }
  const starTex = makeStarTexture(); own.push(starTex)
  const glintGeo = new THREE.PlaneGeometry(1, 1)
  const glintK = new THREE.InstancedBufferAttribute(new Float32Array(3), 1)
  glintGeo.setAttribute('aGlintK', glintK)
  own.push(glintGeo)
  const glintMat = new THREE.ShaderMaterial({
    name: 'PB_StudGlints', uniforms: { uStar: { value: starTex }, uGlintSize: { value: 0.012 }, uGlintCol: { value: new THREE.Color(1.0, 0.93, 0.78).multiplyScalar(1.25) } },
    vertexShader: PB_GLINT_VERTEX, fragmentShader: PB_GLINT_FRAGMENT,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
  })
  own.push(glintMat)
  const glints = new THREE.InstancedMesh(glintGeo, glintMat, 3)
  glints.name = 'PB_StudGlints'
  glints.renderOrder = PB_RENDER_ORDER.studGlints
  glints.frustumCulled = false
  glints.count = 0
  glints.visible = false
  model.add(glints)
  const glintLevel = new Float32Array(NS), glintFlash = new Float32Array(NS), glintScore = new Float32Array(NS)
  // abscisse d'arc de chaque clou (méta : 0 pied gauche → 1 pied droit) et version symétrique (0 aux pieds, 1 au sommet)
  const studArc = new Float32Array(NS), studArcSym = new Float32Array(NS), waveFired = new Uint8Array(NS)
  for (let i = 0; i < NS; i++) { const a = studs[i].length > 6 ? studs[i][6] : i / Math.max(1, NS - 1); studArc[i] = a; studArcSym[i] = Math.min(a, 1 - a) * 2 }
  let waveSym = 1
  const studPA = new Float32Array(NS * 3), studNA = new Float32Array(NS * 3)
  for (let i = 0; i < NS; i++) { studP[i].toArray(studPA, 3 * i); studN[i].toArray(studNA, 3 * i) }
  const glintPick = new Int32Array(3)

  // ---- zone de toucher -------------------------------------------------------------------------------------
  const proxyGeo = new THREE.BoxGeometry(0.62, 1.0, 0.34); own.push(proxyGeo)
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false }); own.push(proxyMat)
  const proxy = new THREE.Mesh(proxyGeo, proxyMat)
  proxy.name = 'PB_TouchProxy'
  proxy.position.y = 0.5
  spin.add(proxy)

  // ---- remplissage ---------------------------------------------------------------------------------------
  const FQ = buildFillQuantiles(meta)
  const qByAngle = new Float32Array(FQ.ANG)
  const fillTab = (cav.fillTable || [[0, cav.floorY ?? 0.012], [1, cav.topY ?? 0.0825]]).map((r) => [r[0], r[1]])
  if (cav.fillFraction != null && cav.fillY != null) {
    for (let i = fillTab.length - 1; i >= 0; i--) if (Math.abs(fillTab[i][0] - cav.fillFraction) < 1e-6) fillTab.splice(i, 1)
    fillTab.push([cav.fillFraction, cav.fillY]); fillTab.sort((a, b) => a[0] - b[0])
  }
  const fillToY = (f) => {
    if (f <= fillTab[0][0]) return fillTab[0][1]
    for (let i = 1; i < fillTab.length; i++) {
      if (f <= fillTab[i][0]) { const a = fillTab[i - 1], b = fillTab[i]; return a[1] + ((b[1] - a[1]) * (f - a[0])) / (b[0] - a[0] || 1) }
    }
    return fillTab[fillTab.length - 1][1]
  }
  let fill = cav.fillFraction ?? 0.88, fillCorr = 0
  const setFillInternal = (v) => {
    fill = clamp(v, 0, 1)
    const idx = Math.round(fill * (FQ.n - 1))
    for (let k = 0; k < FQ.ANG; k++) qByAngle[k] = FQ.tables[k][idx]
    const yEx = fillToY(fill)
    fillCorr = yEx - qByAngle[FQ.ANG / 4] // 90° = debout
    JU.uFillY.value = yEx
  }
  setFillInternal(fill)

  // ---- état ------------------------------------------------------------------------------------------------
  const st = {
    clock: 0,
    // heurtoir (charnière X) + roulis (pendule secondaire autour de Z) ; écho des rebonds après une frappe
    theta: 0, omega: 0, knockT: -1, knockFrom: 0, struck: true, psi: 0, psiV: 0, strikeClock: -99,
    // squash
    squashT: -1, squashK: 1,
    // capuchon : `open` = quantité 0..1 (capAmount) ; mode 'quick' (vaporisation, historique) ou 'ritual' (CÈDRE)
    open: 0, openTarget: 0, capSpin: 0, capMode: 'quick', capPh: 0, capT: 0, capBlendT: -1, capHoverT: 0, seatT: -1,
    // panache d'or, activité de la couche d'or (1 vive → 0 figée), vague de reflets
    swT: -1, swDur: 1.8, layerAct: 0, waveT: -1, waveDur: 1.3,
    // poussoir
    pumpT: -1,
    // séchage
    dryT: -1, dryDur: 6,
    // chasse
    chaseT: -1, chaseDur: 0.8,
    // révélation
    revealT: -1, revealDur: 1.5,
    // ballottement (inclinaison locale x, z)
    sx: 0, sz: 0, vx: 0, vz: 0, wobT: 9,
    // cinématique
    hasPrev: false, quiet: 0,
  }
  const strikeWaiters = []
  const tweens = []
  const mkTween = (u, scalar = true) => { const t = { u, from: 0, to: 0, t: 1, dur: 0, scalar }; tweens.push(t); return t }
  const twOutside = mkTween(U.uOutside), twGlow = mkTween(U.uGlow), twCharge = mkTween(JU.uCharge), twMix = mkTween(AU.uGardenMix), twSheet = mkTween(GU.uSheet)
  const startTween = (tw, to, dur) => {
    tw.from = tw.u.value; tw.to = to
    if (!(dur > 0)) { tw.u.value = to; tw.t = 1; tw.dur = 0; return }
    tw.t = 0; tw.dur = dur
  }

  // ---- temporaires (aucune allocation par image) ------------------------------------------------------------
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _p = new THREE.Vector3()

  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix3()
  const _cam = new THREE.Vector3(), _key = new THREE.Vector3(), _kt = new THREE.Vector3()
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3()
  const prevPos = new THREE.Vector3(), prevVel = new THREE.Vector3(), acc = new THREE.Vector3(), accL = new THREE.Vector3()
  const upL = new THREE.Vector3(), gL = new THREE.Vector3()
  const cavCentre = new THREE.Vector3(0, GU.uCavC.value.y, 0)
  const ringPivot = AU.uRingPivot.value
  const ringSign = meta.ringLiftSign ?? -1
  let lastAnchor = o.anchor || null, lastGarden = o.gardenRoot || null
  const gardenFromMarker = new THREE.Matrix4().makeScale(1 / gm.K, 1 / gm.K, 1 / gm.K).multiply(new THREE.Matrix4().makeTranslation(-gm.X_OFF, -gm.Z_OFF, 0))

  // repères : met à jour les matrices monde et les inverses marqueur / jardin
  const refreshFrames = (anchor, gardenRoot) => {
    if (anchor) lastAnchor = anchor
    if (gardenRoot) lastGarden = gardenRoot
    root.updateWorldMatrix(true, true)
    const a = lastAnchor || root.parent
    if (a) U.uWorldToMarker.value.copy(a.matrixWorld).invert()
    else U.uWorldToMarker.value.identity()
    if (lastGarden) { lastGarden.updateWorldMatrix(true, false); U.uWorldToGarden.value.copy(lastGarden.matrixWorld).invert() }
    else U.uWorldToGarden.value.multiplyMatrices(gardenFromMarker, U.uWorldToMarker.value)
  }
  // rotation monde → locale (modèle), sans échelle
  const worldToLocalDir = (v) => {
    _m3.setFromMatrix4(model.matrixWorld)
    const e = _m3.elements
    // orthonormalise les colonnes puis transpose (inverse d'une rotation)
    _bx.set(e[0], e[1], e[2]).normalize(); _by.set(e[3], e[4], e[5]).normalize(); _bz.set(e[6], e[7], e[8]).normalize()
    const x = v.x, y = v.y, z = v.z
    v.set(_bx.x * x + _bx.y * y + _bx.z * z, _by.x * x + _by.y * y + _by.z * z, _bz.x * x + _bz.y * y + _bz.z * z)
    return v
  }

  // ---- frappe ---------------------------------------------------------------------------------------------------
  const strikeP = new THREE.Vector3().fromArray(meta.strike || [0, 0.0453, 0.0185])
  const doStrike = () => {
    st.squashT = 0; st.squashK = 1; st.strikeClock = st.clock
    GU.uShock.value.set(strikeP.x, strikeP.y, 0, 1)
    JU.uRing.value.set(0, 0, 0, 1)
    AU.uStrikeFlash.value = 1
    // le choc traverse le jus : la surface bascule un peu vers l'arrière puis berce ; l'anneau frémit de côté
    st.vz -= 0.55; st.vx += (Math.sin(st.clock * 12.9898) > 0 ? 1 : -1) * 0.18; st.wobT = 0
    st.psiV += (Math.sin(st.clock * 78.233) > 0 ? 1 : -1) * 0.55
    for (let i = 0; i < strikeWaiters.length; i++) strikeWaiters[i]()
    strikeWaiters.length = 0
    if (o.onStrike) try { o.onStrike() } catch (e) { console.warn('[perfume] onStrike', e) }
  }

  // ---- reflets des clous (CPU) -----------------------------------------------------------------------------------
  const updateGlints = (dt, camera) => {
    if (U.uTier.value < 0.5 || !camera || NS === 0 || U.uReveal.value < 1.5) { glints.visible = false; glints.count = 0; return }
    camera.getWorldPosition(_cam)
    // arithmétique en ligne (aucun appel qui renverrait un nombre en boîte)
    const e = model.matrixWorld.elements, g = U.uWorldToGarden.value.elements
    const cx = _cam.x, cy = _cam.y, cz = _cam.z
    const kx = _key.x, ky = _key.y, kz = _key.z, tx = _kt.x, ty = _kt.y, tz = _kt.z
    const useRim = U.uRimCol.value.r > 0.01, clip = U.uClip.value > 0.5, wy = U.uWaterY.value
    for (let i = 0; i < NS; i++) {
      const sx = studPA[3 * i], sy = studPA[3 * i + 1], sz = studPA[3 * i + 2]
      const px = e[0] * sx + e[4] * sy + e[8] * sz + e[12], py = e[1] * sx + e[5] * sy + e[9] * sz + e[13], pz = e[2] * sx + e[6] * sy + e[10] * sz + e[14]
      if (clip && g[1] * px + g[5] * py + g[9] * pz + g[13] < wy) { glintScore[i] = -1; continue }
      const ax = studNA[3 * i], ay = studNA[3 * i + 1], az = studNA[3 * i + 2]
      let nx = e[0] * ax + e[4] * ay + e[8] * az, ny = e[1] * ax + e[5] * ay + e[9] * az, nz = e[2] * ax + e[6] * ay + e[10] * az
      const ni = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= ni; ny *= ni; nz *= ni
      let vx = cx - px, vy = cy - py, vz = cz - pz
      const vi = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz); vx *= vi; vy *= vi; vz *= vi
      const nv = nx * vx + ny * vy + nz * vz
      if (nv <= 0.05) { glintScore[i] = -1; continue }
      const rx = 2 * nv * nx - vx, ry = 2 * nv * ny - vy, rz = 2 * nv * nz - vz
      const sk = rx * kx + ry * ky + rz * kz, sr = useRim ? (rx * tx + ry * ty + rz * tz) * 0.995 : -1
      glintScore[i] = sk > sr ? sk : sr
    }
    // les 3 meilleurs au-dessus du seuil (GLINT_COS)
    glintPick[0] = glintPick[1] = glintPick[2] = -1
    for (let i = 0; i < NS; i++) {
      const sc = glintScore[i]
      if (sc < GLINT_COS) continue
      for (let k = 0; k < 3; k++) {
        const j = glintPick[k]
        if (j < 0 || sc > glintScore[j]) { for (let m = 2; m > k; m--) glintPick[m] = glintPick[m - 1]; glintPick[k] = i; break }
      }
    }
    const rate = dt / 0.15
    for (let i = 0; i < NS; i++) {
      const on = i === glintPick[0] || i === glintPick[1] || i === glintPick[2] ? 1 : 0
      glintLevel[i] += clamp(on - glintLevel[i], -rate, rate)
      glintFlash[i] = Math.max(0, glintFlash[i] - dt / 0.4)
    }
    // affichage : les 3 plus forts (niveau + éclat forcé)
    let count = 0, c0 = -1, c1 = -1
    for (let k = 0; k < 3; k++) {
      let best = -1, bv = 0.01
      for (let i = 0; i < NS; i++) {
        if (i === c0 || i === c1) continue
        const v = Math.min(1, glintLevel[i] + Math.sin(Math.min(1, glintFlash[i]) * Math.PI) * 1.2)
        if (v > bv) { best = i; bv = v }
      }
      if (best < 0) break
      if (k === 0) c0 = best; else if (k === 1) c1 = best
      _m.makeTranslation(studP[best].x + studN[best].x * 0.0006, studP[best].y + studN[best].y * 0.0006, studP[best].z + 0.0012)
      glints.setMatrixAt(count, _m)
      glintK.array[count] = bv
      count++
    }
    glints.count = count
    glints.visible = count > 0
    if (count) { glints.instanceMatrix.needsUpdate = true; glintK.needsUpdate = true }
  }

  // ---- requêtes ---------------------------------------------------------------------------------------------------
  const toAnchor = (obj, local, out) => {
    refreshFrames()
    out.copy(local).applyMatrix4(obj.matrixWorld).applyMatrix4(U.uWorldToMarker.value)
    return out
  }
  const nozzleP = new THREE.Vector3().fromArray(meta.nozzle || [0, 0.0995, 0.0062])
  const nozzleD = new THREE.Vector3().fromArray(meta.nozzleDir || [0, 0, 1])
  const capTopL = new THREE.Vector3(0, meta.capH ?? 0.031, 0)
  const centreL = new THREE.Vector3(0, H / 2, 0)
  const kp = meta.keyPoints || {}
  const OUT = meta.outline || []
  const capTopPts = (kp.capTop || []).map((p) => new THREE.Vector3(p[0], p[1] - seat.y, p[2]))
  const shoulderPts = (kp.shoulder || []).map((p) => new THREE.Vector3().fromArray(p))
  const basePts = (kp.baseCorners || []).map((p) => new THREE.Vector3().fromArray(p))
  const dripPts = (kp.drip || []).map((p) => new THREE.Vector3().fromArray(p))
  const dripOrder = new Int32Array(dripPts.length), dripY = new Float32Array(dripPts.length)
  const toGardenM = new THREE.Matrix4(), capToGardenM = new THREE.Matrix4()
  const prepGarden = () => {
    refreshFrames()
    toGardenM.multiplyMatrices(U.uWorldToGarden.value, model.matrixWorld)
    if (cap) capToGardenM.multiplyMatrices(U.uWorldToGarden.value, cap.matrixWorld)
    else capToGardenM.copy(toGardenM)
  }

  // ---- pas de simulation (petites fonctions : V8 les optimise et les inline mieux qu'un seul gros update) ----------
  const stepTweens = (dt) => {
    for (let i = 0; i < tweens.length; i++) {
      const tw = tweens[i]
      if (tw.t >= 1) continue
      tw.t = Math.min(1, tw.t + dt / tw.dur)
      tw.u.value = tw.from + (tw.to - tw.from) * smooth(tw.t)
    }
  }
  const stepFrames = (camera) => {
    // repère du scan : base du flacon, axe vertical propre, hauteur monde (colonne Y de la matrice monde)
    const re = root.matrixWorld.elements
    U.uScanOrigin.value.set(re[12], re[13], re[14])
    const ax = re[4], ay = re[5], az = re[6], hs = Math.sqrt(ax * ax + ay * ay + az * az)
    if (hs > 1e-6) { U.uScanAxis.value.set(ax / hs, ay / hs, az / hs); U.uScanHeight.value = hs } else { U.uScanAxis.value.set(0, 1, 0); U.uScanHeight.value = 1 }
    // caméra en espace maillage ; carton chaud « devant, sous la caméra » et boîte « en haut à gauche » pour l'or
    if (camera) {
      camera.getWorldPosition(_cam); U.uCamLocal.value.copy(_cam); if (glass) glass.worldToLocal(U.uCamLocal.value)
      _v.copy(centreL).applyMatrix4(model.matrixWorld)
      _v2.copy(_cam).sub(_v).normalize()
      AU.uWarmDir.value.copy(_v2); AU.uWarmDir.value.y -= 0.35; AU.uWarmDir.value.normalize()
      const ce = camera.matrixWorld.elements
      AU.uSoftDir.value.copy(_v2).addScaledVector(_v3.set(ce[0], ce[1], ce[2]).normalize(), -0.9).addScaledVector(_v3.set(ce[4], ce[5], ce[6]).normalize(), 0.75).normalize()
    }
    // lumière clé / contre-jour (DirectionalLight du directeur, lecture seule)
    const key = lights.key, rim = lights.rim
    if (key) {
      key.getWorldPosition(_key)
      if (key.target) key.target.getWorldPosition(_v); else _v.set(0, 0, 0)
      _key.sub(_v).normalize(); U.uKeyDir.value.copy(_key)
      U.uKeyCol.value.copy(key.color).multiplyScalar(key.intensity / 2.6)
    } else _key.copy(U.uKeyDir.value)
    if (rim) {
      rim.getWorldPosition(_kt)
      if (rim.target) rim.target.getWorldPosition(_v); else _v.set(0, 0, 0)
      _kt.sub(_v).normalize(); U.uRimDir.value.copy(_kt)
      U.uRimCol.value.copy(rim.color).multiplyScalar(rim.intensity / 3.4)
    } else _kt.copy(U.uRimDir.value)
  }
  // accélération du centre de la cavité (hauteurs de flacon / s²), en repère local ; gravité locale
  const stepKinematics = (dt) => {
    const hW = U.uScanHeight.value
    _p.copy(cavCentre).applyMatrix4(model.matrixWorld)
    if (st.hasPrev && dt > 1e-4) {
      _v.copy(_p).sub(prevPos).divideScalar(dt)
      if (_v.lengthSq() > 1600 * hW * hW) st.quiet = 2                      // téléportation (reset / pose forcée)
      acc.copy(_v).sub(prevVel).divideScalar(dt)
      prevVel.copy(_v)
    } else { acc.set(0, 0, 0); prevVel.set(0, 0, 0) }
    prevPos.copy(_p); st.hasPrev = true
    if (st.quiet > 0) { st.quiet--; acc.set(0, 0, 0); prevVel.set(0, 0, 0) }
    accL.copy(acc).divideScalar(hW)
    if (accL.lengthSq() > 14400) accL.multiplyScalar(120 / Math.sqrt(accL.lengthSq()))
    worldToLocalDir(accL)
    upL.set(0, 1, 0); worldToLocalDir(upL)
    gL.copy(upL).negate()
  }
  // ballottement + plan de remplissage horizontal (volume conservé quel que soit le roulis)
  const stepSlosh = (dt) => {
    if (U.uTier.value >= 0.5) {
      const SUB = dt > 0.02 ? 2 : 1, h = dt / SUB
      // mode de ballottement ≈ 1,2 Hz, peu amorti (ζ ≈ 0,2) : la surface traîne, dépasse, puis berce
      for (let k = 0; k < SUB; k++) {
        st.vx += (-55 * st.sx - 3.0 * st.vx + 1.05 * accL.x) * h
        st.vz += (-55 * st.sz - 3.0 * st.vz + 1.05 * accL.z) * h
        st.sx += st.vx * h; st.sz += st.vz * h
      }
      const m2 = st.sx * st.sx + st.sz * st.sz
      if (m2 > SLOSH_LIM * SLOSH_LIM) { const k = SLOSH_LIM / Math.sqrt(m2); st.sx *= k; st.sz *= k }
    } else { // niveau bas : simple oscillation sinusoïdale amortie après une impulsion
      st.wobT += dt
      const e = Math.exp(-st.wobT * 1.6) * Math.sin(st.wobT * 7.4)
      st.sx = clamp(st.vx * 0.02 * e, -0.3, 0.3); st.sz = clamp(st.vz * 0.02 * e, -0.3, 0.3)
      st.vx *= Math.exp(-dt * 1.6); st.vz *= Math.exp(-dt * 1.6)
    }
    const N3 = U.uFillN.value.set(upL.x + st.sx, upL.y, upL.z + st.sz).normalize()
    let nx = N3.x, ny = N3.y
    const l2 = Math.sqrt(nx * nx + ny * ny)
    if (l2 < 0.15) { nx = 0; ny = 1 } else { nx /= l2; ny /= l2 }
    let ang = Math.atan2(ny, nx); if (ang < 0) ang += Math.PI * 2
    const fa = (ang / (Math.PI * 2)) * FQ.ANG, fl = Math.floor(fa), k0 = fl % FQ.ANG, k1 = (k0 + 1) % FQ.ANG, ft = fa - fl
    const up2 = ny > 0 ? ny * ny : 0
    const d = qByAngle[k0] + (qByAngle[k1] - qByAngle[k0]) * ft + fillCorr * up2
    U.uFillP.value.set(nx * d, ny * d, 0)
  }
  // heurtoir : script de frappe ou pendule amorti contre le verre
  const stepRing = (dt) => {
    if (st.knockT >= 0) {
      // frappe scénarisée : levée sans hâte (sinus), suspension, chute accélérée ; à l'impact la physique reprend
      st.knockT += dt
      const t = st.knockT, K = KNOCK
      const t1 = K.lift, t2 = t1 + K.hang
      if (t < t1) st.theta = st.knockFrom + (K.top - st.knockFrom) * easeInOutSine(t / t1)
      else if (t < t2) st.theta = K.top + K.extra * smooth((t - t1) / K.hang)
      else if (t < K.strikeAt) { const u = (t - t2) / K.fall; st.theta = (K.top + K.extra) * (1 - Math.pow(u, 2.6)) }
      else {
        // impact : le verre absorbe presque tout (premier rebond ≈ 9°), puis rebonds libres de plus en plus petits
        st.theta = 0; st.omega = K.rebound; st.knockT = -1
        if (!st.struck) { st.struck = true; doStrike() }
      }
      st.omega = st.knockT >= 0 ? 0 : st.omega
    } else {
      let th0 = 0
      if (-gL.y > 0.3) th0 = clamp(Math.atan2(gL.z, -gL.y), 0, 1.2)
      const h = dt / 3
      const echo = st.clock - st.strikeClock < 1.6
      for (let k = 0; k < 3; k++) {
        st.omega += (-81 * (st.theta - th0) - 3 * st.omega - 0.6 * accL.z) * h
        st.theta += st.omega * h
        if (st.theta < 0) {
          st.theta = 0
          if (st.omega < 0) {
            const v = -st.omega
            if (v > 1.5 && o.onTink) fireTink(v)
            else if (echo && v > 0.6) { // écho du rebond : petite onde dans le verre, l'or du clou frémit
              GU.uShock.value.set(strikeP.x, strikeP.y, 0, Math.min(0.4, v * 0.28))
              AU.uStrikeFlash.value = Math.max(AU.uStrikeFlash.value, Math.min(0.45, v * 0.3))
              if (o.onTink) fireTink(v)
            }
            st.omega = v * KNOCK.restitution
            if (st.omega < 0.05) st.omega = 0
          }
        }
      }
      if (st.theta > A75) st.theta = A75
    }
    AU.uRingAngle.value = ringSign * st.theta
    // roulis : l'anneau pend vers la gravité apparente (g − a, repère local) ; frotte sur le verre quand il y repose
    const up = clamp((-gL.y - 0.55) / 0.3, 0, 1)
    let eq = 0
    if (up > 0) {
      const gx = RING_G * gL.x - accL.x, gy = RING_G * gL.y - accL.y
      eq = clamp(Math.atan2(gx, -gy), -RING_ROLL_MAX, RING_ROLL_MAX) * up
    }
    const fr = st.theta > 0.04 ? 2.4 : 3.6
    const hr = dt / 3
    for (let k = 0; k < 3; k++) {
      st.psiV += (-RING_W2 * (st.psi - eq) - fr * st.psiV) * hr
      st.psi += st.psiV * hr
    }
    if (st.psi > RING_ROLL_MAX) { st.psi = RING_ROLL_MAX; if (st.psiV > 0) st.psiV *= -0.3 }
    else if (st.psi < -RING_ROLL_MAX) { st.psi = -RING_ROLL_MAX; if (st.psiV < 0) st.psiV *= -0.3 }
    AU.uRingRoll.value = st.psi
  }
  const fireTink = (v) => { try { o.onTink(v) } catch (e) { console.warn('[perfume] onTink', e) } }
  const fireCapClick = () => { try { o.onCapClick() } catch (e) { console.warn('[perfume] onCapClick', e) } }
  // squash, choc, flash, capuchon, poussoir, séchage, chasse, révélation
  // ---- capuchon : pose calculée dans cp (repère root, ry relatif au lacet du flacon tant que w = 0), puis appliquée.
  // w = 0 : sur l'axe du flacon (suit le lacet du visiteur) ; w = 1 : garé à côté (repère root, n'orbite pas).
  // Courbes qui se chevauchent (rotation, montée, arc) : aucun arrêt entre deux temps du geste.
  const cp = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, w: 0 }, cs = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, w: 0, rs: 0 }
  const PARK_X = CAP.park[0], PARK_Y = CAP.park[1], PARK_Z = CAP.park[2]
  const ease4Out = (u) => { u = clamp(u, 0, 1); const v = 1 - u; return 1 - v * v * v * (1 + 3 * u) } // vitesse max au 1/3, longue fin
  // rituel d'ouverture : prise (contre-quart infime), dévissage d'un tour qui résiste puis file, décollage, arc vers la place
  const capOpenPose = (t) => {
    const P = CAP_OPEN, T = CAP.turn
    const grip = smooth(t / P.grip) * (1 - smooth((t - P.grip) / 0.14))
    // trois quarts de tour (+ une fin de course qui file) : vitesse en cloche, jamais un stroboscope sur l'octogone
    const turn = (T + CAP.over) * smooth((t - P.grip) / (P.unscrew - P.grip))
    const lift = easeInOutSine((t - (P.unscrew - 0.18)) / (P.lift - P.unscrew + 0.20))
    const e = easeInOutCubic((t - (P.lift - 0.08)) / (P.park - P.lift + 0.08))
    const ex = e * (2 - e) // l'arc s'écarte du col avant de descendre vers l'épaule (il ne frôle jamais le verre)
    const y0 = seatN + CAP.pitch * Math.min(1, turn / T) + CAP.liftOff * lift - 0.004 * grip
    cp.x = PARK_X * ex; cp.z = PARK_Z * e
    cp.y = y0 + (PARK_Y - (seatN + CAP.pitch + CAP.liftOff)) * e + Math.sin(Math.PI * e) * 0.04
    // vers la place : on poursuit dans le même sens jusqu'à l'angle de repos équivalent (aucun retour en arrière)
    cp.ry = (-0.05 * grip + turn) * (1 - e) + CAP.parkTurn * e
    cp.rx = 0; cp.rz = CAP.parkTilt * e; cp.w = e
  }
  // garé : il flotte (respiration lente, léger balancement), sans rotation continue (le retour reste aligné)
  const capHoverPose = (t) => {
    const k = smooth(t / 0.9)
    cp.x = PARK_X + 0.004 * Math.sin(t * 1.9) * k; cp.y = PARK_Y + 0.009 * Math.sin(t * 2.6) * k; cp.z = PARK_Z
    cp.rx = 0.03 * Math.sin(t * 1.7 + 0.6) * k; cp.ry = CAP.parkTurn + 0.10 * Math.sin(t * 1.3) * k; cp.rz = CAP.parkTilt + 0.025 * Math.sin(t * 2.2 + 1.1) * k; cp.w = 1
  }
  // rituel de fermeture : retour en arc au-dessus du col (un tour d'avance), il descend en tournant déjà, le vissage
  // ralentit à mesure qu'il serre, s'arrête un instant, puis le dernier seizième de tour d'un coup sec (clic)
  const capClosePose = (t) => {
    const P = CAP_CLOSE, T = CAP.turn, yA = seatN + CAP.pitch + 0.07
    const b = easeInOutCubic(t / P.back), v = 1 - b
    // il monte d'abord, puis rentre au-dessus du col (l'épaule du verre reste libre)
    const bx = easeInOutCubic((t / P.back - 0.12) / 0.88)
    const down = easeInOutSine((t - (P.back - 0.10)) / (P.down - P.back + 0.10))
    const scr = ease4Out((t - (P.down - 0.17)) / (P.screw - P.down + 0.17))
    const snap = clamp((t - P.screw) / (P.snap - P.screw), 0, 1)
    const turn = T * (1 - 0.94 * scr) - T * 0.06 * snap * snap
    cp.x = cs.x * (1 - bx); cp.z = cs.z * v
    cp.y = cs.y * v + yA * b + Math.sin(Math.PI * b) * 0.05 - (yA - seatN - CAP.pitch) * down - CAP.pitch * (1 - Math.max(0, turn) / T)
    // en revenant il tourne déjà dans le sens du vissage, jusqu'à l'angle qui finira aligné (k tours entiers près)
    cp.ry = cs.ry * v + cs.rs * b + (turn - T); cp.rx = cs.rx * v; cp.rz = cs.rz * v; cp.w = cs.w * (1 - smooth(b / 0.7))
  }
  const snapCap = () => {
    cs.w = cp.w
    cs.x = capPivot.position.x; cs.y = cp.y; cs.z = capPivot.position.z
    cs.rx = capPivot.rotation.x; cs.ry = capPivot.rotation.y - spin.rotation.y * (1 - cs.w); cs.rz = capPivot.rotation.z
    // angle de départ du vissage : ≡ T (mod 2π), juste sous l'angle actuel → assis exactement à 2πk
    cs.rs = CAP.turn + TAU * Math.floor((cs.ry - CAP.turn) / TAU)
  }
  const setCapTarget = (b, mode) => {
    const open = b ? 1 : 0, m = mode === 'ritual' ? 'ritual' : 'quick'
    if (open === st.openTarget && (m === st.capMode || (m === 'quick' && !open))) {
      if (!(open === 0 && st.capMode === 'ritual' && st.capPh !== 3 && st.capPh !== 0)) return
    }
    snapCap()
    st.openTarget = open
    if (m === 'ritual') {
      if (open) {
        if (st.open <= 0.02) { st.capPh = 1; st.capT = 0; st.capBlendT = -1 }                 // assis : rituel complet
        else { st.capPh = 2; st.capHoverT = 0; st.capBlendT = 0 }                              // déjà levé : il rejoint sa place
      } else { st.capPh = st.open > 0.02 || st.capMode === 'ritual' ? 3 : 0; st.capT = 0; st.capBlendT = -1 }
      st.capMode = st.capPh === 0 ? 'quick' : 'ritual'
    } else {
      if (st.capMode === 'ritual') {
        // fermeture sans mode : le rituel se referme quand même (vissage), l'ouverture rapide garde la courbe historique
        if (!open && st.open > 0.02) { st.capPh = 3; st.capT = 0; st.capBlendT = -1; return }
        st.open = st.capPh === 2 ? 1 : st.open
        st.capBlendT = 0
      }
      st.capMode = 'quick'
    }
  }

  const stepAnims = (dt) => {
    // frappe : le cristal est rigide — aucune déformation du corps ; le choc vit dans l'onde du verre, l'éclat de l'or,
    // la ride et le ballottement du jus (et le recul du flacon, côté directeur)
    if (st.squashT >= 0) { st.squashT += dt; if (st.squashT > 0.5) st.squashT = -1 }
    const sh = GU.uShock.value
    if (sh.z >= 0) { sh.z += dt; if (sh.z > 0.6) sh.z = -1 }
    const rg = JU.uRing.value
    if (rg.z >= 0) { rg.z += dt; if (rg.z > 0.8) rg.z = -1 }
    AU.uStrikeFlash.value *= Math.exp(-dt / 0.09)
    if (AU.uStrikeFlash.value < 0.004) AU.uStrikeFlash.value = 0

    // capuchon
    const wasOpen = st.open
    let seat = 0
    if (st.capMode === 'ritual') {
      st.capT += dt
      if (st.capPh === 1) {
        capOpenPose(st.capT); st.open = clamp(st.capT / CAP_OPEN.park, 0, 1)
        if (st.capT >= CAP_OPEN.park) { st.capPh = 2; st.capHoverT = 0; st.open = 1 }
      } else if (st.capPh === 2) { st.capHoverT += dt; capHoverPose(st.capHoverT); st.open = 1 }
      else if (st.capPh === 3) {
        capClosePose(st.capT)
        st.open = clamp(1 - st.capT / CAP_CLOSE.snap, 0, 1)
        if (st.capT >= CAP_CLOSE.snap) { st.capPh = 0; st.open = 0; st.seatT = 0; st.capMode = 'quick'; st.capSpin = 0 }
      } else { cp.x = 0; cp.y = seatN; cp.z = 0; cp.rx = 0; cp.ry = 0; cp.rz = 0; cp.w = 0; st.open = 0; st.capMode = 'quick' }
    } else {
      // vaporisation (courbe historique lift / park) : ouverture 0,5 s, fermeture 0,4 s
      const diff = st.openTarget - st.open, rate = diff > 0 ? 2.0 : 2.5, stepv = dt * rate
      st.open = Math.abs(diff) <= stepv ? st.openTarget : st.open + (diff > 0 ? stepv : -stepv)
      if (wasOpen > 0 && st.open === 0 && st.openTarget === 0) st.seatT = 0
      const lift = smooth(st.open / 0.4), park = smooth((st.open - 0.35) / 0.65)
      st.capSpin += dt * 0.35 * park
      if (st.open === 0) st.capSpin = 0
      cp.x = park * 0.40
      cp.y = seatN * (1 - park) + lift * 0.25 * (1 - park) + park * 0.55 + Math.sin(st.clock * 1.3) * 0.012 * park
      cp.z = -park * 0.05
      cp.rx = 0; cp.ry = lift * 0.6 * (1 - park) + park * 1.2 + st.capSpin; cp.rz = -park * 0.10; cp.w = park
    }
    // assise : le clic, un tassement bref qui se relâche sans rebond (impulsion amortie critique, crête à 30 ms)
    if (st.seatT >= 0) {
      if (st.seatT === 0 && o.onCapClick) fireCapClick()
      st.seatT += dt
      const u = st.seatT / 0.03
      seat = u * Math.exp(1 - u)
      if (st.seatT > 0.4) { st.seatT = -1; seat = 0 }
    }
    // fondu depuis l'instantané (changement de sens en cours de route)
    if (st.capBlendT >= 0) {
      st.capBlendT += dt
      const k = smooth(st.capBlendT / 0.35), v = 1 - k
      cp.x = cs.x * v + cp.x * k; cp.y = cs.y * v + cp.y * k; cp.z = cs.z * v + cp.z * k
      cp.rx = cs.rx * v + cp.rx * k; cp.ry = cs.ry * v + cp.ry * k; cp.rz = cs.rz * v + cp.rz * k; cp.w = cs.w * v + cp.w * k
      if (k >= 1) st.capBlendT = -1
    }
    capPivot.position.set(cp.x, cp.y - 0.0035 * seat, cp.z)
    capPivot.rotation.set(cp.rx, spin.rotation.y * (1 - cp.w) + cp.ry, cp.rz)

    // panache d'or : la tête descend du col (1,15) au fond (0), l'intensité monte vite puis s'éteint
    const sw = JU.uSwirl.value
    if (st.swT >= 0) {
      st.swT += dt
      const u = st.swT / st.swDur
      sw.x = smooth(u / 0.14) * (1 - smooth((u - 0.58) / 0.42))
      sw.y = 1.15 - 1.35 * easeInOutSine(u / 0.78)
      sw.z += dt
      st.layerAct = 1
      if (u >= 1) { st.swT = -1; sw.x = 0 }
    } else if (st.layerAct > 0) st.layerAct = Math.max(0, st.layerAct - dt / 3) // s'apaise en 3 s, puis figée
    // un ballottement franc réveille la couche (FLEUR après CÈDRE) ; temps propre de la couche : aucune dérive au repos
    const sl = Math.min(1, Math.sqrt(st.vx * st.vx + st.vz * st.vz) * 0.5)
    if (sl > st.layerAct) st.layerAct += (sl - st.layerAct) * Math.min(1, dt * 5)
    sw.w += dt * smooth(st.layerAct)
    // vague de reflets : chaque clou s'allume quand la chasse passe sur lui (étoiles synchronisées avec l'or)
    if (st.waveT >= 0) {
      st.waveT += dt
      const c = -0.1 + 1.2 * (st.waveT / st.waveDur)
      const arc = waveSym ? studArcSym : studArc
      for (let i = 0; i < NS; i++) if (!waveFired[i] && c >= arc[i] - 0.03) { waveFired[i] = 1; glintFlash[i] = 1 }
      if (st.waveT >= st.waveDur) st.waveT = -1
    }

    // poussoir : 2 mm en 0,08 s, retour en 0,15 s
    if (st.pumpT >= 0) {
      st.pumpT += dt
      const t = st.pumpT
      AU.uPump.value = t < 0.08 ? smooth(t / 0.08) : 1 - smooth((t - 0.08) / 0.15)
      if (t > 0.23) { st.pumpT = -1; AU.uPump.value = 0 }
    }
    // séchage : la bande satinée se givre du haut vers le bas, halos des clous d'abord
    if (st.dryT >= 0) {
      st.dryT += dt
      GU.uDryT.value = -0.3 + 1.7 * (st.dryT / st.dryDur)
      if (st.dryT >= st.dryDur) { st.dryT = -1; GU.uDryT.value = 2 }
    }
    // chasse de reflets sur l'arc des clous
    if (st.chaseT >= 0) {
      st.chaseT += dt
      const k = st.chaseT / st.chaseDur
      AU.uChase.value = -0.1 + 1.2 * k
      AU.uChaseK.value = Math.sin(Math.min(1, k) * Math.PI) * 0.6 + 0.4 * (k < 1 ? 1 : 0)
      if (k >= 1) { st.chaseT = -1; AU.uChaseK.value = 0; AU.uChase.value = -1; AU.uChaseSym.value = 0 }
    }
    // révélation
    if (st.revealT >= 0 && st.revealT < 1) {
      st.revealT = Math.min(1, st.revealT + dt / st.revealDur)
      U.uReveal.value = -0.05 + smooth(st.revealT) * 1.25
      if (st.revealT >= 1) U.uReveal.value = 2
    }
  }

  // ---- API --------------------------------------------------------------------------------------------------------
  const api = {
    root, spin, norm, proxy, U, meta, model, capPivot, glints,
    uniforms: { shared: U, glass: GU, juice: JU, gold: AU },
    meshes: { glass, juice, gold, cap, refl },
    studCount: NS,

    // ---- apparition (dev / repli) ----
    reveal(d = 1.5) { st.revealT = 0; st.revealDur = d; U.uReveal.value = -0.05 },
    hideInstant() { st.revealT = -1; U.uReveal.value = -0.1 },

    // ---- look ----
    setOutside(k, dur = 0.5) { startTween(twOutside, clamp(k, 0, 1), dur) },
    setGardenMix(k, dur = 0.5) { startTween(twMix, clamp(k, 0, 1), dur) },
    setClip(on) { U.uClip.value = on ? 1 : 0 },
    setWet(k = 1) { if (k >= 0.5) { st.dryT = -1; GU.uDryT.value = -0.4 } else { st.dryT = -1; GU.uDryT.value = 2 } },
    dry(dur = 6) { st.dryT = 0; st.dryDur = Math.max(0.1, dur); if (GU.uDryT.value > 1.3) GU.uDryT.value = -0.4 },
    setSheet(on) { startTween(twSheet, on ? 1 : 0, on ? 0.15 : 0.6) },
    setGlow(v, dur = 0) { startTween(twGlow, Math.max(0, v), dur) },
    setCharge(v, dur = 0) { startTween(twCharge, clamp(v, 0, 2), dur) },
    setFill(v) { setFillInternal(v) },
    get fill() { return fill },
    setQuality(q) { U.uTier.value = TIERS[q] ?? (typeof q === 'number' ? clamp(q, 0, 2) : 2) },
    get quality() { return ['low', 'medium', 'high'][U.uTier.value | 0] },

    // ---- heurtoir ----
    /** frappe : levée 0,38 s, suspension 0,12 s, chute 0,11 s → onStrike à `strikeAt` s, puis rebonds physiques. */
    knock() {
      st.knockFrom = st.theta; st.knockT = 0; st.struck = false
      return new Promise((resolve) => strikeWaiters.push(resolve))
    },
    get knocking() { return st.knockT >= 0 },
    get knockPhase() { return st.knockT },
    get strikeAt() { return KNOCK.strikeAt },
    get ringAngle() { return st.theta },
    get ringRoll() { return st.psi },

    // ---- capuchon ----
    /** b : ouvert / fermé. mode 'ritual' (CÈDRE) : dévissage d'un tour, décollage, arc, flottement ; fermeture vissée
     *  avec clic. Sans mode : courbe rapide historique (vaporisation, 0,5 s / 0,4 s). */
    setCapOpen(b, mode) { setCapTarget(b, mode) },
    get capOpen() { return st.openTarget > 0.5 },
    get capAmount() { return st.open },
    get capRitual() { return st.capMode === 'ritual' ? st.capPh : 0 },
    /** durées du rituel (s) : ouverture jusqu'à la place, fermeture jusqu'au clic */
    capTimes: { open: CAP_OPEN.park, close: CAP_CLOSE.snap },

    // ---- vaporisation ----
    pump() { st.pumpT = 0 },

    // ---- jus ----
    impulse(v) {
      if (!v) return
      st.vx += (v.x || 0) * 2.5; st.vz += (v.z || 0) * 2.5
      st.omega += (Math.abs(v.y || 0) * 0.8 + Math.max(0, -(v.z || 0)) * 1.2) * 6
      st.psiV += (v.x || 0) * 2.2
      JU.uRing.value.set(0, 0, 0, Math.min(1, Math.abs(v.y || 0) * 2 + 0.2))
      st.wobT = 0
    },
    meniscusRing(k = 1) { JU.uRing.value.set(0, 0, 0, k) },
    /** veines d'or dans le jus (CÈDRE) : panache qui descend du col en volutes et s'éteint en `dur` s (couche : setCharge). */
    chargeSwirl(dur = 1.8) { st.swT = 0; st.swDur = Math.max(0.4, dur); const s = JU.uSwirl.value; s.x = 0; s.y = 1.15 },
    get swirling() { return st.swT >= 0 },

    // ---- or ----
    glintChase(dur = 0.8) { st.chaseT = 0; st.chaseDur = Math.max(0.1, dur); AU.uChaseSym.value = 0 },
    /** vague de reflets : la chasse d'or parcourt l'arc et chaque clou jette son étoile à son passage.
     *  sym = true : la vague monte des deux pieds à la fois jusqu'au médaillon. */
    glintWave(dur = 1.3, sym = true) {
      st.chaseT = 0; st.chaseDur = Math.max(0.2, dur); AU.uChaseSym.value = sym ? 1 : 0
      st.waveT = 0; st.waveDur = st.chaseDur; waveSym = sym ? 1 : 0; waveFired.fill(0)
    },
    studGlint(i) { if (i >= 0 && i < NS) glintFlash[i] = 1 },

    // ---- requêtes (espace marqueur) ----
    nozzleAnchor(out) {
      _v.copy(nozzleP); _v.y -= AU.uPump.value * AU.uPumpTravel.value
      return toAnchor(model, _v, out)
    },
    sprayDirAnchor(out) {
      refreshFrames()
      out.copy(nozzleD).transformDirection(model.matrixWorld)
      _m3.setFromMatrix4(U.uWorldToMarker.value)
      return out.applyMatrix3(_m3).normalize()
    },
    strikeAnchor(out) { return toAnchor(model, strikeP, out) },
    capAnchor(out) { return toAnchor(cap || model, capTopL, out) },
    centerAnchor(out) { return toAnchor(model, centreL, out) },
    studAnchor(i, out) { return toAnchor(model, studP[clamp(i | 0, 0, Math.max(0, NS - 1))] || centreL, out) },

    // ---- requêtes jardin ----
    extremaGarden(out) {
      prepGarden()
      let hi = -1e9, hiX = 0, lo = 1e9
      for (let i = 0; i < OUT.length; i++) {
        _v.set(OUT[i][0], OUT[i][1], 0).applyMatrix4(toGardenM)
        if (_v.y > hi) { hi = _v.y; hiX = _v.x }
        if (_v.y < lo) lo = _v.y
      }
      let capY = -1e9, capX = 0
      for (let i = 0; i < capTopPts.length; i++) {
        _v.copy(capTopPts[i]).applyMatrix4(capToGardenM)
        if (_v.y > capY) { capY = _v.y; capX = _v.x }
        if (_v.y > hi) { hi = _v.y; hiX = _v.x }
        if (_v.y < lo) lo = _v.y
      }
      let shY = -1e9, shX = 0
      for (let i = 0; i < shoulderPts.length; i++) {
        _v.copy(shoulderPts[i]).applyMatrix4(toGardenM)
        if (_v.y > shY) { shY = _v.y; shX = _v.x }
      }
      let bY = 1e9
      for (let i = 0; i < basePts.length; i++) {
        _v.copy(basePts[i]).applyMatrix4(toGardenM)
        if (_v.y < bY) bY = _v.y
        if (_v.y < lo) lo = _v.y
      }
      out.highestY = hi; out.highestX = hiX; out.lowestY = lo
      out.capTopY = capY; out.capX = capX; out.shoulderY = shY; out.shoulderX = shX; out.baseLowY = bY
      return out
    },
    waterSection(waterY, out) {
      prepGarden()
      let x0 = 1e9, x1 = -1e9, zs = 0, nz = 0
      const n = OUT.length
      for (let i = 0, j = n - 1; i < n; j = i++) {
        _v.set(OUT[j][0], OUT[j][1], 0).applyMatrix4(toGardenM)
        _v2.set(OUT[i][0], OUT[i][1], 0).applyMatrix4(toGardenM)
        if ((_v.y - waterY) * (_v2.y - waterY) > 0 || _v.y === _v2.y) continue
        const t = (waterY - _v.y) / (_v2.y - _v.y)
        const x = _v.x + (_v2.x - _v.x) * t
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        zs += _v.z + (_v2.z - _v.z) * t; nz++
      }
      out.ok = nz >= 2 && x1 > x0
      out.x0 = out.ok ? x0 : 0; out.x1 = out.ok ? x1 : 0; out.zc = nz ? zs / nz : 0
      _v3.set(0, 0, (meta.depth || 0.034) / 2)
      _m3.setFromMatrix4(toGardenM)
      out.halfDepth = _v3.applyMatrix3(_m3).length()
      return out
    },
    dripPointsGarden(outArray) {
      prepGarden()
      const n = dripPts.length
      for (let i = 0; i < n; i++) { _v.copy(dripPts[i]).applyMatrix4(toGardenM); dripY[i] = _v.y; dripOrder[i] = i }
      for (let i = 1; i < n; i++) { // tri par insertion (y croissant)
        const k = dripOrder[i]; let j = i - 1
        while (j >= 0 && dripY[dripOrder[j]] > dripY[k]) { dripOrder[j + 1] = dripOrder[j]; j-- }
        dripOrder[j + 1] = k
      }
      for (let i = 0; i < n; i++) {
        if (!outArray[i]) outArray[i] = new THREE.Vector3()
        outArray[i].copy(dripPts[dripOrder[i]]).applyMatrix4(toGardenM)
      }
      return outArray
    },

    // ---- boucle ----
    update(dt, ctx = {}) {
      dt = Math.max(0, Math.min(dt || 0, 0.1))
      st.clock += dt
      U.uTime.value = st.clock
      refreshFrames(ctx.anchor, ctx.gardenRoot)
      const camera = ctx.camera || null
      stepTweens(dt)
      { // fond réel seulement hors de la cour ; le jus passe alors juste avant le verre, après l'eau et les fleurs du jardin
        const out = U.uOutside.value
        screen.setAmount(out > 0.5 ? Math.min(1, (out - 0.5) / 0.3) : 0)
        const o = out > 0.5
        // dehors : copie → jus 11.4 (écrit la profondeur) → or / bouchon 11.45 → verre 11.5 ; dans la cour : comme avant
        if (juice) juice.renderOrder = o ? PB_RENDER_ORDER.glass - 0.1 : PB_RENDER_ORDER.juice
        if (gold) gold.renderOrder = o ? PB_RENDER_ORDER.glass - 0.05 : 0
        if (cap) cap.renderOrder = o ? PB_RENDER_ORDER.glass - 0.05 : 0
      }
      stepFrames(camera)
      stepKinematics(dt)
      stepSlosh(dt)
      stepRing(dt)
      stepAnims(dt)
      root.updateWorldMatrix(false, true)
      updateGlints(dt, camera)
    },

    stats() {
      let calls = 0, tris = 0
      const add = (m) => {
        if (!m || !m.visible || !m.parent) return
        let p = m.parent, vis = true
        while (p) { if (!p.visible) { vis = false; break } p = p.parent }
        if (!vis) return
        calls++
        const g = m.geometry
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1)
      }
      add(juice); add(glass); add(gold); add(cap)
      if (glints.count > 0) add(glints)
      return { drawCalls: calls, triangles: Math.round(tris) }
    },

    dispose() {
      if (root.parent) root.parent.remove(root)
      ;[glass, juice, gold, cap, refl].forEach((m) => m?.geometry?.dispose())
      own.forEach((r) => r?.dispose?.())
      strikeWaiters.length = 0
    },
  }
  return api
}
