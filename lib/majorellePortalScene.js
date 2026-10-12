// Portail YSL — « Jardin Majorelle ».
// La porte bleu Majorelle scannée s'entrouvre sur une cour marocaine ensoleillée (bakée dans Blender) :
// bassin long aux koï, fontaine en marbre. Le rouge à lèvres naît du jet de la vasque, flotte sur l'eau,
// puis, au toucher, survole le bassin (les koï accourent sous son passage), franchit la porte et vient
// à vous ; l'interface AR spatiale (teintes, ouvrir, ranger) est celle du Salon Secret.
//
// Entrée unique : buildMajorelleScene(renderer, scene, { onStatus, onState, markerPreview })
// Repère = « unités marqueur » : origine au centre de l'image de la porte, largeur de l'image = 1,
// +Z vers le spectateur, la cour part vers -Z (cf. lib/majorelle/interior.js pour le repère jardin).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createDoorGlint, createSeamLight, createPortalRipple, createSparks, createHeroAura } from '@/lib/ysl/effects'
import { createHero, SHADES } from '@/lib/ysl/hero'
import { createSpatialUI } from '@/lib/ysl/spatialUI'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'
import { pickMajorelleInterior, applyMajorelleMaterials, gardenToMarker, markerToGarden } from '@/lib/majorelle/interior'

export { SHADES }

export const MJ_CFG = {
  base: '/majorelle',
  doorUrl: '/majorelle/mj_door.glb',
  lipstickUrl: '/lovenude.glb',
  hdrUrl: '/hdr/photo_studio_01_1k.hdr',
  markerUrl: '/majorelle/marker_door_2k.png',
  markerAspect: 2400 / 1792,                          // hauteur / largeur de l'image scannée
  targetName: 'majorelle',
  targetDataUrl: '/image-targets/majorelle.json',
  // porte dans l'image (analysis/door_outline.json) : fente, seuil, sommet de l'arc, demi-largeur
  door: { seamX: 904 / 1792 - 0.5, y0: (1200 - 2154) / 1792, y1: (1200 - 755) / 1792, halfW: 0.1794 },
  nozzle: [0, 1.16, -7.55],                           // buse du jet (repère jardin, m) = naissance du produit
  hoverM: 0.2,                                        // le produit flotte 20 cm au-dessus de la buse, porté par le jet
  heroInGarden: 0.27,                                 // hauteur dans la cour (≈ 0,9 m : sculpture monumentale portée par le jet,
                                                      // même taille apparente que dans le Salon Secret malgré la profondeur)
  heroOut: 0.43,                                      // hauteur une fois sorti (≈ 55 % de la porte)
  flightDur: 2.8,
  returnDur: 2.3,
  sunDir: [-0.52, 0.76, 0.38],                        // vers le soleil (repère jardin), cf. build_majorelle.SUN_DIR
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10) }
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeOutBack = (x) => { const c = 1.4; x = clamp01(x) - 1; return 1 + (c + 1) * x * x * x + c * x * x }
const bezier = (out, p0, p1, p2, p3, t) => {
  const u = 1 - t
  return out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t)
}
const vibrate = (ms) => { try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; navigator.vibrate?.(ms) } catch {} }

// ---- pose 8th Wall → unités marqueur ---------------------------------------------
// majorelle.json : image 1792×2400 déjà en portrait 3:4, non recadrée, non tournée.
// 8th Wall donne la largeur de la cible via scaledWidth (× scale) : largeur 1 = image entière.
const _Z = new THREE.Vector3(0, 0, 1)
const _q = new THREE.Quaternion()
export function applyMajorellePose(anchor, detail, fit = 1, rotDeg = null) {
  const sw = detail.scaledWidth || 1, sh = detail.scaledHeight || MJ_CFG.markerAspect
  const sideways = sw > sh // cible rapportée couchée : on remet le contenu debout
  anchor.position.copy(detail.position)
  anchor.quaternion.copy(detail.rotation)
  const deg = rotDeg ?? (sideways ? -90 : 0)
  if (deg) anchor.quaternion.multiply(_q.setFromAxisAngle(_Z, THREE.MathUtils.degToRad(deg)))
  anchor.scale.setScalar(detail.scale * (sideways ? sh : sw) * fit)
}

