'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'

// ------- Matériaux (ajustables) --------------------------------------------
const MAT = {
  // valeurs calées par le client via le menu /gloss
  cap: { color: 0xe8c5bf, metalness: 1.0, roughness: 0.0, clearcoat: 0.0, envMapIntensity: 1.0 },
  cassandre: { color: 0xe8eaef, metalness: 1.0, roughness: 0.06, clearcoat: 0.0, envMapIntensity: 1.1 },
  bottleMatte: { color: 0xe8c5bf, metalness: 0.47, roughness: 0.48, clearcoat: 0.15, envMapIntensity: 0.2 },
  bottleGlossy: { color: 0xe8c5bf, metalness: 0.47, roughness: 0.48, clearcoat: 0.15, envMapIntensity: 0.2 },
  balm: { color: 0xdcb49c, metalness: 0.0, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.0 },
  // corps du bâtonnet (LNB_Balm) : rose chromé
  bullet: { color: 0xe8c5bf, metalness: 1.0, roughness: 0.0, clearcoat: 0.1, envMapIntensity: 1.0 },
  // "Bout argenté du bâtonnet" (LBN_Bottle_interior) : la SEULE partie qui monte/tourne
  ring: { color: 0x582c2c, metalness: 0.0, roughness: 0.38, clearcoat: 0.0, envMapIntensity: 0.0 },
  capInterior: { color: 0x0b0b0b, metalness: 0.2, roughness: 0.35, envMapIntensity: 1.2 },
  bottleInterior: { color: 0x2a1418, metalness: 0.0, roughness: 0.6 },
}
const CFG = {
  modelUrl: '/lovenude.glb',
  targetHeight: 2.0,
  openDuration: 2.4,
  // ouverture : le capuchon monte, glisse sur le côté et s'incline
  capUpRatio: 0.34, // montée (fraction de la hauteur)
  capSideRatio: 0.5, // décalage latéral
  capTilt: 0.5, // inclinaison (rad)
  // le baume sort du tube EN TOURNANT (comme un vrai rouge à lèvres)
  balmSpinTurns: 2.0, // nb de tours
  balmRiseRatio: 0.16, // montée du baume
  autoSpin: 0.25, // rotation lente de présentation (rad/s)
}
// ---------------------------------------------------------------------------

