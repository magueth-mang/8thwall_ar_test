'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildMajorellePerfumeScene, applyMajorellePose, MJ_CFG as CFG } from '@/lib/majorellePerfumeScene'
import { PerfumeOverlay } from '@/components/PerfumeOverlay'
import { PB_COPY } from '@/lib/majorelle/perfumeConfig'

// « BLEU INTERDIT » en AR (8th Wall) : copie d'ARMajorelle avec le directeur parfum, PerfumeOverlay et tapAt
// sur un pointerup non capturé (eau du bassin vue par la porte, porte).
// L'échelle est calculée depuis la cible (applyMajorellePose) ; ce facteur n'est qu'un calage fin.
const DEFAULT_FIT = 1.0
// ?rot=0|90|-90 force l'orientation si 8th Wall rapporte la cible couchée ; ?q=high|medium|low force la qualité
const QS = (() => { try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() } })()
const ROT_OVERRIDE = QS.get('rot') === null ? null : Number(QS.get('rot'))
const QUALITY = QS.get('q') || undefined

export default function ARMajorellePerfume() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [view, setView] = useState({ state: 'loading', knocks: 0, unlocked: false, signed: false })
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
      if (!loggedTarget) { loggedTarget = true; console.info('[ARMajorellePerfume] cible', { scale: detail.scale, scaledWidth: detail.scaledWidth, scaledHeight: detail.scaledHeight }) }
      applyMajorellePose(portal.anchor, detail, fitRef.current, ROT_OVERRIDE)
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
      name: 'ysl-jardin-majorelle-parfum',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildMajorellePerfumeScene(renderer, scene, {
          onStatus: setStatus,
          onState: (state, info) => setView({ state, knocks: info.knocks, unlocked: info.unlocked, signed: info.signed }),
          quality: QUALITY,
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

    // gestes → scène : interface et flacon (capturés), sinon un toucher bref va à tapAt (eau, porte)
    const ndcOf = (e) => ({ x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 })
    const prepCam = () => {
      cameraRef.updateMatrixWorld()
      cameraRef.projectionMatrixInverse.copy(cameraRef.projectionMatrix).invert()
    }
    const downs = new Map()
    const onDown = (e) => {
      if (!portal || !cameraRef) return
      prepCam()
      const n = ndcOf(e)
      const cap = portal.pointerDown(n, cameraRef, e.pointerId)
      downs.set(e.pointerId, { x: n.x, y: n.y, cap })
      if (cap) canvasRef.current?.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e) => { if (portal && cameraRef) portal.pointerMove(ndcOf(e), cameraRef, e.pointerId) }
    const onUp = (e) => {
      if (!portal || !cameraRef) return
      prepCam()
      const n = ndcOf(e)
      const d = downs.get(e.pointerId); downs.delete(e.pointerId)
      portal.pointerUp(n, cameraRef, e.pointerId)
      if (d && !d.cap && Math.hypot(n.x - d.x, n.y - d.y) < 0.03) portal.tapAt(n, cameraRef)
    }
    const onCancel = (e) => { downs.delete(e.pointerId); if (portal) portal.pointerCancel(e.pointerId) }

    const init = async () => {
      try {
        const data = await fetch(CFG.targetDataUrl).then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) { console.error('[ARMajorellePerfume] cible', e); setStatus('Erreur : cible introuvable'); return }
      if (disposed) return
      // la texture caméra de XR8.Threejs (xrScene().cameraTexture) ne sert à rien ici : la couper économise un blit
      // plein écran et un gl.finish() par image, plus que le coût de la copie d'écran du flacon (screenRefraction.js)
      if (XR8.Threejs.configure) XR8.Threejs.configure({ renderCameraTexture: false })
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

    // appui long (VAPORISER, rotation du flacon) : pas de loupe, de sélection de texte ni de menu « copier » du système
    const body = document.body.style
    const prevSel = [body.webkitUserSelect, body.userSelect, body.webkitTouchCallout, body.webkitTapHighlightColor]
    body.webkitUserSelect = 'none'; body.userSelect = 'none'; body.webkitTouchCallout = 'none'; body.webkitTapHighlightColor = 'transparent'
    const block = (e) => e.preventDefault()
    document.addEventListener('contextmenu', block)
    document.addEventListener('selectstart', block)

    return () => {
      disposed = true
      ;[body.webkitUserSelect, body.userSelect, body.webkitTouchCallout, body.webkitTapHighlightColor] = prevSel
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('selectstart', block)
      if (lostTimer) clearTimeout(lostTimer)
      init._cleanup?.()
      reapplyRef.current = null
      try { window.XR8?.stop?.() } catch {}
      try { window.XR8?.clearCameraPipelineModules?.() } catch {} // sinon les modules s'empilent au retour sur la page
      portalRef.current = null
    }
  }, [])

  const hint = tracking || view.state === 'loading' ? status : 'Visez la porte bleue'
  const overlay = (
    <PerfumeOverlay view={view} status={hint} title="Jardin Majorelle" titleVisible={tracking} endCard={PB_COPY.endCard} onReplay={() => portalRef.current?.replay()} />
  )

  return (
    <>
      <canvas ref={canvasRef} onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }} />
      {typeof document !== 'undefined' && reactPortal(overlay, document.body)}
    </>
  )
}
