// Interface AR spatiale autour du produit sorti du portail (ancrée au marqueur).
// - arc de 6 pastilles-bijoux (une par teinte) sous le produit
// - cartel typographique YSL (Didot) à droite : produit, N° et nom de teinte
// - médaillons dorés à gauche : OUVRIR / FERMER, RANGER
// hit(raycaster) → { type: 'shade', index } | { type: 'action', id } | null

import * as THREE from 'three'
import { SHADES } from './hero'

const GOLD = '#C9A45C', GOLD_SOFT = '#D8BE86', CREAM = '#EFE9DC'
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif"
const SANS = "'Helvetica Neue', Arial, sans-serif"
const easeOutBack = (x) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }
const clamp01 = (x) => Math.max(0, Math.min(1, x))

function canvasPlane(w, h, px) {
  const c = document.createElement('canvas')
  c.width = px; c.height = Math.round(px * h / w)
  const ctx = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
  mesh.renderOrder = 20
  return { mesh, ctx, tex, W: c.width, H: c.height }
}

function spaced(ctx, text, x, y, spacingEm) {
  // texte centré avec interlettrage (canvas n'a pas de letter-spacing fiable partout)
  const size = parseFloat(ctx.font.match(/(\d+(\.\d+)?)px/)[1])
  const sp = size * spacingEm
  const chars = [...text]
  const total = chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + sp * (chars.length - 1)
  let cx = x - total / 2
  ctx.textAlign = 'left'
  chars.forEach((ch) => { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp })
}

