'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildMajorelleScene } from '@/lib/majorellePortalScene'
import { PortalOverlay } from '@/components/PortalOverlay'

// Aperçu orbital du « Jardin Majorelle » complet (sans AR) : l'image de la porte remplace le flux caméra.
export default function MajorelleSceneTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [view, setView] = useState({ state: 'loading', shade: null, open: false })
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0807)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let cam = [0.05, -0.04, 2.0]
    try { const q = new URLSearchParams(window.location.search).get('cam'); if (q) cam = q.split(',').map(Number) } catch {}
    camera.position.set(cam[0], cam[1], cam[2])
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, -0.12, -0.2)

    const portal = buildMajorelleScene(renderer, scene, {
      onStatus: setStatus,
      onState: (state, info) => setView({ state, shade: info.shade, open: info.open }),
      markerPreview: true,
    })
    portal.anchor.visible = true
    portal.setCamera(camera)
    apiRef.current = portal
    portal.ready.then(() => { if (!disposed) setTimeout(() => portal.playIntro(), 500) })

    const ndcOf = (e) => {
      const r = renderer.domElement.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
    }
    const onDown = (e) => { if (portal.pointerDown(ndcOf(e), camera, e.pointerId)) { controls.enabled = false; renderer.domElement.setPointerCapture?.(e.pointerId) } }
    const onMove = (e) => { portal.pointerMove(ndcOf(e), camera, e.pointerId) }
    const onUp = (e) => { portal.pointerUp(ndcOf(e), camera, e.pointerId); controls.enabled = true }
    const onCancel = (e) => { portal.pointerCancel(e.pointerId); controls.enabled = true }
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
      <PortalOverlay view={view} status={status} title="Jardin Majorelle" onReplay={() => apiRef.current?.replay()} />
    </div>
  )
}
