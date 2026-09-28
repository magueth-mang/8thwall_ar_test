// Scène "mur QR qui éclate + espace" avec VRAIE physique (cannon-es).
// Le produit dérive dans l'espace, fonce d'une traite, PERCUTE le mur (le choc
// pousse les débris en morceaux triangulaires en relief), puis sort dans l'espace réel.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Delaunay } from 'd3-delaunay'
import * as CANNON from 'cannon-es'

export const CFG = {
  modelUrl: '/mascara.glb',
  targetName: 'qr',
  targetDataUrl: '/image-targets/qr.json',
  wallTexUrl: '/targets/qrcode.png',
  skyUrl: '/skybox/space_4k.jpg',

  wallSize: 1.35,
  spaceDepth: 5.0,

  // fracture (triangles Delaunay, en relief) — apesanteur
  fragPoints: 42,
  fragThickness: 0.05,
  gravity: 0.12, // quasi apesanteur
  restitution: 0.12,
  impactForward: 0.5, // poussée vers la caméra (le mascara plaque les morceaux devant lui)
  impactSpread: 0.16, // faible poussée radiale
  coreRadius: 0.42, // rayon libéré INSTANTANÉMENT au contact (trajectoire du mascara)
  crackSpeed: 1.6, // propagation rapide de la fissure vers l'extérieur
  debrisLife: 6.5, // longue lévitation avant disparition
  contactZ: 0.16, // portée avant du mascara → contact réel avec le mur

  // mascara : arrive à la dérive dans l'espace (approche modérée, pas de temps mort)
  faceRotationY: 0,
  emergeDepth: 2.6, // départ profond
  outDepth: 0.9, // arrivée (hors du mur, espace réel)
  tMove: [0.3, 3.0], // avancée fluide
  spinSpeed: 0.5, // rotation continue (dérive)
  driftZ: 0.18, // culbute latérale
  driftX: 0.12,
  driftSpeedZ: 0.6,
  driftSpeedX: 0.9,
  levitateAmp: 0.05,
  levitateSpeed: 1.3,

  heightUnits: 1.1,
  capNodeName: 'HC HAUT',
  openLiftRatio: 0.9,
  capOpenDuration: 0.9,

  envMapIntensity: 1.2,
  exposure: 1.1,
}

const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2
const smooth = (x) => x * x * (3 - 2 * x)

