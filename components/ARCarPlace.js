'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal as reactPortal } from 'react-dom'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { createConfigurator } from '@/lib/car/configurator'
import { createConfigStand } from '@/lib/car/carConfigAR'
import { createCarStage } from '@/lib/car/carStage'
import { createCarLook } from '@/lib/car/carLook'
import { createCarShowcase, createCarLights } from '@/lib/car/carShowcase'

// PROTOTYPE sans marqueur : une voiture « bloc » à taille réelle (4,5 × 1,8 × 1,4 m) posée au sol par un toucher,
// ancrée dans le monde par le SLAM de 8th Wall. Sert à valider la tenue de l'ancrage quand l'endroit de pose
// sort du champ (reculer, lever la caméra, tourner autour) avant d'y mettre le vrai modèle.
//   - réticule = empreinte au sol de la voiture, au centre de l'écran (hitTest), tournée face à l'utilisateur ;
//   - toucher → pose ; ensuite un glisser horizontal tourne la voiture, un toucher sur une portière l'ouvre ;
//   - ?scale=responsive pour comparer avec l'échelle relative (par défaut : absolute = mètres réels).
const QS = (() => { try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() } })()
const SCALE = QS.get('scale') === 'responsive' ? 'responsive' : 'absolute'
// modèle : BMW X7 M60i (placeholder interne, Sketchfab « KOElkast1007 », licence Sketchfab Standard ; marque BMW non couverte)
// ?model=block garde la voiture « bloc » du premier prototype
// modèle compressé (gltf-transform : meshopt + WebP, structure intacte) : 3,2 Mo au lieu de 19,4 Mo
export const CAR_MODEL_URL = '/car/bmw_x7.glb'
const MODEL_URL = QS.get('model') === 'block' ? null : CAR_MODEL_URL
export const MODEL_LENGTH_M = 5.18 // BMW X7 (G07) : 5 181 mm
// taille d'affichage (tests en intérieur) : 100 % = taille réelle ; ?size=0.3 au démarrage, bouton TAILLE ensuite
const SIZES = [1, 0.5, 0.25, 0.1]
const DEBUG = QS.get('debug') === '1' // ligne de mesures (distance, hauteur caméra, suivi, recalage)
const SIZE0 = (() => { const v = Number(QS.get('size')); return v > 0.02 && v <= 1 ? v : 1 })()
const CAR = { L: 4.5, W: 1.8, H: 1.4, clearance: 0.16, wheelR: 0.33, wheelbase: 2.7 }

function makeShadowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 128, 10, 64, 128, 128)
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// voiture placeholder : origine au sol, centre de l'empreinte ; +Z = avant
function buildBlockCar() {
  const car = new THREE.Group(); car.name = 'BlockCar'
  const paint = new THREE.MeshStandardMaterial({ color: 0x16205e, metalness: 0.6, roughness: 0.32 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b0f18, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.75 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 1, roughness: 0.25 })
  const seat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 })
  const light = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 0.6 })
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a0d12, emissive: 0x8a0d12, emissiveIntensity: 0.5 })
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); car.add(o); return o }
  const { L, W, clearance, wheelR, wheelbase } = CAR
  const bodyH = 0.62, bodyY = clearance + bodyH / 2
  // caisse en 3 morceaux (capot, centre évidé, coffre) pour voir l'intérieur par les portières ouvertes
  box(W, bodyH, 1.05, paint, 0, bodyY, L / 2 - 0.525)            // avant
  box(W, bodyH, 1.15, paint, 0, bodyY, -L / 2 + 0.575)           // arrière
  box(W, 0.12, 2.3, paint, 0, clearance + 0.06, 0.03)            // plancher
  // habitacle : montants + vitrage
  const roofY = clearance + bodyH + 0.56
  box(W - 0.16, 0.06, 1.9, paint, 0, roofY, -0.15)               // toit
  box(W - 0.16, 0.56, 0.05, glass, 0, clearance + bodyH + 0.28, 0.82).rotation.x = -0.5 // pare-brise
  box(W - 0.16, 0.56, 0.05, glass, 0, clearance + bodyH + 0.28, -1.12).rotation.x = 0.45 // lunette
  // intérieur : sièges, tableau de bord, volant
  for (const x of [-0.42, 0.42]) {
    box(0.5, 0.12, 0.5, seat, x, clearance + 0.32, 0.25)
    box(0.5, 0.6, 0.12, seat, x, clearance + 0.62, -0.02).rotation.x = -0.15
    box(0.5, 0.12, 0.5, seat, x, clearance + 0.32, -0.75)
  }
  box(W - 0.2, 0.22, 0.3, dark, 0, clearance + bodyH - 0.05, 0.95)  // tableau de bord
  const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), dark)
  wheelS.position.set(-0.42, clearance + bodyH + 0.02, 0.72); wheelS.rotation.x = -0.4; car.add(wheelS)
  // phares / feux
  for (const x of [-0.65, 0.65]) { box(0.36, 0.1, 0.04, light, x, bodyY + 0.12, L / 2 + 0.005); box(0.36, 0.1, 0.04, tail, x, bodyY + 0.12, -L / 2 - 0.005) }
  // roues
  const tyreG = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 28); tyreG.rotateZ(Math.PI / 2)
  const rimG = new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, 0.25, 20); rimG.rotateZ(Math.PI / 2)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const t = new THREE.Mesh(tyreG, dark); t.position.set(sx * (W / 2 - 0.1), wheelR, sz * wheelbase / 2); car.add(t)
    const r = new THREE.Mesh(rimG, rim); r.position.copy(t.position); car.add(r)
  }
  // portières (4) : charnière sur l'arête avant, s'ouvrent vers l'extérieur
  const doors = []
  const doorMat = paint
  const mkDoor = (side, z0, len, name) => {
    const hinge = new THREE.Group(); hinge.name = name
    hinge.position.set(side * W / 2, 0, z0)                      // arête avant de la portière
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, bodyH + 0.5, len), doorMat)
    panel.position.set(-side * 0.03, clearance + (bodyH + 0.5) / 2, -len / 2)
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.42, len - 0.12), glass)
    win.position.set(-side * 0.03, clearance + bodyH + 0.26, -len / 2)
    hinge.add(panel, win); car.add(hinge)
    const d = { hinge, side, open: 0, target: 0, pickables: [panel, win], apply: (k) => { hinge.rotation.y = side * k * 1.15 } }
    panel.userData.door = d; win.userData.door = d
    doors.push(d)
  }
  mkDoor(-1, 0.53, 1.0, 'Door_FL'); mkDoor(1, 0.53, 1.0, 'Door_FR')
  mkDoor(-1, -0.47, 0.9, 'Door_RL'); mkDoor(1, -0.47, 0.9, 'Door_RR')
  car.traverse((o) => { if (o.isMesh) o.castShadow = false })
  return { car, doors }
}

const smooth01 = (x) => x * x * (3 - 2 * x)

