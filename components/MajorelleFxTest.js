'use client'

// Banc d'essai de lib/majorelle/gardenFx.js : une cour Majorelle factice (sol en tomettes, bassin long,
// bassin rond + vasque, murs bleus) rendue « unlit » comme la future scène bakée, + les effets.
// Clic/tap sur l'eau = splash. Paramètres d'URL : ?view=porte|bassin|koi|fontaine&energy=0.8&q=high|medium|low&fov=50&ui=0

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createGardenFX } from '@/lib/majorelle/gardenFx'

const POOL = { x0: -0.8, x1: 0.8, z0: -6.3, z1: -1.7, waterY: 0, depth: 0.45 }
const FOUNTAIN = { x: 0, z: -7.55, basinR: 0.92, waterY: 0.42, bowlY: 1.14, bowlR: 0.44, floorY: 0.12 }
const SUN = new THREE.Vector3(-0.5, 0.7071, -0.5).normalize()

const VIEWS = {
  porte: { pos: [0, 1.55, 0.9], target: [0, 0.15, -4.6] },
  bassin: { pos: [1.3, 1.15, -1.1], target: [0, -0.15, -3.7] },
  koi: { pos: [0.05, 2.2, -3.0], target: [0, -0.2, -3.95] },
  fontaine: { pos: [1.55, 1.45, -5.5], target: [0, 0.8, -7.55] },
}

