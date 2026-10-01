'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildWallDropScene } from '@/lib/wallDropScene'

// Placement libre (world tracking + hit-test) : on vise une surface, un réticule suit,
// on appuie sur POSER → le portail apparaît et l'objet tombe sur le VRAI sol détecté.
export default function ARWallDrop() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [placed, setPlaced] = useState(false)
  const [scale, setScale] = useState(0.35)
  const scaleRef = useRef(scale)
  useEffect(() => { scaleRef.current = scale }, [scale])
  const apiRef = useRef({})

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return
    window.THREE = THREE

    let disposed = false
    let portal = null
    let cameraRef = null
    let reticle = null
    let lastHit = null
    let floorY = null // plancher = point le plus bas détecté
    let isPlaced = false

    const scenePipelineModule = () => ({
      name: 'ysl-worlddrop',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildWallDropScene(renderer, scene, { onStatus: setStatus })
        portal.anchor.visible = false
        apiRef.current.portal = portal

        // réticule (anneau) qui suit la surface visée
        reticle = new THREE.Group()
        const ringMesh = new THREE.Mesh(
          new THREE.RingGeometry(0.05, 0.075, 40),
          new THREE.MeshBasicMaterial({ color: 0xC9A45C, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
        )
        ringMesh.rotation.x = -Math.PI / 2 // à plat sur la surface
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.012, 20),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
        )
        dot.rotation.x = -Math.PI / 2
        reticle.add(ringMesh); reticle.add(dot)
        reticle.renderOrder = 999
        reticle.visible = false
        scene.add(reticle)

        portal.ready.then(() => setStatus('Visez une surface puis appuyez sur POSER'))
      },
      onUpdate: () => {
        if (!portal) return
        // hit-test au centre de l'écran → réticule
        if (!isPlaced && reticle) {
          let hits = []
          try { hits = XR8.XrController.hitTest(0.5, 0.5, ['ESTIMATED_SURFACE', 'FEATURE_POINT']) || [] } catch (e) {}
          if (hits.length) {
            const h = hits[0]
            reticle.visible = true
            reticle.position.set(h.position.x, h.position.y, h.position.z)
            lastHit = h
            floorY = floorY == null ? h.position.y : Math.min(floorY, h.position.y)
          } else {
            reticle.visible = false
          }
        }
        portal.update(1 / 60)
      },
    })

    const init = () => {
      XR8.addCameraPipelineModules([
        XRExtras.FullWindowCanvas.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        scenePipelineModule(),
      ])
      // world tracking (pas de cible image)
      XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY })
    }
    init()

    // POSER : place le portail au réticule (face caméra), cale le sol, lance la chute
    apiRef.current.place = () => {
      if (!portal || !reticle || !reticle.visible || !cameraRef) { setStatus('Aucune surface détectée — bougez un peu le téléphone'); return }
      portal.anchor.position.copy(reticle.position)
      portal.anchor.scale.setScalar(scaleRef.current)
      // orienté face à la caméra, mais gardé vertical
      portal.anchor.lookAt(cameraRef.position.x, reticle.position.y, cameraRef.position.z)
      // sol réel = point le plus bas vu (fallback : 1 m sous le point posé)
      const fy = floorY != null ? floorY : reticle.position.y - 1.0
      portal.setFloorY(Math.min(fy, reticle.position.y - 0.02))
      portal.anchor.visible = true
      portal.playIntro()
      isPlaced = true
      setPlaced(true)
      reticle.visible = false
    }
    apiRef.current.replace = () => {
      if (!portal) return
      portal.anchor.visible = false
      isPlaced = false
      setPlaced(false)
      setStatus('Visez une surface puis appuyez sur POSER')
    }

    return () => {
      disposed = true
      try { window.XR8?.stop?.() } catch {}
    }
  }, [])

  const barBtn = { padding: '12px 22px', borderRadius: 999, border: 'none', background: 'linear-gradient(180deg, #D8BE86 0%, #C9A45C 100%)', color: '#0a0a0a', fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', cursor: 'pointer', pointerEvents: 'auto' }
  const smallBtn = { width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(201,164,92,0.6)', background: 'rgba(0,0,0,0.4)', color: '#EFE9DC', fontSize: 20, lineHeight: '30px', cursor: 'pointer', pointerEvents: 'auto' }

  const controls = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, pointerEvents: 'none' }}>
      {/* taille de la scène */}
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 12px)', left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(201,164,92,0.4)', borderRadius: 999, padding: '6px 12px', pointerEvents: 'auto' }}>
          <button style={smallBtn} onClick={() => setScale((s) => Math.max(0.1, +(s - 0.05).toFixed(2)))}>−</button>
          <span style={{ color: '#EFE9DC', fontSize: 11, minWidth: 92, textAlign: 'center', letterSpacing: '0.1em' }}>TAILLE {scale.toFixed(2)}</span>
          <button style={smallBtn} onClick={() => setScale((s) => +(s + 0.05).toFixed(2))}>+</button>
        </div>
      </div>
      {/* réticule visuel au centre (repère écran) */}
      {!placed && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 26, height: 26, marginLeft: -13, marginTop: -13, border: '2px solid rgba(201,164,92,0.9)', borderRadius: 999 }} />
      )}
      {/* bouton principal */}
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom,0px) + 30px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
        {!placed
          ? <button style={barBtn} onClick={() => apiRef.current.place?.()}>POSER LA SCÈNE</button>
          : <button style={barBtn} onClick={() => apiRef.current.replace?.()}>REPLACER</button>}
      </div>
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom,0px) + 82px)', left: 0, right: 0, textAlign: 'center', color: '#EFE9DC', textShadow: '0 1px 6px rgba(0,0,0,0.85)', textTransform: 'uppercase', letterSpacing: '0.18em', fontSize: 10 }}>{status}</div>
    </div>
  )

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {typeof document !== 'undefined' && reactPortal(controls, document.body)}
    </>
  )
}
