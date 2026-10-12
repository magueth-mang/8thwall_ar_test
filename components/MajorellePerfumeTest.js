'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildMajorellePerfumeScene } from '@/lib/majorellePerfumeScene'
import { PerfumeOverlay } from '@/components/PerfumeOverlay'
import { PB_COPY } from '@/lib/majorelle/perfumeConfig'

// Aperçu orbital de « BLEU INTERDIT » (sans AR) : l'image de la porte remplace le flux caméra.
// ?cam=x,y,z (marqueur), ?q=high|medium|low, ?emerge=leaf|shallow, ?autoplay=0 ; window.__mjs.step(dt) avance la scène à la main.
export default function MajorellePerfumeTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [view, setView] = useState({ state: 'loading', knocks: 0, unlocked: false, signed: false })
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    const qs = new URLSearchParams(window.location.search)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0807)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let cam = [0.05, -0.04, 2.0]
    try { const q = qs.get('cam'); if (q) cam = q.split(',').map(Number) } catch {}
    camera.position.set(cam[0], cam[1], cam[2])
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, -0.12, -0.2)

    const quality = qs.get('q') || undefined
    const portal = buildMajorellePerfumeScene(renderer, scene, {
      onStatus: setStatus,
      onState: (state, info) => setView({ state, knocks: info.knocks, unlocked: info.unlocked, signed: info.signed }),
      markerPreview: true,
      quality,
      emergeMode: qs.get('emerge') || undefined, // ?emerge=shallow : repli du risque 1 (porte de pose)
    })
    portal.anchor.visible = true
    portal.setCamera(camera)
    apiRef.current = portal
    portal.ready.then(() => { if (!disposed && qs.get('autoplay') !== '0') setTimeout(() => portal.playIntro(), 500) })

    const ndcOf = (e) => {
      const r = renderer.domElement.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
    }
    // capturé (interface ou flacon) → la scène ; sinon OrbitControls, et un toucher bref devient tapAt (eau, porte)
    const downs = new Map()
    const onDown = (e) => {
      const n = ndcOf(e)
      const cap = portal.pointerDown(n, camera, e.pointerId)
      downs.set(e.pointerId, { x: n.x, y: n.y, cap })
      if (cap) { controls.enabled = false; renderer.domElement.setPointerCapture?.(e.pointerId) }
    }
    const onMove = (e) => { portal.pointerMove(ndcOf(e), camera, e.pointerId) }
    const onUp = (e) => {
      const n = ndcOf(e)
      const d = downs.get(e.pointerId); downs.delete(e.pointerId)
      portal.pointerUp(n, camera, e.pointerId)
      controls.enabled = true
      if (d && !d.cap && Math.hypot(n.x - d.x, n.y - d.y) < 0.03) portal.tapAt(n, camera)
    }
    const onCancel = (e) => { downs.delete(e.pointerId); portal.pointerCancel(e.pointerId); controls.enabled = true }
    const el = renderer.domElement
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)

    const step = (dt) => { portal.update(dt); controls.update(); renderer.render(scene, camera) }
    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now
      step(dt)
    }
    tick()
    // debug : step(dt) avance la scène à la main (onglet masqué = requestAnimationFrame suspendu)
    window.__mjs = { portal, camera, controls, renderer, step: (dt = 1 / 30) => step(dt) }

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0807' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <PerfumeOverlay view={view} status={status} title="Jardin Majorelle" endCard={PB_COPY.endCard} onReplay={() => apiRef.current?.replay()} />
    </div>
  )
}
