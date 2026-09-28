// Effet AR "affiche LOVENUDE" : au scan, la zone autour de la bulle imprimée se
// déforme (distorsion liquide radiale amortie, façon peinture Mario 64), une VRAIE
// bulle de savon 3D (shader d'interférence spectrale + wobble fbm, d'après le repo
// studio-tama SoapBubble) sort de l'affiche avec le lipstick dedans, avance devant,
// et au tap → POP : la bulle éclate en petites gouttelettes réfractives (verre liquide).
// Pendant la sortie, l'affiche passe de "avec bulle" à "sans bulle" (crossfade).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

export const CFG = {
  modelUrl: '/lovenude.glb',
  targetName: 'poster',
  targetDataUrl: '/image-targets/poster.json',
  posterAvecUrl: '/targets/poster_avec.png',
  posterSansUrl: '/targets/poster_sans.png',
  hdrUrl: '/hdr/photo_studio_01.hdr',
  envRot: 0, // réglage /gloss

  aspect: 1671 / 941,
  posterH: 1.0,

  bubbleCenter: [0.709, 0.543],
  bubbleRadius: 0.66, // zone de distorsion (large, autour de la bulle imprimée)

  bubble3DRadius: 0.34,
  bubbleOut: 0.55,
  lipstickH: 0.52, // un peu plus grand
  lipTilt: -0.38, // incliné un peu plus vers la gauche (moins penché à droite) → colle mieux à l'affiche
  lipYaw: 0.1,

  // après le pop : le lipstick glisse vers le milieu de l'affiche puis devient showcase
  glideTarget: [0.0, 0.0], // milieu de l'affiche (x,y locaux)
  glideDur: 1.4,
  revealSpin: 0.5, // vitesse du tournoiement une fois révélé (rad/s)

  nDrops: 22,

  tDistRise: [0.0, 0.6],
  tEmerge: [0.4, 2.4],
  tGrow: [0.4, 1.5],
  tCross: [0.7, 1.8],
  tDistFall: [1.4, 2.6],
}

// matériaux du lipstick — réglages /gloss du client (par NOM de matériau)
const MAT = {
  cap: { color: 0xf2a9a1, metalness: 0.86, roughness: 0.06, clearcoat: 0.0, envMapIntensity: 1.0 },
  cassandre: { color: 0xe8eaef, metalness: 1.0, roughness: 0.06, clearcoat: 0.0, envMapIntensity: 1.1 },
  bottleMatte: { color: 0xf2a9a1, metalness: 0.4, roughness: 0.32, clearcoat: 1.0, envMapIntensity: 0.0 },
  bottleGlossy: { color: 0xf2a9a1, metalness: 0.47, roughness: 0.48, clearcoat: 0.15, envMapIntensity: 0.2 },
  bullet: { color: 0xf2a9a1, metalness: 1.0, roughness: 0.0, clearcoat: 0.0, envMapIntensity: 1.0 },
  ring: { color: 0x582c2c, metalness: 0.0, roughness: 0.38, clearcoat: 0.0, envMapIntensity: 0.0 },
  capInterior: { color: 0x0b0b0b, metalness: 0.2, roughness: 0.35, clearcoat: 0.0, envMapIntensity: 1.2 },
}

// animation d'ouverture — mêmes réglages que /gloss (capuchon + bâtonnet)
const OPEN = { duration: 2.4, capUpRatio: 0.34, capSideRatio: 0.5, capTilt: 0.5, balmSpinTurns: 2.0, balmRiseRatio: 0.16 }

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const seg = (t, a, b) => smooth((t - a) / (b - a))
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3)

