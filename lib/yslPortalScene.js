// Portail YSL — « Le Salon Secret ».
// Un seul rouge à lèvres trône au cœur d'une salle bakée (Blender) ; l'intro est une chorégraphie
// de lumière (groupes de lumière repondérés en direct) ; un tap le fait venir à vous à travers le
// portail, en grand ; une interface AR spatiale permet alors de changer de teinte, de l'ouvrir,
// de le faire tourner, puis de le ranger.
//
// Entrée unique : buildYslPortalScene(renderer, scene, { onStatus, onState, markerPreview })
// Repère = « unités marqueur » : origine au centre de door.png, largeur de l'image = 1, +Z vers le
// spectateur, la salle part vers -Z.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createPortalFX } from '@/lib/yslPortalFx'
import { createLightRig } from '@/lib/ysl/lightRig'
import { createDoorGlint, createSeamLight, createPortalRipple, createFloorWave, createSparks, createHeroAura } from '@/lib/ysl/effects'
import { createHero, SHADES } from '@/lib/ysl/hero'
import { createSpatialUI } from '@/lib/ysl/spatialUI'

export { SHADES }

export const CFG = {
  interiorUrl: '/ysl-portal/ysl_interior.glb',
  doorUrl: '/ysl-portal/ysl_door.glb',
  lipstickUrl: '/lovenude.glb',                       // modèle d'origine pleine qualité (un seul exemplaire)
  hdrUrl: '/hdr/photo_studio_01_1k.hdr',            // 1K suffit pour un petit objet (≈1.5 Mo au lieu de 6.4)
  markerUrl: '/targets/door.png',
  targetName: 'door',
  targetDataUrl: '/image-targets/door.json',
  heroInRoom: 0.17,                                   // hauteur sur le socle (unités marqueur)
  heroOut: 0.43,                                      // hauteur une fois sorti (≈ 65 % de la porte)
  outBase: new THREE.Vector3(0, -0.215, 0.22),        // base du produit sorti, devant le marqueur
  flightDur: 1.9,
  returnDur: 1.6,
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10) }
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const bezier = (out, p0, p1, p2, p3, t) => {
  const u = 1 - t
  return out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t)
}
// les navigateurs refusent la vibration avant le premier geste de l'utilisateur
const vibrate = (ms) => { try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; navigator.vibrate?.(ms) } catch {} }