function drawCartel(p, shade) {
  const { ctx, W, H } = p
  ctx.clearRect(0, 0, W, H)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(8,7,5,0.0)'); g.addColorStop(0.15, 'rgba(8,7,5,0.55)'); g.addColorStop(0.85, 'rgba(8,7,5,0.55)'); g.addColorStop(1, 'rgba(8,7,5,0.0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = GOLD_SOFT; ctx.font = `500 ${Math.round(H * 0.075)}px ${SANS}`
  spaced(ctx, 'YVES SAINT LAURENT', W / 2, H * 0.17, 0.42)
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(W * 0.36, H * 0.27); ctx.lineTo(W * 0.64, H * 0.27); ctx.stroke()
  ctx.fillStyle = CREAM; ctx.font = `400 ${Math.round(H * 0.2)}px ${SERIF}`
  spaced(ctx, 'LOVESHINE', W / 2, H * 0.43, 0.08)
  ctx.fillStyle = GOLD; ctx.font = `italic 400 ${Math.round(H * 0.16)}px ${SERIF}`
  ctx.textAlign = 'center'; ctx.fillText(`${shade.num}  ${shade.name}`, W / 2, H * 0.64)
  ctx.fillStyle = 'rgba(239,233,220,0.6)'; ctx.font = `500 ${Math.round(H * 0.058)}px ${SANS}`
  spaced(ctx, 'ROUGE À LÈVRES · HUILE', W / 2, H * 0.82, 0.3)
  p.tex.needsUpdate = true
}

function drawMedallion(p, label, icon) {
  const { ctx, W, H } = p
  const r = W / 2
  ctx.clearRect(0, 0, W, H)
  const bg = ctx.createRadialGradient(r, r * 0.8, r * 0.1, r, r, r)
  bg.addColorStop(0, 'rgba(34,28,18,0.92)'); bg.addColorStop(1, 'rgba(6,5,4,0.92)')
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(r, r, r * 0.94, 0, Math.PI * 2); ctx.fill()
  const ring = ctx.createLinearGradient(0, 0, W, H)
  ring.addColorStop(0, '#F3DFA8'); ring.addColorStop(0.5, GOLD); ring.addColorStop(1, '#8E6E33')
  ctx.strokeStyle = ring; ctx.lineWidth = W * 0.035
  ctx.beginPath(); ctx.arc(r, r, r * 0.9, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = W * 0.008
  ctx.beginPath(); ctx.arc(r, r, r * 0.8, 0, Math.PI * 2); ctx.stroke()
  // icône
  ctx.strokeStyle = GOLD_SOFT; ctx.lineWidth = W * 0.022; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  if (icon === 'open') { ctx.moveTo(r - W * 0.09, r - W * 0.02); ctx.lineTo(r, r - W * 0.11); ctx.lineTo(r + W * 0.09, r - W * 0.02); ctx.moveTo(r, r - W * 0.11); ctx.lineTo(r, r + W * 0.06) }
  else if (icon === 'close') { ctx.moveTo(r - W * 0.09, r - W * 0.08); ctx.lineTo(r, r + W * 0.01); ctx.lineTo(r + W * 0.09, r - W * 0.08); ctx.moveTo(r, r + W * 0.01); ctx.lineTo(r, r - W * 0.14) }
  else { ctx.arc(r, r - W * 0.04, W * 0.085, Math.PI * 0.15, Math.PI * 1.85); ctx.moveTo(r + W * 0.075, r - W * 0.12); ctx.lineTo(r + W * 0.085, r - W * 0.07); ctx.lineTo(r + W * 0.035, r - W * 0.065) }
  ctx.stroke()
  ctx.fillStyle = CREAM; ctx.font = `700 ${Math.round(W * 0.115)}px ${SANS}`; ctx.textBaseline = 'middle'
  spaced(ctx, label, r, r + W * 0.21, 0.16)
  p.tex.needsUpdate = true
}

export function createSpatialUI(parent, { center = new THREE.Vector3(0, 0, 0.22) } = {}) {
  const group = new THREE.Group()
  group.visible = false
  parent.add(group)
  const hitables = []

  // ---- pastilles-bijoux ------------------------------------------------------------
  const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.18, envMapIntensity: 1.3 })
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128
    const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grd.addColorStop(0, 'rgba(255,230,180,0.85)'); grd.addColorStop(0.35, 'rgba(255,200,120,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  })()
  const jewels = SHADES.map((s, i) => {
    const u = (i - (SHADES.length - 1) / 2) / ((SHADES.length - 1) / 2)
    const g = new THREE.Group()
    g.position.set(center.x + u * 0.2, center.y - 0.262 + 0.022 * u * u, center.z + 0.07 - 0.03 * u * u)
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 32, 16), new THREE.MeshPhysicalMaterial({ color: s.color, metalness: 0.05, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 }))
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0215, 0.0024, 10, 48), goldMat)
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
    halo.position.z = -0.012; halo.renderOrder = 19
    const hit = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), new THREE.MeshBasicMaterial({ visible: false }))
    hit.userData.ui = { type: 'shade', index: i }
    g.add(halo, gem, rim, hit)
    group.add(g)
    hitables.push(hit)
    return { g, gem, rim, halo, base: g.position.clone(), active: 0, press: 0 }
  })

  // ---- cartel typographique --------------------------------------------------------
  const cartels = [canvasPlane(0.34, 0.19, 1024), canvasPlane(0.34, 0.19, 1024)]
  cartels.forEach((c) => { c.mesh.position.set(center.x + 0.375, center.y + 0.075, center.z - 0.02); group.add(c.mesh) })
  let front = 0, cartelFade = 1, shownShade = 0, pendingShade = -1
  const startCartel = (i) => { const back = 1 - front; drawCartel(cartels[back], SHADES[i]); front = back; cartelFade = 0; shownShade = i }

  // ---- médaillons --------------------------------------------------------------------
  const medallion = (id, label, icon, y) => {
    const p = canvasPlane(0.112, 0.112, 512)
    drawMedallion(p, label, icon)
    p.mesh.position.set(center.x - 0.33, center.y + y, center.z)
    p.mesh.userData.ui = { type: 'action', id }
    group.add(p.mesh); hitables.push(p.mesh)
    return { p, id, press: 0, label, icon }
  }
  const mOpen = medallion('open', 'OUVRIR', 'open', 0.115)
  const mReturn = medallion('return', 'RANGER', 'return', -0.025)
  const medallions = [mOpen, mReturn]

  // ---- état ------------------------------------------------------------------------
  let shown = 0, target = 0, activeShade = 0, clock = 0
  drawCartel(cartels[0], SHADES[0])

  return {
    group,
    show() { target = 1; group.visible = true },
    hide() { target = 0 },
    isShown: () => target > 0.5,
    setActiveShade(i) {
      if (i === activeShade) return
      activeShade = i
      if (cartelFade >= 1) startCartel(i) // sinon on attend la fin du fondu en cours (pas de saut de texte)
      else pendingShade = i
    },
    setOpenLabel(isOpen) {
      const label = isOpen ? 'FERMER' : 'OUVRIR', icon = isOpen ? 'close' : 'open'
      if (mOpen.label === label) return
      mOpen.label = label; mOpen.icon = icon
      drawMedallion(mOpen.p, label, icon)
    },
    press(hit) {
      if (!hit) return
      if (hit.type === 'shade') jewels[hit.index].press = 1
      else medallions.find((m) => m.id === hit.id).press = 1
    },
    hit(raycaster) {
      if (shown < 0.6) return null
      const h = raycaster.intersectObjects(hitables, false)[0]
      return h ? h.object.userData.ui : null
    },
    update(dt) {
      clock += dt
      shown += (target - shown) * Math.min(1, dt * (target ? 3.2 : 5))
      if (target === 0 && shown < 0.01) { group.visible = false; return }
      const appear = (delay) => easeOutBack(clamp01((shown - delay) / (1 - delay)))
      jewels.forEach((j, i) => {
        j.active += ((i === activeShade ? 1 : 0) - j.active) * Math.min(1, dt * 7)
        j.press = Math.max(0, j.press - dt * 4)
        const s = appear(0.05 * i) * (1 + 0.32 * j.active + 0.25 * Math.sin(j.press * Math.PI))
        j.g.scale.setScalar(Math.max(s, 0.0001))
        j.g.position.copy(j.base)
        j.g.position.y += 0.016 * j.active + Math.sin(clock * 1.6 + i) * 0.0025
        j.gem.rotation.y = clock * 0.6 + i
        j.halo.material.opacity = j.active * shown * (0.75 + 0.25 * Math.sin(clock * 3))
      })
      cartelFade = Math.min(1, cartelFade + dt * 2.5)
      if (cartelFade >= 1 && pendingShade >= 0) { const p = pendingShade; pendingShade = -1; if (p !== shownShade) startCartel(p) }
      const cs = appear(0.25)
      cartels.forEach((c, k) => {
        const mine = k === front ? cartelFade : 1 - cartelFade
        c.mesh.material.opacity = clamp01(cs) * mine
        c.mesh.scale.setScalar(0.94 + 0.06 * clamp01(cs))
        c.mesh.visible = c.mesh.material.opacity > 0.003
      })
      medallions.forEach((m, k) => {
        m.press = Math.max(0, m.press - dt * 4)
        const s = appear(0.15 + 0.1 * k)
        m.p.mesh.scale.setScalar(Math.max(0.0001, s * (1 + 0.18 * Math.sin(m.press * Math.PI))))
        m.p.mesh.material.opacity = clamp01(s)
      })
    },
  }
}