export default function GlossPreview() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const apiRef = useRef({})

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // ACES désature/blanchit les couleurs vives → tout tirait vers le pâle quoi
    // que je change. NeutralToneMapping (Khronos, pour la viz produit) préserve
    // la teinte et la saturation.
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // fond neutre clair (un métal doit refléter du neutre, pas du rose)
    scene.background = new THREE.Color(0xeceaea)

    // Environnement de reflets = VRAI HDRI studio (le contraste = l'aspect métal).
    // ?env=<nom> pour tester : photo_studio_01 / studio_small_08 / studio_small_09 / brown_photostudio_02
    const pmrem = new THREE.PMREMGenerator(renderer)
    let envName = 'photo_studio_01'
    let envRot = 1.2
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('env')) envName = q.get('env')
      if (q.get('rot')) envRot = parseFloat(q.get('rot'))
    } catch {}
    scene.environmentIntensity = 1.0
    let envTex = null
    const loadEnv = (name) => {
      new RGBELoader().load(`/hdr/${name}.hdr`, (hdr) => {
        if (disposed) return
        hdr.mapping = THREE.EquirectangularReflectionMapping
        const t = pmrem.fromEquirectangular(hdr).texture
        if (envTex) envTex.dispose()
        envTex = t
        scene.environment = t
        scene.environmentRotation = new THREE.Euler(0, envRot, 0)
        hdr.dispose()
        envName = name
      })
    }
    loadEnv(envName)

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let camPos = [1.1, 0.6, 3.2]
    try {
      const q = new URLSearchParams(window.location.search).get('cam')
      if (q) camPos = q.split(',').map(Number)
    } catch {}
    camera.position.set(camPos[0], camPos[1], camPos[2])

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)

    // éclairage : les reflets viennent du HDR ; ces lumières donnent les highlights.
    scene.add(new THREE.AmbientLight(0xffffff, 0.3))
    const key = new THREE.DirectionalLight(0xfff4ec, 1.7)
    key.position.set(2, 4, 3)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 20
    key.shadow.bias = -0.0005
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffe8ee, 0.55)
    fill.position.set(-3, 1, 2)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xd8e6ff, 0.7)
    rim.position.set(-1, 2, -3)
    scene.add(rim)

    // sol ombre de contact
    const shadowGround = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    )
    shadowGround.rotation.x = -Math.PI / 2
    shadowGround.receiveShadow = true
    scene.add(shadowGround)

    // sol RÉFLÉCHISSANT : le produit se reflète dessus (look shooting produit)
    const mirror = new Reflector(new THREE.PlaneGeometry(30, 30), {
      color: 0x8a8a8a, // gris = reflet atténué (élégant, pas miroir total)
      textureWidth: Math.min(window.innerWidth, 1600),
      textureHeight: Math.min(window.innerHeight, 1600),
    })
    mirror.rotation.x = -Math.PI / 2
    mirror.position.y = -1
    scene.add(mirror)

    const root = new THREE.Group() // pivot de rotation
    scene.add(root)

    let capGroup = null
    let balmGroup = null
    const capBase = new THREE.Vector3() // pivot du capuchon (son centre)
    let capUp = 0
    let capSide = 0
    let balmRise = 0
    let isOpen = false
    let openA = 0 // progression maîtresse de l'ouverture (0..1)

    const makeMat = (cfg) => new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.2, ...cfg })
    // matériaux PARTAGÉS (une instance par partie) → éditables en direct par le menu
    const mats = {
      cap: makeMat(MAT.cap),
      cassandre: makeMat(MAT.cassandre),
      ring: makeMat(MAT.ring),
      bullet: makeMat(MAT.bullet),
      bottleMatte: makeMat(MAT.bottleMatte),
      bottleGlossy: makeMat(MAT.bottleGlossy),
      capInterior: makeMat(MAT.capInterior),
    }

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder) // le glb utilise EXT_meshopt_compression
    loader.load(
      CFG.modelUrl,
      (gltf) => {
        if (disposed) return
        const m = gltf.scene

        // matériaux par NOM DE MATÉRIAU (robuste : GLTFLoader découpe les meshes
        // multi-matériaux en sous-meshes, donc on ne peut pas se fier au nom de nœud)
        m.traverse((o) => {
          if (!o.isMesh || !o.material) return
          o.castShadow = true
          o.receiveShadow = false
          const mn = (o.material.name || '').toLowerCase()
          if (mn === 'metal_pink') o.material = mats.cap // capuchon
          else if (mn === 'metal') o.material = mats.cassandre // monogramme YSL
          else if (mn === 'metal_pink_int') o.material = mats.bullet // corps du bâtonnet (LNB_Balm)
          else if (mn === 'pink_matte') o.material = mats.bottleMatte // bas mat
          else if (mn === 'pink_glossy') o.material = mats.bottleGlossy // bas brillant
          else if (mn === 'black_glossy') o.material = mats.capInterior
          else if (mn.includes('lovenude')) o.material = mats.ring // bout argenté (LBN_Bottle_interior)
        })

        // On COLLECTE d'abord, puis on reparente (jamais muter pendant un traverse).
        m.updateMatrixWorld(true)
        const capMeshes = []
        const balmMeshes = []
        m.traverse((o) => {
          if (o.isMesh && (o.name === 'LNB_cap' || o.name === 'LNB_cap_interior')) capMeshes.push(o)
          // SEUL le "Bout argenté du bâtonnet" (LBN_Bottle_interior) monte/tourne.
          // Le corps (LNB_Balm) reste fixe.
          else if (o.isMesh && o.name === 'LBN_Bottle_interior') balmMeshes.push(o)
        })

        // capuchon : pivot placé à SON centre → basculement propre (pas un arc)
        capGroup = new THREE.Group()
        m.add(capGroup)
        const capBox = new THREE.Box3()
        capMeshes.forEach((o) => capBox.expandByObject(o))
        capGroup.position.copy(capBox.getCenter(capBase))
        capMeshes.forEach((o) => capGroup.attach(o))

        // baume : groupe centré sur l'axe du tube → il tourne sur lui-même en sortant
        balmGroup = new THREE.Group()
        m.add(balmGroup)
        balmMeshes.forEach((o) => balmGroup.attach(o))

        const preBox = new THREE.Box3().setFromObject(m)
        const localH = preBox.getSize(new THREE.Vector3()).y || 1
        capUp = localH * CFG.capUpRatio
        capSide = localH * CFG.capSideRatio
        balmRise = localH * CFG.balmRiseRatio

        // normalise : met à l'échelle + centre
        root.add(m)
        root.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(m)
        const size = box.getSize(new THREE.Vector3())
        const s = CFG.targetHeight / (size.y || 1)
        m.scale.setScalar(s)
        root.updateMatrixWorld(true)
        const box2 = new THREE.Box3().setFromObject(m)
        const c = box2.getCenter(new THREE.Vector3())
        m.position.sub(c)
        // pose la base au sol pour l'ombre
        const box3 = new THREE.Box3().setFromObject(m)
        shadowGround.position.y = box3.min.y
        mirror.position.y = box3.min.y + 0.001

        setStatus('Prêt')
      },
      undefined,
      (err) => {
        console.error('[Gloss] modèle', (err && err.stack) || err)
        setStatus('Erreur : modèle introuvable')
      }
    )

    apiRef.current.toggleOpen = () => {
      isOpen = !isOpen
      return isOpen
    }

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    let last = performance.now()
    let raf = null
    const spinning = { on: true }
    apiRef.current.toggleSpin = () => (spinning.on = !spinning.on)

    // ===== MENU DE RÉGLAGE (lil-gui) : ajuste couleurs/valeurs en direct =====
    const gui = new GUI({ title: 'Réglages — /gloss' })
    const addPart = (label, mat, isMetal) => {
      const f = gui.addFolder(label)
      const p = { couleur: '#' + mat.color.getHexString() }
      f.addColor(p, 'couleur').onChange((v) => mat.color.set(v))
      f.add(mat, 'roughness', 0, 1, 0.01).name('rugosité (mat↔brillant)')
      f.add(mat, 'metalness', 0, 1, 0.01).name('métal')
      f.add(mat, 'envMapIntensity', 0, 3, 0.05).name('force reflets')
      if (!isMetal) f.add(mat, 'clearcoat', 0, 1, 0.01).name('vernis')
      f.close()
    }
    addPart('Capuchon', mats.cap, true)
    addPart('YSL (Cassandre)', mats.cassandre, true)
    addPart('Bout argenté du bâtonnet', mats.ring, true)
    addPart('Bâtonnet (rouge à lèvres)', mats.bullet, false)
    addPart('Tube — mat', mats.bottleMatte, false)
    addPart('Tube — brillant', mats.bottleGlossy, false)
    const envF = gui.addFolder('Environnement / lumière')
    const envParams = {
      HDRI: envName,
      exposition: renderer.toneMappingExposure,
      forceReflets: scene.environmentIntensity,
      rotation: envRot,
    }
    envF.add(envParams, 'HDRI', ['photo_studio_01', 'studio_small_08', 'studio_small_09', 'brown_photostudio_02']).onChange((v) => loadEnv(v))
    envF.add(envParams, 'exposition', 0.4, 2, 0.02).onChange((v) => (renderer.toneMappingExposure = v))
    envF.add(envParams, 'forceReflets', 0, 2.5, 0.02).onChange((v) => (scene.environmentIntensity = v))
    envF.add(envParams, 'rotation', 0, 6.28, 0.05).onChange((v) => {
      envRot = v
      scene.environmentRotation = new THREE.Euler(0, v, 0)
    })
    const actions = {
      copier: () => {
        const dump = {}
        for (const k in mats) {
          const mm = mats[k]
          dump[k] = {
            color: '#' + mm.color.getHexString(),
            roughness: +mm.roughness.toFixed(3),
            metalness: +mm.metalness.toFixed(2),
            envMapIntensity: +mm.envMapIntensity.toFixed(2),
            clearcoat: +mm.clearcoat.toFixed(2),
          }
        }
        dump.env = {
          HDRI: envParams.HDRI,
          exposition: +renderer.toneMappingExposure.toFixed(2),
          forceReflets: +scene.environmentIntensity.toFixed(2),
          rotation: +envRot.toFixed(2),
        }
        const txt = JSON.stringify(dump, null, 2)
        navigator.clipboard?.writeText(txt).catch(() => {})
        console.log('=== CONFIG /gloss ===\n' + txt)
        setStatus('Config copiée dans le presse-papier — colle-la moi !')
      },
    }
    gui.add(actions, 'copier').name('📋 Copier toutes les valeurs')

    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      if (spinning.on) root.rotation.y += CFG.autoSpin * dt

      if (capGroup) {
        const dir = isOpen ? 1 : -1
        openA = Math.max(0, Math.min(1, openA + (dir * dt) / CFG.openDuration))
        // progression locale d'une phase [a,b], avec easeInOut
        const ph = (a, b) => {
          const t = Math.max(0, Math.min(1, (openA - a) / (b - a)))
          return t * t * (3 - 2 * t)
        }
        // 1) le capuchon monte tout droit  2) il se met de côté + s'incline
        const rise = ph(0.0, 0.3)
        const aside = ph(0.3, 0.6)
        capGroup.position.set(capBase.x + capSide * aside, capBase.y + capUp * rise, capBase.z)
        capGroup.rotation.z = -CFG.capTilt * aside
        // 3) une fois le capuchon ouvert, le bâtonnet sort EN TOURNANT
        if (balmGroup) {
          const out = ph(0.65, 1.0)
          balmGroup.rotation.y = CFG.balmSpinTurns * Math.PI * 2 * out
          balmGroup.position.y = balmRise * out
        }
      }

      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      gui.destroy()
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  const btn = {
    padding: '11px 20px',
    background: 'linear-gradient(180deg, #f0d3da 0%, #d98fa2 100%)',
    color: '#3a1720',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.1em',
    cursor: 'pointer',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#efe4e7' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn} onClick={() => apiRef.current.toggleOpen?.()}>OUVRIR / FERMER</button>
        <button style={btn} onClick={() => apiRef.current.toggleSpin?.()}>ROTATION</button>
        <span style={{ color: '#7a5860', fontSize: 12 }}>Glisser = pivoter · Molette = zoom</span>
      </div>
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#a06', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        {status}
      </div>
    </div>
  )
}
