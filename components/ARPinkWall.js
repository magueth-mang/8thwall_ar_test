'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { buildPinkWallScene } from '@/lib/pinkWallScene'

// Échelle calée sur le QR physique (identique à l'effet espace).
const WALL_FIT = 0.8

export default function ARPinkWall() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return

    window.THREE = THREE

    // Forcer stencil:true à la création du contexte WebGL (sinon le portail rose
    // s'affiche partout). Voir stencil-portal-8thwall.
    // Forcer stencil:true à la création du contexte WebGL de NOTRE canvas, sans quoi
    // le portail rose n'est pas masqué et bave sur tout l'écran quand on bouge.
    // 8th Wall appelle parfois `HTMLCanvasElement.prototype.getContext` DIRECTEMENT
    // → un patch posé sur l'instance est contourné. On patche donc le PROTOTYPE (ciblé
    // sur notre canvas), et on LAISSE 8th Wall créer le contexte lui-même (webgl1/2 au
    // choix) → la caméra fonctionne ET le buffer stencil existe. Voir stencil-portal-8thwall.
    const glCanvas = canvasRef.current
    const CanvasProto = window.HTMLCanvasElement.prototype
    const origProtoGetContext = CanvasProto.getContext
    CanvasProto.getContext = function (type, attrs) {
      if (this === glCanvas && typeof type === 'string' && type.indexOf('webgl') !== -1) {
        attrs = { ...(attrs || {}), stencil: true }
      }
      return origProtoGetContext.call(this, type, attrs)
    }

    let disposed = false
    let portal = null
    let lostTimer = null
    let cameraRef = null
    const raycaster = new THREE.Raycaster()

    const applyPose = (detail) => {
      if (!portal) return
      portal.anchor.position.copy(detail.position)
      portal.anchor.quaternion.copy(detail.rotation)
      portal.anchor.scale.setScalar(detail.scale * WALL_FIT)
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
      if (detail.name !== 'yslmarker' || !portal) return
      showModel(detail)
      if (!portal.hasPlayedIntro()) portal.playIntro()
      setStatus('Tapotez le lipstick pour l’ouvrir')
    }
    const onImageUpdated = ({ detail }) => {
      if (detail.name !== 'yslmarker') return
      showModel(detail)
    }
    const onImageLost = ({ detail }) => {
      if (detail.name !== 'yslmarker' || lostTimer) return
      lostTimer = setTimeout(() => {
        if (portal) portal.anchor.visible = false
        lostTimer = null
        setStatus('Cherchez l’image YSL…')
      }, 500)
    }

    let lastT = performance.now()
    const scenePipelineModule = () => ({
      name: 'ysl-pinkwall',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera
        portal = buildPinkWallScene(renderer, scene, { onStatus: setStatus })
        portal.ready.then(() => setStatus('Cherchez l’image YSL…'))
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

    const init = async () => {
      try {
        const data = await fetch('/image-targets/yslmarker.json').then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) {
        console.error('[ARPinkWall] cible', e)
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
        setStatus(open ? 'Lipstick ouvert' : 'Tapotez pour ouvrir')
      }
    }

    init()

    return () => {
      disposed = true
      if (lostTimer) clearTimeout(lostTimer)
      init._cleanup?.()
      CanvasProto.getContext = origProtoGetContext
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
          color: '#ffd6ec',
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
