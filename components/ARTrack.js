'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// ------- Réglages (ajustables en live) -------------------------------------
const CFG = {
  modelUrl: '/mascara.glb',
  targetName: 'book',
  targetDataUrl: '/image-targets/book.json',
  heightUnits: 1.3, // hauteur du mascara en "largeurs de livre"
  capNodeName: 'HC HAUT', // partie qui se soulève (capuchon + brosse)
  openLiftRatio: 0.9, // amplitude d'ouverture (fraction de la hauteur du modèle)
  openDuration: 0.9, // durée ouverture / fermeture (s)
  standSign: 1, // +1 : sort vers l'avant de l'image ; -1 si ça s'enfonce
  lostGraceMs: 500,
  // Apparition (chute + pose)
  dropHeight: 2.2, // hauteur de chute (unités locales)
  fallDuration: 0.55, // s
  bounceDuration: 0.45, // s
  // Socle
  pedestal: false,
  pedestalRadius: 0.5,
  pedestalHeight: 0.05,
  // Rendu
  envMapIntensity: 1.25, // boost des reflets sur les matériaux d'origine
  exposure: 1.05,
}
// ---------------------------------------------------------------------------

export default function ARTrack() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return

    window.THREE = THREE
    let disposed = false

    let anchor = null
    let dropGroup = null
    let cap = null
    let proxy = null
    let cameraRef = null
    let lostTimer = null
    let rafId = null

    // états d'animation
    let capOpen = false
    let capProgress = 0
    let introActive = false
    let introPlayed = false
    let introT = 0
    let lastT = performance.now()

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
      const scale = CFG.heightUnits / standH
      wrap.scale.setScalar(scale)

      wrap.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(wrap)
      const c = box.getCenter(new THREE.Vector3())
      wrap.position.x -= c.x
      wrap.position.z -= c.z
      wrap.position.y -= box.min.y

      // HC HAUT : GLTFLoader remplace les espaces par des underscores → on compare
      // en normalisé (sans espaces/underscores, insensible à la casse).
      const norm = (x) => (x || '').replace(/[\s_]+/g, '').toUpperCase()
      const wanted = norm(CFG.capNodeName)
      let foundCap = null
      root.traverse((o) => {
        if (norm(o.name) === wanted || norm(o.userData?.name) === wanted) foundCap = o
      })
      if (foundCap) {
        foundCap.userData.base = foundCap.position.clone()
        const amount = CFG.openLiftRatio * standH
        const capBox = new THREE.Box3().setFromObject(foundCap)
        const rootBox = new THREE.Box3().setFromObject(root)
        const sign =
          Math.sign(
            capBox.getCenter(new THREE.Vector3())[longest] -
              rootBox.getCenter(new THREE.Vector3())[longest]
          ) || 1
        const lift = new THREE.Vector3()
        lift[longest] = sign * amount
        foundCap.userData.lift = lift
      } else {
        console.warn('[ARTrack] nœud "' + CFG.capNodeName + '" introuvable')
      }
      cap = foundCap

      // On garde les matériaux d'origine, mais on booste leurs reflets via l'env map
      root.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach((m) => {
            if ('envMapIntensity' in m) {
              m.envMapIntensity = CFG.envMapIntensity
              m.needsUpdate = true
            }
          })
        }
      })
      return wrap
    }

    const buildPedestal = () => {
      const g = new THREE.Group()
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(
          CFG.pedestalRadius,
          CFG.pedestalRadius * 1.06,
          CFG.pedestalHeight,
          64
        ),
        new THREE.MeshPhysicalMaterial({
          color: 0x0c0c0c,
          metalness: 0.7,
          roughness: 0.25,
          clearcoat: 0.6,
          clearcoatRoughness: 0.2,
        })
      )
      disc.position.y = CFG.pedestalHeight / 2
      g.add(disc)

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(CFG.pedestalRadius, 0.014, 20, 96),
        new THREE.MeshStandardMaterial({
          color: 0xc9a45c,
          metalness: 1,
          roughness: 0.28,
          emissive: 0x3a2c10,
          emissiveIntensity: 0.5,
        })
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = CFG.pedestalHeight
      g.add(ring)
      return g
    }

    const loop = () => {
      if (disposed) return
      rafId = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min((now - lastT) / 1000, 0.05)
      lastT = now

      // Apparition : chute + rebond
      if (introActive && dropGroup) {
        introT += dt
        const f = CFG.fallDuration
        const b = CFG.bounceDuration
        let y
        if (introT < f) {
          const p = introT / f
          y = CFG.dropHeight * (1 - p * p) // chute accélérée
        } else if (introT < f + b) {
          const bp = (introT - f) / b
          y = CFG.dropHeight * 0.06 * Math.sin(bp * Math.PI) * (1 - bp) // petit rebond
        } else {
          y = 0
          introActive = false
        }
        dropGroup.position.y = y
      }

      // Ouverture / fermeture du capuchon
      if (cap && cap.userData.lift) {
        const dir = capOpen ? 1 : -1
        capProgress = Math.max(0, Math.min(1, capProgress + (dir * dt) / CFG.openDuration))
        const s = capProgress * capProgress * (3 - 2 * capProgress)
        cap.position.copy(cap.userData.base).addScaledVector(cap.userData.lift, s)
      }
    }

    const applyPose = (detail) => {
      if (!anchor) return
      anchor.position.copy(detail.position)
      anchor.quaternion.copy(detail.rotation)
      anchor.scale.setScalar(detail.scale)
    }

    const showModel = (detail) => {
      if (lostTimer) {
        clearTimeout(lostTimer)
        lostTimer = null
      }
      applyPose(detail)
      if (anchor) anchor.visible = true
    }

    const onImageFound = ({ detail }) => {
      if (detail.name !== CFG.targetName) return
      showModel(detail)
      if (!introPlayed && dropGroup) {
        introPlayed = true
        capOpen = false
        capProgress = 0
        dropGroup.position.y = CFG.dropHeight
        introActive = true
        introT = 0
      }
      setStatus('Tapotez le mascara pour l’ouvrir')
    }
    const onImageUpdated = ({ detail }) => {
      if (detail.name !== CFG.targetName) return
      showModel(detail)
    }
    const onImageLost = ({ detail }) => {
      if (detail.name !== CFG.targetName) return
      if (lostTimer) return
      lostTimer = setTimeout(() => {
        if (anchor) anchor.visible = false
        lostTimer = null
        setStatus('Cherchez la couverture du livre…')
      }, CFG.lostGraceMs)
    }

    const scenePipelineModule = () => ({
      name: 'ysl-track',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene()
        cameraRef = camera

        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = CFG.exposure
        const pmrem = new THREE.PMREMGenerator(renderer)
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

        scene.add(new THREE.AmbientLight(0xffffff, 0.4))
        const key = new THREE.DirectionalLight(0xfff2e0, 1.3)
        key.position.set(1, 2.5, 2)
        scene.add(key)
        const rim = new THREE.DirectionalLight(0xbfd4ff, 0.55)
        rim.position.set(-2, 1, -1.5)
        scene.add(rim)

        anchor = new THREE.Group()
        anchor.visible = false
        scene.add(anchor)

        new GLTFLoader().load(
          CFG.modelUrl,
          (gltf) => {
            if (disposed) return
            const modelWrap = prepareModel(gltf.scene)

            const orient = new THREE.Group()
            orient.rotation.x = (CFG.standSign * Math.PI) / 2

            if (CFG.pedestal) {
              orient.add(buildPedestal())
              modelWrap.position.y += CFG.pedestalHeight // pose le mascara sur le socle
            }

            dropGroup = new THREE.Group()
            dropGroup.add(modelWrap)
            orient.add(dropGroup)
            anchor.add(orient)

            // Boîte de collision invisible (tap) alignée sur le modèle
            anchor.updateMatrixWorld(true)
            const wb = new THREE.Box3().setFromObject(modelWrap)
            wb.applyMatrix4(modelWrap.matrixWorld.clone().invert()) // -> espace local du modèle
            const psize = wb.getSize(new THREE.Vector3())
            const pcenter = wb.getCenter(new THREE.Vector3())
            proxy = new THREE.Mesh(
              new THREE.BoxGeometry(psize.x, psize.y, psize.z),
              new THREE.MeshBasicMaterial({ visible: false })
            )
            proxy.position.copy(pcenter)
            modelWrap.add(proxy)

            setStatus('Cherchez la couverture du livre…')
          },
          undefined,
          (err) => {
            console.error('[ARTrack] modèle', err)
            setStatus('Erreur : modèle 3D introuvable')
          }
        )
      },
      listeners: [
        { event: 'reality.imagefound', process: onImageFound },
        { event: 'reality.imageupdated', process: onImageUpdated },
        { event: 'reality.imagelost', process: onImageLost },
      ],
    })

    // Tap → ouvre / referme (ignoré pendant l'apparition)
    const onTap = (ev) => {
      if (!anchor || !anchor.visible || !proxy || !cameraRef || introActive) return
      const t = ev.changedTouches ? ev.changedTouches[0] : ev
      const ndc = {
        x: (t.clientX / window.innerWidth) * 2 - 1,
        y: -(t.clientY / window.innerHeight) * 2 + 1,
      }
      // 8th Wall écrit projectionMatrix directement : rafraîchir l'inverse + les
      // matrices monde, sinon le rayon part de travers et rate le modèle.
      cameraRef.updateMatrixWorld()
      cameraRef.projectionMatrixInverse.copy(cameraRef.projectionMatrix).invert()
      raycasterTap.setFromCamera(ndc, cameraRef)
      if (raycasterTap.intersectObject(proxy, false).length) {
        capOpen = !capOpen
        setStatus(capOpen ? 'Mascara ouvert' : 'Tapotez pour ouvrir')
      }
    }
    const raycasterTap = new THREE.Raycaster()

    const init = async () => {
      try {
        const data = await fetch(CFG.targetDataUrl).then((r) => r.json())
        XR8.XrController.configure({ imageTargetData: [data] })
      } catch (e) {
        console.error('[ARTrack] configuration cible', e)
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
      // Un seul type d'événement (pointeur unifié) : évite le double-déclenchement
      // touchstart + mousedown synthétique qui annulait le toggle.
      canvasEl.addEventListener('pointerdown', onTap)
      init._cleanup = () => {
        canvasEl.removeEventListener('pointerdown', onTap)
      }

      lastT = performance.now()
      loop()
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
      {typeof document !== 'undefined' && createPortal(controls, document.body)}
    </>
  )
}
