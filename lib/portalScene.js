// Scène "portail" partagée entre l'AR (ARPortal) et la page de test orbitale.
// buildPortalScene(renderer, scene) construit tout dans un groupe `anchor`,
// configure le rendu (tone mapping, environnement, clipping, stencil) et
// renvoie une petite API : { anchor, update(dt), playIntro(), toggleCap(), getProxy(), ready }.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export const CFG = {
  modelUrl: '/mascara.glb',
  bookTexUrl: '/image-targets/book_cropped.jpg',

  imageWidth: 1.0,
  bookAspect: 1200 / 1600, // largeur/hauteur (3:4)
  coverFit: 0.78, // <1 resserre l'ouverture/les portes

  doorDepth: 0.025,
  doorOpenAngle: (115 * Math.PI) / 180,
  doorDuration: 0.9,
  doorSign: 1,

  roomDepth: 1.4,

  heightUnits: 1.2,
  capNodeName: 'HC HAUT',
  openLiftRatio: 0.9,
  capOpenDuration: 0.9,
  standSign: 1,
  emergeDelay: 0.5,
  emergeDuration: 1.3,
  emergeDepth: 1.25,

  envMapIntensity: 1.25,
  exposure: 1.1,
}

const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
const easeOutBack = (x) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
const smooth = (x) => x * x * (3 - 2 * x)

