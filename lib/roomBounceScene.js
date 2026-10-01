// Balle qui rebondit dans la pièce (WebAR + SLAM). On enregistre les VRAIES surfaces
// détectées par la caméra (sol + murs, via hit-test), qui deviennent des plans de
// collision cannon-es ; puis on lâche des balles qui rebondissent dessus en temps réel.
// Cross-platform (iOS + Android), sans image à scanner.

import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import * as CANNON from 'cannon-es'

export const CFG = {
  hdrUrl: '/hdr/photo_studio_01.hdr',
  gravity: 9.8,
  restitution: 0.72, // rebond
  friction: 0.25,
  surfSize: 1.2, // taille du repère visuel de surface (m)
  ballRadius: 0.06, // 6 cm
  maxBalls: 8,
  ballLife: 20,
}

export function buildRoomBounceScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)

  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environmentIntensity = 1.1
  new RGBELoader().load(CFG.hdrUrl, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    hdr.dispose()
  })
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xfff2e8, 1.4)
  key.position.set(2, 5, 3)
  scene.add(key)

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CFG.gravity, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)
  const physMat = new CANNON.Material('m')
  world.addContactMaterial(new CANNON.ContactMaterial(physMat, physMat, { friction: CFG.friction, restitution: CFG.restitution }))

  const surfaces = [] // murs { body, mesh }
  const balls = [] // { body, mesh, life }
  let floorBody = null, floorMesh = null // sol unique (auto-détecté)

  // sol auto : un seul plan horizontal, dont on met à jour la hauteur en direct
  const setFloor = (y) => {
    if (!floorBody) {
      floorBody = new CANNON.Body({ mass: 0, material: physMat })
      floorBody.addShape(new CANNON.Plane())
      floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
      world.addBody(floorBody)
      floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8),
        new THREE.MeshBasicMaterial({ color: 0x6cff9a, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
      )
      floorMesh.rotation.x = -Math.PI / 2
      scene.add(floorMesh)
    }
    floorBody.position.set(0, y, 0)
    floorMesh.position.set(0, y, 0)
  }
  const hasFloor = () => !!floorBody

  const ballGeo = new THREE.SphereGeometry(1, 32, 24)
  const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xf2a9a1, metalness: 1.0, roughness: 0.08, clearcoat: 0.4, envMapIntensity: 1.6 })

  const _z = new THREE.Vector3(0, 0, 1)
  const _q = new THREE.Quaternion()

  // enregistre une surface réelle : pos (monde) + normale (monde, vers la pièce)
  const addSurface = (pos, normal) => {
    const n = normal.clone().normalize()
    _q.setFromUnitVectors(_z, n) // plan cannon (normale +Z local) aligné sur la vraie normale
    const body = new CANNON.Body({ mass: 0, material: physMat })
    body.addShape(new CANNON.Plane())
    body.position.set(pos.x, pos.y, pos.z)
    body.quaternion.set(_q.x, _q.y, _q.z, _q.w)
    world.addBody(body)

    // repère visuel translucide (pour voir la surface captée)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.surfSize, CFG.surfSize),
      new THREE.MeshBasicMaterial({ color: 0xC9A45C, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
    )
    mesh.position.copy(pos)
    mesh.quaternion.copy(_q)
    scene.add(mesh)
    surfaces.push({ body, mesh })
    status(`Surfaces : ${surfaces.length} · lâchez une balle`)
    return surfaces.length
  }

  const dropBall = (pos, vel, radius = CFG.ballRadius) => {
    if (surfaces.length === 0 && !floorBody) { status('Balayez la pièce pour détecter le sol'); return }
    const body = new CANNON.Body({ mass: 0.2, material: physMat })
    body.addShape(new CANNON.Sphere(radius))
    body.position.set(pos.x, pos.y, pos.z)
    body.velocity.set(vel.x, vel.y, vel.z)
    body.linearDamping = 0.01
    body.angularDamping = 0.05
    world.addBody(body)
    const mesh = new THREE.Mesh(ballGeo, ballMat)
    mesh.scale.setScalar(radius)
    scene.add(mesh)
    balls.push({ body, mesh, life: 0 })
    // limite le nombre de balles
    while (balls.length > CFG.maxBalls) {
      const b = balls.shift()
      world.removeBody(b.body)
      scene.remove(b.mesh)
    }
  }

  const clearBalls = () => {
    for (const b of balls) { world.removeBody(b.body); scene.remove(b.mesh) }
    balls.length = 0
  }

  const reset = () => {
    clearBalls()
    for (const s of surfaces) { world.removeBody(s.body); scene.remove(s.mesh) }
    surfaces.length = 0
    if (floorBody) { world.removeBody(floorBody); scene.remove(floorMesh); floorBody = null; floorMesh = null }
    status('Balayez la pièce pour scanner le sol / les murs')
  }

  const update = (dt) => {
    world.step(1 / 60, dt, 3)
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]
      b.life += dt
      b.mesh.position.set(b.body.position.x, b.body.position.y, b.body.position.z)
      b.mesh.quaternion.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w)
      if (b.life > CFG.ballLife || b.body.position.y < -8) {
        world.removeBody(b.body)
        scene.remove(b.mesh)
        balls.splice(i, 1)
      }
    }
  }

  return { addSurface, setFloor, hasFloor, dropBall, clearBalls, reset, update, surfaceCount: () => surfaces.length, ready: Promise.resolve() }
}
