// « BLEU INTERDIT » — interface AR spatiale du parfum, ancrée au marqueur (SPEC_PERFUME §5.1, §5.2, §5.5–5.7).
// Même grammaire que lib/ysl/spatialUI.js (anneaux d'or, cartel, plans canvas : canvasPlane, spaced et drawMedallion
// y sont COPIÉS puis adaptés), habillée à la charte de l'affiche « BLEU INTERDIT » (lib/majorelle/brand.js) :
// Bodoni Moda pour le nom et les italiques, Montserrat en capitales espacées, filets d'or de part et d'autre
// des petites capitales, points d'or séparateurs, encre #16205e / encre profonde #0e1234 / or / ivoire.
//
//   - 3 lunettes sous le flacon = les BOUTONS d'action de la vitrine, dans n'importe quel ordre (FLEUR / ÉCLOSION /
//     CÈDRE) : jante d'or ronde (3D) ; à faire = émail encre guilloché + icône au trait ivoire (fleur d'oranger /
//     nénuphar / cône de cèdre) bien visible ; fait = pièce d'or, icône gravée à l'encre, libellé or souligné ;
//     libellé en capitales espacées dessous (repli sur 2 lignes si un libellé ne tenait pas) ;
//   - cartel à droite (2 tampons en fondu enchaîné), composé comme le bloc-titre de l'affiche : YVES SAINT LAURENT
//     espacé, BLEU INTERDIT en Bodoni, — EAU DE PARFUM — entre deux filets d'or ; puis la ligne italique Bodoni
//     (note / final), un filet d'or, la ligne de petites capitales à points d'or, et la mention en petites capitales.
//     Pas de cartouche : un voile d'encre très diffus (comme le bandeau bas de l'affiche) + un halo d'encre par lettre ;
//   - médaillons à gauche, en bijou : émail encre guilloché, double filet d'or, icône au trait (flacon + brume /
//     retour au jardin), libellé ivoire entre deux filets d'or. VAPORISER a deux états dessinés (verrouillé : émail
//     éteint, icône voilée, anneau-piste ; libre : or plein) ; anneau de progression 1/3 par coup ; anneau de maintien ;
//   - onde de choc dorée du heurtoir (strike) et anneau fantôme (ghost), renderOrder 18.
//
// createPerfumeUI(anchor, { center, copy, face = 0.5, reducedMotion }) → {
//   group, show(), hide(), isShown(),
//   setKnocks(n), setDone([b0, b1, b2]), bezelAnchor(i, out), setNote(i), setFinal(),
//   setSpray({ locked, progress, pulse }), setHold(k | null, { at, radius }?),
//   strike(pointAnchor, width, normalAnchor?), ghost(on, pointAnchor, radius),
//   hit(raycaster) → { type: 'note', index, lit } | { type: 'action', id: 'spray' | 'return', locked } | null,
//   press(hit), update(dt, camera), dispose(),
//   // ajouts (additifs, hors spec) : reset(), setDim(k), prewarm(renderer, camera), stats()
// }
// Notes pour le directeur :
//   - update(dt, camera) : la caméra est facultative ; fournie, lunettes / cartel / médaillons s'orientent à 50 %
//     vers elle (±0,6 rad max) pour rester lisibles de biais. Sans caméra : plans fixes face +Z, comme spatialUI.
//   - ghost(on, point, r) peut être rappelé à chaque image (suit le heurtoir) ; strike() est ponctuel ;
//     ghost(true, ui.bezelAnchor(i, v), 0.036) entoure la lunette i (invitation au prochain bouton suggéré).
//   - setDone(mask) allume exactement les lunettes du masque (éclat sur les nouvelles) et règle l'anneau VAPORISER
//     à (nombre faites) / 3 tant qu'il est verrouillé ; setKnocks(n) reste disponible (= setDone des n premières).
//   - finale : setDim(0.4) puis setDim(1) ; resetToClosed : reset() + hide() ; prewarm(renderer, cam) compile tout.
//   - renderOrder : 18 choc / fantôme, 19 halos additifs, 19,5 disques et médaillons, 20 jantes, cartel, anneaux.
//   - polices : les canvas sont dessinés tout de suite (repli Didot / Helvetica), puis REDESSINÉS dès que
//     ensureBrandFonts() (Bodoni Moda + Montserrat) a répondu, et à chaque « loadingdone » de ces familles.
//   - écarts assumés : libellés des médaillons SOUS le disque (lisibles ≥ 6 pt sur 390 pt) ; lunettes écartées
//     de 0,15 (spec 0,12) pour que FLEUR / ÉCLOSION / CÈDRE à ≥ 6 pt ne se touchent jamais ; cartel 0,44 × 0,32
//     (spec 0,34 × 0,21) pour un nom Bodoni ≥ 11 pt à la distance par défaut ; jantes Ø tube 0,0025 (spec 0,003).
// Repère : unités marqueur (le groupe est un enfant direct de l'ancre, sans transformation).
// update() ne crée aucun objet par image (état animé dans des champs double, uniformes UNum).
// Tous les plans sont toneMapped false (comme spatialUI).

import * as THREE from 'three'
import { PB_COPY, PB_RENDER_ORDER } from '@/lib/majorelle/perfumeConfig'
import { BRAND, ensureBrandFonts } from '@/lib/majorelle/brand'

const TAU = Math.PI * 2
// charte de l'affiche
const INK = BRAND.ink, GOLD = BRAND.gold, GOLD_DEEP = BRAND.goldDeep, GOLD_LIGHT = BRAND.goldLight, IVORY = BRAND.ivory
const GOLD_HI = '#F6E3B0'
const SERIF = BRAND.serif, SANS = BRAND.sans
const INK_RGB = '14,18,52' // encre profonde #0e1234 (bandeau bas de l'affiche)
const IVORY_RGB = '244,230,200'
// émail : encre de l'affiche, reflet cobalt en haut à gauche ; éteint (VAPORISER verrouillé) : encre sourde
const ENAMEL = {
  on: ['#33449e', INK, '#0b0e2c'],
  off: ['#202a66', '#141b4c', '#090b24'],
}
const easeOutBack = (x) => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3)

const RO_SHOCK = PB_RENDER_ORDER.shock // 18 : onde de choc, anneau fantôme
const RO_UI = PB_RENDER_ORDER.ui // 19 : halos additifs (toujours AVANT les disques : le tri par profondeur d'un InstancedMesh
//                                   se fait sur la sphère englobante de ses instances, donc ambigu)
const RO_DISC = RO_UI + 0.5 // 19,5 : disques des lunettes, médaillons
const RO_TOP = RO_UI + 1 // 20 : jantes d'or, cartel, anneaux de progression / maintien

// ---- gabarits (unités marqueur) -------------------------------------------------------
// lunettes : plan canvas = disque (haut) + libellé (1 ou 2 lignes) dessous
const BEZ = {
  dx: 0.15, dy: -0.262, ddy: 0.013, dz: 0.07, ddz: -0.02,
  rimR: 0.026, rimTube: 0.0025, discR: 0.0238,
  planeW: 0.184, planeH: 0.124, top: 0.034, label1: 0.0815, lineGap: 0.0262,
  label: 0.0224, labelMin: 0.0196, labelMaxW: 0.148, px: 3600,
  haloS: 0.12, hitW: 0.138, hitH: 0.112, hitY: -0.019, // cible disque + libellé : 0,138 × 0,112 (écart des lunettes 0,15)
}
BEZ.planeOff = BEZ.top - BEZ.planeH / 2 // décalage vertical du centre du plan par rapport au centre du disque
// médaillons : émail Ø 0,092, libellé SOUS le disque entre deux filets d'or
const MED = {
  dx: -0.33, ySpray: 0.115, yReturn: -0.025,
  rE: 0.046, planeW: 0.27, planeH: 0.142, top: 0.056, labelY: 0.1255, label: 0.0236, labelMin: 0.021, px: 3600,
  haloS: 0.2, hitW: 0.15, hitH: 0.135, hitTop: 0.05, // cible disque + libellé, sans recouvrir RANGER
}
MED.planeOff = MED.top - MED.planeH / 2
MED.ringR = MED.rE * 0.965 // filet d'or principal du médaillon = la piste de l'anneau de progression
MED.ringW = MED.rE * 0.05
MED.holdR = MED.rE * 0.76 // sur l'émail, entre le filet intérieur et l'icône (contraste)
// cartel : bloc-titre de l'affiche (tailles en unités marqueur ; nom ≥ 0,042 ≈ 11 pt à la distance par défaut)
const CART = {
  dx: 0.375, dy: 0.072, dz: -0.02, w: 0.44, h: 0.32, px: 1280,
  maxW: 0.405,
  brand: 0.0205, name: 0.0465, type: 0.0178, italic: 0.0315, italicMin: 0.024, tag: 0.0192, tagMin: 0.0168, disc: 0.0166, discMin: 0.0150,
}

// ---- canvas (copiés de lib/ysl/spatialUI.js, puis adaptés) ---------------------------------
function canvasPlane(w, h, px) {
  const c = document.createElement('canvas')
  c.width = px; c.height = Math.round(px * h / w)
  const ctx = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
  mesh.renderOrder = 20
  return { mesh, ctx, tex, W: c.width, H: c.height }
}

// variante à 2 états empilés dans la même texture (état 0 en haut, état 1 en bas) : bascule = offset d'UV,
// donc aucun redessin ni téléversement au moment du coup
function stackedPlane(w, h, px) {
  const c = document.createElement('canvas')
  const Hs = Math.round(px * h / w), gap = 8
  c.width = px; c.height = Hs * 2 + gap
  const ctx = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.repeat.set(1, Hs / c.height)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
  mesh.renderOrder = RO_DISC
  const setState = (lit) => { tex.offset.y = lit ? 0 : (Hs + gap) / c.height }
  setState(false)
  return { mesh, ctx, tex, W: c.width, H: Hs, Hs, gap, setState }
}

