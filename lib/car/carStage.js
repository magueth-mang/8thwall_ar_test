// Mise en scène « showroom » de la voiture en AR :
//   - viseur de pose : empreinte arrondie, coins lumineux animés, chevron vers l'avant ;
//   - ombre de contact CALCULÉE : silhouette vue de dessus rendue une fois au chargement, floutée (deux rayons) ;
//   - révélation : un anneau de lumière se dessine au sol, puis la voiture se matérialise de bas en haut sous une
//     ligne de scan (plan de coupe sur tous ses matériaux, réglé dès le chargement → aucune recompilation),
//     puis séquence d'accueil des phares et titre flottant ;
//   - titre « marque · modèle » posé au-dessus de la voiture, tourné vers l'utilisateur.

import * as THREE from 'three'
import { CAR_INFO } from '@/lib/car/carSpecs'

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x) }
const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t }

// ---- ombre de contact : silhouette de dessus → flou → alpha ----------------------------------------------
function blurCanvas(src, radiusPx) {
  // flou par réductions / agrandissements successifs (canvas.filter n'existe pas partout sur iOS)
  let c = src, w = src.width, h = src.height
  const steps = Math.max(1, Math.round(Math.log2(Math.max(2, radiusPx))))
  for (let i = 0; i < steps; i++) {
    const n = document.createElement('canvas'); n.width = Math.max(2, w >> 1); n.height = Math.max(2, h >> 1)
    const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, n.width, n.height)
    c = n; w = n.width; h = n.height
  }
  const out = document.createElement('canvas'); out.width = src.width; out.height = src.height
  const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, out.width, out.height)
  return out
}
function bakeShadow(renderer, car, dims) {
  const pad = 0.9, sw = dims.W + pad * 2, sl = dims.L + pad * 2
  const RW = 256, RH = Math.round(256 * sl / sw)
  const rt = new THREE.WebGLRenderTarget(RW, RH)
  const cam = new THREE.OrthographicCamera(-sw / 2, sw / 2, sl / 2, -sl / 2, 0.01, 10)
  cam.position.set(0, 5, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0)
  const sc = new THREE.Scene()
  const parent = car.parent, vis = car.visible, pos = car.position.clone(), rot = car.rotation.clone(), scl = car.scale.clone()
  sc.add(car); car.visible = true; car.position.set(0, 0, 0); car.rotation.set(0, 0, 0); car.scale.set(1, 1, 1)
  sc.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
  sc.background = new THREE.Color(0xffffff)
  const prevT = renderer.getRenderTarget(), prevTM = renderer.toneMapping, prevAC = renderer.autoClear
  renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = true
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam)
  const px = new Uint8Array(RW * RH * 4); renderer.readRenderTargetPixels(rt, 0, 0, RW, RH, px)
  renderer.setRenderTarget(prevT); renderer.toneMapping = prevTM; renderer.autoClear = prevAC
  sc.remove(car); if (parent) parent.add(car); car.visible = vis; car.position.copy(pos); car.rotation.copy(rot); car.scale.copy(scl)
  sc.overrideMaterial.dispose(); rt.dispose()
  // silhouette (noir = voiture) → masque blanc opaque
  const sil = document.createElement('canvas'); sil.width = RW; sil.height = RH
  const sg = sil.getContext('2d'), img = sg.createImageData(RW, RH)
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const i = ((RH - 1 - y) * RW + x) * 4, o = (y * RW + x) * 4 // lecture GL de bas en haut
    const a = 255 - px[i]
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0; img.data[o + 3] = a
  }
  sg.putImageData(img, 0, 0)
  // deux ombres : large et douce (ambiante) + serrée (contact)
  const wide = blurCanvas(sil, 22), tight = blurCanvas(sil, 6)
  const out = document.createElement('canvas'); out.width = RW; out.height = RH
  const og = out.getContext('2d')
  og.globalAlpha = 0.55; og.drawImage(wide, 0, 0)
  og.globalAlpha = 0.5; og.drawImage(tight, 0, 0)
  const t = tex(out)
  return { texture: t, w: sw, l: sl }
}

