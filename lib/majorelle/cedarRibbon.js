// « BLEU INTERDIT » — ruban de lumière de la note CÈDRE (« l'élévation »).
//
// Deux brins de soie dorée tressés autour d'une hélice qui s'enroule autour du flacon puis plonge dans le col ouvert.
// Chaque brin est une bande tournée vers la caméra (cœur clair + halo ambré, largeur qui s'effile vers la queue et
// « vrille » comme un ruban de soie) ; une tête lumineuse (étoile douce) mène, suivie d'une queue de comète.
// La tête part lentement de sous la base, accélère en tourbillonnant (l'hélice se resserre) et s'engouffre dans le col ;
// la queue s'y écoule à la même vitesse, puis un bref éclat au col.
// Les parties qui passent derrière le flacon sont assombries et teintées de cobalt (vues à travers le jus).
// Mélange prémultiplié (cœur quasi opaque, halo en partie additif, liseré brun très léger) : lisible sur le mur doré
// comme sur le bleu de la porte.
//
// Repère : groupe posé sur la base du flacon, échelle = hauteur du flacon (comme perfume.root), axe du flacon = +Y,
// face = +Z. 1 draw call (2 brins + tête dans la même géométrie), ≈ 1,4 k triangles ; aucune allocation par image.
// Le maillage est créé ici (avant le prewarm du directeur) : renderer.compile() parcourt tout le graphe, visible ou non.
//
// API inchangée : createCedarRibbon(parent, { renderOrder }) → { group, start(dur, fade), stop(), active,
//                 update(dt, basePos, height, time), head(out), dispose() }

import * as THREE from 'three'

const TAU = Math.PI * 2
const N = 200                       // échantillons par brin
const LEN = 0.42                    // longueur de la queue (fraction de la courbe)

const VS = /* glsl */ `
attribute vec3 aTan;      // tangente (brins) | coin du quad (tête)
attribute vec4 aR;        // s (abscisse 0..1), côté (−1 | 1), brin (0 | 1), couche (0 brin, 1 tête)
uniform vec3 uCamL;       // caméra, repère du ruban
uniform vec3 uHeadP;      // tête (chemin central), repère du ruban
uniform vec4 uRun;        // tête brin 0, tête brin 1, longueur de queue, temps
uniform vec4 uLook;       // demi-largeur du halo, éclat de la tête, opacité, absorption (0..1)
varying vec3 vC;          // travers (−1..1), x (0 tête → 1 queue), s
varying vec2 vK;          // vrille (0..1), brin
varying float vOcc;       // 1 = derrière le jus
varying float vLayer;
// silhouette du flacon (demi-largeur en unités « hauteur », d'après perfume_meta : arc outrepassé R 0,30 centré à 0,414)
float bottleHW(float y) {
  if (y < 0.414) return 0.265;
  float d = y - 0.414;
  return sqrt(max(0.0, 0.09 - d * d)) - 0.035;
}
float occlusion(vec3 p, vec3 V) {
  if (p.z > -0.005 || V.z < 0.05) return 0.0;
  vec3 q = p + V * (-p.z / V.z);                   // passage par le plan médian du flacon, vers la caméra
  float hw = bottleHW(q.y);
  float inX = 1.0 - smoothstep(hw - 0.03, hw + 0.01, abs(q.x));
  float inY = smoothstep(0.0, 0.04, q.y) * (1.0 - smoothstep(0.56, 0.62, q.y));   // le jus (le verre seul, plus haut, est clair)
  return inX * inY * smoothstep(-0.005, -0.05, p.z);
}
void main() {
  vec3 p = position;
  vLayer = aR.w;
  if (aR.w < 0.5) {
    float s = aR.x, side = aR.y, k = aR.z;
    float h = k < 0.5 ? uRun.x : uRun.y;
    float x = (h - s) / uRun.z;                     // 0 à la tête, 1 au bout de la queue
    vec3 V = normalize(uCamL - p);
    vec3 X = cross(aTan, V);
    float xl = length(X);
    X = xl > 1e-4 ? X / xl : vec3(1.0, 0.0, 0.0);
    // ruban de soie : il vrille (largeur apparente), s'effile vers la queue, s'arrondit à la tête
    float tw = abs(cos(s * 31.0 - uRun.w * 2.6 + k * 1.9));
    float taper = pow(clamp(1.0 - x, 0.0, 1.0), 0.75) * smoothstep(-0.012, 0.03, x);
    float w = uLook.x * (0.55 + 0.45 * tw) * (0.32 + 0.68 * taper);
    w *= 1.0 - smoothstep(0.93, 1.0, s) * 0.55;     // il s'amincit pour entrer dans le col
    if (x < -0.03 || x > 1.03) w = 0.0;             // hors de la fenêtre visible : triangles dégénérés
    p += X * side * w;
    vC = vec3(side, x, s);
    vK = vec2(tw, k);
    vOcc = occlusion(p, V);
  } else {
    // tête : quad tourné vers la caméra, centré sur la tête du chemin central
    vec3 c = uHeadP;
    vec3 V = normalize(uCamL - c);
    vec3 R = normalize(cross(vec3(0.0, 1.0, 0.0), V));
    vec3 U = cross(V, R);
    float sz = uLook.x * (1.35 + 1.1 * uLook.w) * (0.6 + 0.4 * uLook.y);   // éclat resserré (revue DA : moitié du précédent)
    p = c + (R * aTan.x + U * aTan.y) * sz + V * 0.02;
    vC = vec3(aTan.x, aTan.y, 1.0);
    vK = vec2(0.0);
    vOcc = occlusion(c, V);
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`