// ---- typographie ----------------------------------------------------------------------------
const charW = (ctx, ch, size) => (ch === '·' ? size * 0.42 : ctx.measureText(ch).width)
const textWidth = (ctx, text, spacingPx, size = 0) => {
  const chars = [...text]
  return chars.reduce((a, ch) => a + charW(ctx, ch, size), 0) + spacingPx * Math.max(0, chars.length - 1)
}
// plus grande taille ≤ size (px) pour laquelle le texte tient dans maxW
function fitSize(ctx, text, fontFn, size, maxW, spacingEm = 0) {
  let s = size
  for (let k = 0; k < 40; k++) {
    ctx.font = fontFn(s)
    if (textWidth(ctx, text, s * spacingEm, s) <= maxW) return s
    s *= 0.97
  }
  return s
}
// réduit d'abord l'interlettrage (jusqu'à 40 %), puis la taille, sans descendre sous minPx → { size, spacing, fits }
function fitSpaced(ctx, text, fontFn, size, minPx, maxW, spacingEm) {
  for (let sp = spacingEm; sp >= spacingEm * 0.4 - 1e-6; sp -= spacingEm * 0.1) {
    ctx.font = fontFn(size)
    if (textWidth(ctx, text, size * sp, size) <= maxW) return { size, spacing: sp, fits: true }
  }
  const sp = spacingEm * 0.4
  const s = fitSize(ctx, text, fontFn, size, maxW, sp)
  return { size: Math.max(minPx, s), spacing: sp, fits: s >= minPx }
}
const capHeight = (ctx, size) => {
  const m = ctx.measureText('H')
  return m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : size * 0.7
}
// texte centré en (x, yMid = milieu des capitales), interlettré lettre à lettre (canvas n'a pas de letter-spacing
// fiable partout) ; « · » devient un point d'or (comme le bandeau de l'affiche) ; halo = ombre d'encre seule
// (tracée hors champ puis décalée : la lettre n'est peinte qu'une fois, nette) → renvoie la largeur
function spaced(ctx, text, x, yMid, spacingEm, o = {}) {
  const size = parseFloat(ctx.font.match(/(\d+(\.\d+)?)px/)[1])
  const sp = size * spacingEm
  const chars = [...text]
  const total = textWidth(ctx, text, sp, size)
  const cap = o.cap || capHeight(ctx, size)
  const base = yMid + cap / 2
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  const run = (dx) => {
    let cx = x - total / 2
    for (const ch of chars) {
      const w = charW(ctx, ch, size)
      if (ch === '·') { ctx.beginPath(); ctx.arc(cx + w / 2 + dx, yMid, size * (o.dotR || 0.095), 0, TAU); ctx.fill() }
      else if (ch !== ' ') {
        ctx.fillText(ch, cx + dx, base)
        if (o.boost) ctx.strokeText(ch, cx + dx, base)
      }
      cx += w + sp
    }
  }
  if (o.halo) {
    ctx.save()
    const OFF = 20000
    ctx.shadowColor = o.halo.color; ctx.shadowBlur = o.halo.blur; ctx.shadowOffsetX = -OFF; ctx.shadowOffsetY = 0
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'
    for (let k = 0; k < (o.halo.passes || 1); k++) run(OFF)
    ctx.restore()
  }
  ctx.fillStyle = o.color || ctx.fillStyle
  if (o.boost) { ctx.strokeStyle = o.color; ctx.lineWidth = size * o.boost; ctx.lineJoin = 'round' }
  // points d'or : couleur propre
  if (o.dotColor && chars.includes('·')) {
    const keep = ctx.fillStyle
    let cx = x - total / 2
    for (const ch of chars) {
      const w = charW(ctx, ch, size)
      if (ch === '·') { ctx.fillStyle = o.dotColor; ctx.beginPath(); ctx.arc(cx + w / 2, yMid, size * (o.dotR || 0.095), 0, TAU); ctx.fill() }
      else if (ch !== ' ') {
        ctx.fillStyle = keep; ctx.fillText(ch, cx, base)
        if (o.boost) ctx.strokeText(ch, cx, base)
      }
      cx += w + sp
    }
    ctx.fillStyle = keep
  } else run(0)
  return total
}
// filet d'or ; halo (px) > 0 : ombre d'encre diffuse dessous (lisible sur le zellige comme sur le mur)
const hairline = (ctx, x0, x1, y, w, color, halo = 0) => {
  ctx.save(); ctx.lineCap = 'butt'
  if (halo > 0) {
    const OFF = 20000
    ctx.save(); ctx.shadowColor = `rgba(${INK_RGB},0.85)`; ctx.shadowBlur = halo; ctx.shadowOffsetX = -OFF
    ctx.strokeStyle = '#000'; ctx.lineWidth = w * 1.6
    ctx.beginPath(); ctx.moveTo(x0 + OFF, y); ctx.lineTo(x1 + OFF, y); ctx.stroke(); ctx.restore()
  }
  ctx.strokeStyle = color; ctx.lineWidth = w
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore()
}
// rampe douce (smoothstep) 0 → a → 0 sur les bords [0, f] et [1 − f, 1]
function ramp(g, rgb, a, f) {
  const N = 10
  for (let k = 0; k <= N; k++) {
    const t = k / N, s = t * t * (3 - 2 * t)
    const c = `rgba(${rgb},${(a * s).toFixed(4)})`
    g.addColorStop(t * f, c); g.addColorStop(1 - t * f, c)
  }
}
// voile d'encre diffus (pas de cartouche) : produit de deux rampes douces — à tracer EN PREMIER sur un canvas vide
function featherVeil(ctx, x0, y0, x1, y1, fx, fy, rgb, a) {
  ctx.save()
  const gv = ctx.createLinearGradient(0, y0, 0, y1)
  ramp(gv, rgb, a, fy)
  ctx.fillStyle = gv; ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.globalCompositeOperation = 'destination-in'
  const gh = ctx.createLinearGradient(x0, 0, x1, 0)
  ramp(gh, '0,0,0', 1, fx)
  ctx.fillStyle = gh; ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.restore()
}
// voile elliptique très doux sous un libellé (complète le halo des lettres sur un fond chargé)
function softEllipse(ctx, cx, cy, rx, ry, rgb, a) {
  ctx.save()
  ctx.translate(cx, cy); ctx.scale(rx / ry, 1)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry)
  for (let k = 0; k <= 8; k++) { const t = k / 8; const s = 1 - t * t * (3 - 2 * t); g.addColorStop(t, `rgba(${rgb},${(a * s).toFixed(4)})`) }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, TAU); ctx.fill()
  ctx.restore()
}
const inkHalo = (size, k = 1) => ({ color: `rgba(${INK_RGB},${(0.9 * k).toFixed(3)})`, blur: size * 0.5, passes: 2 })

// libellé de bijou : capitales Montserrat espacées, ivoire, halo d'encre ; filets d'or de part et d'autre (rule > 0)
// ou filet d'or court dessous (under) ; renvoie la largeur du texte
function drawJewelLabel(ctx, lines, cx, y1, lineGap, sizePx, minPx, maxW, o = {}) {
  const fontFn = (s) => `600 ${s}px ${SANS}`
  const sp0 = o.spacing ?? 0.24
  // taille commune à toutes les lignes
  let size = sizePx, spacing = sp0
  for (const l of lines) {
    const f = fitSpaced(ctx, l, fontFn, size, minPx, maxW - (o.rule ? 2 * (o.rule + o.ruleGap) : 0), spacing)
    size = Math.min(size, f.size); spacing = Math.min(spacing, f.spacing)
  }
  ctx.font = fontFn(size)
  const cap = capHeight(ctx, size)
  let wMax = 0
  for (const l of lines) wMax = Math.max(wMax, textWidth(ctx, l, size * spacing, size))
  const yLast = y1 + lineGap * (lines.length - 1)
  if (o.veil) softEllipse(ctx, cx, (y1 + yLast) / 2, wMax / 2 + size * 1.3, (yLast - y1) / 2 + size * 1.25, INK_RGB, o.veil)
  lines.forEach((l, k) => {
    const y = y1 + lineGap * k
    ctx.font = fontFn(size)
    spaced(ctx, l, cx, y, spacing, { color: o.color || IVORY, halo: inkHalo(size, o.haloK ?? 1), cap })
  })
  if (o.rule) { // filets d'or de part et d'autre (comme « — EAU DE PARFUM — »)
    const hw = textWidth(ctx, lines[0], size * spacing, size) / 2
    const lw = Math.max(1.5, size * 0.075)
    hairline(ctx, cx - hw - o.ruleGap - o.rule, cx - hw - o.ruleGap, y1, lw, o.ruleColor || GOLD, size * 0.2)
    hairline(ctx, cx + hw + o.ruleGap, cx + hw + o.ruleGap + o.rule, y1, lw, o.ruleColor || GOLD, size * 0.2)
  }
  if (o.under) hairline(ctx, cx - o.under / 2, cx + o.under / 2, yLast + cap * 0.5 + size * 0.6, Math.max(1.5, size * 0.09), o.ruleColor || GOLD, size * 0.2)
  return { size, spacing, wMax }
}