// ---- textures -----------------------------------------------------------------------------------------------
function reticleTexture(W, L) {
  const s = 220, c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(L * s)
  const g = c.getContext('2d'), w = c.width, h = c.height, r = 0.42 * s
  const fill = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.6)
  fill.addColorStop(0, 'rgba(255,255,255,0.20)'); fill.addColorStop(1, 'rgba(255,255,255,0.04)')
  g.fillStyle = fill; rr(g, 6, 6, w - 12, h - 12, r); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.setLineDash([18, 14]); rr(g, 6, 6, w - 12, h - 12, r); g.stroke(); g.setLineDash([])
  // chevron vers l'avant (+Z = haut de la texture après rotation)
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round'
  const cx = w / 2, cy = h * 0.2
  g.beginPath(); g.moveTo(cx - 46, cy + 30); g.lineTo(cx, cy - 12); g.lineTo(cx + 46, cy + 30); g.stroke()
  return tex(c)
}
function bracketsTexture(W, L) {
  const s = 220, c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(L * s)
  const g = c.getContext('2d'), w = c.width, h = c.height, k = 0.38 * s, m = 8
  g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'
  const corner = (x, y, dx, dy) => { g.beginPath(); g.moveTo(x + dx * k, y); g.lineTo(x, y); g.lineTo(x, y + dy * k); g.stroke() }
  corner(m, m, 1, 1); corner(w - m, m, -1, 1); corner(m, h - m, 1, -1); corner(w - m, h - m, -1, -1)
  return tex(c)
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(256, 256, 180, 256, 256, 256)
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.82, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512)
  return tex(c)
}
function titleTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 300
  const g = c.getContext('2d')
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 24
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `500 34px ${FONT}`
  g.fillText(CAR_INFO.maker.toUpperCase().split('').join('   '), 512, 70)
  g.fillStyle = '#fff'; g.font = `200 108px ${FONT}`; g.fillText(CAR_INFO.model, 512, 170)
  g.shadowBlur = 0
  const hl = g.createLinearGradient(312, 0, 712, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.8)'); hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl; g.fillRect(312, 250, 400, 2)
  return tex(c)
}

