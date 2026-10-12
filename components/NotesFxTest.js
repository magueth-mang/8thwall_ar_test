'use client'

// Banc d'essai WP5 (SPEC_PERFUME §5.3–5.5) : la cour bakée + gardenFx comme le directeur, la porte ouverte,
// un flacon factice à la pose vitrine, et les modules notesFx + sillage. Boutons pour chaque effet, le chemin
// réel de l'arc en ligne de debug, statistiques de rendu. window.__nf = { notes, sillage, water, step(dt), … }
// (?manual=1 : la boucle RAF ne fait plus avancer la scène, seul step(dt) le fait).

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'
import { pickMajorelleInterior, applyMajorelleMaterials, gardenToMarker } from '@/lib/majorelle/interior'
import { PB_CFG } from '@/lib/majorelle/perfumeConfig'
import { createNotesFX } from '@/lib/majorelle/notesFx'
import { createSillage } from '@/lib/majorelle/sillage'

const BASE = '/majorelle'
const TEX = '/majorelle/perfume/'
const GOLD = '#C9A45C', CREAM = '#EFE9DC'
const DOOR = { seamX: 904 / 1792 - 0.5, y0: (1200 - 2154) / 1792, y1: (1200 - 755) / 1792, halfW: 0.1794 }
const DOOR_MID_Y = (DOOR.y0 + DOOR.y1) / 2
const OUT_POS = new THREE.Vector3(0.004464, -0.32202, 0.22)
const SUN_DIR = new THREE.Vector3(-0.52, 0.76, 0.38).normalize()
const CAMS = {
  default: { p: [0.05, -0.04, 2.0], t: [0, -0.12, -0.2] },
  pool: { p: [-0.04, -0.3, 0.55], t: [-0.1, -0.5, -0.7] },
  garden: { p: [-0.06, -0.43, -0.3], t: [-0.13, -0.53, -0.66] },
  show: { p: [0.25, -0.1, 1.1], t: [0.0, -0.12, 0.0] },
}

const loadTex = (url) => new Promise((res) => new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t) }, undefined, () => res(null)))
const loadJson = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// flacon factice : arc outrepassé extrudé (hauteur 1 = flacon), verre bleu + bouchon or
function makePlaceholderBottle() {
  const H = 0.126, s = 1 / H
  const sh = new THREE.Shape()
  const jw = 0.031 * s, spY = 0.03515 * s, R = 0.038 * s, cY = 0.05212 * s, top = 0.0875 * s
  sh.moveTo(-jw, 0); sh.lineTo(jw, 0); sh.lineTo(jw, spY)
  sh.absarc(-0.003 * s, cY, R, -0.5, 1.2, false)
  sh.lineTo(0.0109 * s, top); sh.lineTo(-0.0109 * s, top)
  sh.absarc(0.003 * s, cY, R, Math.PI - 1.2, Math.PI + 0.5, false)
  sh.lineTo(-jw, 0)
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.034 * s, bevelEnabled: true, bevelThickness: 0.004 * s, bevelSize: 0.003 * s, bevelSegments: 2, curveSegments: 24 })
  geo.translate(0, 0, -0.017 * s)
  const glass = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x2445d9, roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.88, emissive: 0x0a1a66, emissiveIntensity: 0.4 }))
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.18, emissive: 0x000000 })
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.031 * s, 8), gold)
  cap.position.y = (0.095 + 0.0155) * s
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0095 * s, 0.0095 * s, 0.006 * s, 24), gold)
  collar.position.y = 0.092 * s
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0135 * s, 0.0016 * s, 8, 32), gold)
  ring.position.set(0, 0.0635 * s, 0.019 * s)
  const root = new THREE.Group(), spin = new THREE.Group()
  const holder = new THREE.Group()
  holder.add(glass, collar, cap, ring)
  spin.add(holder)
  root.add(spin)
  const b = {
    root, spin, holder, real: false, capNode: null, juiceMat: null,
    charge: (k) => { gold.emissive.setRGB(0.6 * k, 0.35 * k, 0.1 * k) },
    capOpen: () => {},
  }
  return b
}

