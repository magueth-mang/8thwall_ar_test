// Présentation du véhicule EN AR (dans la scène 3D, pas par-dessus l'écran) :
//   - pastilles posées sur la voiture (phares, capot, roues, portières, hayon, toit), toujours face à l'utilisateur,
//     taille constante à l'écran, masquées quand la zone est de l'autre côté de la voiture ;
//   - toucher une pastille ouvre une fiche flottante (verre sombre, chiffres clés) reliée à la pastille par un trait,
//     et joue l'action de la zone : phares allumés, portières ouvertes, cotes du véhicule tracées au sol ;
//   - tout est créé au chargement (textures canvas, matériaux) : rien n'est alloué ni compilé pendant l'expérience.
// Les zones sont trouvées par les noms de nœuds du GLB (BMW X7 M60i Sketchfab ; GLTFLoader retire les « . »).

import * as THREE from 'three'
import { CAR_SPECS, CAR_INFO } from '@/lib/car/carSpecs'

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const RO = 950 // au-dessus de la voiture et des vitrages, sous le réticule

// ---- textures canvas ----------------------------------------------------------------------------------------
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
function tex(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t }

function markerTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')
  const glow = g.createRadialGradient(128, 128, 40, 128, 128, 128)
  glow.addColorStop(0, 'rgba(255,255,255,0.28)'); glow.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = glow; g.fillRect(0, 0, 256, 256)
  const disc = g.createLinearGradient(0, 50, 0, 206)
  disc.addColorStop(0, 'rgba(40,40,46,0.85)'); disc.addColorStop(1, 'rgba(10,10,12,0.9)')
  g.fillStyle = disc; g.beginPath(); g.arc(128, 128, 74, 0, Math.PI * 2); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 72, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill()
  return tex(c)
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.stroke()
  return tex(c)
}
// étiquette à droite de la pastille : « 01 | MOTEUR »
function labelTexture(index, text) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 160
  const g = c.getContext('2d')
  g.font = `500 40px ${FONT}`
  const idx = String(index).padStart(2, '0'), t = text.toUpperCase().split('').join('\u200A\u200A')
  const wi = g.measureText(idx).width, wt = g.measureText(t).width
  const w = Math.min(624, wi + wt + 110)
  const gr = g.createLinearGradient(0, 30, 0, 130); gr.addColorStop(0, 'rgba(34,34,40,0.86)'); gr.addColorStop(1, 'rgba(10,10,12,0.9)')
  g.fillStyle = gr; rr(g, 8, 30, w, 100, 50); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; rr(g, 9, 31, w - 2, 98, 49); g.stroke()
  g.textBaseline = 'middle'
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillText(idx, 48, 81)
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(48 + wi + 18, 62, 2, 38)
  g.fillStyle = '#fff'; g.fillText(t, 48 + wi + 40, 81)
  return tex(c)
}
// fiche : verre sombre, en-tête numéroté, titre, chiffres clés, lignes, barre précédent / suivant, bouton fermer
const CARD = { W: 1024, pad: 68, nav: 104 }
function cardTexture(spec, index, total) {
  const { W, pad, nav } = CARD
  const stats = spec.stats || [], lines = spec.lines || []
  const rows = Math.ceil(stats.length / 2)
  const H = pad + 52 + 22 + 74 + 40 + rows * 156 + (lines.length ? 18 + lines.length * 54 : 0) + 70 + nav
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 30; g.shadowOffsetY = 8
  g.fillStyle = 'rgba(12,12,14,0.9)'; rr(g, 18, 14, W - 36, H - 36, 46); g.fill(); g.restore()
  const gr = g.createLinearGradient(0, 14, 0, H)
  gr.addColorStop(0, 'rgba(38,38,44,0.94)'); gr.addColorStop(1, 'rgba(10,10,12,0.96)')
  g.fillStyle = gr; rr(g, 18, 14, W - 36, H - 36, 46); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; rr(g, 19, 15, W - 38, H - 38, 45); g.stroke()
  const hl = g.createLinearGradient(60, 0, W - 60, 0)
  hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.4)'); hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl; g.fillRect(70, 16, W - 140, 2)
  let y = pad
  g.textBaseline = 'top'
  const idx = String(index).padStart(2, '0')
  g.fillStyle = '#fff'; g.font = `200 52px ${FONT}`; g.fillText(idx, pad, y - 4)
  const wi = g.measureText(idx).width
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = `400 26px ${FONT}`; g.fillText(`/ ${String(total).padStart(2, '0')}`, pad + wi + 10, y + 18)
  g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = `500 25px ${FONT}`
  g.fillText(spec.kicker.toUpperCase().split('').join('\u200A\u200A'), pad + wi + 110, y + 18)
  const cx = W - pad - 16, cy = y + 22
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.stroke()
  g.beginPath(); g.moveTo(cx - 9, cy - 9); g.lineTo(cx + 9, cy + 9); g.moveTo(cx + 9, cy - 9); g.lineTo(cx - 9, cy + 9); g.stroke()
  y += 52 + 22
  g.fillStyle = '#fff'; g.font = `300 62px ${FONT}`; g.fillText(spec.title, pad, y); y += 74 + 40
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(pad, y - 22, W - 2 * pad, 2)
  const colW = (W - 2 * pad) / 2
  stats.forEach((st, i) => {
    const x = pad + (i % 2) * colW, yy = y + Math.floor(i / 2) * 156 + 8
    g.fillStyle = '#fff'; g.font = `200 96px ${FONT}`; g.fillText(st.value, x - 4, yy)
    const vw = g.measureText(st.value).width
    g.font = `400 32px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(st.unit, x + vw + 10, yy + 52)
    g.font = `500 22px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.48)'; g.fillText(st.label.toUpperCase().split('').join('\u200A'), x, yy + 110)
  })
  y += rows * 156
  if (lines.length) {
    y += 18
    for (const l of lines) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(pad + 6, y + 21, 5, 0, Math.PI * 2); g.fill()
      g.font = `300 35px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillText(l, pad + 30, y); y += 54
    }
  }
  const ny = H - 22 - nav
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(pad, ny, W - 2 * pad, 2); g.fillRect(W / 2, ny + 24, 2, nav - 48)
  g.font = `500 24px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.textBaseline = 'middle'
  g.textAlign = 'left'; g.fillText('\u2039   ' + 'PRÉCÉDENT'.split('').join('\u200A\u200A'), pad, ny + nav / 2)
  g.textAlign = 'right'; g.fillText('SUIVANT'.split('').join('\u200A\u200A') + '   \u203A', W - pad, ny + nav / 2)
  g.font = `400 18px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.3)'; g.textAlign = 'center'
  g.fillText(`${CAR_INFO.maker} ${CAR_INFO.model} · ${CAR_INFO.footer}`.toUpperCase(), W / 2, ny - 26)
  g.textAlign = 'left'
  return { texture: tex(c), aspect: H / W, H, close: { x: cx, y: cy, r: 30 }, navTop: ny }
}
function dimLabelTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(12,12,14,0.8)'; rr(g, 16, 20, 480, 120, 60); g.fill()
  g.fillStyle = '#fff'; g.font = `300 72px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 82)
  return tex(c)
}

