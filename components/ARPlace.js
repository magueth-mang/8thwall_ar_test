'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ------- Réglages (ajustables en live) -------------------------------------
const CFG = {
  modelUrl: '/mascara.glb',
  targetHeight: 0.9, // hauteur du mascara posé, en mètres (grand = effet vitrine)
  capNodeName: 'HC HAUT', // partie qui se soulève (capuchon + brosse)
  openLiftRatio: 0.9, // amplitude d'ouverture (fraction de la hauteur)
  openDuration: 1.2, // secondes
  maxObjects: 8,
}
// ---------------------------------------------------------------------------

export default function ARPlace() {
  const canvasRef = useRef(null)
  const placeFnRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState('Bougez le téléphone vers une surface…')

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return

    // 8th Wall exige THREE en global pour son module Threejs
    window.THREE = THREE

    let disposed = false
    let template = null
    let reticle = null
    let groundReady = false
    let sceneRef = null
    let cameraRef = null
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    const tweens = []
    const placed = []

    // Oriente debout, met à l'échelle, pose la base au sol, calcule la levée du capuchon
    const prepareModel = (root) => {
      const wrap = new THREE.Group()
      root.updateMatrixWorld(true)
      let box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const longest =
        size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z'

      if (longest === 'x') wrap.rotation.z = Math.PI / 2
      else if (longest === 'z') wrap.rotation.x = -Math.PI / 2
      wrap.add(root)

      wrap.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrap)
      const standH = box.getSize(new THREE.Vector3()).y || 1
      const scale = CFG.targetHeight / standH
      wrap.scale.setScalar(scale)

      wrap.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrap)
      const c = box.getCenter(new THREE.Vector3())
      wrap.position.x -= c.x
      wrap.position.z -= c.z
      wrap.position.y -= box.min.y

      let cap = null
      root.traverse((o) => {
        if (o.name === CFG.capNodeName) cap = o
      })
      if (cap) {
        cap.userData.base = cap.position.clone()
        const amount = (CFG.targetHeight * CFG.openLiftRatio) / (scale || 1)
        const capBox = new THREE.Box3().setFromObject(cap)
        const rootBox = new THREE.Box3().setFromObject(root)
        const sign =
          Math.sign(
            capBox.getCenter(new THREE.Vector3())[longest] -
              rootBox.getCenter(new THREE.Vector3())[longest]
          ) || 1
        const lift = new THREE.Vector3()
        lift[longest] = sign * amount
        cap.userData.lift = lift
      }
      wrap.userData.cap = cap

      wrap.traverse((o) => {
        if (o.isMesh) o.castShadow = true
      })
      return wrap
    }

    const startOpen = (obj) => {
      const cap = obj.userData.cap
      if (!cap || !cap.userData.lift) return
      tweens.push({ cap, t: 0, from: cap.userData.base.clone(), lift: cap.userData.lift })
    }

    const place = () => {
      if (!template || !reticle || !reticle.visible || !sceneRef) {
        setStatus('Visez d’abord une surface plane')
        return
      }
      if (placed.length >= CFG.maxObjects) {
        setStatus('Assez d’objets posés')
        return
      }
      const obj = template.clone(true)
      let cap = null
      obj.traverse((o) => {
        if (o.name === CFG.capNodeName) cap = o
      })
      if (cap && template.userData.cap) {
        cap.userData.base = template.userData.cap.userData.base.clone()
        cap.userData.lift = template.userData.cap.userData.lift.clone()
      }
      obj.userData.cap = cap

      obj.position.copy(reticle.position)
      const dir = new THREE.Vector3()
        .subVectors(cameraRef.position, obj.position)
        .setY(0)
      if (dir.lengthSq() > 0) obj.rotation.y = Math.atan2(dir.x, dir.z)

      sceneRef.add(obj)
      placed.push(obj)
      setStatus('Objet posé ✦ — appuyez pour en poser un autre')
      startOpen(obj)
    }
    placeFnRef.current = place

    const scenePipelineModule = () => ({
      name: 'ysl-place',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        sceneRef = scene
        cameraRef = camera

        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFSoftShadowMap

        scene.add(new THREE.AmbientLight(0xffffff, 0.85))
        const key = new THREE.DirectionalLight(0xfff2d8, 1.15)
        key.position.set(1.5, 4, 2)
        key.castShadow = true
        key.shadow.mapSize.set(1024, 1024)
        key.shadow.camera.near = 0.5
        key.shadow.camera.far = 30
        scene.add(key)

        const shadowGround = new THREE.Mesh(
          new THREE.PlaneGeometry(50, 50),
          new THREE.ShadowMaterial({ opacity: 0.32 })
        )
        shadowGround.rotation.x = -Math.PI / 2
        shadowGround.receiveShadow = true
        scene.add(shadowGround)

        reticle = new THREE.Mesh(
          new THREE.RingGeometry(0.16, 0.2, 48),
          new THREE.MeshBasicMaterial({ color: 0xc9a45c, transparent: true, opacity: 0.9 })
        )
        reticle.rotation.x = -Math.PI / 2
        reticle.visible = false
        scene.add(reticle)

        new GLTFLoader().load(
          CFG.modelUrl,
          (gltf) => {
            if (disposed) return
            template = prepareModel(gltf.scene)
            groundReady = true
            setReady(true)
            setStatus('Visez une surface puis « poser un objet »')
          },
          undefined,
          (err) => {
            console.error('[ARPlace] chargement modèle', err)
            setStatus('Erreur : modèle 3D introuvable')
          }
        )
      },
      onUpdate: () => {
        if (reticle && cameraRef && groundReady) {
          raycaster.setFromCamera({ x: 0, y: 0 }, cameraRef)
          const hit = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(groundPlane, hit)) {
            reticle.position.copy(hit)
            reticle.visible = true
          } else {
            reticle.visible = false
          }
        }
        for (let i = tweens.length - 1; i >= 0; i--) {
          const tw = tweens[i]
          tw.t += 1 / 60
          const k = Math.min(tw.t / CFG.openDuration, 1)
          const e = 1 - Math.pow(1 - k, 3)
          tw.cap.position.copy(tw.from).addScaledVector(tw.lift, e)
          if (k >= 1) tweens.splice(i, 1)
        }
      },
    })

    XR8.addCameraPipelineModules([
      XRExtras.FullWindowCanvas.pipelineModule(), // plein écran + orientation portrait correcte
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      scenePipelineModule(),
    ])

    XR8.run({ canvas: canvasRef.current, allowedDevices: XR8.XrConfig.device().ANY })

    return () => {
      disposed = true
      try {
        window.XR8?.stop?.()
      } catch {}
    }
  }, [])

  // Contrôles rendus dans un portail vers <body> avec un z-index au-dessus des
  // overlays 8th Wall (qui montent jusqu'à ~9e5) : sinon le canvas les masque.
  const controls = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
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

      <button
        onClick={() => placeFnRef.current?.()}
        disabled={!ready}
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
          padding: '16px 40px',
          background: ready
            ? 'linear-gradient(180deg, #D8BE86 0%, #C9A45C 100%)'
            : 'rgba(201,164,92,0.3)',
          color: ready ? '#0a0a0a' : 'rgba(239,233,220,0.5)',
          border: 'none',
          borderRadius: 2,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.22em',
          paddingLeft: 'calc(40px + 0.22em)',
          boxShadow: '0 10px 30px rgba(201,164,92,0.3)',
        }}
      >
        POSER UN OBJET
      </button>
    </div>
  )

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {typeof document !== 'undefined' && createPortal(controls, document.body)}
    </>
  )
}
