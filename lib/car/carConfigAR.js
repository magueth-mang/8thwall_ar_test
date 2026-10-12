// Configurateur EN AR : un pupitre de verre flotte à côté de la voiture, au coin le plus proche de l'utilisateur
// (il change de coin quand on tourne autour), tourné vers lui. Les teintes sont de vraies sphères de peinture
// (même matériau vernis que la carrosserie, elles reflètent l'environnement) ; jantes et cuirs pareil.
//   - replié : une pastille « Configurer » ; déplié : onglets, sphères, nom + finition de l'option ;
//   - toucher une sphère → config.set() (vague de peinture sur la carrosserie), la sphère se soulève et tourne ;
//   - textures canvas redessinées seulement quand l'onglet ou le choix change ; rien n'est compilé en cours de route.

import * as THREE from 'three'
import { CONFIG_OPTIONS } from '@/lib/car/configurator'

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const RO = 940
const TABS = ['paint', 'rims', 'leather']
const PANEL_W = 1.0, PANEL_H = 0.5          // mètres à taille réelle
const TRACK = (s, n = 2) => s.toUpperCase().split('').join(' '.repeat(n))

function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
function glass(g, x, y, w, h, r) {
  const gr = g.createLinearGradient(0, y, 0, y + h)
  gr.addColorStop(0, 'rgba(34,34,40,0.90)'); gr.addColorStop(1, 'rgba(10,10,12,0.94)')
  g.fillStyle = gr; rr(g, x, y, w, h, r); g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; rr(g, x + 1, y + 1, w - 2, h - 2, r); g.stroke()
  const hl = g.createLinearGradient(x, 0, x + w, 0)
  hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl; g.fillRect(x + r, y + 2, w - 2 * r, 2)
}