// ---- zones du modèle (repère voiture, non mis à l'échelle : +Z avant, +Y haut, origine au sol) ---------------
function findAnchors(car, dims) {
  car.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert()
  const boxOf = (re) => {
    const b = new THREE.Box3(), tmp = new THREE.Box3()
    car.traverse((o) => { if (re.test(o.name) && (o.isMesh || o.children.length)) { tmp.setFromObject(o); if (!tmp.isEmpty()) b.union(tmp) } })
    return b.isEmpty() ? null : b.applyMatrix4(inv)
  }
  const A = []
  const add = (id, p, n) => A.push({ id, p, n: n ? n.clone().normalize() : null })
  const hl = boxOf(/^inmx7m60i_headlights1/) || boxOf(/headlight/i)
  if (hl) add('phares', new THREE.Vector3(hl.max.x * 0.72, (hl.min.y + hl.max.y) / 2 + 0.04, hl.max.z + 0.04), new THREE.Vector3(0.35, 0.1, 1))
  const hood = boxOf(/^inmx7m60i_hood$/)
  if (hood) add('moteur', new THREE.Vector3(0, hood.max.y + 0.06, (hood.min.z + hood.max.z) / 2 + 0.15), new THREE.Vector3(0, 1, 0.8))
  for (const name of ['inmx7m60i_wheel', 'inmx7m60i_wheel001', 'inmx7m60i_wheel002', 'inmx7m60i_wheel003']) {
    const b = boxOf(new RegExp(`^${name}$`)); if (!b) continue
    const c = b.getCenter(new THREE.Vector3()); if (c.z < 0) continue // roues avant seulement
    const sx = Math.sign(c.x) || 1
    add('chassis', new THREE.Vector3(c.x + sx * ((b.max.x - b.min.x) / 2 + 0.06), c.y + 0.12, c.z), new THREE.Vector3(sx, 0.15, 0.25))
  }
  for (const name of ['inmx7m60i_doorfl', 'inmx7m60i_doorfr']) {
    const b = boxOf(new RegExp(`^${name}$`)); if (!b) continue
    const c = b.getCenter(new THREE.Vector3()), sx = Math.sign(c.x) || 1
    add('interieur', new THREE.Vector3(sx > 0 ? b.max.x + 0.05 : b.min.x - 0.05, b.max.y - 0.28, c.z - 0.1), new THREE.Vector3(sx, 0.2, 0))
  }
  const gate = boxOf(/^inmx7m60i_tailgate$/)
  if (gate) add('coffre', new THREE.Vector3(0, (gate.min.y + gate.max.y) / 2 + 0.1, gate.min.z - 0.05), new THREE.Vector3(0, 0.15, -1))
  add('dimensions', new THREE.Vector3(0, dims.H + 0.22, -0.2), null)
  return A
}

