'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildRoomBounceScene } from '@/lib/roomBounceScene'

export default function RoomBounceTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('…')
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

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let cam = [2.4, 1.6, 3.2]
    try { const q = new URLSearchParams(window.location.search).get('cam'); if (q) cam = q.split(',').map(Number) } catch {}
    camera.position.set(cam[0], cam[1], cam[2])
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.6, 0)

    const grid = new THREE.GridHelper(6, 24, 0x554444, 0x2a2220)
    scene.add(grid)

    const portal = buildRoomBounceScene(renderer, scene, { onStatus: setStatus })
    apiRef.current = portal

    // pré-pose une "pièce" : sol + 3 murs (pour vérifier les rebonds sans SLAM)
    portal.addSurface(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)) // sol
    portal.addSurface(new THREE.Vector3(-1.4, 0.8, 0), new THREE.Vector3(1, 0, 0)) // mur gauche
    portal.addSurface(new THREE.Vector3(1.4, 0.8, 0), new THREE.Vector3(-1, 0, 0)) // mur droit
    portal.addSurface(new THREE.Vector3(0, 0.8, -1.4), new THREE.Vector3(0, 0, 1)) // mur fond

    // lâche des balles régulièrement
    let acc = 0
    const dropOne = () => {
      portal.dropBall(
        new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.8, (Math.random() - 0.5) * 1.2),
        new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5),
        0.09
      )
    }
    dropOne()

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)

    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      acc += dt
      if (acc > 1.4) { acc = 0; dropOne() }
      portal.update(dt)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  const btn = { padding: '10px 18px', background: 'linear-gradient(180deg,#f3d9df,#d99fb0)', color: '#3a1720', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#14100f' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={btn} onClick={() => apiRef.current?.clearBalls()}>VIDER</button>
        <span style={{ color: '#e9c9d2', fontSize: 12, opacity: 0.85 }}>Balles qui rebondissent (sol + murs)</span>
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#e0a', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{status}</div>
    </div>
  )
}
