'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildWallDropScene } from '@/lib/wallDropScene'

export default function WallDropTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
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
    scene.background = new THREE.Color(0x14100f)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let cam = [2.2, 1.0, 3.0]
    try { const q = new URLSearchParams(window.location.search).get('cam'); if (q) cam = q.split(',').map(Number) } catch {}
    camera.position.set(cam[0], cam[1], cam[2])

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.6, 0)

    // sol visible (le "vrai sol" en AR) à y=0 + grille
    const grid = new THREE.GridHelper(6, 24, 0x554444, 0x2a2220)
    scene.add(grid)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.001
    scene.add(floor)

    const portal = buildWallDropScene(renderer, scene, { onStatus: setStatus, floorY: 0 })
    // place le "mur" en hauteur, face à la caméra (comme un marqueur mural)
    portal.anchor.position.set(0, 1.2, 0)
    portal.anchor.visible = true
    apiRef.current = portal
    setTimeout(() => portal.playIntro(), 600)

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
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

  const btn = { padding: '10px 18px', background: 'linear-gradient(180deg,#f3d9df,#d99fb0)', color: '#3a1720', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#14100f' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={btn} onClick={() => apiRef.current?.reset()}>REJOUER</button>
        <span style={{ color: '#e9c9d2', fontSize: 12, opacity: 0.85 }}>Glisser = pivoter · Molette = zoom</span>
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#e0a', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{status}</div>
    </div>
  )
}