// Charge le GLB et le normalise : origine au sol au centre de l'empreinte, +Z = avant, mètres.
// Portières : le GLB porte une animation « Doors opened » (rotation des 4 nœuds de portière autour de leur charnière) ;
// on en tire, pour chaque portière, la pose fermée (1re clé) et la pose la plus ouverte, puis on interpole nous-mêmes.
export async function loadGlbCar(url, onProgress, { lengthM = 0 } = {}) {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total) })
  const model = gltf.scene
  const car = new THREE.Group(); car.name = 'GlbCar'
  car.add(model)
  model.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3())
  if (size.x > size.z) { model.rotation.y = Math.PI / 2; model.updateMatrixWorld(true); box.setFromObject(model); box.getSize(size) }
  // avant = côté du pare-chocs avant
  const fb = model.getObjectByName('inmx7m60i_f_bump1') || model.getObjectByName('inmx7m60i_f_grille')
  if (fb) {
    const c = new THREE.Box3().setFromObject(fb).getCenter(new THREE.Vector3())
    if (c.z < box.getCenter(new THREE.Vector3()).z) { model.rotation.y += Math.PI; model.updateMatrixWorld(true); box.setFromObject(model) }
  }
  const ctr = box.getCenter(new THREE.Vector3())
  model.position.set(-ctr.x, -box.min.y, -ctr.z)
  // taille réelle : le GLB Sketchfab est ~13 % trop petit (4,52 m pour un X7 de 5,18 m) → on le met à la longueur réelle
  if (lengthM > 0) { const k = lengthM / size.z; model.scale.multiplyScalar(k); model.position.multiplyScalar(k) }
  model.updateMatrixWorld(true)
  box.setFromObject(model); box.getSize(size)
  // portières depuis l'animation
  const doors = []
  const clip = gltf.animations.find((a) => /door/i.test(a.name)) || gltf.animations[0]
  if (clip) {
    for (const tr of clip.tracks) {
      if (!tr.name.endsWith('.quaternion')) continue
      const node = model.getObjectByName(tr.name.slice(0, -'.quaternion'.length))
      if (!node) continue
      const v = tr.values, n = v.length / 4
      const q0 = new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize()
      let best = 0, bi = 0
      const qi = new THREE.Quaternion()
      for (let i = 0; i < n; i++) { qi.set(v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]).normalize(); const a = q0.angleTo(qi); if (a > best) { best = a; bi = i } }
      const q1 = new THREE.Quaternion(v[4 * bi], v[4 * bi + 1], v[4 * bi + 2], v[4 * bi + 3]).normalize()
      node.quaternion.copy(q0)
      const d = { node, open: 0, target: 0, pickables: [], apply: (k) => { node.quaternion.slerpQuaternions(q0, q1, k) } }
      node.traverse((o) => { if (o.isMesh) { d.pickables.push(o); o.userData.door = d } })
      doors.push(d)
    }
  }
  model.traverse((o) => {
    if (!o.isMesh) return
    o.frustumCulled = true
    const m = o.material
    if (m && m.transparent) { m.depthWrite = false; o.renderOrder = 2 } // vitrages après la carrosserie
  })
  return { car, doors, dims: { L: size.z, W: size.x, H: size.y } }
}