// ---- bijou : émail encre guilloché ------------------------------------------------------------
function goldGrad(ctx, cx, cy, r) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  g.addColorStop(0, GOLD_HI); g.addColorStop(0.45, GOLD); g.addColorStop(0.8, GOLD_DEEP); g.addColorStop(1, '#C9A45C')
  return g
}
function enamel(ctx, cx, cy, r, tones, o = {}) {
  // ombre portée très douce (détache le bijou du mur jaune comme du jardin)
  ctx.save()
  ctx.shadowColor = `rgba(${INK_RGB},0.55)`; ctx.shadowBlur = r * 0.32; ctx.shadowOffsetY = r * 0.06
  ctx.fillStyle = tones[2]; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
  ctx.restore()
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.38, r * 0.04, cx, cy, r)
  g.addColorStop(0, tones[0]); g.addColorStop(0.55, tones[1]); g.addColorStop(1, tones[2])
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
  // guilloché : rayons fins d'or, presque invisibles (relief du bijou, pas un motif)
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.clip()
  ctx.strokeStyle = `rgba(232,207,152,${o.guilloche ?? 0.07})`; ctx.lineWidth = Math.max(1, r * 0.012)
  ctx.beginPath()
  for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU; ctx.moveTo(cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.18); ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8) }
  ctx.stroke()
  ctx.restore()
  // reflet d'émail (arc clair en haut à gauche)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke()
  ctx.restore()
}

// ---- icônes au trait (u = unité de dessin) --------------------------------------------------
function iconBlossom(ctx, cx, cy, u) { // fleur d'oranger : 5 pétales cireux, cœur et étamines
  for (let k = 0; k < 5; k++) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(k * TAU / 5)
    ctx.beginPath(); ctx.moveTo(0, -0.2 * u)
    ctx.bezierCurveTo(0.46 * u, -0.4 * u, 0.34 * u, -0.98 * u, 0, -1.02 * u)
    ctx.bezierCurveTo(-0.34 * u, -0.98 * u, -0.46 * u, -0.4 * u, 0, -0.2 * u)
    ctx.stroke(); ctx.restore()
  }
  ctx.beginPath(); ctx.arc(cx, cy, 0.13 * u, 0, TAU); ctx.fill()
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k + 0.5) * TAU / 5
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 0.36 * u, cy + Math.sin(a) * 0.36 * u, 0.06 * u, 0, TAU); ctx.fill()
  }
}
function iconLily(ctx, cx, cy, u, fill) { // nénuphar : coupe de pétales pointus posée sur l'eau
  const by = cy + 0.36 * u
  const petal = (L, w, ang) => {
    ctx.save(); ctx.translate(cx, by); ctx.rotate(ang)
    ctx.beginPath(); ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(w, -L * 0.5, 0, -L); ctx.quadraticCurveTo(-w, -L * 0.5, 0, 0)
    ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); ctx.restore()
  }
  petal(0.78 * u, 0.34 * u, -1.08); petal(0.78 * u, 0.34 * u, 1.08)
  petal(0.96 * u, 0.32 * u, -0.48); petal(0.96 * u, 0.32 * u, 0.48)
  petal(1.12 * u, 0.32 * u, 0)
  ctx.beginPath(); ctx.moveTo(cx - 0.98 * u, by + 0.12 * u); ctx.lineTo(cx + 0.98 * u, by + 0.12 * u)
  ctx.moveTo(cx - 0.52 * u, by + 0.36 * u); ctx.lineTo(cx + 0.52 * u, by + 0.36 * u); ctx.stroke()
}
function iconCone(ctx, cx, cy, u, lw) { // cône de cèdre de l'Atlas : tonnelet dressé, écailles croisées, rameau
  const ey = cy - 0.12 * u, rx = 0.5 * u, ry = 0.76 * u
  ctx.save()
  ctx.beginPath(); ctx.ellipse(cx, ey, rx, ry, 0, 0, TAU); ctx.clip()
  ctx.lineWidth = lw * 0.6
  ctx.beginPath()
  for (let k = -4; k <= 4; k++) {
    const o = k * 0.32 * u
    ctx.moveTo(cx - rx, ey + o - 0.42 * u); ctx.lineTo(cx + rx, ey + o + 0.42 * u)
    ctx.moveTo(cx - rx, ey + o + 0.42 * u); ctx.lineTo(cx + rx, ey + o - 0.42 * u)
  }
  ctx.stroke(); ctx.restore()
  ctx.beginPath(); ctx.ellipse(cx, ey, rx, ry, 0, 0, TAU); ctx.stroke()
  const sy = ey + ry
  ctx.beginPath(); ctx.moveTo(cx, sy); ctx.lineTo(cx, sy + 0.24 * u)
  ctx.moveTo(cx, sy + 0.12 * u); ctx.lineTo(cx - 0.44 * u, sy + 0.02 * u)
  ctx.moveTo(cx, sy + 0.12 * u); ctx.lineTo(cx + 0.44 * u, sy + 0.02 * u)
  ctx.moveTo(cx, sy + 0.2 * u); ctx.lineTo(cx - 0.36 * u, sy + 0.28 * u)
  ctx.moveTo(cx, sy + 0.2 * u); ctx.lineTo(cx + 0.36 * u, sy + 0.28 * u)
  ctx.stroke()
}
// flacon BLEU INTERDIT (corps en arc outrepassé, col, capot) + brume de 3 gouttes
function iconAtomiser(ctx, cx, cy, u) {
  const bx = cx - 0.3 * u, by = cy + 0.22 * u
  // corps : arc outrepassé (le même que la porte et le flacon)
  const hw = 0.62 * u, top = by - 0.62 * u, base = by + 0.98 * u
  ctx.beginPath()
  ctx.moveTo(bx - hw, base); ctx.lineTo(bx - hw, by + 0.05 * u)
  ctx.bezierCurveTo(bx - hw * 1.28, by - 0.38 * u, bx - 0.4 * u, top, bx, top)
  ctx.bezierCurveTo(bx + 0.4 * u, top, bx + hw * 1.28, by - 0.38 * u, bx + hw, by + 0.05 * u)
  ctx.lineTo(bx + hw, base); ctx.closePath(); ctx.stroke()
  // heurtoir (anneau) sur la face
  ctx.beginPath(); ctx.arc(bx, by + 0.3 * u, 0.2 * u, 0, TAU); ctx.stroke()
  // col + capot
  ctx.beginPath(); ctx.moveTo(bx - 0.14 * u, top); ctx.lineTo(bx - 0.14 * u, top - 0.14 * u); ctx.lineTo(bx + 0.14 * u, top - 0.14 * u); ctx.lineTo(bx + 0.14 * u, top); ctx.stroke()
  const cw = 0.27 * u, ct = top - 0.62 * u, cb = top - 0.16 * u
  ctx.beginPath(); ctx.moveTo(bx - cw, cb); ctx.lineTo(bx - cw, ct); ctx.lineTo(bx + cw, ct); ctx.lineTo(bx + cw, cb); ctx.closePath(); ctx.stroke()
  // brume : trois gouttes en éventail depuis la buse
  const nx = bx + cw + 0.22 * u, ny = ct + 0.2 * u
  for (let k = -1; k <= 1; k++) {
    const a = -0.12 + k * 0.42
    ctx.beginPath(); ctx.arc(nx + Math.cos(a) * 0.62 * u, ny + Math.sin(a) * 0.62 * u, 0.1 * u, 0, TAU); ctx.fill()
  }
  ctx.beginPath(); ctx.arc(nx + 0.2 * u, ny, 0.055 * u, 0, TAU); ctx.fill()
}
// ranger : demi-tour qui redescend vers l'eau (flèche fine) au-dessus d'une ondulation
function iconReturn(ctx, cx, cy, u) {
  const R = 0.5 * u, ay = cy - 0.12 * u
  ctx.beginPath()
  ctx.moveTo(cx + R, cy + 0.5 * u); ctx.lineTo(cx + R, ay)
  ctx.arc(cx, ay, R, 0, Math.PI, true)
  ctx.lineTo(cx - R, cy + 0.42 * u)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - R - 0.26 * u, cy + 0.2 * u); ctx.lineTo(cx - R, cy + 0.48 * u); ctx.lineTo(cx - R + 0.26 * u, cy + 0.2 * u)
  ctx.stroke()
  // ondulation (le bassin)
  const wy = cy + 0.78 * u
  ctx.beginPath()
  ctx.moveTo(cx - 0.9 * u, wy)
  ctx.bezierCurveTo(cx - 0.6 * u, wy - 0.16 * u, cx - 0.3 * u, wy + 0.16 * u, cx, wy)
  ctx.bezierCurveTo(cx + 0.3 * u, wy - 0.16 * u, cx + 0.6 * u, wy + 0.16 * u, cx + 0.9 * u, wy)
  ctx.stroke()
}

// libellés des lunettes : une ligne si elle tient, sinon coupure au milieu (FLEUR / D'ORANGER)
function bezelLines(ctx, text) {
  const PX = 1
  const fontFn = (s) => `600 ${s}px ${SANS}`
  const f = fitSpaced(ctx, text, fontFn, BEZ.label * 1000 * PX, BEZ.labelMin * 1000, BEZ.labelMaxW * 1000, 0.22)
  if (f.fits && f.size >= BEZ.label * 1000 * 0.96) return [text]
  const words = text.split(' ')
  if (words.length < 2) return [text]
  let best = null
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ')
    const m = Math.max(a.length, b.length)
    if (!best || m < best.m) best = { m, lines: [a, b] }
  }
  return best.lines
}

