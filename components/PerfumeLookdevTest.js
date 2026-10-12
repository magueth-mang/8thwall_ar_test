'use client'

// Banc de look-dev du flacon « BLEU INTERDIT » (lib/majorelle/perfume.js + perfumeShaders.js ; SPEC_PERFUME §2.4, §3, WP3).
//
// Vues :
//   showcase  : l'affiche scannée + la cour derrière la porte ouverte, flacon en outPos (0,40), uOutside = 1
//   courtyard : flacon en vol stationnaire au-dessus du bassin (E_h, 0,21), uOutside = 0, découpe à la ligne d'eau
//   lying     : le dormeur au fond du bassin (B₀, φ −90°), lueur 0,35
//   ref       : planche studio « Cycles » (3 flacons face / 3/4 / profil devant un carton bleu Majorelle, caméra
//               85 mm de renders/perfume_v1.png) pour comparer côte à côte
//
// Paramètres d'URL : ?view=showcase|courtyard|lying|ref  ?q=high|medium|low  ?cam=x,y,z (marqueur)  ?garden=0
//                    ?panel=0  ?dpr=2  ?spin=1 (plateau tournant)
// window.__pf = { perfume, step(dt, n), setView(v), refs, renderer, scene, camera, ... }

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createPerfume, makeStudioCube, loadPerfumeTextures } from '@/lib/majorelle/perfume'
import { PB_CFG } from '@/lib/majorelle/perfumeConfig'
import { pickMajorelleInterior, applyMajorelleMaterials, gardenToMarker } from '@/lib/majorelle/interior'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'

const DOOR = { seamX: 0.004464, y0: -0.532366, y1: 0.248326 }
const DOOR_MID_Y = (DOOR.y0 + DOOR.y1) / 2
const OUT_POS = new THREE.Vector3(DOOR.seamX, DOOR_MID_Y + 0.02 - PB_CFG.heroOut / 2, 0.22)
const MARKER_ASPECT = 2400 / 1792
const GM_DEFAULT = { K: 0.3002661401098901, X_OFF: 0.005859375, Z_OFF: -0.5323660714285714 }
const SUN_DIR = new THREE.Vector3(-0.52, 0.76, 0.38).normalize()
const VIEWS = ['showcase', 'courtyard', 'lying', 'ref']