export function createConfigStand({ car, dims, scene, config, onTab, onChange, onOpenChange }) {
  const root = new THREE.Group(); root.name = 'ConfigStand'; root.visible = false; scene.add(root)
  const tilt = new THREE.Group(); tilt.rotation.x = -0.32; root.add(tilt) // pupitre incliné vers l'utilisateur
  const own = []
  const tabs = TABS.filter((k) => config.available.includes(k))

  // ---- panneau (canvas redessiné à la demande) ----
  const pc = document.createElement('canvas'); pc.width = 1024; pc.height = Math.round(1024 * PANEL_H / PANEL_W)
  const pt = new THREE.CanvasTexture(pc); pt.colorSpace = THREE.SRGBColorSpace; pt.anisotropy = 4; own.push(pt)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false }))
  panel.renderOrder = RO; tilt.add(panel); own.push(panel.geometry, panel.material)
  let tab = tabs[0]
  const TAB_Y = 74, CLOSE = { x: 1024 - 70, y: 62, r: 30 }
  function drawPanel() {
    const g = pc.getContext('2d'), W = pc.width, H = pc.height
    g.clearRect(0, 0, W, H)
    glass(g, 6, 6, W - 12, H - 12, 46)
    // onglets
    const n = tabs.length, colW = 780 / n, x0 = (W - 780) / 2
    tabs.forEach((k, i) => {
      const on = k === tab, cx = x0 + colW * (i + 0.5)
      g.font = `${on ? 600 : 500} 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.42)'
      g.fillText(TRACK(CONFIG_OPTIONS[k].label), cx, TAB_Y)
      if (on) { g.fillStyle = '#fff'; g.fillRect(cx - 34, TAB_Y + 26, 68, 3) }
    })
    // fermer
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3
    g.beginPath(); g.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2); g.stroke()
    g.beginPath(); g.moveTo(CLOSE.x - 9, CLOSE.y - 9); g.lineTo(CLOSE.x + 9, CLOSE.y + 9); g.moveTo(CLOSE.x + 9, CLOSE.y - 9); g.lineTo(CLOSE.x - 9, CLOSE.y + 9); g.stroke()
    // filet + nom de l'option
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(70, H - 150, W - 140, 2)
    const it = CONFIG_OPTIONS[tab].items.find((x) => x.id === config.current[tab]) || CONFIG_OPTIONS[tab].items[0]
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `300 50px ${FONT}`; g.fillText(it.name, W / 2, H - 92)
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = `500 21px ${FONT}`; g.fillText(TRACK(it.finish), W / 2, H - 46)
    pt.needsUpdate = true
  }

  // ---- pastille repliée ----
  const cc = document.createElement('canvas'); cc.width = 640; cc.height = 160
  {
    const g = cc.getContext('2d')
    glass(g, 8, 8, 624, 144, 72)
    const cols = ['#e9e9e6', '#1a2342', '#5c1016', '#b9bcc0']
    cols.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(92 + i * 30, 80, 20, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.stroke() })
    g.fillStyle = '#fff'; g.font = `500 34px ${FONT}`; g.textBaseline = 'middle'; g.fillText(TRACK('Configurer'), 232, 82)
  }
  const ct = new THREE.CanvasTexture(cc); ct.colorSpace = THREE.SRGBColorSpace; own.push(ct)
  const pill = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false }))
  pill.renderOrder = RO; tilt.add(pill); own.push(pill.geometry, pill.material)

  // ---- sphères de matière ----
  const MAXN = Math.max(...tabs.map((k) => CONFIG_OPTIONS[k].items.length))
  const sphG = new THREE.SphereGeometry(1, 40, 28); own.push(sphG)
  const ringG = new THREE.TorusGeometry(1, 0.035, 8, 48); own.push(ringG)
  const ringM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }); own.push(ringM)
  const R = 0.042
  const sph = []
  for (let i = 0; i < MAXN; i++) {
    const m = new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 }); own.push(m)
    const s = new THREE.Mesh(sphG, m); s.renderOrder = RO + 1
    const ring = new THREE.Mesh(ringG, ringM); ring.rotation.x = Math.PI / 2; ring.renderOrder = RO + 1
    tilt.add(s, ring)
    sph.push({ s, ring, item: null, lift: 0, k: 0, spin: 0 })
  }
  function layout() {
    const items = CONFIG_OPTIONS[tab].items
    const gap = 0.128, x0 = -gap * (items.length - 1) / 2
    sph.forEach((o, i) => {
      const it = items[i]; o.item = it || null
      o.s.visible = o.ring.visible = !!it
      if (!it) return
      o.s.position.set(x0 + gap * i, 0.035, 0.05)
      o.ring.position.set(x0 + gap * i, 0.035 - R * 1.25, 0.05)
      const m = o.s.material
      m.color.set(tab === 'leather' && it.color === '#ffffff' ? '#e6dccb' : it.color)
      m.metalness = it.metal ?? 0; m.roughness = it.rough ?? 0.62
      m.clearcoat = tab === 'leather' ? 0.02 : 1 // > 0 : même programme, cuir presque mat
      o.k = 0 // réapparition en cascade
    })
    drawPanel()
  }
  layout()

  // ---- état, placement ----
  let open = false, openK = 0, visible = false, visK = 0, corner = -1
  const target = new THREE.Vector3(), cur = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3(), _l = new THREE.Vector3()
  let placedOnce = false
  const corners = () => { const ox = dims.W / 2 + 1.2, oz = dims.L / 2 + 0.9; return [[ox, oz], [-ox, oz], [ox, -oz], [-ox, -oz]] }

  function select(it) {
    if (!it) return
    config.set(tab, it.id)
    drawPanel()
    onChange?.(tab, it.id)
  }
  return {
    root,
    setVisible(v) { visible = v; if (!v) { open = false; placedOnce = false } },
    get isOpen() { return open },
    expand(k) { if (k && tabs.includes(k)) tab = k; open = true; layout(); onTab?.(tab); onOpenChange?.(true) },
    collapse() { if (open) { open = false; onOpenChange?.(false) } },
    select(id) { select(CONFIG_OPTIONS[tab].items.find((x) => x.id === id)) },
    pick(ray) {
      if (!visible || visK < 0.5) return false
      if (!open) {
        if (ray.intersectObject(pill, false)[0]) { open = true; layout(); onTab?.(tab); onOpenChange?.(true); return true }
        return false
      }
      const hs = ray.intersectObjects(sph.filter((o) => o.s.visible).map((o) => o.s), false)[0]
      if (hs) { select(sph.find((o) => o.s === hs.object).item); return true }
      const hp = ray.intersectObject(panel, false)[0]
      if (!hp) return false
      const px = hp.uv.x * pc.width, py = (1 - hp.uv.y) * pc.height
      if (Math.hypot(px - CLOSE.x, py - CLOSE.y) < CLOSE.r * 1.8) { open = false; onOpenChange?.(false); return true }
      if (py < TAB_Y + 50) {
        const n = tabs.length, colW = 780 / n, x0 = (pc.width - 780) / 2
        const i = Math.floor((px - x0) / colW)
        if (i >= 0 && i < n && tabs[i] !== tab) { tab = tabs[i]; layout(); onTab?.(tab) }
      }
      return true
    },
    update(dt, camera, t) {
      visK += ((visible ? 1 : 0) - visK) * Math.min(1, dt * 5)
      root.visible = visK > 0.01
      if (!root.visible) return
      openK += ((open ? 1 : 0) - openK) * Math.min(1, dt * 7)
      // coin le plus proche de l'utilisateur (hystérésis : on ne change que si un autre coin est nettement plus près)
      camera.getWorldPosition(_c)
      _l.copy(_c); car.worldToLocal(_l)
      const cs = corners()
      let best = corner < 0 ? 0 : corner, bd = 1e9
      cs.forEach(([x, z], i) => { const d = Math.hypot(_l.x - x, _l.z - z); if (d < bd - (i === corner ? 0 : 0.4)) { bd = d; best = i } })
      corner = best
      const sc = Math.max(0.3, car.scale.x)
      target.set(cs[corner][0], 0, cs[corner][1]); car.localToWorld(target)
      target.y = car.position.y + (open ? 0.98 : 0.9) * sc
      if (!placedOnce) { cur.copy(target); placedOnce = true } else cur.lerp(target, Math.min(1, dt * 2.5))
      root.position.copy(cur)
      root.scale.setScalar(sc)
      _v.copy(_c).sub(cur); root.rotation.set(0, Math.atan2(_v.x, _v.z), 0) // face à l'utilisateur, à la verticale
      // replié / déplié
      const e = openK * openK * (3 - 2 * openK)
      panel.visible = e > 0.01; panel.scale.setScalar(0.85 + 0.15 * e); panel.material.opacity = e * visK
      pill.visible = e < 0.99; pill.material.opacity = (1 - e) * visK; pill.scale.setScalar(1 - 0.2 * e)
      const selId = config.current[tab]
      sph.forEach((o, i) => {
        if (!o.item) return
        o.k = Math.min(1, o.k + dt * 4.5 - i * 0.002)
        const pop = Math.max(0, Math.min(1, o.k * 1.6 - i * 0.08))
        const on = o.item.id === selId
        o.lift += ((on ? 1 : 0) - o.lift) * Math.min(1, dt * 8)
        o.spin += dt * (on ? 1.2 : 0.25)
        const r = R * (1 + 0.22 * o.lift) * e * (0.6 + 0.4 * pop)
        o.s.visible = e > 0.02
        o.s.scale.setScalar(Math.max(1e-4, r))
        o.s.position.y = 0.035 + 0.02 * o.lift + Math.sin(t * 1.6 + i) * 0.002
        o.s.rotation.y = o.spin
        o.ring.visible = o.s.visible && o.lift > 0.02
        o.ring.scale.setScalar(R * 1.25 * e)
      })
      ringM.opacity = 0.9 * e * visK
    },
    dispose() { scene.remove(root); for (const o of own) o.dispose?.() },
  }
}