// ---- lunette de note = bouton d'action (FLEUR / ÉCLOSION / CÈDRE, dans n'importe quel ordre) ----
// à faire : émail encre guilloché, icône au trait IVOIRE pleinement visible (invite au toucher), libellé ivoire ;
// fait : pièce d'or (émail d'or guilloché), icône gravée à l'encre, libellé or clair souligné d'un filet d'or.
const COIN = ['#F8E7B8', '#DDBA70', '#B88B3A'] // or de la pièce (haut-gauche → bord)
function goldCoin(ctx, cx, cy, r) {
  ctx.save()
  ctx.shadowColor = `rgba(${INK_RGB},0.55)`; ctx.shadowBlur = r * 0.32; ctx.shadowOffsetY = r * 0.06
  ctx.fillStyle = COIN[2]; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
  ctx.restore()
  const g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.4, r * 0.04, cx, cy, r)
  g.addColorStop(0, COIN[0]); g.addColorStop(0.5, COIN[1]); g.addColorStop(1, COIN[2])
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.clip()
  ctx.strokeStyle = 'rgba(120,82,24,0.16)'; ctx.lineWidth = Math.max(1, r * 0.012)
  ctx.beginPath()
  for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU; ctx.moveTo(cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.18); ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8) }
  ctx.stroke()
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = 'rgba(255,250,232,0.35)'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke()
  ctx.restore()
}
function drawBezelState(p, i, lit, copy) {
  const { ctx, W, Hs, gap } = p
  const oy = lit ? Hs + gap : 0
  const PX = W / BEZ.planeW
  const cx = W / 2, cy = oy + BEZ.top * PX, rr = BEZ.discR * PX
  ctx.save()
  ctx.beginPath(); ctx.rect(0, oy, W, Hs); ctx.clip()
  ctx.clearRect(0, oy, W, Hs)
  const note = copy.notes[i]
  // libellé (d'abord : son voile passe sous le disque)
  const lines = bezelLines(ctx, note.bezel)
  drawJewelLabel(ctx, lines, cx, oy + BEZ.label1 * PX, BEZ.lineGap * PX, BEZ.label * PX, BEZ.labelMin * PX, BEZ.labelMaxW * PX, {
    color: lit ? GOLD_LIGHT : IVORY, spacing: 0.22, veil: 0.34, haloK: 1,
    under: lit ? 0.03 * PX : 0, ruleColor: GOLD_LIGHT,
  })
  let ink, fill
  if (!lit) {
    enamel(ctx, cx, cy, rr, ENAMEL.on, { guilloche: 0.08 })
    ctx.strokeStyle = 'rgba(201,164,92,0.6)'; ctx.lineWidth = rr * 0.03
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.84, 0, TAU); ctx.stroke()
    ink = IVORY; fill = ENAMEL.on[1]
  } else {
    goldCoin(ctx, cx, cy, rr)
    ctx.strokeStyle = `rgba(${INK_RGB},0.4)`; ctx.lineWidth = rr * 0.03
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.84, 0, TAU); ctx.stroke()
    ink = INK; fill = COIN[1]
  }
  ctx.strokeStyle = ink; ctx.fillStyle = ink
  const lw = rr * 0.075
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const u = rr * 0.6
  if (i === 0) iconBlossom(ctx, cx, cy, u)
  else if (i === 1) iconLily(ctx, cx, cy, u, fill)
  else iconCone(ctx, cx, cy, u, lw)
  ctx.restore()
  p.tex.needsUpdate = true
}

// ---- médaillon (copié de spatialUI.drawMedallion, adapté : bijou, icône centrée, libellé SOUS le disque) ----
// state : 'on' (libre / RANGER) | 'off' (VAPORISER verrouillé : émail éteint, icône voilée, filet d'or = piste)
function drawMedallion(p, label, icon, state, oy = 0) {
  const { ctx, W } = p
  const H = p.Hs || p.H
  const PX = W / MED.planeW
  const cx = W / 2, cy = oy + MED.top * PX, r = MED.rE * PX
  const on = state !== 'off'
  ctx.save()
  ctx.beginPath(); ctx.rect(0, oy, W, H); ctx.clip()
  ctx.clearRect(0, oy, W, H)
  drawJewelLabel(ctx, [label], cx, oy + MED.labelY * PX, 0, MED.label * PX, MED.labelMin * PX, W * 0.97, {
    color: on ? IVORY : `rgba(${IVORY_RGB},0.8)`, spacing: 0.3, veil: 0.36,
    rule: 0.02 * PX, ruleGap: 0.009 * PX, ruleColor: on ? GOLD_LIGHT : 'rgba(201,164,92,0.75)',
  })
  enamel(ctx, cx, cy, r, on ? ENAMEL.on : ENAMEL.off, { guilloche: on ? 0.08 : 0.05 })
  // double filet d'or : anneau principal (= piste de progression) + filet extérieur fin + filet intérieur
  const ring = goldGrad(ctx, cx, cy, r)
  ctx.save()
  ctx.globalAlpha = on ? 1 : 0.4
  ctx.strokeStyle = ring; ctx.lineWidth = MED.ringW * PX
  ctx.beginPath(); ctx.arc(cx, cy, MED.ringR * PX, 0, TAU); ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = on ? 'rgba(232,207,152,0.85)' : 'rgba(201,164,92,0.45)'; ctx.lineWidth = r * 0.016
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.075, 0, TAU); ctx.stroke()
  ctx.strokeStyle = on ? 'rgba(201,164,92,0.75)' : 'rgba(201,164,92,0.35)'; ctx.lineWidth = r * 0.014
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.84, 0, TAU); ctx.stroke()
  // icône
  ctx.save()
  ctx.globalAlpha = on ? 1 : 0.5
  const ig = on ? goldGrad(ctx, cx, cy, r * 0.6) : GOLD
  ctx.strokeStyle = ig; ctx.fillStyle = ig; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (icon === 'spray') iconAtomiser(ctx, cx, cy, r * 0.42)
  else iconReturn(ctx, cx, cy, r * 0.5)
  ctx.restore()
  ctx.restore()
  p.tex.needsUpdate = true
}

// ---- cartel ------------------------------------------------------------------------------
// mode : -1 = base (Eau de Parfum), 0..2 = note, 3 = final. Composition de l'affiche, voile d'encre diffus.
function drawCartel(p, mode, copy, noteEm) {
  const { ctx, W, H } = p
  const PX = W / CART.w
  const cx = W / 2, maxW = CART.maxW * PX
  ctx.clearRect(0, 0, W, H)
  const sans = (wt) => (z) => `${wt} ${z}px ${SANS}`
  const serif = (z) => `400 ${z}px ${SERIF}`
  const italic = (z) => `italic 400 ${z}px ${SERIF}`
  const sizes = {}

  // -- mise en page (y en unités marqueur depuis le haut) --
  let italicLine = '', tagText = ''
  if (mode >= 0 && mode <= 2) { const n = copy.notes[mode]; italicLine = `${n.num} · ${n.name}`; tagText = n.tag }
  else if (mode === 3) { italicLine = copy.final.line; tagText = copy.final.notes }
  const Y = { brand: 0.036, name: 0.081, type: 0.1235 }
  // ligne de petites capitales : une ligne si elle tient, sinon deux (coupure au « · » le plus central)
  let tagLines = []
  let tagFit = null
  if (tagText) {
    tagFit = fitSpaced(ctx, tagText, sans(500), CART.tag * PX, CART.tagMin * PX, maxW, 0.26)
    if (tagFit.fits) tagLines = [tagText]
    else {
      const parts = tagText.split(' · ')
      let best = null
      for (let k = 1; k < parts.length; k++) {
        const a = parts.slice(0, k).join(' · '), b = parts.slice(k).join(' · ')
        const m = Math.max(a.length, b.length)
        if (!best || m < best.m) best = { m, lines: [a, b] }
      }
      tagLines = best ? best.lines : [tagText]
      tagFit = null
    }
  }
  const discLines = (() => { // mention en petites capitales, sur deux lignes comme « ON NE L'OUVRE PAS / ON FRAPPE »
    const t = copy.final.disclaimer.toUpperCase()
    const w = t.split(' ')
    const k = Math.ceil(w.length / 2)
    return [w.slice(0, k).join(' '), w.slice(k).join(' ')].filter(Boolean)
  })()
  let y = Y.type
  const L = {}
  if (italicLine) {
    L.italic = y + 0.045
    L.rule = L.italic + 0.0265
    L.tag = L.rule + 0.0215
    y = L.tag + 0.0235 * (tagLines.length - 1)
    L.disc = y + 0.0385
  } else {
    L.disc = y + 0.0465
  }
  const bottom = L.disc + 0.0205 * (discLines.length - 1) + 0.03
  p.contentH = bottom

  // -- voile d'encre (bandeau bas de l'affiche), très diffus : aucun bord visible --
  featherVeil(ctx, 0, 0, W, Math.min(H, (bottom + 0.012) * PX), 0.2, 0.2, INK_RGB, 0.6)

  // -- bloc-titre --
  const brandF = fitSpaced(ctx, copy.cartel.brand, sans(500), CART.brand * PX, CART.brand * PX * 0.85, maxW * 0.86, 0.42)
  ctx.font = sans(500)(brandF.size)
  spaced(ctx, copy.cartel.brand, cx, Y.brand * PX, brandF.spacing, { color: IVORY, halo: inkHalo(brandF.size) })
  sizes.brand = brandF.size

  const nameF = fitSpaced(ctx, copy.cartel.name, serif, CART.name * PX, CART.name * PX * 0.85, maxW, 0.035)
  ctx.font = serif(nameF.size)
  spaced(ctx, copy.cartel.name, cx, Y.name * PX, nameF.spacing, { color: IVORY, halo: inkHalo(nameF.size, 0.85), boost: 0.012 })
  sizes.name = nameF.size

  // — EAU DE PARFUM — entre deux filets d'or
  const typeText = copy.cartel.type.toUpperCase()
  const typeF = fitSpaced(ctx, typeText, sans(500), CART.type * PX, CART.type * PX * 0.9, maxW * 0.6, 0.55)
  ctx.font = sans(500)(typeF.size)
  const tw = spaced(ctx, typeText, cx, Y.type * PX, typeF.spacing, { color: IVORY, halo: inkHalo(typeF.size) })
  const rl = 0.046 * PX, rg = 0.018 * PX, lw = Math.max(1.5, 0.0014 * PX)
  hairline(ctx, cx - tw / 2 - rg - rl, cx - tw / 2 - rg, Y.type * PX, lw, GOLD, typeF.size * 0.4)
  hairline(ctx, cx + tw / 2 + rg, cx + tw / 2 + rg + rl, Y.type * PX, lw, GOLD, typeF.size * 0.4)
  sizes.type = typeF.size

  // -- corps : italique Bodoni or clair, filet d'or, petites capitales à points d'or --
  if (italicLine) {
    ctx.font = italic(noteEm * PX)
    spaced(ctx, italicLine, cx, L.italic * PX, 0.01, { color: GOLD_LIGHT, halo: inkHalo(noteEm * PX), dotColor: GOLD, dotR: 0.075, boost: 0.01 })
    sizes.note = noteEm * PX
    hairline(ctx, cx - 0.026 * PX, cx + 0.026 * PX, L.rule * PX, lw, GOLD)
    let ts = CART.tag * PX, tsp = 0.26
    if (tagFit) { ts = tagFit.size; tsp = tagFit.spacing }
    else for (const l of tagLines) { const f = fitSpaced(ctx, l, sans(500), ts, CART.tagMin * PX, maxW, tsp); ts = Math.min(ts, f.size); tsp = Math.min(tsp, f.spacing) }
    ctx.font = sans(500)(ts)
    tagLines.forEach((l, k) => spaced(ctx, l, cx, (L.tag + 0.0235 * k) * PX, tsp, { color: IVORY, halo: inkHalo(ts), dotColor: GOLD }))
    sizes.tag = ts
  } else {
    hairline(ctx, cx - 0.026 * PX, cx + 0.026 * PX, (Y.type + 0.024) * PX, lw, GOLD)
  }
  // mention (petites capitales ivoire à 72 %, comme le bas de l'affiche)
  let ds = CART.disc * PX, dsp = 0.24
  for (const l of discLines) { const f = fitSpaced(ctx, l, sans(500), ds, CART.discMin * PX, maxW * 0.8, dsp); ds = Math.min(ds, f.size); dsp = Math.min(dsp, f.spacing) }
  ctx.font = sans(500)(ds)
  discLines.forEach((l, k) => spaced(ctx, l, cx, (L.disc + 0.0205 * k) * PX, dsp, { color: `rgba(${IVORY_RGB},0.8)`, halo: inkHalo(ds) }))
  sizes.disclaimer = ds
  p.sizes = sizes // en px du canvas (débogage) ; × CART.w / W = unités marqueur
  p.tex.needsUpdate = true
}

