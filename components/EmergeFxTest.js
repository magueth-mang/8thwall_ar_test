'use client'

// Banc d'essai WP4 : effets d'eau de l'émergence « BLEU INTERDIT » (lib/majorelle/emergeFx.js), sans AR.
// Cour bakée + gardenFx + sondes chargées comme le directeur ; une maquette du flacon (arc extrudé
// 0,70 × 0,389 × 0,189 m + bouchon or) est menée sur les poses §4.3 (couché → battant → lévitation) et les
// événements naissent de ses extrêmes (nearSurface, edgeCross, capCross, baseCross, pinch).
// Debug : window.__ef = { fx, water, step(dt), playIntro(), scrub(t), setCam(name), verify(), … }.
// ?cam=x,y,z&tgt=x,y,z (unités marqueur) · ?preset=default|close|mid|low|top · ?q=high|medium|low · ?manual=1 · ?refl=0 · ?bottle=glb

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'
import { pickMajorelleInterior, applyMajorelleMaterials, gardenToMarker } from '@/lib/majorelle/interior'
import { PB_CFG } from '@/lib/majorelle/perfumeConfig'
import { createEmergeFX, archSilhouette } from '@/lib/majorelle/emergeFx'

const CREAM = '#EFE9DC', GOLD = '#C9A45C'
const DEG = Math.PI / 180
const SUN_DIR = [-0.52, 0.76, 0.38] // = MJ_CFG.sunDir (repère jardin)
const MARKER_ASPECT = 2400 / 1792
const CM = 0.699 / 12.6 // m par cm à l'échelle du jardin (heroInGarden 0,21 marqueur)
const HALF_D = 0.189 / 2
const E = new THREE.Vector3(...PB_CFG.E)
const KOI_GUARD = new THREE.Vector3(...PB_CFG.koiGuard), KOI_PART = new THREE.Vector3(...PB_CFG.koiPart)

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2
const easeInOutCubic = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const easeOutBack = (x, c = 1.6) => { x = clamp01(x) - 1; return 1 + (c + 1) * x * x * x + c * x * x }
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }

// vues (unités marqueur) : caméra, cible
const PRESETS = {
  default: [[0.05, -0.04, 2.0], [0, -0.12, -0.2]],
  close: [[0.12, -0.36, -0.2], [0.006, -0.52, -0.84]],
  mid: [[0.1, -0.3, 0.15], [0.006, -0.5, -0.84]],
  low: [[0.03, -0.47, -0.42], [0.006, -0.53, -0.84]],
  top: [[0.05, 0.1, 0.9], [0.006, -0.53, -0.84]],
}

