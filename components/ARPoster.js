'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildPosterBubbleScene } from '@/lib/posterBubbleScene'

// Calibration de la taille de l'overlay sur l'affiche physique.
// L'échelle suit AUTOMATIQUEMENT la taille du marqueur détecté (detail.scale) ; ce
// facteur n'est qu'une constante de calage (le plan est déjà à l'aspect de l'affiche).
// Réglable en direct via les boutons +/− (ou ?fit=).
const DEFAULT_FIT = 0.76

export default function ARPoster() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [fit, setFit] = useState(() => {
    try {
      const q = parseFloat(new URLSearchParams(window.location.search).get('fit'))
      if (q) return q
    } catch {}
    return DEFAULT_FIT
  })
  const fitRef = useRef(fit)
  useEffect(() => { fitRef.current = fit }, [fit])

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return

    window.THREE = THREE

    let disposed = false
    let portal = null
    let lostTimer = null
    let cameraRef = null
    const raycaster = new THREE.Raycaster()

    const applyPose = (detail) => {
      if (!portal) return
      portal.anchor.position.copy(detail.position)
      portal.anchor.quaternion.copy(detail.rotation)
      portal.anchor.scale.setScalar(detail.scale * fitRef.current) // fit ajustable en direct
    }
    const showModel = (detail) => {
      if (lostTimer) { clearTimeout(lostTimer); lostTimer = null }
      applyPose(detail)
      if (portal) portal.anchor.visible = true
    }

    const onImageFound = ({ detail }) => {
      if (detail.name !== 'poster' || !portal) return
      showModel(detail)
      if (!portal.hasPlayedIntro()) portal.playIntro()
      setStatus('Tapotez la bulle pour l’éclater')
    }
    let revealHinted = false
    const onImageUpdated = ({ detail }) => {
      if (detail.name !== 'poster') return
      showModel(detail)
      if (!revealHinted && portal?.isRevealed?.()) {
        revealHinted = true
        setStatus('Tapotez le lipstick pour l’ouvrir')
      }
    }
    const onImageLost = ({ detail }) => {
      if (detail.name !== 'poster' || lostTimer) return
      lostTimer = setTimeout(() => {
        if (portal) portal.anchor.visible = false
        lostTimer = null
        setStatus('Cherchez l’affiche LOVENUDE…')
      }, 500)
    }

    let lastT = performance.now()
    const scenePipelineModule = () => ({
      name: 'ysl-poster',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildPosterBubbleScene(renderer, scene, { onStatus: setStatus })
        portal.ready.then(() => setStatus('Cherchez l’affiche LOVENUDE…'))
      },
      onUpdate: () => {
        const now = performance.now()
        const dt = Math.min((now - lastT) / 1000, 0.05)
        lastT = now
        if (portal) portal.update(dt)
      },
      listeners: [
        { event: 'reality.imagefound', process: onImageFound },
        { event: 'reality.imageupdated', process: onImageUpdated },
        { event: 'reality.imagelost', process: onImageLost },
      ],
    })

    const onTap = (ev) => {
      const proxy = portal?.getProxy()
      if (!portal || !portal.anchor.visible || !proxy || !cameraRef || !portal.hasPlayedIntro()) return
      const ndc = {
        x: (ev.clientX / window.innerWidth) * 2 - 1,
        y: -(ev.clientY / window.innerHeight) * 2 + 1,
      }
      cameraRef.updateMatrixWorld()
      cameraRef.projectionMatrixInverse.copy(cameraRef.projectionMatrix).invert()
      raycaster.setFromCamera(ndc, cameraRef)
      if (!raycaster.intersectObject(proxy, false).length) return
      if (!portal.isPopped()) {
        if (portal.popBubble()) setStatus('✨')
      } else if (portal.isRevealed()) {
        const open = portal.toggleOpen()
        setStatus(open ? 'Ouvert' : 'Tapotez pour ouvrir')
      }
    }

    const init = async () => {
      try {
        const data = await fetch('/image-targets/poster.json').then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) {
        console.error('[ARPoster] cible', e)
        setStatus('Erreur : cible image introuvable')
        return
      }
      if (disposed) return

      XR8.addCameraPipelineModules([
        XRExtras.FullWindowCanvas.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        scenePipelineModule(),
      ])
      XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY })

      const canvasEl = canvasRef.current
      canvasEl.addEventListener('pointerdown', onTap)
      init._cleanup = () => canvasEl.removeEventListener('pointerdown', onTap)
    }
    init()

    return () => {
      disposed = true
      if (lostTimer) clearTimeout(lostTimer)
      init._cleanup?.()
      try { window.XR8?.stop?.() } catch {}
    }
  }, [])

  const fitBtn = {
    width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(201,164,92,0.6)',
    background: 'rgba(0,0,0,0.35)', color: '#EFE9DC', fontSize: 20, lineHeight: '30px', cursor: 'pointer',
  }
  const controls = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, pointerEvents: 'none' }}>
      {/* calibration taille en direct */}
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 12px)', left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(201,164,92,0.4)', borderRadius: 999, padding: '6px 12px', pointerEvents: 'auto' }}>
          <button style={fitBtn} onClick={() => setFit((f) => Math.max(0.2, +(f - 0.05).toFixed(2)))}>−</button>
          <span style={{ color: '#EFE9DC', fontSize: 12, minWidth: 82, textAlign: 'center', letterSpacing: '0.12em' }}>TAILLE {fit.toFixed(2)}</span>
          <button style={fitBtn} onClick={() => setFit((f) => +(f + 0.05).toFixed(2))}>+</button>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 36px)',
          left: 0, right: 0, textAlign: 'center',
          color: '#EFE9DC', textShadow: '0 1px 6px rgba(0,0,0,0.85)',
          textTransform: 'uppercase', letterSpacing: '0.22em', paddingLeft: '0.22em', fontSize: 11,
        }}
      >
        {status}
      </div>
    </div>
  )

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {typeof document !== 'undefined' && reactPortal(controls, document.body)}
    </>
  )
}