export function buildSpaceWallScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const gl = renderer.getContext()

  const fw = CFG.wallSize
  const fh = CFG.wallSize
  const depth = CFG.spaceDepth

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = CFG.exposure
  renderer.localClippingEnabled = true
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.9)
  key.position.set(1.5, 2, 4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xfff0e6, 1.3) // éclaire le produit face caméra
  fill.position.set(-1, 0.6, 3)
  scene.add(fill)

  const anchor = new THREE.Group()
  anchor.visible = false
  scene.add(anchor)

  // --- physique (en coordonnées locales de l'ancre) ---
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CFG.gravity, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  const physMat = new CANNON.Material('frag')
  world.addContactMaterial(
    new CANNON.ContactMaterial(physMat, physMat, { friction: 0.3, restitution: CFG.restitution })
  )
  const productBody = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    material: physMat,
  })
  productBody.addShape(new CANNON.Box(new CANNON.Vec3(0.13, CFG.heightUnits / 2, 0.13)))
  world.addBody(productBody)

  let cap = null
  let proxy = null
  let emergeGroup = null
  let product = null
  const productMats = []
  const fragments = []
  let wallMat = null

  let introPlayed = false
  let introT = 0
  let prevZ = -CFG.emergeDepth
  let impactStarted = false
  let frontRadius = 0
  let debrisT = 0
  let masked = true
  let capOpen = false
  let capProgress = 0
  let clock = 0

  const stencilInside = (m) => {
    m.stencilWrite = true
    m.stencilRef = 1
    m.stencilFunc = THREE.EqualStencilFunc
    m.stencilFail = THREE.KeepStencilOp
    m.stencilZFail = THREE.KeepStencilOp
    m.stencilZPass = THREE.KeepStencilOp
    return m
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

  // espace = vraie skybox équirectangulaire (masquée au stencil)
  const buildSpace = () => {
    const g = new THREE.Group()
    const tex = new THREE.TextureLoader().load(CFG.skyUrl, (t) => {
      // reflets spatiaux sur le produit métallique
      scene.environment = pmrem.fromEquirectangular(t).texture
    })
    tex.colorSpace = THREE.SRGBColorSpace
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(depth * 2.4, 48, 32),
      stencilInside(new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false }))
    )
    sky.renderOrder = 1
    g.add(sky)

    const glow = new THREE.PointLight(0x9ec2ff, 2.4, depth * 4)
    glow.position.set(0.4, 0.5, -depth * 0.3)
    g.add(glow)
    const rim = new THREE.PointLight(0xffd0b0, 1.4, depth * 3)
    rim.position.set(-0.6, -0.3, 0.4)
    g.add(rim)
    return g
  }

  // mur = fragments triangulaires EXTRUDÉS (relief), texture QR, + corps physiques
  const buildWall = (tex) => {
    const g = new THREE.Group()
    tex.colorSpace = THREE.SRGBColorSpace
    // matériau de base ; chaque fragment en aura un clone (pour basculer son
    // masquage stencil selon qu'il est devant ou derrière le plan du mur)
    wallMat = new THREE.MeshStandardMaterial({
      map: tex,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
    })
    const hw = fw / 2
    const hh = fh / 2
    const pts = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ]
    const E = 5
    for (let i = 1; i < E; i++) {
      const t = i / E
      pts.push([-hw + t * fw, -hh], [-hw + t * fw, hh], [-hw, -hh + t * fh], [hw, -hh + t * fh])
    }
    for (let i = 0; i < CFG.fragPoints; i++) {
      pts.push([(Math.random() - 0.5) * fw * 0.94, (Math.random() - 0.5) * fh * 0.94])
    }
    const del = Delaunay.from(pts)
    const tris = del.triangles
    for (let i = 0; i < tris.length; i += 3) {
      const a = pts[tris[i]]
      const b = pts[tris[i + 1]]
      const c = pts[tris[i + 2]]
      const cx = (a[0] + b[0] + c[0]) / 3
      const cy = (a[1] + b[1] + c[1]) / 3

      const shape = new THREE.Shape()
      shape.moveTo(a[0] - cx, a[1] - cy)
      shape.lineTo(b[0] - cx, b[1] - cy)
      shape.lineTo(c[0] - cx, c[1] - cy)
      shape.closePath()
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: CFG.fragThickness,
        bevelEnabled: false,
      })
      // face QR affleurante au plan du marqueur (z=0), épaisseur vers l'arrière
      geo.translate(0, 0, -CFG.fragThickness)
      // UV basées sur la position monde → QR correct sur la face, tranche en relief
      const p = geo.attributes.position
      const uv = new Float32Array(p.count * 2)
      for (let k = 0; k < p.count; k++) {
        uv[k * 2] = (p.getX(k) + cx) / fw + 0.5
        uv[k * 2 + 1] = (p.getY(k) + cy) / fh + 0.5
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))

      // clone du matériau : configuré pour un test stencil EQUAL, activé seulement
      // quand le fragment passe derrière le mur (stencilWrite basculé par frame)
      const fmat = wallMat.clone()
      fmat.stencilRef = 1
      fmat.stencilFunc = THREE.EqualStencilFunc
      fmat.stencilFail = THREE.KeepStencilOp
      fmat.stencilZFail = THREE.KeepStencilOp
      fmat.stencilZPass = THREE.KeepStencilOp
      fmat.stencilWrite = false // mur intact = rendu normal
      const frag = new THREE.Mesh(geo, fmat)
      frag.position.set(cx, cy, 0)
      frag.userData.mat = fmat
      frag.userData.home = new THREE.Vector3(cx, cy, 0)
      frag.userData.dist = Math.hypot(cx, cy) // distance au centre (point d'impact)
      frag.userData.released = false
      g.add(frag)
      fragments.push(frag)

      // corps physique (boîte englobante), statique tant que le mur est intact
      const hx = Math.max(0.02, (Math.max(a[0], b[0], c[0]) - Math.min(a[0], b[0], c[0])) / 2)
      const hy = Math.max(0.02, (Math.max(a[1], b[1], c[1]) - Math.min(a[1], b[1], c[1])) / 2)
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: physMat })
      body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, CFG.fragThickness / 2)))
      body.position.set(cx, cy, 0)
      world.addBody(body)
      frag.userData.body = body
    }
    return g
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
          stencilInside(m)
          productMats.push(m)
        })
        o.renderOrder = 5
      }
    })
    return wrap
  }

  // assemblage
  anchor.add(buildMask())
  anchor.add(buildSpace())
  emergeGroup = new THREE.Group()
  anchor.add(emergeGroup)

  new THREE.TextureLoader().load(CFG.wallTexUrl, (tex) => {
    anchor.add(buildWall(tex))
  })

  const ready = new Promise((resolve) => {
    new GLTFLoader().load(
      CFG.modelUrl,
      (gltf) => {
        const modelWrap = prepareModel(gltf.scene)
        modelWrap.position.y -= CFG.heightUnits / 2
        product = new THREE.Group()
        product.rotation.y = CFG.faceRotationY
        product.add(modelWrap)
        emergeGroup.add(product)
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
        console.error('[spaceWall] modèle', err)
        status('Erreur : modèle 3D introuvable')
        resolve()
      }
    )
  })

  const setMasked = (b) => {
    if (b === masked) return
    masked = b
    productMats.forEach((m) => (m.stencilWrite = b))
  }

  // libère UN fragment (quand la fracture l'atteint) : devient dynamique + petite
  // poussée douce (surtout vers l'avant, contre le produit) → apesanteur
  const releaseFragment = (f) => {
    if (f.userData.released) return
    f.userData.released = true
    const body = f.userData.body
    body.type = CANNON.Body.DYNAMIC
    body.mass = 0.3
    body.updateMassProperties()
    body.wakeUp()
    const d = f.userData.dist || 0.001
    const nx = body.position.x / d
    const ny = body.position.y / d
    body.applyImpulse(
      new CANNON.Vec3(
        nx * CFG.impactSpread * (0.4 + Math.random() * 0.6),
        ny * CFG.impactSpread * (0.4 + Math.random() * 0.6),
        CFG.impactForward * (0.5 + Math.random() * 0.6)
      ),
      new CANNON.Vec3(0, 0, 0)
    )
    body.angularVelocity.set(
      (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * 2.5
    )
  }

  const playIntro = () => {
    if (!emergeGroup) return
    introPlayed = true
    introT = 0
    prevZ = -CFG.emergeDepth
    impactStarted = false
    frontRadius = 0
    debrisT = 0
    capOpen = false
    capProgress = 0
    setMasked(true)
    emergeGroup.position.z = -CFG.emergeDepth
    if (product) {
      product.rotation.set(0, CFG.faceRotationY, 0)
      product.position.set(0, 0, 0)
    }
    fragments.forEach((f) => {
      f.visible = true
      if (f.userData.mat) {
        f.userData.mat.opacity = 1
        f.userData.mat.stencilWrite = false
      }
      const body = f.userData.body
      body.type = CANNON.Body.STATIC
      body.mass = 0
      body.updateMassProperties()
      body.velocity.setZero()
      body.angularVelocity.setZero()
      const h = f.userData.home
      body.position.set(h.x, h.y, 0)
      body.quaternion.set(0, 0, 0, 1)
      f.position.copy(h)
      f.rotation.set(0, 0, 0)
      f.userData.released = false
    })
  }

  const toggleCap = () => {
    capOpen = !capOpen
    return capOpen
  }

  const update = (dt) => {
    clock += dt
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)

    if (introPlayed) introT += dt

    // avancée du produit : lente, à la dérive, de l'espace vers la caméra
    if (product && introPlayed) {
      const [t0, t1] = CFG.tMove
      let z
      if (introT < t0) z = -CFG.emergeDepth
      else if (introT < t1) {
        const p = (introT - t0) / (t1 - t0)
        z = -CFG.emergeDepth + (CFG.emergeDepth + CFG.outDepth) * easeInOutSine(p)
      } else z = CFG.outDepth
      emergeGroup.position.z = z
      setMasked(z < 0.02)

      // COLLISION DIRECTE : dès que l'avant du mascara touche le mur, on libère
      // INSTANTANÉMENT tout le cœur (sa trajectoire) → jamais de morceau figé
      // coincé dans le mascara ; la fissure se propage ensuite vers l'extérieur.
      if (!impactStarted && z >= -CFG.contactZ) {
        impactStarted = true
        debrisT = 0
        frontRadius = CFG.coreRadius
        for (const f of fragments) {
          if (f.userData.dist <= frontRadius) releaseFragment(f)
        }
      }
      prevZ = z

      // corps du produit (cinématique) suit le mascara (pousse les morceaux au contact)
      const vz = (z - productBody.position.z) / Math.max(dt, 1e-4)
      productBody.position.set(0, 0, z)
      productBody.velocity.set(0, 0, vz)

      // dérive spatiale : rotation continue + culbute multi-axes + flottement
      product.rotation.y += CFG.spinSpeed * dt
      product.rotation.z = Math.sin(clock * CFG.driftSpeedZ) * CFG.driftZ
      product.rotation.x = Math.sin(clock * CFG.driftSpeedX) * CFG.driftX
      product.position.y = Math.sin(clock * CFG.levitateSpeed) * CFG.levitateAmp
    }

    // fracture qui se propage depuis l'impact + simulation lente (apesanteur)
    if (impactStarted) {
      debrisT += dt
      frontRadius += CFG.crackSpeed * dt
      for (const f of fragments) {
        if (!f.userData.released && f.userData.dist <= frontRadius) releaseFragment(f)
      }
      world.step(1 / 60, dt, 3)
      const k = Math.min(debrisT / CFG.debrisLife, 1)
      const op = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25
      for (const f of fragments) {
        if (!f.userData.released) continue
        const b = f.userData.body
        f.position.set(b.position.x, b.position.y, b.position.z)
        f.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)
        // DERRIÈRE le plan du mur → rendu uniquement dans le portail (stencil)
        f.userData.mat.stencilWrite = f.position.z < -0.003
        f.userData.mat.opacity = op
      }
      if (k >= 1) fragments.forEach((f) => (f.visible = false))
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
