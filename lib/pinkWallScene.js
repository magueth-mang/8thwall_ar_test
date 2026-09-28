// Scène "mur qui éclate + UNIVERS ROSE" (design/pub) avec vraie physique (cannon-es).
// Le LIPSTICK (rendu IDENTIQUE à /gloss : mêmes matériaux, HDRI studio, NeutralToneMapping)
// fonce, percute le mur (fracture), et derrière : un univers rose lumineux. Au clic sur le
// lipstick → son animation d'ouverture (capuchon qui se lève + bâtonnet qui sort en tournant).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { Delaunay } from 'd3-delaunay'
import * as CANNON from 'cannon-es'

export const CFG = {
  modelUrl: '/lovenude.glb',
  targetName: 'yslmarker',
  targetDataUrl: '/image-targets/yslmarker.json',
  wallTexUrl: '/targets/ysl_marker.png',
  hdrUrl: '/hdr/photo_studio_01.hdr',
  envRot: 1.2,

  wallSize: 1.35,
  spaceDepth: 5.0,

  fragPoints: 42,
  fragThickness: 0.05,
  gravity: 0.12,
  restitution: 0.12,
  impactForward: 0.5,
  impactSpread: 0.16,
  coreRadius: 0.42,
  crackSpeed: 1.6,
  debrisLife: 6.5,
  contactZ: 0.16,

  faceRotationY: 0,
  emergeDepth: 2.6,
  outDepth: 0.9,
  tMove: [0.3, 3.0],
  spinSpeed: 0.4,
  driftZ: 0.14,
  driftX: 0.1,
  driftSpeedZ: 0.6,
  driftSpeedX: 0.9,
  levitateAmp: 0.05,
  levitateSpeed: 1.3,

  heightUnits: 0.95, // lipstick plus petit

  exposure: 1.0,
}

// matériaux du lipstick — valeurs EXACTES de /gloss (par NOM de matériau)
const MAT = {
  cap: { color: 0xe8c5bf, metalness: 1.0, roughness: 0.0, clearcoat: 0.0, envMapIntensity: 1.0 },
  cassandre: { color: 0xe8eaef, metalness: 1.0, roughness: 0.06, clearcoat: 0.0, envMapIntensity: 1.1 },
  bottleMatte: { color: 0xe8c5bf, metalness: 0.47, roughness: 0.48, clearcoat: 0.15, envMapIntensity: 0.2 },
  bottleGlossy: { color: 0xe8c5bf, metalness: 0.47, roughness: 0.48, clearcoat: 0.15, envMapIntensity: 0.2 },
  bullet: { color: 0xe8c5bf, metalness: 1.0, roughness: 0.0, clearcoat: 0.1, envMapIntensity: 1.0 },
  ring: { color: 0x582c2c, metalness: 0.0, roughness: 0.38, clearcoat: 0.0, envMapIntensity: 0.0 },
  capInterior: { color: 0x0b0b0b, metalness: 0.2, roughness: 0.35, envMapIntensity: 1.2 },
}

// animation d'ouverture — mêmes réglages que /gloss
const OPEN = {
  duration: 2.4,
  capUpRatio: 0.34,
  capSideRatio: 0.5,
  capTilt: 0.5,
  balmSpinTurns: 2.0,
  balmRiseRatio: 0.16,
}

const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2