const FS = /* glsl */ `
uniform vec4 uRun;
uniform vec4 uLook;
varying vec3 vC;
varying vec2 vK;
varying float vOcc;
varying float vLayer;
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// Or chaud, jamais blanc : la lumière vient de la COUVERTURE (le cœur cache le fond, sa couleur plafonne à ≈ (255, 225, 160)),
// pas d'une addition qui sature. Seul le halo ambré (bleu ≈ 0) s'ajoute au fond : sur le mur doré comme sur le bleu de la
// porte, aucun pixel ne passe au blanc.
void main() {
  vec3 PALE = vec3(1.0, 0.875, 0.60), GOLD = vec3(0.95, 0.68, 0.27), DEEP = vec3(0.80, 0.50, 0.14), AMB = vec3(0.85, 0.40, 0.06);
  vec3 rgb; float a;
  if (vLayer < 0.5) {
    float v = vC.x, x = vC.y, s = vC.z;
    if (x < 0.0 || x > 1.0) discard;
    float tw = vK.x;
    float av = abs(v);
    // corps de soie (opaque, bord net antialiasé) : plus étroit quand le ruban se présente de chant
    float bw = mix(0.30, 0.46, tw);
    float fw = fwidth(v) * 1.2 + 0.01;
    float body = 1.0 - smoothstep(bw - fw, bw + fw, av);
    // le long : tête plus claire, queue qui s'efface, apparition au départ, absorption dans le col
    float headK = exp(-x * 8.0);
    float along = 1.0 - smoothstep(0.22, 1.0, x);
    float born = smoothstep(0.0, 0.07, s);
    float swallow = 1.0 - smoothstep(0.975, 1.0, s);
    float k = along * born * swallow * uLook.z;
    // modelé : reflet satiné décalé du centre (il glisse d'un bord à l'autre quand le ruban vrille), bords plus sombres
    float n = clamp(v / bw, -1.0, 1.0);
    float hc = 0.55 * cos(s * 31.0 - uRun.w * 2.6 + vK.y * 1.9 + 0.8);
    float hl = exp(-(n - hc) * (n - hc) * 7.0) * (0.55 + 0.45 * tw);
    float shade = 1.0 - 0.5 * n * n;
    // ondes de lumière qui courent vers la tête, rares paillettes
    float wave = 0.5 + 0.5 * sin(s * 70.0 - uRun.w * 11.0 + vK.y * 2.0);
    float gl = step(0.988, h12(floor(vec2(s * 900.0, (v + 1.0) * 3.0)) + floor(uRun.w * 9.0)));
    float lite = clamp(0.30 * shade + 0.62 * hl + 0.35 * headK + 0.12 * wave + 0.45 * gl, 0.0, 1.0);
    vec3 cc = mix(mix(DEEP * 0.78, GOLD, smoothstep(0.0, 0.55, lite)), PALE, smoothstep(0.5, 1.0, lite));
    float cov = body * mix(0.95, 0.72, smoothstep(0.1, 0.9, x));   // la queue devient soie translucide
    rgb = cc * cov * k;
    a = cov * k;
    // lueur ambrée autour du corps, en partie additive (aucune composante bleue : jamais de blanc)
    float hal = exp(-pow(max(av - bw, 0.0) / 0.26, 2.0) * 2.2) * (1.0 - body);
    float hk = hal * (0.22 + 0.4 * headK) * (1.0 - 0.6 * x);
    rgb += mix(AMB, GOLD, headK * 0.6) * hk * k;
    a += hk * 0.3 * k;
    // derrière le flacon : vu à travers le jus cobalt
    rgb = mix(rgb, rgb * vec3(0.30, 0.42, 1.0) * 0.45, vOcc * 0.85);
    a *= 1.0 - 0.7 * vOcc;
  } else {
    // tête : perle de lumière d'or pâle (couvrante) dans une lueur ambrée courte ; 4 rayons très discrets
    vec2 c = vC.xy;
    float r2 = dot(c, c);
    float pin = exp(-r2 * 26.0);
    float glow = exp(-r2 * 6.0) * (1.0 - pin);
    float tw = 0.8 + 0.2 * sin(uRun.w * 17.0);
    float ray = (exp(-abs(c.x) * 34.0) * exp(-c.y * c.y * 7.0) + exp(-abs(c.y) * 34.0) * exp(-c.x * c.x * 7.0)) * (1.0 - pin) * 0.22 * tw;
    float k = uLook.y * uLook.z;
    float cov = pin * 0.93;
    rgb = (PALE * cov + mix(AMB, GOLD, 0.6) * (glow * 0.42 + ray)) * k;
    a = (cov + glow * 0.1 + ray * 0.3) * k;
    rgb = mix(rgb, rgb * vec3(0.3, 0.42, 1.0) * 0.5, vOcc * 0.85);
    a *= 1.0 - 0.7 * vOcc;
  }
  if (a < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
  gl_FragColor = vec4(rgb, clamp(a, 0.0, 1.0));
}`

