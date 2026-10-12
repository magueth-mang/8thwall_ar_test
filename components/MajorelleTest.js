'use client'

// Aperçu de développement du scénario « Jardin Majorelle » (sans AR).
// Charge la cour (version de suivi non bakée), la porte animée, le masque du portail et,
// dès qu'il existe, le module d'eau vivante (lib/majorelle/gardenFx.js).

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { pickMajorelleInterior, applyMajorelleMaterials } from '@/lib/majorelle/interior'

const BASE = '/majorelle'
const CREAM = '#EFE9DC', GOLD = '#C9A45C'

export default function MajorelleTest() {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const replayRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x14110d)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.35

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 60)
    camera.position.set(0.06, 0.02, 1.9)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, -0.06, -0.6)

    const anchor = new THREE.Group()
    scene.add(anchor)

    // soleil de fin d'après-midi (repère Blender (0.45,-0.6,-0.66) → three (0.45,-0.66,0.6))
    const sunDir = new THREE.Vector3(0.45, -0.66, 0.6).normalize()
    const sun = new THREE.DirectionalLight(0xffdcae, 2.6)
    sun.position.copy(sunDir).multiplyScalar(-6)
    anchor.add(sun, sun.target)
    anchor.add(new THREE.HemisphereLight(0xbcd6ff, 0x8a5a3a, 1.1))

    // l'image du marqueur joue le rôle du flux caméra
    const markerTex = new THREE.TextureLoader().load(`${BASE}/marker_door_2k.png`)
    markerTex.colorSpace = THREE.SRGBColorSpace
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 2400 / 1792), new THREE.MeshBasicMaterial({ map: markerTex, depthWrite: false, toneMapped: false }))
    marker.renderOrder = -2
    anchor.add(marker)

    const loader = new GLTFLoader()
    let mixer = null, action = null, clip = null, fx = null

    // Cour bakée (textures de détail × cartes de lumière) si disponible, sinon version de suivi brute
    const pickInterior = async () => {
      const p = await pickMajorelleInterior(BASE)
      return p ? { meta: p.meta, glb: p.glbUrl } : { meta: null, glb: `${BASE}/mj_preview.glb` }
    }

    Promise.all([pickInterior(), loader.loadAsync(`${BASE}/mj_door.glb`)]).then(async ([pick, door]) => {
      if (disposed) return
      const garden = await loader.loadAsync(pick.glb)
      if (disposed) return
      if (pick.meta) {
        scene.remove(sun); anchor.remove(sun)
        anchor.children.filter((c) => c.isHemisphereLight).forEach((c) => anchor.remove(c))
        applyMajorelleMaterials(garden.scene, pick.meta, BASE)
      }
      garden.scene.traverse((o) => {
        if (!o.isMesh) return
        if (o.name === 'Portal_Occluder') { o.material.colorWrite = false; o.renderOrder = -1 }
        if (o.name === 'Sky') { o.material.toneMapped = false; o.material.depthWrite = false; o.renderOrder = 0 }
      })
      door.scene.traverse((o) => { if (o.isMesh) o.material.toneMapped = false })
      anchor.add(garden.scene, door.scene)

      mixer = new THREE.AnimationMixer(door.scene)
      clip = THREE.AnimationClip.findByName(door.animations, 'DoorOpen') || door.animations[0]
      action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true
      replayRef.current = () => { action.reset(); action.timeScale = 0.75; action.play() }
      setTimeout(() => !disposed && replayRef.current(), 900)

      // eau vivante (koï, nénuphars, jet, reflets par sondes) dans le repère « jardin » en mètres
      try {
        const meta = pick.meta || (await fetch(`${BASE}/preview.json`).then((r) => r.json()))
        const mod = await import('@/lib/majorelle/gardenFx')
        const gardenRoot = new THREE.Group()
        gardenRoot.position.set(meta.X_OFF, meta.Z_OFF, 0)
        gardenRoot.scale.setScalar(meta.K)
        anchor.add(gardenRoot)
        let cube = null
        try { cube = await mod.loadReflectionProbes(`${BASE}/fx/`) } catch {}
        if (disposed) return
        // sunDir = direction VERS le soleil, repère jardin three.js (publiée par le bake si présente)
        const sd = Array.isArray(meta.sun?.dir) ? new THREE.Vector3(...meta.sun.dir) : new THREE.Vector3(-0.52, 0.76, 0.38)
        fx = mod.createGardenFX({
          parent: gardenRoot, sunDir: sd.normalize(), reflectionCube: cube,
          ...(meta.sun?.color ? { sunColor: meta.sun.color } : {}), ...(meta.sky ? { sky: meta.sky } : {}),
        })
        setStatus(pick.meta ? 'Aperçu · lumière bakée + eau vivante' : 'Aperçu · eau vivante (lumière non bakée)')
      } catch (e) {
        console.warn('[majorelle] eau vivante indisponible', e)
        setStatus('Aperçu de développement')
      }
    }).catch((e) => { console.error(e); setStatus('Erreur de chargement') })

    const onResize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix() }
    window.addEventListener('resize', onResize)
    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now
      if (mixer) mixer.update(dt)
      if (fx) fx.update(dt, camera)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()
    // debug : avance la scène à la main (onglet masqué = requestAnimationFrame suspendu)
    const step = (dt = 1 / 30) => { if (mixer) mixer.update(dt); if (fx) fx.update(dt, camera); controls.update(); renderer.render(scene, camera) }
    window.__mj = { scene, camera, controls, renderer, step, replay: () => replayRef.current?.() }
    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      fx?.dispose?.()
      controls.dispose(); renderer.dispose(); pmrem.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#14110d' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontFamily: "'Didot', Georgia, serif", fontSize: 11, letterSpacing: '0.42em', paddingLeft: '0.42em', color: GOLD }}>YVES SAINT LAURENT</div>
        <div style={{ fontFamily: "'Didot', Georgia, serif", fontSize: 18, color: CREAM, fontStyle: 'italic', marginTop: 6 }}>Jardin Majorelle</div>
      </div>
      <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', color: CREAM, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', textShadow: '0 1px 6px #000' }}>{status}</div>
      <button onClick={() => replayRef.current?.()} style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,0.45)', color: CREAM, border: `1px solid ${GOLD}88`, borderRadius: 999, padding: '8px 14px', fontSize: 10, letterSpacing: '0.22em' }}>REJOUER</button>
    </div>
  )
}
