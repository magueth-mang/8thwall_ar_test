// Effets d'ambiance du portail YSL — tous « in-scene », sans post-processing :
// reflet doré qui balaie la porte, filet de lumière dans la fente, anneau-onde du seuil,
// onde sur le socle, étincelles (1 draw call), halo et poussières en orbite autour du produit.

import * as THREE from 'three'

const GOLD = new THREE.Color(1.0, 0.82, 0.5)

export function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  stops.forEach(([o, col]) => grd.addColorStop(o, col))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** La taille des Points (sizeAttenuation) est en unités monde : on la multiplie par l'échelle monde de l'objet
 *  (l'ancre AR est mise à l'échelle par 8th Wall), juste avant le rendu. */
export function worldSizedPoints(points, baseSize) {
  points.userData.baseSize = baseSize
  points.onBeforeRender = function () { this.material.size = this.userData.baseSize * this.matrixWorld.getMaxScaleOnAxis() }
  return points
}

const additive = (opts) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...opts })

// ---- reflet doré sur la porte (patch du matériau unlit de la porte) ---------------
export function createDoorGlint(doorRoot) {
  const u = {
    uGlint: { value: -1 },
    uGlintStrength: { value: 0 },
    uGlintColor: { value: GOLD.clone().multiplyScalar(1.15) },
  }
  doorRoot.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return
    const m = o.material
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlint;\nuniform float uGlintStrength;\nuniform vec3 uGlintColor;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float gLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float gD = vMapUv.x * 0.75 - vMapUv.y * 0.45;
          float gBand = exp( -pow2( ( gD - uGlint ) * 11.0 ) ) + 0.5 * exp( -pow2( ( gD - uGlint + 0.08 ) * 34.0 ) );
          diffuseColor.rgb += uGlintColor * gBand * ( 0.12 + smoothstep( 0.18, 0.65, gLum ) ) * uGlintStrength;`)
    }
    m.customProgramCacheKey = () => 'ysl-door-glint'
    m.needsUpdate = true
  })
  let t = -1, dur = 1, active = false
  return {
    sweep(duration = 1.2, strength = 1.6) { t = 0; dur = duration; active = true; u.uGlintStrength.value = strength },
    update(dt) {
      if (!active) return
      t += dt / dur
      u.uGlint.value = -0.55 + t * 1.45
      if (t >= 1) { active = false; u.uGlintStrength.value = 0 }
    },
  }
}

// ---- filet de lumière dans la fente + sous les portes ------------------------------
export function createSeamLight(parent, { x = 0, y0 = -0.333, y1 = 0.332, z = 0.0035, halfW = 0.227 } = {}) {
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 256
    const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0, 'rgba(255,220,160,0)'); grd.addColorStop(0.2, 'rgba(255,226,175,0.9)'); grd.addColorStop(0.8, 'rgba(255,226,175,0.9)'); grd.addColorStop(1, 'rgba(255,220,160,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256)
    const h = g.createLinearGradient(0, 0, 16, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)')
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 16, 256)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  })()
  const group = new THREE.Group()
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.02, y1 - y0), additive({ map: tex, color: GOLD, opacity: 0 }))
  seam.position.set(x, (y0 + y1) / 2, z)
  const glowTex = radialTexture([[0, 'rgba(255,230,180,0.9)'], [0.35, 'rgba(255,200,120,0.25)'], [1, 'rgba(0,0,0,0)']])
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.24, y1 - y0 + 0.1), additive({ map: glowTex, color: GOLD, opacity: 0 }))
  halo.position.set(x, (y0 + y1) / 2, z + 0.0005)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, 0.02), additive({ map: glowTex, color: GOLD, opacity: 0 }))
  under.position.set(0, y0 + 0.004, z)
  ;[seam, halo, under].forEach((m) => { m.renderOrder = 12; group.add(m) })
  parent.add(group)
  let level = 0, target = 0, pulse = 0, clock = 0
  return {
    group,
    /** 0 = éteint, 1 = battement visible, 2 = flash */
    set(v) { target = v },
    flash() { pulse = 1 },
    update(dt) {
      clock += dt
      level += (target - level) * Math.min(1, dt * 5)
      pulse = Math.max(0, pulse - dt * 2.2)
      const beat = 0.75 + 0.25 * Math.pow(Math.max(0, Math.sin(clock * 3.4)), 6)
      const k = level * beat + pulse * 2.2
      seam.material.opacity = Math.min(1, k)
      halo.material.opacity = Math.min(1, k * 0.7)
      under.material.opacity = Math.min(1, k * 0.8)
      group.visible = k > 0.003
    },
  }
}

// ---- anneau-onde dans l'encadrement (franchissement du seuil) ----------------------
export function createPortalRipple(parent, { z = 0.006, sx = 0.27, sy = 0.36 } = {}) {
  const tex = radialTexture([[0, 'rgba(0,0,0,0)'], [0.72, 'rgba(0,0,0,0)'], [0.86, 'rgba(255,232,185,1)'], [0.93, 'rgba(255,200,120,0.35)'], [1, 'rgba(0,0,0,0)']], 256)
  const meshes = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), additive({ map: tex, color: GOLD, opacity: 0 }))
    m.position.z = z; m.renderOrder = 13; m.visible = false; parent.add(m); return m
  })
  const waves = []
  return {
    fire(delay = 0) { meshes.forEach((m, i) => waves.push({ m, t: -delay - i * 0.16 })) },
    update(dt) {
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]; w.t += dt
        const k = w.t / 0.95
        if (k < 0) continue
        if (k >= 1) { w.m.visible = false; waves.splice(i, 1); continue }
        const e = 1 - Math.pow(1 - k, 3)
        w.m.visible = true
        w.m.scale.set(sx * (0.35 + e * 1.1), sy * (0.35 + e * 1.1), 1)
        w.m.material.opacity = (1 - k) * 0.9
      }
    },
  }
}

// ---- onde horizontale sur le socle --------------------------------------------------
export function createFloorWave(parent) {
  const tex = radialTexture([[0, 'rgba(0,0,0,0)'], [0.78, 'rgba(0,0,0,0)'], [0.9, 'rgba(255,230,180,1)'], [1, 'rgba(0,0,0,0)']], 256)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), additive({ map: tex, color: GOLD, opacity: 0 }))
  m.rotation.x = -Math.PI / 2; m.renderOrder = 12; m.visible = false; parent.add(m)
  let t = 1, r0 = 0.02, r1 = 0.2
  return {
    fire(at, from = 0.02, to = 0.2) { m.position.copy(at); m.position.y += 0.002; t = 0; r0 = from; r1 = to },
    update(dt) {
      if (t >= 1) { m.visible = false; return }
      t = Math.min(1, t + dt / 1.1)
      const e = 1 - Math.pow(1 - t, 2)
      const r = r0 + (r1 - r0) * e
      m.scale.set(r, r, 1); m.visible = true; m.material.opacity = (1 - t) * 0.95
    },
  }
}

// ---- étincelles : un seul draw call, pool réutilisé --------------------------------
export function createSparks(parent, { max = 260, size = 0.011 } = {}) {
  const pos = new Float32Array(max * 3).fill(9999)
  const col = new Float32Array(max * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
    map: radialTexture([[0, 'rgba(255,250,235,1)'], [0.25, 'rgba(255,225,160,0.7)'], [1, 'rgba(0,0,0,0)']], 64),
  })
  const points = worldSizedPoints(new THREE.Points(geo, mat), size)
  points.frustumCulled = false; points.renderOrder = 14
  parent.add(points)
  let alive = 0
  const P = Array.from({ length: max }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, c: new THREE.Color(), g: 0, drag: 0 }))
  let cursor = 0, seed = 1
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const dirTmp = new THREE.Vector3()
  return {
    /** at: Vector3, dir: Vector3 (normalisé), spread: 0..1 (cône), speed: [min,max] */
    emit({ at, count = 30, dir = new THREE.Vector3(0, 1, 0), spread = 1, speed = [0.1, 0.4], life = [0.6, 1.4], color = GOLD, gravity = -0.12, drag = 1.6, jitter = 0 }) {
      for (let i = 0; i < count; i++) {
        const q = P[cursor]; cursor = (cursor + 1) % max
        if (!q.alive) alive++
        q.alive = true
        q.p.copy(at)
        if (jitter) q.p.add(dirTmp.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(jitter))
        dirTmp.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(spread).add(dir).normalize()
        q.v.copy(dirTmp).multiplyScalar(speed[0] + rnd() * (speed[1] - speed[0]))
        q.life = q.max = life[0] + rnd() * (life[1] - life[0])
        q.c.copy(color).multiplyScalar(0.7 + rnd() * 0.6)
        q.g = gravity; q.drag = drag
      }
    },
    update(dt) {
      points.visible = alive > 0
      if (!alive) return // rien à animer ni à envoyer au GPU
      for (let i = 0; i < max; i++) {
        const q = P[i]
        if (!q.alive) continue
        q.life -= dt
        if (q.life <= 0) { q.alive = false; alive--; pos[i * 3] = 9999; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue }
        q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.v.y += q.g * dt
        q.p.addScaledVector(q.v, dt)
        const a = Math.pow(q.life / q.max, 1.4) * (0.6 + 0.4 * Math.sin(q.life * 40 + i))
        pos[i * 3] = q.p.x; pos[i * 3 + 1] = q.p.y; pos[i * 3 + 2] = q.p.z
        col[i * 3] = q.c.r * a; col[i * 3 + 1] = q.c.g * a; col[i * 3 + 2] = q.c.b * a
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
    },
  }
}

// ---- halo + poussières en orbite autour du produit héros ---------------------------
export function createHeroAura(parent) {
  const group = new THREE.Group(); parent.add(group)
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({
    map: radialTexture([[0, 'rgba(255,226,170,0.55)'], [0.3, 'rgba(255,190,110,0.22)'], [0.7, 'rgba(120,70,20,0.06)'], [1, 'rgba(0,0,0,0)']], 256),
    color: 0xffffff, opacity: 0,
  }))
  halo.renderOrder = 9
  group.add(halo)
  const N = 46
  const pos = new Float32Array(N * 3)
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.008, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: 0xffe0a8,
    map: radialTexture([[0, 'rgba(255,248,230,1)'], [0.3, 'rgba(255,220,160,0.5)'], [1, 'rgba(0,0,0,0)']], 64),
  }))
  worldSizedPoints(motes, 0.008)
  motes.frustumCulled = false; motes.renderOrder = 14
  group.add(motes)
  const seeds = Array.from({ length: N }, (_, i) => ({ a: (i / N) * Math.PI * 2 * 3.7, h: (i * 0.618) % 1, r: 0.75 + ((i * 0.37) % 0.5), s: 0.25 + ((i * 0.29) % 0.4) }))
  let clock = 0, level = 0, target = 0
  const qParent = new THREE.Quaternion(), qCam = new THREE.Quaternion()
  return {
    group,
    set(v) { target = v },
    update(dt, center, height, cam) {
      clock += dt
      level += (target - level) * Math.min(1, dt * 3)
      group.visible = level > 0.002
      if (!group.visible) return
      halo.position.copy(center); halo.position.y += height * 0.5; halo.position.z -= 0.02
      halo.scale.set(height * 1.5, height * 1.7, 1)
      if (cam) { // billboard en espace local de l'ancre (qui peut être tournée en AR)
        group.getWorldQuaternion(qParent).invert()
        halo.quaternion.copy(qParent.multiply(cam.getWorldQuaternion(qCam)))
      }
      halo.material.opacity = level * (0.85 + 0.15 * Math.sin(clock * 1.7))
      const R = height * 0.42
      seeds.forEach((s, i) => {
        const a = s.a + clock * s.s
        pos[i * 3] = center.x + Math.cos(a) * R * s.r
        pos[i * 3 + 1] = center.y + height * (0.05 + 0.95 * ((s.h + clock * 0.03 * s.s) % 1))
        pos[i * 3 + 2] = center.z + Math.sin(a) * R * s.r
      })
      geo.attributes.position.needsUpdate = true
      motes.material.opacity = level * 0.9
      motes.userData.baseSize = height * 0.03
    },
  }
}
