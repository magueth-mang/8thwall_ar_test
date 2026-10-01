// Petite scène : un objet sort d'un PORTAIL sur le mur (marqueur), puis se DÉTACHE
// et tombe au sol avec une VRAIE physique (cannon-es), ancré au monde (SLAM) → il
// reste par terre même si le marqueur sort du champ.
// Repère : l'ancre suit le marqueur ; l'objet est enfant de l'ancre pendant la sortie,
// puis on le reparente à la SCÈNE (monde) et la physique prend le relais.

import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import * as CANNON from 'cannon-es'

export const CFG = {
  targetName: 'qr',
  wallTexUrl: '/targets/qrcode.png',
  hdrUrl: '/hdr/photo_studio_01.hdr',
  wallSize: 1.0,
  objRadius: 0.16, // rayon de l'objet (unités locales du mur)
  emergeFrom: -0.5, // z de départ (derrière le mur)
  emergeTo: 0.45, // z de sortie (devant le mur) avant de se détacher
  emergeDur: 1.4,
  gravity: 9.8,
  restitution: 0.38,
  floorY: 0.0, // sol monde (SLAM y≈0). Surchargeable pour la preview.
  outSpeed: 0.3, // vitesse de sortie (×échelle monde) — douce, reste près du mur
  upSpeed: 0.25,
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)

export function buildWallDropScene(renderer, scene, { onStatus, floorY } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const groundY = floorY != null ? floorY : CFG.floorY

  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environmentIntensity = 1.1
  new RGBELoader().load(CFG.hdrUrl, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    hdr.dispose()
  })

  scene.add(new THREE.AmbientLight(0xffffff, 0.4))
  const key = new THREE.DirectionalLight(0xfff2e8, 1.6)
  key.position.set(2, 4, 3)
  scene.add(key)

  const anchor = new THREE.Group()
  anchor.visible = false
  scene.add(anchor)

  // PORTAIL : disque sombre (occulte l'objet tant qu'il est derrière) + anneau lumineux
  const portalDisc = new THREE.Mesh(
    new THREE.CircleGeometry(CFG.wallSize * 0.5, 56),
    new THREE.MeshStandardMaterial({ color: 0x0e0810, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide })
  )
  anchor.add(portalDisc)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CFG.wallSize * 0.47, CFG.wallSize * 0.55, 72),
    new THREE.MeshBasicMaterial({ color: 0xffa6d4, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
  )
  ring.position.z = 0.004
  ring.renderOrder = 2
  anchor.add(ring)

  // lueur centrale (disque additif qui pulse)
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = glowCanvas.height = 128
  const gx = glowCanvas.getContext('2d')
  const gg = gx.createRadialGradient(64, 64, 4, 64, 64, 64)
  gg.addColorStop(0, 'rgba(255,220,240,1)')
  gg.addColorStop(0.4, 'rgba(255,140,200,0.6)')
  gg.addColorStop(1, 'rgba(255,140,200,0)')
  gx.fillStyle = gg
  gx.fillRect(0, 0, 128, 128)
  const glowTex = new THREE.CanvasTexture(glowCanvas)
  glowTex.colorSpace = THREE.SRGBColorSpace
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(CFG.wallSize * 0.46, 48),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  glow.position.z = 0.012
  glow.renderOrder = 2
  anchor.add(glow)

  // objet : sphère chromée rosée (reflets HDRI)
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(CFG.objRadius, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xf2a9a1, metalness: 1.0, roughness: 0.06, clearcoat: 0.3, envMapIntensity: 1.6 })
  )
  sphere.visible = false
  anchor.add(sphere)

  // physique (monde)
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CFG.gravity, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)
  const physMat = new CANNON.Material('obj')
  world.addContactMaterial(new CANNON.ContactMaterial(physMat, physMat, { friction: 0.35, restitution: CFG.restitution }))
  const floor = new CANNON.Body({ mass: 0, material: physMat })
  floor.addShape(new CANNON.Plane())
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  floor.position.set(0, groundY, 0)
  world.addBody(floor)
  let body = null

  let phase = 'idle' // idle | emerging | falling | rested
  let t = 0
  let clock = 0
  const _q = new THREE.Quaternion()
  const _v = new THREE.Vector3()

  const playIntro = () => {
    if (body) { world.removeBody(body); body = null }
    if (sphere.parent) sphere.parent.remove(sphere)
    anchor.add(sphere)
    sphere.position.set(0, 0, CFG.emergeFrom)
    sphere.quaternion.identity()
    sphere.scale.setScalar(1)
    sphere.visible = true
    phase = 'emerging'
    t = 0
    status('Un objet sort du portail…')
  }

  const detach = () => {
    scene.updateMatrixWorld(true)
    scene.attach(sphere) // reparente au monde en conservant la transform monde
    const ws = sphere.getWorldScale(_v).x
    const worldR = CFG.objRadius * ws
    body = new CANNON.Body({ mass: 1, material: physMat })
    body.addShape(new CANNON.Sphere(worldR))
    body.linearDamping = 0.06
    body.angularDamping = 0.6 // pour que la sphère cesse de rouler et se pose
    body.position.set(sphere.position.x, sphere.position.y, sphere.position.z)
    // vitesse : le long de la normale du mur (vers l'extérieur) + un peu vers le haut
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.getWorldQuaternion(_q)).normalize()
    body.velocity.set(dir.x * CFG.outSpeed * ws, dir.y * CFG.outSpeed * ws + CFG.upSpeed * ws, dir.z * CFG.outSpeed * ws)
    body.angularVelocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)
    world.addBody(body)
    phase = 'falling'
    status('Il tombe au sol…')
  }

  const update = (dt) => {
    clock += dt
    const pulse = 0.75 + 0.25 * Math.sin(clock * 3.0)
    glow.material.opacity = phase === 'emerging' ? pulse : Math.max(0, pulse * (1 - Math.min((phase === 'idle' ? 0 : t), 1)))
    glow.scale.setScalar(1 + 0.06 * Math.sin(clock * 2.2))
    ring.material.opacity = 0.55 + 0.35 * Math.sin(clock * 3.0)

    if (phase === 'emerging') {
      t += dt
      const e = easeOut(t / CFG.emergeDur)
      sphere.position.set(0, 0, CFG.emergeFrom + (CFG.emergeTo - CFG.emergeFrom) * e)
      sphere.rotation.y += dt * 1.6
      if (t >= CFG.emergeDur) detach()
    } else if (phase === 'falling') {
      world.step(1 / 60, dt, 3)
      sphere.position.set(body.position.x, body.position.y, body.position.z)
      sphere.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
      if (body.velocity.lengthSquared() < 2e-4 && body.angularVelocity.lengthSquared() < 2e-4) {
        phase = 'rested'
        status('Posé au sol ✓')
      }
    }
  }

  const setFloorY = (y) => { floor.position.set(0, y, 0) }

  return {
    anchor,
    update,
    playIntro,
    reset: playIntro,
    setFloorY,
    hasPlayedIntro: () => phase !== 'idle',
    getPhase: () => phase,
    ready: Promise.resolve(),
  }
}