export function createCarStage({ car, dims, scene, renderer, lights, onRevealed }) {
  const own = []
  // ---- ombre (enfant de la voiture : suit sa pose et sa taille) ----
  const sh = bakeShadow(renderer, car, dims); own.push(sh.texture)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(sh.w, sh.l), new THREE.MeshBasicMaterial({ map: sh.texture, transparent: true, depthWrite: false, opacity: 0 }))
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.003; shadow.renderOrder = -1; car.add(shadow); own.push(shadow.geometry, shadow.material)

  // ---- plan de coupe de la révélation, posé sur tous les matériaux de la voiture dès maintenant ----
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
  renderer.localClippingEnabled = true
  const mats = new Set()
  car.traverse((o) => { if (o.isMesh && o !== shadow) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m)) })
  for (const m of mats) { m.clippingPlanes = [clip]; m.needsUpdate = true }

  // ---- ligne de scan + anneau au sol (enfants de la voiture) ----
  const scanG = new THREE.Group(); scanG.visible = false; car.add(scanG)
  const sheetC = document.createElement('canvas'); sheetC.width = 4; sheetC.height = 128
  { const g = sheetC.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128) }
  const sheetT = tex(sheetC); own.push(sheetT)
  const ox = dims.W / 2 + 0.06, oz = dims.L / 2 + 0.06
  const lineM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  const glowM = new THREE.MeshBasicMaterial({ map: sheetT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  own.push(lineM, glowM)
  // contour rectangulaire lumineux (4 barres) + halo vertical sur chaque côté
  for (const [w, d, x, z] of [[ox * 2, 0.012, 0, oz], [ox * 2, 0.012, 0, -oz], [0.012, oz * 2, ox, 0], [0.012, oz * 2, -ox, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), lineM); b.position.set(x, 0, z); scanG.add(b); own.push(b.geometry)
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), 0.16), glowM)
    halo.position.set(x, 0, z); if (d > w) halo.rotation.y = Math.PI / 2; scanG.add(halo); own.push(halo.geometry)
  }
  const ringT = ringTexture(); own.push(ringT)
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; ring.visible = false; car.add(ring); own.push(ring.geometry, ring.material)

  // ---- titre ----
  const titleT = titleTexture(); own.push(titleT)
  const title = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.557), new THREE.MeshBasicMaterial({ map: titleT, transparent: true, opacity: 0, depthWrite: false, depthTest: false }))
  title.renderOrder = 960; title.visible = false; scene.add(title); own.push(title.geometry, title.material)

  // ---- viseur ----
  const reticle = new THREE.Group(); reticle.visible = false; reticle.name = 'CarReticle'
  const rT = reticleTexture(dims.W, dims.L), bT = bracketsTexture(dims.W, dims.L); own.push(rT, bT)
  const rFill = new THREE.Mesh(new THREE.PlaneGeometry(dims.W, dims.L), new THREE.MeshBasicMaterial({ map: rT, transparent: true, depthWrite: false, depthTest: false }))
  const rBr = new THREE.Mesh(new THREE.PlaneGeometry(dims.W + 0.1, dims.L + 0.1), new THREE.MeshBasicMaterial({ map: bT, transparent: true, depthWrite: false, depthTest: false }))
  ;[rFill, rBr].forEach((m) => { m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI; m.renderOrder = 999; reticle.add(m); own.push(m.geometry, m.material) })
  scene.add(reticle)

  // ---- état de la révélation ----
  let revealT = -1, done = false, titleT0 = -1
  const _c = new THREE.Vector3(), _w = new THREE.Vector3()
  const setClip = (hWorld) => { clip.constant = hWorld }

  return {
    reticle,
    shadow,
    get revealing() { return revealT >= 0 && !done },
    /** à la pose : la voiture est cachée par le plan de coupe et se matérialise */
    playReveal() {
      revealT = 0; done = false
      scanG.visible = true; ring.visible = true
      car.updateMatrixWorld(true)
      setClip(car.position.y - 0.01)
      shadow.material.opacity = 0
    },
    reset() { revealT = -1; done = false; setClip(1e6); scanG.visible = false; ring.visible = false; title.visible = false; shadow.material.opacity = 0; titleT0 = -1 },
    update(dt, camera, t) {
      // viseur : coins qui respirent
      if (reticle.visible) rBr.material.opacity = 0.65 + 0.35 * Math.sin(t * 3.2)
      if (revealT >= 0 && !done) {
        revealT += dt
        const s = car.scale.x, H = dims.H
        // 0 → 0,7 s : anneau au sol qui s'ouvre ; 0,4 → 2,2 s : scan de bas en haut ; ombre qui monte avec
        const rk = easeOut(revealT / 0.9)
        const R = Math.hypot(dims.W, dims.L) * (0.35 + 0.75 * rk)
        ring.scale.set(R, R, 1); ring.material.opacity = (1 - smooth((revealT - 0.5) / 0.9)) * 0.9
        const sk = smooth((revealT - 0.4) / 1.8)
        const y = -0.02 + (H + 0.08) * sk
        scanG.position.y = y
        lineM.opacity = Math.min(1, revealT * 3) * (1 - smooth((sk - 0.92) / 0.08)); glowM.opacity = lineM.opacity * 0.55
        car.updateMatrixWorld()
        setClip(car.position.y + y * s)
        shadow.material.opacity = smooth((revealT - 0.3) / 1.2)
        if (revealT > 2.25) {
          done = true; scanG.visible = false; ring.visible = false; setClip(1e6)
          lights?.set(true); setTimeout(() => lights?.set(false), 2600) // séquence d'accueil des phares
          titleT0 = t
          onRevealed?.()
        }
      }
      // titre : apparaît après la révélation, reste 4 s, s'efface
      if (titleT0 >= 0) {
        const k = t - titleT0
        const a = smooth(k / 0.8) * (1 - smooth((k - 4.2) / 1.0))
        title.visible = a > 0.01
        if (title.visible) {
          const s = car.scale.x
          _w.set(0, dims.H + 0.55, 0); car.localToWorld(_w)
          title.position.copy(_w); title.position.y += (1 - a) * 0.08 * s
          camera.getWorldPosition(_c)
          title.rotation.set(0, Math.atan2(_c.x - _w.x, _c.z - _w.z), 0)
          title.scale.setScalar(Math.max(0.35, s))
          title.material.opacity = a
        }
        if (k > 5.4) titleT0 = -1
      }
    },
    dispose() { scene.remove(reticle); scene.remove(title); car.remove(shadow); car.remove(scanG); car.remove(ring); for (const o of own) o.dispose?.() },
  }
}
