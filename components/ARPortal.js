'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildPortalScene } from '@/lib/portalScene'

export default function ARPortal() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return

    window.THREE = THREE

    // 8th Wall crée le contexte WebGL sur notre canvas SANS stencil. On intercepte
    // getContext pour forcer stencil:true à la création (sinon le masque stencil du
    // portail est inopérant en AR).
    const glCanvas = canvasRef.current
    if (glCanvas && !glCanvas.__stencilForced) {
      const origGetContext = glCanvas.getContext.bind(glCanvas)
      glCanvas.getContext = (type, attrs) =>
        origGetContext(
          type,
          typeof type === 'string' && type.indexOf('webgl') !== -1
            ? { ...(attrs || {}), stencil: true }
            : attrs
        )
      glCanvas.__stencilForced = true
    }

    let disposed = false
    let rafId = null
    let lastT = performance.now()
    let portal = null
    let lostTimer = null
    let cameraRef = null
    const raycaster = new THREE.Raycaster()

    const applyPose = (detail) => {
      if (!portal) return
      portal.anchor.position.copy(detail.position)
      portal.anchor.quaternion.copy(detail.rotation)
      portal.anchor.scale.setScalar(detail.scale)
    }
    const showModel = (detail) => {
      if (lostTimer) {
        clearTimeout(lostTimer)
        lostTimer = null
      }
      applyPose(detail)
      if (portal) portal.anchor.visible = true
    }

    const onImageFound = ({ detail }) => {
      if (detail.name !== 'book' || !portal) return
      showModel(detail)
      if (!portal.hasPlayedIntro()) portal.playIntro()
      setStatus('Tapotez le mascara pour l’ouvrir')
    }
    const onImageUpdated = ({ detail }) => {
      if (detail.name !== 'book') return
      showModel(detail)
    }
    const onImageLost = ({ detail }) => {
      if (detail.name !== 'book' || lostTimer) return
      lostTimer = setTimeout(() => {
        if (portal) portal.anchor.visible = false
        lostTimer = null
        setStatus('Cherchez la couverture du livre…')
      }, 500)
    }

    const scenePipelineModule = () => ({
      name: 'ysl-portal',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildPortalScene(renderer, scene, { onStatus: setStatus })
        portal.ready.then(() => setStatus('Cherchez la couverture du livre…'))
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
      if (!portal || !portal.anchor.visible || !proxy || !cameraRef) return
      const ndc = {
        x: (ev.clientX / window.innerWidth) * 2 - 1,
        y: -(ev.clientY / window.innerHeight) * 2 + 1,
      }
      cameraRef.updateMatrixWorld()
      cameraRef.projectionMatrixInverse.copy(cameraRef.projectionMatrix).invert()
      raycaster.setFromCamera(ndc, cameraRef)
      if (raycaster.intersectObject(proxy, false).length) {
        const open = portal.toggleCap()
        setStatus(open ? 'Mascara ouvert' : 'Tapotez pour ouvrir')
      }
    }

    const init = async () => {
      try {
        const data = await fetch('/image-targets/book.json').then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) {
        console.error('[ARPortal] cible', e)
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
      if (rafId) cancelAnimationFrame(rafId)
      init._cleanup?.()
      try {
        window.XR8?.stop?.()
      } catch {}
    }
  }, [])

  const controls = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 36px)',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: '#EFE9DC',
          textShadow: '0 1px 6px rgba(0,0,0,0.85)',
          textTransform: 'uppercase',
          letterSpacing: '0.22em',
          paddingLeft: '0.22em',
          fontSize: 11,
        }}
      >
        {status}
      </div>
    </div>
  )

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {typeof document !== 'undefined' && reactPortal(controls, document.body)}
    </>
  )
}