// le vrai flacon de WP1 (perfume.glb) avec des matériaux simples de banc d'essai (le rendu final est celui de WP3) :
// jus cobalt, verre clair, or ; le bouchon se gare à droite pendant la vaporisation
async function loadRealBottle(bottle, loader) {
  const [gltf, meta] = await Promise.all([loader.loadAsync('/majorelle/perfume.glb'), loadJson('/majorelle/perfume_meta.json')])
  if (!gltf || !meta) return false
  const H = meta.height || 0.126
  const norm = new THREE.Group()
  norm.scale.setScalar(1 / H)
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.16, envMapIntensity: 1.4 })
  const capMat = goldMat.clone(); capMat.roughness = 0.1
  const juiceMat = new THREE.MeshStandardMaterial({ color: 0x2445d9, roughness: 0.12, metalness: 0, emissive: 0x0b1d6e, emissiveIntensity: 1 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f6ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.6, clearcoat: 1 })
  let capNode = null
  gltf.scene.traverse((o) => {
    if (o.name === 'PB_Cap') capNode = o
    if (!o.isMesh) return
    const n = o.name
    if (n.startsWith('PB_ReflProxy')) { o.visible = false; return }
    if (n.startsWith('PB_Juice')) { o.material = juiceMat; o.renderOrder = 0.5 }
    else if (n.startsWith('PB_Glass')) { o.material = glassMat; o.renderOrder = 11.5 }
    else if (n.startsWith('PB_Cap')) o.material = capMat
    else if (n.startsWith('PB_Gold')) o.material = goldMat
  })
  norm.add(gltf.scene)
  bottle.spin.remove(bottle.holder)
  bottle.spin.add(norm)
  bottle.holder = norm
  bottle.real = true
  bottle.capNode = capNode
  bottle.juiceMat = juiceMat
  const seat = capNode ? capNode.position.clone() : new THREE.Vector3(0, 0.095, 0)
  bottle.charge = (k) => { juiceMat.emissive.setRGB(0.043 + 0.55 * k, 0.114 + 0.33 * k, 0.43 - 0.2 * k) }
  // bouchon garé (courbe de hero.js : levé puis posé à +0,40 x / +0,55 y en hauteurs normalisées)
  bottle.capOpen = (open) => { if (capNode) { if (open) capNode.position.set(0.40 * H, 0.55 * H, 0); else capNode.position.copy(seat) } }
  return true
}

