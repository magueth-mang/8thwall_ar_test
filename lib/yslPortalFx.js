// Volumetric light beams + floating dust for the YSL portal interior.
// Reads the Beam_<Name>_Src / Beam_<Name>_Dst empties exported in ysl_interior.glb
// (radii in userData.beam_r0 / beam_r1, marker units) and builds additive cones.
//
//   const fx = createPortalFX(interior.scene)
//   fx.setStrength(0..1)   // fade in when the door opens
//   fx.update(dt)          // every frame

import * as THREE from 'three'

const BEAM_STRENGTH = { Pedestal: 1.0, Arch: 0.75, PilasterL: 0.45, PilasterR: 0.45 }

const beamVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewV = -mv.xyz;
    vNormalV = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`

const beamFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  void main() {
    float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
    float soft = pow(facing, 1.7);                         // fades out at the silhouette
    float t = vUv.y;                                       // 1 at the source, 0 at the target
    float along = pow(t, 0.8) * smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.93, t);
    float shimmer = 0.86 + 0.14 * sin(uTime * 0.8 + t * 16.0 + vUv.x * 37.7);
    float a = soft * along * shimmer * uStrength;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`

function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,244,220,1)')
  grd.addColorStop(0.35, 'rgba(255,226,170,0.45)')
  grd.addColorStop(1, 'rgba(255,220,160,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function createPortalFX(interiorRoot, { color = 0xffd7a0, intensity = 0.5, dust = 70 } = {}) {
  interiorRoot.updateMatrixWorld(true)
  const group = new THREE.Group()
  group.name = 'PortalFX'
  interiorRoot.add(group)

  const toLocal = (o) => interiorRoot.worldToLocal(o.getWorldPosition(new THREE.Vector3()))
  const beams = []
  let main = null

  interiorRoot.traverse((o) => {
    const m = /^Beam_(.+)_Src$/.exec(o.name)
    if (!m) return
    const dstObj = interiorRoot.getObjectByName(`Beam_${m[1]}_Dst`)
    if (!dstObj) return
    const src = toLocal(o)
    const dst = toLocal(dstObj)
    const len = src.distanceTo(dst)
    const r0 = o.userData.beam_r0 ?? 0.02
    const r1 = o.userData.beam_r1 ?? 0.15
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uStrength: { value: 0 },
        uTime: { value: Math.random() * 10 },
      },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true, // additif : l'ordre des faces ne compte pas → 1 draw call au lieu de 2
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 48, 1, true), mat)
    mesh.position.copy(src).add(dst).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), src.clone().sub(dst).normalize())
    mesh.renderOrder = 10
    mesh.name = `FX_Beam_${m[1]}`
    group.add(mesh)
    const beam = { mesh, name: m[1], weight: BEAM_STRENGTH[m[1]] ?? 0.5, src, dst, r0, r1, len }
    beams.push(beam)
    if (m[1] === 'Pedestal') main = beam
  })

  // dust motes drifting inside the main beam
  let points = null
  if (main && dust > 0) {
    const pos = new Float32Array(dust * 3)
    const seeds = []
    for (let i = 0; i < dust; i++) seeds.push({ t: Math.random(), a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * 0.8, s: 0.02 + Math.random() * 0.05, w: Math.random() * 6.28 })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      map: dotTexture(),
      color: 0xffe2b0,
      size: main.len * 0.016,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    points = new THREE.Points(geo, mat)
    const baseSize = main.len * 0.016 // taille en unités monde → suit l'échelle de l'ancre AR
    points.onBeforeRender = function () { this.material.size = baseSize * this.matrixWorld.getMaxScaleOnAxis() }
    points.renderOrder = 11
    points.frustumCulled = false
    points.userData.seeds = seeds
    group.add(points)
  }

  let strength = 0
  let clock = 0
  const extWeight = {}
  const axis = new THREE.Vector3()
  const side = new THREE.Vector3()
  const side2 = new THREE.Vector3()
  const p = new THREE.Vector3()

  function update(dt) {
    clock += dt
    for (const b of beams) {
      const u = b.mesh.material.uniforms
      u.uTime.value += dt
      u.uStrength.value = intensity * b.weight * (extWeight[b.name] ?? 1) * strength * (0.94 + 0.06 * Math.sin(clock * 1.3 + b.len * 7.0))
      b.mesh.visible = u.uStrength.value > 1e-3
    }
    if (points) {
      points.material.opacity = strength * 0.85 * Math.min(1, extWeight.Pedestal ?? 1)
      points.visible = points.material.opacity > 1e-3
      if (!points.visible) return
      axis.copy(main.dst).sub(main.src)
      side.set(1, 0, 0).cross(axis).normalize()
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1)
      side2.copy(axis).cross(side).normalize()
      const arr = points.geometry.attributes.position.array
      points.userData.seeds.forEach((s, i) => {
        s.t += s.s * dt * 0.25
        if (s.t > 1) s.t -= 1
        const t = 0.12 + s.t * 0.85                       // 0 = source, 1 = target
        const rad = THREE.MathUtils.lerp(main.r0, main.r1, t) * s.r
        const ang = s.a + Math.sin(clock * 0.35 + s.w) * 0.6
        p.copy(main.src).addScaledVector(axis, t)
          .addScaledVector(side, Math.cos(ang) * rad)
          .addScaledVector(side2, Math.sin(ang) * rad)
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z
      })
      points.geometry.attributes.position.needsUpdate = true
    }
  }

  return {
    group,
    update,
    setStrength: (v) => { strength = THREE.MathUtils.clamp(v, 0, 1) },
    /** multiplicateurs par faisceau : { Pedestal, Arch, PilasterL, PilasterR } */
    setBeamWeights: (w) => { Object.assign(extWeight, w) },
    dispose: () => {
      group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose() })
      group.removeFromParent()
    },
  }
}
