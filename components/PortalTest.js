'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildPortalScene, CFG } from '@/lib/portalScene'

export default function PortalTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const apiRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      stencil: true, // indispensable pour le portail
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x232a30) // fond non noir : révèle tout débordement

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.01,
      100
    )
    // position caméra initiale (surchargée par ?cam=x,y,z pour le debug)
    let cam = [1.4, 1.1, 2.2]
    try {
      const q = new URLSearchParams(window.location.search).get('cam')
      if (q) cam = q.split(',').map(Number)
    } catch {}
    camera.position.set(cam[0], cam[1], cam[2])

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, -0.2)

    // repères : plan de "surface" (grille) + contour de l'ouverture
    const grid = new THREE.GridHelper(4, 20, 0x445566, 0x2c3640)
    grid.rotation.x = Math.PI / 2 // grille dans le plan X-Y (la surface du livre)
    scene.add(grid)

    // construit la scène portail (mêmes objets qu'en AR)
    const portal = buildPortalScene(renderer, scene, { onStatus: setStatus })
    portal.anchor.visible = true
    apiRef.current = portal

    // DEBUG : contour de l'ouverture (rouge). Un vrai portail au stencil garde
    // tout l'intérieur DANS ce contour ; une boîte 3D déborderait.
    const ofw = CFG.imageWidth * CFG.coverFit
    const ofh = (CFG.imageWidth / CFG.bookAspect) * CFG.coverFit
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(ofw, ofh)),
      new THREE.LineBasicMaterial({ color: 0xff3366 })
    )
    portal.anchor.add(outline)

    // contour de l'ouverture (pour visualiser le "trou")
    portal.ready.then(() => {
      if (disposed) return
      portal.playIntro()
    })

    // clic sur le mascara -> toggle (sans gêner l'orbite : seulement si pas de drag)
    let downPos = null
    renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY }
    })
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downPos) return
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      downPos = null
      if (moved > 6) return // c'était un drag d'orbite
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

    let last = performance.now()
    let raf = null
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

  const btn = {
    padding: '10px 18px',
    background: 'linear-gradient(180deg, #D8BE86 0%, #C9A45C 100%)',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: 3,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.12em',
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#232a30' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button style={btn} onClick={() => apiRef.current?.playIntro()}>
          REJOUER L’INTRO
        </button>
        <button style={btn} onClick={() => apiRef.current?.toggleCap()}>
          OUVRIR / FERMER
        </button>
        <span style={{ color: '#EFE9DC', fontSize: 12, opacity: 0.85 }}>
          Glisser = pivoter · Molette = zoom · Clic sur le mascara = ouvrir
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: 16,
          color: '#C9A45C',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        {status}
      </div>
    </div>
  )
}
