// Portail à PORTE COULISSANTE → BOUTIQUE YSL raffinée (marbre & or).
// Vraies NORMAL MAPS (relief réaliste), COLONNES modélisées (base moulurée + fût cannelé
// + chapiteau), PANNEAUX muraux moulurés (boiseries), NICHE en velours, faisceau de
// lumière volumétrique. Carrousel de lipsticks colorés qui flottent + sortie au clic.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

export const CFG = {
  modelUrl: '/lovenude.glb',
  targetName: 'door',
  targetDataUrl: '/image-targets/door.json',
  doorTexUrl: '/targets/door.png',
  hdrUrl: '/hdr/photo_studio_01.hdr',
  wallSize: 1.2,       // largeur du portail (unités scène)
  wallHeight: 1.2,     // = wallSize : scène CARRÉE comme avant ; l'image door.png est adaptée à cette scène
  roomDepth: 2.2,
  pedestalZ: -1.2,
  lipH: 0.4,
  spacing: 0.46,
  openDur: 1.6,
  outDist: 0.5,
}

const SHADES = [
  { name: 'Rouge', color: 0xc0304a },
  { name: 'Lovenude', color: 0xf2a9a1 },
  { name: 'Corail', color: 0xe8683c },
  { name: 'Pink', color: 0xd94f6a },
  { name: 'Berry', color: 0x8a2c3b },
  { name: 'Rosewood', color: 0xb84a5e },
]

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x) }

