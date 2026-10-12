// Portail YSL — « Jardin Majorelle » : BLEU INTERDIT, le flacon qui dort dans le bassin (SPEC_PERFUME §4, §5, §6).
//
// Fork du directeur rouge à lèvres (lib/majorellePortalScene.js, qui reste intact) : la porte scannée s'ouvre,
// un flacon taillé comme elle dort couché au fond du bassin long, se redresse comme un battant de porte, déchire
// le miroir de l'eau, flotte, puis glisse au ras du bassin et franchit le portail. On frappe les trois coups sur son
// heurtoir, le jardin répond par trois notes, une pression vaporise le sillage qui signe l'arc d'un fil d'or ;
// RANGER le renvoie dormir sous l'eau et la porte se referme.
//
// Entrée : buildMajorellePerfumeScene(renderer, scene, { onStatus, onState, markerPreview, quality })
// API (même forme que le directeur rouge à lèvres) : anchor, ready, update, setCamera, pointerDown / Move / Up / Cancel,
// tapAt(ndc, camera) (eau et porte, sur un pointerup NON capturé), bringOut, knock, spray(hold), returnProduct,
// replay, playIntro, getState, hasPlayedIntro, setQuality, _debug().
//
// Deux horloges : la séquence murale (wq, dt réel) porte les repères de porte de l'intro ; l'horloge du flacon
// (bq / emT, dt × slowMo) porte le mouvement et tout ce qui suit la rupture (le ralenti de la rupture décale la suite).
// Les événements de l'émergence (nearSurface, edgeCross, capCross, baseCross, pinch ; au retour baseUnder, capUnder)
// partent des passages de perfume.extremaGarden() par la surface. Tout splash passe par fx.splash (ordonnanceur WP4).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createDoorGlint, createSeamLight, createPortalRipple, createSparks, createHeroAura } from '@/lib/ysl/effects'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'
import { pickMajorelleInterior, applyMajorelleMaterials, gardenToMarker, markerToGarden } from '@/lib/majorelle/interior'
import { MJ_CFG, applyMajorellePose } from '@/lib/majorellePortalScene'
import { PB_CFG, PB_COPY, PB_RENDER_ORDER } from '@/lib/majorelle/perfumeConfig'
import { createPerfume, makeStudioCube, loadPerfumeTextures } from '@/lib/majorelle/perfume'
import { createEmergeFX } from '@/lib/majorelle/emergeFx'
import { createNotesFX } from '@/lib/majorelle/notesFx'
import { createSillage } from '@/lib/majorelle/sillage'
import { createPerfumeUI } from '@/lib/majorelle/perfumeUI'
import { createCedarRibbon } from '@/lib/majorelle/cedarRibbon'
import { createCedarAnswer, CEDAR_GOLD } from '@/lib/majorelle/cedarAnswer'
import { getPreloadedBuffer, preloadMajorellePerfume } from '@/lib/majorelle/preload'

export { MJ_CFG, applyMajorellePose }

const DEG = Math.PI / 180
const TAU = Math.PI * 2
const TIERS = ['low', 'medium', 'high']
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x)
const clamp01 = (x) => clamp(x, 0, 1)
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10) }
const easeInOutCubic = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2
const easeOutBack = (x, c = 1.70158) => { x = clamp01(x) - 1; return 1 + (c + 1) * x * x * x + c * x * x }
const lerp = (a, b, t) => a + (b - a) * t
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const bezier = (out, p0, p1, p2, p3, t) => {
  const u = 1 - t
  return out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t)
}
// garde du rouge à lèvres : vibrate exige une activation utilisateur (iOS : sans effet)
const vibrate = (p) => { try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; navigator.vibrate?.(p) } catch {} }
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }

const H = PB_COPY.hint
const SUN_DUST = new THREE.Color(1, 0.93, 0.78)
const GOLD_SPARK = new THREE.Color(1.0, 0.82, 0.48)
const SILVER_SPARK = new THREE.Color(0.86, 0.93, 1.0)
const V_UP = new THREE.Vector3(0, 1, 0)
const V_OUT = new THREE.Vector3(0, 0.1, 1)

// Charge ambrée du jus (note de fond) : 0,6 et non 1. À 1, le shader de WP3 mêle 85 % d'ambre au pied du jus et la moitié
// basse du flacon vire au crème (« nude », interdit par la charte), à 0,6 au lavande grisé ; 0,45 garde le jus cobalt avec une lueur chaude au pied.
const CHARGE = 0.45, CHARGE_PULSE = 0.7