// ---- pose 8th Wall → unités marqueur ---------------------------------------------
// door.json : image 1514×1039 stockée en portrait (isRotated) et recadrée en 4:3
// (colonnes 65 → 1450). 8th Wall donne la taille de la cible recadrée via
// scaledWidth/scaledHeight ; on en déduit l'échelle pour que largeur 1 = image entière.
const MARKER_W = 1514, CROP_LONG = 1385, CROP_SHORT = 1039
const _Z = new THREE.Vector3(0, 0, 1)
const _q = new THREE.Quaternion()
export function applyTargetPose(anchor, detail, fit = 1, rotDeg = null) {
  const sw = detail.scaledWidth || 0, sh = detail.scaledHeight || 0
  const portrait = sw > 0 && sh > 0 && sw < sh // cible rapportée debout → contenu à tourner de 90°
  const unitsPerPx = sw ? sw / (portrait ? CROP_SHORT : CROP_LONG) : 1 / CROP_SHORT
  anchor.position.copy(detail.position)
  anchor.quaternion.copy(detail.rotation)
  const deg = rotDeg ?? (portrait ? 90 : 0)
  if (deg) anchor.quaternion.multiply(_q.setFromAxisAngle(_Z, THREE.MathUtils.degToRad(deg)))
  anchor.scale.setScalar(detail.scale * unitsPerPx * MARKER_W * fit)
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

export function buildYslPortalScene(renderer, scene, { onStatus, onState, markerPreview = false } = {}) {
  const status = (s) => onStatus && onStatus(s)

  // la salle est bakée (unlit) : les lumières temps réel ne servent qu'au produit et aux bijoux
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  // environnement attendu avant « ready » : les matériaux physiques compilent une seule fois, avec l'envMap
  const envReady = new Promise((res) => {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const done = () => { pmrem.dispose(); res() }
    new RGBELoader().load(CFG.hdrUrl, (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      hdr.dispose(); done()
    }, undefined, (e) => { console.warn('[yslPortal] hdr', e); done() })
  })

  const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor)
  anchor.add(new THREE.AmbientLight(0xffffff, 0.18))
  // lumières du produit quasi neutres : un métal reflète la couleur de la lumière (l'argent doit rester argent)
  const key = new THREE.DirectionalLight(0xffffff, 0), rim = new THREE.DirectionalLight(0xffeedd, 0), fill = new THREE.DirectionalLight(0xf6f8ff, 0)
  ;[key, rim, fill].forEach((l) => anchor.add(l, l.target))

  if (markerPreview) {
    const tex = new THREE.TextureLoader().load(CFG.markerUrl); tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1039 / 1514), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, toneMapped: false }))
    plane.renderOrder = -2; anchor.add(plane)
  }

  // ---- état ------------------------------------------------------------------------
  let state = 'loading'
  let mixer, doorAction, doorClip, fx, rig, glint, seam, ripple, wave, sparks, aura, hero, ui
  const lipBase = new THREE.Vector3(0, -0.058, -0.831)
  const beamTop = new THREE.Vector3(0, 0.88, -0.831)
  const setState = (s) => {
    state = s
    const hint = s === 'showcase' && hero?.isOpen() ? HINTS.open : HINTS[s]
    status(hint ?? '')
    onState && onState(s, { shade: hero ? SHADES[hero.shade] : SHADES[0], open: !!hero?.isOpen() })
  }

  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
  const localPos = (o) => { anchor.updateMatrixWorld(true); return anchor.worldToLocal(o.getWorldPosition(new THREE.Vector3())) }

  const ready = Promise.all([load(CFG.interiorUrl), load(CFG.doorUrl), load(CFG.lipstickUrl), envReady]).then(([gi, gd, gl]) => {
    const interior = gi.scene, door = gd.scene
    interior.traverse((o) => {
      if (!o.isMesh) return
      if (o.name === 'Portal_Occluder') { o.material.colorWrite = false; o.renderOrder = -1 } // profondeur seule → cache la salle hors du cadre
      else o.material.toneMapped = false
    })
    door.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
    anchor.add(interior, door)

    rig = createLightRig(interior)
    fx = createPortalFX(interior)
    glint = createDoorGlint(door)
    seam = createSeamLight(anchor)
    ripple = createPortalRipple(anchor)
    wave = createFloorWave(anchor)
    sparks = createSparks(anchor)
    aura = createHeroAura(anchor)

    mixer = new THREE.AnimationMixer(door)
    doorClip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
    doorAction = mixer.clipAction(doorClip); doorAction.setLoop(THREE.LoopOnce, 1); doorAction.clampWhenFinished = true

    lipBase.copy(localPos(interior.getObjectByName('Lipstick_Anchor')))
    const src = interior.getObjectByName('Beam_Pedestal_Src'); if (src) beamTop.copy(localPos(src))

    hero = createHero(gl)
    anchor.add(hero.root)
    ui = createSpatialUI(anchor, { center: new THREE.Vector3(0, 0, CFG.outBase.z) })
    resetToClosed()
    prewarm()
    setState('ready')
  }).catch((err) => { console.error('[yslPortal]', (err && err.stack) || err); status('Erreur de chargement') })

  // compile tous les programmes et envoie les grosses textures au GPU tant que la porte est fermée,
  // pour éviter les saccades au moment de la détection / de la sortie du produit
  function prewarm() {
    const cam = anchorCamera
    if (!cam) return
    const vis = [anchor.visible, ui.group.visible, aura.group.visible]
    anchor.visible = ui.group.visible = aura.group.visible = true
    try {
      anchor.traverse((o) => { const m = o.material; if (m?.map) renderer.initTexture(m.map) })
      renderer.compile(scene, cam)
    } catch (e) { console.warn('[yslPortal] prewarm', e) }
    rig.loaded.then((ts) => { try { ts.forEach((t) => t && renderer.initTexture(t)) } catch (e) { console.warn('[yslPortal] prewarm LF', e) } })
    ;[anchor.visible, ui.group.visible, aura.group.visible] = vis
  }

  // ---- séquenceur ------------------------------------------------------------------
  let seq = [], seqT = 0
  const run = (steps) => { seq = steps.map((s) => ({ ...s, done: false })); seqT = 0 }
  const after = (t, fn) => seq.push({ t: seqT + t, fn, done: false })

  // ---- placement du produit --------------------------------------------------------
  const outPos = CFG.outBase
  let heroMode = 'hidden' // hidden | throne | flight | showcase
  let flight = null
  let spinVel = 0, idleSpin = 0.35, lastTouch = -10
  let clock = 0, slowMo = 1, slowMoT = 0
  let crossed = false
  let jolt = -1 // « déclic » des portes : temps écoulé depuis le début du tressaut (-1 = inactif)
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3()

  function resetToClosed() {
    seq = []
    doorAction.reset(); doorAction.play(); doorAction.paused = true; doorAction.time = 0; mixer.update(0)
    rig.set({ arch: 0, accent: 0, hero: 0, grade: 1 })
    fx.setStrength(0)
    hero.hideInstant(); hero.setOpen(false); hero.setShade(hero.shade, false)
    hero.root.position.copy(lipBase); hero.root.scale.setScalar(CFG.heroInRoom); hero.root.rotation.set(0, 0, 0)
    heroMode = 'hidden'; flight = null
    slowMo = 1; slowMoT = 0; crossed = false; drag = null; spinVel = 0; jolt = -1
    ui.hide(); aura.set(0); seam.set(0.6)
    key.intensity = rim.intensity = fill.intensity = 0
  }

  function playIntro() {
    if (!hero) return
    resetToClosed()
    setState('intro')
    run([
      { t: 0.1, fn: () => glint.sweep(1.4, 2.8) },
      { t: 0.3, fn: () => seam.set(1) },
      { t: 1.45, fn: () => { seam.flash(); vibrate(12); jolt = 0; sparks.emit({ at: tmp.set(0, 0, 0.01), count: 24, dir: new THREE.Vector3(0, 0, 1), spread: 0.9, speed: [0.03, 0.12], life: [0.6, 1.2], gravity: -0.02, jitter: 0.25 }) } },
      { t: 1.7, fn: () => {
        jolt = -1
        doorAction.paused = false; doorAction.timeScale = 0.8; doorAction.play() // repart de l'entrebâillement du déclic
        seam.set(0)
        for (let i = 0; i < 4; i++) sparks.emit({ at: tmp.set(0, -0.25 + i * 0.17, 0.0), count: 22, dir: new THREE.Vector3(0, 0.15, 1), spread: 0.8, speed: [0.05, 0.22], life: [1.2, 2.4], gravity: -0.015, drag: 0.9, jitter: 0.05 })
      } },
      { t: 2.15, fn: () => { rig.to({ hero: 1.6 }, 14); vibrate(8) } },                     // le spot du socle claque
      { t: 2.4, fn: () => { rig.to({ hero: 1.0 }, 2.2); heroMode = 'throne'; hero.reveal(1.5); wave.fire(lipBase, 0.03, 0.22) } },
      { t: 2.9, fn: () => rig.to({ accent: 1.0 }, 1.6) },                                  // niches, appliques, arche
      { t: 3.7, fn: () => rig.to({ arch: 1.0 }, 1.3) },                                    // coupole, plafonniers
      { t: 4.3, fn: () => sparks.emit({ at: tmp.copy(lipBase).add(tmp2.set(0, CFG.heroInRoom * 0.6, 0)), count: 26, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.02, 0.07], life: [1, 2], gravity: 0.01, drag: 0.8, jitter: 0.06 }) },
      { t: 4.8, fn: () => setState('enthroned') },
    ])
  }

  function bringOut() {
    if (!hero || (state !== 'enthroned' && state !== 'intro')) return
    if (state === 'intro') { // on saute la fin de l'intro proprement
      seq = []
      jolt = -1 // le déclic ne doit plus reprendre la main sur la porte
      rig.to({ arch: 1, accent: 1, hero: 1 }, 4)
      if (doorAction.time < doorClip.duration) { doorAction.paused = false; doorAction.play() } // la porte pouvait encore être en pause fermée
      doorAction.timeScale = 3
      seam.set(0)
      if (heroMode === 'hidden') hero.reveal(0.3)
      heroMode = 'throne'
    }
    setState('exiting')
    vibrate(10)
    rig.to({ arch: 0.18, accent: 0.3, hero: 1.2, grade: 0.85 }, 1.6)                      // la salle passe en pénombre de théâtre
    P[0].copy(hero.root.position)
    P[1].set(0, lipBase.y + 0.2, lipBase.z + 0.2)
    P[2].set(0, -0.12, -0.12)
    P[3].copy(outPos)
    flight = { t: -0.22, dur: CFG.flightDur, s0: CFG.heroInRoom, s1: CFG.heroOut, spin0: hero.spin.rotation.y, turns: 1.25, back: false }
    crossed = false
    heroMode = 'flight'
    run([{ t: 0.0, fn: () => sparks.emit({ at: tmp.copy(lipBase), count: 20, dir: new THREE.Vector3(0, 1, 0), spread: 0.6, speed: [0.04, 0.12], life: [0.6, 1.2], gravity: -0.05 }) }])
  }

  function returnProduct() {
    if (!hero || state !== 'showcase') return
    setState('returning')            // bloque tout de suite les autres actions pendant la fermeture
    ui.hide(); aura.set(0)
    const go = () => {
      if (state !== 'returning' || flight) return
      P[0].copy(hero.root.position)
      P[1].set(0, -0.08, -0.08)
      P[2].set(0, lipBase.y + 0.22, lipBase.z + 0.22)
      P[3].copy(lipBase)
      flight = { t: 0, dur: CFG.returnDur, s0: hero.root.scale.x, s1: CFG.heroInRoom, spin0: hero.spin.rotation.y, turns: -1, back: true }
      crossed = false
      heroMode = 'flight'
      rig.to({ arch: 1, accent: 1, hero: 1, grade: 1 }, 1.2)
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
    rig.to({ hero: (state === 'showcase' ? 1.2 : 1.0) + 0.45 }, 10)
    after(0.25, () => rig.to({ hero: state === 'showcase' ? 1.2 : 1.0 }, 2))
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
  const heroHit = (camera) => {
    if (!hero || !anchor.visible || heroMode === 'hidden') return null // pas de tap sur un produit encore invisible
    hero.proxy.scale.setScalar(heroMode === 'throne' ? 2.2 : 1)
    hero.root.updateMatrixWorld(true)
    return raycaster.intersectObject(hero.proxy, false)[0] || null
  }
  // un seul doigt suivi par geste (id = pointerId) ; les autres doigts sont ignorés
  function pointerDown(ndc, camera, id = 0) {
    if (!hero || !anchor.visible) return false
    if (drag) { if (drag.id !== id) return true; drag = null } // même doigt = l'ancien « up » s'est perdu
    raycaster.setFromCamera(ndc, camera)
    if (state === 'showcase') {
      const u = ui.hit(raycaster)
      if (u) { drag = { id, mode: 'ui', ui: u, x0: ndc.x, y0: ndc.y, lx: ndc.x, lt: performance.now(), moved: 0 }; return true }
    }
    const h = heroHit(camera)
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
    if (state === 'enthroned' || state === 'intro') { if (tap || dy < -0.05 || Math.abs(dy) > 0.05) bringOut(); return true }
    if (state === 'showcase') {
      if (tap) toggleOpen()
      else if (Math.abs(dy) > 0.12 && Math.abs(dy) > Math.abs(dx) * 1.3) toggleOpen(dy > 0)
    }
    return true
  }

  // ---- boucle ------------------------------------------------------------------------
  const update = (dtRaw) => {
    if (!hero || !anchor.visible) return // marqueur perdu : on fige l'histoire (rien n'est rendu de toute façon)
    clock += dtRaw
    if (slowMoT > 0) { slowMoT -= dtRaw; slowMo += (0.3 - slowMo) * Math.min(1, dtRaw * 12) } else slowMo += (1 - slowMo) * Math.min(1, dtRaw * 4)
    const dt = dtRaw

    seqT += dt
    for (const s of seq) if (!s.done && seqT >= s.t) { s.done = true; s.fn() }

    if (jolt >= 0) { // déclic : les battants tressautent puis restent entrebâillés (on « scrube » le clip, en pause)
      jolt += dt
      const a = Math.min(1, jolt / 0.12), b = Math.min(1, Math.max(0, (jolt - 0.12) / 0.2))
      const shake = Math.sin(jolt * 2 * Math.PI * 18) * 0.012 * Math.max(0, 1 - jolt / 0.3)
      doorAction.paused = true
      doorAction.time = Math.max(0, 0.22 * (1 - Math.pow(1 - a, 2)) - 0.09 * b * b + shake)
    }
    mixer.update(dt)
    const doorOpen = clamp01(doorAction.time / doorClip.duration)
    rig.update(dt)
    const L = rig.get()
    fx.setStrength(smooth((doorOpen - 0.2) / 0.8))
    fx.setBeamWeights({ Pedestal: L.hero, Arch: L.accent, PilasterL: L.accent, PilasterR: L.accent })
    fx.update(dt)
    glint.update(dt); seam.update(dt); ripple.update(dt); wave.update(dt); sparks.update(dt)

    // ---- produit
    const bob = Math.sin(clock * 1.25) * 0.0045 + Math.sin(clock * 2.3) * 0.0015
    if (heroMode === 'throne') {
      hero.root.position.copy(lipBase); hero.root.position.y += 0.004 + bob * 0.6
      hero.root.scale.setScalar(CFG.heroInRoom)
      hero.spin.rotation.y += dt * idleSpin
      if (state === 'enthroned' && Math.floor(clock / 2.6) !== Math.floor((clock - dt) / 2.6)) wave.fire(lipBase, 0.03, 0.17) // invitation
    } else if (heroMode === 'flight' && flight) {
      flight.t += (dt * slowMo) / flight.dur
      const t = clamp01(flight.t)
      const e = easeInOutCubic(t)
      bezier(hero.root.position, P[0], P[1], P[2], P[3], e)
      if (flight.t < 0) hero.root.position.y -= Math.sin(clamp01(-flight.t / 0.22) * Math.PI) * 0.01 // anticipation
      const sc = THREE.MathUtils.lerp(flight.s0, flight.s1, smoother(flight.back ? t * 1.1 : (t - 0.1) / 0.9))
      hero.root.scale.setScalar(sc)
      hero.spin.rotation.y = flight.spin0 + flight.turns * Math.PI * 2 * smoother(t)
      hero.root.rotation.z = Math.sin(t * Math.PI) * (flight.back ? -0.12 : 0.18)
      const midZ = hero.root.position.z
      if (!crossed && ((!flight.back && midZ > -0.01) || (flight.back && midZ < -0.01))) {
        crossed = true
        ripple.fire()
        vibrate(14)
        if (!flight.back) {
          slowMoT = 0.28
          sparks.emit({ at: tmp.set(0, hero.root.position.y + sc * 0.5, 0.01), count: 70, dir: new THREE.Vector3(0, 0.1, 1), spread: 1.1, speed: [0.08, 0.32], life: [0.8, 1.6], gravity: -0.05, drag: 1.2, jitter: 0.04 })
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
          wave.fire(lipBase, 0.03, 0.24)
          sparks.emit({ at: tmp.copy(lipBase), count: 24, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.03, 0.1], life: [0.6, 1.2], gravity: -0.04 })
          setState('enthroned')
        }
      }
    } else if (heroMode === 'showcase') {
      hero.root.position.copy(outPos); hero.root.position.y += bob
      hero.root.scale.setScalar(CFG.heroOut)
      if (!drag) {
        spinVel *= Math.max(0, 1 - dt * 2.4)
        const idle = clock - lastTouch > 2.5 ? 0.22 : 0
        hero.spin.rotation.y += dt * (spinVel + idle)
      }
    }
    hero.update(dt)

    // éclairage du produit : suit le produit (key haut-avant, rim chaud venant du portail, fill bas)
    const hp = hero.root.position, H = hero.root.scale.x
    const out = heroMode === 'showcase' || (heroMode === 'flight' && hp.z > -0.3) ? 1 : 0.55
    key.position.copy(hp).add(tmp.set(0.35, 0.9, 0.7)); key.target.position.copy(hp).y += H * 0.5
    rim.position.copy(hp).add(tmp.set(-0.2, 0.5, -0.9)); rim.target.position.copy(hp).y += H * 0.5
    fill.position.copy(hp).add(tmp.set(-0.6, -0.1, 0.5)); fill.target.position.copy(hp).y += H * 0.4
    const lit = heroMode === 'hidden' ? 0 : 1
    key.intensity += (lit * 2.2 * out - key.intensity) * Math.min(1, dt * 3)
    rim.intensity += (lit * 3.4 - rim.intensity) * Math.min(1, dt * 3)
    fill.intensity += (lit * 0.7 * out - fill.intensity) * Math.min(1, dt * 3)

    aura.update(dt, hp, H, anchorCamera)
    ui.update(dt)
  }

  let anchorCamera = null
  return {
    anchor,
    ready,
    update,
    setCamera: (c) => { anchorCamera = c },
    // nouvelle API
    pointerDown, pointerMove, pointerUp, pointerCancel,
    bringOut, returnProduct, setShade: (i) => setShade(i), toggleOpen: () => toggleOpen(),
    replay: playIntro,
    getState: () => state,
    // API historique (CatalogTest / ARCatalog)
    playIntro,
    next: () => setShade((hero?.shade ?? 0) + 1),
    prev: () => setShade((hero?.shade ?? 0) - 1),
    toggleTake: () => (state === 'showcase' ? returnProduct() : bringOut()),
    getProxy: () => hero?.proxy ?? null,
    hasPlayedIntro: () => state !== 'ready' && state !== 'loading',
    isOpen: () => (doorAction ? doorAction.time / doorClip.duration > 0.9 : false),
    shadeName: () => SHADES[hero?.shade ?? 0].name,
    _debug: () => ({ hero, ui, rig, state, heroMode }),
  }
}