const HINTS = {
  loading: 'Chargement…',
  ready: '',
  intro: '',
  enthroned: 'Touchez le rouge à lèvres',
  exiting: '',
  showcase: 'Choisissez une teinte · glissez pour tourner',
  open: 'Glissez vers le bas pour refermer',
  returning: '',
}

export function buildMajorelleScene(renderer, scene, { onStatus, onState, markerPreview = false } = {}) {
  const status = (s) => onStatus && onStatus(s)

  // produit et interface sous Neutral (teintes validées dans le Salon Secret) ; la cour applique AgX
  // elle-même (cf. lib/majorelle/interior.js), comme la vue de Blender où elle est bakée
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  const envReady = new Promise((res) => {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const done = () => { pmrem.dispose(); res() }
    new RGBELoader().load(MJ_CFG.hdrUrl, (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      hdr.dispose(); done()
    }, undefined, (e) => { console.warn('[majorelle] hdr', e); done() })
  })

  const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor)
  anchor.add(new THREE.AmbientLight(0xffffff, 0.18))
  // lumières du produit : soleil chaud dans la cour, studio neutre une fois sorti (l'argent reste argent)
  const key = new THREE.DirectionalLight(0xffffff, 0), rim = new THREE.DirectionalLight(0xffffff, 0), fill = new THREE.DirectionalLight(0xf6f8ff, 0)
  ;[key, rim, fill].forEach((l) => anchor.add(l, l.target))
  const SUN_COL = new THREE.Color(0xfff0d8), SKY_COL = new THREE.Color(0xcfe0ff), WHITE = new THREE.Color(0xffffff), WARM = new THREE.Color(0xffeedd)
  const sunDir = new THREE.Vector3(...MJ_CFG.sunDir).normalize()

  if (markerPreview) {
    const tex = new THREE.TextureLoader().load(MJ_CFG.markerUrl); tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, MJ_CFG.markerAspect), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, toneMapped: false }))
    plane.renderOrder = -2; anchor.add(plane)
  }

  // ---- état ------------------------------------------------------------------------
  let state = 'loading'
  let meta, mixer, doorAction, doorClip, water, glint, seam, ripple, sparks, aura, hero, ui
  const D = MJ_CFG.door
  const doorMidY = (D.y0 + D.y1) / 2
  const nozzle = new THREE.Vector3(), hover = new THREE.Vector3()
  const outPos = new THREE.Vector3(D.seamX, doorMidY + 0.02 - MJ_CFG.heroOut / 2, 0.22)
  const setState = (s) => {
    state = s
    const hint = s === 'showcase' && hero?.isOpen() ? HINTS.open : HINTS[s]
    status(hint ?? '')
    onState && onState(s, { shade: hero ? SHADES[hero.shade] : SHADES[0], open: !!hero?.isOpen() })
  }

  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))

  const ready = Promise.all([
    pickMajorelleInterior(MJ_CFG.base).then(async (pick) => {
      if (!pick) throw new Error('cour bakée introuvable (interior.json)')
      return { meta: pick.meta, gltf: await load(pick.glbUrl) }
    }),
    load(MJ_CFG.doorUrl), load(MJ_CFG.lipstickUrl),
    loadReflectionProbes(`${MJ_CFG.base}/fx/`).catch(() => null),
    envReady,
  ]).then(([gi, gd, gl, probes]) => {
    meta = gi.meta
    const interior = gi.gltf.scene, door = gd.scene
    applyMajorelleMaterials(interior, meta, MJ_CFG.base)
    door.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
    anchor.add(interior, door)

    // eau vivante dans le repère jardin (mètres)
    const gardenRoot = new THREE.Group()
    gardenRoot.position.set(meta.X_OFF, meta.Z_OFF, 0)
    gardenRoot.scale.setScalar(meta.K)
    anchor.add(gardenRoot)
    // éclairage publié par le bake (golden hour), sinon valeurs d'origine
    if (Array.isArray(meta.sun?.dir)) sunDir.set(...meta.sun.dir).normalize()
    if (meta.heroLight?.sun) SUN_COL.set(meta.heroLight.sun)
    if (meta.heroLight?.sky) SKY_COL.set(meta.heroLight.sky)
    water = createGardenFX({
      parent: gardenRoot, sunDir: sunDir.clone(), reflectionCube: probes, energy: 0,
      ...(meta.sun?.color ? { sunColor: meta.sun.color } : {}), ...(meta.sky ? { sky: meta.sky } : {}),
    })

    glint = createDoorGlint(door)
    seam = createSeamLight(anchor, { x: D.seamX, y0: D.y0, y1: D.y1 - 0.02, z: 0.004, halfW: D.halfW })
    const rippleRoot = new THREE.Group(); rippleRoot.position.set(D.seamX, doorMidY, 0); anchor.add(rippleRoot)
    ripple = createPortalRipple(rippleRoot, { sx: D.halfW * 1.25, sy: (D.y1 - D.y0) * 0.55 })
    sparks = createSparks(anchor)
    aura = createHeroAura(anchor)

    mixer = new THREE.AnimationMixer(door)
    doorClip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
    doorAction = mixer.clipAction(doorClip); doorAction.setLoop(THREE.LoopOnce, 1); doorAction.clampWhenFinished = true

    gardenToMarker(meta, ...MJ_CFG.nozzle, nozzle)
    hover.copy(nozzle); hover.y += MJ_CFG.hoverM * meta.K

    hero = createHero(gl)
    anchor.add(hero.root)
    ui = createSpatialUI(anchor, { center: new THREE.Vector3(D.seamX, outPos.y + MJ_CFG.heroOut / 2, outPos.z) })
    resetToClosed()
    prewarm()
    setState('ready')
  }).catch((err) => { console.error('[majorelle]', (err && err.stack) || err); status('Erreur de chargement') })

  function prewarm() {
    const cam = anchorCamera
    if (!cam) return
    const vis = [anchor.visible, ui.group.visible, aura.group.visible]
    anchor.visible = ui.group.visible = aura.group.visible = true
    try {
      anchor.traverse((o) => { const m = o.material; if (m?.map) renderer.initTexture(m.map); if (m?.lightMap) renderer.initTexture(m.lightMap) })
      renderer.compile(scene, cam)
    } catch (e) { console.warn('[majorelle] prewarm', e) }
    ;[anchor.visible, ui.group.visible, aura.group.visible] = vis
  }

  // ---- séquenceur ------------------------------------------------------------------
  let seq = [], seqT = 0
  const run = (steps) => { seq = steps.map((s) => ({ ...s, done: false })); seqT = 0 }
  const after = (t, fn) => seq.push({ t: seqT + t, fn, done: false })

  // ---- produit -----------------------------------------------------------------------
  let heroMode = 'hidden' // hidden | rise | throne | flight | showcase
  let flight = null, rise = null
  let spinVel = 0, idleSpin = 0.35, lastTouch = -10
  let clock = 0, slowMo = 1, slowMoT = 0
  let crossed = false, skimmed = 0
  let jolt = -1
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), gp = new THREE.Vector3()
  const SUN_DUST = new THREE.Color(1, 0.93, 0.78)
  const splashAt = (gx, gy, gz, k) => water && water.splash(gp.set(gx, gy, gz), k)
  const splashBasin = (k) => splashAt(0.0, 0.42, MJ_CFG.nozzle[2] + 0.55, k)

  function resetToClosed() {
    seq = []
    doorAction.reset(); doorAction.play(); doorAction.paused = true; doorAction.time = 0; mixer.update(0)
    water.setEnergy(0)
    hero.hideInstant(); hero.setOpen(false); hero.setShade(hero.shade, false)
    hero.root.position.copy(nozzle); hero.root.scale.setScalar(MJ_CFG.heroInGarden * 0.5); hero.root.rotation.set(0, 0, 0)
    heroMode = 'hidden'; flight = null; rise = null
    slowMo = 1; slowMoT = 0; crossed = false; skimmed = 0; drag = null; spinVel = 0; jolt = -1
    ui.hide(); aura.set(0); seam.set(0.6)
    key.intensity = rim.intensity = fill.intensity = 0
  }

  function playIntro() {
    if (!hero) return
    resetToClosed()
    setState('intro')
    run([
      { t: 0.1, fn: () => glint.sweep(1.5, 2.2) },
      { t: 0.3, fn: () => seam.set(1) },                                                     // le soleil filtre par la fente
      { t: 1.45, fn: () => { seam.flash(); vibrate(12); jolt = 0; sparks.emit({ at: tmp.set(D.seamX, doorMidY, 0.01), count: 22, dir: new THREE.Vector3(0, 0, 1), spread: 0.9, speed: [0.03, 0.12], life: [0.6, 1.2], gravity: -0.02, jitter: 0.25, color: SUN_DUST }) } },
      { t: 1.7, fn: () => {
        jolt = -1
        doorAction.paused = false; doorAction.timeScale = 0.75; doorAction.play()
        seam.set(0)
        for (let i = 0; i < 4; i++) sparks.emit({ at: tmp.set(D.seamX, D.y0 + 0.08 + i * 0.16, 0.0), count: 18, dir: new THREE.Vector3(0, 0.15, 1), spread: 0.8, speed: [0.04, 0.18], life: [1.4, 2.6], gravity: -0.01, drag: 0.9, jitter: 0.05, color: SUN_DUST })
      } },
      { t: 2.3, fn: () => water.setEnergy(0.3) },                                            // la fontaine s'éveille
      { t: 3.1, fn: () => { water.setEnergy(1); splashBasin(0.7); vibrate(8) } },            // le jet jaillit…
      { t: 3.35, fn: () => {                                                                  // …et porte le produit
        heroMode = 'rise'; rise = { t: 0, dur: 1.7 }
        hero.reveal(1.6)
        sparks.emit({ at: tmp.copy(nozzle), count: 26, dir: new THREE.Vector3(0, 1, 0), spread: 0.5, speed: [0.03, 0.1], life: [0.8, 1.6], gravity: -0.03, jitter: 0.02, color: SUN_DUST })
      } },
      { t: 5.2, fn: () => { water.setEnergy(0.75); sparks.emit({ at: tmp.copy(hover).add(tmp2.set(0, MJ_CFG.heroInGarden * 0.6, 0)), count: 24, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.02, 0.06], life: [1, 2], gravity: 0.01, drag: 0.8, jitter: 0.05 }) } },
      { t: 5.6, fn: () => setState('enthroned') },
    ])
  }

  function bringOut() {
    if (!hero || (state !== 'enthroned' && state !== 'intro')) return
    if (state === 'intro') {
      seq = []
      jolt = -1
      if (doorAction.time < doorClip.duration) { doorAction.paused = false; doorAction.play() }
      doorAction.timeScale = 3
      seam.set(0)
      water.setEnergy(0.75)
      if (heroMode === 'hidden') hero.reveal(0.3)
      if (heroMode !== 'throne') { heroMode = 'throne'; rise = null; hero.root.position.copy(hover); hero.root.scale.setScalar(MJ_CFG.heroInGarden) }
    }
    setState('exiting')
    vibrate(10)
    aura.set(0)
    splashAt(0, 1.14, MJ_CFG.nozzle[2], 0.6) // le jet relâche le produit
    water.setEnergy(0.45)
    P[0].copy(hero.root.position)
    P[1].set(hover.x, hover.y + 0.22, hover.z + 0.7)       // s'élève au-dessus du bassin long…
    P[2].set(D.seamX, doorMidY - 0.06, -0.45)              // …redescend vers l'arc
    P[3].copy(outPos)
    flight = { t: -0.22, dur: MJ_CFG.flightDur, s0: MJ_CFG.heroInGarden, s1: MJ_CFG.heroOut, spin0: hero.spin.rotation.y, turns: 1.5, back: false }
    crossed = false; skimmed = 0
    heroMode = 'flight'
    run([{ t: 0.0, fn: () => sparks.emit({ at: tmp.copy(hover), count: 20, dir: new THREE.Vector3(0, 1, 0), spread: 0.6, speed: [0.04, 0.12], life: [0.6, 1.2], gravity: -0.05, color: SUN_DUST }) }])
  }

  function returnProduct() {
    if (!hero || state !== 'showcase') return
    setState('returning')
    ui.hide(); aura.set(0)
    const go = () => {
      if (state !== 'returning' || flight) return
      P[0].copy(hero.root.position)
      P[1].set(D.seamX, doorMidY - 0.04, -0.4)
      P[2].set(hover.x, hover.y + 0.24, hover.z + 0.7)
      P[3].copy(hover)
      flight = { t: 0, dur: MJ_CFG.returnDur, s0: hero.root.scale.x, s1: MJ_CFG.heroInGarden, spin0: hero.spin.rotation.y, turns: -1, back: true }
      crossed = false; skimmed = 0
      heroMode = 'flight'
      water.setEnergy(1)
    }
    if (hero.openAmount > 0.01) { hero.setOpen(false); ui.setOpenLabel(false); run([{ t: hero.openAmount / 1.1 + 0.08, fn: go }]) } else go()
  }

  function setShade(i) {
    if (!hero) return
    i = ((i % SHADES.length) + SHADES.length) % SHADES.length
    if (!hero.setShade(i, true)) return
    ui.setActiveShade(i)
    spinVel += 7
    vibrate(6)
    const c = new THREE.Color(SHADES[i].color).lerp(new THREE.Color(1, 0.85, 0.6), 0.45)
    sparks.emit({ at: tmp.copy(hero.root.position).add(tmp2.set(0, hero.root.scale.x * 0.5, 0)), count: 34, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.05, 0.16], life: [0.7, 1.3], gravity: -0.04, color: c, jitter: hero.root.scale.x * 0.25 })
    onState && onState(state, { shade: SHADES[i], open: hero.isOpen() })
  }

  function toggleOpen(force) {
    if (!hero || state !== 'showcase') return
    const v = force === undefined ? !hero.isOpen() : force
    if (v === hero.isOpen()) return
    hero.setOpen(v)
    ui.setOpenLabel(v)
    vibrate(v ? 16 : 8)
    if (v) after(0.32, () => sparks.emit({ at: anchor.worldToLocal(hero.capWorld(tmp)), count: 40, dir: new THREE.Vector3(0.4, 1, 0.2), spread: 0.9, speed: [0.05, 0.2], life: [0.6, 1.2], gravity: -0.08 }))
    setState('showcase')
  }

  // ---- gestes ----------------------------------------------------------------------
  const raycaster = new THREE.Raycaster()
  let drag = null
  const heroHit = () => {
    if (!hero || !anchor.visible || heroMode === 'hidden') return null
    hero.proxy.scale.setScalar(heroMode === 'throne' || heroMode === 'rise' ? 3.0 : 1) // vu de loin dans la cour : zone de toucher généreuse
    hero.root.updateMatrixWorld(true)
    return raycaster.intersectObject(hero.proxy, false)[0] || null
  }
  function pointerDown(ndc, camera, id = 0) {
    if (!hero || !anchor.visible) return false
    if (drag) { if (drag.id !== id) return true; drag = null }
    raycaster.setFromCamera(ndc, camera)
    if (state === 'showcase') {
      const u = ui.hit(raycaster)
      if (u) { drag = { id, mode: 'ui', ui: u, x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: performance.now(), moved: 0 }; return true }
    }
    const h = heroHit()
    if (h && (state === 'showcase' || state === 'enthroned' || state === 'intro')) {
      drag = { id, mode: 'hero', x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: performance.now(), moved: 0 }
      lastTouch = clock
      return true
    }
    return false
  }
  function pointerMove(ndc, camera, id = 0) {
    if (!drag || drag.id !== id) return false
    const dx = ndc.x - drag.lx
    drag.moved = Math.max(drag.moved, Math.hypot(ndc.x - drag.x0, ndc.y - drag.y0))
    const now = performance.now(), mdt = Math.max(0.008, (now - drag.lt) / 1000)
    drag.lx = ndc.x; drag.lt = now
    if (drag.mode === 'hero' && state === 'showcase') {
      hero.spin.rotation.y += dx * 5
      spinVel = THREE.MathUtils.clamp((dx * 5) / mdt, -14, 14)
      lastTouch = clock
    }
    return true
  }
  function pointerCancel(id = 0) { if (drag && drag.id === id) drag = null; return true }
  function pointerUp(ndc, camera, id = 0) {
    if (!drag || drag.id !== id) return false
    const d = drag; drag = null
    const dy = ndc.y - d.y0, dx = ndc.x - d.x0
    const tap = d.moved < 0.03
    if (d.mode === 'ui') {
      if (!tap) return true
      ui.press(d.ui)
      if (d.ui.type === 'shade') setShade(d.ui.index)
      else if (d.ui.id === 'open') toggleOpen()
      else if (d.ui.id === 'return') returnProduct()
      return true
    }
    if (state === 'enthroned' || state === 'intro') { bringOut(); return true }
    if (state === 'showcase') {
      if (tap) toggleOpen()
      else if (Math.abs(dy) > 0.12 && Math.abs(dy) > Math.abs(dx) * 1.3) toggleOpen(dy > 0)
    }
    return true
  }

  // ---- boucle ------------------------------------------------------------------------
  const update = (dtRaw) => {
    if (!hero || !anchor.visible) return
    clock += dtRaw
    if (slowMoT > 0) { slowMoT -= dtRaw; slowMo += (0.3 - slowMo) * Math.min(1, dtRaw * 12) } else slowMo += (1 - slowMo) * Math.min(1, dtRaw * 4)
    const dt = dtRaw

    seqT += dt
    for (const s of seq) if (!s.done && seqT >= s.t) { s.done = true; s.fn() }

    if (jolt >= 0) { // déclic : les battants tressautent puis restent entrebâillés
      jolt += dt
      const a = Math.min(1, jolt / 0.12), b = Math.min(1, Math.max(0, (jolt - 0.12) / 0.2))
      const shake = Math.sin(jolt * 2 * Math.PI * 18) * 0.012 * Math.max(0, 1 - jolt / 0.3)
      doorAction.paused = true
      doorAction.time = Math.max(0, 0.22 * (1 - Math.pow(1 - a, 2)) - 0.09 * b * b + shake)
    }
    mixer.update(dt)
    water.update(dt, anchorCamera)
    glint.update(dt); seam.update(dt); ripple.update(dt); sparks.update(dt)

    // ---- produit
    const bob = Math.sin(clock * 1.25) * 0.0045 + Math.sin(clock * 2.3) * 0.0015
    if (heroMode === 'rise' && rise) {
      rise.t += dt / rise.dur
      const k = easeOutBack(rise.t)
      hero.root.position.copy(nozzle).lerp(hover, k)
      hero.root.scale.setScalar(MJ_CFG.heroInGarden * (0.5 + 0.5 * smooth(rise.t * 1.3)))
      hero.spin.rotation.y += dt * (idleSpin + 2.2 * (1 - smooth(rise.t)))
      if (rise.t >= 1) { rise = null; heroMode = 'throne' }
      aura.set(0.45)
    } else if (heroMode === 'throne') {
      hero.root.position.copy(hover); hero.root.position.y += 0.003 + bob * 0.8
      hero.root.scale.setScalar(MJ_CFG.heroInGarden)
      hero.spin.rotation.y += dt * idleSpin
      if (state === 'enthroned' && Math.floor(clock / 3.2) !== Math.floor((clock - dt) / 3.2)) { // invitation
        sparks.emit({ at: tmp.copy(hover).add(tmp2.set(0, MJ_CFG.heroInGarden * 0.5, 0)), count: 14, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.015, 0.04], life: [1, 1.8], gravity: 0.008, drag: 0.8, jitter: MJ_CFG.heroInGarden * 0.4, color: SUN_DUST })
      }
    } else if (heroMode === 'flight' && flight) {
      flight.t += (dt * slowMo) / flight.dur
      const t = clamp01(flight.t)
      const e = easeInOutCubic(t)
      bezier(hero.root.position, P[0], P[1], P[2], P[3], e)
      if (flight.t < 0) hero.root.position.y -= Math.sin(clamp01(-flight.t / 0.22) * Math.PI) * 0.008
      const sc = THREE.MathUtils.lerp(flight.s0, flight.s1, smoother(flight.back ? t * 1.1 : (t - 0.15) / 0.85))
      hero.root.scale.setScalar(sc)
      hero.spin.rotation.y = flight.spin0 + flight.turns * Math.PI * 2 * smoother(t)
      hero.root.rotation.z = Math.sin(t * Math.PI) * (flight.back ? -0.12 : 0.18)
      // survol du bassin long : rides sous le produit, les koï accourent
      const g = markerToGarden(meta, hero.root.position, gp)
      if (skimmed < 3 && g.z < -2.2 && g.z > -6.0 && Math.abs(g.x) < 0.7) {
        const marks = flight.back ? [-2.6, -3.9, -5.2] : [-5.2, -3.9, -2.6]
        if ((flight.back ? g.z < marks[skimmed] : g.z > marks[skimmed])) { water.splash(gp.set(g.x, 0, g.z), 0.75 - skimmed * 0.12); skimmed++ }
      }
      const midZ = hero.root.position.z
      if (!crossed && ((!flight.back && midZ > -0.01) || (flight.back && midZ < -0.01))) {
        crossed = true
        ripple.fire()
        vibrate(14)
        if (!flight.back) {
          slowMoT = 0.28
          sparks.emit({ at: tmp.set(hero.root.position.x, hero.root.position.y + sc * 0.5, 0.01), count: 70, dir: new THREE.Vector3(0, 0.1, 1), spread: 1.1, speed: [0.08, 0.32], life: [0.8, 1.6], gravity: -0.05, drag: 1.2, jitter: 0.04 })
        }
      }
      if (flight.t >= 1) {
        hero.root.rotation.z = 0
        flight = null
        if (state === 'exiting') {
          heroMode = 'showcase'; spinVel = 2.5
          aura.set(1); ui.show(); ui.setActiveShade(hero.shade); ui.setOpenLabel(hero.isOpen())
          vibrate(10)
          setState('showcase')
        } else {
          heroMode = 'throne'
          aura.set(0.45)
          splashBasin(0.8)
          water.setEnergy(0.75)
          sparks.emit({ at: tmp.copy(hover), count: 24, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.03, 0.1], life: [0.6, 1.2], gravity: -0.04, color: SUN_DUST })
          setState('enthroned')
        }
      }
    } else if (heroMode === 'showcase') {
      hero.root.position.copy(outPos); hero.root.position.y += bob
      hero.root.scale.setScalar(MJ_CFG.heroOut)
      if (!drag) {
        spinVel *= Math.max(0, 1 - dt * 2.4)
        const idle = clock - lastTouch > 2.5 ? 0.22 : 0
        hero.spin.rotation.y += dt * (spinVel + idle)
      }
    }
    hero.update(dt)

    // éclairage du produit : soleil + ciel dans la cour, studio une fois devant la porte
    const hp = hero.root.position, H = hero.root.scale.x
    const outside = heroMode === 'showcase' || (heroMode === 'flight' && hp.z > -0.3) ? 1 : 0
    const k = Math.min(1, dt * 3)
    if (outside) {
      key.position.copy(hp).add(tmp.set(0.35, 0.9, 0.7)); rim.position.copy(hp).add(tmp.set(-0.2, 0.5, -0.9)); fill.position.copy(hp).add(tmp.set(-0.6, -0.1, 0.5))
    } else {
      key.position.copy(hp).addScaledVector(sunDir, 1); rim.position.copy(hp).add(tmp.set(0.3, 0.6, -0.8)); fill.position.copy(hp).add(tmp.set(0, -0.6, 0.4))
    }
    key.target.position.copy(hp).y += H * 0.5; rim.target.position.copy(hp).y += H * 0.5; fill.target.position.copy(hp).y += H * 0.4
    key.color.lerp(outside ? WHITE : SUN_COL, k); rim.color.lerp(outside ? WARM : SKY_COL, k)
    const lit = heroMode === 'hidden' ? 0 : 1
    key.intensity += (lit * (outside ? 2.2 : 3.0) - key.intensity) * k
    rim.intensity += (lit * (outside ? 3.4 : 1.6) - rim.intensity) * k
    fill.intensity += (lit * (outside ? 0.7 : 0.9) - fill.intensity) * k

    aura.update(dt, hp, H, anchorCamera)
    ui.update(dt)
  }

  let anchorCamera = null
  return {
    anchor,
    ready,
    update,
    setCamera: (c) => { anchorCamera = c },
    pointerDown, pointerMove, pointerUp, pointerCancel,
    bringOut, returnProduct, setShade: (i) => setShade(i), toggleOpen: () => toggleOpen(),
    replay: playIntro,
    playIntro,
    getState: () => state,
    hasPlayedIntro: () => state !== 'ready' && state !== 'loading',
    shadeName: () => SHADES[hero?.shade ?? 0].name,
    _debug: () => ({ hero, ui, water, state, heroMode, meta }),
  }
}