export function buildPinkWallScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const gl = renderer.getContext()

  const fw = CFG.wallSize
  const fh = CFG.wallSize
  const depth = CFG.spaceDepth

  // rendu identique à /gloss : NeutralToneMapping (préserve teinte/saturation) + HDRI studio.
  // AUCUNE lumière teintée rose ici : le QR et les débris gardent leurs vraies couleurs.
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = CFG.exposure
  renderer.localClippingEnabled = true
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environmentIntensity = 1.0
  new RGBELoader().load(CFG.hdrUrl, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(hdr).texture
    scene.environmentRotation = new THREE.Euler(0, CFG.envRot, 0)
    hdr.dispose()
  })

  // éclairage identique à /gloss (highlights métalliques, lumière neutre)
  scene.add(new THREE.AmbientLight(0xffffff, 0.3))
  const key = new THREE.DirectionalLight(0xfff4ec, 1.7)
  key.position.set(2, 4, 3)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffe8ee, 0.55)
  fill.position.set(-3, 1, 2)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xd8e6ff, 0.7)
  rim.position.set(-1, 2, -3)
  scene.add(rim)

  const anchor = new THREE.Group()
  anchor.visible = false
  scene.add(anchor)

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CFG.gravity, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  const physMat = new CANNON.Material('frag')
  world.addContactMaterial(new CANNON.ContactMaterial(physMat, physMat, { friction: 0.3, restitution: CFG.restitution }))
  const productBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: physMat })
  productBody.addShape(new CANNON.Box(new CANNON.Vec3(0.1, CFG.heightUnits / 2, 0.1)))
  world.addBody(productBody)

  let proxy = null
  let emergeGroup = null
  let product = null
  const productMats = []
  const fragments = []
  let wallMat = null
  let ribbons = []
  let particles = null

  // ouverture
  let capGroup = null
  let balmGroup = null
  const capBase = new THREE.Vector3()
  let capUp = 0
  let capSide = 0
  let balmRise = 0
  let isOpen = false
  let openA = 0

  let introPlayed = false
  let introT = 0
  let impactStarted = false
  let frontRadius = 0
  let debrisT = 0
  let masked = true
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

  const softDisc = () => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grd.addColorStop(0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.4, 'rgba(255,255,255,0.6)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  // texture de ruban : tache douce qui s'estompe sur tous les bords (aspect soie)
  const ribbonTex = () => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 256, 0)
    grd.addColorStop(0, 'rgba(255,255,255,0)')
    grd.addColorStop(0.5, 'rgba(255,255,255,1)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 64)
    // estompe aussi le haut/bas de la largeur
    g.globalCompositeOperation = 'destination-in'
    const vg = g.createLinearGradient(0, 0, 0, 64)
    vg.addColorStop(0, 'rgba(255,255,255,0)')
    vg.addColorStop(0.5, 'rgba(255,255,255,1)')
    vg.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = vg
    g.fillRect(0, 0, 256, 64)
    g.globalCompositeOperation = 'source-over'
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  const RIB_SEG = 96
  // un ruban = bande le long d'une courbe animée (positions recalculées / frame)
  const makeRibbon = (tex, color, params) => {
    const geo = new THREE.BufferGeometry()
    const verts = new Float32Array((RIB_SEG + 1) * 2 * 3)
    const uvs = new Float32Array((RIB_SEG + 1) * 2 * 2)
    const idx = []
    for (let i = 0; i <= RIB_SEG; i++) {
      uvs[i * 4] = i / RIB_SEG
      uvs[i * 4 + 1] = 0
      uvs[i * 4 + 2] = i / RIB_SEG
      uvs[i * 4 + 3] = 1
    }
    for (let i = 0; i < RIB_SEG; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(idx)
    const mat = stencilInside(
      new THREE.MeshBasicMaterial({
        map: tex,
        color,
        transparent: true,
        opacity: params.opacity,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    mesh.userData = params
    return mesh
  }

  const PI2 = Math.PI * 2
  const _tan = new THREE.Vector3()
  const _w = new THREE.Vector3()
  const _ref = new THREE.Vector3()
  const _bin = new THREE.Vector3()
  // Chaque ruban suit une courbe qui s'ENROULE en spirale (direction + sens propres),
  // ondule (multi-fréquences), et l'ensemble tourne lentement → dragons majestueux.
  // La largeur est orientée sur la tangente puis vrillée → vraie soie.
  const updateRibbons = (time) => {
    for (const r of ribbons) {
      const u = r.userData
      const cl = u.cline
      // 1) ligne centrale : sweep tourné par un angle qui croît avec t (spirale)
      for (let i = 0; i <= RIB_SEG; i++) {
        const t = i / RIB_SEG
        const along = u.length * (t - 0.5)
        const perp =
          u.perpAmp * Math.sin(t * u.freq * PI2 + u.phase + time * u.speed) +
          u.perpAmp * 0.4 * Math.sin(t * u.freq * 2.1 * PI2 - time * u.speed * 0.6 + u.phase2)
        const a = u.ang0 + t * u.curl + Math.sin(time * u.swirlSpeed + u.phase) * u.swirlAmp
        const cs = Math.cos(a)
        const sn = Math.sin(a)
        cl[i * 3] = u.cx + along * cs - perp * sn
        cl[i * 3 + 1] = u.cy + along * sn + perp * cs
        cl[i * 3 + 2] = u.baseZ + u.ampZ * Math.sin(t * u.freqZ * PI2 + time * u.speed * 0.8 + u.phase2)
      }
      // 2) rails : largeur perpendiculaire à la tangente, vrillée autour d'elle
      const pos = r.geometry.attributes.position
      for (let i = 0; i <= RIB_SEG; i++) {
        const i0 = Math.max(0, i - 1) * 3
        const i1 = Math.min(RIB_SEG, i + 1) * 3
        _tan.set(cl[i1] - cl[i0], cl[i1 + 1] - cl[i0 + 1], cl[i1 + 2] - cl[i0 + 2])
        if (_tan.lengthSq() < 1e-9) _tan.set(1, 0, 0)
        _tan.normalize()
        _ref.set(0, 0, 1)
        if (Math.abs(_tan.z) > 0.9) _ref.set(0, 1, 0)
        _w.crossVectors(_tan, _ref).normalize()
        _bin.crossVectors(_tan, _w) // 2e perpendiculaire
        const t = i / RIB_SEG
        const tw = t * u.twist + time * u.twistSpd + u.phase
        const cw = Math.cos(tw)
        const sw = Math.sin(tw)
        const halfW = u.width * (0.5 + 0.5 * Math.sin(t * 3.0 + time * 0.7 + u.phase))
        const wx = (_w.x * cw + _bin.x * sw) * halfW
        const wy = (_w.y * cw + _bin.y * sw) * halfW
        const wz = (_w.z * cw + _bin.z * sw) * halfW
        const cx = cl[i * 3]
        const cy = cl[i * 3 + 1]
        const cz = cl[i * 3 + 2]
        pos.setXYZ(i * 2, cx - wx, cy - wy, cz - wz)
        pos.setXYZ(i * 2 + 1, cx + wx, cy + wy, cz + wz)
      }
      pos.needsUpdate = true
    }
  }

  // UNIVERS ROSE PÂLE (masqué au stencil) : dégradé doux + rubans de soie au vent
  // + fine poussière. Tout en matériaux NON éclairés → n'éclaire pas le produit/QR.
  const buildPinkUniverse = () => {
    const g = new THREE.Group()
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const cx2 = c.getContext('2d')
    const rad = cx2.createRadialGradient(256, 210, 20, 256, 256, 380)
    rad.addColorStop(0, '#fff4fa')
    rad.addColorStop(0.4, '#ffe1ef')
    rad.addColorStop(0.72, '#f7c4dd')
    rad.addColorStop(1, '#e7a9c9')
    cx2.fillStyle = rad
    cx2.fillRect(0, 0, 512, 512)
    const skyTex = new THREE.CanvasTexture(c)
    skyTex.colorSpace = THREE.SRGBColorSpace
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(depth * 2.4, 48, 32),
      stencilInside(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false }))
    )
    sky.renderOrder = 1
    g.add(sky)

    // rubans de soie (dragons majestueux : chacun sa spirale)
    const rtex = ribbonTex()
    const ribCols = [0xffffff, 0xffe3f0, 0xffd0e6, 0xfff0e2, 0xffdcea]
    ribbons = []
    const RN = 8
    for (let i = 0; i < RN; i++) {
      const params = {
        cx: (Math.random() - 0.5) * fw * 0.5,
        cy: (Math.random() - 0.5) * fh * 0.5,
        baseZ: -0.7 - Math.random() * depth * 1.3,
        length: fw * (2.6 + Math.random() * 1.8), // long serpent
        perpAmp: 0.18 + Math.random() * 0.34, // ondulation du corps
        ampZ: 0.35 + Math.random() * 0.8,
        freq: 1.1 + Math.random() * 1.5,
        freqZ: 0.8 + Math.random() * 1.0,
        width: 0.05 + Math.random() * 0.08,
        twist: 4 + Math.random() * 6, // vrille de la soie
        twistSpd: 0.14 + Math.random() * 0.24,
        speed: 0.14 + Math.random() * 0.24,
        ang0: Math.random() * PI2, // direction générale propre à chaque ruban
        curl: (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 3.4), // spirale + sens
        swirlSpeed: 0.05 + Math.random() * 0.12, // lente rotation d'ensemble
        swirlAmp: 0.2 + Math.random() * 0.4,
        phase: Math.random() * PI2,
        phase2: Math.random() * PI2,
        opacity: 0.3 + Math.random() * 0.24,
        cline: new Float32Array((RIB_SEG + 1) * 3),
      }
      const r = makeRibbon(rtex, ribCols[i % ribCols.length], params)
      g.add(r)
      ribbons.push(r)
    }
    updateRibbons(0)

    // fine poussière (petites particules discrètes, pas de grosses orbes)
    const disc = softDisc()
    const N = 70
    const pos = new Float32Array(N * 3)
    const spd = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * fw * 1.8
      pos[i * 3 + 1] = (Math.random() - 0.5) * fh * 1.8
      pos[i * 3 + 2] = -Math.random() * depth * 1.5
      spd[i] = 0.06 + Math.random() * 0.16
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    particles = new THREE.Points(
      geo,
      stencilInside(
        new THREE.PointsMaterial({ size: 0.025, map: disc, color: 0xfff4fa, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })
      )
    )
    particles.userData.spd = spd
    particles.renderOrder = 3
    g.add(particles)
    return g
  }

  const buildWall = (tex) => {
    const g = new THREE.Group()
    tex.colorSpace = THREE.SRGBColorSpace
    wallMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0.05, transparent: true })
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
      const geo = new THREE.ExtrudeGeometry(shape, { depth: CFG.fragThickness, bevelEnabled: false })
      geo.translate(0, 0, -CFG.fragThickness)
      const p = geo.attributes.position
      const uv = new Float32Array(p.count * 2)
      for (let k = 0; k < p.count; k++) {
        uv[k * 2] = (p.getX(k) + cx) / fw + 0.5
        uv[k * 2 + 1] = (p.getY(k) + cy) / fh + 0.5
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      const fmat = wallMat.clone()
      fmat.stencilRef = 1
      fmat.stencilFunc = THREE.EqualStencilFunc
      fmat.stencilFail = THREE.KeepStencilOp
      fmat.stencilZFail = THREE.KeepStencilOp
      fmat.stencilZPass = THREE.KeepStencilOp
      fmat.stencilWrite = false
      const frag = new THREE.Mesh(geo, fmat)
      frag.position.set(cx, cy, 0)
      frag.userData.mat = fmat
      frag.userData.home = new THREE.Vector3(cx, cy, 0)
      frag.userData.dist = Math.hypot(cx, cy)
      frag.userData.released = false
      g.add(frag)
      fragments.push(frag)
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

  // matériaux PARTAGÉS (comme /gloss) + masque stencil (portail)
  const makeMat = (cfg) => stencilInside(new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.2, ...cfg }))
  const mats = {
    cap: makeMat(MAT.cap),
    cassandre: makeMat(MAT.cassandre),
    ring: makeMat(MAT.ring),
    bullet: makeMat(MAT.bullet),
    bottleMatte: makeMat(MAT.bottleMatte),
    bottleGlossy: makeMat(MAT.bottleGlossy),
    capInterior: makeMat(MAT.capInterior),
  }
  Object.values(mats).forEach((m) => productMats.push(m))

  // prépare le lipstick : matériaux /gloss + groupes d'ouverture (capuchon / bâtonnet),
  // puis oriente debout, met à l'échelle et centre
  const prepareModel = (root) => {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mn = (o.material.name || '').toLowerCase()
      if (mn === 'metal_pink') o.material = mats.cap
      else if (mn === 'metal') o.material = mats.cassandre
      else if (mn === 'metal_pink_int') o.material = mats.bullet
      else if (mn === 'pink_matte') o.material = mats.bottleMatte
      else if (mn === 'pink_glossy') o.material = mats.bottleGlossy
      else if (mn === 'black_glossy') o.material = mats.capInterior
      else if (mn.includes('lovenude')) o.material = mats.ring
      o.renderOrder = 5
    })

    // groupes d'ouverture (on collecte puis on reparente — jamais muter pendant un traverse)
    root.updateMatrixWorld(true)
    const capMeshes = []
    const balmMeshes = []
    root.traverse((o) => {
      if (o.isMesh && (o.name === 'LNB_cap' || o.name === 'LNB_cap_interior')) capMeshes.push(o)
      else if (o.isMesh && o.name === 'LBN_Bottle_interior') balmMeshes.push(o)
    })
    capGroup = new THREE.Group()
    root.add(capGroup)
    const capBox = new THREE.Box3()
    capMeshes.forEach((o) => capBox.expandByObject(o))
    capGroup.position.copy(capBox.getCenter(capBase))
    capMeshes.forEach((o) => capGroup.attach(o))
    balmGroup = new THREE.Group()
    root.add(balmGroup)
    balmMeshes.forEach((o) => balmGroup.attach(o))

    const preBox = new THREE.Box3().setFromObject(root)
    const localH = preBox.getSize(new THREE.Vector3()).y || 1
    capUp = localH * OPEN.capUpRatio
    capSide = localH * OPEN.capSideRatio
    balmRise = localH * OPEN.balmRiseRatio

    const wrap = new THREE.Group()
    let box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const longest = size.y >= size.x && size.y >= size.z ? 'y' : size.x >= size.z ? 'x' : 'z'
    if (longest === 'x') wrap.rotation.z = Math.PI / 2
    else if (longest === 'z') wrap.rotation.x = -Math.PI / 2
    wrap.add(root)
    wrap.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(wrap)
    const standH = box.getSize(new THREE.Vector3()).y || 1
    wrap.scale.setScalar(CFG.heightUnits / standH)
    wrap.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(wrap)
    const cc = box.getCenter(new THREE.Vector3())
    wrap.position.x -= cc.x
    wrap.position.z -= cc.z
    wrap.position.y -= box.min.y
    return wrap
  }

  // assemblage
  anchor.add(buildMask())
  anchor.add(buildPinkUniverse())
  emergeGroup = new THREE.Group()
  anchor.add(emergeGroup)

  new THREE.TextureLoader().load(CFG.wallTexUrl, (tex) => {
    anchor.add(buildWall(tex))
  })

  const ready = new Promise((resolve) => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
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
        proxy = new THREE.Mesh(new THREE.BoxGeometry(psize.x, psize.y, psize.z), new THREE.MeshBasicMaterial({ visible: false }))
        proxy.position.copy(pcenter)
        modelWrap.add(proxy)
        status('Prêt')
        resolve()
      },
      undefined,
      (err) => {
        console.error('[pinkWall] modèle', (err && err.stack) || err)
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
    body.angularVelocity.set((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5)
  }

  const playIntro = () => {
    if (!emergeGroup) return
    introPlayed = true
    introT = 0
    impactStarted = false
    frontRadius = 0
    debrisT = 0
    isOpen = false
    openA = 0
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
    isOpen = !isOpen
    return isOpen
  }

  const update = (dt) => {
    clock += dt
    // 8th Wall met autoClear=false (pour garder le flux caméra) → on nettoie nous-mêmes
    // stencil ET depth chaque frame AVANT le rendu, sinon traînée du portail quand ça bouge.
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    updateRibbons(clock)
    if (particles) {
      const p = particles.geometry.attributes.position
      const spd = particles.userData.spd
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + spd[i] * dt
        if (y > fh * 1.2) y = -fh * 1.2
        p.setY(i, y)
      }
      p.needsUpdate = true
    }

    if (introPlayed) introT += dt

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

      if (!impactStarted && z >= -CFG.contactZ) {
        impactStarted = true
        debrisT = 0
        frontRadius = CFG.coreRadius
        for (const f of fragments) if (f.userData.dist <= frontRadius) releaseFragment(f)
      }

      const vz = (z - productBody.position.z) / Math.max(dt, 1e-4)
      productBody.position.set(0, 0, z)
      productBody.velocity.set(0, 0, vz)

      product.rotation.y += CFG.spinSpeed * dt
      product.rotation.z = Math.sin(clock * CFG.driftSpeedZ) * CFG.driftZ
      product.rotation.x = Math.sin(clock * CFG.driftSpeedX) * CFG.driftX
      product.position.y = Math.sin(clock * CFG.levitateSpeed) * CFG.levitateAmp
    }

    if (impactStarted) {
      debrisT += dt
      frontRadius += CFG.crackSpeed * dt
      for (const f of fragments) if (!f.userData.released && f.userData.dist <= frontRadius) releaseFragment(f)
      world.step(1 / 60, dt, 3)
      const k = Math.min(debrisT / CFG.debrisLife, 1)
      const op = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25
      for (const f of fragments) {
        if (!f.userData.released) continue
        const b = f.userData.body
        f.position.set(b.position.x, b.position.y, b.position.z)
        f.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)
        f.userData.mat.stencilWrite = f.position.z < -0.003
        f.userData.mat.opacity = op
      }
      if (k >= 1) fragments.forEach((f) => (f.visible = false))
    }

    // ouverture du lipstick (identique à /gloss)
    if (capGroup) {
      const dir = isOpen ? 1 : -1
      openA = Math.max(0, Math.min(1, openA + (dir * dt) / OPEN.duration))
      const ph = (a, b) => {
        const t = Math.max(0, Math.min(1, (openA - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      const rise = ph(0.0, 0.3)
      const aside = ph(0.3, 0.6)
      capGroup.position.set(capBase.x + capSide * aside, capBase.y + capUp * rise, capBase.z)
      capGroup.rotation.z = -OPEN.capTilt * aside
      if (balmGroup) {
        const out = ph(0.65, 1.0)
        balmGroup.rotation.y = OPEN.balmSpinTurns * Math.PI * 2 * out
        balmGroup.position.y = balmRise * out
      }
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