// ---- cotes au sol (enfants de la voiture : elles suivent sa taille et sa rotation) ---------------------------
function buildDims(dims, specsById) {
  const g = new THREE.Group(); g.name = 'CarDims'; g.visible = false
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  const bar = (len, axis) => { const s = [0.012, 0.012, 0.012]; s['xyz'.indexOf(axis)] = len; const o = new THREE.Mesh(new THREE.BoxGeometry(...s), m); o.renderOrder = RO; return o }
  const val = (id, i) => specsById.dimensions?.stats?.[i] ? `${specsById.dimensions.stats[i].value} ${specsById.dimensions.stats[i].unit}` : ''
  const { L, W, H } = dims, off = 0.45
  const label = (text, x, y, z) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dimLabelTexture(text), transparent: true, depthTest: false, depthWrite: false, opacity: 0 }))
    s.scale.set(0.6, 0.1875, 1); s.position.set(x, y, z); s.renderOrder = RO + 1; g.add(s); return s
  }
  // longueur, au sol le long du flanc droit (+X)
  const lx = W / 2 + off
  const l1 = bar(L, 'z'); l1.position.set(lx, 0.01, 0); g.add(l1)
  for (const z of [-L / 2, L / 2]) { const t = bar(0.22, 'x'); t.position.set(lx, 0.01, z); g.add(t) }
  label(val('dimensions', 0), lx, 0.2, 0)
  // largeur, au sol devant la voiture
  const wz = L / 2 + off
  const w1 = bar(W, 'x'); w1.position.set(0, 0.01, wz); g.add(w1)
  for (const x of [-W / 2, W / 2]) { const t = bar(0.22, 'z'); t.position.set(x, 0.01, wz); g.add(t) }
  label(val('dimensions', 1), 0, 0.2, wz)
  // hauteur, verticale au coin avant droit
  const h1 = bar(H, 'y'); h1.position.set(lx, H / 2, wz); g.add(h1)
  const ht = bar(0.22, 'x'); ht.position.set(lx, H, wz); g.add(ht)
  label(val('dimensions', 2), lx + 0.1, H + 0.2, wz)
  g.userData.mat = m
  return g
}

