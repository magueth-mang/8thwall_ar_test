'use client'

// Banc d'essai de lib/majorelle/perfumeUI.js + components/PerfumeOverlay.js (SPEC_PERFUME §5, WP6).
// L'affiche scannée remplace le flux caméra ; la cour bakée (porte ouverte) est chargée derrière, comme
// en vitrine, et un flacon factice (arc outrepassé extrudé aux cotes §2.1, heurtoir, capot) se tient en outPos.
// Un mini « directeur » rejoue le rituel : toucher le flacon = frapper (choc à +0,26 s, note à +1,55 s),
// VAPORISER (toucher / maintenir), RANGER, lunettes allumées = rejouer la note, fantôme à 6 s d'inactivité.
//
// Paramètres d'URL :
//   ?cam=x,y,z   caméra (unités marqueur ; défaut 0.05,-0.04,2.0 = la pose de test par défaut)
//   ?hfov=45     champ horizontal en portrait (défaut 45° : l'affiche occupe ~60 % de la largeur à z = 2,
//                comme sur un téléphone) ; en paysage le champ vertical vaut 45° (&fov=… force le vertical)
//   ?garden=0    sans la cour (affiche seule)      ?panel=0  sans le panneau de boutons
//   ?dpr=3       force le device pixel ratio        ?idle=0   sans fantôme / coups automatiques
// window.__pui = { ui, step(dt), knock(), spray(hold), tapPx(x, y), holdPx(x, y, sec), setView(s), demo(), ... }

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createPerfumeUI } from '@/lib/majorelle/perfumeUI'
import { PB_CFG, PB_COPY } from '@/lib/majorelle/perfumeConfig'
import { pickMajorelleInterior, applyMajorelleMaterials } from '@/lib/majorelle/interior'
import { createGardenFX, loadReflectionProbes } from '@/lib/majorelle/gardenFx'
import { PerfumeOverlay } from '@/components/PerfumeOverlay'

// porte de l'affiche (SPEC_PERFUME, « Units and frames ») et pose de vitrine
const DOOR = { seamX: 0.004464, y0: -0.532366, y1: 0.248326 }
const DOOR_MID_Y = (DOOR.y0 + DOOR.y1) / 2
const OUT_POS = new THREE.Vector3(DOOR.seamX, DOOR_MID_Y + 0.02 - PB_CFG.heroOut / 2, 0.22)
const UI_CENTER = new THREE.Vector3(DOOR.seamX, OUT_POS.y + PB_CFG.heroOut / 2, OUT_POS.z)
const CM = PB_CFG.heroOut / 12.6 // cm du flacon → unités marqueur
const MARKER_ASPECT = 2400 / 1792

// ---- flacon factice (cotes §2.1, en cm, base au centre, face avant +Z) ----------------------------------
function makePlaceholderBottle() {
  const root = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(-3.1, 0); shape.lineTo(-3.1, 3.515)
  shape.absarc(0.3, 5.212, 3.8, Math.atan2(3.515 - 5.212, -3.1 - 0.3), Math.atan2(8.75 - 5.212, -1.086 - 0.3), true)
  shape.lineTo(1.086, 8.75)
  shape.absarc(-0.3, 5.212, 3.8, Math.atan2(8.75 - 5.212, 1.086 + 0.3), Math.atan2(3.515 - 5.212, 3.1 + 0.3), true)
  shape.lineTo(3.1, 0); shape.closePath()
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 3.1, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2, curveSegments: 24 })
  bodyGeo.translate(0, 0, -1.55)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1b2fa6, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2, transparent: true, opacity: 0.93 })
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.2, envMapIntensity: 1.3 })
  const body = new THREE.Mesh(bodyGeo, glass)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 24), glass); neck.position.y = 8.875
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.5, 32), gold); collar.position.y = 9.25
  const capR = 1.4 / Math.cos(Math.PI / 8)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(capR, capR, 3.1, 8), gold); cap.position.y = 11.05; cap.rotation.y = Math.PI / 8
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold)
  boss.rotation.x = Math.PI / 2; boss.position.set(0, 7.95, 1.7)
  const stud = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold)
  stud.rotation.x = Math.PI / 2; stud.position.set(0, 4.95, 1.7)
  const ringPivot = new THREE.Group(); ringPivot.position.set(0, 7.7, 1.95)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.34, 0.16, 12, 48), gold); ring.position.set(0, 6.45 - 7.7, 0)
  ringPivot.add(ring)
  // clous ronds sur la ligne médiane de la bande (simplifiés : 8 par côté le long du contour intérieur)
  const studGeo = new THREE.SphereGeometry(0.18, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  const pts = shape.getSpacedPoints(120)
  const inner = []
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k], q = pts[(k + 1) % pts.length]
    const tx = q.x - p.x, ty = q.y - p.y, l = Math.hypot(tx, ty) || 1
    inner.push(new THREE.Vector2(p.x + (ty / l) * 0.8, p.y - (tx / l) * 0.8))
  }
  const usable = inner.filter((p) => p.y > 0.75)
  for (let k = 0; k < 16; k++) {
    const p = usable[Math.round((k / 15) * (usable.length - 1))]
    const s = new THREE.Mesh(studGeo, gold); s.rotation.x = Math.PI / 2; s.position.set(p.x, p.y, 1.72); root.add(s)
  }
  root.add(body, neck, collar, cap, boss, stud, ringPivot)
  root.scale.setScalar(CM)
  root.position.copy(OUT_POS)
  return { root, ringPivot, body }
}