export default function EmergeFxTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [hud, setHud] = useState({ t: 0, stats: '', log: [] })
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    const qs = new URLSearchParams(window.location.search)
    const quality = qs.get('q') || 'high'
    let manual = qs.get('manual') === '1'

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0807)
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    const setCam = (name, cam, tgt) => {
      const p = PRESETS[name] || PRESETS.default
      camera.position.fromArray(cam || p[0]); controls.target.fromArray(tgt || p[1]); controls.update()
    }
    const num = (k) => { const v = qs.get(k); return v ? v.split(',').map(Number) : null }
    setCam(qs.get('preset') || 'default', num('cam'), num('tgt'))

    const anchor = new THREE.Group(); scene.add(anchor)
    const sunDir = new THREE.Vector3(...SUN_DIR).normalize()
    const key = new THREE.DirectionalLight(0xfff0d8, 3.0)
    anchor.add(key, key.target)
    anchor.add(new THREE.AmbientLight(0xffffff, 0.18))
    const markerTex = new THREE.TextureLoader().load('/majorelle/marker_door_2k.png'); markerTex.colorSpace = THREE.SRGBColorSpace
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, MARKER_ASPECT), new THREE.MeshBasicMaterial({ map: markerTex, depthWrite: false, toneMapped: false }))
    marker.renderOrder = -2; anchor.add(marker)

    const pmrem = new THREE.PMREMGenerator(renderer)
    new RGBELoader().load('/hdr/photo_studio_01_1k.hdr', (hdr) => { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; hdr.dispose() })

    let meta = null, water = null, fx = null, mixer = null, gardenRoot = null, reflProxy = null
    // ---- maquette du flacon (repère jardin) : root (B, φ) → spin (lacet) → corps + bouchon
    const root = new THREE.Group(), spin = new THREE.Group(), dummy = new THREE.Group()
    root.add(spin)
    const sil = archSilhouette({ arcSteps: 16, cap: true })            // cm, CCW
    const body2D = archSilhouette({ arcSteps: 16, cap: false })
    {
      const shape = new THREE.Shape(body2D.map(([x, y]) => new THREE.Vector2(x * CM, y * CM)))
      const geo = new THREE.ExtrudeGeometry(shape, { depth: HALF_D * 2 - 0.016, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 })
      geo.translate(0, 0, -(HALF_D - 0.008))
      // maquette « jus cobalt » (≈ #2445D9 sous 2,4 cm) : sombre, laquée, pas d'émissif (la lueur fait le travail)
      const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.018, 0.045, 0.32), roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, emissive: new THREE.Color(0.004, 0.01, 0.06), envMapIntensity: 0.55 })
      mat.transparent = true; mat.blending = THREE.NoBlending; mat.depthWrite = true
      const body = new THREE.Mesh(geo, mat); body.renderOrder = 0.5; body.name = 'Dummy_Body' // comme PB_Juice : avant l'eau
      const gold = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.22 })
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.515 * CM, 1.515 * CM, 3.1 * CM, 8), gold)
      cap.rotation.y = Math.PI / 8; cap.position.y = 11.05 * CM
      const collarM = new THREE.Mesh(new THREE.CylinderGeometry(0.95 * CM, 0.95 * CM, 0.5 * CM, 24), gold); collarM.position.y = 9.25 * CM
      const studs = new THREE.Group()
      for (let i = 0; i < 16; i++) {
        const k = (i + 0.5) / 16, idx = Math.floor(k * (body2D.length - 4)) + 2
        const [x, y] = body2D[Math.min(idx, body2D.length - 1)]
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.18 * CM, 8, 6), gold)
        s.position.set(x * CM * 0.82, Math.max(y * CM * 0.9, 0.8 * CM), HALF_D); s.scale.z = 0.5
        studs.add(s)
      }
      dummy.add(body, cap, collarM, studs)
      spin.add(dummy)
    }

    // ---- poses §4.3 (repère jardin) ------------------------------------------------------
    const B0 = new THREE.Vector3(...PB_CFG.lying.base), B1 = new THREE.Vector3(...PB_CFG.preLift.base)
    const pose = { B: new THREE.Vector3(), phi: -90 * DEG, yaw: 0 }
    function poseAt(emT) {
      const sw = PB_CFG.swingDur, lf = PB_CFG.liftDur
      pose.yaw = 0
      if (emT <= 0) { pose.B.copy(B0); pose.phi = PB_CFG.lying.phiDeg * DEG; return pose }
      if (emT < sw) {
        const u = emT / sw
        pose.phi = (-90 + 90 * easeInOutSine(u)) * DEG
        pose.B.lerpVectors(B0, B1, easeInOutCubic(u))
        return pose
      }
      const t2 = emT - sw
      pose.phi = 3 * Math.sin(Math.PI * clamp01(t2 / 0.25)) * DEG          // dépassement de 3°, posé à +0,25 s
      const u = clamp01(t2 / lf)
      pose.B.set(B1.x * (1 - smooth(u)), B1.y + (PB_CFG.hoverBaseY - B1.y) * easeOutBack(u), E.z)
      if (t2 > lf) { // trône : balancement de face ±10° / 6 s, flottement ±1 cm / 5 s
        const h = t2 - lf
        pose.yaw = 10 * DEG * Math.sin((h / 6) * Math.PI * 2) * smooth(h / 1.5)
        pose.B.y += 0.01 * Math.sin((h / 5) * Math.PI * 2) * smooth(h / 1.5)
      }
      return pose
    }
    function applyPose(p) { root.position.copy(p.B); root.rotation.set(0, 0, p.phi); spin.rotation.y = p.yaw }

    // ---- extrêmes / section / points d'égouttage (ce que perfume.js fournira) ---------------
    const ex = { highestY: 0, highestX: 0, shoulderY: 0, capTopY: 0, capX: 0, capY: 0, baseLowY: 0 }
    const rot = (x, y, out) => { const c = Math.cos(pose.phi), s = Math.sin(pose.phi); out.x = pose.B.x + x * c - y * s; out.y = pose.B.y + x * s + y * c; return out }
    const q2 = { x: 0, y: 0 }
    function extrema() {
      ex.highestY = -1e9; ex.shoulderY = -1e9; ex.capTopY = -1e9; ex.baseLowY = 1e9
      for (const [x, y] of sil) {
        rot(x * CM, y * CM, q2)
        if (q2.y > ex.highestY) { ex.highestY = q2.y; ex.highestX = q2.x }
        if (y < 8.8 && q2.y > ex.shoulderY) ex.shoulderY = q2.y
      }
      for (const sx of [-1.4, 1.4]) { rot(sx * CM, 12.6 * CM, q2); if (q2.y > ex.capTopY) { ex.capTopY = q2.y; ex.capX = q2.x } }
      rot(0, 12.6 * CM, q2); ex.capY = q2.y
      for (const sx of [-3.1, 3.1]) { rot(sx * CM, 0, q2); ex.baseLowY = Math.min(ex.baseLowY, q2.y) }
      return ex
    }
    const section = { ok: false, x0: 0, x1: 0, zc: E.z, halfDepth: HALF_D }
    const qa = { x: 0, y: 0 }, qb = { x: 0, y: 0 }
    function waterSection() {
      let x0 = 1e9, x1 = -1e9, hits = 0, capOnly = true
      for (let i = 0; i < sil.length; i++) {
        const a = sil[i], b = sil[(i + 1) % sil.length]
        rot(a[0] * CM, a[1] * CM, qa); rot(b[0] * CM, b[1] * CM, qb)
        if ((qa.y > 0) === (qb.y > 0)) continue
        const t = qa.y / (qa.y - qb.y), x = qa.x + (qb.x - qa.x) * t
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); hits++
        if (a[1] < 9.4 || b[1] < 9.4) capOnly = false
      }
      section.ok = hits >= 2; section.x0 = x0; section.x1 = x1; section.zc = pose.B.z; section.halfDepth = capOnly ? 1.4 * CM : HALF_D
      return section
    }
    const dripPts = Array.from({ length: 16 }, () => new THREE.Vector3())
    const dripOut = []
    function dripFn() {
      // points « qui égouttent » : arêtes tournées vers le bas, émergées, sur les faces ; coins du bouchon
      dripOut.length = 0
      let n = 0
      const c = Math.cos(pose.phi), s = Math.sin(pose.phi)
      for (let i = 0; i < sil.length && n < 12; i++) {
        const a = sil[(i - 1 + sil.length) % sil.length], b = sil[i], d = sil[(i + 1) % sil.length]
        const tx = d[0] - a[0], ty = d[1] - a[1]                       // tangente CCW → normale extérieure (ty, −tx)
        let nx = ty, ny = -tx; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L
        const wny = nx * s + ny * c                                    // composante verticale après rotation
        rot(b[0] * CM, b[1] * CM, q2)
        if (wny < -0.35 && q2.y > 0.006) { dripPts[n].set(q2.x, q2.y, pose.B.z + (n % 2 ? -1 : 1) * (HALF_D + 0.004)); dripOut.push(dripPts[n]); n++ }
      }
      return dripOut
    }
    const baseFn = (out) => (pose.B.y > -0.01 ? out.set(pose.B.x, pose.B.y, pose.B.z) : null)

    // ---- scénario (§4.3, du point de vue des effets d'eau) ---------------------------------
    const S = { t: 0, emT: 0, slow: 1, slowT: 0, playing: false, cues: [], ev: {}, baseT: -1, pinchT: -1, drips: 0, hoverT: -1 }
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3()
    const koiLog = []
    function resetIntro() {
      S.t = 0; S.emT = 0; S.slow = 1; S.slowT = 0; S.ev = {}; S.baseT = -1; S.pinchT = -1; S.drips = 0; S.hoverT = -1
      fx.clear()
      water.setEnergy(0); water.koi.setActivity(0.8)
      applyPose(poseAt(0))
      S.cues = [
        [1.7, () => { water.koi.gather(KOI_GUARD, 8); fx.koiTarget(KOI_GUARD, 8) }],
        [1.8, () => water.setEnergy(0.35)],
        [2.1, () => { glowFollow(); fx.glow.set(0.6, { dur: 1.0 }); fx.glow.beat(1.1); fx.glow.patch(0.3, 1.0); setStatus('« Touchez la lumière »') }],
        [2.9, () => { water.setEnergy(0.06); water.koi.setActivity(0.5); fx.glow.beat(0.65); fx.glow.set(0.8, { dur: 0.4 }) }],
        [3.4, () => { water.koi.gather(KOI_PART, 3); water.koi.setActivity(1.5); fx.koiTarget(KOI_PART, 3) }],
        [5.7, () => { water.koi.setActivity(1.0); fx.koiTarget(E, 9) }],
        [6.2, () => { water.setEnergy(1); fx.glow.set(null, { at: E }); fx.glow.patch(0.35, 0.8) }],
        [6.5, () => setStatus("« Touchez le flacon · effleurez l'eau »")],
        [7.4, () => water.setEnergy(0.75)],
        [9.1, () => fx.drops.setRate(1 / 3)],
      ].map(([t, fn]) => ({ t, fn, done: false }))
      setStatus('Intro')
    }
    const glowFollow = () => { // la lueur suit le centre du flacon et son roulis
      const c = Math.cos(pose.phi), s = Math.sin(pose.phi), h = 0.35
      fx.glow.set(null, { at: [pose.B.x - h * s, pose.B.z], y: Math.min(pose.B.y + h * c, -0.05), phi: pose.phi / DEG })
    }
    function fire(name, fn) { if (!S.ev[name]) { S.ev[name] = S.t; fn() } }
    function introStep(dt) {
      // ralenti de la rupture (0,5 pendant 0,5 s), appliqué au flacon, aux effets ET à water.update
      if (S.slowT > 0) { S.slowT -= dt; S.slow += (0.5 - S.slow) * Math.min(1, dt * 14) } else S.slow += (1 - S.slow) * Math.min(1, dt * 6)
      const sdt = dt * S.slow
      S.t += dt
      for (const c of S.cues) if (!c.done && S.t >= c.t) { c.done = true; c.fn() }
      if (S.t >= PB_CFG.swingStart) S.emT += sdt
      applyPose(poseAt(S.emT))
      const x = extrema()
      if (S.t >= PB_CFG.swingStart) {
        if (!S.ev.edgeCross) glowFollow()
        if (x.shoulderY > -0.05) fire('nearSurface', () => fx.dome.set(x.highestX, E.z, 0.25, 0.04, 0.16))
        if (x.highestY > 0) fire('edgeCross', () => {
          const r = fx.splash(tmp.set(x.highestX, 0, E.z), 0.9, { priority: 'high' })
          S.slowT = 0.5
          fx.dome.hide(0.1)
          fx.crown.fire(x.highestX, E.z, 0.12, 0.9)
          fx.glow.set(0, { dur: 0.8 }); fx.glow.beat(0); fx.glow.patch(0, 0.8)
          fx.collar.set(waterSection(), 0.025)
          setStatus('Rupture · splash ' + r)
        })
        if (S.ev.edgeCross && !S.ev.baseCross) {
          fx.collar.set(waterSection(), 0.025)
          if (S.t - S.ev.edgeCross > 0.1) fire('pendant', () => fx.drops.pendant(dripFn, 6))
        }
        if (x.capTopY > 0) fire('capCross', () => {
          for (let i = 0; i < 8; i++) fx.drops.spawn(tmp.set(x.capX + (Math.random() - 0.5) * 0.06, x.capTopY + 0.005, E.z + (Math.random() - 0.5) * 0.08),
            tmp2.set((Math.random() - 0.5) * 0.5, 0.7 + 0.6 * Math.random(), (Math.random() - 0.3) * 0.35), 0.003 + 0.002 * Math.random())
        })
        if (x.baseLowY > 0) fire('baseCross', () => { fx.collar.hide(0.1); fx.neck.attach(baseFn); fx.drops.stop(); S.baseT = S.emT })
        if (S.ev.baseCross && (S.emT - S.baseT > 0.25 || fx.neck.length > 0.12)) fire('pinch', () => {
          const r = fx.splash(tmp.set(0, 0, E.z), 0.45, { priority: 'high', koi: { point: E, seconds: 9 } })
          fx.neck.pinch(); S.pinchT = S.emT
          setStatus('Pincement · splash ' + r)
        })
        if (S.pinchT >= 0 && S.drips < 6 && S.emT - S.pinchT > S.drips * 0.17) { // 6 gouttes des coins de la base en 1 s
          const sx = S.drips % 2 ? 1 : -1, sz = S.drips % 3 === 0 ? 1 : -1
          fx.drops.spawn(tmp.set(pose.B.x + sx * 3.0 * CM, pose.B.y - 0.004, E.z + sz * (HALF_D - 0.01)), tmp2.set(0, -0.05, 0), 0.0034)
          S.drips++
        }
        if (S.emT >= PB_CFG.swingDur + PB_CFG.liftDur) fire('hover', () => fx.drops.pendant(dripFn, 2))
      }
      return sdt
    }

    // ---- boucle ---------------------------------------------------------------------------------
    let frame = 0
    const step = (dt = 1 / 30, render = true) => {
      if (!fx) return
      frame++
      const sdt = S.playing ? introStep(dt) : dt
      if (mixer) mixer.update(dt)
      demoStep(sdt)
      water.update(sdt, camera)
      fx.update(sdt, camera)
      key.position.copy(gardenToMarker(meta, pose.B.x + sunDir.x * 3, pose.B.y + sunDir.y * 3, pose.B.z + sunDir.z * 3, tmp))
      gardenToMarker(meta, pose.B.x, pose.B.y + 0.3, pose.B.z, key.target.position)
      controls.update()
      if (render) renderer.render(scene, camera)
    }
    const playIntro = () => { if (!fx) return; resetIntro(); S.playing = true }
    const scrub = (t, dt = 1 / 60) => { playIntro(); const n = Math.round(t / dt); for (let i = 0; i < n; i++) step(dt, false); renderer.render(scene, camera) }

    const ready = Promise.all([
      pickMajorelleInterior('/majorelle').then(async (pick) => ({ pick, gltf: pick ? await new Promise((res, rej) => { const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); l.load(pick.glbUrl, res, undefined, rej) }) : null })),
      new Promise((res, rej) => new GLTFLoader().load('/majorelle/mj_door.glb', res, undefined, rej)),
      loadReflectionProbes('/majorelle/fx/').catch(() => null),
      // PB_ReflProxy du vrai flacon (P2 : imposteur miroir) ; facultatif
      new Promise((res) => new GLTFLoader().load(PB_CFG.bottleUrl, res, undefined, () => res(null))),
    ]).then(([gi, gd, probes, gp]) => {
      if (disposed) return
      if (!gi.pick) throw new Error('cour bakée introuvable')
      meta = gi.pick.meta
      applyMajorelleMaterials(gi.gltf.scene, meta, '/majorelle')
      gd.scene.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
      anchor.add(gi.gltf.scene, gd.scene)
      mixer = new THREE.AnimationMixer(gd.scene)
      const clip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
      if (clip) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.time = clip.duration; a.paused = true; mixer.update(0) }
      gardenRoot = new THREE.Group()
      gardenRoot.position.set(meta.X_OFF, meta.Z_OFF, 0)
      gardenRoot.scale.setScalar(meta.K)
      anchor.add(gardenRoot)
      water = createGardenFX({ parent: gardenRoot, sunDir: sunDir.clone(), reflectionCube: probes, energy: 0.75 })
      // journal des rassemblements de koï (gardenFx appelle koi.gather via la propriété : l'enveloppe voit aussi l'auto-rassemblement)
      const g0 = water.koi.gather.bind(water.koi)
      water.koi.gather = (p, s) => { koiLog.push({ frame: fx ? fx.frame : -1, t: fx ? +fx.time.toFixed(3) : 0, x: +p.x.toFixed(2), z: +p.z.toFixed(2), s, auto: s === 6.5 }); if (koiLog.length > 60) koiLog.shift(); return g0(p, s) }
      fx = createEmergeFX({ parent: gardenRoot, water, probes, sunDir: sunDir.clone(), quality, splashRules: PB_CFG.splash })
      gardenRoot.add(root)
      // proxy de reflet : même repère que la maquette (origine au centre de la base, face +Z), caché
      const proxy = gp?.scene.getObjectByName('PB_ReflProxy')
      if (proxy) {
        proxy.removeFromParent(); proxy.position.set(0, 0, 0); proxy.scale.setScalar(0.699 / 0.126); proxy.visible = false
        spin.add(proxy)
        if (qs.get('refl') !== '0') fx.reflect.track(proxy, 1)
      }
      reflProxy = proxy || null
      // ?bottle=glb : le vrai flacon (mêmes repère et échelle) en matériaux de remplacement, à la place de la maquette
      if (gp && qs.get('bottle') === 'glb') {
        const gold = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.22 })
        gp.scene.traverse((o) => {
          if (!o.isMesh) return
          if (o.name === 'PB_Juice') {
            o.material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.012, 0.03, 0.26), roughness: 0.08, clearcoat: 0.5, envMapIntensity: 0.3 })
            o.material.transparent = true; o.material.blending = THREE.NoBlending; o.renderOrder = 0.5
          } else if (o.name === 'PB_Glass') {
            o.material = new THREE.MeshPhysicalMaterial({ color: 0xe6edff, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 0.9 })
            o.renderOrder = 11.5
          } else o.material = gold
        })
        gp.scene.scale.setScalar(0.699 / 0.126)
        spin.add(gp.scene)
        dummy.visible = false
      }
      applyPose(poseAt(0))
      fx.prewarm(renderer, scene, camera)
      setStatus(`Prêt · ${quality}${probes?.pool ? ' · sondes' : ' · sans sonde'}`)
      if (qs.get('autoplay') !== '0') setTimeout(() => !disposed && playIntro(), 300)
    }).catch((e) => { console.error('[emerge-test]', e); setStatus('Erreur de chargement') })

    // vérification des règles de l'ordonnanceur à partir du journal
    const verify = () => {
      const R = PB_CFG.splash
      const done = fx.splashLog().filter((e) => e.res === 'done')
      const bad = []
      for (let i = 0; i < done.length; i++) {
        const e = done[i]
        const inWin = done.filter((d) => d.t <= e.t + 1e-6 && e.t - d.t < R.window - 1e-6).length
        if (inWin > R.maxInWindow) bad.push({ e, why: 'window', inWin })
        if (i > 0) {
          const p = done[i - 1], need = e.k >= R.bigK || p.k >= R.bigK ? R.bigGap : R.smallGap
          if (e.t - p.t < need - 1e-6) bad.push({ e, why: 'gap', gap: +(e.t - p.t).toFixed(3), need })
        }
      }
      return { fired: done.length, violations: bad }
    }
    const koiCheck = () => {
      // pour chaque splash « done » dans le bassin long : l'auto-rassemblement (6,5 s) est-il suivi d'un re-ciblage dans la même image ?
      const out = []
      for (const e of fx.splashLog().filter((d) => d.res === 'done')) {
        const same = koiLog.filter((k) => k.frame === e.frame)
        const autoI = same.findIndex((k) => k.auto)
        const fixI = same.findIndex((k, i) => i > autoI && !k.auto)
        out.push({ frame: e.frame, k: e.k, auto: autoI >= 0, retarget: fixI >= 0 ? same[fixI] : null })
      }
      return out
    }
    const effects = {
      glow: () => { S.playing = false; applyPose(poseAt(0)); fx.glow.set(0.7, { at: [0.02, E.z], y: -0.24, phi: -90, dur: 0.6 }); fx.glow.beat(1.1); fx.glow.patch(0.1) },
      glowOff: () => { fx.glow.set(0, { dur: 0.5 }); fx.glow.beat(0); fx.glow.patch(0) },
      rings: () => { for (let i = 0; i < 5; i++) fx.rings.add(-0.4 + i * 0.2, -2.4 - i * 0.25, 0.3 + 0.15 * i) },
      knockRing: () => fx.rings.add(0, -1.95, 0.6),
      drops: () => { for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, sp = 0.2 + 0.3 * Math.random(); fx.drops.spawn(tmp.set(0, 0.02, E.z), tmp2.set(Math.cos(a) * sp, 0.8 + 0.6 * Math.random(), Math.sin(a) * sp), 0.003 + 0.003 * Math.random()) } },
      pendant: () => { S.playing = false; pose.B.set(0, 0.14, E.z); pose.phi = 0; pose.yaw = 0; applyPose(pose); fx.drops.pendant(dripFn, 6) },
      stopDrips: () => fx.drops.stop(),
      dome: () => fx.dome.set(-0.1, E.z, 0.25, 0.04, 0.16),
      domeHide: () => fx.dome.hide(0.3),
      crown: () => fx.crown.fire(-0.1, E.z, 0.12, 0.9),
      collar: () => { S.playing = false; pose.B.set(-0.04, -0.2, E.z); pose.phi = -20 * DEG; applyPose(pose); fx.collar.set(waterSection(), 0.025) },
      collarHide: () => fx.collar.hide(0.2),
      neck: () => { S.playing = false; pose.B.set(0, 0.06, E.z); pose.phi = 0; applyPose(pose); fx.neck.attach(baseFn) },
      pinch: () => fx.neck.pinch(),
      carpet: () => fx.carpet.sparkle([0, -1.9, 0, -4.6], 3.5),
      bubbles: () => fx.bubbles.spawn(0.3, -2.7, 6),
      hover: () => { S.playing = false; pose.B.set(0, 0.14, E.z); pose.phi = 0; pose.yaw = 0; applyPose(pose) },
      reflect: () => fx.reflect.track(fx.reflect.enabled ? null : reflProxy, 1),
      splashBig: () => fx.splash(tmp.set(0.2, 0, -3.2), 0.9, { priority: 'high' }),
      splashSmall: () => fx.splash(tmp.set(-0.3, 0, -2.4), 0.45),
      splashLow: () => fx.splash(tmp.set(0.1, 0, -2.2), 0.5, { priority: 'low' }),
      wakeZigzag: () => startDemo('zigzag'),
      wakeLong: () => startDemo('long'),
      wakeHold: () => startDemo('hold'),
      wakeCircle: () => startDemo('circle'),
      tapPool: () => { // fx.tapWater avec un vrai rayon caméra → point du bassin (le chemin du directeur, tapAt)
        gardenRoot.updateWorldMatrix(true, false)
        const o = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(gardenRoot.matrixWorld).invert())
        return fx.tapWater(new THREE.Ray(o, tmp.set(0.15, 0, -3.3).sub(o).normalize()))
      },
      spam: () => { // 8 demandes en rafale (règles : 3 / 2,5 s, gros ≥ 1,2 s, petits ≥ 0,6 s)
        const pts = [[0.2, -3.2, 0.9, 'high'], [-0.3, -2.4, 0.45, 'normal'], [0.1, -2.2, 0.5, 'low'], [0.4, -4.0, 0.35, 'normal'], [-0.2, -3.6, 0.8, 'high'], [0.0, -5.0, 0.5, 'low'], [0.3, -2.0, 0.25, 'normal'], [-0.4, -4.4, 0.5, 'high']]
        pts.forEach(([x, z, k, p], i) => setTimeout(() => fx.splash(new THREE.Vector3(x, 0, z), k, { priority: p }), i * 150))
      },
      clear: () => { S.playing = false; fx.clear() },
    }

    // rayon souris → repère jardin
    const ray = new THREE.Raycaster(), inv = new THREE.Matrix4(), ndc = new THREE.Vector2(), waterHit = new THREE.Vector3()
    const gardenRay = (e) => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      gardenRoot.updateWorldMatrix(true, false)
      inv.copy(gardenRoot.matrixWorld).invert()
      ray.ray.applyMatrix4(inv); ray.ray.direction.normalize()
      return ray.ray
    }
    // Doigt / souris posé sur le bassin long → sillage (comme le directeur : pointerDown / Move / Up « water ») ;
    // l'orbite est suspendue le temps du glissé. Ailleurs : orbite ; clic bref hors bassin → tapWater ;
    // Maj + clic → tapWater (le tap isolé). ?wake=0 : souris = orbite seule.
    const wakeOn = qs.get('wake') !== '0'
    let down = null, wakeDrag = null
    const onDownCapture = (e) => {
      if (!fx || !water || !wakeOn || e.shiftKey || (e.button !== undefined && e.button !== 0)) return
      const h = water.intersectWater(gardenRay(e), waterHit)
      if (!h || !water.wake?.inPool(h.x, h.z) || Math.abs(h.y) > 0.05) return
      controls.enabled = false
      wakeDrag = { id: e.pointerId }
      try { renderer.domElement.setPointerCapture(e.pointerId) } catch {}
      fx.wake.start(h)
    }
    const onMoveWake = (e) => {
      if (!wakeDrag || e.pointerId !== wakeDrag.id || !fx) return
      const h = water.intersectWater(gardenRay(e), waterHit)
      if (h) fx.wake.move(h)
    }
    const onUpWake = (e) => {
      if (!wakeDrag || e.pointerId !== wakeDrag.id) return
      wakeDrag = null
      fx?.wake.end()
      controls.enabled = true
    }
    const onDown = (e) => { down = wakeDrag ? null : { x: e.clientX, y: e.clientY, t: performance.now() } }
    const onUp = (e) => {
      if (!down || !fx) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 6) return
      fx.tapWater(gardenRay(e))
    }
    mount.addEventListener('pointerdown', onDownCapture, { capture: true }) // avant OrbitControls (sur le canvas)
    renderer.domElement.addEventListener('pointermove', onMoveWake)
    renderer.domElement.addEventListener('pointerup', onUpWake)
    renderer.domElement.addEventListener('pointercancel', onUpWake)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    // gestes scriptés (repère jardin) : vérifications reproductibles du sillage, pilotées par step()
    const DEMOS = {
      zigzag: { speed: 1.2, pts: [[-0.5, -2.3], [0.5, -2.9], [-0.5, -3.5], [0.5, -4.1], [-0.3, -4.6]] },
      long: { speed: 1.5, pts: [[0.05, -2.1], [0.0, -5.6]] },
      slow: { speed: 0.45, pts: [[-0.3, -2.6], [0.3, -3.6]] },
      cross: { speed: 1.0, pts: [[-0.7, -3.0], [0.7, -3.0]] },
      circle: { speed: 1.1, pts: Array.from({ length: 25 }, (_, i) => [0.42 * Math.sin((i / 24) * Math.PI * 2), -3.6 + 0.42 * Math.cos((i / 24) * Math.PI * 2)]) },
      hold: { speed: 1, hold: 2.6, pts: [[0.1, -3.3]] },
      koi: { speed: 0.9, pts: [[0.0, -3.0], [0.0, -4.6]] },
    }
    const demo = { on: false, d: null, t: 0, len: 0, seg: [], p: new THREE.Vector3() }
    const startDemo = (name) => {
      const d = DEMOS[name] || DEMOS.zigzag
      demo.d = d; demo.t = 0; demo.on = true; demo.seg = [0]
      for (let i = 1; i < d.pts.length; i++) demo.seg.push(demo.seg[i - 1] + Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]))
      demo.len = demo.seg[demo.seg.length - 1]
      demo.p.set(d.pts[0][0], 0, d.pts[0][1])
      fx.wake.start(demo.p)
    }
    const demoStep = (dt) => {
      if (!demo.on) return
      demo.t += dt
      const d = demo.d, s = demo.t * d.speed
      if (s >= demo.len + (d.hold || 0) * d.speed) { demo.on = false; fx.wake.end(); return }
      const ss = Math.min(s, demo.len)
      let i = 1
      while (i < demo.seg.length - 1 && demo.seg[i] < ss) i++
      if (d.pts.length > 1) {
        const a = d.pts[i - 1], b = d.pts[i], u = (ss - demo.seg[i - 1]) / Math.max(demo.seg[i] - demo.seg[i - 1], 1e-6)
        demo.p.set(a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u)
      }
      fx.wake.move(demo.p)
    }

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)
    let last = performance.now(), raf = null, hudT = 0
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now
      if (!manual) step(dt)
      hudT += dt
      if (hudT > 0.25 && fx) {
        hudT = 0
        const st = fx.stats(true)
        setHud({ t: S.t, stats: `fx ${st.drawCalls} dc · ${st.triangles} tris · anneaux ${st.rings} · gouttes ${st.drops} · file ${st.queue} · sillage ${st.wake} · scène ${renderer.info.render.calls} dc`, log: fx.splashLog().slice(-8).reverse() })
      }
    }
    tick()

    const api = {
      get fx() { return fx }, get water() { return water }, get meta() { return meta }, ready,
      scene, camera, controls, renderer, gardenRoot: () => gardenRoot, S, pose, koiLog, effects,
      step: (dt = 1 / 30) => step(dt), playIntro, scrub, verify, koiCheck, extrema, waterSection,
      startDemo, demo, DEMOS,
      setCam: (name, cam, tgt) => setCam(name, cam, tgt),
      manual: (on = true) => { manual = on },
      render: () => renderer.render(scene, camera),
    }
    window.__ef = api
    apiRef.current = api

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      mount.removeEventListener('pointerdown', onDownCapture, { capture: true })
      renderer.domElement.removeEventListener('pointermove', onMoveWake)
      renderer.domElement.removeEventListener('pointerup', onUpWake)
      renderer.domElement.removeEventListener('pointercancel', onUpWake)
      fx?.dispose(); water?.dispose?.()
      controls.dispose(); renderer.dispose(); pmrem.dispose()
      renderer.domElement.remove()
      if (window.__ef === api) delete window.__ef
    }
  }, [])

  const btn = { background: 'rgba(0,0,0,0.55)', color: CREAM, border: `1px solid ${GOLD}88`, borderRadius: 999, padding: '5px 9px', fontSize: 10, letterSpacing: '0.08em', margin: 2 }
  const E_ = (name, label) => <button key={name} style={btn} onClick={() => apiRef.current?.effects[name]()}>{label}</button>
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807', fontFamily: 'system-ui, sans-serif' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Didot', Georgia, serif", fontSize: 10, letterSpacing: '0.42em', color: GOLD }}>BLEU INTERDIT · EAU</div>
        <div style={{ color: CREAM, fontSize: 11, marginTop: 4, textShadow: '0 1px 4px #000' }}>{status} · t {hud.t.toFixed(2)} s</div>
        <div style={{ color: CREAM, fontSize: 10, opacity: 0.8, marginTop: 2, textShadow: '0 1px 4px #000' }}>{hud.stats}</div>
      </div>
      <div style={{ position: 'absolute', top: 64, left: 8, maxWidth: 330, color: CREAM, fontFamily: 'ui-monospace, monospace', fontSize: 9, lineHeight: 1.35, background: 'rgba(0,0,0,0.45)', padding: '4px 6px', borderRadius: 6, pointerEvents: 'none' }}>
        <div style={{ color: GOLD }}>ordonnanceur (récent en haut)</div>
        {hud.log.map((e, i) => (
          <div key={i} style={{ color: e.res === 'done' ? '#9fe0a8' : e.res === 'queued' ? '#f2d38a' : '#f29a8a' }}>
            {e.t.toFixed(2)} k{e.k.toFixed(2)} {e.pri} → {e.res}{e.why ? ` (${e.why})` : ''}{e.wait ? ` +${e.wait.toFixed(2)}s` : ''}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 8, left: 6, right: 6, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button style={{ ...btn, borderColor: GOLD }} onClick={() => apiRef.current?.playIntro()}>INTRO</button>
        <input type="range" min={0} max={9} step={0.05} defaultValue={0} style={{ width: 140, margin: '0 6px' }}
          onChange={(e) => apiRef.current?.scrub(Number(e.target.value))} />
        {E_('glow', 'lueur')}{E_('glowOff', '× lueur')}{E_('rings', 'anneaux')}{E_('knockRing', 'toc')}{E_('drops', 'gerbe')}
        {E_('pendant', 'égouttage')}{E_('stopDrips', '× égout.')}{E_('dome', 'dôme')}{E_('domeHide', '× dôme')}{E_('crown', 'couronne')}
        {E_('collar', 'collerette')}{E_('collarHide', '× coll.')}{E_('neck', 'colonne')}{E_('pinch', 'pincement')}{E_('carpet', 'tapis')}
        {E_('bubbles', 'bulles')}{E_('hover', 'lévitation')}{E_('reflect', 'reflet')}{E_('splashBig', 'splash 0.9')}{E_('splashSmall', 'splash 0.45')}{E_('splashLow', 'splash low')}{E_('spam', 'rafale ×8')}
        {E_('wakeZigzag', 'sillage ~')}{E_('wakeLong', 'sillage ↑')}{E_('wakeCircle', 'sillage ○')}{E_('wakeHold', 'doigt posé')}{E_('tapPool', 'tap eau')}{E_('clear', 'effacer')}
      </div>
    </div>
  )
}