export function createCarShowcase({ car, dims, scene, onAction }) {
  const specsById = Object.fromEntries(CAR_SPECS.map((s) => [s.id, s]))
  const anchors = findAnchors(car, dims).filter((a) => specsById[a.id])
  const order = Object.fromEntries(CAR_SPECS.map((sp, i) => [sp.id, i + 1]))
  const root = new THREE.Group(); root.name = 'CarShowcase'; scene.add(root)
  const own = []
  const markerTex = markerTexture(), ringTex = ringTexture(); own.push(markerTex, ringTex)
  const planeG = new THREE.PlaneGeometry(1, 1); own.push(planeG)

  // pastilles
  const hs = anchors.map((a) => {
    const g = new THREE.Group()
    const mk = new THREE.Mesh(planeG, new THREE.MeshBasicMaterial({ map: markerTex, transparent: true, depthTest: false, depthWrite: false }))
    const ring = new THREE.Mesh(planeG, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthTest: false, depthWrite: false }))
    const lt = labelTexture(order[a.id], specsById[a.id].label); own.push(lt)
    const lab = new THREE.Mesh(planeG, new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthTest: false, depthWrite: false }))
    lab.scale.set(3.2, 0.8, 1); lab.position.set(2.15, 0, 0)
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.8), new THREE.MeshBasicMaterial({ visible: false })) // pastille + étiquette
    hit.position.x = 1.6
    ;[mk, ring, lab].forEach((o) => { o.renderOrder = RO; own.push(o.material) })
    g.add(ring, mk, lab, hit); root.add(g)
    hit.userData.hs = a
    return { a, g, mk, ring, lab, hit, alpha: 0, phase: Math.random() * 6 }
  })

  // fiches (une par zone, créées d'avance)
  const cards = {}
  for (const s of CAR_SPECS) {
    const ct = cardTexture(s, order[s.id], CAR_SPECS.length), { texture, aspect } = ct; own.push(texture)
    const mesh = new THREE.Mesh(planeG, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
    mesh.renderOrder = RO + 2; mesh.visible = false; root.add(mesh); own.push(mesh.material)
    mesh.userData.card = s.id
    const lineG = new THREE.BufferGeometry(); lineG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const line = new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
    line.renderOrder = RO + 1; line.visible = false; line.frustumCulled = false; root.add(line); own.push(lineG, line.material)
    cards[s.id] = { mesh, line, aspect, k: 0, ct }
  }
  const dimsG = buildDims(dims, specsById); car.add(dimsG)
  let dimsK = 0

  let openId = null, openHs = null, visible = true, visK = 0, showT0 = -1
  const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3(), _toCam = new THREE.Vector3()
  const _up = new THREE.Vector3(), _right = new THREE.Vector3(), _s = new THREE.Vector3()
  const worldOf = (a, out) => out.copy(a.p).applyMatrix4(car.matrixWorld)
  const normalOf = (a, out) => out.copy(a.n).transformDirection(car.matrixWorld)

  function open(hsItem) {
    const id = hsItem.a.id
    if (openId === id && openHs === hsItem) { close(); return }
    if (openId && openId !== id) { const prev = openId; close(true); onAction?.(specsById[prev].action, false) }
    openId = id; openHs = hsItem
    onAction?.(specsById[id].action, true)
  }
  function step(dir) {
    const i = CAR_SPECS.findIndex((sp) => sp.id === openId)
    for (let k = 1; k <= CAR_SPECS.length; k++) {
      const id = CAR_SPECS[(i + dir * k + CAR_SPECS.length * 2) % CAR_SPECS.length].id
      const cand = hs.filter((x) => x.a.id === id)
      if (!cand.length) continue
      open(cand.reduce((b, x) => (x.alpha > b.alpha ? x : b)))
      return
    }
  }
  function close(silent) {
    if (!openId) return
    if (!silent) onAction?.(specsById[openId].action, false)
    openId = null; openHs = null
  }

  return {
    root,
    get openId() { return openId },
    setVisible(v) { if (v && !visible) showT0 = -1; visible = v; if (!v) close() },
    openById(id) { const h = hs.find((x) => x.a.id === id && x.alpha > 0.3) || hs.find((x) => x.a.id === id); if (h) open(h) },
    close: () => close(),
    /** raycaster prêt (setFromCamera) → true si une pastille ou une fiche a été touchée */
    pick(raycaster) {
      if (!visible || visK < 0.5) return false
      const targets = []
      for (const h of hs) if (h.alpha > 0.35) targets.push(h.hit)
      if (openId) targets.push(cards[openId].mesh)
      const hit = raycaster.intersectObjects(targets, false)[0]
      if (!hit) { if (openId) { close(); return true } return false }
      if (hit.object.userData.card) {
        const ct = cards[openId].ct, px = hit.uv.x * CARD.W, py = (1 - hit.uv.y) * ct.H
        if (Math.hypot(px - ct.close.x, py - ct.close.y) < ct.close.r * 2) close()
        else if (py > ct.navTop) step(px < CARD.W / 2 ? -1 : 1)
        return true
      }
      open(hs.find((h) => h.hit === hit.object))
      return true
    },
    update(dt, camera, t) {
      visK += ((visible ? 1 : 0) - visK) * Math.min(1, dt * 6)
      root.visible = visK > 0.01
      camera.getWorldPosition(_c)
      if (visible && showT0 < 0) showT0 = t
      let hi = 0
      for (const h of hs) {
        const stag = THREE.MathUtils.smoothstep(t - showT0 - (hi++) * 0.12, 0, 0.35) // apparition en cascade
        worldOf(h.a, _p)
        _toCam.copy(_c).sub(_p); const dist = _toCam.length(); _toCam.divideScalar(dist || 1)
        let face = 1
        if (h.a.n) { normalOf(h.a, _n); face = THREE.MathUtils.smoothstep(_n.dot(_toCam), -0.05, 0.3) }
        const isOpen = openHs === h
        const target = (isOpen ? 1 : face) * visK * stag * (openId && !isOpen ? 0.35 : 1)
        h.alpha += (target - h.alpha) * Math.min(1, dt * 8)
        h.g.visible = h.alpha > 0.01
        h.g.position.copy(_p)
        h.g.quaternion.copy(camera.quaternion)
        const s = THREE.MathUtils.clamp(dist * 0.032, 0.02, 0.22) // taille ~constante à l'écran
        h.g.scale.setScalar(s)
        const pulse = (t * 0.55 + h.phase) % 1
        h.sel = (h.sel || 0) + ((isOpen ? 1 : 0) - (h.sel || 0)) * Math.min(1, dt * 8)
        h.mk.scale.setScalar(1 + 0.18 * h.sel)
        h.ring.scale.setScalar(isOpen ? 1.25 : 1 + pulse * 0.8)
        h.ring.material.opacity = h.alpha * (isOpen ? 0.9 : (1 - pulse) * 0.7)
        h.mk.material.opacity = h.alpha
        h.lab.material.opacity = h.alpha * (1 - h.sel) * 0.95
      }
      // fiche ouverte : à côté de la pastille, vers l'extérieur et vers le haut, face à l'utilisateur
      for (const id in cards) {
        const cd = cards[id], on = openId === id
        cd.k = on ? Math.min(1, cd.k + dt * 2.4) : Math.max(0, cd.k - dt * 4) // 0 à 0,4 : le trait se trace, puis la fiche
        const vis = cd.k > 0.01
        cd.mesh.visible = vis; cd.line.visible = vis
        if (!vis) continue
        const h = on ? openHs : cd.lastHs
        if (on) cd.lastHs = openHs
        if (!h) continue
        worldOf(h.a, _p)
        const dist = _c.distanceTo(_p)
        const w = THREE.MathUtils.clamp(dist * 0.3, 0.2, 1.1)
        _up.set(0, 1, 0).applyQuaternion(camera.quaternion)
        _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
        // côté écran de la pastille : la fiche part vers l'extérieur de l'image
        const side = _s.copy(_p).project(camera).x > 0.15 ? -1 : 1
        cd.mesh.position.copy(_p).addScaledVector(_up, w * (0.18 + cd.aspect * 0.5)).addScaledVector(_right, side * w * 0.62)
        cd.mesh.quaternion.copy(camera.quaternion)
        const lk = Math.min(1, cd.k / 0.4), ck = Math.max(0, (cd.k - 0.3) / 0.7)
        const e = ck * ck * (3 - 2 * ck)
        cd.mesh.position.addScaledVector(_up, -0.06 * w * (1 - e))
        cd.mesh.scale.set(w * (0.94 + 0.06 * e), w * cd.aspect * (0.94 + 0.06 * e), 1)
        cd.mesh.material.opacity = e
        const arr = cd.line.geometry.attributes.position.array
        arr[0] = _p.x; arr[1] = _p.y; arr[2] = _p.z
        _n.copy(cd.mesh.position).addScaledVector(_up, -w * cd.aspect * 0.5).addScaledVector(_right, -side * w * 0.42)
        _n.sub(_p).multiplyScalar(lk).add(_p)
        arr[3] = _n.x; arr[4] = _n.y; arr[5] = _n.z
        cd.line.geometry.attributes.position.needsUpdate = true
        cd.line.material.opacity = Math.min(1, lk * 1.5) * 0.75
      }
      // cotes
      const dimOn = openId === 'dimensions'
      dimsK += ((dimOn ? 1 : 0) - dimsK) * Math.min(1, dt * 5)
      dimsG.visible = dimsK > 0.01
      if (dimsG.visible) {
        dimsG.userData.mat.opacity = dimsK * 0.9
        for (const o of dimsG.children) if (o.isSprite) o.material.opacity = dimsK
      }
    },
    dispose() {
      scene.remove(root); car.remove(dimsG)
      for (const o of own) o.dispose?.()
    },
  }
}

// phares / feux de jour : on pousse l'émissif des matériaux d'éclairage (pas de lumière en plus → aucun coût de rendu)
export function createCarLights(car) {
  const mats = new Map()
  car.traverse((o) => {
    const m = o.isMesh && o.material
    if (m && /headlight|running|highbeam|fog/i.test(m.name) && !mats.has(m)) mats.set(m, { e: m.emissive.clone(), i: m.emissiveIntensity })
  })
  const hot = new THREE.Color(1.0, 0.97, 0.9)
  let k = 0, target = 0
  return {
    set(on) { target = on ? 1 : 0 },
    update(dt) {
      if (Math.abs(target - k) < 1e-3) return
      k += (target - k) * Math.min(1, dt * (target ? 6 : 3))
      for (const [m, b] of mats) { m.emissive.copy(b.e).lerp(hot, k); m.emissiveIntensity = b.i + (5 - b.i) * k }
    },
  }
}