// ---------------------------------------------------------------- textures factices (canvas)
function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 4
  return t
}
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }
const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`

// tomettes en losange, tuilables
const floorTex = (rx, ry) => canvasTexture(512, 512, (g, w) => {
  const r = rnd(11)
  g.fillStyle = '#d9ab86'; g.fillRect(0, 0, w, w)
  const d = 128, h = d / 2 - 3
  for (let j = -1; j <= 4; j++) for (let i = -1; i <= 4; i++) for (const o of [0, 0.5]) {
    const cx = (i + o) * d, cy = (j + o) * d
    g.fillStyle = hsl(16 + r() * 8, 46 + r() * 12, 49 + r() * 9)
    g.beginPath(); g.moveTo(cx, cy - h); g.lineTo(cx + h, cy); g.lineTo(cx, cy + h); g.lineTo(cx - h, cy); g.closePath(); g.fill()
  }
}, [rx, ry])

// petits carreaux cobalt du fond du bassin
const poolTex = (rx, ry, light = 1) => canvasTexture(256, 256, (g, w) => {
  const r = rnd(5)
  g.fillStyle = '#081a44'; g.fillRect(0, 0, w, w)
  const n = 16, s = w / n
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.fillStyle = hsl(224 + r() * 8, 70 + r() * 15, (18 + r() * 8) * light)
    g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2)
  }
}, [rx, ry])

// zellige bleu/blanc (margelle, bassin rond)
const zelligeTex = (rx, ry) => canvasTexture(256, 64, (g, w, h) => {
  g.fillStyle = '#f2eee4'; g.fillRect(0, 0, w, h)
  const s = 32
  for (let i = 0; i < w / s; i++) {
    g.fillStyle = i % 2 ? '#2a48c6' : '#1e7a5a'
    g.beginPath(); g.moveTo(i * s + s / 2, 4); g.lineTo(i * s + s - 4, h / 2); g.lineTo(i * s + s / 2, h - 4); g.lineTo(i * s + 4, h / 2); g.closePath(); g.fill()
  }
  g.fillStyle = '#2546d8'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5)
}, [rx, ry])

const basinFloorTex = () => canvasTexture(256, 256, (g, w) => {
  const r = rnd(3)
  g.fillStyle = '#c9d6d8'; g.fillRect(0, 0, w, w)
  const n = 8, s = w / n
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.fillStyle = (i + j) % 2 ? hsl(190, 35, 70 + r() * 6) : hsl(40, 30, 90 + r() * 4)
    g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2)
  }
}, [3, 3])

// ---------------------------------------------------------------- cour factice
function buildCourtyard(scene) {
  const root = new THREE.Group()
  const basic = (opts) => new THREE.MeshBasicMaterial({ toneMapped: false, ...opts })
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); root.add(m); return m }

  // ciel
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vD; void main(){ float h = clamp(vD.y,0.0,1.0); vec3 c = mix(vec3(0.93,0.94,0.92), vec3(0.62,0.76,0.9), pow(h,0.5)); gl_FragColor = vec4(c,1.0); }',
  }))
  root.add(sky)

  // sol en tomettes (4 bandes autour du bassin + margelle)
  const m = 0.22
  const rect = (x0, x1, z0, z1) => {
    const w = x1 - x0, d = z1 - z0
    add(new THREE.PlaneGeometry(w, d), basic({ map: floorTex(w / 1.0, d / 1.0) }), (x0 + x1) / 2, 0, (z0 + z1) / 2, -Math.PI / 2)
  }
  rect(-3.6, POOL.x0 - m, -9.6, -0.45); rect(POOL.x1 + m, 3.6, -9.6, -0.45)
  rect(POOL.x0 - m, POOL.x1 + m, -9.6, POOL.z0 - m); rect(POOL.x0 - m, POOL.x1 + m, POOL.z1 + m, -0.45)

  // bassin long : fond, parois, margelle
  const pw = POOL.x1 - POOL.x0, pl = POOL.z1 - POOL.z0, pz = (POOL.z0 + POOL.z1) / 2
  add(new THREE.PlaneGeometry(pw, pl), basic({ map: poolTex(pw / 0.4, pl / 0.4) }), 0, -POOL.depth, pz, -Math.PI / 2)
  const wallH = POOL.depth + 0.08
  const pwall = (len, x, z, ry) => add(new THREE.PlaneGeometry(len, wallH), basic({ map: poolTex(len / 0.4, wallH / 0.4, 0.8) }), x, -POOL.depth + wallH / 2, z, 0, ry)
  pwall(pw, 0, POOL.z0, 0); pwall(pw, 0, POOL.z1, Math.PI); pwall(pl, POOL.x0, pz, Math.PI / 2); pwall(pl, POOL.x1, pz, -Math.PI / 2)
  const rim = (w, d, x, z) => add(new THREE.BoxGeometry(w, 0.1, d), basic({ map: zelligeTex(Math.max(w, d) / 0.5, 1) }), x, 0.03, z)
  rim(pw + 2 * m, m, 0, POOL.z0 - m / 2); rim(pw + 2 * m, m, 0, POOL.z1 + m / 2)
  rim(m, pl, POOL.x0 - m / 2, pz); rim(m, pl, POOL.x1 + m / 2, pz)

  // bassin rond + vasque
  const F = FOUNTAIN
  add(new THREE.CylinderGeometry(1.0, 1.0, 0.5, 72, 1, true), basic({ map: zelligeTex(10, 1) }), F.x, 0.25, F.z)
  add(new THREE.CylinderGeometry(F.basinR, F.basinR, 0.5 - F.floorY, 72, 1, true), basic({ map: zelligeTex(9, 1), side: THREE.BackSide, color: 0xcfd6e6 }), F.x, (0.5 + F.floorY) / 2, F.z)
  add(new THREE.RingGeometry(F.basinR, 1.03, 72), basic({ color: 0xf1ebdf }), F.x, 0.5, F.z, -Math.PI / 2)
  add(new THREE.CircleGeometry(F.basinR, 48), basic({ map: basinFloorTex() }), F.x, F.floorY, F.z, -Math.PI / 2)
  const stone = basic({ color: 0xe9d6ae })
  const lathe = (pts, mat) => add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 48), mat, F.x, 0, F.z)
  lathe([[0.15, F.floorY], [0.13, 0.4], [0.12, 0.46], [0.075, 0.55], [0.07, 0.8], [0.085, 0.9], [0.06, 0.96], [0.12, 0.99]], stone)
  lathe([[0.1, 0.95], [0.25, 0.99], [0.4, 1.06], [0.46, 1.12], [0.462, 1.14], [0.44, 1.14], [0.38, 1.1], [0.2, 1.08], [0.0, 1.075]],
    basic({ color: 0xead8b0, side: THREE.DoubleSide }))

  // murs (bleu Majorelle) + couvertines + niche + alcôves (pour juger les reflets)
  const blue = (k = 1) => basic({ color: new THREE.Color('#2546d8').multiplyScalar(k) })
  const yellow = basic({ color: 0xf2c94c })
  add(new THREE.PlaneGeometry(7.2, 4), blue(0.92), 0, 2, -9.6)
  add(new THREE.PlaneGeometry(9.15, 4), blue(0.8), -3.6, 2, -5.025, 0, Math.PI / 2)
  add(new THREE.PlaneGeometry(9.15, 4), blue(0.98), 3.6, 2, -5.025, 0, -Math.PI / 2)
  add(new THREE.BoxGeometry(7.4, 0.15, 0.3), yellow, 0, 3.925, -9.5)
  add(new THREE.BoxGeometry(0.3, 0.15, 9.2), yellow, -3.5, 3.925, -5.0)
  add(new THREE.BoxGeometry(0.3, 0.15, 9.2), yellow, 3.5, 3.925, -5.0)
  const arch = (w, h, r) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - r); s.absarc(0, h - r, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0); return new THREE.ShapeGeometry(s, 24) }
  add(arch(1.7, 2.8, 0.85), basic({ color: 0xefe6d4 }), 0, 0.3, -9.595)
  add(arch(1.24, 2.4, 0.62), basic({ color: 0x9fb0c9 }), 0, 0.48, -9.59)
  for (const sx of [-2.4, 2.4]) { add(new THREE.PlaneGeometry(1.0, 2.2), yellow, sx, 1.8, -9.595); add(new THREE.PlaneGeometry(0.8, 2.0), basic({ color: 0xe2d8c4 }), sx, 1.8, -9.59) }
  for (const z of [-3.2, -6.4]) for (const sx of [-1, 1]) {
    add(arch(1.4, 2.6, 0.7), yellow, sx * 3.595, 0, z, 0, -sx * Math.PI / 2)
    add(arch(1.16, 2.45, 0.58), blue(0.5), sx * 3.59, 0, z, 0, -sx * Math.PI / 2)
  }
  // quelques pots (contexte)
  const potGeo = new THREE.CylinderGeometry(0.28, 0.2, 0.6, 24)
  const plantGeo = new THREE.SphereGeometry(0.42, 16, 10)
  const r = rnd(7)
  for (const [x, z, c] of [[-2.0, -2.6, '#2546d8'], [2.1, -3.4, '#c8714a'], [-2.3, -5.0, '#c8714a'], [2.2, -5.8, '#2546d8'], [-1.9, -7.4, '#2546d8'], [1.8, -7.9, '#f2c94c']]) {
    add(potGeo, basic({ color: c }), x, 0.3, z)
    add(plantGeo, basic({ color: new THREE.Color('#3f6b45').multiplyScalar(0.8 + r() * 0.3) }), x, 0.85, z)
  }
  scene.add(root)
  return root
}

// ---------------------------------------------------------------- composant
export default function MajorelleFxTest() {
  const mountRef = useRef(null)
  const apiRef = useRef(null)
  const [energy, setEnergyUI] = useState(0.8)
  const [quality, setQuality] = useState('high')
  const [stats, setStats] = useState('')
  const [showUi] = useState(() => new URLSearchParams(window.location.search).get('ui') !== '0')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    const qs = new URLSearchParams(window.location.search)
    const q0 = qs.get('q') || 'high'
    const e0 = qs.has('energy') ? Number(qs.get('energy')) : 0.8
    setQuality(q0); setEnergyUI(e0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe9eef0)
    const camera = new THREE.PerspectiveCamera(Number(qs.get('fov')) || 50, mount.clientWidth / mount.clientHeight, 0.02, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    const setView = (name) => {
      const v = VIEWS[name] || VIEWS.porte
      camera.position.set(...v.pos); controls.target.set(...v.target); controls.update()
    }
    setView(qs.get('view') || 'porte')

    buildCourtyard(scene)
    const garden = new THREE.Group() // repère jardin (identité ici ; sous l'ancre AR dans l'expérience)
    scene.add(garden)

    let fx = null
    const makeFx = (quality) => {
      if (fx) fx.dispose()
      fx = createGardenFX({ parent: garden, pool: POOL, fountain: FOUNTAIN, sunDir: SUN, quality, energy: e0 })
      apiRef.current = { ...apiRef.current, fx }
      window.__mj = { fx, camera, controls, renderer, scene, setView }
    }
    makeFx(q0)
    apiRef.current = { fx, setView, makeFx }

    // tap sur l'eau → splash (on ignore les glisser d'orbite)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3()
    let down = null
    const el = renderer.domElement
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() } }
    const onUp = (e) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      if (moved < 6 && performance.now() - down.t < 400) {
        const r = el.getBoundingClientRect()
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
        ray.setFromCamera(ndc, camera)
        if (fx.intersectWater(ray.ray, hit)) fx.splash(hit)
      }
      down = null
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)

    let last = performance.now(), raf = null, acc = 0, frames = 0
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now
      fx.update(dt, camera)
      controls.update()
      renderer.render(scene, camera)
      acc += dt; frames++
      if (acc > 0.5) {
        const s = fx.stats()
        setStats(`FX : ${s.drawCalls} draw calls · ${(s.triangles / 1000).toFixed(1)} k tris   |   scène : ${renderer.info.render.calls} calls · ${Math.round(frames / acc)} fps`)
        acc = 0; frames = 0
      }
    }
    tick()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      fx?.dispose(); controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  const ui = {
    panel: { position: 'absolute', left: 16, top: 16, right: 16, maxWidth: 420, padding: '14px 16px', background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: '#EFE9DC', fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, letterSpacing: '0.12em', borderTop: '1px solid #C9A45C' },
    title: { fontFamily: "'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif", fontSize: 18, letterSpacing: '0.08em', marginBottom: 10, color: '#D8BE86' },
    btn: { background: 'transparent', color: '#EFE9DC', border: '1px solid rgba(201,164,92,0.7)', padding: '6px 10px', marginRight: 6, marginBottom: 6, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' },
  }
  const api = () => apiRef.current
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {showUi && <div style={ui.panel}>
        <div style={ui.title}>Jardin Majorelle — eau vivante</div>
        <div>
          {Object.keys(VIEWS).map((v) => <button key={v} style={ui.btn} onClick={() => api()?.setView(v)}>{v}</button>)}
          <button style={ui.btn} onClick={() => {
            const a = api(); if (!a?.fx) return
            a.fx.splash(new THREE.Vector3(-0.5 + Math.random(), 0, -2.4 - Math.random() * 3))
          }}>splash</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: 10 }}>Fontaine</span>
          <input type="range" min="0" max="1" step="0.01" value={energy} onChange={(e) => { const v = Number(e.target.value); setEnergyUI(v); api()?.fx?.setEnergy(v) }} style={{ flex: 1, accentColor: '#C9A45C' }} />
          <span>{energy.toFixed(2)}</span>
        </label>
        <div style={{ margin: '4px 0 6px' }}>
          {['high', 'medium', 'low'].map((q) => (
            <button key={q} style={{ ...ui.btn, borderColor: q === quality ? '#C9A45C' : 'rgba(239,233,220,0.25)' }} onClick={() => { setQuality(q); api()?.makeFx(q); api()?.fx?.setEnergy(energy) }}>{q}</button>
          ))}
        </div>
        <div style={{ opacity: 0.8, fontSize: 10, letterSpacing: '0.06em' }}>{stats}</div>
        <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: '0.06em', marginTop: 4 }}>Touchez l'eau pour un splash · glisser = orbite</div>
      </div>}
    </div>
  )
}
