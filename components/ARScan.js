'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// --- Réglages POC (à ajuster selon l'asset / le marqueur imprimé) ---------
const TARGET = {
  // Nom logique du marqueur. Doit correspondre au champ "name" du JSON de cible
  // compilé (voir /public/targets/README + §"Générer une image target").
  name: 'mascara-marker',
  // Chemin du JSON de cible compilé (mode auto-hébergé). Généré via 8th Wall Studio.
  dataUrl: '/targets/mascara.json',
}

// Transformation locale du modèle DANS le repère du marqueur.
// Le plan de l'image = plan XY, +Z sort de l'image vers la caméra.
const MODEL = {
  scale: 0.15, // unités modèle -> taille marqueur ; à régler visuellement
  // le mascara est modélisé Y-up : on le couche pour qu'il "sorte" du marqueur
  rotation: [-Math.PI / 2, 0, 0],
  position: [0, 0, 0],
}
// --------------------------------------------------------------------------

export default function ARScan({ onProductFound }) {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Cherchez un marqueur…')

  useEffect(() => {
    const XR8 = window.XR8
    if (!XR8 || !canvasRef.current) return

    // 8th Wall exige THREE en global pour son module Threejs
    window.THREE = THREE

    let anchor // THREE.Group ancré sur le marqueur
    let disposed = false

    // Applique la pose renvoyée par 8th Wall à notre groupe ancre
    const applyPose = (detail) => {
      if (!anchor) return
      const { position, rotation, scale } = detail
      anchor.position.set(position.x, position.y, position.z)
      anchor.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      anchor.scale.setScalar(scale)
    }

    const onImageFound = ({ detail }) => {
      if (detail.name !== TARGET.name) return
      applyPose(detail)
      if (anchor) anchor.visible = true
      setStatus('Produit trouvé ✦')
      onProductFound?.(detail.name)
    }
    const onImageUpdated = ({ detail }) => {
      if (detail.name !== TARGET.name) return
      applyPose(detail)
    }
    const onImageLost = ({ detail }) => {
      if (detail.name !== TARGET.name) return
      if (anchor) anchor.visible = false
      setStatus('Cherchez un marqueur…')
    }

    // Module custom : construit la scène Three.js une fois le moteur démarré
    const scenePipelineModule = () => ({
      name: 'ysl-scene',
      onStart: () => {
        const { scene, camera } = XR8.Threejs.xrScene()

        // Éclairage "vitrine luxe"
        scene.add(new THREE.AmbientLight(0xffffff, 0.9))
        const key = new THREE.DirectionalLight(0xfff2d8, 1.1)
        key.position.set(1, 3, 2)
        scene.add(key)

        // Groupe ancre : suit le marqueur, masqué tant qu'aucune détection
        anchor = new THREE.Group()
        anchor.visible = false
        scene.add(anchor)

        // Chargement du produit
        new GLTFLoader().load(
          '/mascara.glb',
          (gltf) => {
            if (disposed) return
            const model = gltf.scene
            model.scale.setScalar(MODEL.scale)
            model.rotation.set(...MODEL.rotation)
            model.position.set(...MODEL.position)

            // Animations bakées éventuelles (ex. ouverture du mascara)
            if (gltf.animations?.length) {
              const mixer = new THREE.AnimationMixer(model)
              gltf.animations.forEach((clip) => mixer.clipAction(clip).play())
              model.userData.mixer = mixer
            }
            anchor.add(model)
          },
          undefined,
          (err) => {
            console.error('[ARScan] échec chargement mascara.glb', err)
            setStatus('Erreur : modèle 3D introuvable')
          }
        )

        // Caméra fixe côté 8th Wall (elle est pilotée par le tracking)
        camera.position.set(0, 0, 0)
      },
      // Fait avancer les animations à chaque frame
      onUpdate: () => {
        if (!anchor) return
        anchor.traverse((o) => {
          if (o.userData?.mixer) o.userData.mixer.update(1 / 60)
        })
      },
      listeners: [
        { event: 'reality.imagefound', process: onImageFound },
        { event: 'reality.imageupdated', process: onImageUpdated },
        { event: 'reality.imagelost', process: onImageLost },
      ],
    })

    const start = async () => {
      // Configuration des image targets (mode auto-hébergé = JSON compilé local)
      try {
        const res = await fetch(TARGET.dataUrl)
        if (res.ok) {
          const imageTargetData = await res.json()
          XR8.XrController.configure({ imageTargetData })
        } else {
          // Repli : cible référencée par nom (si hébergement cloud d'un projet 8W)
          console.warn(
            `[ARScan] ${TARGET.dataUrl} introuvable — génère la cible via 8th Wall Studio (voir public/targets/README.md).`
          )
          XR8.XrController.configure({ imageTargets: [TARGET.name] })
          setStatus('⚠ Image target non compilée — voir public/targets/README.md')
        }
      } catch (e) {
        console.error('[ARScan] configuration image target', e)
      }

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(), // dessine le flux caméra
        XR8.Threejs.pipelineModule(), // crée la scène/caméra Three.js
        XR8.XrController.pipelineModule(), // SLAM + détection cibles
        scenePipelineModule(), // notre contenu
      ])

      XR8.run({
        canvas: canvasRef.current,
        allowedDevices: XR8.XrConfig.device().ANY,
      })
    }

    if (window.XR8) start()
    else window.addEventListener('xrloaded', start, { once: true })

    return () => {
      disposed = true
      window.removeEventListener('xrloaded', start)
      try {
        window.XR8?.stop?.()
      } catch {}
    }
  }, [onProductFound])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: '#EFE9DC',
          textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          textTransform: 'uppercase',
          letterSpacing: '0.24em',
          paddingLeft: '0.24em',
          fontSize: 11,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {status}
      </div>
    </>
  )
}