// chemin central : hélice qui se resserre autour du flacon, puis s'enroule au-dessus du col et y plonge
function buildPath() {
  const pts = []
  const th0 = 1.25                                         // départ : devant, au ras de la base
  // A · l'hélice qui s'élève en se resserrant autour du flacon, jusqu'au-dessus du col
  const MA = 72, turnsA = 1.6
  for (let i = 0; i <= MA; i++) {
    const v = i / MA
    const th = th0 + TAU * turnsA * v
    const r = 0.35 * (1 - 0.52 * Math.pow(v, 1.5)) + 0.02 * Math.sin(v * 9.0)   // 0,35 : la boucle basse reste dans l'arc de la porte
    const y = -0.06 + 1.02 * (v * (0.8 + 0.2 * v))
    pts.push(new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th) * 0.8))
  }
  // B · l'entonnoir : dans le même sens, le ruban tourbillonne en descendant et s'engouffre dans le col (y ≈ 0,80)
  const thA = th0 + TAU * turnsA, rA = 0.35 * 0.48 + 0.02 * Math.sin(9.0), yA = 0.96
  const MB = 24
  for (let j = 1; j <= MB; j++) {
    const w = j / MB
    const th = thA + TAU * 0.85 * w
    const r = rA * Math.pow(1 - w, 1.25)
    const y = yA - 0.16 * (w * w * (3 - 2 * w))
    pts.push(new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th) * 0.8))
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  return curve.getSpacedPoints(N - 1)
}

