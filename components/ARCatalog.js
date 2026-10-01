'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildYslPortalScene, applyTargetPose, CFG } from '@/lib/yslPortalScene'
import { PortalOverlay } from '@/components/PortalOverlay'

// L'échelle est calculée depuis la cible (applyTargetPose) ; ce facteur n'est qu'un calage fin.
const DEFAULT_FIT = 1.0
// ?rot=0|90|-90 force l'orientation si 8th Wall rapporte la cible debout (isRotated)
const ROT_OVERRIDE = (() => { try { const q = new URLSearchParams(window.location.search).get('rot'); return q === null ? null : Number(q) } catch { return null } })()

export default function ARCatalog() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [view, setView] = useState({ state: 'loading', shade: null, open: false })
  const [tracking, setTracking] = useState(false)
  const fitRef = useRef(DEFAULT_FIT)
  const [fit, setFit] = useState(DEFAULT_FIT)
  const lastDetailRef = useRef(null)
  const reapplyRef = useRef(null)
  const portalRef = useRef(null)

  const adjustFit = (d) => {
    const v = Math.max(0.3, Math.min(2, Math.round((fitRef.current + d) * 100) / 100))
    fitRef.current = v; setFit(v); reapplyRef.current && reapplyRef.current()
  }

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return
    window.THREE = THREE

    let disposed = false
    let portal = null
    let lostTimer = null
    let cameraRef = null
    let loggedTarget = false

    const applyPose = (detail) => {
      if (!portal) return
      lastDetailRef.current = detail
      if (!loggedTarget) { loggedTarget = true; console.info('[ARCatalog] cible', { scale: detail.scale, scaledWidth: detail.scaledWidth, scaledHeight: detail.scaledHeight }) }
      applyTargetPose(portal.anchor, detail, fitRef.current, ROT_OVERRIDE)
    }
    const show = (detail) => {
      if (lostTimer) { clearTimeout(lostTimer); lostTimer = null }
      applyPose(detail)
      if (portal) {
        portal.anchor.visible = true
        if (!portal.hasPlayedIntro()) portal.playIntro() // sans effet tant que les assets chargent ; démarre dès qu'ils sont prêts
      }
      setTracking(true)
    }
    reapplyRef.current = () => { if (lastDetailRef.current) applyPose(lastDetailRef.current) }

    const onImageFound = ({ detail }) => {
      if (detail.name !== CFG.targetName || !portal) return
      show(detail)
    }
    const onImageUpdated = ({ detail }) => { if (detail.name === CFG.targetName) show(detail) }
    const onImageLost = ({ detail }) => {
      if (detail.name !== CFG.targetName || lostTimer) return
      lostTimer = setTimeout(() => { if (portal) portal.anchor.visible = false; lostTimer = null; setTracking(false) }, 600)
    }

    let lastT = performance.now()
    const scenePipelineModule = () => ({
      name: 'ysl-salon-secret',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildYslPortalScene(renderer, scene, {
          onStatus: setStatus,
          onState: (state, info) => setView({ state, shade: info.shade, open: info.open }),
        })
        portal.setCamera(camera)
        portalRef.current = portal
        // si la porte a été détectée pendant le chargement, l'intro part dès que tout est prêt
        const p = portal
        p.ready.then(() => { if (!disposed && portal === p && p.anchor.visible && !p.hasPlayedIntro()) p.playIntro() })
      },
      onUpdate: () => {
        const now = performance.now(); const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now
        if (portal) portal.update(dt)
      },
      listeners: [
        { event: 'reality.imagefound', process: onImageFound },
        { event: 'reality.imageupdated', process: onImageUpdated },
        { event: 'reality.imagelost', process: onImageLost },
      ],
    })

    // gestes → scène (produit, pastilles, médaillons)
    const ndcOf = (e) => ({ x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 })
    const prepCam = () => {
      cameraRef.updateMatrixWorld()
      cameraRef.projectionMatrixInverse.copy(cameraRef.projectionMatrix).invert()
    }
    const onDown = (e) => { if (!portal || !cameraRef) return; prepCam(); if (portal.pointerDown(ndcOf(e), cameraRef, e.pointerId)) canvasRef.current?.setPointerCapture?.(e.pointerId) }
    const onMove = (e) => { if (portal && cameraRef) portal.pointerMove(ndcOf(e), cameraRef, e.pointerId) }
    const onUp = (e) => { if (portal && cameraRef) { prepCam(); portal.pointerUp(ndcOf(e), cameraRef, e.pointerId) } }
    const onCancel = (e) => { if (portal) portal.pointerCancel(e.pointerId) }

    const init = async () => {
      try {
        const data = await fetch(CFG.targetDataUrl).then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) { console.error('[ARCatalog] cible', e); setStatus('Erreur : cible introuvable'); return }
      if (disposed) return
      XR8.addCameraPipelineModules([
        XRExtras.FullWindowCanvas.pipelineModule(),
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        scenePipelineModule(),
      ])
      XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY })
      const el = canvasRef.current
      el.addEventListener('pointerdown', onDown)
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onCancel)
      init._cleanup = () => {
        el.removeEventListener('pointerdown', onDown)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onCancel)
      }
    }
    init()

    return () => {
      disposed = true
      if (lostTimer) clearTimeout(lostTimer)
      init._cleanup?.()
      reapplyRef.current = null
      try { window.XR8?.stop?.() } catch {}
      try { window.XR8?.clearCameraPipelineModules?.() } catch {} // sinon les modules s'empilent au retour sur la page
      portalRef.current = null
    }
  }, [])

  const fitBtn = { pointerEvents: 'auto', width: 34, height: 34, borderRadius: 999, border: '1px solid rgba(201,164,92,0.5)', background: 'rgba(0,0,0,0.45)', color: '#EFE9DC', fontSize: 18, lineHeight: '32px', padding: 0 }
  const hint = tracking || view.state === 'loading' ? status : 'Visez la porte YSL'
  const overlay = (
    <PortalOverlay view={view} status={hint} onReplay={() => portalRef.current?.replay()} bottomOffset={44}>
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom,0px) + 22px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, opacity: 0.75 }}>
        <button style={fitBtn} onClick={() => adjustFit(-0.03)}>−</button>
        <div style={{ color: '#C9A45C', fontSize: 10, letterSpacing: '0.18em', minWidth: 80, textAlign: 'center', textShadow: '0 1px 6px rgba(0,0,0,0.85)' }}>TAILLE {fit.toFixed(2)}</div>
        <button style={fitBtn} onClick={() => adjustFit(0.03)}>+</button>
      </div>
    </PortalOverlay>
  )

  return (
    <>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      {typeof document !== 'undefined' && reactPortal(overlay, document.body)}
    </>
  )
}
