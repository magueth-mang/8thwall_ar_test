'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildRoomBounceScene } from '@/lib/roomBounceScene'

// TEST des limites de 8th Wall : on "scanne" la pièce (hit-test sur une grille → nuage
// de points en direct), le SOL est auto-détecté, on ajoute les MURS en visant, et des
// balles rebondissent dessus. Montre concrètement ce que 8th Wall comprend de la pièce.
const N_POINTS = 2600

export default function ARRoomBounce() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [walls, setWalls] = useState(0)
  const [floorOk, setFloorOk] = useState(false)
  const apiRef = useRef({})

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return
    window.THREE = THREE

    let portal = null
    let cameraRef = null
    let reticle = null
    let cloud = null
    let cloudPos = null
    let writeIdx = 0
    let filled = 0
    let frame = 0
    const ys = [] // pour détecter le sol
    const reticleSmooth = new THREE.Vector3()
    let reticleHas = false
    const _n = new THREE.Vector3(), _fwd = new THREE.Vector3(), _pos = new THREE.Vector3()

    // grille de points écran pour le "scan"
    const grid = []
    for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < 5; gy++) grid.push([0.12 + gx * 0.19, 0.14 + gy * 0.18])

    const scenePipelineModule = () => ({
      name: 'ysl-bounce',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildRoomBounceScene(renderer, scene, { onStatus: setStatus })
        apiRef.current.portal = portal

        // nuage de points (le "scan" visible)
        const geo = new THREE.BufferGeometry()
        cloudPos = new Float32Array(N_POINTS * 3)
        geo.setAttribute('position', new THREE.BufferAttribute(cloudPos, 3))
        geo.setDrawRange(0, 0)
        cloud = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xC9A45C, size: 0.012, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }))
        cloud.frustumCulled = false
        scene.add(cloud)

        // réticule
        reticle = new THREE.Mesh(
          new THREE.RingGeometry(0.045, 0.07, 36),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
        )
        reticle.rotation.x = -Math.PI / 2
        reticle.renderOrder = 999
        reticle.visible = false
        scene.add(reticle)

        portal.ready.then(() => setStatus('Balayez lentement la pièce (sol + murs) pour scanner'))
      },
      onUpdate: () => {
        if (!portal) return
        frame++
        // 1) SCAN : hit-test de quelques points de la grille par frame → nuage
        const base = (frame * 4) % grid.length
        for (let k = 0; k < 4; k++) {
          const g = grid[(base + k) % grid.length]
          let hits = []
          try { hits = XR8.XrController.hitTest(g[0], g[1], ['ESTIMATED_SURFACE', 'FEATURE_POINT']) || [] } catch (e) {}
          if (hits.length) {
            const p = hits[0].position
            cloudPos[writeIdx * 3] = p.x; cloudPos[writeIdx * 3 + 1] = p.y; cloudPos[writeIdx * 3 + 2] = p.z
            writeIdx = (writeIdx + 1) % N_POINTS
            filled = Math.min(filled + 1, N_POINTS)
            ys.push(p.y); if (ys.length > 3000) ys.shift()
          }
        }
        if (cloud) { cloud.geometry.attributes.position.needsUpdate = true; cloud.geometry.setDrawRange(0, filled) }

        // 2) réticule lissé (centre écran)
        let ch = []
        try { ch = XR8.XrController.hitTest(0.5, 0.5, ['ESTIMATED_SURFACE', 'FEATURE_POINT']) || [] } catch (e) {}
        if (ch.length) {
          const p = ch[0].position
          if (!reticleHas) { reticleSmooth.set(p.x, p.y, p.z); reticleHas = true }
          else reticleSmooth.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.25)
          reticle.visible = true
          reticle.position.copy(reticleSmooth)
        } else { reticle.visible = false; reticleHas = false }

        // 3) SOL AUTO : ~15e percentile des Y (le sol = surface la plus basse dominante)
        if (frame % 20 === 0 && ys.length > 250) {
          const s = ys.slice().sort((a, b) => a - b)
          const fy = s[Math.floor(s.length * 0.12)]
          portal.setFloor(fy)
          if (!floorOk) setFloorOk(true)
        }

        portal.update(1 / 60)
      },
    })

    XR8.addCameraPipelineModules([
      XRExtras.FullWindowCanvas.pipelineModule(),
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      scenePipelineModule(),
    ])
    XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY })

    apiRef.current.addWall = () => {
      if (!portal || !reticle || !reticle.visible || !cameraRef) { setStatus('Aucune surface visée — bougez le téléphone'); return }
      _n.copy(cameraRef.position).sub(reticle.position) // normale vers la caméra
      portal.addSurface(reticle.position.clone(), _n)
      setWalls(portal.surfaceCount())
    }
    apiRef.current.throwBall = () => {
      if (!portal || !cameraRef) return
      cameraRef.getWorldDirection(_fwd)
      _pos.copy(cameraRef.position).addScaledVector(_fwd, 0.3)
      const vel = _fwd.clone().multiplyScalar(2.6); vel.y += 0.6
      portal.dropBall(_pos.clone(), vel)
    }
    apiRef.current.reset = () => { portal?.reset(); setWalls(0); setFloorOk(false); ys.length = 0; filled = 0; writeIdx = 0; if (cloud) cloud.geometry.setDrawRange(0, 0) }

    return () => { try { window.XR8?.stop?.() } catch {} }
  }, [])

  const btn = { padding: '12px 18px', borderRadius: 999, border: 'none', background: 'linear-gradient(180deg, #D8BE86 0%, #C9A45C 100%)', color: '#0a0a0a', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', cursor: 'pointer', pointerEvents: 'auto' }
  const ghost = { ...btn, background: 'rgba(0,0,0,0.45)', color: '#EFE9DC', border: '1px solid rgba(201,164,92,0.5)' }

  const controls = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 24, height: 24, marginLeft: -12, marginTop: -12, border: '2px solid rgba(255,255,255,0.85)', borderRadius: 999 }} />
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 12px)', left: 0, right: 0, textAlign: 'center', color: '#EFE9DC', fontSize: 11, letterSpacing: '0.12em' }}>
        SOL {floorOk ? '✓' : '…'} · MURS {walls}
      </div>
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom,0px) + 28px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', padding: '0 12px' }}>
        <button style={ghost} onClick={() => apiRef.current.addWall?.()}>+ MUR</button>
        <button style={btn} onClick={() => apiRef.current.throwBall?.()}>BALLE</button>
        <button style={ghost} onClick={() => apiRef.current.reset?.()}>RESET</button>
      </div>
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom,0px) + 78px)', left: 0, right: 0, textAlign: 'center', color: '#EFE9DC', textShadow: '0 1px 6px rgba(0,0,0,0.85)', textTransform: 'uppercase', letterSpacing: '0.14em', fontSize: 10 }}>{status}</div>
    </div>
  )

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {typeof document !== 'undefined' && reactPortal(controls, document.body)}
    </>
  )
}