export function createCedarRibbon(parent, { renderOrder = 12.5 } = {}) {
  const centre = buildPath()
  // repère mobile (tangente, normale sortante, binormale) puis deux brins tressés autour du chemin central
  const pos = new Float32Array(2 * N * 2 * 3 + 4 * 3)
  const tan = new Float32Array(pos.length)
  const rr = new Float32Array((2 * N * 2 + 4) * 4)
  const idx = []
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), Bn = new THREE.Vector3(), P = new THREE.Vector3()
  const strandPts = [[], []]
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1)
    const a = centre[Math.max(0, i - 1)], b = centre[Math.min(N - 1, i + 1)]
    T.subVectors(b, a).normalize()
    Nn.set(centre[i].x, 0, centre[i].z)
    if (Nn.lengthSq() < 1e-6) Nn.set(1, 0, 0)
    Nn.addScaledVector(T, -Nn.dot(T)).normalize()
    Bn.crossVectors(T, Nn)
    const rho = 0.042 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.8)   // les brins se rejoignent au départ et au col
    const beta = s * TAU * 4.2
    for (let k = 0; k < 2; k++) {
      const sg = k ? -1 : 1
      P.copy(centre[i]).addScaledVector(Nn, sg * rho * Math.cos(beta)).addScaledVector(Bn, sg * rho * Math.sin(beta))
      strandPts[k].push(P.clone())
    }
  }
  let vtx = 0
  for (let k = 0; k < 2; k++) {
    const sp = strandPts[k]
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1)
      const a = sp[Math.max(0, i - 1)], b = sp[Math.min(N - 1, i + 1)]
      T.subVectors(b, a).normalize()
      for (const side of [-1, 1]) {
        pos.set([sp[i].x, sp[i].y, sp[i].z], vtx * 3)
        tan.set([T.x, T.y, T.z], vtx * 3)
        rr.set([s, side, k, 0], vtx * 4)
        vtx++
      }
      if (i < N - 1) { const o = k * N * 2 + i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
  }
  // tête : un quad
  const hb = vtx
  for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pos.set([0, 0, 0], vtx * 3); tan.set([cx, cy, 0], vtx * 3); rr.set([1, 0, 0, 1], vtx * 4); vtx++
  }
  idx.push(hb, hb + 1, hb + 2, hb, hb + 2, hb + 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aTan', new THREE.BufferAttribute(tan, 3))
  geo.setAttribute('aR', new THREE.BufferAttribute(rr, 4))
  geo.setIndex(idx)
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.45, 0), 1.2)

  // chemin central en tableau plat (tête du ruban, paillettes du directeur) — interpolation sans allocation
  const cArr = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) { cArr[i * 3] = centre[i].x; cArr[i * 3 + 1] = centre[i].y; cArr[i * 3 + 2] = centre[i].z }
  const sampleCentre = (s, out) => {
    const f = Math.min(Math.max(s, 0), 1) * (N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i
    const o = i * 3
    return out.set(cArr[o] + (cArr[o + 3] - cArr[o]) * t, cArr[o + 1] + (cArr[o + 4] - cArr[o + 1]) * t, cArr[o + 2] + (cArr[o + 5] - cArr[o + 2]) * t)
  }

  const U = {
    uCamL: { value: new THREE.Vector3(0, 0.5, 3) },
    uHeadP: { value: new THREE.Vector3() },
    uRun: { value: new THREE.Vector4(0, 0, LEN, 0) },
    uLook: { value: new THREE.Vector4(0.068, 1, 0, 0) },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'PB_CedarRibbon'
  mesh.renderOrder = renderOrder
  mesh.frustumCulled = false
  const inv = new THREE.Matrix4()
  mesh.onBeforeRender = (renderer, scene, camera) => {
    // caméra dans le repère du ruban (matrices à jour au moment du rendu)
    inv.copy(mesh.matrixWorld).invert()
    U.uCamL.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv)
  }
  const group = new THREE.Group()
  group.name = 'PB_CedarRibbonRoot'
  group.visible = false
  group.add(mesh)
  parent.add(group)

  const st = { t: -1, dur: 1.7, fade: 0.45, head: 0 }
  // abscisse de la tête : départ doux (vitesse nulle), accélération continue jusqu'au col (aspiration),
  // puis la queue s'écoule dans le col à la vitesse d'arrivée
  const headAt = (t) => {
    const u = t / st.dur
    if (u <= 1) { const e = Math.max(0, u); return 0.3 * e + 0.7 * e * e * (1.55 - 0.55 * e) }  // h(1)=1, h'(0)=0,3, h'(1)=1,315
    const d = t - st.dur, v1 = 1.315 / st.dur                     // la queue continue d'accélérer : aspirée d'un trait
    return 1 + d * v1 + d * d * v1 * 1.6 / st.dur
  }
  return {
    group,
    mesh,
    /** lance le ruban : la tête parcourt l'hélice en `dur` s, puis la queue s'écoule dans le col en `fade` s */
    start(dur = 1.7, fade = 0.45) {
      st.t = 0; st.dur = Math.max(0.3, dur); st.fade = Math.max(0.1, fade); st.head = 0
      U.uLook.value.z = 0
      group.visible = true
    },
    stop() { st.t = -1; group.visible = false; U.uLook.value.z = 0 },
    get active() { return st.t >= 0 },
    /** suit le flacon : base (repère du parent) et hauteur (unités du parent) */
    update(dt, basePos, height, time) {
      if (st.t < 0) return
      st.t += dt
      const t = st.t
      const h = headAt(t)
      st.head = Math.min(1, h)
      const L = LEN
      const Ru = U.uRun.value
      Ru.x = h
      Ru.y = h - 0.035 * (1 - Math.min(1, Math.max(0, (h - 0.75) / 0.25)))   // le second brin suit de près, puis le rejoint
      Ru.z = L
      Ru.w = time
      // la queue s'est écoulée quand h − L dépasse 1
      const drained = (h - 1) / L
      const Lk = U.uLook.value
      const dk = Math.max(0, Math.min(1, (drained - 0.2) / 0.7))
      Lk.z = Math.min(1, t / 0.25) * (1 - dk * dk * (3 - 2 * dk))
      // tête : vive pendant la course, éclat d'absorption au col puis extinction
      const absorb = h >= 1 ? Math.min(1, (h - 1) / (L * 0.5)) : 0
      Lk.w = Math.sin(Math.PI * Math.min(1, absorb)) * (1 - absorb * 0.3)
      Lk.y = h < 1 ? 0.75 + 0.25 * Math.min(1, t / 0.4) : Math.max(0, 1 - Math.max(0, absorb - 0.5) * 2)
      sampleCentre(Math.min(1, h), U.uHeadP.value)
      group.position.copy(basePos)
      group.scale.setScalar(height)
      if (drained >= 1) this.stop()
    },
    /** position de la tête (repère du parent), pour y semer des paillettes */
    head(out) {
      sampleCentre(st.head, out)
      return out.multiplyScalar(group.scale.x).add(group.position)
    },
    dispose() { parent.remove(group); geo.dispose(); mat.dispose() },
  }
}