export default function NotesFxTest() {
  const mountRef = useRef(null)
  const apiRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [info, setInfo] = useState('')
  const [assets, setAssets] = useState('')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    const qs = new URLSearchParams(window.location.search)
    const manual = qs.get('manual') === '1'
    const quality = qs.get('q') || 'high'

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
    controls.enableDamping = true
    const setCam = (name) => {
      const c = CAMS[name] || CAMS.default
      camera.position.fromArray(c.p); controls.target.fromArray(c.t); controls.update()
    }
    const camQ = qs.get('cam')
    if (camQ) { camera.position.fromArray(camQ.split(',').map(Number)); controls.target.fromArray(CAMS.default.t) } else setCam(qs.get('view') || 'default')
    controls.update()

    new RGBELoader().load('/hdr/photo_studio_01_1k.hdr', (hdr) => {
      const pmrem = new THREE.PMREMGenerator(renderer)
      hdr.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      hdr.dispose(); pmrem.dispose()
    }, undefined, () => {})

    const anchor = new THREE.Group(); scene.add(anchor)
    anchor.add(new THREE.AmbientLight(0xffffff, 0.25))
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.4, 0.6, 1.2); anchor.add(key, key.target)
    const markerTex = new THREE.TextureLoader().load(`${BASE}/marker_door_2k.png`)
    markerTex.colorSpace = THREE.SRGBColorSpace
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 2400 / 1792), new THREE.MeshBasicMaterial({ map: markerTex, depthWrite: false, toneMapped: false }))
    marker.renderOrder = -2
    anchor.add(marker)

    // flacon factice (pose vitrine : outPos, 0,40 ; « aside » 0,36 décalé, lacet −25° ; finale lacet −35°)
    const bottle = makePlaceholderBottle()
    anchor.add(bottle.root)
    const poses = {
      finale: { p: OUT_POS.clone(), s: 0.4, yaw: PB_CFG.sprayYawDeg },
      aside: { p: OUT_POS.clone().add(new THREE.Vector3(PB_CFG.aside.dx, PB_CFG.aside.dy, 0)), s: PB_CFG.aside.scale, yaw: PB_CFG.aside.yawDeg },
      face: { p: OUT_POS.clone(), s: 0.4, yaw: 0 },
    }
    let pose = 'aside'
    const applyPose = (name) => {
      pose = name
      const P = poses[name]
      bottle.root.position.copy(P.p); bottle.root.scale.setScalar(P.s); bottle.spin.rotation.y = THREE.MathUtils.degToRad(P.yaw)
      bottle.capOpen(name === 'finale')
      bottle.root.updateMatrixWorld(true)
    }
    applyPose('aside')
    let nozzleLocal = new THREE.Vector3(0, 0.0995 / 0.126, 0.0055 / 0.126)
    loadJson('/majorelle/perfume_meta.json').then((m) => { if (m && m.nozzle && m.height) nozzleLocal = new THREE.Vector3(m.nozzle[0] / m.height, m.nozzle[1] / m.height, m.nozzle[2] / m.height) })
    const tmpW = new THREE.Vector3(), tmpQ = new THREE.Quaternion()
    const nozzleAnchor = (out) => { bottle.root.updateMatrixWorld(true); bottle.spin.localToWorld(out.copy(nozzleLocal)); return anchor.worldToLocal(out) }
    const sprayDirAnchor = (out) => { bottle.spin.getWorldQuaternion(tmpQ); out.set(0, 0, 1).applyQuaternion(tmpQ); anchor.getWorldQuaternion(tmpQ); return out.applyQuaternion(tmpQ.invert()).normalize() }
    const centerAnchor = (out) => { bottle.root.updateMatrixWorld(true); bottle.spin.localToWorld(out.set(0, 0.42, 0)); return anchor.worldToLocal(out) }

    // ---- splash : petit ordonnanceur (mêmes règles que fx.splash de WP4, pour le banc) ----------
    let water = null, notes = null, sillage = null, mixer = null, gardenRoot = null, meta = null
    const splashLog = []
    let clock = 0
    const pendingKoi = []
    const fxSplash = (p, k, { priority = 'normal', koi = null } = {}) => {
      const R = PB_CFG.splash
      const recent = splashLog.filter((t) => clock - t.t < R.window)
      const last = splashLog.length ? splashLog[splashLog.length - 1] : null
      const gap = last ? clock - last.t : 99
      const ok = recent.length < R.maxInWindow && gap >= (k >= R.bigK ? R.bigGap : R.smallGap) && (!last || last.k < R.bigK || gap >= R.bigGap)
      if (!ok) { console.info('[test-notes] splash refusé', priority, k.toFixed(2)); return 'dropped' }
      splashLog.push({ t: clock, k })
      if (water) water.splash(new THREE.Vector3(p.x, p.y ?? 0, p.z), k)
      if (koi) pendingKoi.push(koi)
      return 'done'
    }

    // ---- séquenceur ----------------------------------------------------------------------------
    let seq = []
    const run = (steps) => { for (const s of steps) seq.push({ t: clock + s.t, fn: s.fn }) }

    // points de départ de l'ambre : sur les battants ouverts (boîtes englobantes → repère de l'ancre)
    let leafPts = []
    let doorRoot = null
    const computeLeafPoints = () => {
      if (!doorRoot) return
      leafPts = []
      const box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3()
      doorRoot.updateMatrixWorld(true)
      doorRoot.traverse((o) => {
        if (!o.isMesh || !/door_?[lr]/i.test(o.name)) return
        box.setFromObject(o); box.getCenter(c); box.getSize(sz)
        for (const f of [0.25, 0.45, 0.65, 0.82]) {
          const p = new THREE.Vector3(c.x, box.min.y + sz.y * f, c.z)
          leafPts.push(anchor.worldToLocal(p))
        }
      })
      if (!leafPts.length) { // repli : bords de l'embrasure
        for (const sx of [-1, 1]) for (const f of [0.25, 0.5, 0.75]) leafPts.push(new THREE.Vector3(DOOR.seamX + sx * DOOR.halfW * 0.85, DOOR.y0 + (DOOR.y1 - DOOR.y0) * f, -0.08))
      }
    }

    // ---- actions ------------------------------------------------------------------------------
    const L = new THREE.Vector3(...PB_CFG.notes.lily.at)
    const actions = {
      neroli: () => notes && notes.neroli.fire({
        area: PB_CFG.notes.neroli.area, spawnY: PB_CFG.notes.neroli.spawnY, count: PB_CFG.notes.neroli.count,
        onLand: (i, p) => { if (i < 2) fxSplash(p, 0.25, { priority: 'low' }) },
      }),
      lily: () => {
        if (!notes) return
        notes.lily.rise(L, {
          onSurface: (p) => fxSplash(p, 0.45, { koi: { point: L.clone(), seconds: 9 } }),
          onOpen: () => console.info('[test-notes] nymphéa ouvert'),
        })
        run([{ t: 0.6, fn: () => water && water.setEnergy(1) }, { t: 2.2, fn: () => water && water.setEnergy(0.75) }])
      },
      amber: () => {
        if (!notes) return
        computeLeafPoints()
        notes.amber.fire({
          fromAnchor: leafPts, toAnchorFn: (out) => centerAnchor(out), dur: 1.6,
          // le soleil ambré reste dans le jus (perfume.setCharge(1, 1.2) côté directeur)
          onAbsorbed: () => { for (let k = 1; k <= 12; k++) run([{ t: k * 0.1, fn: () => bottle.charge(k / 12) }]) },
        })
      },
      reprise: () => notes && notes.neroli.reprise(6),
      amberReprise: () => notes && notes.amber.reprise(16),
      pulse: () => notes && notes.lily.pulse(),
      closeLily: () => notes && notes.lily.close(1.0),
      spray: (hold = 0.6) => { if (!sillage) return; applyPose('finale'); sillage.spray({ nozzle: nozzleAnchor(new THREE.Vector3()), dir: sprayDirAnchor(new THREE.Vector3()), hold }) },
      pour: () => sillage && sillage.pourToDoor({ onCross: () => console.info('[test-notes] onCross (ripple.fire)') }),
      arch: () => sillage && sillage.traceArch({ dur: 1.2, onDone: () => console.info('[test-notes] arc tracé') }),
      rain: () => sillage && sillage.rain({
        landings: PB_CFG.rain.map((p) => new THREE.Vector3(...p)), spacing: PB_CFG.rainSpacing,
        onLand: (i, p) => { console.info('[test-notes] onLand', i, p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)); fxSplash(p, 0.5) },
      }),
      veil: () => sillage && sillage.veil(0.12, 0.8, camera),
      // finale §5.4, t = 0 au premier geste de vaporisation
      finale: (hold = 0.6) => {
        applyPose('finale')
        run([
          { t: 0.45, fn: () => { actions.spray(hold); actions.veil() } },
          { t: 1.2, fn: actions.pour },
          { t: 2.3, fn: actions.arch },
          { t: 3.5, fn: actions.rain },
          { t: 3.6, fn: () => notes && notes.neroli.reprise(6) },
          { t: 3.9, fn: () => { if (water) { water.setEnergy(1); water.koi.setActivity(1.4); water.koi.gather(new THREE.Vector3(0, 0, -3.2), 8) } } },
          { t: 4.3, fn: () => notes && notes.lily.pulse() },
          { t: 5.6, fn: () => water && water.setEnergy(0.75) },
          { t: 5.0, fn: () => applyPose('face') },
        ])
      },
      // mini-vaporisation (signée) : pschitt, aspiration, un seul impact
      mini: () => {
        applyPose('finale')
        actions.spray(0.6)
        run([
          { t: 0.75, fn: () => sillage && sillage.pourToDoor({ dur: 0.9 }) },
          { t: 1.7, fn: () => sillage && sillage.rain({ landings: [new THREE.Vector3(-0.05, 0, -2.6)], onLand: (i, p) => fxSplash(p, 0.4) }) },
        ])
      },
      clear: () => { notes && notes.clear(); sillage && sillage.clear(); seq = []; bottle.charge(0) },
      quality: (q) => { notes && notes.setQuality(q); sillage && sillage.setQuality(q) },
      pose: (n) => applyPose(n),
      cam: (n) => setCam(n),
    }

    // ---- chargement ----------------------------------------------------------------------------
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    let bottleKind = 'factice'
    const realBottleP = qs.get('dummy') === '1' ? Promise.resolve(false)
      : loadRealBottle(bottle, loader).then((ok) => { if (ok) { bottleKind = 'perfume.glb'; applyPose(pose) } return ok }).catch((e) => { console.warn('[test-notes] perfume.glb', e); return false })
    let archLine = null
    Promise.all([
      pickMajorelleInterior(BASE),
      loader.loadAsync(`${BASE}/mj_door.glb`),
      loadReflectionProbes(`${BASE}/fx/`).catch(() => null),
      loadTex(`${TEX}T_PB_petals.png`), loadTex(`${TEX}T_PB_sillage.png`), loadJson(`${TEX}door_arch_path.json`), realBottleP,
    ]).then(async ([pick, door, probes, petals, atlas, archPath]) => {
      if (disposed) return
      if (!pick) throw new Error('interior.json introuvable')
      meta = pick.meta
      const interior = (await loader.loadAsync(pick.glbUrl)).scene
      if (disposed) return
      applyMajorelleMaterials(interior, meta, BASE)
      door.scene.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
      doorRoot = door.scene
      anchor.add(interior, door.scene)
      // porte grande ouverte
      mixer = new THREE.AnimationMixer(door.scene)
      const clip = THREE.AnimationClip.findByName(door.animations, 'DoorOpen') || door.animations[0]
      if (clip) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.time = clip.duration; mixer.update(0); a.paused = true }

      gardenRoot = new THREE.Group()
      gardenRoot.position.set(meta.X_OFF, meta.Z_OFF, 0)
      gardenRoot.scale.setScalar(meta.K)
      anchor.add(gardenRoot)
      water = createGardenFX({ parent: gardenRoot, sunDir: SUN_DIR.clone(), reflectionCube: probes, energy: 0.75 })

      notes = createNotesFX({ gardenRoot, anchor, gardenMeta: meta, textures: { petals }, quality, sunDir: SUN_DIR, water })
      sillage = createSillage({ anchor, gardenRoot, gardenMeta: meta, door: DOOR, archPath, atlas, quality })

      // chemin réel de l'arc en ligne de debug (tel que publié, ou le repli)
      const raw = sillage.arch.raw, z = sillage.arch.z + 0.0005
      const lg = new THREE.BufferGeometry().setFromPoints(raw.map(([x, y]) => new THREE.Vector3(x, y, z)))
      archLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff2bd6, depthTest: false, transparent: true, opacity: 0.85, toneMapped: false }))
      archLine.renderOrder = 40
      archLine.visible = qs.get('archline') === '1'
      anchor.add(archLine)

      setAssets(`pétales : ${petals ? 'T_PB_petals.png' : 'repli procédural'} · atlas : ${atlas ? 'T_PB_sillage.png' : 'repli procédural'} · arc : ${archPath ? 'door_arch_path.json' : 'repli (door_outline lissé)'} · flacon : ${bottleKind}`)
      setStatus('Prêt')
      renderer.compile(scene, camera)
      window.__nf.ready = true
    }).catch((e) => { console.error('[test-notes]', e); setStatus('Erreur de chargement') })

    // ---- boucle --------------------------------------------------------------------------------
    // écart max entre le centre du ruban et le chemin publié (exigence ≤ 3 mm de marqueur)
    const archCheck = () => {
      if (!sillage) return null
      const raw = sillage.arch.raw, R = sillage.arch.ribbon
      let worst = 0
      for (let i = 0; i < R.length / 3; i++) {
        const x = R[i * 3], y = R[i * 3 + 1]
        let best = Infinity
        for (let j = 0; j < raw.length - 1; j++) {
          const [ax, ay] = raw[j], [bx, by] = raw[j + 1]
          const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-12
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2))
          best = Math.min(best, Math.hypot(x - ax - vx * t, y - ay - vy * t))
        }
        worst = Math.max(worst, best)
      }
      return { maxDevMarker: worst, maxDevMm: worst * 1000, points: raw.length, fallback: sillage.arch.fallback }
    }
    const stats = () => ({
      notes: notes?.stats(), sillage: sillage?.stats(), water: water?.stats?.(),
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs?.length,
    })
    const step = (dt = 1 / 30) => {
      clock += dt
      const due = seq.filter((s) => s.t <= clock); seq = seq.filter((s) => s.t > clock)
      due.sort((a, b) => a.t - b.t).forEach((s) => s.fn())
      if (mixer) mixer.update(0)
      if (water) {
        water.update(dt, camera)
        while (pendingKoi.length) { const k = pendingKoi.shift(); water.koi.gather(k.point, k.seconds) } // annule le rassemblement auto
      }
      if (notes) notes.update(dt, camera)
      if (sillage) sillage.update(dt, camera)
      controls.update()
      renderer.render(scene, camera)
    }
    let last = performance.now(), raf = null, frame = 0
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now
      if (window.__nf.manual) { controls.update(); renderer.render(scene, camera); return }
      step(dt)
      if (++frame % 15 === 0) {
        const s = stats()
        setInfo(`calls ${s.calls} · tris ${s.tris} · notes ${s.notes ? `${s.notes.drawCalls} dc / ${s.notes.triangles} t / ${s.notes.points} pts` : '–'} · sillage ${s.sillage ? `${s.sillage.drawCalls} dc / ${s.sillage.points} pts` : '–'}`)
      }
    }
    window.__nf = {
      manual, ready: false, scene, camera, controls, renderer, anchor, bottle, actions, run, step, stats, archCheck, setCam,
      get notes() { return notes }, get sillage() { return sillage }, get water() { return water }, get gardenRoot() { return gardenRoot },
      get archLine() { return archLine }, get leafPts() { return leafPts }, splashLog,
    }
    apiRef.current = actions
    tick()

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      notes?.dispose(); sillage?.dispose(); water?.dispose?.()
      controls.dispose(); renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  const A = (k, ...args) => () => apiRef.current && apiRef.current[k](...args)
  const btn = { background: 'rgba(0,0,0,0.55)', color: CREAM, border: `1px solid ${GOLD}88`, borderRadius: 999, padding: '7px 11px', fontSize: 10, letterSpacing: '0.14em', margin: 3, cursor: 'pointer' }
  const row = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Didot', Georgia, serif", fontSize: 11, letterSpacing: '0.42em', paddingLeft: '0.42em', color: GOLD }}>BLEU INTERDIT · NOTES &amp; SILLAGE</div>
        <div style={{ color: CREAM, fontSize: 10, letterSpacing: '0.1em', marginTop: 6, opacity: 0.8 }}>{status} · {assets}</div>
        <div style={{ color: CREAM, fontSize: 10, letterSpacing: '0.06em', marginTop: 4, opacity: 0.7 }}>{info}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10 }}>
        <div style={row}>
          <button style={btn} onClick={A('neroli')}>I · NÉROLI</button>
          <button style={btn} onClick={A('lily')}>II · NYMPHÉA</button>
          <button style={btn} onClick={A('amber')}>III · AMBRE</button>
          <button style={btn} onClick={A('reprise')}>REPRISE ×6</button>
          <button style={btn} onClick={A('pulse')}>PULSE</button>
          <button style={btn} onClick={A('closeLily')}>FERMER LYS</button>
        </div>
        <div style={row}>
          <button style={btn} onClick={A('finale')}>SILLAGE ▶</button>
          <button style={btn} onClick={A('finale', 1.4)}>NUAGE 1,4 s ▶</button>
          <button style={btn} onClick={A('spray')}>SPRAY</button>
          <button style={btn} onClick={A('pour')}>PORTE</button>
          <button style={btn} onClick={A('arch')}>ARC</button>
          <button style={btn} onClick={A('rain')}>PLUIE</button>
          <button style={btn} onClick={A('veil')}>VOILE</button>
          <button style={btn} onClick={A('mini')}>MINI</button>
        </div>
        <div style={row}>
          <button style={btn} onClick={A('clear')}>EFFACER</button>
          <button style={btn} onClick={A('quality', 'high')}>HIGH</button>
          <button style={btn} onClick={A('quality', 'medium')}>MED</button>
          <button style={btn} onClick={A('quality', 'low')}>LOW</button>
          <button style={btn} onClick={() => { const l = window.__nf?.archLine; if (l) l.visible = !l.visible }}>LIGNE ARC</button>
          <button style={btn} onClick={A('cam', 'default')}>CAM</button>
          <button style={btn} onClick={A('cam', 'pool')}>BASSIN</button>
          <button style={btn} onClick={A('cam', 'garden')}>JARDIN</button>
          <button style={btn} onClick={A('pose', 'aside')}>ASIDE</button>
          <button style={btn} onClick={A('pose', 'finale')}>FINALE</button>
        </div>
      </div>
    </div>
  )
}