// ---- textures procédurales + normal maps ----------------------------------
const cvw = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }
const toTex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t }
// dérive une normal map d'un canvas de hauteur (niveaux de gris)
function heightToNormal(src, strength) {
  const w = src.width, h = src.height
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data
  const [c, x] = cvw(w, h); const out = x.createImageData(w, h); const od = out.data
  const G = (xx, yy) => { xx = (xx + w) % w; yy = (yy + h) % h; const i = (yy * w + xx) * 4; return (sd[i] + sd[i + 1] + sd[i + 2]) / 765 }
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const dx = (G(xx - 1, yy) - G(xx + 1, yy)) * strength
    const dy = (G(xx, yy - 1) - G(xx, yy + 1)) * strength
    const len = Math.hypot(dx, dy, 1)
    const i = (yy * w + xx) * 4
    od[i] = (dx / len * 0.5 + 0.5) * 255; od[i + 1] = (dy / len * 0.5 + 0.5) * 255; od[i + 2] = (1 / len * 0.5 + 0.5) * 255; od[i + 3] = 255
  }
  x.putImageData(out, 0, 0); return toTex(c, false)
}
// sol onyx : laque noire + veines d'OR métalliques (réfléchissantes)
function onyxMaps() {
  const [c, x] = cvw(512, 512); x.fillStyle = '#080808'; x.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 300; i++) { const g = 10 + Math.random() * 14; x.fillStyle = `rgba(${g},${g},${g + 2},0.06)`; x.beginPath(); x.arc(Math.random() * 512, Math.random() * 512, 24 + Math.random() * 90, 0, 7); x.fill() }
  const [hc, hx] = cvw(512, 512); hx.fillStyle = '#808080'; hx.fillRect(0, 0, 512, 512)
  const [mc, mx] = cvw(512, 512); mx.fillStyle = '#000'; mx.fillRect(0, 0, 512, 512) // metalness : noir = laque diélectrique
  const vein = (n, a, col, lw) => { for (let i = 0; i < n; i++) { const pts = []; let px = Math.random() * 512, py = -20; for (let s = 0; s < 20; s++) { px += (Math.random() - 0.5) * 64; py += 28; pts.push([px, py]) } const draw = (ctx, c2, w, al) => { ctx.globalAlpha = al; ctx.strokeStyle = c2; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.quadraticCurveTo(pts[k - 1][0], pts[k - 1][1], (pts[k - 1][0] + pts[k][0]) / 2, (pts[k - 1][1] + pts[k][1]) / 2); ctx.stroke(); ctx.globalAlpha = 1 }; const w = lw * (0.5 + Math.random()); draw(x, col, w, a); draw(mx, '#fff', w, a); draw(hx, '#cfcfcf', w, a * 0.6) } }
  vein(6, 0.75, '#caa048', 2.0); vein(10, 0.45, '#b8893f', 1.2); vein(4, 0.9, '#e8c878', 1.0)
  return { map: toTex(c, true), normal: heightToNormal(hc, 0.9), metal: toTex(mc, false) }
}
// murs : NOIR MAT PROFOND quasi uni, grain très fin (aucun reflet)
function plasterMaps() {
  const [c, x] = cvw(512, 512); x.fillStyle = '#070707'; x.fillRect(0, 0, 512, 512)
  const [hc, hx] = cvw(512, 512); hx.fillStyle = '#808080'; hx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 3800; i++) { const v = 3 + Math.random() * 8; x.fillStyle = `rgba(${v},${v},${v},0.04)`; const r = 2 + Math.random() * 6; x.beginPath(); x.arc(Math.random() * 512, Math.random() * 512, r, 0, 7); x.fill(); const hv = 122 + Math.random() * 24; hx.fillStyle = `rgba(${hv},${hv},${hv},0.05)`; hx.beginPath(); hx.arc(Math.random() * 512, Math.random() * 512, r, 0, 7); hx.fill() }
  return { map: toTex(c, true), normal: heightToNormal(hc, 0.3) }
}
function fluteNormal(n) {
  const [hc, hx] = cvw(256, 64)
  for (let i = 0; i < 256; i++) { const v = 128 + Math.sin((i / 256) * n * Math.PI * 2) * 110; hx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; hx.fillRect(i, 0, 1, 64) }
  const t = heightToNormal(hc, 2.2); t.repeat.set(1, 1); return t
}
// velours NOIR : base sombre + duvet/reflets chauds subtils
function velvetTex() {
  const [c, x] = cvw(256, 256); x.fillStyle = '#0a0908'; x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 4200; i++) { const v = Math.random(); x.fillStyle = `rgba(${30 + v * 40},${24 + v * 28},${14 + v * 18},0.05)`; x.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 3) }
  const g = x.createRadialGradient(128, 90, 10, 128, 128, 170); g.addColorStop(0, 'rgba(120,92,40,0.22)'); g.addColorStop(1, 'rgba(8,7,6,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256)
  return toTex(c, true)
}
function radialTex(stops) { const [c, x] = cvw(128, 128); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return toTex(c, false) }
function beamTex() { const [c, x] = cvw(64, 256); const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,240,210,0.9)'); g.addColorStop(0.5, 'rgba(255,232,190,0.33)'); g.addColorStop(1, 'rgba(255,230,180,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 256); return toTex(c, false) }