// carton bleu de la planche studio (échantillonné sur renders/perfume_v1.png : haut #2B49EB → horizon #7684FB → sol #5A6AF5)
function makeRefCard() {
  const W = 256, Hh = 343
  const c = document.createElement('canvas'); c.width = W; c.height = Hh
  const g = c.getContext('2d')
  const img = g.createImageData(W, Hh)
  // le carton est le plan de l'affiche (1 × 1,3393 m) centré à y = 0,062 m ; l'horizon du sol est à y ≈ 0
  for (let j = 0; j < Hh; j++) {
    const y = (0.5 - j / (Hh - 1)) * MARKER_ASPECT + 0.062 // m, 0 = sol
    let r, gg, b
    if (y > 0.0) { // mur : du bleu profond vers la lueur de l'horizon
      const k = Math.min(1, y / 0.16)
      r = 118 + (43 - 118) * Math.pow(k, 0.8); gg = 132 + (73 - 132) * Math.pow(k, 0.8); b = 251 + (235 - 251) * k
    } else {
      const k = Math.min(1, -y / 0.12)
      r = 118 + (88 - 118) * k; gg = 132 + (104 - 132) * k; b = 251 + (245 - 251) * k
    }
    for (let i = 0; i < W; i++) {
      const x = (i / (W - 1) - 0.5)
      const vig = 1 - 0.35 * Math.pow(Math.abs(x) / 0.5, 2) * (y > 0 ? Math.min(1, y / 0.1) : 0.3)
      const o = (j * W + i) * 4
      img.data[o] = r * vig; img.data[o + 1] = gg * vig; img.data[o + 2] = b * (0.85 + 0.15 * vig); img.data[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function contactShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(0,0,30,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,30,0.18)'); gr.addColorStop(1, 'rgba(0,0,30,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export default function PerfumeLookdevTest() {
  const mountRef = useRef(null)
  const apiRef = useRef(null)
  const [info, setInfo] = useState('Chargement…')
  const [panel, setPanel] = useState(true)
  const [view, setViewState] = useState('showcase')
  const [vals, setVals] = useState({ dry: 1, fill: 0.96, glow: 0, charge: 0, poster: 1, sigma: 0.03, kr: 0.7, f0: 0.04, satin: 0.55, studio: 1, probe: 1.15, imp: 0.5 })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    let disposed = false
    const qs = new URLSearchParams(window.location.search)
    const num = (k, d) => { const v = parseFloat(qs.get(k)); return Number.isFinite(v) ? v : d }
    if (qs.get('panel') === '0') setPanel(false)
    const useGarden = qs.get('garden') !== '0'
    const quality = ['high', 'medium', 'low'].includes(qs.get('q')) ? qs.get('q') : 'high'

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: qs.get('pdb') === '1' })
    renderer.setPixelRatio(num('dpr', Math.min(window.devicePixelRatio, 2)))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.0
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0807)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    let refFov = false
    const applySize = () => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      if (refFov) { // 85 mm sur capteur 36 mm (ajustement horizontal), comme la caméra Cycles
        const hf = 2 * Math.atan(18 / 85)
        camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / camera.aspect))
      } else {
        camera.fov = camera.aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(45) / 2) / camera.aspect)) : 45
      }
      camera.updateProjectionMatrix()
    }
    applySize()

    // ---- scène : ancre (affiche + cour) ----------------------------------------------------------------------
    const anchor = new THREE.Group(); scene.add(anchor)
    const ambient = new THREE.AmbientLight(0xffffff, 0.18); scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 2.2), rim = new THREE.DirectionalLight(0xffeedd, 3.4), fill = new THREE.DirectionalLight(0xf6f8ff, 0.7)
    ;[key, rim, fill].forEach((l) => scene.add(l, l.target))
    const posterTex = new THREE.TextureLoader().load('/majorelle/marker_door_2k.png'); posterTex.colorSpace = THREE.SRGBColorSpace
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1, MARKER_ASPECT), new THREE.MeshBasicMaterial({ map: posterTex, depthWrite: false, toneMapped: false }))
    poster.renderOrder = -2; anchor.add(poster)
    let gm = GM_DEFAULT, gardenRoot = null, water = null, mixer = null, courtyard = null, door = null

    // ---- planche « ref » (mètres réels, carton = plan marqueur z = 0) ----------------------------------------------
    const refRoot = new THREE.Group(); refRoot.visible = false; scene.add(refRoot)
    const refAnchor = new THREE.Group(); refAnchor.position.set(0, 0.062, -0.38); refRoot.add(refAnchor)
    const cardTex = makeRefCard()
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, MARKER_ASPECT), new THREE.MeshBasicMaterial({ map: cardTex, toneMapped: false, depthWrite: false }))
    card.renderOrder = -2; refAnchor.add(card)
    const shadowTex = contactShadowTexture()
    const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true

    // ---- état du banc ---------------------------------------------------------------------------------------------
    const S = { view: VIEWS.includes(qs.get('view')) ? qs.get('view') : 'showcase', spin: qs.get('spin') === '1', yaw: 0, lying: false, t: 0, swingT: -1, jolt: -1, frames: 0, fpsT: 0, fps: 0, upright: true }
    let perfume = null, refs = [], gltfRef = null, metaRef = null, texRef = null, probesRef = null, studioCube = null
    const hp = new THREE.Vector3(), tmp = new THREE.Vector3(), lightTgt = new THREE.Vector3()
    const E_H = new THREE.Vector3(), B0 = new THREE.Vector3()

    const placeCamera = (v) => {
      const c = qs.get('cam') ? qs.get('cam').split(',').map(Number) : null
      refFov = v === 'ref'
      applySize()
      if (v === 'ref') {
        camera.position.set(0, 0.135, 0.98); controls.target.set(0, 0.062, 0)
      } else if (v === 'showcase') {
        if (c) camera.position.set(c[0], c[1], c[2]); else camera.position.set(0.05, -0.06, 1.15)
        controls.target.copy(OUT_POS).setY(OUT_POS.y + PB_CFG.heroOut * 0.5)
      } else if (v === 'courtyard') {
        gardenToMarker(gm, 0, 0.14 + 0.35, -2.80, controls.target)
        if (c) camera.position.set(c[0], c[1], c[2]); else camera.position.copy(controls.target).add(tmp.set(0.08, 0.04, 0.55))
      } else {
        gardenToMarker(gm, 0, -0.2, -2.80, controls.target)
        if (c) camera.position.set(c[0], c[1], c[2]); else camera.position.set(0.05, -0.04, 2.0)
      }
      camera.near = v === 'ref' ? 0.01 : 0.005
      controls.update()
    }

    const applyPose = (p) => {
      if (!p) return
      const v = S.view
      p.root.rotation.set(0, 0, 0)
      if (v === 'showcase') {
        p.root.position.copy(OUT_POS); p.root.scale.setScalar(PB_CFG.heroOut)
        if (S.lying) p.root.rotation.z = -Math.PI / 2
      } else if (v === 'courtyard' || v === 'lying') {
        const lying = v === 'lying' || S.lying
        let phi = lying ? -Math.PI / 2 : 0
        let bx = lying ? PB_CFG.lying.base[0] : 0, by = lying ? PB_CFG.lying.base[1] : PB_CFG.hoverBaseY
        if (S.swingT >= 0) { // balancement « battant de porte » : φ −90° → 0, B₀ → B₁ puis vol stationnaire
          const k = Math.min(1, S.swingT / PB_CFG.swingDur)
          const e = 0.5 - 0.5 * Math.cos(Math.PI * k)
          phi = -Math.PI / 2 * (1 - e)
          const c3 = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
          bx = PB_CFG.lying.base[0] + (PB_CFG.preLift.base[0] - PB_CFG.lying.base[0]) * c3
          by = PB_CFG.lying.base[1] + (PB_CFG.preLift.base[1] - PB_CFG.lying.base[1]) * c3
          const l = Math.max(0, Math.min(1, (S.swingT - PB_CFG.swingDur) / PB_CFG.liftDur))
          if (l > 0) { const el = 1 - Math.pow(1 - l, 3); by += (PB_CFG.hoverBaseY - PB_CFG.preLift.base[1]) * el; bx *= 1 - el }
        }
        gardenToMarker(gm, bx, by, PB_CFG.E[2], p.root.position)
        p.root.rotation.z = phi
        p.root.scale.setScalar(PB_CFG.heroInGarden)
      }
      p.spin.rotation.y = S.yaw
      if (S.jolt >= 0) { // secousse : 1 cm vers l'avant puis arrêt sec (ballottement + heurtoir)
        const t = S.jolt
        p.root.position.z += (t < 0.12 ? Math.sin((t / 0.12) * Math.PI * 0.5) : 1) * 0.02 * p.root.scale.x * 4
      }
    }

    const setLights = () => {
      const out = S.view === 'showcase' || S.view === 'ref'
      const target = lightTgt
      if (S.view === 'ref') target.set(0, 0.062, 0)
      else if (perfume) { perfume.root.getWorldPosition(target); target.y += perfume.root.scale.y * 0.5 } else target.set(0, 0, 0)
      ;[key, rim, fill].forEach((l) => l.target.position.copy(target))
      if (out) {
        key.position.copy(target).add(hp.set(0.35, 0.9, 0.7)); rim.position.copy(target).add(hp.set(-0.2, 0.5, -0.9)); fill.position.copy(target).add(hp.set(-0.6, -0.1, 0.5))
        key.color.set(0xffffff); rim.color.set(0xffeedd); key.intensity = 2.2; rim.intensity = 3.4; fill.intensity = 0.7
      } else {
        key.position.copy(target).addScaledVector(SUN_DIR, 1); rim.position.copy(target).add(hp.set(0.3, 0.6, -0.8)); fill.position.copy(target).add(hp.set(0, -0.6, 0.4))
        key.color.set(0xfff0d8); rim.color.set(0xcfe0ff); key.intensity = 3.0; rim.intensity = 1.6; fill.intensity = 0.9
      }
    }

    const lookFor = (p, v) => {
      if (!p) return
      if (v === 'showcase' || v === 'ref') { p.setOutside(1, 0); p.setGardenMix(v === 'ref' ? 0 : 0.35, 0); p.setClip(false); p.setGlow(0, 0) }
      else { p.setOutside(0, 0); p.setGardenMix(1, 0); p.setClip(true); p.setGlow(v === 'lying' ? 0.35 : 0, 0) }
      if (v === 'lying') p.setWet(1)
    }

    const setView = (v) => {
      if (!VIEWS.includes(v)) return
      S.view = v; setViewState(v)
      S.swingT = -1
      anchor.visible = v !== 'ref'
      refRoot.visible = v === 'ref'
      scene.background = new THREE.Color(v === 'ref' ? 0x5a6af5 : 0x0a0807)
      if (v === 'ref') ensureRefs()
      if (perfume) { perfume.root.visible = v !== 'ref'; lookFor(perfume, v) }
      refs.forEach((p) => lookFor(p, 'ref'))
      placeCamera(v)
    }

    const ensureRefs = () => {
      if (refs.length || !gltfRef) return
      const yaws = [0, 34, 90], xs = [-0.118, 0, 0.118]
      for (let i = 0; i < 3; i++) {
        const g = { scene: gltfRef.scene.clone(true) }
        const p = createPerfume(g, { meta: metaRef, textures: texRef, probes: probesRef, studioCube, gardenMeta: gm, lights: { key, rim }, quality })
        p.U.uPoster.value = cardTex; p.U.uDoorMask.value = blackTex
        p.root.position.set(xs[i], -0.062, 0.38) // repère refAnchor : carton en z = 0, sol en y = −0,062
        p.root.scale.setScalar(metaRef.height)
        p.spin.rotation.y = THREE.MathUtils.degToRad(yaws[i])
        refAnchor.add(p.root)
        const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.06), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }))
        sh.rotation.x = -Math.PI / 2; sh.position.set(xs[i], -0.0615, 0.38); sh.renderOrder = -1
        refAnchor.add(sh)
        lookFor(p, 'ref')
        refs.push(p)
      }
      if (apiRef.current) apiRef.current.refs = refs
    }

    // ---- chargement ------------------------------------------------------------------------------------------------
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej))
    const hdrP = new Promise((res) => new RGBELoader().load('/hdr/photo_studio_01_1k.hdr', res, undefined, () => res(null)))
    const gardenP = useGarden ? Promise.all([
      pickMajorelleInterior('/majorelle').then(async (pick) => (pick ? { meta: pick.meta, gltf: await load(pick.glbUrl) } : null)).catch(() => null),
      load('/majorelle/mj_door.glb').catch(() => null),
    ]) : Promise.resolve([null, null])
    Promise.all([
      load(PB_CFG.bottleUrl),
      fetch(PB_CFG.metaUrl).then((r) => r.json()),
      loadPerfumeTextures(PB_CFG.texBase),
      loadReflectionProbes('/majorelle/fx/', ['pool']).catch(() => ({})),
      hdrP,
      gardenP,
    ]).then(([gltf, meta, tex, probes, hdr, [gi, gd]]) => {
      if (disposed) return
      if (hdr) {
        hdr.mapping = THREE.EquirectangularReflectionMapping
        const pmrem = new THREE.PMREMGenerator(renderer)
        scene.environment = pmrem.fromEquirectangular(hdr).texture
        pmrem.dispose()
        studioCube = makeStudioCube(renderer, hdr, 256)
        hdr.dispose()
      }
      if (gi) {
        gm = { K: gi.meta.K, X_OFF: gi.meta.X_OFF, Z_OFF: gi.meta.Z_OFF }
        applyMajorelleMaterials(gi.gltf.scene, gi.meta, '/majorelle')
        courtyard = gi.gltf.scene
        anchor.add(courtyard)
        gardenRoot = new THREE.Group()
        gardenRoot.position.set(gm.X_OFF, gm.Z_OFF, 0); gardenRoot.scale.setScalar(gm.K)
        anchor.add(gardenRoot)
        water = createGardenFX({ parent: gardenRoot, sunDir: SUN_DIR.clone(), reflectionCube: probes, energy: 0.75 })
      }
      if (gd) {
        door = gd.scene
        door.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
        anchor.add(door)
        mixer = new THREE.AnimationMixer(door)
        const clip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
        if (clip) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.time = clip.duration; a.paused = true; mixer.update(0) }
      }
      gltfRef = gltf; metaRef = meta; texRef = tex; probesRef = probes
      gardenToMarker(gm, 0, PB_CFG.hoverBaseY, PB_CFG.E[2], E_H)
      gardenToMarker(gm, ...PB_CFG.lying.base, B0)
      const g0 = { scene: gltf.scene.clone(true) }
      perfume = createPerfume(g0, { meta, textures: tex, probes, studioCube, gardenMeta: gm, lights: { key, rim }, quality, anchor, gardenRoot })
      anchor.add(perfume.root)
      perfume.setFill(meta.cavity?.fillFraction ?? 0.96)
      setView(S.view)
      S.ready = true
    }).catch((e) => { console.error('[perfume lookdev] chargement', e); setInfo('Erreur de chargement : ' + e.message) })

    // ---- boucle -----------------------------------------------------------------------------------------------------
    const ctx = { camera, anchor, gardenRoot: null }
    const refCtx = { camera, anchor: refAnchor, gardenRoot: null }
    let frame = 0
    const step = (dt) => {
      S.t += dt
      if (S.spin) S.yaw = Math.sin(S.t * (Math.PI * 2 / 6)) * THREE.MathUtils.degToRad(S.view === 'ref' ? 0 : 10)
      if (S.swingT >= 0) S.swingT = Math.min(S.swingT + dt, PB_CFG.swingDur + PB_CFG.liftDur) // reste en vol stationnaire à la fin
      if (S.jolt >= 0) { S.jolt += dt; if (S.jolt > 1.5) S.jolt = -1 }
      mixer?.update(0)
      if (water) water.update(dt, camera)
      if (perfume && S.view !== 'ref') {
        applyPose(perfume)
        setLights()
        ctx.gardenRoot = gardenRoot
        perfume.update(dt, ctx)
      }
      if (S.view === 'ref') {
        setLights()
        refs.forEach((p) => p.update(dt, refCtx))
      }
      controls.update()
      renderer.render(scene, camera)
      S.frames++
      if ((frame++ & 15) === 0 && perfume) {
        const st = S.view === 'ref' && refs[0] ? refs[0].stats() : perfume.stats()
        setInfo(`${S.view} · ${perfume.quality} · flacon ${st.drawCalls} appels / ${st.triangles} tris · scène ${renderer.info.render.calls} appels / ${renderer.info.render.triangles} tris · programmes ${renderer.info.programs.length} · ${S.fps} ips`)
      }
    }
    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now
      S.fpsT += dt; if (S.fpsT > 1) { S.fps = Math.round(S.frames / S.fpsT); S.frames = 0; S.fpsT = 0 }
      if (!S.paused) step(dt)
    }
    tick()
    window.addEventListener('resize', applySize)

    const api = {
      get perfume() { return perfume }, refs, renderer, scene, camera, controls, anchor, S,
      step: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) step(dt) },
      setView,
      ready: () => !!S.ready,
      pause: (b = true) => { S.paused = !!b }, // pilotage déterministe : seule step() avance le temps
      swing: () => { if (S.view === 'showcase' || S.view === 'ref') setView('courtyard'); S.swingT = 0; perfume?.setWet(1); perfume?.setSheet(true); setTimeout(() => perfume?.setSheet(false), 2200) },
      jolt: () => { S.jolt = 0 },
      setLying: (b) => { S.lying = !!b; S.swingT = -1 },
      setSpin: (b) => { S.spin = !!b; if (!b) S.yaw = 0 },
      setYaw: (deg) => { S.spin = false; S.yaw = THREE.MathUtils.degToRad(deg) },
      all: (fn) => { if (perfume) fn(perfume); refs.forEach(fn) },
      info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs.length, stats: perfume?.stats() }),
    }
    apiRef.current = api
    window.__pf = api

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', applySize)
      perfume?.dispose(); refs.forEach((p) => p.dispose())
      water?.dispose?.()
      controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
      if (window.__pf === api) delete window.__pf
    }
  }, [])

  const A = () => apiRef.current
  const all = (fn) => A()?.all(fn)
  const set = (k, v, fn) => { setVals((s) => ({ ...s, [k]: v })); all((p) => fn(p, v)) }
  const btn = { pointerEvents: 'auto', background: 'rgba(0,0,0,0.6)', color: '#EFE9DC', border: '1px solid rgba(201,164,92,0.55)', borderRadius: 4, padding: '4px 7px', fontSize: 11, cursor: 'pointer' }
  const row = (label, items) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ color: '#C9A45C', fontSize: 10, letterSpacing: '0.14em', minWidth: 66 }}>{label}</span>
      {items.map(([t, fn, on]) => <button key={t} style={{ ...btn, borderColor: on ? '#E8C77A' : btn.border.split(' ').pop() }} onClick={() => fn(A())}>{t}</button>)}
    </div>
  )
  const slider = (label, k, min, max, stepv, fn) => (
    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#EFE9DC', fontSize: 10 }}>
      <span style={{ minWidth: 66, color: '#C9A45C', letterSpacing: '0.1em' }}>{label}</span>
      <input type="range" min={min} max={max} step={stepv} value={vals[k]} onChange={(e) => set(k, parseFloat(e.target.value), fn)} style={{ width: 130 }} />
      <span style={{ minWidth: 34 }}>{vals[k]}</span>
    </label>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
      {panel && (
        <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 'min(520px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', background: 'rgba(0,0,0,0.42)', padding: 6, borderRadius: 6 }}>
          <div style={{ color: '#E8C77A', fontSize: 11, letterSpacing: '0.22em' }}>BLEU INTERDIT · LOOK-DEV</div>
          {row('VUE', VIEWS.map((v) => [v, (a) => a.setView(v), view === v]))}
          {row('POSE', [['debout', (a) => a.setLying(false)], ['couché', (a) => a.setLying(true)], ['balancier', (a) => a.swing()], ['plateau', (a) => a.setSpin(!a.S.spin)], ['face', (a) => a.setYaw(0)], ['3/4', (a) => a.setYaw(34)], ['profil', (a) => a.setYaw(90)]])}
          {row('NIVEAU', [['high', (a) => a.all((p) => p.setQuality('high'))], ['medium', (a) => a.all((p) => p.setQuality('medium'))], ['low', (a) => a.all((p) => p.setQuality('low'))]])}
          {row('GESTES', [['frapper', (a) => a.all((p) => p.knock())], ['capuchon', (a) => a.all((p) => p.setCapOpen(!p.capOpen))], ['vaporiser', (a) => a.all((p) => { if (!p.capOpen) p.setCapOpen(true); p.pump() })], ['chasse', (a) => a.all((p) => p.glintChase(0.8))], ['éclat 4', (a) => a.all((p) => p.studGlint(4))], ['révéler', (a) => a.all((p) => p.reveal(1.5))]])}
          {row('EAU', [['mouillé', (a) => a.all((p) => p.setWet(1))], ['sécher 6 s', (a) => a.all((p) => p.dry(6))], ['nappe', (a) => a.all((p) => { p.setSheet(true); setTimeout(() => p.setSheet(false), 1500) })], ['impulsion', (a) => a.all((p) => p.impulse({ x: vals.imp, y: vals.imp * 0.5, z: -vals.imp }))], ['secousse', (a) => a.jolt()], ['ride', (a) => a.all((p) => p.meniscusRing(1))]])}
          {slider('sec', 'dry', -0.4, 2, 0.02, (p, v) => { p.uniforms.glass.uDryT.value = v })}
          {slider('remplissage', 'fill', 0.5, 1, 0.01, (p, v) => p.setFill(v))}
          {slider('lueur', 'glow', 0, 1, 0.01, (p, v) => p.setGlow(v, 0))}
          {slider('ambre', 'charge', 0, 1, 0.01, (p, v) => p.setCharge(v, 0))}
          {slider('impulsion', 'imp', 0, 2, 0.05, () => {})}
          {slider('affiche', 'poster', 0.4, 1.6, 0.02, (p, v) => p.U.uPosterGain.value.setScalar(v))}
          {slider('σ verre', 'sigma', 0, 0.12, 0.002, (p, v) => { p.uniforms.glass.uSigmaB.value = v })}
          {slider('kR', 'kr', 0, 1, 0.02, (p, v) => { p.uniforms.glass.uKR.value = v })}
          {slider('F0', 'f0', 0, 0.12, 0.005, (p, v) => { p.uniforms.glass.uF0.value = v })}
          {slider('satin α', 'satin', 0, 1, 0.02, (p, v) => { p.uniforms.glass.uSatinAlpha.value = v })}
          {slider('studio', 'studio', 0, 3, 0.05, (p, v) => { p.U.uStudioGain.value = v })}
          {slider('sonde', 'probe', 0, 3, 0.05, (p, v) => { p.U.uProbeGain.value = v })}
          <div style={{ color: '#EFE9DC', fontSize: 10, opacity: 0.85 }}>{info}</div>
        </div>
      )}
      {!panel && <div style={{ display: 'none' }}>{info}</div>}
    </div>
  )
}
