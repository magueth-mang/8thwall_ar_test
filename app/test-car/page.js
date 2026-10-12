'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createCarLook } from '@/lib/car/carLook'
import { loadGlbCar, MODEL_LENGTH_M } from '@/components/ARCarPlace'
import { createConfigurator } from '@/lib/car/configurator'
import { CarConfigPanel } from '@/components/CarConfigPanel'
import { createCarShowcase, createCarLights } from '@/lib/car/carShowcase'
import { createConfigStand } from '@/lib/car/carConfigAR'
import { createCarStage } from '@/lib/car/carStage'

// Aperçu bureau de la voiture du prototype AR (même chargeur que /scan-car) : orientation, taille, portières.
// window.__car = { car, doors, dims, renderer, camera, controls, toggle(i) }
export default function TestCarPage() {
  const ref = useRef(null)
  const [info, setInfo] = useState('Chargement…')
  const [cfg, setCfg] = useState(null)
  const api = useRef({})

  useEffect(() => {
    const el = ref.current
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.toneMapping = THREE.NeutralToneMapping
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x8a8f96)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 2); scene.add(sun)
    const grid = new THREE.GridHelper(10, 10, 0x222222, 0x555555); scene.add(grid) // carreaux de 1 m
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 100)
    camera.position.set(4.5, 2.2, 6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.9, 0)
    let car = null, doors = [], config = null, disposed = false, showcase = null, lights = null, t = 0, stand = null, stage = null
    const clock = new THREE.Clock()
    loadGlbCar('/car/bmw_x7.glb', (k) => setInfo(`Chargement ${Math.round(k * 100)} %`), { lengthM: MODEL_LENGTH_M }).then((b) => {
      if (disposed) return // double montage React (dev) : seul le dernier rendu garde la voiture
      car = b.car; doors = b.doors; scene.add(car)
      let tris = 0; car.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 })
      setInfo(`L ${b.dims.L.toFixed(2)} m · l ${b.dims.W.toFixed(2)} m · h ${b.dims.H.toFixed(2)} m · ${doors.length} portières · ${Math.round(tris / 1000)}k triangles · grille 1 m`)
      config = createConfigurator(car)
      createCarLook({ car, scene, renderer })
      lights = createCarLights(car)
      const front = doors.filter((d) => /doorf/i.test(d.node?.name || ''))
      showcase = createCarShowcase({ car, dims: b.dims, scene, onAction: (kind, on) => {
        if (kind === 'lights') lights.set(on)
        if (kind === 'doors') front.forEach((d) => { d.target = on ? 1 : 0 })
      } })
      stand = createConfigStand({ car, dims: b.dims, scene, config, onTab: (k) => { if (k === 'leather') front.forEach((d) => { d.target = 1 }) }, onOpenChange: (o) => showcase.setVisible(!o) })
      stage = createCarStage({ car, dims: b.dims, scene, renderer, lights, onRevealed: () => { showcase.setVisible(true); stand.setVisible(true) } })
      stand.setVisible(true)
      const reveal = () => { showcase.setVisible(false); stand.setVisible(false); stage.playReveal() }
      Object.assign(api.current, { car, doors, dims: b.dims, config, showcase, stand, stage, reveal })
      setCfg({ available: config.available, current: { ...config.current } })
    }).catch((e) => setInfo('Erreur : ' + e.message))
    const toggle = (i) => { const ds = i == null ? doors : [doors[i]]; const open = ds.some((d) => d.target < 0.5); ds.forEach((d) => { d.target = open ? 1 : 0 }) }
    Object.assign(api.current, { renderer, camera, controls, toggle, scene, grid })
    window.__car = api.current
    const smooth01 = (x) => x * x * (3 - 2 * x)
    let raf = 0
    const frame = (dt) => {
      t += dt
      config?.update(dt); lights?.update(dt); showcase?.update(dt, camera, t); stand?.update(dt, camera, t); stage?.update(dt, camera, t)
      for (const d of doors) { d.open += (d.target - d.open) * Math.min(1, dt * 3.2); d.apply(smooth01(d.open)) }
      controls.update(); renderer.render(scene, camera)
    }
    const loop = () => { raf = requestAnimationFrame(loop); frame(Math.min(clock.getDelta(), 0.05)) }
    api.current.step = (dt = 1 / 30, n = 1) => { for (let i = 0; i < n; i++) frame(dt) } // panneau caché : rendu forcé
    loop()
    const onResize = () => { renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)
    // toucher : pastille / fiche d'abord, puis portière
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    let downAt = null
    const onDown = (e) => { downAt = [e.clientX, e.clientY] }
    const onUp = (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6 || !car) return
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      if (stand?.pick(ray)) return
      if (showcase?.pick(ray)) return
      const hit = ray.intersectObjects(doors.flatMap((d) => d.pickables), false)[0]
      if (hit) { const d = hit.object.userData.door; d.target = d.target > 0.5 ? 0 : 1 }
    }
    renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp)
    return () => { disposed = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); renderer.dispose(); el.removeChild(renderer.domElement) }
  }, [])

  const b = { padding: '8px 14px', borderRadius: 999, border: 'none', background: '#f2f2f2', fontWeight: 700, fontSize: 12, cursor: 'pointer' }
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, color: '#fff', fontFamily: 'Helvetica, Arial', fontSize: 13, textShadow: '0 1px 3px #000' }}>{info}</div>
      {cfg && <div style={{ position: 'absolute', bottom: 64, left: 0, right: 0 }}>
        <CarConfigPanel available={cfg.available} current={cfg.current}
          onSelect={(k, id) => { api.current.config.set(k, id); setCfg({ ...cfg, current: { ...api.current.config.current } }) }} />
      </div>}
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button style={b} onClick={() => api.current.toggle?.()}>PORTIÈRES</button>
        {[0, 1, 2, 3].map((i) => <button key={i} style={b} onClick={() => api.current.toggle?.(i)}>P{i + 1}</button>)}
      </div>
    </main>
  )
}