export function buildPortalScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const gl = renderer.getContext()

  const fw = CFG.imageWidth * CFG.coverFit
  const fh = (CFG.imageWidth / CFG.bookAspect) * CFG.coverFit
  const depth = CFG.roomDepth

  // rendu
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = CFG.exposure
  renderer.localClippingEnabled = true
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xfff2e0, 1.15)
  key.position.set(1, 2.5, 2)
  scene.add(key)

  const anchor = new THREE.Group()
  anchor.visible = false
  scene.add(anchor)

  // état
  let cap = null
  let proxy = null
  let emergeGroup = null
  let backWall = null
  let glow = null
  let portalLight = null
  let leftDoor = null
  let rightDoor = null
  let particles = null
  let strips = []

  let introActive = false
  let introPlayed = false
  let introT = 0
  let capOpen = false
  let capProgress = 0
  let clock = 0

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const _n = new THREE.Vector3()

  const stencilInside = (m) => {
    m.stencilWrite = true
    m.stencilRef = 1
    m.stencilFunc = THREE.EqualStencilFunc
    m.stencilFail = THREE.KeepStencilOp
    m.stencilZFail = THREE.KeepStencilOp
    m.stencilZPass = THREE.KeepStencilOp
    return m
  }

  const makeRadialTex = (inner, outer) => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128)
    grd.addColorStop(0, inner)
    grd.addColorStop(0.4, outer)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

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
    }
    cap = foundCap

    root.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
          if ('envMapIntensity' in m) m.envMapIntensity = CFG.envMapIntensity
          m.clippingPlanes = [clipPlane]
          m.clipShadows = true
          m.needsUpdate = true
        })
      }
    })
    return wrap
  }

  const buildDoors = () => {
    const loader = new THREE.TextureLoader()
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x161616,
      roughness: 0.55,
      metalness: 0.35,
    })
    const makeDoor = (isLeft) => {
      // une texture par porte (pas de clone avant chargement) : la demi-couverture
      const t = loader.load(CFG.bookTexUrl)
      t.colorSpace = THREE.SRGBColorSpace
      t.repeat.set(0.5, 1)
      t.offset.set(isLeft ? 0 : 0.5, 0)
      const front = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0 })
      const mats = [edgeMat, edgeMat, edgeMat, edgeMat, front, edgeMat]
      const b = new THREE.Mesh(new THREE.BoxGeometry(fw / 2, fh, CFG.doorDepth), mats)
      b.position.set(isLeft ? fw / 4 : -fw / 4, 0, -CFG.doorDepth / 2)
      b.renderOrder = 1
      const group = new THREE.Group()
      group.add(b)
      group.position.x = isLeft ? -fw / 2 : fw / 2
      return group
    }
    leftDoor = makeDoor(true)
    rightDoor = makeDoor(false)
    return [leftDoor, rightDoor]
  }

  const buildMask = () => {
    const m = new THREE.MeshBasicMaterial()
    m.colorWrite = false
    m.depthWrite = false
    m.depthTest = false
    m.stencilWrite = true
    m.stencilRef = 1
    m.stencilFunc = THREE.AlwaysStencilFunc
    m.stencilZPass = THREE.ReplaceStencilOp
    m.stencilFail = THREE.ReplaceStencilOp
    m.stencilZFail = THREE.ReplaceStencilOp
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), m)
    mask.renderOrder = -1
    return mask
  }

  const buildInterior = () => {
    const g = new THREE.Group()
    const wallMat = stencilInside(
      new THREE.MeshStandardMaterial({
        color: 0x0b0b0d,
        roughness: 0.7,
        metalness: 0.25,
        side: THREE.DoubleSide,
      })
    )
    const wall = (w, h, rot, pos, ro) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat)
      mesh.rotation.set(rot.x || 0, rot.y || 0, 0)
      mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0)
      mesh.renderOrder = ro
      g.add(mesh)
    }
    wall(depth, fh, { y: Math.PI / 2 }, { x: -fw / 2, z: -depth / 2 }, 2)
    wall(depth, fh, { y: -Math.PI / 2 }, { x: fw / 2, z: -depth / 2 }, 2)
    wall(fw, depth, { x: Math.PI / 2 }, { y: fh / 2, z: -depth / 2 }, 2)
    wall(fw, depth, { x: -Math.PI / 2 }, { y: -fh / 2, z: -depth / 2 }, 2)

    backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      stencilInside(
        new THREE.MeshStandardMaterial({
          color: 0x050505,
          emissive: 0xc9a45c,
          emissiveMap: makeRadialTex('rgba(255,244,220,1)', 'rgba(220,175,105,0.85)'),
          emissiveIntensity: 0,
          roughness: 0.5,
          metalness: 0.4,
        })
      )
    )
    backWall.position.z = -depth + 0.01
    backWall.renderOrder = 2
    g.add(backWall)

    strips = []
    ;[-fw * 0.26, 0, fw * 0.26].forEach((x) => {
      const s = new THREE.Mesh(
        new THREE.PlaneGeometry(0.02, fh * 0.82),
        stencilInside(
          new THREE.MeshBasicMaterial({
            color: 0xffe6b0,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0,
          })
        )
      )
      s.position.set(x, 0, -depth + 0.06)
      s.renderOrder = 3
      g.add(s)
      strips.push(s)
    })

    glow = new THREE.Mesh(
      new THREE.PlaneGeometry(fw * 1.2, fh * 1.2),
      stencilInside(
        new THREE.MeshBasicMaterial({
          map: makeRadialTex('rgba(255,244,220,0.9)', 'rgba(220,175,105,0.5)'),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        })
      )
    )
    glow.position.z = -depth + 0.12
    glow.renderOrder = 3
    g.add(glow)

    portalLight = new THREE.PointLight(0xffe6b0, 0, 4)
    portalLight.position.set(0, 0, -depth * 0.4)
    g.add(portalLight)
    return g
  }

  const buildParticles = () => {
    const N = 80
    const pos = new Float32Array(N * 3)
    const spd = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * fw * 0.8
      pos[i * 3 + 1] = (Math.random() - 0.5) * fh * 0.8
      pos[i * 3 + 2] = -Math.random() * depth
      spd[i] = 0.25 + Math.random() * 0.5
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = stencilInside(
      new THREE.PointsMaterial({
        size: 0.04,
        map: makeRadialTex('rgba(255,240,210,1)', 'rgba(255,240,210,0)'),
        color: 0xffe6b0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      })
    )
    particles = new THREE.Points(geo, mat)
    particles.userData.spd = spd
    particles.renderOrder = 3
    return particles
  }

  // assemblage
  anchor.add(buildMask())
  anchor.add(buildInterior())
  anchor.add(buildParticles())
  buildDoors().forEach((d) => anchor.add(d))
  emergeGroup = new THREE.Group()
  anchor.add(emergeGroup)

  const ready = new Promise((resolve) => {
    new GLTFLoader().load(
      CFG.modelUrl,
      (gltf) => {
        const modelWrap = prepareModel(gltf.scene)
        const stand = new THREE.Group()
        stand.rotation.x = (CFG.standSign * Math.PI) / 2
        stand.add(modelWrap)
        emergeGroup.add(stand)
        emergeGroup.position.z = -CFG.emergeDepth

        anchor.updateMatrixWorld(true)
        const wb = new THREE.Box3().setFromObject(modelWrap)
        wb.applyMatrix4(modelWrap.matrixWorld.clone().invert())
        const psize = wb.getSize(new THREE.Vector3())
        const pcenter = wb.getCenter(new THREE.Vector3())
        proxy = new THREE.Mesh(
          new THREE.BoxGeometry(psize.x, psize.y, psize.z),
          new THREE.MeshBasicMaterial({ visible: false })
        )
        proxy.position.copy(pcenter)
        modelWrap.add(proxy)
        status('Prêt')
        resolve()
      },
      undefined,
      (err) => {
        console.error('[portalScene] modèle', err)
        status('Erreur : modèle 3D introuvable')
        resolve()
      }
    )
  })

  const playIntro = () => {
    if (!emergeGroup) return
    introPlayed = true
    introActive = true
    introT = 0
    capOpen = false
    capProgress = 0
    emergeGroup.position.z = -CFG.emergeDepth
  }

  const toggleCap = () => {
    capOpen = !capOpen
    return capOpen
  }

  const update = (dt) => {
    clock += dt
    // 8th Wall met autoClear=false (pour garder le flux caméra) : on efface le
    // stencil nous-mêmes chaque frame, sinon le portail laisse une traînée.
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    // plan de découpe depuis la pose de l'ancre
    _n.set(0, 0, 1).applyQuaternion(anchor.quaternion).normalize()
    clipPlane.normal.copy(_n)
    clipPlane.constant = -anchor.position.dot(_n)

    if (introActive) {
      introT += dt
      const dk = Math.min(introT / CFG.doorDuration, 1)
      const ang = easeInOut(dk) * CFG.doorOpenAngle * CFG.doorSign
      if (leftDoor) leftDoor.rotation.y = ang
      if (rightDoor) rightDoor.rotation.y = -ang
      if (backWall) backWall.material.emissiveIntensity = dk * 1.6
      if (glow) glow.material.opacity = dk * 0.9
      if (portalLight) portalLight.intensity = dk * 3
      strips.forEach((s) => (s.material.opacity = dk * 0.5))
      if (particles) particles.material.opacity = dk
      const ek = Math.max(0, Math.min((introT - CFG.emergeDelay) / CFG.emergeDuration, 1))
      if (emergeGroup) emergeGroup.position.z = -CFG.emergeDepth * (1 - easeOutBack(ek))
      if (ek >= 1 && dk >= 1) introActive = false
    }

    if (!introActive && backWall && backWall.material.emissiveIntensity > 0) {
      const pulse = 1 + Math.sin(clock * 2) * 0.08
      backWall.material.emissiveIntensity = 1.6 * pulse
      strips.forEach((s, i) => (s.material.opacity = 0.5 * (0.7 + 0.3 * Math.sin(clock * 3 + i))))
    }

    if (particles && particles.material.opacity > 0.01) {
      const p = particles.geometry.attributes.position
      const spd = particles.userData.spd
      for (let i = 0; i < p.count; i++) {
        let z = p.getZ(i) + spd[i] * dt
        if (z > 0) z = -depth
        p.setZ(i, z)
      }
      p.needsUpdate = true
    }

    if (cap && cap.userData.lift) {
      const dir = capOpen ? 1 : -1
      capProgress = Math.max(0, Math.min(1, capProgress + (dir * dt) / CFG.capOpenDuration))
      cap.position.copy(cap.userData.base).addScaledVector(cap.userData.lift, smooth(capProgress))
    }
  }

  return {
    anchor,
    update,
    playIntro,
    toggleCap,
    getProxy: () => proxy,
    hasPlayedIntro: () => introPlayed,
    ready,
  }
}