// ---- shader affiche (distorsion liquide radiale) --------------------------
// bulle qui perce l'eau : TRAIN de rides concentriques qui s'étendent depuis le
// centre (un front qui grandit + plusieurs rides derrière lui), léger bruit
// angulaire pour l'organique tout en restant circulaire.
const RIPPLE_GLSL = `
  float dropWave(vec2 p, float uTime, float uImpactT, float uRippleFreq, float uWaveSpeed, float uRingWidth, float uWaveDecay) {
    float d = length(p);
    float ang = atan(p.y, p.x);
    // cercle quasi parfait : ondulation angulaire très légère (juste vivante, pas cabossée)
    float dd = d + 0.005 * sin(ang * 3.0 + uTime * 0.8);
    float front = uWaveSpeed * uImpactT;                 // le front s'étend avec le temps
    float behind = smoothstep(0.0, 0.18, front - dd);    // rides derrière le front (transition douce)
    float rings = sin((dd - front) * uRippleFreq);       // rides concentriques larges
    return rings * behind * exp(-dd * uRingWidth) * exp(-uImpactT * uWaveDecay);
  }
`
const posterVert = RIPPLE_GLSL + `
  uniform float uTime; uniform float uImpactT; uniform vec2 uCenter; uniform float uAspect;
  uniform float uIntensity; uniform float uRadius; uniform float uBulge; uniform float uRippleAmp;
  uniform float uRippleFreq; uniform float uWaveSpeed; uniform float uRingWidth; uniform float uWaveDecay;
  varying vec2 vUv; varying float vDisp;
  void main() {
    vUv = uv;
    vec2 p = uv - uCenter; p.x *= uAspect;
    float d = length(p);
    float localize = 1.0 - smoothstep(0.0, uRadius, d);   // concentré autour de la bulle
    float dome = localize * uBulge;
    float wave = dropWave(p, uTime, uImpactT, uRippleFreq, uWaveSpeed, uRingWidth, uWaveDecay) * localize;
    float disp = uIntensity * (dome + wave * uRippleAmp);
    vDisp = disp;
    vec3 pos = position; pos.z += disp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`
const posterFrag = RIPPLE_GLSL + `
  uniform sampler2D uAvec; uniform sampler2D uSans; uniform float uMix;
  uniform float uTime; uniform float uImpactT; uniform vec2 uCenter; uniform float uAspect; uniform float uIntensity; uniform float uRadius;
  uniform float uRippleFreq; uniform float uWaveSpeed; uniform float uRingWidth; uniform float uWaveDecay; uniform float uUvAmount;
  varying vec2 vUv; varying float vDisp;
  void main() {
    vec2 p = vUv - uCenter; vec2 pa = vec2(p.x * uAspect, p.y);
    float d = length(pa);
    float localize = 1.0 - smoothstep(0.0, uRadius, d);
    float wave = dropWave(pa, uTime, uImpactT, uRippleFreq, uWaveSpeed, uRingWidth, uWaveDecay);
    vec2 dir = d > 1e-4 ? pa / d : vec2(0.0);
    vec2 dispUv = vec2(dir.x / uAspect, dir.y) * wave * uUvAmount * uIntensity * localize;
    vec2 uvD = vUv + dispUv;
    vec3 ca = texture2D(uAvec, uvD).rgb;
    vec3 cs = texture2D(uSans, uvD).rgb;
    vec3 col = mix(ca, cs, uMix);
    col += vec3(1.0, 0.97, 0.99) * max(vDisp, 0.0) * 1.6;
    gl_FragColor = vec4(col, 1.0);
  }
`

