'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildPinkWallScene, CFG } from '@/lib/pinkWallScene'

export default function PinkWallTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const noStencil = (() => {
      try { return new URLSearchParams(window.location.search).get('nostencil') === '1' } catch { return false }
    })()
    const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: !noStencil, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1016)

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.01, 200)
    let cam = [1.6, 1.1, 2.6]
    try {
      const q = new URLSearchParams(window.location.search).get('cam')
      if (q) cam = q.split(',').map(Number)
    } catch {}
    camera.position.set(cam[0], cam[1], cam[2])

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, -0.4)

    const portal = buildPinkWallScene(renderer, scene, { onStatus: setStatus })
    portal.anchor.visible = true
    apiRef.current = portal

    // contour de l'ouverture (debug)
    const showOutline = (() => {
      try {
        return new URLSearchParams(window.location.search).get('outline') === '1'
      } catch {
        return false
      }
    })()
    if (showOutline) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(CFG.wallSize, CFG.wallSize)),
        new THREE.LineBasicMaterial({ color: 0xff3366 })
      )
      portal.anchor.add(outline)
    }

    portal.ready.then(() => {
      if (!disposed) setTimeout(() => portal.playIntro(), 400)
    })

    // clic sur le lipstick = ouvrir / fermer (comme /gloss)
    let downPos = null
    renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY }
    })
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downPos) return
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      downPos = null
      if (moved > 6) return
      const proxy = portal.getProxy()
      if (!proxy) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      }
      const rc = new THREE.Raycaster()
      rc.setFromCamera(ndc, camera)
      if (rc.intersectObject(proxy, false).length) portal.toggleCap()
    })

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // MODE debug AR : reproduit les conditions 8th Wall (autoClear=false + marqueur
    // qui bouge) pour traquer le bug de traînée du portail.  ?ar=1
    const arSim = (() => {
      try { return new URLSearchParams(window.location.search).get('ar') === '1' } catch { return false }
    })()
    const gl = renderer.getContext()
    if (arSim) {
      renderer.autoClear = false
      controls.enabled = false
    }

    let last = performance.now()
    let raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      if (arSim) {
        // simulate le flux caméra (efface la COULEUR seulement, pas depth/stencil)
        gl.clearColor(0.08, 0.07, 0.09, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        // marqueur qui bouge (comme quand on déplace le téléphone)
        const t = now * 0.001
        portal.anchor.position.set(Math.sin(t * 1.3) * 0.7, Math.cos(t) * 0.4, 0)
        portal.anchor.rotation.z = Math.sin(t * 0.6) * 0.25
      }
      portal.update(dt)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  const btn = {
    padding: '10px 18px',
    background: 'linear-gradient(180deg, #ffb3d9 0%, #ff6fb0 100%)',
    color: '#3d0f33',
    border: 'none',
    borderRadius: 3,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1016' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => apiRef.current?.playIntro()}>REJOUER</button>
        <button style={btn} onClick={() => apiRef.current?.toggleCap()}>OUVRIR / FERMER</button>
        <span style={{ color: '#ffd6ec', fontSize: 12, opacity: 0.85 }}>
          Glisser = pivoter · Molette = zoom · Clic sur le lipstick = ouvrir
        </span>
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#ff9ecb', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        {status}
      </div>
    </div>
  )
}