// ---- matériaux d'anneaux (shaders) : alpha prémultiplié (ONE, ONE_MINUS_SRC_ALPHA) = anneau d'or opaque
// (l'or reste or sur le flacon cobalt comme sur le mur jaune) + halo émis additif, en un seul passage ----
const RING_VS = /* glsl */`
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

// composition « par-dessus » de couches non prémultipliées : acc = (couleur prémultipliée, alpha)
const OVER_GLSL = /* glsl */`
void over(inout vec4 acc, vec3 c, float a) { acc.rgb = c * a + acc.rgb * (1.0 - a); acc.a = a + acc.a * (1.0 - a); }`

// anneau en arc (progression / maintien) : arc rempli dans le sens horaire depuis midi + tête brillante (+ piste optionnelle)
const ARC_FS = /* glsl */`
uniform float uProgress, uR, uW, uOpacity, uTrack, uGlow, uFlash;
uniform vec3 uColor, uHot;
varying vec2 vP;
${OVER_GLSL}
void main() {
  float r = length(vP);
  float px = fwidth(r);
  float d = abs(r - uR);
  float core = 1.0 - smoothstep(uW * 0.5 - px, uW * 0.5 + px, d);
  float glow = exp(-d * d / (uW * uW * 2.5));
  float a = atan(vP.x, vP.y);
  float f = (a < 0.0 ? a + 6.2831853 : a) / 6.2831853;
  float fa = 1.5 * px / (6.2831853 * max(r, 1e-5));
  float on = uProgress >= 0.999 ? 1.0 : (1.0 - smoothstep(uProgress - fa, uProgress + fa, f)) * step(0.0005, uProgress);
  float dh = f - uProgress;
  float head = (uProgress > 0.0005 && uProgress < 0.999) ? exp(-dh * dh * 1600.0) : 0.0;
  float hot = clamp(head * 1.5 + uFlash, 0.0, 1.0);
  vec4 acc = vec4(0.0);
  over(acc, uColor * 0.55, (1.0 - on) * core * uTrack);
  over(acc, mix(uColor, uHot, 0.3 + 0.7 * hot), clamp((on + head) * core, 0.0, 1.0));
  vec3 emis = uColor * (on * uGlow + head * 0.6 + uFlash * 0.8) * glow * (1.0 - acc.a) * 0.6;
  gl_FragColor = vec4(acc.rgb + emis, acc.a) * clamp(uOpacity, 0.0, 1.0); // alpha prémultiplié
}`

// anneau d'onde (choc du heurtoir / fantôme) sur un quad [-1, 1]² : filet d'ombre, halo, écho, anneau net, éclat central
const PULSE_FS = /* glsl */`
uniform float uR, uW, uA, uEchoR, uEchoA, uCore, uOpacity;
uniform vec3 uColor, uHot;
varying vec2 vP;
${OVER_GLSL}
void main() {
  float r = length(vP);
  float px = fwidth(r);
  float d = abs(r - uR);
  float ring = 1.0 - smoothstep(uW * 0.5 - px, uW * 0.5 + px, d);
  float glow = exp(-d * d / (uW * uW * 3.0));
  float sh = smoothstep(uW * 0.45, uW * 0.85, d) * (1.0 - smoothstep(uW * 0.85, uW * 1.9, d));
  float de = abs(r - uEchoR);
  float echo = 1.0 - smoothstep(uW * 0.2 - px, uW * 0.2 + px, de);
  float core = exp(-r * r * 60.0) * uCore;
  float edge = 1.0 - smoothstep(0.9, 1.0, r);
  vec4 acc = vec4(0.0);
  over(acc, vec3(0.055, 0.07, 0.2), sh * 0.2 * uA);
  over(acc, mix(uColor, uHot, 0.25), clamp(echo * uEchoA * 1.2, 0.0, 1.0));
  over(acc, mix(uColor, uHot, 0.4), clamp(ring * uA * 1.35, 0.0, 1.0));
  over(acc, uHot, clamp(core * 0.8, 0.0, 1.0));
  vec3 emis = uColor * (glow * 0.45 * uA + core * 0.5) * (1.0 - acc.a);
  gl_FragColor = vec4(acc.rgb + emis, acc.a) * clamp(edge * uOpacity, 0.0, 1.0); // alpha prémultiplié
}`

// uniforme flottant de forme propre : les littéraux { value } partagent une même « map » V8 dont le champ value est
// déjà générique (vecteurs, textures…), donc chaque écriture d'un double y allouerait un HeapNumber
class UNum { constructor(v) { this.value = v + 0.5; this.value = v } }
const GOLD_V = new THREE.Vector3(0.96, 0.78, 0.42), HOT_V = new THREE.Vector3(1.0, 0.93, 0.76)
function arcMaterial(R, W) {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VS, fragmentShader: ARC_FS,
    uniforms: {
      uProgress: new UNum(0), uR: new UNum(R), uW: new UNum(W), uOpacity: new UNum(0), uTrack: new UNum(0),
      uGlow: new UNum(0.2), uFlash: new UNum(0), uColor: { value: GOLD_V.clone() }, uHot: { value: HOT_V.clone() },
    },
    transparent: true, depthWrite: false, premultipliedAlpha: true, // ONE, ONE_MINUS_SRC_ALPHA : or opaque + halo additif
  })
}
function pulseMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VS, fragmentShader: PULSE_FS,
    uniforms: {
      uR: new UNum(0.5), uW: new UNum(0.05), uA: new UNum(0), uEchoR: new UNum(0), uEchoA: new UNum(0), uCore: new UNum(0),
      uOpacity: new UNum(1), uColor: { value: GOLD_V.clone() }, uHot: { value: HOT_V.clone() },
    },
    transparent: true, depthWrite: false, premultipliedAlpha: true,
  })
}

// =========================================================================================
export function createPerfumeUI(anchor, { center = new THREE.Vector3(0.004464, -0.12202, 0.22), copy = PB_COPY, face = 0.5, reducedMotion } = {}) {
  const C = center.clone()
  const rm = reducedMotion ?? (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const AMP = rm ? 0.5 : 1 // amplitude des pulsations (moitié sous mouvement réduit, §5.7)
  const group = new THREE.Group()
  group.name = 'PB_UI'
  group.visible = false
  anchor.add(group)
  const hitables = []
  const disposables = []
  const own = (...xs) => { disposables.push(...xs); return xs[0] }
  let disposed = false

  // ---- textures et matériaux partagés ----------------------------------------------------
  const goldMat = own(new THREE.MeshPhysicalMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.2, envMapIntensity: 1.3, transparent: true, opacity: 0 }))
  const goldBase = goldMat.color.clone()
  const haloTex = own((() => { // copié de spatialUI
    const c = document.createElement('canvas'); c.width = c.height = 128
    const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grd.addColorStop(0, 'rgba(255,226,170,0.8)'); grd.addColorStop(0.35, 'rgba(240,196,120,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  })())
  const hitMat = own(new THREE.MeshBasicMaterial({ visible: false }))
  const hitBezGeo = own(new THREE.PlaneGeometry(BEZ.hitW, BEZ.hitH))
  const hitMedGeo = own(new THREE.PlaneGeometry(MED.hitW, MED.hitH))

  // jantes d'or des 3 lunettes : 1 appel (instancié) ; halos additifs des lunettes + médaillons : 1 appel
  const rims = new THREE.InstancedMesh(own(new THREE.TorusGeometry(BEZ.rimR, BEZ.rimTube, 10, 56)), goldMat, 3)
  rims.renderOrder = RO_TOP; rims.frustumCulled = false
  const haloMat = own(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
  const halos = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1, 1)), haloMat, 5)
  halos.renderOrder = RO_UI; halos.frustumCulled = false
  const _col = new THREE.Color()
  for (let k = 0; k < 5; k++) halos.setColorAt(k, _col.setScalar(0)) // crée instanceColor avant la compilation
  group.add(halos, rims)

  // ---- lunettes de notes ------------------------------------------------------------------
  const bezels = []
  for (let i = 0; i < 3; i++) {
    const u = i - 1
    const node = new THREE.Object3D(); node.rotation.order = 'YXZ'
    const base = new THREE.Vector3(C.x + u * BEZ.dx, C.y + BEZ.dy + BEZ.ddy * u * u, C.z + BEZ.dz + BEZ.ddz * u * u)
    node.position.copy(base)
    const p = stackedPlane(BEZ.planeW, BEZ.planeH, Math.round(BEZ.planeW * BEZ.px))
    own(p.tex, p.mesh.geometry, p.mesh.material)
    p.mesh.position.set(0, BEZ.planeOff, 0)
    const hit = new THREE.Mesh(hitBezGeo, hitMat)
    hit.position.set(0, BEZ.hitY, 0.004)
    hit.userData.ui = { type: 'note', index: i, lit: false }
    node.add(p.mesh, hit)
    group.add(node)
    hitables.push(hit)
    bezels.push({ node, p, hit, base, lit: false, cur: 0, litK: 0, press: 0, pop: -1, swapped: true, flash: 0 })
  }
  const drawBezels = () => { for (let i = 0; i < 3; i++) { drawBezelState(bezels[i].p, i, false, copy); drawBezelState(bezels[i].p, i, true, copy) } }

  // ---- cartel --------------------------------------------------------------------------------
  const cartelNode = new THREE.Object3D(); cartelNode.rotation.order = 'YXZ'
  const cartelBase = new THREE.Vector3(C.x + CART.dx, C.y + CART.dy, C.z + CART.dz)
  cartelNode.position.copy(cartelBase)
  const cartels = [canvasPlane(CART.w, CART.h, CART.px), canvasPlane(CART.w, CART.h, CART.px)]
  cartels.forEach((c) => { c.mesh.renderOrder = RO_TOP; own(c.tex, c.mesh.geometry, c.mesh.material); cartelNode.add(c.mesh) })
  group.add(cartelNode)
  // taille commune de la ligne en italique (unités marqueur) : la plus longue des lignes (notes + final) tient dans la largeur
  let noteEm = CART.italic
  const measureNoteEm = () => {
    const { ctx, W } = cartels[0]
    const PX = W / CART.w
    const lines = [copy.final.line, ...copy.notes.map((n) => `${n.num} · ${n.name}`)]
    let s = CART.italic * PX
    for (const l of lines) s = Math.min(s, fitSize(ctx, l, (z) => `italic 400 ${z}px ${SERIF}`, s, CART.maxW * PX, 0.01))
    noteEm = Math.max(s, CART.italicMin * PX) / PX
  }
  // état numérique animé : champs « double » d'un seul objet (initialisés à des non-entiers pour fixer la
  // représentation) — une variable de fermeture recevant un double allouerait un HeapNumber à chaque image
  const F = { shown: 0.5, clock: 0.5, dim: 0.5, dimTarget: 0.5, progress: 0.5, progressTarget: 0.5, unlockFlash: 0.5, sprayPulse: 0.5,
    holdK: 0.5, holdA: 0.5, holdShown: 0.5, holdRadius: 0.5, strikeT: 0.5, strikeRMax: 0.5, strikeS: 0.5, ghostA: 0.5, ghostPhase: 0.5, cartelFade: 0.5 }
  Object.assign(F, { shown: 0, clock: 0, dim: 1, dimTarget: 1, progress: 0, progressTarget: 0, unlockFlash: 0, sprayPulse: -1,
    holdK: 0, holdA: 0, holdShown: 0, holdRadius: MED.holdR, strikeT: -1, strikeRMax: 0.15, strikeS: 0.2, ghostA: 0, ghostPhase: 0, cartelFade: 1 })
  let front = 0, shownMode = -1, backMode = -1, pendingMode = null
  const startCartel = (mode) => { const back = 1 - front; drawCartel(cartels[back], mode, copy, noteEm); backMode = shownMode; front = back; F.cartelFade = 0; shownMode = mode }
  const requestCartel = (mode) => {
    if (F.cartelFade >= 1) { if (mode !== shownMode) startCartel(mode) } else pendingMode = mode // pas de saut de texte
  }

  // ---- médaillons ---------------------------------------------------------------------------
  const medallion = (id, label, icon, y, haloIndex, twoStates) => {
    const node = new THREE.Object3D(); node.rotation.order = 'YXZ'
    const base = new THREE.Vector3(C.x + MED.dx, C.y + y, C.z)
    node.position.copy(base)
    const p = twoStates ? stackedPlane(MED.planeW, MED.planeH, Math.round(MED.planeW * MED.px)) : canvasPlane(MED.planeW, MED.planeH, Math.round(MED.planeW * MED.px))
    p.mesh.renderOrder = RO_DISC
    own(p.tex, p.mesh.geometry, p.mesh.material)
    p.mesh.position.set(0, MED.planeOff, 0)
    const hit = new THREE.Mesh(hitMedGeo, hitMat)
    hit.position.set(0, MED.hitTop - MED.hitH / 2, 0.004)
    hit.userData.ui = { type: 'action', id, locked: false }
    node.add(p.mesh, hit)
    group.add(node)
    hitables.push(hit)
    const draw = () => {
      if (twoStates) { drawMedallion(p, label, icon, 'off', 0); drawMedallion(p, label, icon, 'on', p.Hs + p.gap) }
      else drawMedallion(p, label, icon, 'on', 0)
    }
    return { node, p, hit, base, id, haloIndex, press: 0, pop: -1, flash: 0, draw }
  }
  const mSpray = medallion('spray', copy.medallions.spray, 'spray', MED.ySpray, 3, true)
  const mReturn = medallion('return', copy.medallions.ret, 'return', MED.yReturn, 4, false)
  const medallions = [mSpray, mReturn]
  // anneau de progression posé sur le filet d'or du médaillon VAPORISER
  const progMat = own(arcMaterial(MED.ringR, MED.ringW * 1.5))
  const progRing = new THREE.Mesh(own(new THREE.RingGeometry(MED.ringR - MED.ringW * 3.2, MED.ringR + MED.ringW * 3.2, 96, 1)), progMat)
  progRing.position.z = 0.0015; progRing.renderOrder = RO_TOP
  mSpray.node.add(progRing)
  // anneau de maintien (séparé) : autour de VAPORISER par défaut, ou au point donné par setHold(k, { at, radius })
  const holdW = 0.005
  const holdMat = own(arcMaterial(MED.holdR, holdW))
  const holdRing = new THREE.Mesh(own(new THREE.RingGeometry(MED.holdR - holdW * 3.5, MED.holdR + holdW * 3.5, 96, 1)), holdMat)
  holdRing.renderOrder = RO_TOP; holdRing.visible = false
  holdRing.rotation.order = 'YXZ'
  holdMat.uniforms.uTrack.value = 0.35; holdMat.uniforms.uGlow.value = 0.6
  holdMat.uniforms.uColor.value.set(1.0, 0.88, 0.6); holdMat.uniforms.uHot.value.set(1.0, 0.97, 0.9)
  group.add(holdRing)

  // ---- onde de choc + anneau fantôme (renderOrder 18, plan du flacon) ------------------------
  const quadGeo = own(new THREE.PlaneGeometry(2, 2))
  const shockMat = own(pulseMaterial())
  const shock = new THREE.Mesh(quadGeo, shockMat)
  shock.renderOrder = RO_SHOCK; shock.visible = false; shock.frustumCulled = false
  const ghostMat = own(pulseMaterial())
  const ghostMesh = new THREE.Mesh(quadGeo, ghostMat)
  ghostMat.uniforms.uColor.value.set(0.98, 0.82, 0.46); ghostMat.uniforms.uHot.value.set(1.0, 0.9, 0.66) // or clair, éthéré
  ghostMesh.renderOrder = RO_SHOCK; ghostMesh.visible = false; ghostMesh.frustumCulled = false
  group.add(shock, ghostMesh)

  // ---- état ------------------------------------------------------------------------------
  let target = 0
  let knocks = 0, note = -1, final = false
  let locked = true, rangerPulse = false
  let holdOn = false, holdAtOn = false
  const holdAt = new THREE.Vector3()
  let ghostOn = false
  const camLocal = new THREE.Vector3()
  let haveCam = false
  const _m = new THREE.Matrix4(), _off = new THREE.Matrix4(), _s = new THREE.Vector3()
  const _Z = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3()

  // dessin complet (au départ avec les polices de repli, puis dès que Bodoni Moda / Montserrat sont là)
  const drawAll = () => {
    if (disposed) return
    measureNoteEm()
    drawBezels()
    mSpray.draw(); mReturn.draw()
    drawCartel(cartels[front], shownMode, copy, noteEm)
    if (F.cartelFade < 1) drawCartel(cartels[1 - front], backMode, copy, noteEm)
  }
  drawAll()
  mSpray.p.setState(!locked)
  let fontTimer = null
  const redrawSoon = () => { if (fontTimer || disposed) return; fontTimer = setTimeout(() => { fontTimer = null; drawAll() }, 60) }
  ensureBrandFonts().then(() => redrawSoon())
  const onFontsDone = (e) => {
    const fams = (e && e.fontfaces) || []
    if (!fams.length || fams.some((f) => /Bodoni|Montserrat/i.test(f.family))) redrawSoon()
  }
  if (typeof document !== 'undefined' && document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', onFontsDone)

  const faceToward = (obj, base, dt) => { // orientation partielle vers la caméra (lisibilité de biais), bornée à ±0,6 rad
    let tx = 0, ty = 0
    if (haveCam && face > 0) {
      const dx = camLocal.x - base.x, dy = camLocal.y - base.y, dz = Math.max(1e-3, camLocal.z - base.z)
      ty = clamp(Math.atan2(dx, dz) * face, -0.6, 0.6)
      tx = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) * face, -0.6, 0.6)
    }
    const k = Math.min(1, dt * 5)
    obj.rotation.x += (tx - obj.rotation.x) * k
    obj.rotation.y += (ty - obj.rotation.y) * k
  }
  const appear = (delay) => easeOutBack(clamp01((F.shown - delay) / (1 - delay)))
  const setLitInstant = (b, lit) => { b.lit = lit; b.p.setState(lit); b.litK = lit ? 1 : 0; b.pop = -1; b.swapped = true }
  const applyDone = (d0, d1, d2) => {
    let n = 0
    for (let i = 0; i < 3; i++) {
      const b = bezels[i]
      const want = (i === 0 ? d0 : i === 1 ? d1 : d2) || final
      if (want && !b.lit) { b.lit = true; b.pop = 0; b.swapped = false } // éclat (le basculement se fait au creux du rebond)
      else if (!want && b.lit) setLitInstant(b, false)
      if (want) n++
    }
    knocks = n
    if (locked) F.progressTarget = n / 3
  }

  const api = {
    group,
    show() { target = 1; group.visible = true },
    hide() { target = 0 },
    isShown: () => target > 0.5,

    /** n coups frappés (0..3) : la lunette n-1 « éclate » du chiffre gravé à l'icône d'or ; l'anneau VAPORISER se remplit d'1/3 par coup. */
    setKnocks(n) {
      n = clamp(Math.round(n), 0, 3)
      applyDone(n > 0, n > 1, n > 2)
    },
    /** lunettes faites : mask = [fleur, éclosion, cèdre] ; éclat sur les nouvelles, extinction des autres ; anneau VAPORISER = compte / 3 (verrouillé). */
    setDone(mask) {
      const m = mask || []
      applyDone(!!m[0], !!m[1], !!m[2])
    },
    /** centre (repère ancre) de la lunette i — pour y poser l'anneau fantôme d'invitation */
    bezelAnchor(i, out = new THREE.Vector3()) {
      const b = bezels[clamp(Math.round(i) || 0, 0, 2)]
      return out.copy(b.base)
    },
    /** cartel de la note i (0..2) ; -1 / null = cartel de base. La lunette i passe « courante ». */
    setNote(i) {
      note = i === null || i === undefined ? -1 : clamp(Math.round(i), -1, 2)
      requestCartel(note)
    },
    /** cartel final (Le secret est à vous…), les trois lunettes allumées, RANGER pulse. */
    setFinal() {
      final = true; rangerPulse = true
      for (let i = 0; i < 3; i++) { const b = bezels[i]; if (!b.lit) { b.lit = true; b.pop = 0; b.swapped = false } }
      requestCartel(3)
    },
    /** { locked, progress (0..1), pulse (impulsion ponctuelle) } */
    setSpray({ locked: l, progress: pr, pulse } = {}) {
      if (typeof l === 'boolean' && l !== locked) {
        locked = l
        mSpray.p.setState(!locked)
        if (!locked) { F.progressTarget = 1; F.unlockFlash = 1; mSpray.pop = 0 } // éclat + anneau d'or complet
        else { F.progressTarget = knocks / 3 }
      }
      if (typeof pr === 'number') F.progressTarget = clamp01(pr)
      if (pulse) { F.sprayPulse = 0; mSpray.flash = 1 }
    },
    /** anneau de maintien : k ∈ [0,1] (null = masqué). Par défaut autour de VAPORISER ; { at, radius } pour le placer ailleurs. */
    setHold(k, opts) {
      if (k === null || k === undefined) { holdOn = false; return }
      holdOn = true; F.holdK = clamp01(k)
      if (opts && opts.at) { holdAtOn = true; holdAt.copy(opts.at); F.holdRadius = opts.radius || MED.holdR } else { holdAtOn = false; F.holdRadius = MED.holdR }
    },
    /** onde de choc dorée au point de frappe (repère ancre) : Ø de 0 à 1,4 × width en 0,5 s, dans le plan du flacon. */
    strike(pointAnchor, width = 0.222, normalAnchor) {
      F.strikeRMax = Math.max(0.01, width * 0.7)
      F.strikeS = F.strikeRMax * 1.22
      shock.position.copy(pointAnchor)
      _n.copy(normalAnchor || _Z).normalize()
      shock.position.addScaledVector(_n, 0.002)
      shock.quaternion.setFromUnitVectors(_Z, _n)
      shock.scale.setScalar(F.strikeS)
      F.strikeT = 0
      shock.visible = true
      group.visible = true
    },
    /** anneau fantôme autour du heurtoir ; peut être rappelé à chaque image pour suivre le flacon. */
    ghost(on, pointAnchor, radius = 0.05) {
      ghostOn = !!on
      if (pointAnchor) { ghostMesh.position.copy(pointAnchor); ghostMesh.position.z += 0.002 }
      ghostMesh.scale.setScalar(radius * 1.9)
      if (ghostOn) group.visible = true
    },
    hit(raycaster) {
      if (!group.visible || F.shown < 0.6) return null
      const h = raycaster.intersectObjects(hitables, false)[0]
      if (!h) return null
      const ui = h.object.userData.ui
      if (ui.type === 'note') ui.lit = bezels[ui.index].lit
      else if (ui.id === 'spray') ui.locked = locked
      return ui
    },
    press(hit) {
      if (!hit) return
      if (hit.type === 'note') { const b = bezels[hit.index]; if (b) { b.press = 1; b.flash = Math.max(b.flash, 0.55) } }
      else { const m = medallions.find((x) => x.id === hit.id); if (m) m.press = 1 }
    },

    // ---- ajouts (hors spec, additifs) -------------------------------------------------------
    /** remet tout à zéro, sans animation (resetToClosed du directeur) */
    reset() {
      knocks = 0; note = -1; final = false; rangerPulse = false
      locked = true; mSpray.p.setState(false); F.progress = F.progressTarget = 0; F.unlockFlash = 0; F.sprayPulse = -1
      holdOn = false; F.holdA = 0; ghostOn = false; F.ghostA = 0; F.strikeT = -1; F.dim = F.dimTarget = 1
      shock.visible = false; ghostMesh.visible = false; holdRing.visible = false
      for (const b of bezels) { setLitInstant(b, false); b.cur = 0; b.flash = 0; b.press = 0 }
      for (const m of medallions) { m.press = 0; m.pop = -1; m.flash = 0 }
      pendingMode = null; drawCartel(cartels[front], -1, copy, noteEm); shownMode = -1; F.cartelFade = 1
    },
    /** atténuation globale (finale : 0,4), lissée */
    setDim(k) { F.dimTarget = clamp01(k) },
    /** compile les programmes + téléverse les textures (tout rendre visible le temps d'un renderer.compile) */
    prewarm(renderer, camera) {
      let root = group; while (root.parent) root = root.parent
      const saved = []
      group.traverse((o) => { saved.push(o.visible); o.visible = true })
      try {
        group.traverse((o) => { const m = o.material; if (m && m.map) renderer.initTexture(m.map) })
        renderer.compile(root, camera)
      } catch (e) { console.warn('[perfumeUI] prewarm', e) }
      let k = 0; group.traverse((o) => { o.visible = saved[k++] })
    },
    /** tailles typographiques du cartel affiché (px canvas et unités marqueur) et sa hauteur H (débogage) */
    _debug: () => {
      const c = cartels[front], k = CART.w / c.W, em = {}
      for (const key in c.sizes || {}) em[key] = +(c.sizes[key] * k).toFixed(4)
      return { cartel: c.sizes, cartelEm: em, cartelH: c.H, noteEm, knocks, done: bezels.map((b) => b.lit), note, final, locked, progress: F.progress }
    },
    /** { drawCalls, triangles } visibles de l'interface (débogage, alloue) */
    stats() {
      let drawCalls = 0, triangles = 0
      if (!group.visible) return { drawCalls, triangles }
      group.traverseVisible((o) => {
        if (!o.isMesh || !o.material || !o.material.visible) return
        const g = o.geometry
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3
        drawCalls += 1; triangles += tris * (o.isInstancedMesh ? o.count : 1)
      })
      return { drawCalls, triangles }
    },

    update(dt, camera) {
      dt = Math.min(dt, 0.1)
      F.clock += dt
      F.shown += (target - F.shown) * Math.min(1, dt * (target ? 3.2 : 5))
      F.dim += (F.dimTarget - F.dim) * Math.min(1, dt * 4)
      const panelOn = !(target === 0 && F.shown < 0.01)
      const fxOn = F.strikeT >= 0 || ghostOn || F.ghostA > 0.002 || F.holdA > 0.002
      group.visible = panelOn || fxOn
      if (!group.visible) return
      haveCam = false
      if (camera && face > 0) {
        group.updateWorldMatrix(true, false)
        camera.getWorldPosition(camLocal); group.worldToLocal(camLocal); haveCam = true
      }
      const breath = 0.5 + 0.5 * Math.sin(F.clock * TAU / 1.6) // 0,625 Hz (< 3 Hz)

      // -- panneau (lunettes, cartel, médaillons) --
      rims.visible = halos.visible = cartelNode.visible = panelOn
      for (let i = 0; i < 3; i++) bezels[i].node.visible = panelOn
      for (let i = 0; i < 2; i++) medallions[i].node.visible = panelOn
      if (panelOn) {
        goldMat.opacity = clamp01(F.shown * 1.4)
        goldMat.color.copy(goldBase).multiplyScalar(0.35 + 0.65 * F.dim)
        for (let i = 0; i < 3; i++) {
          const b = bezels[i]
          b.cur += (((i === note && note >= 0) || final ? 1 : 0) - b.cur) * Math.min(1, dt * 6)
          b.press = Math.max(0, b.press - dt * 4)
          b.flash = Math.max(0, b.flash - dt * 1.8)
          b.litK += ((b.lit && b.swapped ? 1 : 0) - b.litK) * Math.min(1, dt * 6)
          let popS = 1
          if (b.pop >= 0) {
            b.pop += dt / 0.5
            const p = b.pop
            if (p >= 0.12 && !b.swapped) { b.swapped = true; b.p.setState(true); b.flash = 1 }
            popS = p < 0.12 ? 1 - 0.22 * (p / 0.12) : 0.78 + 0.22 * easeOutBack(clamp01((p - 0.12) / 0.88))
            if (p >= 1) b.pop = -1
          }
          const a = appear(0.05 * i)
          const s = a * popS * (1 + 0.2 * Math.sin(b.press * Math.PI))
          b.node.scale.setScalar(Math.max(s, 0.0001))
          b.node.position.copy(b.base)
          b.node.position.y += 0.007 * b.cur + (rm ? 0 : Math.sin(F.clock * 1.6 + i) * 0.0015)
          faceToward(b.node, b.base, dt)
          b.node.updateMatrix()
          rims.setMatrixAt(i, b.node.matrix)
          b.p.mesh.material.opacity = clamp01(a * 1.3)
          b.p.mesh.material.color.setScalar(F.dim)
          _off.makeScale(BEZ.haloS, BEZ.haloS, 1).setPosition(0, 0, -0.012)
          halos.setMatrixAt(i, _m.multiplyMatrices(b.node.matrix, _off))
          const hk = (0.3 * b.litK + 0.4 * b.cur * (0.8 + 0.2 * AMP * breath) + 0.9 * b.flash) * F.shown * F.dim
          halos.setColorAt(i, _col.setScalar(hk))
        }
        rims.instanceMatrix.needsUpdate = true

        // cartel (même fondu enchaîné que spatialUI)
        F.cartelFade = Math.min(1, F.cartelFade + dt * 2.5)
        if (F.cartelFade >= 1 && pendingMode !== null) { const m = pendingMode; pendingMode = null; if (m !== shownMode) startCartel(m) }
        const cs = appear(0.25)
        faceToward(cartelNode, cartelBase, dt)
        cartelNode.scale.setScalar(0.94 + 0.06 * clamp01(cs))
        for (let k = 0; k < 2; k++) {
          const c = cartels[k]
          const mine = k === front ? F.cartelFade : 1 - F.cartelFade
          c.mesh.material.opacity = clamp01(cs) * mine
          c.mesh.material.color.setScalar(F.dim)
          c.mesh.visible = c.mesh.material.opacity > 0.003
        }

        // médaillons
        F.progress += (F.progressTarget - F.progress) * Math.min(1, dt * 4)
        F.unlockFlash = Math.max(0, F.unlockFlash - dt * 1.4)
        let pulseBump = 0
        if (F.sprayPulse >= 0) { F.sprayPulse += dt / 0.45; pulseBump = Math.sin(clamp01(F.sprayPulse) * Math.PI) * 0.12; if (F.sprayPulse >= 1) F.sprayPulse = -1 }
        for (let k = 0; k < 2; k++) {
          const m = medallions[k]
          m.press = Math.max(0, m.press - dt * 4)
          m.flash = Math.max(0, m.flash - dt * 2)
          let popS = 1
          if (m.pop >= 0) { m.pop += dt / 0.55; popS = 0.82 + 0.18 * easeOutBack(clamp01(m.pop)); if (m.pop >= 1) m.pop = -1 }
          const a = appear(0.15 + 0.1 * k)
          let s = a * popS * (1 + 0.18 * Math.sin(m.press * Math.PI))
          let bright = F.dim, hk = 0
          if (m === mSpray) {
            // verrouillé : l'état « éteint » est DESSINÉ (émail sourd, icône voilée) — le libellé reste lisible
            s *= 1 + pulseBump + (locked ? 0 : 0.035 * AMP * breath)
            bright *= locked ? 0.92 + 0.08 * m.flash : 1
            hk = locked ? 0.4 * m.flash : (0.2 + 0.2 * AMP * breath) + 0.9 * F.unlockFlash
            hk += F.holdA * (0.15 + 0.55 * F.holdShown) // la lueur se charge pendant le maintien
          } else if (rangerPulse) {
            s *= 1 + 0.04 * AMP * breath
            hk = 0.2 + 0.25 * AMP * breath
          }
          hk += 0.45 * Math.sin(m.press * Math.PI) // retour tactile : le bijou s'éclaire sous le doigt
          m.node.scale.setScalar(Math.max(s, 0.0001))
          faceToward(m.node, m.base, dt)
          m.node.updateMatrix()
          m.p.mesh.material.opacity = clamp01(a)
          m.p.mesh.material.color.setScalar(bright)
          _off.makeScale(MED.haloS, MED.haloS, 1).setPosition(0, 0, -0.01)
          halos.setMatrixAt(m.haloIndex, _m.multiplyMatrices(m.node.matrix, _off))
          halos.setColorAt(m.haloIndex, _col.setScalar(hk * F.shown * F.dim))
        }
        halos.instanceMatrix.needsUpdate = true
        halos.instanceColor.needsUpdate = true
        const pu = progMat.uniforms
        pu.uProgress.value = locked ? F.progress : 1
        pu.uOpacity.value = clamp01(appear(0.15)) * F.dim
        pu.uGlow.value = locked ? 0.3 : 0.22 + 0.3 * AMP * breath
        pu.uFlash.value = F.unlockFlash
        progRing.visible = pu.uOpacity.value > 0.003 && (pu.uProgress.value > 0.0005 || F.unlockFlash > 0)
      }

      // -- anneau de maintien --
      F.holdA += ((holdOn ? 1 : 0) - F.holdA) * Math.min(1, dt * (holdOn ? 14 : 6))
      if (holdOn) F.holdShown = F.holdK
      holdRing.visible = F.holdA > 0.002
      if (holdRing.visible) {
        if (holdAtOn) {
          holdRing.position.copy(holdAt); holdRing.position.z += 0.003
          holdRing.quaternion.identity()
          holdRing.scale.setScalar(F.holdRadius / MED.holdR)
        } else {
          holdRing.position.copy(mSpray.node.position); holdRing.position.z += 0.002
          holdRing.quaternion.copy(mSpray.node.quaternion)
          _s.copy(mSpray.node.scale); holdRing.scale.copy(_s)
        }
        const hu = holdMat.uniforms
        hu.uProgress.value = F.holdShown
        hu.uOpacity.value = F.holdA
        hu.uFlash.value = F.holdShown >= 0.999 ? 0.5 + 0.3 * breath : 0
      }

      // -- onde de choc du heurtoir : filet d'or qui s'ouvre, écho plus fin --
      if (F.strikeT >= 0) {
        F.strikeT += dt
        const t = F.strikeT
        const e = easeOutCubic(t / 0.5)
        const u = shockMat.uniforms
        u.uR.value = (0.012 + (F.strikeRMax - 0.012) * e) / F.strikeS
        u.uW.value = 0.05 - 0.036 * e
        u.uA.value = Math.pow(Math.max(0, 1 - t / 0.62), 1.4)
        const te = easeOutCubic(Math.max(0, t - 0.09) / 0.5)
        u.uEchoR.value = (0.012 + (F.strikeRMax * 0.72 - 0.012) * te) / F.strikeS
        u.uEchoA.value = 0.45 * u.uA.value * (t > 0.09 ? 1 : 0)
        u.uCore.value = Math.max(0, 1 - t / 0.16) * 0.6
        if (t > 0.62) { F.strikeT = -1; shock.visible = false }
      }

      // -- anneau fantôme (pulsation 0,8 Hz) --
      F.ghostA += ((ghostOn ? 1 : 0) - F.ghostA) * Math.min(1, dt * (ghostOn ? 3 : 5))
      ghostMesh.visible = F.ghostA > 0.002
      if (ghostMesh.visible) {
        F.ghostPhase = (F.ghostPhase + dt / 1.25) % 1
        const b = 0.5 - 0.5 * Math.cos(F.ghostPhase * TAU)
        const u = ghostMat.uniforms
        const R = 1 / 1.9
        u.uR.value = R; u.uW.value = 0.036
        u.uA.value = F.ghostA * (0.26 + 0.4 * AMP * b)
        u.uEchoR.value = R * (1 + 0.6 * F.ghostPhase)
        u.uEchoA.value = F.ghostA * 0.5 * AMP * (1 - F.ghostPhase) * (1 - F.ghostPhase)
        u.uCore.value = 0
      }
    },

    dispose() {
      disposed = true
      if (fontTimer) { clearTimeout(fontTimer); fontTimer = null }
      if (typeof document !== 'undefined' && document.fonts?.removeEventListener) document.fonts.removeEventListener('loadingdone', onFontsDone)
      group.removeFromParent()
      for (const d of disposables) d.dispose?.()
      rims.dispose(); halos.dispose()
      hitables.length = 0
    },
  }
  return api
}