export function buildCatalogScene(renderer, scene, { onStatus } = {}) {
  const status = (s) => onStatus && onStatus(s)
  const gl = renderer.getContext()
  const W = CFG.wallSize, H = CFG.wallHeight, D = CFG.roomDepth

  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environmentIntensity = 1.0 // l'or réfléchit l'env à fond
  new RGBELoader().load(CFG.hdrUrl, (hdr) => { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; hdr.dispose() })
  scene.add(new THREE.AmbientLight(0xffffff, 0.08))
  scene.add(new THREE.HemisphereLight(0x332a1c, 0x000000, 0.18)) // soupçon de chaleur, murs restent bien noirs

  const anchor = new THREE.Group(); anchor.visible = false; scene.add(anchor)

  const stencilInside = (m) => { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.EqualStencilFunc; m.stencilFail = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp; m.stencilZPass = THREE.KeepStencilOp; return m }
  const maskMat = new THREE.MeshBasicMaterial(); maskMat.colorWrite = false; maskMat.depthWrite = false; maskMat.depthTest = false
  maskMat.stencilWrite = true; maskMat.stencilRef = 1; maskMat.stencilFunc = THREE.AlwaysStencilFunc; maskMat.stencilZPass = THREE.ReplaceStencilOp; maskMat.stencilFail = THREE.ReplaceStencilOp; maskMat.stencilZFail = THREE.ReplaceStencilOp
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(W, H), maskMat); mask.renderOrder = -1; anchor.add(mask)

  const room = new THREE.Group(); anchor.add(room)
  const pedTop = -H / 2 + 0.26
  const add = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.copy(pos); if (rot) m.rotation.copy(rot); m.renderOrder = 1; room.add(m); return m }
  const stencilGroup = (g) => { g.traverse((o) => { if (o.isMesh && o.material) { stencilInside(o.material); o.renderOrder = 1 } }); return g }

  // ---- matériaux : TEXTURES PBR réelles (Color + NormalGL + Roughness) ---------------
  const GOLD = 0xd8b24e, GOLD_DK = 0xa5823a
  const texL = new THREE.TextureLoader()
  const loadPBR = (base, ext, rx, ry) => {
    const col = texL.load(`/textures/${base}_Color.${ext}`); col.colorSpace = THREE.SRGBColorSpace
    const nrm = texL.load(`/textures/${base}_NormalGL.${ext}`); nrm.colorSpace = THREE.NoColorSpace
    const rgh = texL.load(`/textures/${base}_Roughness.${ext}`); rgh.colorSpace = THREE.NoColorSpace
    ;[col, nrm, rgh].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8 })
    return { col, nrm, rgh }
  }
  // sol : marbre "tile" (Tiles075)
  const tx = loadPBR('Tiles075_1K-JPG', 'jpg', 3, 3.3)
  const floorMat = stencilInside(new THREE.MeshStandardMaterial({ map: tx.col, normalMap: tx.nrm, roughnessMap: tx.rgh, metalness: 0, envMapIntensity: 0.5 }))
  // murs : marbre (Marble002) — texture bien visible mais MAT (pas de roughnessMap brillante, env minimal)
  const mw = loadPBR('Marble002_1K-JPG', 'jpg', 2, 1.2)
  const wallMat = stencilInside(new THREE.MeshStandardMaterial({ map: mw.col, normalMap: mw.nrm, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.88, metalness: 0, envMapIntensity: 0.1 }))
  // fond de panneaux : même marbre, répétition plus serrée
  const mwp = loadPBR('Marble002_1K-JPG', 'jpg', 1, 1)
  const panelFieldMat = stencilInside(new THREE.MeshStandardMaterial({ map: mwp.col, normalMap: mwp.nrm, roughness: 0.9, metalness: 0, envMapIntensity: 0.08 }))
  const ceilMat = stencilInside(new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, metalness: 0 }))
  // OR : métal pur poli (on n'utilise PAS la couleur de Metal007 qui tirait orange)
  const goldMat = stencilInside(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.2, envMapIntensity: 2.0 }))
  const goldDark = stencilInside(new THREE.MeshStandardMaterial({ color: GOLD_DK, metalness: 1, roughness: 0.34, envMapIntensity: 1.5 }))
  const fluteNrm = fluteNormal(16)
  // fût de colonne : laque NOIRE cannelée (contraste avec le marbre)
  const shaftMat = stencilInside(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, metalness: 0.0, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 1.0, normalMap: fluteNrm, normalScale: new THREE.Vector2(0.7, 0.2) }))
  const velvetMat = stencilInside(new THREE.MeshStandardMaterial({ map: velvetTex(), roughness: 1, metalness: 0, envMapIntensity: 0.06 }))

  // ---- coquille ---------------------------------------------------------------------
  add(new THREE.PlaneGeometry(W, D), floorMat, new THREE.Vector3(0, -H / 2, -D / 2), new THREE.Euler(-Math.PI / 2, 0, 0))
  add(new THREE.PlaneGeometry(W, D), ceilMat, new THREE.Vector3(0, H / 2, -D / 2), new THREE.Euler(Math.PI / 2, 0, 0))
  add(new THREE.PlaneGeometry(D, H), wallMat, new THREE.Vector3(-W / 2, 0, -D / 2), new THREE.Euler(0, Math.PI / 2, 0))
  add(new THREE.PlaneGeometry(D, H), wallMat, new THREE.Vector3(W / 2, 0, -D / 2), new THREE.Euler(0, -Math.PI / 2, 0))
  add(new THREE.PlaneGeometry(W, H), wallMat, new THREE.Vector3(0, 0, -D + 0.005))

  // ---- colonne détaillée (base moulurée + fût cannelé + chapiteau) -------------------
  const makeColumn = (height) => {
    const g = new THREE.Group()
    const shaftH = height - 0.2
    const part = (geo, mat, y, rotX) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; if (rotX) m.rotation.x = rotX; g.add(m); return m }
    const base = -height / 2
    part(new THREE.BoxGeometry(0.18, 0.045, 0.18), goldMat, base + 0.022) // plinthe
    part(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 28), goldMat, base + 0.06) // tore inférieur
    part(new THREE.TorusGeometry(0.072, 0.017, 12, 32), goldMat, base + 0.09, Math.PI / 2) // scotie
    part(new THREE.CylinderGeometry(0.062, 0.07, 0.025, 28), goldMat, base + 0.11) // congé de base
    part(new THREE.CylinderGeometry(0.052, 0.062, shaftH, 32), shaftMat, 0.01) // fût noir cannelé
    part(new THREE.TorusGeometry(0.057, 0.012, 12, 32), goldMat, shaftH / 2 + 0.02, Math.PI / 2) // astragale
    part(new THREE.CylinderGeometry(0.07, 0.052, 0.03, 28), goldMat, height / 2 - 0.085) // gorge
    part(new THREE.CylinderGeometry(0.088, 0.07, 0.05, 28), goldMat, height / 2 - 0.05) // échine
    part(new THREE.BoxGeometry(0.19, 0.035, 0.19), goldMat, height / 2 - 0.0175) // tailloir
    return stencilGroup(g)
  }
  const placeCol = (x, z) => { const c = makeColumn(H); c.position.set(x, 0, z); room.add(c) }
  placeCol(-W / 2 + 0.11, -D + 0.12); placeCol(W / 2 - 0.11, -D + 0.12)

  // ---- boiserie : moulures FINES profilées (listel + arête triangulaire) ------------
  const baseMat = stencilInside(new THREE.MeshPhysicalMaterial({ color: 0x090909, roughness: 0.5, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.3 }))
  // moulure fine : listel plat (saillie douce) + arête TRIANGULAIRE (baguette tournée 45°)
  const molding = (g, w, h, cx, cy, z) => {
    const t = 0.011, fd = 0.006, s = 0.012 // listel fin, faible saillie, arête triangulaire fine
    const flat = (gw, gh, gx, gy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, fd), goldDark); m.position.set(cx + gx, cy + gy, z + fd / 2); g.add(m) }
    flat(w, t, 0, h / 2 - t / 2); flat(w, t, 0, -(h / 2 - t / 2)); flat(t, h - 2 * t, -(w / 2 - t / 2), 0); flat(t, h - 2 * t, w / 2 - t / 2, 0)
    const iw = w - 2 * t, ih = h - 2 * t
    const tri = (len, horiz) => { const m = new THREE.Mesh(horiz ? new THREE.BoxGeometry(len, s, s) : new THREE.BoxGeometry(s, len, s), goldMat); if (horiz) m.rotation.x = Math.PI / 4; else m.rotation.y = Math.PI / 4; return m }
    let m
    m = tri(iw + s, true); m.position.set(cx, cy + ih / 2, z + fd); g.add(m)
    m = tri(iw + s, true); m.position.set(cx, cy - ih / 2, z + fd); g.add(m)
    m = tri(ih - s, false); m.position.set(cx - iw / 2, cy, z + fd); g.add(m)
    m = tri(ih - s, false); m.position.set(cx + iw / 2, cy, z + fd); g.add(m)
  }
  const framedPanel = (g, w, h, cx, cy) => {
    const inf = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panelFieldMat); inf.position.set(cx, cy, 0.002); g.add(inf)
    molding(g, w, h, cx, cy, 0.002)
  }
  const baseboard = (g, w) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.055, 0.022), baseMat); b.position.set(0, -H / 2 + 0.0275, 0.011); g.add(b)
    const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.005, 0.026), goldMat); line.position.set(0, -H / 2 + 0.052, 0.013); g.add(line)
  }
  // pan de mur (plan local XY, face +Z) : fond noir mat + plinthe + panneaux fins
  const makeWall = (areaW, n) => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(areaW, H), wallMat))
    baseboard(g, areaW)
    const margin = 0.1, stile = 0.1
    const top = H / 2 - 0.09, bot = -H / 2 + 0.11, ph = top - bot, cy = (top + bot) / 2
    const usableW = areaW - 2 * margin, pw = (usableW - (n - 1) * stile) / n
    for (let i = 0; i < n; i++) framedPanel(g, pw, ph, -usableW / 2 + pw / 2 + i * (pw + stile), cy)
    return stencilGroup(g)
  }
  const placeWall = (g, pos, rotY) => { g.position.copy(pos); g.rotation.y = rotY; room.add(g) }
  placeWall(makeWall(D - 0.08, 2), new THREE.Vector3(-W / 2 + 0.003, 0, -D / 2), Math.PI / 2)
  placeWall(makeWall(D - 0.08, 2), new THREE.Vector3(W / 2 - 0.003, 0, -D / 2), -Math.PI / 2)

  // ---- niche en velours encadrée d'or (moulure fine) + panneaux flanquants ----------
  const nicheW = 0.58, nicheH = 0.95, nicheZ = -D + 0.05
  add(new THREE.PlaneGeometry(nicheW, nicheH), velvetMat, new THREE.Vector3(0, -H / 2 + nicheH / 2 + 0.03, nicheZ))
  const backG = new THREE.Group(); backG.position.set(0, 0, -D + 0.006); room.add(backG)
  baseboard(backG, W)
  const sideW = (W - nicheW) / 2 - 0.15
  ;[-1, 1].forEach((s) => framedPanel(backG, sideW, nicheH - 0.08, s * (nicheW / 2 + 0.09 + sideW / 2), -H / 2 + nicheH / 2 + 0.03))
  stencilGroup(backG)
  const nFrame = new THREE.Group(); nFrame.position.set(0, -H / 2 + nicheH / 2 + 0.03, nicheZ + 0.004)
  molding(nFrame, nicheW + 0.04, nicheH + 0.04, 0, 0, 0)
  stencilGroup(nFrame); room.add(nFrame)
  const nicheLight = new THREE.PointLight(0xffcf8a, 2.6, 2.2, 2); nicheLight.position.set(0, -H / 2 + nicheH * 0.6, nicheZ + 0.3); room.add(nicheLight)

  // ---- corniche + plinthe -----------------------------------------------------------
  const bb = 0.03
  const trim = (w, h, d, x, y, z) => add(new THREE.BoxGeometry(w, h, d), goldMat, new THREE.Vector3(x, y, z))
  trim(W, bb, bb, 0, -H / 2 + bb / 2, -D + bb / 2); trim(bb, bb, D, -W / 2 + bb / 2, -H / 2 + bb / 2, -D / 2); trim(bb, bb, D, W / 2 - bb / 2, -H / 2 + bb / 2, -D / 2)
  trim(W, bb * 1.4, bb * 1.4, 0, H / 2 - bb * 0.7, -D + bb * 0.7); trim(bb * 1.4, bb * 1.4, D, -W / 2 + bb * 0.7, H / 2 - bb * 0.7, -D / 2); trim(bb * 1.4, bb * 1.4, D, W / 2 - bb * 0.7, H / 2 - bb * 0.7, -D / 2)

  // ---- caisson plafond lumineux + médaillon sol -------------------------------------
  add(new THREE.PlaneGeometry(0.5, 0.5), stencilInside(new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,240,200,0.9)'], [0.5, 'rgba(180,140,70,0.4)'], [1, 'rgba(0,0,0,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), new THREE.Vector3(0, H / 2 - 0.01, CFG.pedestalZ), new THREE.Euler(Math.PI / 2, 0, 0))
  add(new THREE.CircleGeometry(0.44, 64), stencilInside(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, metalness: 0, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.1 })), new THREE.Vector3(0, -H / 2 + 0.004, CFG.pedestalZ), new THREE.Euler(-Math.PI / 2, 0, 0))
  add(new THREE.TorusGeometry(0.44, 0.012, 14, 80), goldMat, new THREE.Vector3(0, -H / 2 + 0.009, CFG.pedestalZ), new THREE.Euler(-Math.PI / 2, 0, 0))
  add(new THREE.TorusGeometry(0.3, 0.008, 12, 64), goldDark, new THREE.Vector3(0, -H / 2 + 0.009, CFG.pedestalZ), new THREE.Euler(-Math.PI / 2, 0, 0))

  // ---- socle ------------------------------------------------------------------------
  const stoneMat = stencilInside(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0c, metalness: 0, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.14, envMapIntensity: 1.1 }))
  add(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 56), goldMat, new THREE.Vector3(0, -H / 2 + 0.025, CFG.pedestalZ))
  add(new THREE.TorusGeometry(0.3, 0.014, 12, 64), goldMat, new THREE.Vector3(0, -H / 2 + 0.05, CFG.pedestalZ), new THREE.Euler(Math.PI / 2, 0, 0))
  add(new THREE.CylinderGeometry(0.25, 0.3, 0.16, 56), stoneMat, new THREE.Vector3(0, -H / 2 + 0.14, CFG.pedestalZ))
  add(new THREE.TorusGeometry(0.255, 0.012, 14, 64), goldMat, new THREE.Vector3(0, pedTop, CFG.pedestalZ), new THREE.Euler(Math.PI / 2, 0, 0))
  const glowDisc = add(new THREE.CircleGeometry(0.23, 48), stencilInside(new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,240,200,0.9)'], [0.45, 'rgba(255,225,170,0.4)'], [1, 'rgba(255,220,160,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), new THREE.Vector3(0, pedTop + 0.003, CFG.pedestalZ), new THREE.Euler(-Math.PI / 2, 0, 0)); glowDisc.renderOrder = 2
  const contact = add(new THREE.CircleGeometry(0.14, 40), stencilInside(new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(0,0,0,0.5)'], [0.6, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false })), new THREE.Vector3(0, pedTop + 0.005, CFG.pedestalZ), new THREE.Euler(-Math.PI / 2, 0, 0)); contact.renderOrder = 3

  // ---- faisceau volumétrique --------------------------------------------------------
  const beamGroup = new THREE.Group(); room.add(beamGroup)
  const beamH = (H / 2 - 0.02) - pedTop
  const beamTx = beamTex()
  const beamCone = (rBot, op) => { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, rBot, beamH, 40, 1, true), stencilInside(new THREE.MeshBasicMaterial({ map: beamTx, transparent: true, opacity: op, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }))); mesh.position.set(0, pedTop + beamH / 2, CFG.pedestalZ); mesh.renderOrder = 4; beamGroup.add(mesh) }
  beamCone(0.17, 0.16); beamCone(0.26, 0.09); beamCone(0.36, 0.05)
  const ddisc = radialTex([[0, 'rgba(255,245,215,1)'], [1, 'rgba(255,245,215,0)']])
  const beamDust = []
  for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(stencilInside(new THREE.SpriteMaterial({ map: ddisc, transparent: true, opacity: 0.4 + Math.random() * 0.5, blending: THREE.AdditiveBlending, depthWrite: false }))); const sc = 0.006 + Math.random() * 0.012; s.scale.set(sc, sc, sc); const a = Math.random() * 6.28, r = Math.random() * 0.22; s.position.set(Math.cos(a) * r, pedTop + Math.random() * beamH, CFG.pedestalZ + Math.sin(a) * r); s.renderOrder = 5; s.userData = { spd: 0.03 + Math.random() * 0.05 }; beamGroup.add(s); beamDust.push(s) }
  const spot = new THREE.SpotLight(0xffe6c0, 9, 4, 0.5, 0.5, 1.5); spot.position.set(0, H / 2 - 0.05, CFG.pedestalZ); spot.target.position.set(0, pedTop, CFG.pedestalZ); room.add(spot); room.add(spot.target)
  // accents chauds : font scintiller l'or des colonnes / cadres
  const acc = (x, z, i) => { const p = new THREE.PointLight(0xffcf8a, i, 1.9, 2.4); p.position.set(x, H * 0.3, z); room.add(p); return p }
  acc(-W / 2 + 0.28, -D * 0.5, 0.9); acc(W / 2 - 0.28, -D * 0.5, 0.9); acc(0, -0.45, 0.8)

  // ---- poussière d'ambiance ---------------------------------------------------------
  const dust = []
  for (let i = 0; i < 38; i++) { const s = new THREE.Sprite(stencilInside(new THREE.SpriteMaterial({ map: ddisc, color: 0xC9A45C, transparent: true, opacity: 0.12 + Math.random() * 0.22, blending: THREE.AdditiveBlending, depthWrite: false }))); const sc = 0.008 + Math.random() * 0.016; s.scale.set(sc, sc, sc); s.position.set((Math.random() - 0.5) * W * 0.9, (Math.random() - 0.5) * H * 0.9, -0.2 - Math.random() * (D - 0.4)); s.renderOrder = 5; s.userData = { spd: 0.015 + Math.random() * 0.04, ph: Math.random() * 6.28 }; room.add(s); dust.push(s) }

  // ---- porte coulissante ------------------------------------------------------------
  const doorTex = new THREE.TextureLoader().load(CFG.doorTexUrl); doorTex.colorSpace = THREE.SRGBColorSpace
  const mkDoor = (uOff) => { const t = doorTex.clone(); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(0.5, 1); t.offset.set(uOff, 0); const m = new THREE.Mesh(new THREE.PlaneGeometry(W / 2, H), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.1, transparent: true })); m.position.z = 0.012; m.renderOrder = 6; anchor.add(m); return m }
  const doorL = mkDoor(0.0), doorR = mkDoor(0.5)

  // ---- lipsticks (carrousel) --------------------------------------------------------
  const carousel = new THREE.Group(); room.add(carousel)
  const lips = []
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.2, CFG.lipH + 0.12, 0.2), new THREE.MeshBasicMaterial({ visible: false })); proxy.position.set(0, pedTop + CFG.lipH / 2 + 0.14, CFG.pedestalZ); room.add(proxy)
  const makeMat = (cfg) => stencilInside(new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.0, ...cfg }))
  let modelProto = null
  const colorize = (shade) => {
    const g = modelProto.clone(true)
    const mats = { cap: makeMat({ color: shade, metalness: 0.9, roughness: 0.1, clearcoat: 0.3 }), body: makeMat({ color: shade, metalness: 1.0, roughness: 0.12 }), cassandre: makeMat({ color: 0xe8eaef, metalness: 1.0, roughness: 0.08 }), ring: makeMat({ color: 0x3a1c1c, metalness: 0.0, roughness: 0.4 }), capInterior: makeMat({ color: 0x0b0b0b, metalness: 0.2, roughness: 0.35 }) }
    g.traverse((o) => { if (!o.isMesh || !o.material) return; const mn = (o.material.name || '').toLowerCase(); if (mn === 'metal_pink') o.material = mats.cap; else if (mn === 'metal') o.material = mats.cassandre; else if (mn === 'metal_pink_int') o.material = mats.body; else if (mn === 'pink_matte' || mn === 'pink_glossy') o.material = mats.body; else if (mn === 'black_glossy') o.material = mats.capInterior; else if (mn.includes('lovenude')) o.material = mats.ring })
    return g
  }
  const ready = new Promise((resolve) => {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(CFG.modelUrl, (gltf) => {
      const m = gltf.scene; const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
      m.scale.setScalar(CFG.lipH / (size.y || 1)); m.updateMatrixWorld(true); m.position.sub(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()))
      const wrap = new THREE.Group(); wrap.add(m); modelProto = wrap
      for (let i = 0; i < SHADES.length; i++) { const holder = new THREE.Group(); const model = colorize(SHADES[i].color); model.position.y = CFG.lipH / 2; holder.add(model); holder.position.set(0, pedTop, CFG.pedestalZ); carousel.add(holder); lips.push({ holder, model }) }
      status('Prêt'); resolve()
    }, undefined, (err) => { console.error('[catalog] modèle', (err && err.stack) || err); status('Erreur modèle'); resolve() })
  })

  // ---- animation --------------------------------------------------------------------
  let clock = 0, introPlayed = false, introT = 0, open = 0, index = 0, offset = 0, taken = false, takeA = 0
  const playIntro = () => { introPlayed = true; introT = 0; open = 0; taken = false; takeA = 0 }
  const next = () => { index = Math.min(index + 1, SHADES.length - 1) }
  const prev = () => { index = Math.max(index - 1, 0) }
  const toggleTake = () => { if (open > 0.9) { taken = !taken; return taken } return false }

  const update = (dt) => {
    clock += dt
    gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT)
    if (introPlayed) { introT += dt; open = smooth(introT / CFG.openDur) }
    mask.scale.x = Math.max(open, 0.0001)
    const doorFade = 1 - smooth((open - 0.6) / 0.4)
    doorL.position.x = -W / 4 - open * W / 2; doorR.position.x = W / 4 + open * W / 2
    doorL.material.opacity = doorFade; doorR.material.opacity = doorFade; doorL.visible = doorR.visible = doorFade > 0.01
    for (const s of beamDust) { s.position.y -= s.userData.spd * dt; if (s.position.y < pedTop) s.position.y = H / 2 - 0.05 }
    for (const s of dust) { s.position.y += s.userData.spd * dt; s.material.opacity = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(clock * 1.4 + s.userData.ph)); if (s.position.y > H / 2) s.position.y = -H / 2 }
    glowDisc.material.opacity = 0.55 + 0.18 * Math.sin(clock * 2)
    contact.material.opacity = (0.9 - takeA * 0.8) * (0.85 + 0.15 * Math.sin(clock * 0.9))
    spot.intensity = 8.5 + Math.sin(clock * 2) * 0.8

    offset += (index - offset) * Math.min(dt * 6, 1)
    for (let i = 0; i < lips.length; i++) {
      const d = i - offset, ad = Math.abs(d), l = lips[i]
      l.holder.visible = ad < 2.6
      const isCenter = i === Math.round(offset)
      const tk = isCenter ? takeA : 0
      const hover = 0.1 + (isCenter ? 0.05 : 0)
      const bob = Math.sin(clock * 0.9 + i * 1.3) * 0.016 + Math.sin(clock * 1.7 + i) * 0.008
      const x = d * CFG.spacing, z = CFG.pedestalZ - ad * 0.1 + tk * (CFG.outDist - CFG.pedestalZ), y = pedTop + hover + bob
      const sc = (1 - Math.min(ad, 2) * 0.16) * (1 + tk * 0.1)
      l.holder.position.set(x, y, z); l.holder.scale.setScalar(sc); l.holder.rotation.z = Math.sin(clock * 0.6 + i) * 0.05
      l.model.rotation.y += dt * (isCenter ? 0.7 : 0.25)
      l.model.traverse((o) => { if (o.isMesh && o.material) o.material.stencilWrite = !(isCenter && tk > 0.5) })
    }
    takeA += ((taken ? 1 : 0) - takeA) * Math.min(dt * 3, 1)
  }

  return { anchor, update, playIntro, next, prev, toggleTake, getProxy: () => proxy, hasPlayedIntro: () => introPlayed, isOpen: () => open > 0.9, shadeName: () => SHADES[index].name, ready }
}