export default function ARCarPlace() {
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Chargement…')
  const [placed, setPlaced] = useState(false)
  const [info, setInfo] = useState('')
  const [sizeK, setSizeK] = useState(SIZE0)
  const [cfg, setCfg] = useState(null)
  const apiRef = useRef({})

  useEffect(() => {
    const XR8 = window.XR8
    const XRExtras = window.XRExtras
    if (!XR8 || !XRExtras || !canvasRef.current) return
    window.THREE = THREE

    let scene = null, cameraRef = null, car = null, doors = [], reticle = null, shadow = null, config = null, showcase = null, lights = null, tAcc = 0, stand = null, stage = null, spin = 0, look = null
    let isPlaced = false, hasHit = false, tracking = 'INIT', lastInfo = 0
    // 6 DoF seulement quand le suivi est NORMAL : avant la fin du calibrage (échelle absolue) la caméra ne se déplace
    // pas dans le monde, et une voiture posée à ce moment-là « suivait » l'utilisateur quand il marchait
    const trackStart = performance.now()
    let trackSeen = false, calibMsg = false
    const trackOk = () => tracking.startsWith('NORMAL') || (!trackSeen && performance.now() - trackStart > 6000)
    const ret = new THREE.Vector3(), retTarget = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion()
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let retYaw = 0
    const clock = new THREE.Clock()
    let size = SIZE0
    const applySize = () => { if (car) car.scale.setScalar(size); if (reticle) reticle.scale.setScalar(size) }
    // le modèle se télécharge dès l'ouverture de la page AR, pendant le calibrage
    const carReady = MODEL_URL
      ? loadGlbCar(MODEL_URL, (k) => setStatus(`Chargement de la voiture · ${Math.round(k * 100)} %`), { lengthM: MODEL_LENGTH_M })
      : Promise.resolve({ ...buildBlockCar(), dims: { L: CAR.L, W: CAR.W, H: CAR.H } })

    // point au sol sous un point écran (0..1) : hitTest 8th Wall, sinon intersection avec le plan y = 0
    const groundAt = (sx, sy, out) => {
      let hits = []
      try { hits = XR8.XrController.hitTest(sx, sy, ['ESTIMATED_SURFACE']) || [] } catch (e) {}
      if (hits.length) { const p = hits[0].position; out.set(p.x, p.y, p.z); return true }
      if (!cameraRef) return false
      ndc.set(sx * 2 - 1, -(sy * 2 - 1)); ray.setFromCamera(ndc, cameraRef)
      return !!ray.ray.intersectPlane(ground, out)
    }
    const faceYaw = (p) => { _v.copy(cameraRef.position).sub(p); return Math.atan2(_v.x, _v.z) } // l'avant (+Z) vers l'utilisateur

    // ---- recalage au sol : le SLAM dérive en hauteur quand on vise le ciel / un plafond uni (plus de repères),
    // et la voiture restait en l'air en revenant au sol. Tant que le suivi est NORMAL, on relève les points
    // caractéristiques du VRAI sol autour de la voiture (bas de l'écran) et on la redescend doucement dessus.
    const RG = { win: 90, minN: 24, near: 1.6, band: 0.6, every: 3 }
    const rgY = new Float32Array(RG.win), rgSort = new Float32Array(RG.win)
    let rgN = 0, rgI = 0, rgFrame = 0, rgSettle = 0, floorOffset = 0
    const rgPts = []
    for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < 4; gy++) rgPts.push([0.1 + gx * 0.2, 0.5 + gy * 0.15])
    const _loc = new THREE.Vector3()
    function regroundStep(dt) {
      if (!trackOk()) return                                          // suivi dégradé : on ne touche à rien
      if (++rgFrame % RG.every === 0) {
        for (let k = 0; k < 5; k++) {
          const g = rgPts[(rgFrame / RG.every * 5 + k) % rgPts.length | 0]
          let hits = []
          try { hits = XR8.XrController.hitTest(g[0], g[1], ['FEATURE_POINT']) || [] } catch (e) {}
          if (!hits.length) continue
          const p = hits[0].position
          // seulement autour de l'empreinte de la voiture, et près de son sol actuel (pas une table, pas un mur)
          _loc.set(p.x, p.y, p.z); car.worldToLocal(_loc)
          if (Math.abs(_loc.x) > CAR.W / 2 + RG.near || Math.abs(_loc.z) > CAR.L / 2 + RG.near) continue
          if (Math.abs(p.y - car.position.y) > RG.band) continue
          rgY[rgI] = p.y; rgI = (rgI + 1) % RG.win; rgN = Math.min(rgN + 1, RG.win)
        }
      }
      if (rgN < RG.minN) return
      rgSort.set(rgY); const s = rgSort.subarray(0, rgN).sort()
      const floorY = s[Math.floor(rgN * 0.35)]                        // bas de la distribution : le sol, pas les objets posés
      const diff = floorY - car.position.y
      if (Math.abs(diff) < 0.015 && rgSettle <= 0) return             // déjà au sol : pas de tremblement
      rgSettle = Math.abs(diff) > 0.015 ? 0.4 : rgSettle - dt
      const step = diff * (1 - Math.exp(-dt * 2.5))                   // ~0,4 s pour revenir, sans saut
      car.position.y += step; floorOffset += step
    }
    const resetReground = () => { rgN = 0; rgI = 0; rgSettle = 0; floorOffset = 0 }

    const sceneModule = () => ({
      name: 'car-place',
      onStart: () => {
        const xr = XR8.Threejs.xrScene()
        scene = xr.scene; cameraRef = xr.camera
        if (SCALE === 'responsive') {
          cameraRef.position.set(0, 1.5, 0)
          XR8.XrController.updateCameraProjectionMatrix({ origin: cameraRef.position, facing: cameraRef.quaternion })
        }
        // reflets de carrosserie : environnement studio (PMREM) + tone mapping doux ; la vidéo caméra n'est pas affectée
        const renderer = xr.renderer
        renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6))
        const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 6, 2); scene.add(sun)
        carReady.then((b) => {
          car = b.car; doors = b.doors; car.visible = false; scene.add(car)
          Object.assign(CAR, b.dims)
          // compile tout de suite (pas d'à-coup à la pose)
          applySize()
          config = createConfigurator(car)
          // reflets de la vraie pièce (image caméra) + softbox studio, vitres teintées, pneus mats
          look = createCarLook({ car, scene, renderer, getCamTex: () => { try { return XR8.Threejs.xrScene().cameraTexture || null } catch { return null } } })
          // présentation en AR : pastilles + fiches posées sur la voiture, actions (phares, portières, cotes)
          lights = createCarLights(car)
          const front = doors.filter((d) => /doorf/i.test(d.node?.name || ''))
          showcase = createCarShowcase({ car, dims: b.dims, scene, onAction: (kind, on) => {
            if (kind === 'lights') lights.set(on)
            if (kind === 'doors') front.forEach((d) => { d.target = on ? 1 : 0 })
          } })
          // compile tout maintenant (peinture, pastilles, fiches, cotes) : aucun à-coup à la pose ni à la première fiche
          // configurateur en AR : pupitre de verre au coin de la voiture le plus proche de l'utilisateur
          stand = createConfigStand({ car, dims: b.dims, scene, config,
            onTab: (k) => { if (k === 'leather') front.forEach((d) => { d.target = 1 }) },
            onOpenChange: (o) => showcase.setVisible(!o && isPlaced) })
          // mise en scène : viseur, ombre calculée, révélation par scan, phares d'accueil, titre
          stage = createCarStage({ car, dims: b.dims, scene, renderer, lights, onRevealed: () => {
            showcase.setVisible(true); stand.setVisible(true)
            setStatus('Touchez les points pour découvrir la voiture · « Configurer » pour changer sa teinte')
            setTimeout(() => { if (isPlaced) setStatus('') }, 6000)
          } })
          reticle = stage.reticle; shadow = stage.shadow
          applySize()
          car.visible = true; showcase.root.visible = true; stand.root.visible = true; car.traverse((o) => { if (o.name === 'CarDims') o.visible = true })
          renderer.compile(scene, cameraRef)
          car.visible = false; car.traverse((o) => { if (o.name === 'CarDims') o.visible = false })
          showcase.setVisible(false); stand.setVisible(false)
          setCfg({ available: config.available, current: { ...config.current } })
          setStatus('Visez le sol devant vous, à 3–4 m · touchez pour poser la voiture')
        }).catch((e) => { console.error('[car] modèle', e); setStatus('Erreur de chargement du modèle') })
      },
      onUpdate: () => {
        if (!scene || !car || !reticle) return
        const dt = Math.min(clock.getDelta(), 0.05)
        if (!isPlaced && !trackOk()) {
          reticle.visible = false; hasHit = false
          if (!calibMsg) { calibMsg = true; setStatus('Calibrage · visez le sol et déplacez lentement le téléphone de gauche à droite') }
        } else if (!isPlaced) {
          if (calibMsg) { calibMsg = false; setStatus('Visez le sol devant vous, à 3–4 m · touchez pour poser la voiture') }
          const ok = groundAt(0.5, 0.62, retTarget)
          if (ok) {
            if (!hasHit) { ret.copy(retTarget); retYaw = faceYaw(ret) } else { ret.lerp(retTarget, 0.25); retYaw += (faceYaw(ret) - retYaw) * 0.2 }
            hasHit = true; reticle.visible = true; reticle.position.copy(ret); reticle.rotation.set(0, retYaw, 0)
          } else { hasHit = false; reticle.visible = false }
        }
        if (isPlaced) regroundStep(dt)
        config?.update(dt); lights?.update(dt)
        tAcc += dt; showcase?.update(dt, cameraRef, tAcc); stand?.update(dt, cameraRef, tAcc); stage?.update(dt, cameraRef, tAcc); if (isPlaced) look?.update(tAcc, cameraRef)
        // inertie de la rotation au doigt
        if (!down && Math.abs(spin) > 0.002 && isPlaced) { car.rotation.y += spin * dt; spin *= Math.exp(-dt * 3.2) }
        for (const d of doors) {
          const k0 = d.open
          d.open += (d.target - d.open) * Math.min(1, dt * 3.2)
          if (Math.abs(d.open - k0) > 1e-5) d.apply(smooth01(d.open))
        }
        const now = performance.now()
        if (isPlaced && now - lastInfo > 250) {
          lastInfo = now
          const dist = Math.hypot(cameraRef.position.x - car.position.x, cameraRef.position.z - car.position.z)
          const camH = cameraRef.position.y - car.position.y
          setInfo(`distance ${dist.toFixed(1)} m · caméra à ${camH.toFixed(2)} m du sol · suivi ${tracking} · recalage ${(floorOffset * 100).toFixed(0)} cm`)
        }
      },
      listeners: [
        { event: 'reality.trackingstatus', process: ({ detail }) => { trackSeen = true; tracking = detail.status + (detail.reason ? ` (${detail.reason})` : '') } },
      ],
    })

    // gestes : toucher = poser / ouvrir une portière ; glisser horizontal (après pose) = tourner la voiture
    let down = null
    const onDown = (e) => { if (!car) return; spin = 0; down = { x: e.clientX, y: e.clientY, yaw: car ? car.rotation.y : 0, moved: false, lx: e.clientX, lt: performance.now() } }
    const onMove = (e) => {
      if (!down || !isPlaced || !car || stage?.revealing) return
      const dx = e.clientX - down.x
      if (Math.abs(dx) > 8) down.moved = true
      if (!down.moved) return
      car.rotation.y = down.yaw + dx * 0.008
      const now = performance.now(), dtm = Math.max(1, now - down.lt) / 1000
      spin = spin * 0.6 + ((e.clientX - down.lx) * 0.008 / dtm) * 0.4 // vitesse angulaire lissée → inertie au lâcher
      down.lx = e.clientX; down.lt = now
    }
    const onUp = (e) => {
      const d = down; down = null
      if (d && d.moved) { if (performance.now() - d.lt > 90) spin = 0; spin = Math.max(-4, Math.min(4, spin)) }
      if (!d || d.moved || !cameraRef) return
      if (!isPlaced) {
        if (!trackOk()) { setStatus('Calibrage pas encore terminé · déplacez lentement le téléphone de gauche à droite'); return }
        if (!hasHit) { setStatus('Pas encore de sol détecté · bougez doucement le téléphone'); return }
        car.position.copy(ret); car.rotation.set(0, retYaw, 0); car.visible = true; resetReground()
        reticle.visible = false; isPlaced = true; setPlaced(true); stage?.playReveal()
        setStatus('')
        try { navigator.vibrate?.(10) } catch {}
        return
      }
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
      cameraRef.updateMatrixWorld()
      ray.setFromCamera(ndc, cameraRef)
      if (stand?.pick(ray)) { try { navigator.vibrate?.(6) } catch {} ; return }
      if (showcase?.pick(ray)) { if (showcase.openId) stand?.collapse(); try { navigator.vibrate?.(6) } catch {} ; return }
      const hit = ray.intersectObjects(doors.flatMap((dd) => dd.pickables), false)[0]
      if (hit) { const dd = hit.object.userData.door; dd.target = dd.target > 0.5 ? 0 : 1; try { navigator.vibrate?.(6) } catch {} }
    }
    const el = canvasRef.current
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp)

    apiRef.current.size = () => {
      const i = SIZES.indexOf(size)
      size = SIZES[(i < 0 ? 0 : i + 1) % SIZES.length]
      applySize(); setSizeK(size); resetReground()
    }
    apiRef.current.replace = () => { if (!car) return; stage?.reset(); spin = 0; showcase?.setVisible(false); stand?.setVisible(false); lights?.set(false); isPlaced = false; setPlaced(false); car.visible = false; hasHit = false; doors.forEach((d) => { d.target = 0 }); setInfo(''); setStatus('Visez le sol · touchez pour poser la voiture') }
    apiRef.current.config = (kind, id) => { if (!config) return; config.set(kind, id); setCfg({ available: config.available, current: { ...config.current } }) }
    // onglet Intérieur : on ouvre les portières avant pour montrer la sellerie
    apiRef.current.tab = (kind) => { if (kind === 'leather' && isPlaced) doors.slice(0, 2).forEach((d) => { d.target = 1 }) }
    apiRef.current.doors = () => { const open = doors.some((d) => d.target < 0.5); doors.forEach((d) => { d.target = open ? 1 : 0 }) }
    apiRef.current.recenter = () => { try { XR8.XrController.recenter() } catch {} ; apiRef.current.replace() }

    XR8.XrController.configure({ scale: SCALE, disableWorldTracking: false })
    XR8.addCameraPipelineModules([
      XRExtras.FullWindowCanvas.pipelineModule(),
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      // échelle absolue : l'assistant de 8th Wall guide le calibrage (mouvement latéral) avant le 6 DoF
      ...(SCALE === 'absolute' && XRExtras.CoachingOverlay ? [XRExtras.CoachingOverlay.pipelineModule()] : []),
      sceneModule(),
    ])
    XR8.run({ canvas: el, allowedDevices: XR8.XrConfig.device().ANY })

    const body = document.body.style
    const prev = [body.webkitUserSelect, body.userSelect, body.webkitTouchCallout]
    body.webkitUserSelect = 'none'; body.userSelect = 'none'; body.webkitTouchCallout = 'none'
    return () => {
      ;[body.webkitUserSelect, body.userSelect, body.webkitTouchCallout] = prev
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp)
      try { window.XR8?.stop?.() } catch {}
      try { window.XR8?.clearCameraPipelineModules?.() } catch {}
    }
  }, [])

  // interface « premium neutre » : verre sombre flouté, capitales fines espacées
  const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
  const chip = { pointerEvents: 'auto', padding: '9px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(14,14,16,0.55)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', fontFamily: FONT, fontSize: 10, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase' }
  const bottomGap = 'calc(env(safe-area-inset-bottom,0px) + 16px)'
  const ui = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, pointerEvents: 'none', fontFamily: FONT }}>
      {DEBUG && <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 64px)', left: 12, right: 12, textAlign: 'center', color: '#fff', fontSize: 10, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{info || `échelle : ${SCALE}`}</div>}
      {/* réglages discrets en haut à droite ; toute la présentation et la configuration se font EN AR sur la voiture */}
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 16px)', right: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        <button style={chip} onClick={() => apiRef.current.size?.()}>Taille {Math.round(sizeK * 100)} %</button>
        {placed && <button style={chip} onClick={() => apiRef.current.replace?.()}>Reposer</button>}
        <button style={chip} onClick={() => apiRef.current.recenter?.()}>Recaler</button>
      </div>
      {status && <div style={{ position: 'absolute', left: 0, right: 0, bottom: bottomGap, display: 'flex', justifyContent: 'center' }}>
        <div style={{ ...chip, pointerEvents: 'none', textTransform: 'none', letterSpacing: '0.03em', fontSize: 12.5, fontWeight: 300, padding: '11px 18px', maxWidth: 330, textAlign: 'center', lineHeight: 1.45 }}>{status}</div>
      </div>}
    </div>
  )
  return (
    <>
      <canvas ref={canvasRef} onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
      {typeof document !== 'undefined' && reactPortal(ui, document.body)}
    </>
  )
}