// ---- shader bulle de savon (d'après studio-tama SoapBubble) ---------------
// wobble fbm 3D (avec recalcul des normales par différences finies) + interférence
// spectrale (wavelength→RGB selon l'angle de vue) + reflet d'environnement équirect.
const bubbleVert = `
  uniform float uTime; uniform float uFreq; uniform float uTimeFreq;
  uniform float uDispScale; uniform float uBreath;
  uniform float uAttach; uniform float uNeckLen; uniform float uR;
  varying vec3 vWorldPos; varying vec3 vWorldNrm; varying vec3 vView; varying vec2 vUv;
  // wobble LISSE basse fréquence (respiration d'une vraie bulle, pas de froissé)
  float wob(vec3 p){
    return sin(p.x * uFreq + uTime * 1.1 * uTimeFreq * 3.0)
         + sin(p.y * uFreq * 1.17 + uTime * 1.4 * uTimeFreq * 3.0)
         + sin(p.z * uFreq * 0.86 + uTime * 0.8 * uTimeFreq * 3.0);
  }
  // forme de goutte : le pôle arrière (-Z, côté affiche) s'étire en pointe vers
  // l'affiche puis se rétracte → la bulle accroche à la surface puis se détache
  vec3 teardrop(vec3 q){
    float pz = q.z / uR;                        // ~ -1 (arrière) .. +1 (avant)
    float back = smoothstep(0.2, -1.0, pz);     // 1 au pôle arrière
    float k = back * uAttach;
    q.z -= k * uNeckLen * uR;                    // tire la queue vers l'affiche
    q.xy *= mix(1.0, 0.18, k);                   // rétrécit la queue en pointe
    return q;
  }
  void main(){
    vec3 n = normalize(normal);
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
    vec3 t2 = normalize(cross(n, t1));
    float sh = 0.03;
    vec3 pA = position + t1 * sh;
    vec3 pB = position + t2 * sh;
    float amp = uDispScale * (1.0 + uBreath);
    vec3 P  = teardrop(position + n * (wob(position) * amp));
    vec3 PA = teardrop(pA + n * (wob(pA) * amp));
    vec3 PB = teardrop(pB + n * (wob(pB) * amp));
    vec3 nrm = normalize(cross(normalize(PA - P), normalize(PB - P)));
    vUv = uv;
    vec4 wp = modelMatrix * vec4(P, 1.0);
    vWorldPos = wp.xyz;
    vWorldNrm = normalize(mat3(modelMatrix) * nrm);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const bubbleFrag = `
  uniform float uTime; uniform float uOpacity; uniform sampler2D uEnvMap; uniform float uEnvInt; uniform float uBright;
  uniform float uMinWL; uniform float uMaxWL; uniform float uNoiseStrength; uniform float uBands;
  varying vec3 vWorldPos; varying vec3 vWorldNrm; varying vec3 vView; varying vec2 vUv;
  #define PI 3.14159265359
  vec3 wl2rgb(float w){
    vec3 c;
    if(w>=380.0&&w<440.0) c=vec3((440.0-w)/60.0,0.0,1.0);
    else if(w>=440.0&&w<490.0) c=vec3(0.0,(w-440.0)/50.0,1.0);
    else if(w>=490.0&&w<510.0) c=vec3(0.0,1.0,(510.0-w)/20.0);
    else if(w>=510.0&&w<580.0) c=vec3((w-510.0)/70.0,1.0,0.0);
    else if(w>=580.0&&w<645.0) c=vec3(1.0,(645.0-w)/65.0,0.0);
    else if(w>=645.0&&w<=780.0) c=vec3(1.0,0.0,0.0);
    else c=vec3(0.0);
    float f=0.3;
    if(w>=380.0&&w<420.0) f=0.3+0.7*(w-380.0)/40.0;
    else if(w>=420.0&&w<=700.0) f=1.0;
    else if(w>700.0&&w<=780.0) f=0.3+0.7*(780.0-w)/80.0;
    return c*f;
  }
  vec2 equ(vec3 dir){ return vec2(atan(dir.z,dir.x)/(2.0*PI)+0.5, asin(clamp(dir.y,-1.0,1.0))/PI+0.5); }
  float hash(vec2 p){ return fract(sin(dot(p,vec2(41.31,289.17)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  void main(){
    vec3 N = normalize(vWorldNrm);
    vec3 V = normalize(vView);
    float dp = dot(N, V);
    float g = 1.0 - abs(dp);                     // 0 au centre, 1 au bord
    // interférence de film mince : épaisseur (bruit organique) → PLUSIEURS ordres
    // d'arc-en-ciel (palette cosinus cyclique), comme une vraie bulle de savon
    float thickness = vnoise(vUv * uNoiseStrength + uTime * 0.12);
    float phase = thickness * uBands + abs(dp) * 0.35;
    vec3 iri = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.67)));
    iri = mix(vec3(1.0), iri, 0.7);              // pastel (délicat)
    iri *= vec3(1.10, 0.95, 1.0);                // biais ROSÉ (rose/rosé comme l'image)
    // reflet d'env : SEULEMENT les points lumineux → highlights spéculaires nets
    vec3 R = reflect(-V, N);
    vec3 env = texture2D(uEnvMap, equ(R)).rgb;
    float spec = smoothstep(0.55, 1.3, max(env.r, max(env.g, env.b)));
    vec3 col = iri;
    col += vec3(1.0) * spec * uEnvInt;           // highlights ponctuels
    col += vec3(1.0, 0.9, 0.95) * pow(g, 6.0) * 0.4; // fin liseré légèrement rosé
    col *= uBright;
    // TRÈS transparent (on voit le fond/lipstick) ; plus dense au bord + highlights
    float alpha = clamp(0.06 + 0.4 * pow(g, 2.2) + spec * 0.7, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`
// ---------------------------------------------------------------------------

export function buildPosterBubbleScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)

  const dbg = (() => { try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() } })()
  const center = (() => { const v = dbg.get('bc'); if (v) { const a = v.split(',').map(Number); if (a.length === 2) return a } return CFG.bubbleCenter })()
  const bubbleRadius = parseFloat(dbg.get('br')) || CFG.bubbleRadius

  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 0.88 // réglage /gloss

  // environnement : PMREM pour lipstick + gouttes, ET on GARDE l'équirect pour la bulle
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environmentIntensity = 1.68 // réglage /gloss (forceReflets)
  new RGBELoader().load(CFG.hdrUrl, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    scene.environmentRotation = new THREE.Euler(0, CFG.envRot, 0)
    bubbleUniforms.uEnvMap.value = hdr // conservé pour le reflet équirect de la bulle
  })

  // éclairage calé sur l'affiche : clé chaude en haut-gauche (comme les rayons de lumière)
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xfff0e2, 2.2); key.position.set(-3, 4, 3); scene.add(key)
  const fill = new THREE.DirectionalLight(0xffe4ea, 0.6); fill.position.set(3, 1, 2); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffd9c8, 0.8); rim.position.set(0, 2, -3); scene.add(rim)

  const anchor = new THREE.Group()
  anchor.visible = false
  scene.add(anchor)

  const W = CFG.aspect * CFG.posterH
  const H = CFG.posterH

  // ---- plan affiche + distorsion ------------------------------------------
  const texLoader = new THREE.TextureLoader()
  const loadPoster = (url) => { const t = texLoader.load(url); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; return t }
  const posterUniforms = {
    uTime: { value: 0 }, uImpactT: { value: 0 },
    uCenter: { value: new THREE.Vector2(center[0], center[1]) }, uAspect: { value: CFG.aspect },
    uIntensity: { value: 0 }, uRadius: { value: bubbleRadius }, uBulge: { value: 0.06 },
    uRippleFreq: { value: 38.0 }, uWaveSpeed: { value: 0.55 }, uRingWidth: { value: 2.0 }, uWaveDecay: { value: 0.9 },
    uRippleAmp: { value: 0.38 }, uUvAmount: { value: 0.06 }, uMix: { value: 0 },
    uAvec: { value: loadPoster(CFG.posterAvecUrl) }, uSans: { value: loadPoster(CFG.posterSansUrl) },
  }
  const posterMat = new THREE.ShaderMaterial({ uniforms: posterUniforms, vertexShader: posterVert, fragmentShader: posterFrag })
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 180, 110), posterMat)
  anchor.add(poster)

  // ---- bulle de savon 3D + lipstick ---------------------------------------
  const bubbleGroup = new THREE.Group()
  bubbleGroup.visible = false
  const bubbleX = (center[0] - 0.5) * W
  const bubbleY = (center[1] - 0.5) * H
  bubbleGroup.position.set(bubbleX, bubbleY, 0)
  anchor.add(bubbleGroup)

  // env de secours (1×1) le temps que l'HDR charge — évite un sampler null
  const fallbackEnv = new THREE.DataTexture(new Uint8Array([205, 200, 210, 255]), 1, 1, THREE.RGBAFormat)
  fallbackEnv.needsUpdate = true
  const bubbleUniforms = {
    uTime: { value: 0 }, uOpacity: { value: 1 },
    uEnvMap: { value: fallbackEnv }, uEnvInt: { value: 1.2 }, uBright: { value: 1.0 },
    uMinWL: { value: 380.0 }, uMaxWL: { value: 780.0 }, uNoiseStrength: { value: 3.0 }, uBands: { value: 2.5 },
    uFreq: { value: 3.2 }, uTimeFreq: { value: 0.35 }, uDispScale: { value: 0.012 }, uBreath: { value: 0 },
    uAttach: { value: 0 }, uNeckLen: { value: 1.6 }, uR: { value: CFG.bubble3DRadius },
  }
  const bubbleMat = new THREE.ShaderMaterial({
    uniforms: bubbleUniforms, vertexShader: bubbleVert, fragmentShader: bubbleFrag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
  })
  const bubbleMesh = new THREE.Mesh(new THREE.SphereGeometry(CFG.bubble3DRadius, 96, 64), bubbleMat)
  bubbleMesh.renderOrder = 20
  bubbleGroup.add(bubbleMesh)

  const proxy = new THREE.Mesh(new THREE.SphereGeometry(CFG.bubble3DRadius * 1.05, 16, 12), new THREE.MeshBasicMaterial({ visible: false }))
  bubbleGroup.add(proxy)

  // lipstick (matériaux /gloss), synchronisé sur la respiration de la bulle
  const lipstick = new THREE.Group()
  bubbleGroup.add(lipstick)
  const makeMat = (cfg) => new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.2, ...cfg })
  const mats = {
    cap: makeMat(MAT.cap), cassandre: makeMat(MAT.cassandre), ring: makeMat(MAT.ring), bullet: makeMat(MAT.bullet),
    bottleMatte: makeMat(MAT.bottleMatte), bottleGlossy: makeMat(MAT.bottleGlossy), capInterior: makeMat(MAT.capInterior),
  }
  // groupes d'ouverture (/gloss) : capuchon (LNB_cap + LNB_cap_interior) et bâtonnet
  // (LBN_Bottle_interior, le "bout argenté" qui monte en tournant)
  let capGroup = null, balmGroup = null
  const capBase = new THREE.Vector3()
  let capUp = 0, capSide = 0, balmRise = 0

  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const ready = new Promise((resolve) => {
    loader.load(CFG.modelUrl, (gltf) => {
      const m = gltf.scene
      m.traverse((o) => {
        if (!o.isMesh || !o.material) return
        const mn = (o.material.name || '').toLowerCase()
        if (mn === 'metal_pink') o.material = mats.cap
        else if (mn === 'metal') o.material = mats.cassandre
        else if (mn === 'metal_pink_int') o.material = mats.bullet
        else if (mn === 'pink_matte') o.material = mats.bottleMatte
        else if (mn === 'pink_glossy') o.material = mats.bottleGlossy
        else if (mn === 'black_glossy') o.material = mats.capInterior
        else if (mn.includes('lovenude')) o.material = mats.ring
      })
      // construit les groupes d'ouverture (espace local du modèle, avant mise à l'échelle)
      m.updateMatrixWorld(true)
      const capMeshes = [], balmMeshes = []
      m.traverse((o) => {
        if (o.isMesh && (o.name === 'LNB_cap' || o.name === 'LNB_cap_interior')) capMeshes.push(o)
        else if (o.isMesh && o.name === 'LBN_Bottle_interior') balmMeshes.push(o)
      })
      capGroup = new THREE.Group(); m.add(capGroup)
      const capBox = new THREE.Box3(); capMeshes.forEach((o) => capBox.expandByObject(o))
      capGroup.position.copy(capBox.getCenter(capBase))
      capMeshes.forEach((o) => capGroup.attach(o))
      balmGroup = new THREE.Group(); m.add(balmGroup)
      balmMeshes.forEach((o) => balmGroup.attach(o))
      const preBox = new THREE.Box3().setFromObject(m)
      const localH = preBox.getSize(new THREE.Vector3()).y || 1
      capUp = localH * OPEN.capUpRatio; capSide = localH * OPEN.capSideRatio; balmRise = localH * OPEN.balmRiseRatio

      const box = new THREE.Box3().setFromObject(m)
      const size = box.getSize(new THREE.Vector3())
      const s = CFG.lipstickH / (size.y || 1)
      m.scale.setScalar(s); m.updateMatrixWorld(true)
      const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3())
      m.position.sub(c)
      lipstick.add(m)
      lipstick.rotation.set(0, CFG.lipYaw, CFG.lipTilt)
      status('Prêt'); resolve()
    }, undefined, (err) => { console.error('[poster] modèle', (err && err.stack) || err); status('Erreur modèle'); resolve() })
  })

  // ---- gouttelettes réfractives (verre liquide) — VRAIE physique balistique ----
  // Sphères IcosahedronGeometry(1,2), cachées. Au pop : vitesse de burst puis
  // intégration gravité + traînée d'air (arcs réels) + étirement selon la vitesse.
  const dropGeo = new THREE.IcosahedronGeometry(1, 2)
  const dropMat = new THREE.MeshPhysicalMaterial({
    transmission: 1.0, ior: 1.33, roughness: 0.02, metalness: 0.0,
    thickness: 0.25, transparent: true, color: 0xffffff, envMapIntensity: 1.5,
    attenuationColor: new THREE.Color(0xffe6f2), attenuationDistance: 2.0,
  })
  const drops = []
  const R = CFG.bubble3DRadius
  for (let i = 0; i < CFG.nDrops; i++) {
    const mesh = new THREE.Mesh(dropGeo, dropMat)
    mesh.visible = false
    mesh.renderOrder = 15
    bubbleGroup.add(mesh)
    drops.push({
      mesh,
      size: (0.05 + Math.random() * 0.06) * R, // rayon de la goutte (variable)
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0, maxLife: 0, active: false,
    })
  }
  const G = 2.6 // gravité (unités monde/s²)
  const DRAG = 0.7 // traînée de l'air (amortissement /s)
  const _q = new THREE.Quaternion()
  const _up = new THREE.Vector3(0, 1, 0)
  const _vn = new THREE.Vector3()

  // ---- état / animation ---------------------------------------------------
  let clock = 0, introPlayed = false, introT = 0, popping = false, popT = 0, popped = false
  let gliding = false, glideT = 0, revealed = false, revealSpin = 0
  let isOpen = false, openA = 0

  const playIntro = () => {
    introPlayed = true; introT = 0; popping = false; popped = false; popT = 0
    gliding = false; glideT = 0; revealed = false; revealSpin = 0; isOpen = false; openA = 0
    bubbleGroup.visible = true; bubbleMesh.visible = true; bubbleMesh.scale.setScalar(1)
    bubbleUniforms.uOpacity.value = 1
    posterUniforms.uIntensity.value = 0; posterUniforms.uMix.value = 0
    drops.forEach((d) => { d.active = false; d.mesh.visible = false })
  }

  const toggleOpen = () => {
    if (!revealed) return false
    isOpen = !isOpen
    return isOpen
  }

  const popBubble = () => {
    if (popping || popped || !introPlayed) return false
    popping = true; popT = 0
    bubbleGroup.scale.setScalar(1) // no-op si déjà sortie (pas de saut) ; garantit la bonne taille des gouttes
    // BURST : chaque goutte part d'un point de la surface, vitesse radiale + biais haut
    for (const d of drops) {
      _vn.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      d.pos.copy(_vn).multiplyScalar(R * 0.95)
      const burst = 0.5 + Math.random() * 0.9
      d.vel.copy(_vn).multiplyScalar(burst)
      d.vel.y += 0.35 + Math.random() * 0.4 // biais vers le haut → vrais arcs
      d.vel.x += (Math.random() - 0.5) * 0.15
      d.vel.z += (Math.random() - 0.5) * 0.15
      d.life = 0
      d.maxLife = 1.1 + Math.random() * 0.6
      d.active = true
      d.mesh.visible = false
    }
    return true
  }

  const update = (dt) => {
    clock += dt
    posterUniforms.uTime.value = clock
    bubbleUniforms.uTime.value = clock
    // respiration synchronisée (bulle + lipstick), rythme lent/cinématique
    const breath = Math.sin(clock * 1.25)
    bubbleUniforms.uBreath.value = breath * 0.5

    if (introPlayed) {
      introT += dt
      const t = introT
      posterUniforms.uImpactT.value = t // onde de goutte d'eau qui se propage
      let inten
      if (t < CFG.tDistRise[1]) inten = seg(t, CFG.tDistRise[0], CFG.tDistRise[1])
      else if (t < CFG.tDistFall[0]) inten = 1
      else inten = 1 - seg(t, CFG.tDistFall[0], CFG.tDistFall[1])
      posterUniforms.uIntensity.value = inten
      posterUniforms.uMix.value = seg(t, CFG.tCross[0], CFG.tCross[1])

      const grow = seg(t, CFG.tGrow[0], CFG.tGrow[1])
      const outE = easeOutCubic(clamp01((t - CFG.tEmerge[0]) / (CFG.tEmerge[1] - CFG.tEmerge[0])))
      // accroche à l'affiche puis se détache (seulement avant le pop)
      if (!popping && !popped) {
        const attachIn = seg(t, CFG.tEmerge[0], CFG.tEmerge[0] + 0.25)
        const attachOut = 1 - seg(t, 1.0, 1.7)
        bubbleUniforms.uAttach.value = attachIn * attachOut
      }

      // float organique (dérive + tangage multi-fréquences, lent/cinématique) — continu
      const fa = smooth(clamp01((t - CFG.tEmerge[0]) / (CFG.tEmerge[1] - CFG.tEmerge[0])))
      const fx = (Math.sin(clock * 0.53) + 0.5 * Math.sin(clock * 0.91 + 1.3)) * 0.022 * fa
      const fy = (Math.sin(clock * 0.67 + 2.1) + 0.5 * Math.sin(clock * 1.13)) * 0.022 * fa
      const fz = Math.sin(clock * 0.43 + 0.7) * 0.02 * fa

      // position/échelle de base selon la phase (sortie → flottement → glide → showcase)
      let bx = bubbleX, by = bubbleY, bz = outE * CFG.bubbleOut, bscale = Math.max(grow, 0.0001)
      let tilt = CFG.lipTilt
      if (gliding || revealed) {
        if (gliding) glideT += dt
        const raw = clamp01(glideT / CFG.glideDur)
        const eg = smooth(raw)
        bx = bubbleX + (CFG.glideTarget[0] - bubbleX) * eg
        by = bubbleY + (CFG.glideTarget[1] - bubbleY) * eg + Math.sin(raw * Math.PI) * 0.05 // petit arc
        bz = CFG.bubbleOut
        bscale = 1 + Math.sin(raw * Math.PI) * 0.05 // petit pop d'échelle
        tilt = CFG.lipTilt * (1 - eg) // se redresse en arrivant au centre
        if (gliding && raw >= 1) { gliding = false; revealed = true }
      }
      bubbleGroup.position.set(bx + fx, by + fy, bz + fz)
      bubbleGroup.rotation.set(
        Math.sin(clock * 0.37 + 1.0) * 0.05 * fa,
        Math.sin(clock * 0.29) * 0.06 * fa,
        Math.sin(clock * 0.41 + 2.0) * 0.05 * fa
      )
      bubbleGroup.scale.setScalar(bscale)

      // lipstick : pose (redressée au centre) + tournoiement showcase une fois révélé
      if (revealed) revealSpin += dt * CFG.revealSpin
      lipstick.rotation.set(0, CFG.lipYaw + revealSpin, tilt)
      lipstick.scale.setScalar(1 + breath * 0.02)
      lipstick.position.set(0, 0, 0)

      // ouverture (/gloss) : capuchon qui se lève + s'incline, bâtonnet qui monte en tournant
      if (capGroup) {
        const dir = isOpen ? 1 : -1
        openA = clamp01(openA + (dir * dt) / OPEN.duration)
        const ph = (a, b) => smooth(clamp01((openA - a) / (b - a)))
        const rise = ph(0.0, 0.3), aside = ph(0.3, 0.6), out2 = ph(0.65, 1.0)
        capGroup.position.set(capBase.x + capSide * aside, capBase.y + capUp * rise, capBase.z)
        capGroup.rotation.z = -OPEN.capTilt * aside
        balmGroup.rotation.y = OPEN.balmSpinTurns * Math.PI * 2 * out2
        balmGroup.position.y = balmRise * out2
      }
    }

    if (popping) {
      popT += dt
      // la bulle se réduit à 0 en ~80 ms
      const sk = clamp01(popT / 0.08)
      if (bubbleMesh.visible) {
        bubbleMesh.scale.setScalar(1 - sk)
        if (sk >= 1) { bubbleMesh.visible = false; popped = true }
      }
      // gouttelettes : intégration physique (gravité + traînée) → arcs balistiques
      let anyActive = false
      for (const d of drops) {
        if (!d.active) continue
        d.life += dt
        d.vel.y -= G * dt
        d.vel.multiplyScalar(Math.max(0, 1 - DRAG * dt))
        d.pos.addScaledVector(d.vel, dt)
        const fadeIn = smooth(d.life / 0.06)
        const fadeOut = 1 - smooth((d.life - (d.maxLife - 0.4)) / 0.4)
        const grow = fadeIn * fadeOut
        if (grow <= 1e-4 || d.life >= d.maxLife) { d.active = false; d.mesh.visible = false; continue }
        anyActive = true
        d.mesh.visible = true
        d.mesh.position.copy(d.pos)
        // FORME : étirée selon la vitesse (tension de surface), s'arrondit en ralentissant
        const speed = d.vel.length()
        const stretch = 1 + Math.min(speed * 0.55, 1.4)
        if (speed > 1e-3) {
          _vn.copy(d.vel).multiplyScalar(1 / speed)
          _q.setFromUnitVectors(_up, _vn)
          d.mesh.quaternion.copy(_q)
        }
        const sz = d.size * grow
        const thin = sz / Math.sqrt(stretch)
        d.mesh.scale.set(thin, sz * stretch, thin)
      }
      // le float organique + la pose du lipstick sont déjà gérés dans le bloc de sortie
      // (introPlayed reste vrai pendant le pop) → continuité parfaite, aucun saut
      bubbleUniforms.uAttach.value = 0
      // gouttes terminées → démarre le glide du lipstick vers le milieu de l'affiche
      if (!anyActive && popped) { popping = false; gliding = true; glideT = 0 }
    }
  }

  return {
    anchor, poster, update, playIntro, popBubble, toggleOpen,
    getProxy: () => proxy, hasPlayedIntro: () => introPlayed, isPopped: () => popped,
    isRevealed: () => revealed, ready,
  }
}
