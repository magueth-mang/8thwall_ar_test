'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildYslPortalScene } from '@/lib/yslPortalScene'
import { PortalOverlay } from '@/components/PortalOverlay'

// Aperçu orbital du portail YSL (sans AR) : l'image du marqueur remplace le flux caméra.
export default function CatalogTest() {
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
    let cam = [0.1, 0.03, 1.35]
    try { const q = new URLSearchParams(window.location.search).get('cam'); if (q) cam = q.split(',').map(Number) } catch {}
    camera.position.set(cam[0], cam[1], cam[2])
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, -0.01, -0.1)

    const portal = buildYslPortalScene(renderer, scene, {
      onStatus: setStatus,
      onState: (state, info) => setView({ state, shade: info.shade, open: info.open }),
      markerPreview: true,
    })
    portal.anchor.visible = true
    portal.setCamera(camera)
    apiRef.current = portal
    portal.ready.then(() => { if (!disposed) setTimeout(() => portal.playIntro(), 500) })

    // gestes : la scène prend la main si on touche le produit ou l'interface AR
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

    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.05); last = now
      portal.update(dt); controls.update(); renderer.render(scene, camera)
    }
    tick()
    if (typeof window !== 'undefined') window.__yslPortal = { portal, camera, controls }

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
      <PortalOverlay view={view} status={status} onReplay={() => apiRef.current?.replay()} />
    </div>
  )
}