export function buildMajorellePerfumeScene(renderer, scene, { onStatus, onState, markerPreview = false, quality, emergeMode } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const reduced = reducedMotion()
  const autoQ = !TIERS.includes(quality) && (PB_CFG.quality === 'auto' || !TIERS.includes(PB_CFG.quality))
  let tier = TIERS.includes(quality) ? quality : TIERS.includes(PB_CFG.quality) ? PB_CFG.quality : 'high'

  // produit et interface sous Neutral ; la cour applique AgX elle-même (lib/majorelle/interior.js)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  // HDR studio : PMREM pour l'or (scene.environment) + cube studio des verres ; l'equirect est gardé jusqu'à makeStudioCube
  const hdrP = new Promise((res) => {
    new RGBELoader().load(MJ_CFG.hdrUrl, (hdr) => res(hdr), undefined, (e) => { console.warn('[perfume-scene] hdr', e); res(null) })
  })

  const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor)
  anchor.add(new THREE.AmbientLight(0xffffff, 0.18))
  const key = new THREE.DirectionalLight(0xffffff, 0), rim = new THREE.DirectionalLight(0xffffff, 0), fill = new THREE.DirectionalLight(0xf6f8ff, 0)
  ;[key, rim, fill].forEach((l) => anchor.add(l, l.target))
  const SUN_COL = new THREE.Color(0xfff0d8), SKY_COL = new THREE.Color(0xcfe0ff), WHITE = new THREE.Color(0xffffff), WARM = new THREE.Color(0xffeedd)
  const sunDir = new THREE.Vector3(...MJ_CFG.sunDir).normalize()

  if (markerPreview) {
    const tex = new THREE.TextureLoader().load(MJ_CFG.markerUrl); tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, MJ_CFG.markerAspect), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, toneMapped: false }))
    plane.renderOrder = -2; anchor.add(plane)
  }

  // ---- état ------------------------------------------------------------------------------------------
  let state = 'loading'
  let meta, pmeta, mixer, doorAction, doorClip, doorRoot, gardenRoot, water, glint, seam, ripple, sparks, aura
  let perfume, fx, notes, sillage, ui
  let cedarAns = null // CÈDRE : vague d'heure dorée sur la cour + pollen d'or (lib/majorelle/cedarAnswer.js)
  let anchorCamera = null
  const D = MJ_CFG.door
  const doorMidY = (D.y0 + D.y1) / 2
  const outPos = new THREE.Vector3(D.seamX, doorMidY + 0.02 - PB_CFG.heroOut / 2, 0.22)
  const E = new THREE.Vector3(...PB_CFG.E)
  const shallow = (emergeMode || PB_CFG.emergeMode) === 'shallow'
  const B0 = new THREE.Vector3(...PB_CFG.lying.base); if (shallow) B0.y += 0.04
  const B1 = new THREE.Vector3(...PB_CFG.preLift.base)
  const PHI0 = PB_CFG.lying.phiDeg * DEG
  const HOVER_Y = PB_CFG.hoverBaseY
  const koiGuard = new THREE.Vector3(...PB_CFG.koiGuard), koiPart = new THREE.Vector3(...PB_CFG.koiPart)
  const lilyAt = new THREE.Vector3(...PB_CFG.notes.lily.at)
  const finaleKoi = new THREE.Vector3(0, 0, -3.2)
  const rainPts = PB_CFG.rain.map((p) => new THREE.Vector3(...p))
  const miniRain = [new THREE.Vector3(-0.05, 0, -2.6)]
  const E_hM = new THREE.Vector3() // E_h en unités marqueur (rempli au chargement)
  const fillStart = PB_CFG.fill.start
  let fillNow = fillStart

  let knocks = 0, unlocked = false, signed = false
  let introHint = ''
  const setState = (s) => { state = s; refreshHint(); onState && onState(s, { knocks, unlocked, signed }) }
  function refreshHint() {
    let h = ''
    if (state === 'loading') h = 'Chargement…'
    else if (state === 'intro') h = introHint
    else if (state === 'enthroned') h = H.enthroned
    else if (state === 'showcase') h = signed ? H.signed : unlocked ? H.unlocked : knocks < 3 ? [H.knock0, H.knock1, H.knock2][knocks] : ''
    else if (state === 'closed') h = H.closed
    status(h)
  }
  const notify = () => { onState && onState(state, { knocks, unlocked, signed }) }

  // ---- interface gardenFx : API publique seulement, vérifiée au chargement (§6.6) ----------------------
  const W = { energy: false, splash: false, gather: false, activity: false, intersect: false, getEnergy: false }
  const _kp = new THREE.Vector3()
  const setEnergy = (v) => { if (W.energy) water.setEnergy(v) }
  const koiActivity = (k) => { if (W.activity) water.koi.setActivity(k) }
  const koiGo = (p, s) => { // rassemblement scénarisé + cible persistante de l'ordonnanceur
    if (W.gather) water.koi.gather(_kp.set(p.x, p.y || 0, p.z), s)
    if (fx) fx.koiTarget(p, s)
  }

  // ---- chargement ------------------------------------------------------------------------------------
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  // GLB préchargés dès l'écran d'accueil (lib/majorelle/preload.js) : on parse les octets déjà en mémoire
  preloadMajorellePerfume()
  const load = async (url) => {
    const buf = await getPreloadedBuffer(url)
    if (buf) {
      try { return await loader.parseAsync(buf.slice(0), url.slice(0, url.lastIndexOf('/') + 1)) } catch (e) { console.warn('[perfume-scene] préchargement illisible', url, e) }
    }
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
  }
  const loadTex = (url) => new Promise((res) => new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t) }, undefined, () => { console.warn('[perfume-scene] texture manquante', url); res(null) }))
  const loadJson = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

  const ready = Promise.all([
    pickMajorelleInterior(MJ_CFG.base).then(async (pick) => {
      if (!pick) throw new Error('cour bakée introuvable (interior.json)')
      return { meta: pick.meta, gltf: await load(pick.glbUrl) }
    }),
    load(MJ_CFG.doorUrl),
    load(PB_CFG.bottleUrl),
    fetch(PB_CFG.metaUrl).then((r) => { if (!r.ok) throw new Error('perfume_meta.json ' + r.status); return r.json() }),
    loadPerfumeTextures(PB_CFG.texBase),
    loadReflectionProbes(`${MJ_CFG.base}/fx/`).catch(() => null),
    hdrP,
    loadJson(`${PB_CFG.texBase}door_arch_path.json`),
    loadTex(`${PB_CFG.texBase}T_PB_petals.png`),
    loadTex(`${PB_CFG.texBase}T_PB_sillage.png`),
  ]).then(([gi, gd, gb, pm, ptex, probes, hdr, archPath, petals, atlas]) => {
    meta = gi.meta; pmeta = pm
    const interior = gi.gltf.scene, door = gd.scene
    applyMajorelleMaterials(interior, meta, MJ_CFG.base, { gold: CEDAR_GOLD }) // crochet CÈDRE (neutre au repos)
    door.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
    doorRoot = door
    anchor.add(interior, door)

    let studioCube = null
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      pmrem.dispose()
      try { studioCube = makeStudioCube(renderer, hdr, 256) } catch (e) { console.warn('[perfume-scene] studio cube', e) }
      hdr.dispose()
    }

    // eau vivante dans le repère jardin (mètres)
    gardenRoot = new THREE.Group()
    gardenRoot.position.set(meta.X_OFF, meta.Z_OFF, 0)
    gardenRoot.scale.setScalar(meta.K)
    anchor.add(gardenRoot)
    // éclairage publié par le bake (golden hour) : soleil, ciel, lumières du flacon dans la cour ; sinon valeurs d'origine
    if (Array.isArray(meta.sun?.dir)) sunDir.set(...meta.sun.dir).normalize()
    if (meta.heroLight?.sun) SUN_COL.set(meta.heroLight.sun)
    if (meta.heroLight?.sky) SKY_COL.set(meta.heroLight.sky)
    water = createGardenFX({
      parent: gardenRoot, sunDir: sunDir.clone(), reflectionCube: probes, energy: 0, gold: CEDAR_GOLD.uMjGold,
      ...(meta.sun?.color ? { sunColor: meta.sun.color } : {}), ...(meta.sky ? { sky: meta.sky } : {}),
    })
    // test de fumée (§6.6) : en cas d'API manquante, plus aucun appel à l'eau, le reste tourne
    W.energy = typeof water.setEnergy === 'function'
    W.getEnergy = typeof water.getEnergy === 'function'
    W.splash = typeof water.splash === 'function'
    W.gather = typeof water.koi?.gather === 'function'
    W.activity = typeof water.koi?.setActivity === 'function'
    W.intersect = typeof water.intersectWater === 'function'
    const missing = Object.keys(W).filter((k) => !W[k])
    if (missing.length) console.warn('[perfume-scene] gardenFx : API manquante, appels à l\'eau désactivés pour', missing)
    water.update(1 / 60, null) // les koï quittent l'origine avant le premier rendu (rapport WP4)

    glint = createDoorGlint(door)
    seam = createSeamLight(anchor, { x: D.seamX, y0: D.y0, y1: D.y1 - 0.02, z: 0.004, halfW: D.halfW })
    const rippleRoot = new THREE.Group(); rippleRoot.position.set(D.seamX, doorMidY, 0); anchor.add(rippleRoot)
    ripple = createPortalRipple(rippleRoot, { sx: D.halfW * 1.25, sy: (D.y1 - D.y0) * 0.55 })
    sparks = createSparks(anchor)
    cedarRibbon = createCedarRibbon(anchor)
    aura = createHeroAura(anchor)

    mixer = new THREE.AnimationMixer(door)
    doorClip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
    doorAction = mixer.clipAction(doorClip); doorAction.setLoop(THREE.LoopOnce, 1); doorAction.clampWhenFinished = true

    gardenToMarker(meta, E.x, HOVER_Y, E.z, E_hM)

    // modules du parfum
    perfume = createPerfume(gb, {
      meta: pmeta, textures: ptex, probes, studioCube, gardenMeta: { K: meta.K, X_OFF: meta.X_OFF, Z_OFF: meta.Z_OFF },
      lights: { key, rim }, quality: tier, anchor, gardenRoot,
      onStrike: () => onPerfumeStrike(), onTink: () => onTink(), onCapClick: () => onCapClick(),
    })
    anchor.add(perfume.root)
    fx = createEmergeFX({
      parent: gardenRoot, water: W.splash ? water : null, probes, sunDir: sunDir.clone(), quality: tier,
      renderOrderBase: 0, splashRules: PB_CFG.splash,
    })
    if (perfume.meshes.refl) fx.reflect.track(perfume.meshes.refl, 1) // P2 : imposteur miroir du proxy
    notes = createNotesFX({
      gardenRoot, anchor, gardenMeta: meta, textures: { petals }, quality: tier, sunDir: sunDir.clone(), water,
      pads: water.debug?.pads || null, staticFlowers: water.debug?.flowers || null,
    })
    cedarAns = createCedarAnswer({ gardenRoot, quality: tier, reduced, renderOrder: PB_RENDER_ORDER.cedarMotes ?? 7.9 }) // avant prewarm() : son programme se compile au chargement
    sillage = createSillage({ anchor, gardenRoot, gardenMeta: meta, door: D, archPath, atlas, quality: tier })
    ui = createPerfumeUI(anchor, { center: new THREE.Vector3(D.seamX, outPos.y + PB_CFG.heroOut / 2, outPos.z), copy: PB_COPY, reducedMotion: reduced })

    buildDripCandidates()
    resetToClosed()
    prewarm()
    setState('ready')
  }).catch((err) => { console.error('[perfume-scene]', (err && err.stack) || err); status('Erreur de chargement') })

  function prewarm() {
    const cam = anchorCamera
    if (!cam || !perfume) return
    // tout visible le temps d'une compilation (les looks cour / vitrine sont des uniforms : un seul programme)
    // (nouveaux objets du jardin : pluie de néroli 112 instances, champ de 6 lotus, pollen du CÈDRE — un seul programme
    // de plus, celui du pollen ; renderer.compile compile aussi les maillages à 0 instance)
    const objs = [anchor, ui.group, aura.group, perfume.glints, sillage.points, sillage.ribbon, sillage.veilMesh, cedarRibbon && cedarRibbon.group, ...notes.objects, ...(cedarAns ? cedarAns.objects : [])]
    const vis = objs.map((o) => o && o.visible)
    objs.forEach((o) => { if (o) o.visible = true })
    if (cedarAns) cedarAns.setPrewarm(true)
    try {
      anchor.traverse((o) => { const m = o.material; if (m?.map) renderer.initTexture(m.map); if (m?.lightMap) renderer.initTexture(m.lightMap) })
      fx.prewarm(renderer, scene, cam) // rend aussi ses propres pièces visibles et compile la scène entière
      ui.prewarm(renderer, cam)
      // three ne lit les uniforms / attributs d'un programme qu'à son premier dessin (getProgramInfoLog) :
      // sans ça chaque effet gèle 65–90 ms à sa première apparition, en pleine animation
      for (const p of renderer.info.programs) { p.getUniforms(); p.getAttributes() }
    } catch (e) { console.warn('[perfume-scene] prewarm', e) }
    if (cedarAns) cedarAns.setPrewarm(false)
    objs.forEach((o, i) => { if (o) o.visible = vis[i] })
  }

  // ---- files d'attente : murale (dt) et flacon (dt × slowMo) ------------------------------------------------
  const wq = [], bq = []
  let wT = 0, bT = 0, token = 0
  const atW = (t, fn) => { const k = token; wq.push({ t: wT + t, fn, k }) }
  const atB = (t, fn) => { const k = token; bq.push({ t: bT + t, fn, k }) }
  const runQueue = (q, now) => {
    for (let i = 0; i < q.length; i++) {
      const e = q[i]
      if (e.t > now) continue
      q.splice(i, 1); i--
      if (e.k === token) e.fn()
    }
  }

  // ---- pose du flacon (§6.3) : { B (jardin) | M (marqueur), φ, yaw, lean, scale } appliquée une fois par image ----------
  let heroMode = 'lying'
  const pose = { garden: true, B: new THREE.Vector3().copy(B0), M: new THREE.Vector3(), phi: PHI0, yaw: 0, lean: 0, scale: PB_CFG.heroInGarden, bob: 0 }
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), gp = new THREE.Vector3()
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const ex = { highestY: 0, highestX: 0, lowestY: 0, capTopY: 0, capX: 0, shoulderY: 0, shoulderX: 0, baseLowY: 0 }
  const sec = { ok: false, x0: 0, x1: 0, zc: 0, halfDepth: 0 }
  const ev = {}
  const studAbove = new Uint8Array(32)
  const resetEvents = () => { Object.assign(ev, { near: false, edge: false, cap: false, base: false, pinch: false, baseT: 0, baseUnder: false, capUnder: false, under: false }); studAbove.fill(0) }
  resetEvents()
  let clock = 0, emT = 0, modeT = 0
  let slowMo = 1, slowTarget = 1, slowT = 0
  let jolt = -1
  let hoverT0 = 0
  const ff = { B: new THREE.Vector3(), phi: 0, yaw: 0, t: 0 }
  let crossed = false, skims = 0
  let yawStart = 0, scaleStart = 0
  // vitrine : pose courante lissée vers les cibles (aparté, vaporisation, signature)
  // user : choix du visiteur pour l'aparté (−1 aucun → l'aparté automatique des réponses décide ; 0 centre ; 1 aparté).
  // Un toucher bref du flacon bascule centre ↔ aparté et le flacon reste où le visiteur l'a laissé ; VAPORISER, RANGER
  // et la relecture rendent la main à l'automatique (−1, centre).
  const show = { asideK: 0, asideV: 0, yawB: 0, swayA: 0.17, yawUser: 0, spinVel: 0, releaseT: -99, faceT: -1, faceFrom: 0, bounceT: -1, quietT: 9, user: -1 }
  // aparté : profil quintique de (p, v, a) courants vers une cible au repos (v = a = 0) en T ∝ √|Δ| (1,15 s pour un aller)
  const asideMv = { p0: 0, v0: 0, a0: 0, to: 0, t: 1, T: 1, c3: 0, c4: 0, c5: 0, a: 0 }
  function asideRetarget(to) {
    const p = show.asideK, v = show.asideV, a = asideMv.a, D = to - p
    const T = 1.15 * Math.sqrt(Math.max(0.3, Math.abs(D))), T2 = T * T, T3 = T2 * T
    asideMv.p0 = p; asideMv.v0 = v; asideMv.a0 = a; asideMv.to = to; asideMv.t = 0; asideMv.T = T
    asideMv.c3 = (20 * D - 12 * v * T - 3 * a * T2) / (2 * T3)
    asideMv.c4 = (-30 * D + 16 * v * T + 3 * a * T2) / (2 * T3 * T)
    asideMv.c5 = (12 * D - 6 * v * T - a * T2) / (2 * T3 * T2)
  }
  function asideStep(dt) {
    if (asideMv.t >= asideMv.T) { show.asideK = asideMv.to; show.asideV = 0; asideMv.a = 0; return }
    const t = Math.min(asideMv.T, asideMv.t + dt), M = asideMv
    M.t = t
    const t2 = t * t, t3 = t2 * t
    show.asideK = M.p0 + M.v0 * t + 0.5 * M.a0 * t2 + M.c3 * t3 + M.c4 * t3 * t + M.c5 * t3 * t2
    show.asideV = M.v0 + M.a0 * t + 3 * M.c3 * t2 + 4 * M.c4 * t3 + 5 * M.c5 * t3 * t
    M.a = M.a0 + 6 * M.c3 * t + 12 * M.c4 * t2 + 20 * M.c5 * t3
  }
  function asideRest(k) { show.asideK = k; show.asideV = 0; Object.assign(asideMv, { p0: k, v0: 0, a0: 0, to: k, t: 1, T: 1, a: 0 }) }
  // options préallouées des appels faits à chaque image (aucune allocation par image)
  const glowFollow = { at: [0, 0, 0], y: 0, phi: 0 }, holdOpts = { at: new THREE.Vector3(), radius: 0.05 }
  const RING_SMALL = { r1: 0.25, life: 1.2 }, RING_IDLE = { r1: 0.25, life: 1.4 }
  // réponses du jardin (GARDEN XL) : cibles des koï et anneaux, préalloués
  const RING_LOTUS = { r1: 0.30, life: 1.3 }
  const KOI_NEROLI_A = new THREE.Vector3(-0.30, 0, -3.30), KOI_NEROLI_B = new THREE.Vector3(0.20, 0, -4.20)
  const LOTUS_CENTROID = new THREE.Vector3(-0.10, 0, -3.70)
  const SPLASH_LOW = { priority: 'low' }, SPLASH_LILY = { koi: { point: lilyAt, seconds: 9 } }
  let lastRingT = -99

  const applyPose = () => {
    const r = perfume.root
    if (pose.garden) gardenToMarker(meta, pose.B.x, pose.B.y + pose.bob, pose.B.z, r.position)
    else r.position.copy(pose.M)
    r.rotation.set(pose.lean, 0, pose.phi)
    perfume.spin.rotation.y = pose.yaw
    r.scale.setScalar(pose.scale)
  }
  const setLying = () => {
    pose.garden = true; pose.B.copy(B0); pose.phi = PHI0; pose.yaw = 0; pose.lean = 0; pose.scale = PB_CFG.heroInGarden; pose.bob = 0
  }
  // centre du flacon (jardin) pour une pose B, φ (hauteur réelle = scale / K)
  const centreGarden = (out) => {
    const h = pose.scale / meta.K
    return out.set(pose.B.x - Math.sin(pose.phi) * h * 0.5, pose.B.y + Math.cos(pose.phi) * h * 0.5, pose.B.z)
  }

  // ---- gouttes pendantes : points candidats (contour + coins du capuchon), la bande émergée la plus basse ------------
  const dripLocal = [], dripOut = Array.from({ length: 16 }, () => new THREE.Vector3())
  const toGarden = new THREE.Matrix4(), invGarden = new THREE.Matrix4()
  function buildDripCandidates() {
    const out = pmeta.outline || []
    const n = Math.min(12, out.length)
    for (let i = 0; i < n; i++) { const p = out[Math.floor((i * out.length) / n)]; dripLocal.push(new THREE.Vector3(p[0], p[1], 0)) }
    for (const p of (pmeta.keyPoints?.capTop || []).slice(0, 4)) dripLocal.push(new THREE.Vector3(p[0], p[1], p[2]))
    while (dripLocal.length > 16) dripLocal.pop()
  }
  const refreshToGarden = () => {
    gardenRoot.updateWorldMatrix(true, false)
    invGarden.copy(gardenRoot.matrixWorld).invert()
    perfume.model.updateWorldMatrix(true, false)
    toGarden.multiplyMatrices(invGarden, perfume.model.matrixWorld)
  }
  const dripFn = () => {
    refreshToGarden()
    let lo = 1e9
    const n = dripLocal.length
    for (let i = 0; i < n; i++) {
      const o = dripOut[i].copy(dripLocal[i]).applyMatrix4(toGarden)
      if (o.y > 0.004 && o.y < lo) lo = o.y
    }
    for (let i = 0; i < n; i++) if (dripOut[i].y > lo + 0.1) dripOut[i].y = -1 // seule la bande émergée la plus basse goutte
    for (let i = n; i < 16; i++) dripOut[i].set(0, -1, 0)
    return dripOut
  }
  const base8 = Array.from({ length: 8 }, () => new THREE.Vector3())
  const baseFn = (out) => out.copy(pose.B)

  // ---- reset / intro ------------------------------------------------------------------------------------
  function resetToClosed() {
    token++
    wq.length = 0; bq.length = 0; wT = 0
    doorAction.reset(); doorAction.timeScale = 1; doorAction.play(); doorAction.paused = true; doorAction.time = 0; mixer.update(0)
    setEnergy(0); koiActivity(0.8)
    fx.clear(); notes.clear(); sillage.clear(); if (cedarAns) cedarAns.clear()
    ui.reset(); ui.hide(); ui.ghost(false); ui.setHold(null); ui.setDim(1)
    perfume.setCapOpen(false); perfume.setWet(1); perfume.setSheet(false); perfume.setGlow(shallow ? 1.0 : 0.35); perfume.setCharge(0)
    fillNow = fillStart; perfume.setFill(fillNow)
    perfume.setClip(true); perfume.setOutside(0, 0); perfume.setGardenMix(1, 0)
    aura.set(0); seam.set(0.6)
    setLying(); heroMode = 'lying'; emT = 0; modeT = 0
    resetEvents()
    knocks = 0; unlocked = false; signed = false; introHint = ''
    done.fill(false); shake.t = -1; shake.th = 0; shake.om = 0; cedar.t = -1; cedar.y = 0; cedar.v = 0; cedarBusy = false
    knockFx.t = -1; knockFx.rec = -1
    if (cedarRibbon) cedarRibbon.stop()
    ans.cur = -1; ans.queue.length = 0; strikeQ.length = 0; spr.busy = false; spr.finale = false
    ans.hold[0] = ans.hold[1] = ans.hold[2] = -1; ans.aside.fill(false); ans.viewClear = -1; pend = -1; cedar.endT = -1; asideRest(0); lastRingT = -99
    drag = null; slowMo = 1; slowTarget = 1; slowT = 0; jolt = -1; crossed = false; skims = 0
    Object.assign(show, { asideK: 0, asideV: 0, yawB: 0, swayA: 0.17, yawUser: 0, spinVel: 0, releaseT: -99, faceT: -1, faceFrom: 0, bounceT: -1, quietT: 9, user: -1 })
    lastTouch = clock; ghostOn = false; doorClosing = false; lastChase = clock; lastKoiE = clock
    key.intensity = rim.intensity = fill.intensity = 0
    if (perfume) { applyPose(); perfume.update(0, ctx) }
  }

  function playIntro() {
    if (!perfume) return
    resetToClosed()
    setState('intro')
    const swingAt = shallow ? 2.9 : PB_CFG.swingStart
    const holdAt = shallow ? 2.6 : 2.9
    atW(0.1, () => glint.sweep(1.5, 2.2))
    atW(0.3, () => seam.set(1))                                                                     // le soleil filtre par la fente
    atW(1.45, () => { seam.flash(); vibrate(12); jolt = 0; sparks.emit({ at: tmp.set(D.seamX, doorMidY, 0.01), count: 22, dir: V_OUT, spread: 0.9, speed: [0.03, 0.12], life: [0.6, 1.2], gravity: -0.02, jitter: 0.25, color: SUN_DUST }) })
    atW(1.7, () => {
      jolt = -1
      doorAction.paused = false; doorAction.timeScale = 0.75; doorAction.play()
      seam.set(0)
      for (let i = 0; i < 4; i++) sparks.emit({ at: tmp.set(D.seamX, D.y0 + 0.08 + i * 0.16, 0.0), count: 18, dir: tmp2.set(0, 0.15, 1), spread: 0.8, speed: [0.04, 0.18], life: [1.4, 2.6], gravity: -0.01, drag: 0.9, jitter: 0.05, color: SUN_DUST })
      koiGo(koiGuard, 8)                                                                            // les koï veillent derrière le dormeur
    })
    atW(1.8, () => setEnergy(0.35))                                                                // le jardin murmure
    atW(2.1, () => {                                                                                // la lueur
      centreGarden(tmp)
      fx.glow.set(shallow ? 1.0 : 0.6, { at: [tmp.x, 0, E.z], y: tmp.y, phi: pose.phi / DEG, dur: 1.0 })
      fx.glow.beat(0) // lueur fixe, sans battement (demande client : le flacon ne doit pas clignoter)
      introHint = H.introGlow; refreshHint()
    })
    atW(holdAt, () => {                                                                             // le jardin retient son souffle
      setEnergy(0.06); koiActivity(0.5)
      fx.glow.set(shallow ? 1.0 : 0.8, { dur: 0.6 }); fx.glow.beat(0)
      perfume.setGlow(shallow ? 1.0 : 0.6, 0.6)
    })
    atW(swingAt, startSwing)
  }

  function startSwing() {
    heroMode = 'swing'; emT = 0
    koiGo(koiPart, 3); koiActivity(1.5)                                                             // les koï s'écartent
    // repères de l'horloge du flacon (temps après le début du battant ; +3,4 s pour le temps d'intro)
    atB(2.3, () => { koiActivity(1.0); koiGo(E, 9) })                                              // 5.70 les koï reviennent
    atB(2.8, () => {                                                                                // 6.20 le jardin expire
      setEnergy(1)
      perfume.capAnchor(tmp)
      sparks.emit({ at: tmp, count: 24, dir: V_UP, spread: 1, speed: [0.02, 0.06], life: [1, 2], gravity: 0.01, drag: 0.8, jitter: 0.03, color: SUN_DUST })
      aura.set(0.45)
      fx.glow.set(null, { at: [0, 0, E.z] }); fx.glow.patch(0.35)
    })
    atB(3.1, () => {                                                                                // 6.50 trône
      perfume.glintChase(0.8); glint.sweep(0.8, 1.6)
      setState('enthroned')
      lastTouch = clock; lastChase = clock; lastKoiE = clock
    })
    atB(4.0, () => setEnergy(0.75))                                                                 // 7.40
    atB(6.1, () => { if (state === 'enthroned') fx.drops.setRate(1 / 3) })                          // les gouttes se raréfient
  }

  // ---- avance rapide (dès 1,70 s, dans toute sous-phase de l'intro) -----------------------------------
  function fastForward() {
    if (state !== 'intro' || wT < 1.7 || heroMode === 'ff') return false
    wq.length = 0; bq.length = 0; jolt = -1
    if (doorAction.time < doorClip.duration) { doorAction.paused = false; doorAction.play() }
    doorAction.timeScale = 3
    seam.set(0)
    setEnergy(0.75)
    ff.B.copy(pose.B); ff.phi = pose.phi; ff.yaw = pose.yaw; ff.t = 0
    pose.bob = 0
    heroMode = 'ff'
    fx.dome.hide(0.15); fx.collar.hide(0.15); fx.neck.hide(0.15)
    fx.glow.set(0, { dur: 0.3 }); fx.glow.beat(0); fx.glow.patch(0); fx.drops.stop()
    perfume.setGlow(0.25, 0.3); perfume.setWet(1); perfume.setSheet(false)
    perfume.dry(3) // l'intro accélérée saute hoverReached() : sans ça les filets d'eau restent dans le jus jusqu'à la fin
    Object.assign(ev, { near: true, edge: true, cap: true, base: true, pinch: true })
    slowTarget = 1; slowT = 0
    fx.splash(gp.copy(E), 0.8, { priority: 'high' })
    introHint = ''; refreshHint()
    return true
  }

  // ---- sortie : écrémage au ras du bassin, puis l'arc ---------------------------------------------------------
  function bringOut() {
    if (!perfume) return
    if (state === 'intro') { fastForward(); return }
    if (state !== 'enthroned') return
    startExit()
  }
  function startExit() {
    setState('exiting')
    vibrate(10)
    aura.set(0)
    setEnergy(0.45)
    fx.drops.stop(); fx.glow.patch(0, 0.4)
    heroMode = 'glide'; modeT = 0; crossed = false; skims = 0
    pose.garden = true
    yawStart = pose.yaw
    exitFrom.copy(pose.B); exitFrom.y += pose.bob; pose.bob = 0
    atB(0.20, () => {                                                                               // le baiser
      fx.splash(gp.copy(E), 0.5, { priority: 'low' })
      for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; fx.rings.add(E.x + Math.cos(a) * 0.12, E.z + Math.sin(a) * 0.08, 0.5, { r1: 0.3, life: 1.4 }) }
    })
    atB(0.90, () => fx.splash(gp.set(0, 0, -2.25), 0.35))
    for (const t of [0.45, 0.75, 1.05]) atB(t, () => { // 3 gouttes qui traînent
      fx.drops.spawn(gp.set(pose.B.x + (Math.random() - 0.5) * 0.2, pose.B.y + 0.005, pose.B.z - 0.04), tmp2.set(0, -0.05, -0.25), 0.0035)
    })
  }
  const exitFrom = new THREE.Vector3()

  // ---- vitrine : les trois notes, chacune avec son geste, dans l'ordre choisi par le visiteur ----------------
  //   FLEUR    : tenu par le haut et agité comme des clochettes (pendule entraîné, roulis dans le plan de la face) ;
  //              l'anneau balance en pendule secondaire, le jus ballotte en retard → fleurs d'oranger
  //   ÉCLOSION : l'anneau se lève, se suspend, frappe ; rebonds physiques, recul du flacon (translation) → le nénuphar s'ouvre
  //   CÈDRE    : élévation, le capuchon se dévisse et flotte, ruban et ambre entrent par le col, veines d'or dans le jus,
  //              vague de reflets, le capuchon se revisse (clic), le flacon se repose → les cuivres de la porte répondent
  // Aucune animation ne fait tourner le flacon autour de son axe vertical (seul le geste du visiteur le fait).
  // Seuls les boutons jouent les notes ; un toucher bref du flacon ne joue rien : il tressaille et bascule entre le
  // centre et l'aparté (demande client), un glissé le tourne.
  // hold[i] : jusqu'à quand (horloge du flacon) la réponse i garde le flacon en aparté — tenu par les événements du
  // jardin (dernière fleur posée + 1,2 s ; tous les lotus ouverts + 1,8 s), avec un plafond de secours. L'aparté
  // automatique n'est gardé que pour les notes où il dévoile nettement plus du bassin (PB_CFG.aside.auto, mesuré dans
  // la vue visiteur) ; le choix du visiteur (show.user) l'emporte toujours.
  const ans = { cur: -1, t0: 0, queue: [], hold: [-1, -1, -1], viewClear: -1, aside: [false, false, false] }
  // auto[i] : true (toujours), false (jamais) ou 'view' : seulement si, dans la vue courante, le flacon centré cacherait
  // le champ de lotus (moins de `viewMinClear` lotus dégagés — vue proche) ; de loin, il en laisse autant que l'aparté
  function autoAside(i) {
    const a = PB_CFG.aside.auto, m = a ? a[i] : true
    if (m === 'view') { ans.viewClear = lotusClearIfCentred(); return ans.viewClear < (PB_CFG.aside.viewMinClear ?? 3) }
    return m !== false
  }
  // nombre de lotus du champ qui se verraient dégagés (≥ 3 points sur 5 de la corolle vus par l'embrasure et hors du
  // flacon) avec le flacon posé au centre de la vitrine : rayons caméra → corolle contre la silhouette basse définition
  // du flacon (PB_ReflProxy, 378 triangles ; le verre sinon). Une fois par réponse (≈ 30 rayons) ; vecteurs préalloués.
  const _lv = new THREE.Vector3(), _lc = new THREE.Vector3(), _lw = new THREE.Vector3(), _lsv = new THREE.Vector3()
  const _lm = new THREE.Matrix4(), _lray = new THREE.Raycaster(), _lhits = []
  const LOTUS_PTS = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]] // centre + 4 points à 0,6 × la portée de la corolle
  function lotusClearIfCentred() {
    const cam = anchorCamera, ms = perfume && perfume.meshes
    const sil = ms && (ms.refl || ms.glass)
    if (!cam || !sil) return 0
    const r = perfume.root
    // silhouette à la pose centrée (le flacon peut être en aparté au moment de la décision), puis pose rendue
    _lsv.copy(r.position); const s0 = r.scale.x
    r.position.copy(outPos); r.scale.setScalar(PB_CFG.heroOut); r.updateMatrixWorld(true)
    cam.updateMatrixWorld()
    cam.getWorldPosition(_lw)
    anchor.updateWorldMatrix(true, false)
    _lm.copy(anchor.matrixWorld).invert()
    _lc.copy(_lw).applyMatrix4(_lm)                                         // caméra, repère de l'ancre (poster z = 0)
    const L = PB_CFG.notes.lily, F = L.field
    let n = 0
    for (let k = 0; k < F.length; k++) {
      const ax = k === 0 ? L.at[0] : F[k].at[0], az = k === 0 ? L.at[2] : F[k].at[1]
      const foot = 0.2665 * (F[k].sc ?? 1)                                 // portée de la corolle ouverte (m)
      let ok = 0
      for (let j = 0; j < LOTUS_PTS.length; j++) {
        gardenToMarker(meta, ax + LOTUS_PTS[j][0] * foot, 0.03, az + LOTUS_PTS[j][1] * foot, _lv)
        const t = _lc.z / (_lc.z - _lv.z)                                   // traversée du plan du poster
        if (!(t > 0 && t < 1)) continue
        const px = _lc.x + (_lv.x - _lc.x) * t, py = _lc.y + (_lv.y - _lc.y) * t
        if (Math.abs(px - D.seamX) > D.halfW || py < D.y0 || py > D.y1) continue
        _lv.applyMatrix4(anchor.matrixWorld)                                // monde
        const dist = _lv.distanceTo(_lw)
        _lray.set(_lw, _lv.sub(_lw).normalize()); _lray.far = dist
        _lhits.length = 0
        sil.raycast(_lray, _lhits)
        if (!_lhits.length) ok++
      }
      if (ok >= 3) n++
    }
    r.position.copy(_lsv); r.scale.setScalar(s0); r.updateMatrixWorld(true)
    return n
  }
  let lastKnockT = -99, lastTouch = 0, ghostOn = false
  const done = [false, false, false]
  // note touchée pendant un geste : elle attend (une seule, la dernière touchée) et part d'elle-même à la libération
  // du geste (flacon revenu à la verticale, frappe, clic du capuchon)
  let pend = -1, pendT = 0, busyT = -99
  // FLEUR : « clochettes » — la main saisit le haut du flacon (il se soulève à peine), l'agite par quatre à-coups
  // irréguliers (trajectoire lisse qui s'arrête à chaque retournement, petit arc de poignet, le haut descend un peu) ;
  // le flacon pend comme un pendule entraîné (simulé) : il traîne, dépasse, se balance librement, puis la main
  // l'apaise et le rend exactement vertical. Paillettes secouées aux retournements les plus vifs.
  const shake = { t: -1, dur: 2.8, th: 0, om: 0, hx: 0, hy: 0, hxPrev: 0, vxPrev: 0, hyPrev: 0, vyPrev: 0, omPrev: 0, sparkN: 0, side: 1 }
  const SHK_T = new Float32Array(7), SHK_X = new Float32Array(7)
  const SHK_T0 = [0, 0.30, 0.54, 0.78, 1.03, 1.30, 1.72], SHK_X0 = [0, -0.006, 0.032, -0.026, 0.018, -0.008, 0]
  // CÈDRE : « l'élévation » — repères (s) du geste ; la descente part au clic du capuchon
  const CED = { capOpen: 0.30, ribbon: 0.95, amber: 1.0, swirl: 2.15, wave: 2.55, capClose: 2.80, lift: 0.058 }
  const cedar = { t: -1, dur: 4.9, down: 4.1, y: 0, v: 0, x: 0, endT: -1 }
  let cedarBusy = false
  // ÉCLOSION : souffle du flacon pendant que l'anneau monte, recul puis retour amorti à la frappe (translation seule)
  const knockFx = { t: -1, rec: -1 }
  // options préallouées des étincelles (aucune allocation par image)
  const SPK_SHAKE = { at: new THREE.Vector3(), count: 9, dir: new THREE.Vector3(), spread: 0.5, speed: [0.05, 0.14], life: [0.5, 1.0], gravity: -0.07, drag: 1.7, jitter: 0.012, color: GOLD_SPARK }
  const SPK_RIBBON = { at: new THREE.Vector3(), count: 1, dir: V_UP, spread: 0.6, speed: [0.003, 0.012], life: [0.5, 0.9], gravity: 0.01, drag: 0.9, jitter: 0.002, color: null }
  const SPK_STRIKE = { at: new THREE.Vector3(), count: 10, dir: new THREE.Vector3(), spread: 0.75, speed: [0.025, 0.08], life: [0.35, 0.75], gravity: -0.05, drag: 1.8, jitter: 0.004, color: GOLD_SPARK }
  const AMBER = new THREE.Color(1.0, 0.68, 0.3)
  SPK_RIBBON.color = AMBER
  let cedarRibbon = null
  const nextUndone = () => { const i = done.indexOf(false); return i < 0 ? 0 : i }
  // un nouveau geste est accepté pendant que le jardin répond encore à la note précédente (la réponse attend son tour) ;
  // seuls un geste en cours ou une réponse déjà en attente le bloquent
  const noteBusy = () => ans.queue.length >= 2 || perfume.knocking || shake.t >= 0 || cedarBusy || spr.busy
  function markDone(i) {
    if (done[i]) return
    done[i] = true
    knocks = done.filter(Boolean).length
    if (typeof ui.setDone === 'function') ui.setDone(done.slice()); else ui.setKnocks(knocks)
    if (knocks >= 3 && !unlocked) { unlocked = true; ui.setSpray({ locked: false }) }
    refreshHint(); notify()
  }
  function playNote(i) {
    if (state !== 'showcase' || spr.busy) return false
    if (noteBusy() || clock - lastKnockT < PB_CFG.knock.debounce) { pend = i; pendT = clock; lastTouch = clock; return false } // part à la libération
    pend = -1
    lastKnockT = clock; lastTouch = clock
    ghostOn = false; ui.ghost(false)
    const first = !done[i]
    if (i === 0) { // FLEUR : agiter
      // tenu par le haut et agité comme des clochettes : le verre s'incline, le jus reste à l'horizontale et ballotte.
      // Images clés de la main tirées au hasard (±25 ms, ±12 %, premier élan à gauche ou à droite) : jamais deux fois pareil
      const side = Math.random() < 0.5 ? -1 : 1
      for (let k = 0; k < 7; k++) {
        const inner = k > 0 && k < 6
        SHK_T[k] = SHK_T0[k] + (inner ? (Math.random() - 0.5) * 0.05 : 0)
        SHK_X[k] = SHK_X0[k] * side * (inner ? 0.88 + Math.random() * 0.24 : 1)
      }
      shake.t = 0; shake.hx = 0; shake.hy = 0; shake.hxPrev = 0; shake.vxPrev = 0; shake.hyPrev = 0; shake.vyPrev = 0
      shake.omPrev = shake.om; shake.sparkN = 0; shake.side = side
      vibrate(8)
      // les fleurs tombent quand le flacon s'immobilise : le geste d'abord, la réponse du jardin ensuite
      atB(shake.dur - 0.1, () => { if (first) ans.queue.push({ idx: 0, at: bT }); else notes.neroli.reprise() }) // rappel : compte du palier
      if (first) atB(shake.dur - 0.05, () => markDone(0))
    } else if (i === 1) { // ÉCLOSION : l'anneau se lève sans hâte ; la frappe arrive par onStrike (perfume.strikeAt ≈ 0,61 s)
      strikeQ.push(first ? 1 : -1); perfume.knock()
      knockFx.t = 0; knockFx.rec = -1
    } else { // CÈDRE : « l'élévation » — le flacon s'élève en apesanteur et respire, le capuchon se dévisse et va flotter
      // à côté, un ruban d'or s'enroule jusqu'au col ouvert et l'ambre des battants y entre, des veines d'or descendent
      // dans le jus et s'y déposent, les clous s'allument en vague montante, le capuchon revient se visser (clic) et
      // le flacon se repose en douceur
      cedarBusy = true; cedar.t = 0; cedar.endT = -1
      cedar.down = CED.capClose + perfume.capTimes.close - 0.04; cedar.dur = cedar.down + 0.8
      vibrate(10)
      atB(CED.capOpen, () => perfume.setCapOpen(true, 'ritual'))
      atB(CED.ribbon, () => cedarRibbon && cedarRibbon.start(1.5, 0.45))
      atB(CED.amber, () => {
        if (first) notes.amber.fire({ fromAnchor: leafPoints(), toAnchorFn: (out) => perfume.nozzleAnchor(out), dur: 1.5, onAbsorbed: () => perfume.meniscusRing(0.45) })
        else notes.amber.reprise(16)
        if (first) ans.queue.push({ idx: 2, at: bT }); else { glint.sweep(2.2, 1.3); if (cedarAns) cedarAns.reprise() } // rappel : vague dorée plus douce
      })
      if (first) atB(CED.amber + 0.05, () => markDone(2))
      atB(CED.swirl, () => perfume.chargeSwirl(1.8))
      // la couche d'or naît quand le panache l'atteint (tête à ≈ 0,3 du jus), s'enrichit puis se pose
      atB(CED.swirl + 0.8, () => perfume.setCharge(CHARGE_PULSE, 0.8))
      atB(CED.wave, () => perfume.glintWave(1.25, true))
      atB(CED.swirl + 1.8, () => perfume.setCharge(CHARGE, 0.9))
      atB(CED.capClose, () => { if (!spr.busy) perfume.setCapOpen(false, 'ritual') })
      atB(cedar.down, () => { cedarBusy = false }) // le clic : la note suivante peut partir pendant que le flacon se repose
    }
    return true
  }
  // ancienne API « frapper » : joue la prochaine note non encore jouée (automatisation, tests)
  function knock() { return playNote(nextUndone()) }
  const strikeQ = []
  function onPerfumeStrike() {
    if (!strikeQ.length) return
    onStrike(strikeQ.shift())
  }
  function onStrike(idx) {
    if (state !== 'showcase' && state !== 'finale') return
    perfume.strikeAnchor(tmp)
    perfume.spin.getWorldDirection(tmp2) // +Z du flacon (face) → repère de l'ancre
    anchor.getWorldQuaternion(_q).invert(); tmp2.applyQuaternion(_q).normalize()
    // anneau de choc contenu dans le verre : rayon max 0,7 × largeur ≈ 0,087 (demi-largeur du verre 0,111 à 0,40)
    ui.strike(tmp, pose.scale * 0.31, tmp2)
    // éclats fins et brefs, projetés hors de la face (pas de gerbe) ; le flacon recule d'un souffle puis revient
    SPK_STRIKE.at.copy(tmp); SPK_STRIKE.dir.copy(tmp2)
    sparks.emit(SPK_STRIKE)
    knockFx.rec = 0
    // seul l'effet sur le flacon (anneau de choc + étincelles) : plus d'onde dans l'encadrement ni sur le bassin (demande client)
    vibrate([14, 40, 8])
    if (idx < 0) { notes.lily.pulse(); koiGo(lilyAt, 6); return } // ÉCLOSION rejouée : rappel discret
    ans.queue.push({ idx, at: bT + PB_CFG.knock.answerDelay })
    markDone(idx)
  }
  const _q = new THREE.Quaternion()
  function startAnswer(i) {
    ans.cur = i; ans.t0 = bT; lastTouch = clock
    const k = token
    if (i === 0) { // I · NÉROLI, la lumière : une pluie de fleurs d'oranger sur tout le bassin et sur ses bords
      // (≈ 6,9 s du premier départ à la dernière fleur posée ; GARDEN XL §2). Seules les fleurs posées sur l'eau rident
      // la surface (une fleur sur deux, ≥ 0,08 s entre deux anneaux) ; les deux premières éclaboussent (et appellent les koï).
      const r = notes.neroli.fire({
        onLand: (o, p, idx, surf) => {
          if (k !== token || surf !== 'water') return
          if (o < 2) fx.splash(p, 0.25, SPLASH_LOW)
          else if ((o & 1) === 0 && clock - lastRingT >= 0.08) { lastRingT = clock; fx.rings.add(p.x, p.z, 0.25, RING_SMALL) }
        },
      })
      // aparté tenu jusqu'à la dernière fleur posée + 1,2 s (plafond 9,5 s)
      ans.aside[0] = !spr.busy && autoAside(0)
      if (ans.aside[0]) ans.hold[0] = bT + Math.min(r.lastLandAt + 1.2, 9.5)
      // les koï ondulent sous le tapis de fleurs
      atB(1.8, () => koiGo(KOI_NEROLI_A, 7)); atB(4.5, () => koiGo(KOI_NEROLI_B, 6))
      sparks.emit({ at: tmp.set(D.seamX, doorMidY, -0.04), count: 18, dir: V_UP, spread: 1, speed: [0.006, 0.02], life: [1.6, 2.6], gravity: 0.004, drag: 0.6, jitter: 0.16, color: SUN_DUST })
      atB(1.2, () => ui.setNote(0))
    } else if (i === 1) { // II · NYMPHÉAS, l'eau : un champ de 6 lotus bleus éclos en vague depuis le héros (GARDEN XL §3)
      fx.glow.spare(0.9, { at: [lilyAt.x, -0.12, lilyAt.z], dur: 0.2, radius: 0.25, underwater: true })
      atB(0.45, () => fx.glow.spare(0, { dur: 0.6 }))
      // aparté (si gardé pour cette note) tenu jusqu'à tous les lotus ouverts + 1,8 s (onAllOpen ≈ 4,5 s), plafond 9 s
      const aside = ans.aside[1] = !spr.busy && autoAside(1)
      if (aside) ans.hold[1] = bT + 9.0
      notes.lily.rise(lilyAt, {
        radius: PB_CFG.notes.lily.radius,
        // héros : l'éclaboussure (et les koï qui accourent) ; les autres percent la surface d'un anneau doux
        onSurface: (p, j) => { if (k !== token) return; if (j === 0) fx.splash(p, 0.45, SPLASH_LILY); else fx.rings.add(p.x, p.z, 0.35, RING_LOTUS) },
        onAllOpen: () => { if (k !== token) return; if (aside && !spr.busy) ans.hold[1] = bT + 1.8; koiGo(LOTUS_CENTROID, 6) },
      })
      perfume.meniscusRing(0.6)
      atB(0.6, () => { setEnergy(1); ui.setNote(1) })
      atB(2.2, () => setEnergy(0.75))
    } else { // III · CÈDRE & AMBRE, la cour : les cuivres de la porte répondent, puis une vague de lumière d'heure dorée
      // traverse toute la cour jusqu'au mur du fond, le bassin devient de l'or liquide et un pollen d'or monte
      // (GARDEN XL §4 ; l'ambre, le ruban et l'or du jus appartiennent au geste du flacon, joués par playNote tant que le
      // col est ouvert, même si cette réponse attend). Pas d'aparté : la lumière se lit sur toute la cour.
      glint.sweep(2.6, 1.5)
      if (cedarAns) cedarAns.fire()
      setEnergy(1)
      atB(1.6, () => setEnergy(0.75))
      ui.setNote(2)
    }
  }
  // points de départ de l'ambre : sur les battants ouverts (repère de l'ancre)
  function leafPoints() {
    const pts = [], box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3()
    doorRoot.updateMatrixWorld(true); anchor.updateMatrixWorld(true)
    doorRoot.traverse((o) => {
      if (!o.isMesh || !/door_?[lr]/i.test(o.name)) return
      box.setFromObject(o); box.getCenter(c); box.getSize(sz)
      for (const f of [0.22, 0.42, 0.62, 0.8]) pts.push(anchor.worldToLocal(new THREE.Vector3(c.x, box.min.y + sz.y * f, c.z)))
    })
    if (!pts.length) for (const sx of [-1, 1]) for (const f of [0.25, 0.5, 0.75]) pts.push(new THREE.Vector3(D.seamX + sx * D.halfW * 0.85, D.y0 + (D.y1 - D.y0) * f, -0.08))
    return pts
  }
  // bouton FLEUR / ÉCLOSION / CÈDRE : première fois = la note complète, ensuite le geste + un rappel
  function noteTap(i) { playNote(i) }

  // ---- vaporisation : finale « Le sillage » puis mini-vaporisations (§5.4) ---------------------------------
  const spr = { busy: false, finale: false, yawGoal: 0 }
  function spray(hold = 0.6) {
    if (state !== 'showcase' || !unlocked || spr.busy) return false
    hold = clamp(hold || 0.6, 0.6, 1.4)
    lastTouch = clock
    ui.setHold(null)
    spr.busy = true
    const ext = hold - 0.6
    const k = token
    fillNow = Math.max(PB_CFG.fill.min, fillNow - PB_CFG.fill.perSpray)
    perfume.setCapOpen(true)
    spr.yawGoal = PB_CFG.sprayYawDeg * DEG
    const pschitt = (h) => {
      perfume.pump()
      sillage.spray({ nozzle: perfume.nozzleAnchor(new THREE.Vector3()), dir: perfume.sprayDirAnchor(new THREE.Vector3()), hold: h })
      perfume.setFill(fillNow)
      vibrate([8, 30, 8])
    }
    pend = -1
    ans.hold[0] = ans.hold[1] = ans.hold[2] = -1 // le flacon vaporise au centre ; plus d'aparté jusqu'à la fin
    show.user = -1                                // et le choix du visiteur (toucher du flacon) est oublié : retour au centre
    if (!signed) {
      spr.finale = true
      // la réponse du jardin encore en attente (la 3e note, touchée juste avant VAPORISER) n'est jamais perdue :
      // elle part pendant la finale, à son heure (au plus tôt maintenant), l'une après l'autre s'il y en a deux
      for (let j = 0; j < ans.queue.length; j++) {
        const a = ans.queue[j]
        atB(Math.max(0, a.at - bT) + j * 1.2, () => startAnswer(a.idx))
      }
      ans.queue.length = 0
      setState('finale')
      ui.setDim(0.4)
      atB(0.45, () => { pschitt(hold); if (!reduced && tier !== 'low') sillage.veil(0.12, 0.8, anchorCamera) })
      atB(1.20 + ext, () => sillage.pourToDoor({ onCross: () => { if (k === token) ripple.fire() } }))
      atB(2.30 + ext, () => { sillage.traceArch({ dur: 1.2 }); glint.sweep(1.2, 1.8); perfume.glintChase(1.2) })
      atB(3.50 + ext, () => {
        let first = true
        sillage.rain({
          landings: rainPts, spacing: PB_CFG.rainSpacing,
          onLand: (i, p) => {
            if (k !== token) return
            fx.splash(p, 0.5)
            if (first) { first = false; fx.carpet.sparkle([0, -1.9, 0, -4.6], 3) }
          },
        })
      })
      atB(3.60 + ext, () => notes.neroli.reprise()) // rappel : compte du palier
      atB(3.90 + ext, () => { setEnergy(1); koiGo(finaleKoi, 8); koiActivity(1.4) })
      atB(4.30 + ext, () => { notes.lily.pulse(); perfume.setCharge(CHARGE_PULSE, 0.25) })
      atB(4.70 + ext, () => perfume.setCharge(CHARGE, 0.6))
      atB(5.00 + ext, () => { perfume.setCapOpen(false); spr.yawGoal = PB_CFG.signatureYawDeg * DEG })
      atB(5.60 + ext, () => setEnergy(0.75))
      atB(5.80 + ext, () => {
        signed = true; spr.busy = false; spr.finale = false
        ui.setFinal(); ui.setDim(1)
        koiActivity(1.0)
        setState('showcase')
      })
    } else { // mini-vaporisation (≈ 3 s), sans bandes cinéma
      atB(0.45, () => pschitt(hold))
      atB(1.20 + ext, () => sillage.pourToDoor({ dur: 0.9, onCross: () => { if (k === token) ripple.fire() } }))
      atB(2.10 + ext, () => sillage.rain({ landings: miniRain, onLand: (i, p) => { if (k === token) fx.splash(p, 0.4) } }))
      atB(2.40 + ext, () => { perfume.setCapOpen(false); spr.yawGoal = PB_CFG.signatureYawDeg * DEG })
      atB(3.00 + ext, () => { spr.busy = false; lastTouch = clock })
    }
    return true
  }
  function onCapClick() {
    if (state !== 'showcase' && state !== 'finale') return
    vibrate(12)
    perfume.capAnchor(tmp)
    sparks.emit({ at: tmp, count: 22, dir: V_UP, spread: 1, speed: [0.03, 0.1], life: [0.5, 1.0], gravity: -0.06, color: GOLD_SPARK })
  }
  function onTink() {
    if (state !== 'showcase' && state !== 'finale' && state !== 'exiting') return
    vibrate(4)
    perfume.strikeAnchor(tmp)
    sparks.emit({ at: tmp, count: 4, dir: V_OUT, spread: 0.8, speed: [0.01, 0.04], life: [0.3, 0.6], gravity: -0.02, color: GOLD_SPARK })
  }

  // ---- RANGER : retour au bassin, la porte se referme (§4.5) ------------------------------------------------
  function returnProduct() {
    if (cedarRibbon) cedarRibbon.stop()
    if (!perfume || state !== 'showcase' || spr.busy) return
    setState('returning')
    ui.hide(); ui.ghost(false); ui.setHold(null); ghostOn = false
    aura.set(0)
    if (cedarAns) cedarAns.release(0.8) // les battants se referment sans lumière dorée
    show.user = -1; ans.hold[0] = ans.hold[1] = ans.hold[2] = -1
    ans.queue.length = 0; pend = -1
    perfume.setCapOpen(false)
    heroMode = 'return'; modeT = 0; crossed = false; skims = 0
    pose.garden = false; pose.M.copy(perfume.root.position)
    yawStart = pose.yaw; scaleStart = pose.scale
    P[0].copy(pose.M)
    P[1].set(D.seamX, doorMidY - 0.04, -0.40)
    gardenToMarker(meta, 0, 0.30, -1.30, P[2])
    P[3].copy(E_hM)
    resetEvents()
    atB(0.4, () => setEnergy(1))
    atB(2.5, () => koiGo(E, 6))
    atB(4.0, () => koiGo(koiGuard, 10))
    atB(5.3, () => {                                                                                // il se couche ; le cœur lent revient
      setEnergy(0.3)
      centreGarden(tmp)
      fx.glow.set(0.45, { at: [tmp.x, 0, E.z], y: tmp.y, phi: PHI0 / DEG, dur: 0.8 }); fx.glow.beat(0)
      perfume.setGlow(0.35, 0.8)
      koiActivity(0.8)
    })
    atB(5.6, () => {                                                                                // les portes se referment
      if (!PB_CFG.closeDoor) return
      doorAction.enabled = true; doorAction.paused = false; doorAction.timeScale = -1.0
      if (doorAction.time <= 0) doorAction.time = doorClip.duration
      doorAction.play()
      doorClosing = true
    })
    atB(8.0, () => { doorClosing = false; setState('closed') })
  }
  let doorClosing = false

  // ---- gestes ----------------------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster()
  const rayG = new THREE.Ray(), rayA = new THREE.Ray(), invA = new THREE.Matrix4()
  let drag = null
  const courtyard = () => heroMode === 'lying' || heroMode === 'swing' || heroMode === 'lift' || heroMode === 'hover' || heroMode === 'ff' || heroMode === 'glide' || heroMode === 'sink' || heroMode === 'rest'
  // toucher précis (demande client : « dès que j'appuie dessus, pas autour »)
  const hitMeshes = []
  const bottleHit = () => {
    if (!perfume || !anchor.visible) return null
    perfume.root.updateMatrixWorld(true)
    if (courtyard()) {
      // dans la cour : la boîte englobante du flacon, sans marge (un peu plus large seulement couché sous l'eau, en intro)
      perfume.proxy.scale.setScalar(state === 'intro' ? 1.6 : 1.0)
      perfume.proxy.updateMatrixWorld(true)
      return raycaster.intersectObject(perfume.proxy, false)[0] || null
    }
    // devant la porte : la forme réelle du flacon (verre, jus, or, bouchon s'il est en place), rien autour
    hitMeshes.length = 0
    const ms = perfume.meshes || {}
    for (const mm of [ms.glass, ms.juice, ms.gold]) if (mm) hitMeshes.push(mm)
    if (ms.cap && !perfume.capOpen) hitMeshes.push(ms.cap)
    return raycaster.intersectObjects(hitMeshes, false)[0] || null
  }
  // le rayon passe-t-il par l'embrasure de la porte (plan du poster z = 0) ?
  const throughDoor = (ray) => {
    anchor.updateWorldMatrix(true, false)
    invA.copy(anchor.matrixWorld).invert()
    rayA.copy(ray).applyMatrix4(invA)
    if (Math.abs(rayA.direction.z) < 1e-6) return false
    const t = -rayA.origin.z / rayA.direction.z
    if (t <= 0) return false
    rayA.at(t, tmp3)
    return Math.abs(tmp3.x - D.seamX) <= D.halfW && tmp3.y >= D.y0 && tmp3.y <= D.y1
  }
  function pointerDown(ndc, camera, id = 0) {
    if (!perfume || !anchor.visible) return false
    if (drag) { if (drag.id !== id) return true; drag = null }
    raycaster.setFromCamera(ndc, camera)
    if ((state === 'showcase' || state === 'finale') && ui.isShown()) {
      const u = ui.hit(raycaster)
      if (u) { drag = { id, mode: 'ui', ui: u, x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: performance.now(), t0: clock, moved: 0, fired: false, spin: false }; lastTouch = clock; return true }
    }
    if (state === 'intro' || state === 'enthroned' || state === 'showcase' || state === 'finale') {
      if (bottleHit()) { const now = performance.now(); drag = { id, mode: 'bottle', ui: null, x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: now, ts: now, t0: clock, moved: 0, fired: false, spin: false }; lastTouch = clock; return true }
    }
    // doigt posé sur l'eau (à travers la porte) : sillage qui suit le doigt tant qu'il reste appuyé, les koï s'enfuient
    if ((state === 'enthroned' || state === 'showcase') && wakeOK()) {
      const h = waterAt(raycaster.ray)
      if (h) { drag = { id, mode: 'water', ui: null, x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: performance.now(), t0: clock, moved: 0, fired: false, spin: false }; fx.wake.start(h); lastTouch = clock; return true }
    }
    return false
  }
  const waterHit = new THREE.Vector3()
  const wakeOK = () => W.intersect && typeof fx?.wake?.start === 'function'
  // point d'eau (repère jardin) visé à travers l'embrasure, ou null
  function waterAt(ray) {
    if (!W.intersect || !throughDoor(ray)) return null
    gardenRoot.updateWorldMatrix(true, false)
    invGarden.copy(gardenRoot.matrixWorld).invert()
    rayG.copy(ray).applyMatrix4(invGarden)
    return water.intersectWater(rayG, waterHit)
  }
  function pointerMove(ndc, camera, id = 0) {
    if (!drag || drag.id !== id) return false
    const dx = ndc.x - drag.lx
    drag.moved = Math.max(drag.moved, Math.hypot(ndc.x - drag.x0, ndc.y - drag.y0))
    const now = performance.now(), mdt = Math.max(0.008, (now - drag.lt) / 1000)
    drag.lx = ndc.x; drag.lt = now
    if (drag.mode === 'water') {
      raycaster.setFromCamera(ndc, camera)
      const h = waterAt(raycaster.ray)
      if (h) fx.wake.move(h)
      lastTouch = clock
      return true
    }
    if (drag.mode === 'bottle' && state === 'showcase' && !spr.busy) {
      if (!drag.spin && drag.moved > 0.03 && Math.abs(ndc.x - drag.x0) > Math.abs(ndc.y - drag.y0)) { drag.spin = true; ui.setHold(null) }
      if (drag.spin) {
        show.yawUser += dx * 5
        show.spinVel = clamp((dx * 5) / mdt, -14, 14)
        show.faceT = -1
        lastTouch = clock
      }
    }
    return true
  }
  function pointerCancel(id = 0) {
    if (drag && drag.id === id) { if (drag.mode === 'water') fx.wake.end(); drag = null; ui.setHold(null) }
    return true
  }
  const holdOf = (d) => clamp(clock - d.t0, 0.6, 1.4)
  function pointerUp(ndc, camera, id = 0) {
    if (!drag || drag.id !== id) return false
    const d = drag; drag = null
    ui.setHold(null)
    const tap = d.moved < 0.03
    lastTouch = clock
    if (d.mode === 'water') { fx.wake.end(); return true }
    if (d.mode === 'ui') {
      if (!tap || d.fired) return true
      ui.press(d.ui)
      if (d.ui.type === 'note') noteTap(d.ui.index, d.ui.lit)
      else if (d.ui.id === 'spray') {
        if (unlocked && state === 'showcase' && !spr.busy) spray(holdOf(d))
        else { ui.setSpray({ pulse: true }); refreshHint() }
      } else if (d.ui.id === 'return') returnProduct()
      return true
    }
    if (state === 'intro') { if (!fastForward()) seam.flash(); return true }
    if (state === 'enthroned') { bringOut(); return true }
    if (state === 'showcase') {
      if (d.fired) return true
      if (d.spin) { show.releaseT = clock; return true }
      // toucher le flacon ne joue jamais de note ni de vaporisation (tout passe par les boutons) : il tressaille, le jus
      // frémit ; un toucher BREF (pas un glissé, pas un appui long) le fait glisser entre le centre et l'aparté (demande
      // client : « si on clique sur le flacon ça le décale ») — sans jamais le tourner
      perfume.impulse(tmp.set(0.18, -0.12, 0)); vibrate(4)
      if (d.mode === 'bottle' && d.moved < BOTTLE_TAP.move && performance.now() - d.ts < BOTTLE_TAP.ms) toggleAside()
    }
    return true
  }
  // toucher bref : moins de 0,045 NDC sans glissé horizontal (un glissé horizontal tourne le flacon dès 0,03), < 0,6 s
  const BOTTLE_TAP = { move: 0.045, ms: 600 }
  // bascule centre ↔ aparté d'après la cible affichée (en route vers l'aparté ou en aparté → centre ; sinon → aparté).
  // Le choix reste jusqu'au prochain toucher : les réponses laissent le flacon où le visiteur l'a mis ; s'il le ramène
  // pendant un aparté automatique, il revient au centre et y reste. Pendant une vaporisation, rien ne bouge.
  function toggleAside() {
    if (heroMode !== 'showcase' && heroMode !== 'aside') return false
    if (spr.busy) return false
    show.user = asideMv.to > 0.5 ? 0 : 1
    show.quietT = Math.max(show.quietT, 0.4) // un toucher n'attend pas le « temps calme » de l'aparté automatique
    return true
  }
  // eau et porte : appelé par la page sur un pointerup NON capturé (< 0,03 NDC)
  let lastDoorTap = -99
  function tapAt(ndc, camera) {
    if (!perfume || !anchor.visible) return false
    raycaster.setFromCamera(ndc, camera)
    if (state === 'closed') { playIntro(); return true }
    if (state === 'intro') { if (!fastForward()) seam.flash(); return true }
    if (state === 'enthroned' || state === 'showcase') {
      lastTouch = clock
      if (throughDoor(raycaster.ray)) {
        gardenRoot.updateWorldMatrix(true, false)
        invGarden.copy(gardenRoot.matrixWorld).invert()
        rayG.copy(raycaster.ray).applyMatrix4(invGarden)
        if (fx.tapWater(rayG)) return true
      }
      if (clock - lastDoorTap > 1.0) { lastDoorTap = clock; glint.sweep(0.9, 1.2) } // la porte répond aussi
      return true
    }
    return false
  }

  // ---- qualité automatique (§6.7) ------------------------------------------------------------------------
  const frameS = new Float32Array(240)
  let frameN = 0, lastPerf = 0, qDecided = !autoQ, qStart = -1
  function setQuality(q) {
    if (!TIERS.includes(q) || !perfume) return
    tier = q
    perfume.setQuality(q); fx.setQuality(q); notes.setQuality(q); sillage.setQuality(q)
    if (cedarAns) cedarAns.setQuality(q)
  }
  function measureFrame() {
    const now = performance.now()
    const d = now - lastPerf; lastPerf = now
    if (qDecided || state === 'loading' || state === 'ready') return
    if (qStart < 0) { qStart = now; return }
    if (d > 0 && d < 200 && frameN < frameS.length) frameS[frameN++] = d
    if (now - qStart < 2000) return
    qDecided = true
    if (frameN < 20) return
    const s = Array.from(frameS.subarray(0, frameN)).sort((a, b) => a - b)
    const med = s[frameN >> 1]
    // 8th Wall cale souvent la boucle sur la caméra (30 i/s ≈ 33 ms) : ce n'est pas un GPU saturé → moyen, pas bas
    if (med > 45) setQuality('low'); else if (med > 22) setQuality('medium')
    console.info('[perfume-scene] qualité', tier, `(médiane ${med.toFixed(1)} ms)`)
  }

  // ---- boucle --------------------------------------------------------------------------------------------
  const ctx = { camera: null, anchor, gardenRoot: null }
  const update = (dtRaw) => {
    if (!perfume || !anchor.visible) return
    measureFrame()
    const dt = clamp(dtRaw || 0, 0, 0.05)
    clock += dt
    // 1. ralenti (rupture 0,5 ; traversée 0,28 ; jamais sous prefers-reduced-motion)
    if (slowT > 0) { slowT -= dt; slowMo += (slowTarget - slowMo) * Math.min(1, dt * 14) } else slowMo += (1 - slowMo) * Math.min(1, dt * 10)
    if (reduced) slowMo = 1
    const sdt = dt * slowMo
    // 2. séquences
    wT += dt; bT += sdt
    runQueue(wq, wT); runQueue(bq, bT)
    // 3. modules
    if (jolt >= 0) { // déclic : les battants tressautent puis restent entrebâillés
      jolt += dt
      const a = Math.min(1, jolt / 0.12), b = Math.min(1, Math.max(0, (jolt - 0.12) / 0.2))
      const shake = Math.sin(jolt * TAU * 18) * 0.012 * Math.max(0, 1 - jolt / 0.3)
      doorAction.paused = true
      doorAction.time = Math.max(0, 0.22 * (1 - Math.pow(1 - a, 2)) - 0.09 * b * b + shake)
    }
    mixer.update(dt)
    water.update(sdt, anchorCamera)
    fx.update(sdt, anchorCamera)
    notes.update(sdt, anchorCamera)
    if (cedarAns) cedarAns.update(sdt, anchorCamera)
    sillage.update(sdt, anchorCamera)
    sparks.update(sdt); glint.update(dt); seam.update(dt); ripple.update(dt)
    // 4. pose
    stepHero(sdt, dt)
    applyPose()
    // 5. événements de la surface
    stepEvents()
    // 6. flacon, lumières, aura, interface
    ctx.camera = anchorCamera; ctx.gardenRoot = gardenRoot
    perfume.update(sdt, ctx)
    stepLights(dt)
    const hp = perfume.root.position
    aura.update(dt, hp, pose.scale, anchorCamera)
    ui.update(dt, anchorCamera)
    // 7. minuteries d'inactivité, réponses, maintien
    stepIdle(dt)
  }

  function stepHero(sdt, dt) {
    modeT += sdt
    const sw = PB_CFG.swingDur, lf = PB_CFG.liftDur
    if (heroMode === 'lying' || heroMode === 'rest') {
      pose.garden = true; pose.phi = PHI0; pose.yaw = 0; pose.lean = 0; pose.scale = PB_CFG.heroInGarden
      if (heroMode === 'rest') pose.B.set(B0.x, B0.y + 0.01 * (1 - smooth(modeT / 0.4)), B0.z); else pose.B.copy(B0)
      return
    }
    if (heroMode === 'swing' || heroMode === 'lift') {
      emT += sdt
      pose.garden = true; pose.yaw = 0; pose.lean = 0; pose.scale = PB_CFG.heroInGarden; pose.bob = 0
      if (emT < sw) { // le battant pivote dans le plan de la face (φ −90° → +3°)
        const u = emT / sw
        pose.phi = PHI0 + (-PHI0 + 3 * DEG) * easeInOutSine(u)
        pose.B.lerpVectors(B0, B1, easeInOutCubic(u))
      } else { // retour de l'excès (3°, posé à +0,25 s) ; LEVÉE : B.y −0,02 → 0,14 (easeOutBack, +1,5 cm), B.x → 0
        heroMode = 'lift'
        const l = (emT - sw) / lf
        pose.phi = 3 * DEG * (1 - smooth((emT - sw) / 0.25))
        pose.B.set(lerp(B1.x, E.x, smooth(l)), lerp(B1.y, HOVER_Y, easeOutBack(l)), E.z)
        if (l >= 1) { heroMode = 'hover'; hoverT0 = clock; pose.phi = 0; pose.B.set(E.x, HOVER_Y, E.z); hoverReached() }
      }
      // la lueur suit le flacon jusqu'à la rupture
      if (!ev.edge) {
        centreGarden(tmp)
        glowFollow.at[0] = tmp.x; glowFollow.at[2] = E.z; glowFollow.y = tmp.y; glowFollow.phi = pose.phi / DEG
        fx.glow.set(null, glowFollow)
      }
      return
    }
    if (heroMode === 'hover') { // trône : de face, flottement ±1 cm / 5 s (aucune rotation)
      const t = clock - hoverT0
      pose.garden = true; pose.phi = 0; pose.lean = 0; pose.scale = PB_CFG.heroInGarden
      pose.B.set(E.x, HOVER_Y, E.z)
      pose.bob = 0.01 * Math.sin((TAU * t) / 5)
      pose.yaw = 0
      return
    }
    if (heroMode === 'ff') { // avance rapide : fondu de pose vers le vol stationnaire en 0,6 s
      ff.t += dt
      const k = smoother(ff.t / 0.6)
      pose.garden = true; pose.lean = 0; pose.scale = PB_CFG.heroInGarden; pose.bob = 0
      pose.B.set(lerp(ff.B.x, E.x, k), lerp(ff.B.y, HOVER_Y, k), lerp(ff.B.z, E.z, k))
      pose.phi = lerp(ff.phi, 0, k); pose.yaw = lerp(ff.yaw, 0, k)
      if (ff.t >= 0.6) {
        perfume.dripPointsGarden(base8)
        for (let i = 0; i < 6; i++) fx.drops.spawn(base8[i % 4], tmp2.set((Math.random() - 0.5) * 0.06, -0.02, (Math.random() - 0.5) * 0.06), 0.003 + Math.random() * 0.002)
        hoverT0 = clock
        startExit()
      }
      return
    }
    if (heroMode === 'glide') { // plongeon (0,25 s), glissé au ras de l'eau jusqu'à z −1,90 (1,05 s)
      const t = modeT
      pose.garden = true; pose.phi = 0; pose.bob = 0
      if (t < 0.25) {
        const k = smooth(t / 0.25)
        pose.B.set(lerp(exitFrom.x, E.x, k), lerp(exitFrom.y, 0.03, k), E.z)
        pose.yaw = lerp(yawStart, 0, k); pose.lean = 0; pose.scale = PB_CFG.heroInGarden
      } else {
        const u = (t - 0.25) / PB_CFG.glide.dur
        pose.B.set(E.x, lerp(0.03, PB_CFG.glide.y, smooth(u / 0.4)), lerp(E.z, PB_CFG.glide.zEnd, easeInOutSine(u)))
        pose.yaw = 0
        pose.lean = 0 // toujours droit (demande client)
        pose.scale = lerp(PB_CFG.heroInGarden, 0.23, smooth(u))
        // procession des koï, souffle sous la base
        if (Math.floor(t / 0.6) !== Math.floor((t - sdt) / 0.6)) koiGo(tmp.set(0, 0, pose.B.z - 0.45), 2.5)
        if (Math.floor(t / 0.2) !== Math.floor((t - sdt) / 0.2)) fx.rings.add(pose.B.x, pose.B.z, 0.35, RING_SMALL)
        if (u >= 1) {
          heroMode = 'flight'; modeT = 0
          gardenToMarker(meta, E.x, PB_CFG.glide.y, PB_CFG.glide.zEnd, P[0])
          gardenToMarker(meta, 0, 0.35, -1.20, P[1])
          P[2].set(D.seamX, doorMidY - 0.06, -0.40)
          P[3].copy(outPos)
          yawStart = 0; scaleStart = pose.scale
        }
      }
      return
    }
    if (heroMode === 'flight') { // l'arc : Bézier (marqueur), 0,23 → 0,40, toujours de face (aucune vrille)
      const dur = PB_CFG.bringOutDur - 0.25 - PB_CFG.glide.dur
      const u = clamp01(modeT / dur)
      pose.garden = false
      bezier(pose.M, P[0], P[1], P[2], P[3], easeInOutCubic(u))
      pose.scale = lerp(scaleStart, PB_CFG.heroOut, smoother((u - 0.1) / 0.9))
      pose.yaw = 0
      pose.lean = 0
      pose.phi = 0
      if (!crossed && pose.M.z > -0.01) {
        crossed = true
        ripple.fire(); vibrate(14)
        if (!reduced) { slowTarget = 0.28; slowT = 0.28 }
        sparks.emit({ at: tmp.set(pose.M.x, pose.M.y + pose.scale * 0.5, 0.01), count: 70, dir: V_OUT, spread: 1.1, speed: [0.08, 0.32], life: [0.8, 1.6], gravity: -0.05, drag: 1.2, jitter: 0.04 })
        perfume.setOutside(1, 0.5); perfume.setGardenMix(0.35); perfume.setClip(false); perfume.setGlow(0, 0.6)
      }
      if (u >= 1) {
        pose.yaw = 0
        heroMode = 'showcase'; modeT = 0
        show.yawB = 0; show.yawUser = 0; show.spinVel = 0; show.bounceT = 0; show.quietT = 9; show.user = -1; asideRest(0)
        perfume.impulse(tmp.set(0.12, -0.5, -0.3))                                                    // l'anneau balance, le jus ballotte
        atB(0.3, () => {                                                                              // 2.90 vitrine
          aura.set(1); ui.show(); vibrate(10)
          lastTouch = clock
          setState('showcase')
        })
      }
      return
    }
    if (heroMode === 'showcase' || heroMode === 'aside') {
      pose.garden = false
      // aparté : le flacon s'efface (à droite, un peu plus petit) pendant que le jardin répond, tant que la réponse le
      // demande (hold, tenu par ses propres événements). Il ne part qu'après un temps immobile (≥ 0,4 s) une fois le geste
      // posé — la frappe compte jusqu'à 0,75 s après l'impact — et un geste en cours ne le déclenche pas (l'élévation,
      // la frappe et l'agitation se jouent au centre) ; s'il est déjà engagé, il se poursuit. Le trajet est un profil
      // quintique (≈ 1,15 s) : vitesse et accélération nulles au départ comme à l'arrivée, continues si l'on change d'avis.
      const gesture = cedar.t >= 0 || shake.t >= 0 || (knockFx.t >= 0 && (knockFx.rec < 0 || knockFx.rec < 0.75))
      show.quietT = gesture ? 0 : show.quietT + dt
      // le choix du visiteur (toucher du flacon) l'emporte sur l'aparté automatique des réponses ; la vaporisation se
      // joue toujours au centre
      let want = spr.busy ? 0 : show.user >= 0 ? show.user : bT < ans.hold[0] || bT < ans.hold[1] ? 1 : 0
      if (want && show.asideK < 0.5 && (gesture || show.quietT < 0.4)) want = 0
      if (want !== asideMv.to) asideRetarget(want)
      asideStep(dt)
      heroMode = show.asideK > 0.5 ? 'aside' : 'showcase'
      const A = PB_CFG.aside, ak = clamp(show.asideK, -0.05, 1.05)
      const bob = Math.sin(clock * 1.25) * 0.0045 + Math.sin(clock * 2.3) * 0.0015
      let bounce = 0
      if (show.bounceT >= 0) { show.bounceT += dt; bounce = -0.008 * Math.sin(Math.min(1, show.bounceT / 0.3) * Math.PI); if (show.bounceT > 0.3) show.bounceT = -1 }
      pose.scale = lerp(PB_CFG.heroOut, A.scale, ak)
      const S = pose.scale

      // ---- FLEUR : pendule entraîné par la main qui tient le haut du flacon --------------------------------
      // θ'' = −ω0²·k·sin θ − c·θ' − (a_x / L)·cos θ − (a_y / L)·sin θ ; la base suit (main + h·sin θ, h·(1 − cos θ))
      let swing = 0, hx = 0, hy = 0
      const hP = S * 0.92
      if (shake.t >= 0) {
        const SUB = 4, h = dt / SUB, L = S * 0.47, W0 = 8.6
        for (let k = 0; k < SUB; k++) {
          shake.t += h
          const t = shake.t
          // main : images clés en quintique (vitesse et accélération nulles à chaque retournement : aucun bruit)
          let X = 0
          if (t < SHK_T[6]) {
            let j = 0
            while (j < 5 && t >= SHK_T[j + 1]) j++
            X = lerp(SHK_X[j], SHK_X[j + 1], smoother((t - SHK_T[j]) / (SHK_T[j + 1] - SHK_T[j])))
          }
          const pick = 0.014 * smoother(t / 0.32) * (1 - smoother((t - 1.8) / 0.85))      // prise : il se soulève à peine
          const dip = -0.026 * smooth((t - 0.32) / 0.4) * (1 - smooth((t - 1.25) / 0.6))   // le haut descend un peu en agitant
          const arc = 1.6 * X * X                                                            // arc du poignet
          shake.hx = S * X; shake.hy = S * (pick + dip + arc)
          const vx = (shake.hx - shake.hxPrev) / h, ax = (vx - shake.vxPrev) / h
          const vy = (shake.hy - shake.hyPrev) / h, ay = (vy - shake.vyPrev) / h
          shake.hxPrev = shake.hx; shake.vxPrev = vx; shake.hyPrev = shake.hy; shake.vyPrev = vy
          // amortissement : libre pendant l'agitation, l'air freine ensuite, la main capte le flacon à la fin
          const cap = smooth((t - 2.05) / 0.5)
          const C = 0.85 + 1.5 * smooth((t - 1.55) / 0.6) + 6.5 * cap
          const Kc = 1 + 1.4 * cap
          shake.om += (-W0 * W0 * Kc * Math.sin(shake.th) - C * shake.om - (ax / L) * Math.cos(shake.th) - (ay / L) * Math.sin(shake.th)) * h
          shake.th += shake.om * h
        }
        const t = shake.t
        // paillettes secouées : au retournement des plus grands balancements, du côté où le pied s'arrête
        if (shake.omPrev * shake.om < 0 && Math.abs(shake.th) > 4.2 * DEG && t > 0.35 && t < 2.0 && shake.sparkN < 4) {
          shake.sparkN++
          const sd = shake.th > 0 ? 1 : -1, c = Math.cos(shake.th), s = Math.sin(shake.th)
          const lx = sd * 0.27 * Math.cos(show.yawUser), lz = -sd * 0.27 * Math.sin(show.yawUser), ly = 0.12
          SPK_SHAKE.at.set(pose.M.x + S * (lx * c - ly * s), pose.M.y + S * (lx * s + ly * c), pose.M.z + S * lz + 0.01)
          SPK_SHAKE.dir.set(sd * c, 0.3 + sd * s, 0.35).normalize()
          SPK_SHAKE.count = shake.sparkN <= 2 ? 10 : 6
          sparks.emit(SPK_SHAKE)
          perfume.studGlint(sd > 0 ? 14 : 1); perfume.studGlint(sd > 0 ? 12 : 3)
          vibrate(6)
        }
        shake.omPrev = shake.om
        const fade = 1 - smooth((t - (shake.dur - 0.22)) / 0.22) // ultime fondu (θ < 0,1° à ce stade) : vertical exact
        swing = shake.th * fade
        hx = shake.hx * fade
        hy = shake.hy * fade
        if (t >= shake.dur) { shake.t = -1; shake.th = 0; shake.om = 0; swing = 0; hx = 0; hy = 0 }
      }
      const swx = hx + hP * Math.sin(swing), swy = hy + hP * (1 - Math.cos(swing))

      // ---- ÉCLOSION : le flacon se hisse d'un souffle pendant que l'anneau monte, recule à la frappe et revient
      // (réponse impulsionnelle d'un ressort amorti : ≈ 2,2 Hz, ζ 0,35 — le verre encaisse, sans rebond de caoutchouc)
      let kx = 0, ky = 0, kz = 0
      if (knockFx.t >= 0) {
        knockFx.t += dt
        const breathIn = 0.0045 * S * smooth(knockFx.t / 0.5)
        let r = 0, rel = 0
        if (knockFx.rec >= 0) {
          knockFx.rec += dt
          const tr = knockFx.rec, wn = TAU * 2.2, zt = 0.35, wd = wn * Math.sqrt(1 - zt * zt)
          r = Math.exp(-zt * wn * tr) * Math.sin(wd * tr) / 0.594
          rel = smooth(tr / 0.32)
          if (tr > 1.4) { knockFx.t = -1; knockFx.rec = -1; r = 0; rel = 1 }
        } else if (knockFx.t > 1.5) { knockFx.t = -1 } // frappe perdue (état quitté) : on relâche
        const back = 0.013 * S * r
        ky = breathIn * (1 - rel) - 0.005 * S * r
        kx = -Math.sin(show.yawUser) * back; kz = -Math.cos(show.yawUser) * back
      }

      // ---- CÈDRE : élévation en apesanteur (ressort sur une consigne lissée : léger dépassement à l'arrivée),
      // respiration à deux fréquences, dérive latérale infime ; descente au clic, pose moelleuse (petit enfoncement)
      let lift = 0, cx = 0
      if (cedar.t >= 0) {
        cedar.t += dt
        const t = cedar.t
        const up = smoother((t - 0.1) / 0.85), down = smoother((t - cedar.down) / 0.6)
        const br = smooth((t - 0.9) / 0.7) * (1 - down)
        const breathe = (0.0026 * Math.sin(TAU * 0.5 * (t - 0.9)) + 0.0008 * Math.sin(TAU * 1.15 * (t - 0.9))) * br
        const pre = -0.004 * Math.sin(Math.PI * clamp01(t / 0.28)) // il se ramasse avant de s'élever
        const target = CED.lift * up * (1 - down) + breathe + pre
        const w = t < cedar.down ? 8.0 : 8.8, z = t < cedar.down ? 0.62 : 0.5
        const SUB = 2, h = dt / SUB
        for (let k = 0; k < SUB; k++) {
          cedar.v += (w * w * (target - cedar.y) - 2 * z * w * cedar.v) * h
          cedar.y += cedar.v * h
        }
        // fin : le reste infime du ressort est fondu en 0,4 s (jamais remis à zéro d'un coup)
        if (t >= cedar.dur && cedar.endT < 0 && (Math.abs(cedar.y) < 6e-4 || t > cedar.dur + 1.2)) cedar.endT = t
        const tail = cedar.endT >= 0 ? 1 - smoother((t - cedar.endT) / 0.4) : 1
        lift = cedar.y * tail
        cx = 0.0016 * Math.sin(TAU * 0.33 * t) * up * (1 - down)
        if (cedar.endT >= 0 && t - cedar.endT >= 0.4) { cedar.t = -1; cedar.y = 0; cedar.v = 0; cedar.endT = -1; lift = 0 }
      }
      pose.M.set(outPos.x + A.dx * ak + swx + kx + cx, outPos.y + A.dy * ak + bob + bounce + swy + ky + lift, outPos.z + kz)
      // ruban d'ambre (lib/majorelle/cedarRibbon.js) : suit le flacon, paillettes semées à sa tête
      if (cedarRibbon && cedarRibbon.active) {
        cedarRibbon.update(dt, pose.M, pose.scale, clock)
        if (cedarRibbon.active) { cedarRibbon.head(SPK_RIBBON.at); sparks.emit(SPK_RIBBON) }
      }
      // lacet : uniquement le geste du visiteur (avec inertie). Aucune animation ne tourne le flacon :
      // il est de face par défaut et reste où le visiteur l'a laissé (demande client).
      if (!drag || !drag.spin) {
        show.yawUser += show.spinVel * dt
        show.spinVel *= Math.max(0, 1 - dt * 2.4)
      }
      pose.yaw = show.yawUser
      pose.lean = 0; pose.phi = swing
      return
    }
    if (heroMode === 'return') { // range : capuchon fermé, de face, vol retour, survol, descente
      const t = modeT
      if (t < 0.4) {
        pose.garden = false
        pose.yaw = lerp(yawStart, 0, smooth(t / 0.4))
        return
      }
      const fd = PB_CFG.returnFlightDur
      if (t < 0.4 + fd) {
        const u = (t - 0.4) / fd
        pose.garden = false
        bezier(pose.M, P[0], P[1], P[2], P[3], easeInOutCubic(u))
        pose.scale = lerp(scaleStart, PB_CFG.heroInGarden, smoother(u * 1.1))
        pose.yaw = 0
        pose.phi = 0
        if (!crossed && pose.M.z < -0.01) {
          crossed = true
          ripple.fire(); vibrate(10)
          perfume.setOutside(0, 0.5); perfume.setGardenMix(1); perfume.setClip(true); perfume.setGlow(0.25, 0.8)
        }
        markerToGarden(meta, pose.M, gp)
        if (skims < 3 && gp.z < -1.9 - skims * 0.3 && Math.abs(gp.x) < 0.7) { fx.rings.add(gp.x, gp.z, 0.5); skims++ } // rides du survol
        return
      }
      // survol (2,7 → 3,0), descente B.y 0,14 → −0,02 (3,0 → 3,5)
      pose.garden = true; pose.yaw = 0; pose.lean = 0; pose.phi = 0; pose.scale = PB_CFG.heroInGarden; pose.bob = 0
      const d = (t - 3.0) / 0.5
      pose.B.set(E.x, lerp(HOVER_Y, B1.y, smooth(d)), E.z)
      if (t >= 3.5) { heroMode = 'sink'; modeT = 0 }
      return
    }
    if (heroMode === 'sink') { // battant inversé : φ 0 → −90° (1,8 s), B → B₀ (+1 cm, puis se pose)
      const u = modeT / PB_CFG.swingDur
      pose.garden = true; pose.yaw = 0; pose.lean = 0; pose.scale = PB_CFG.heroInGarden
      pose.phi = PHI0 * easeInOutSine(u)
      tmp.set(E.x, B1.y, E.z)
      tmp2.copy(B0); tmp2.y += 0.01
      pose.B.lerpVectors(tmp, tmp2, easeInOutCubic(u))
      if (u >= 1) { heroMode = 'rest'; modeT = 0 }
    }
  }

  function hoverReached() { // 6.10 : vol stationnaire ; la bande satinée se givre du haut vers le bas (6 s), gouttes
    perfume.dry(6)
    fx.drops.pendant(dripFn, 2)
  }

  // événements de l'émergence et du retour : passages de la surface (y = 0 jardin)
  function stepEvents() {
    const intro = heroMode === 'swing' || heroMode === 'lift' || (heroMode === 'hover' && !ev.pinch)
    const back = heroMode === 'return' && modeT >= 2.6 || heroMode === 'sink'
    if (!intro && !back) return
    perfume.extremaGarden(ex)
    if (intro) {
      if (!ev.near && ex.shoulderY > -0.05) { ev.near = true; fx.dome.set(ex.highestX, E.z, 0.25, 0.04, 0.16) }
      if (!ev.edge && ex.highestY > 0) breakSurface()
      if (ev.edge && !ev.cap && ex.capTopY > 0) {
        ev.cap = true
        for (let i = 0; i < 8; i++) fx.drops.spawn(gp.set(ex.capX + (Math.random() - 0.5) * 0.06, 0.01, E.z + 0.03), tmp2.set((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, Math.random() * 0.2), 0.003 + Math.random() * 0.002)
      }
      if (ev.edge && !ev.base) { // les clous brillent en franchissant la surface ; collerette à la ligne d'eau
        refreshToGarden()
        const st = pmeta.studs || []
        for (let i = 0; i < st.length && i < 32; i++) {
          const y = tmp.set(st[i][0], st[i][1], st[i][2]).applyMatrix4(toGarden).y
          if (y > 0 && !studAbove[i]) { studAbove[i] = 1; perfume.studGlint(i) }
        }
        fx.collar.set(perfume.waterSection(0, sec))
      }
      if (ev.edge && !ev.base && ex.baseLowY > 0) {
        ev.base = true; ev.baseT = bT
        fx.collar.hide(0.1); fx.neck.attach(baseFn); perfume.setSheet(false)
      }
      if (ev.base && !ev.pinch && (bT - ev.baseT > 0.25 || fx.neck.length > 0.12)) {
        ev.pinch = true
        fx.neck.pinch()
        fx.splash(gp.copy(E), 0.45, { koi: { point: E, seconds: 9 } })                               // le « plic »
        perfume.dripPointsGarden(base8)
        for (let k = 0; k < 6; k++) atB(k * 0.17, () => fx.drops.spawn(base8[k % 4], tmp2.set(0, -0.04, 0), 0.0028))
      }
    } else {
      if (!ev.baseUnder && ex.baseLowY < 0) {
        ev.baseUnder = true
        fx.splash(gp.copy(E), 0.6)
        perfume.setSheet(true)
      }
      if (ev.baseUnder && !ev.under) fx.collar.set(perfume.waterSection(0, sec))
      if (ev.baseUnder && !ev.capUnder && ex.capTopY < 0) {
        ev.capUnder = true
        perfume.capAnchor(tmp); markerToGarden(meta, tmp, gp)
        for (let k = 0; k < 3; k++) fx.rings.add(gp.x + (k - 1) * 0.08, E.z + 0.02 * k, 0.45)
        fx.bubbles.spawn(gp.x + 0.12, E.z + 0.05, 6)                                                    // du fond du bassin, à côté
        perfume.setWet(1); perfume.setSheet(false)
      }
      if (ev.baseUnder && !ev.under && ex.highestY < 0) { ev.under = true; fx.collar.hide(0.2) }
    }
  }

  function breakSurface() { // LA RUPTURE
    ev.edge = true
    const x = ex.highestX
    if (!reduced) { slowTarget = 0.5; slowT = 0.5 }
    vibrate(14)
    gardenToMarker(meta, x, 0.02, E.z, tmp)
    sparks.emit({ at: tmp, count: 20, dir: V_UP, spread: 0.7, speed: [0.03, 0.11], life: [0.5, 1.1], gravity: -0.06, color: SILVER_SPARK, jitter: 0.02 })
    fx.splash(gp.set(x, 0, E.z), 0.9, { priority: 'high', koi: { point: koiPart, seconds: 3 } })
    fx.dome.hide(0.1)
    fx.crown.fire(x, E.z, 0.12, 0.9)
    fx.glow.set(0, { dur: 0.8 }); fx.glow.beat(0)
    perfume.setGlow(0.25, 0.8)
    perfume.setSheet(true)
    fx.drops.pendant(dripFn, 6)
    introHint = ''; refreshHint()
  }

  function stepLights(dt) {
    const hp = perfume.root.position, Hs = pose.scale
    const outside = heroMode === 'showcase' || heroMode === 'aside' || ((heroMode === 'flight' || heroMode === 'return') && hp.z > -0.3) ? 1 : 0
    const k = Math.min(1, dt * 3)
    if (outside) {
      key.position.copy(hp).add(tmp.set(0.35, 0.9, 0.7)); rim.position.copy(hp).add(tmp.set(-0.2, 0.5, -0.9)); fill.position.copy(hp).add(tmp.set(-0.6, -0.1, 0.5))
    } else {
      key.position.copy(hp).addScaledVector(sunDir, 1); rim.position.copy(hp).add(tmp.set(0.3, 0.6, -0.8)); fill.position.copy(hp).add(tmp.set(0, -0.6, 0.4))
    }
    key.target.position.copy(hp).y += Hs * 0.5; rim.target.position.copy(hp).y += Hs * 0.5; fill.target.position.copy(hp).y += Hs * 0.4
    key.color.lerp(outside ? WHITE : SUN_COL, k); rim.color.lerp(outside ? WARM : SKY_COL, k)
    key.intensity += ((outside ? 2.2 : 3.0) - key.intensity) * k
    rim.intensity += ((outside ? 3.4 : 1.6) - rim.intensity) * k
    fill.intensity += ((outside ? 0.7 : 0.9) - fill.intensity) * k
  }

  let lastChase = 0, lastKoiE = 0
  function stepIdle(dt) {
    // réponses : file d'un cran, chacune ≈ 4 s
    if (ans.cur >= 0 && bT - ans.t0 >= 4.0) { ans.cur = -1; lastTouch = clock }
    if (ans.cur < 0 && ans.queue.length && ans.queue[0].at <= bT && (state === 'showcase' || state === 'finale')) startAnswer(ans.queue.shift().idx)
    // note en attente : part dès que le geste en cours libère le flacon (un souffle de 0,12 s pour que chaque geste se lise)
    const nb = noteBusy()
    if (nb) busyT = clock
    if (pend >= 0) {
      if (state !== 'showcase' || spr.busy || clock - pendT > 8) pend = -1
      else if (!nb && clock - lastKnockT >= PB_CFG.knock.debounce && clock - busyT >= 0.12) { const i = pend; pend = -1; playNote(i) }
    }
    // trône : chasse de reflets + une ride toutes les 3,2 s, koï à E toutes les 8 s
    if (state === 'enthroned') {
      if (clock - lastChase > 3.2) { lastChase = clock; perfume.glintChase(0.8); fx.rings.add(E.x + (Math.random() - 0.5) * 0.2, E.z + (Math.random() - 0.5) * 0.1, 0.3, RING_IDLE) }
      if (clock - lastKoiE > 8) { lastKoiE = clock; koiGo(E, 9) }
    }
    // maintien (VAPORISER ou flacon, après le 3e coup) : anneau dès 0,1 s, nuage jusqu'à 1,4 s
    if (drag && unlocked && state === 'showcase' && !spr.busy && !drag.fired && !drag.spin && drag.moved < 0.03 &&
        drag.mode === 'ui' && drag.ui.id === 'spray') { // maintenir VAPORISER pour un nuage (plus sur le flacon)
      const held = clock - drag.t0
      if (held > 0.1) {
        if (drag.mode === 'bottle') { perfume.centerAnchor(holdOpts.at); holdOpts.radius = pose.scale * 0.42; ui.setHold(clamp01((held - 0.1) / 1.3), holdOpts) }
        else ui.setHold(clamp01((held - 0.1) / 1.3))
      }
      if (held >= 1.4) { drag.fired = true; ui.setHold(null); spray(1.4) }
    }
    // vitrine : anneau fantôme sur le prochain bouton (6 s), note jouée d'office (10 s), vaporisation auto (12 s)
    if (state === 'showcase' && !spr.busy && !drag) {
      const idle = clock - lastTouch
      const busy = noteBusy() || ans.cur >= 0
      if (!unlocked && !busy) {
        if (idle > PB_CFG.idle.ghostAfter) {
          if (typeof ui.bezelAnchor === 'function') { ui.bezelAnchor(nextUndone(), tmp); ui.ghost(true, tmp, 0.034) }
          else { perfume.strikeAnchor(tmp); ui.ghost(true, tmp, pose.scale * 0.13) }
          ghostOn = true
        }
        if (idle > PB_CFG.idle.autoKnockAfter) playNote(nextUndone())
      } else if (ghostOn) { ghostOn = false; ui.ghost(false) }
      if (unlocked && !signed && !busy && idle > PB_CFG.idle.autoSprayAfter) spray(0.6)
    } else if (ghostOn) { ghostOn = false; ui.ghost(false) }
    // porte qui se referme : la fente se rallume ; carton de fin : la fente respire (0,7 Hz)
    if (doorClosing && doorAction.time < 0.3) seam.set(0.6)
    if (state === 'closed') seam.set(0.55 + 0.15 * Math.sin(TAU * 0.7 * clock))
  }

  // ---- API publique ------------------------------------------------------------------------------------
  return {
    anchor,
    ready,
    update,
    setCamera: (c) => { anchorCamera = c },
    pointerDown, pointerMove, pointerUp, pointerCancel,
    tapAt,
    bringOut,
    knock: () => knock(),
    playNote: (i) => playNote(i),
    spray: (hold = 0.6) => spray(hold),
    returnProduct,
    replay: playIntro,
    playIntro,
    fastForward: () => fastForward(),
    setQuality,
    getState: () => state,
    hasPlayedIntro: () => state !== 'ready' && state !== 'loading',
    _debug: () => ({
      perfume, fx, notes, sillage, ui, water, state, heroMode, meta, pmeta, emT, wT, bT, knocks, unlocked, signed, cedar: cedarAns, lotusClear: () => lotusClearIfCentred(),
      answer: ans.cur, queue: ans.queue.length, pending: pend, hold: ans.hold.slice(), autoAside: ans.aside.slice(), viewClear: ans.viewClear, asideK: show.asideK, asideTo: asideMv.to, asideUser: show.user, slowMo, tier, pose, ev: { ...ev }, doorTime: doorAction?.time, sprayBusy: spr.busy,
    }),
  }
}