export default function PerfumeUITest() {
  const mountRef = useRef(null)
  const apiRef = useRef(null)
  const [view, setView] = useState({ state: 'loading' })
  const [hint, setHint] = useState('Chargement…')
  const [info, setInfo] = useState('')
  const [panel, setPanel] = useState(true)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined
    let disposed = false
    const qs = new URLSearchParams(window.location.search)
    const num = (k, d) => { const v = parseFloat(qs.get(k)); return Number.isFinite(v) ? v : d }
    if (qs.get('panel') === '0') setPanel(false)
    const useGarden = qs.get('garden') !== '0'
    const idleOn = qs.get('idle') !== '0'

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(num('dpr', Math.min(window.devicePixelRatio, 2)))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0807)

    let cam = [0.05, -0.04, 2.0]
    if (qs.get('cam')) cam = qs.get('cam').split(',').map(Number)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
    camera.position.set(cam[0], cam[1], cam[2])
    const hfov = num('hfov', 45), vfov = num('fov', 0)
    const applySize = () => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.fov = vfov || (camera.aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / camera.aspect)) : 45)
      camera.updateProjectionMatrix()
    }
    applySize()
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(cam[0], -0.12, -0.2)

    const pmrem = new THREE.PMREMGenerator(renderer)
    new RGBELoader().load('/hdr/photo_studio_01_1k.hdr', (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      hdr.dispose(); pmrem.dispose()
    })

    const anchor = new THREE.Group(); scene.add(anchor)
    anchor.add(new THREE.AmbientLight(0xffffff, 0.3))
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.6, 1.0, 1.4); anchor.add(key)
    const tex = new THREE.TextureLoader().load('/majorelle/marker_door_2k.png'); tex.colorSpace = THREE.SRGBColorSpace
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1, MARKER_ASPECT), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, toneMapped: false }))
    poster.renderOrder = -2; anchor.add(poster)

    // cour bakée, porte ouverte, eau vivante (lecture seule des modules du jardin)
    let water = null, mixer = null
    if (useGarden) {
      const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
      const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej))
      Promise.all([
        pickMajorelleInterior('/majorelle').then(async (pick) => (pick ? { meta: pick.meta, gltf: await load(pick.glbUrl) } : null)),
        load('/majorelle/mj_door.glb'),
        loadReflectionProbes('/majorelle/fx/').catch(() => null),
      ]).then(([gi, gd, probes]) => {
        if (disposed || !gi) return
        applyMajorelleMaterials(gi.gltf.scene, gi.meta, '/majorelle')
        gd.scene.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
        anchor.add(gi.gltf.scene, gd.scene)
        mixer = new THREE.AnimationMixer(gd.scene)
        const clip = THREE.AnimationClip.findByName(gd.animations, 'DoorOpen') || gd.animations[0]
        if (clip) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.time = clip.duration; a.paused = true; mixer.update(0) }
        const gardenRoot = new THREE.Group()
        gardenRoot.position.set(gi.meta.X_OFF, gi.meta.Z_OFF, 0); gardenRoot.scale.setScalar(gi.meta.K)
        anchor.add(gardenRoot)
        water = createGardenFX({ parent: gardenRoot, sunDir: new THREE.Vector3(-0.52, 0.76, 0.38).normalize(), reflectionCube: probes, energy: 0.75 })
      }).catch((e) => console.warn('[perfumeUI test] cour', e))
    }

    const bottle = makePlaceholderBottle(); anchor.add(bottle.root)
    const ui = createPerfumeUI(anchor, { center: UI_CENTER, copy: PB_COPY })
    const strikePt = new THREE.Vector3(0, 4.95 * CM, 1.95 * CM).add(OUT_POS)
    const knockerPt = new THREE.Vector3(0, 6.45 * CM, 1.95 * CM).add(OUT_POS)
    const bottleW = 7.0 * CM, ghostR = 1.5 * CM * 1.3

    // ---- mini directeur -------------------------------------------------------------------------
    const st = { state: 'loading', knocks: 0, unlocked: false, signed: false, lastTouch: 0, lastKnock: -9, ringT: -1, squash: 0, holding: null, lastHit: '' }
    let clock = 0
    const timers = []
    const after = (t, fn) => timers.push({ at: clock + t, fn })
    const hintFor = () => {
      if (st.state === 'closed') return PB_COPY.hint.closed
      if (st.state !== 'showcase') return ''
      if (st.signed) return PB_COPY.hint.signed
      if (st.unlocked) return PB_COPY.hint.unlocked
      return PB_COPY.hint[`knock${Math.min(st.knocks, 2)}`]
    }
    const go = (s) => { st.state = s; setView({ state: s, knocks: st.knocks, unlocked: st.unlocked, signed: st.signed }); setHint(hintFor()) }
    const knock = () => {
      st.lastTouch = clock
      if (st.state !== 'showcase') return
      if (st.knocks >= 3) { spray(0.6); return }
      if (clock - st.lastKnock < PB_CFG.knock.debounce) return
      st.lastKnock = clock; st.ringT = 0
      const n = st.knocks
      after(PB_CFG.knock.strikeAt, () => {
        st.knocks = n + 1; st.squash = 1
        ui.strike(strikePt, bottleW)
        ui.setKnocks(st.knocks)
        try { navigator.vibrate?.([14, 40, 8]) } catch {}
        setHint(hintFor())
      })
      after(PB_CFG.knock.strikeAt + PB_CFG.knock.answerDelay + 1.2, () => {
        ui.setNote(n)
        if (n === 2) { st.unlocked = true; ui.setSpray({ locked: false }); setHint(hintFor()) }
      })
    }
    const spray = (hold = 0.6) => {
      st.lastTouch = clock
      if (st.state !== 'showcase') return
      if (!st.unlocked) { ui.setSpray({ pulse: true }); return }
      const first = !st.signed
      go('finale'); ui.setDim(0.4)
      after(first ? 5.8 : 3.0, () => {
        ui.setDim(1)
        if (first) ui.setFinal()
        st.signed = true; go('showcase')
      })
      return hold
    }
    const returnProduct = () => { if (st.state !== 'showcase') return; ui.hide(); ui.ghost(false); go('returning'); after(2.5, () => go('closed')) }
    const replay = () => {
      timers.length = 0
      ui.reset(); ui.hide()
      Object.assign(st, { knocks: 0, unlocked: false, signed: false, lastKnock: -9, holding: null })
      go('intro')
      after(1.2, () => { ui.show(); go('showcase'); st.lastTouch = clock })
    }
    const onUi = (h) => {
      st.lastHit = JSON.stringify(h)
      if (h.type === 'note') { if (h.lit) ui.setNote(h.index) }
      else if (h.id === 'return') returnProduct()
    }

    // ---- gestes ----------------------------------------------------------------------------------
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2()
    const toNdc = (x, y) => { const r = renderer.domElement.getBoundingClientRect(); return ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1) }
    const pick = (x, y) => {
      raycaster.setFromCamera(toNdc(x, y), camera)
      const h = ui.hit(raycaster)
      if (h) return { kind: 'ui', h }
      if (raycaster.intersectObject(bottle.root, true).length) return { kind: 'bottle' }
      return null
    }
    let down = null
    const onDown = (e) => {
      const p = pick(e.clientX, e.clientY)
      st.lastTouch = clock
      if (!p) { st.lastHit = 'null'; return }
      down = { p, t: clock, x: e.clientX, y: e.clientY, id: e.pointerId }
      controls.enabled = false
      try { renderer.domElement.setPointerCapture?.(e.pointerId) } catch {}
      if (p.kind === 'ui') { st.lastHit = JSON.stringify(p.h); ui.press(p.h) } else st.lastHit = 'bottle'
      const holdable = (p.kind === 'bottle' || (p.kind === 'ui' && p.h.id === 'spray')) && st.unlocked && st.state === 'showcase'
      if (holdable) st.holding = { t0: clock }
    }
    const onUp = (e) => {
      controls.enabled = true
      if (!down || down.id !== e.pointerId) return
      const d = down; down = null
      const held = st.holding ? clock - st.holding.t0 : 0
      st.holding = null; ui.setHold(null)
      if (held > 0.3) { spray(Math.min(1.4, Math.max(0.6, held))); return }
      if (d.p.kind === 'bottle') knock()
      else if (d.p.h.id === 'spray') spray(0.6)
      else onUi(d.p.h)
    }
    const el = renderer.domElement
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', () => { down = null; st.holding = null; ui.setHold(null); controls.enabled = true })
    window.addEventListener('resize', applySize)

    // ---- boucle ------------------------------------------------------------------------------------
    let uiStats = { drawCalls: 0, triangles: 0 }, frame = 0
    const step = (dt) => {
      clock += dt
      for (let i = timers.length - 1; i >= 0; i--) if (clock >= timers[i].at) { const t = timers[i]; timers.splice(i, 1); t.fn() }
      if (st.holding) { const k = (clock - st.holding.t0 - 0.1) / 1.3; ui.setHold(k >= 0 ? Math.min(1, k) : null) }
      // heurtoir : 0 → 40° en 0,14 s, retour 0,12 s (frappe), rebonds 10° / 3°
      if (st.ringT >= 0) {
        st.ringT += dt
        const t = st.ringT, D = THREE.MathUtils.degToRad
        let th = 0
        if (t < 0.14) th = D(40) * (1 - Math.pow(1 - t / 0.14, 3))
        else if (t < 0.26) th = D(40) * (1 - Math.pow((t - 0.14) / 0.12, 2))
        else if (t < 0.44) th = D(10) * Math.sin(((t - 0.26) / 0.18) * Math.PI)
        else if (t < 0.56) th = D(3) * Math.sin(((t - 0.44) / 0.12) * Math.PI)
        else st.ringT = -1
        bottle.ringPivot.rotation.x = -th
      }
      st.squash = Math.max(0, st.squash - dt / 0.12)
      bottle.root.scale.set(CM * (1 + 0.04 * st.squash), CM * (1 - 0.07 * st.squash), CM * (1 + 0.04 * st.squash))
      // inactivité : anneau fantôme à 6 s, coup automatique à 10 s (vitrine, < 3 coups)
      const idle = clock - st.lastTouch
      const ghost = idleOn && st.state === 'showcase' && st.knocks < 3 && idle > PB_CFG.idle.ghostAfter
      if (idleOn) ui.ghost(ghost, knockerPt, ghostR)
      if (idleOn && st.state === 'showcase' && st.knocks < 3 && idle > PB_CFG.idle.autoKnockAfter) knock()
      mixer?.update(0)
      water?.update(dt, camera)
      ui.update(dt, camera)
      controls.update()
      renderer.render(scene, camera)
      if ((frame++ & 15) === 0) {
        uiStats = ui.stats()
        setInfo(`UI ${uiStats.drawCalls} appels · ${Math.round(uiStats.triangles)} tris — scène ${renderer.info.render.calls} appels · état ${st.state} · coups ${st.knocks} · touché ${st.lastHit}`)
      }
    }
    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now
      step(dt)
    }
    tick()
    ui.show(); go('showcase')

    // pilotage (puppeteer) : coordonnées en px CSS de la fenêtre
    const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, bubbles: true, isPrimary: true }))
    const api = {
      ui, camera, renderer, scene, anchor, st,
      step: (dt = 1 / 30, n = 1) => { for (let i = 0; i < n; i++) step(dt) },
      knock, spray, returnProduct, replay,
      tapPx: (x, y) => { fire('pointerdown', x, y); step(1 / 30); fire('pointerup', x, y); return st.lastHit },
      holdPx: (x, y, sec = 1) => { fire('pointerdown', x, y); for (let t = 0; t < sec; t += 1 / 30) step(1 / 30); fire('pointerup', x, y); return st.lastHit },
      // projection écran (px CSS) d'un point de l'ancre — pour viser les cibles
      screenOf: (x, y, z) => {
        const v = new THREE.Vector3(x, y, z); anchor.localToWorld(v); v.project(camera)
        const r = el.getBoundingClientRect()
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }
      },
      layout: { center: UI_CENTER, outPos: OUT_POS, strikePt, knockerPt },
      setView: (s) => { st.state = s; go(s) },
      stats: () => ({ ui: ui.stats(), calls: renderer.info.render.calls, programs: renderer.info.programs.length }),
    }
    apiRef.current = api
    window.__pui = api

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', applySize)
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp)
      ui.dispose(); controls.dispose(); renderer.dispose()
      if (el.parentNode) el.parentNode.removeChild(el)
      if (window.__pui === api) delete window.__pui
    }
  }, [])

  const A = () => apiRef.current
  const btn = { pointerEvents: 'auto', background: 'rgba(0,0,0,0.6)', color: '#EFE9DC', border: '1px solid rgba(201,164,92,0.55)', borderRadius: 4, padding: '4px 7px', fontSize: 11, cursor: 'pointer' }
  const row = (label, items) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ color: '#C9A45C', fontSize: 10, letterSpacing: '0.14em', minWidth: 66 }}>{label}</span>
      {items.map(([t, fn]) => <button key={t} style={btn} onClick={() => fn(A())}>{t}</button>)}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
      <PerfumeOverlay view={view} status={hint} title="Jardin Majorelle" endCard={PB_COPY.endCard} onReplay={() => A()?.replay()} />
      {panel && (
        <div style={{ position: 'fixed', top: 70, left: 8, zIndex: 1000001, display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 'min(560px, calc(100vw - 16px))', background: 'rgba(0,0,0,0.35)', padding: 6, borderRadius: 6 }}>
          {row('COUPS', [['Frapper', (a) => a.knock()], ['0', (a) => a.ui.setKnocks(0)], ['1', (a) => a.ui.setKnocks(1)], ['2', (a) => a.ui.setKnocks(2)], ['3', (a) => a.ui.setKnocks(3)]])}
          {row('CARTEL', [['Base', (a) => a.ui.setNote(-1)], ['I', (a) => a.ui.setNote(0)], ['II', (a) => a.ui.setNote(1)], ['III', (a) => a.ui.setNote(2)], ['Final', (a) => a.ui.setFinal()]])}
          {row('VAPORISER', [['Verrou', (a) => a.ui.setSpray({ locked: true })], ['Libre', (a) => a.ui.setSpray({ locked: false })], ['Impulsion', (a) => a.ui.setSpray({ pulse: true })], ['1/3', (a) => a.ui.setSpray({ progress: 1 / 3 })], ['Maintien', (a) => { let k = 0; const id = setInterval(() => { k += 0.05; a.ui.setHold(k <= 1.15 ? Math.min(1, k) : null); if (k > 1.15) clearInterval(id) }, 50) }]])}
          {row('FX', [['Choc', (a) => a.ui.strike(a.layout.strikePt, 0.222)], ['Fantôme', (a) => { a._g = !a._g; a.ui.ghost(a._g, a.layout.knockerPt, 0.062) }], ['Atténuer', (a) => { a._d = !a._d; a.ui.setDim(a._d ? 0.4 : 1) }]])}
          {row('UI', [['Montrer', (a) => a.ui.show()], ['Cacher', (a) => a.ui.hide()], ['Reset', (a) => a.ui.reset()], ['Rejouer', (a) => a.replay()], ['Fin', (a) => a.setView('closed')], ['Vitrine', (a) => a.setView('showcase')]])}
          <div style={{ color: '#EFE9DC', fontSize: 10, opacity: 0.85, maxWidth: 540 }}>{info}</div>
        </div>
      )}
      {!panel && <div style={{ display: 'none' }}>{info}</div>}
    </div>
  )
}
