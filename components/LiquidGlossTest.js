'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Nappe de gloss liquide qui coule : surface réfléchissante + ondulations organiques
// (fbm + domain warp) qui s'écoulent, teinte nude/rosé, reflets "wet" sexy.
const vert = `
  uniform float uTime; uniform float uFlow; uniform float uAmp; uniform float uFreq;
  varying vec3 vWorldPos; varying vec3 vWorldNrm; varying vec3 vView; varying vec2 vUv;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v += a*vnoise(p); p*=2.0; a*=0.5; } return v; }
  // surface : le domaine s'écoule dans une direction (couler) + domain warp (organique)
  float surf(vec2 p){
    vec2 flow = vec2(0.15, -1.0) * uTime * uFlow;
    vec2 w = vec2(fbm(p*uFreq*0.5 + flow + 2.3), fbm(p*uFreq*0.5 + flow*1.3 + 7.1));
    return fbm(p*uFreq + w*0.9 + flow);
  }
  void main(){
    vUv = uv;
    vec3 pos = position;
    float e = 0.03;
    float h = surf(pos.xy);
    float hx = surf(pos.xy + vec2(e, 0.0));
    float hy = surf(pos.xy + vec2(0.0, e));
    pos.z += h * uAmp;
    vec3 dx = vec3(e, 0.0, (hx - h) * uAmp);
    vec3 dy = vec3(0.0, e, (hy - h) * uAmp);
    vec3 nrm = normalize(cross(dx, dy));
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vWorldNrm = normalize(mat3(modelMatrix) * nrm);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const frag = `
  uniform vec3 uColor; uniform vec3 uDeep; uniform float uTime;
  varying vec3 vWorldPos; varying vec3 vWorldNrm; varying vec3 vView; varying vec2 vUv;
  void main(){
    vec3 N = normalize(vWorldNrm);
    vec3 V = normalize(vView);
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 4.0);
    vec3 R = reflect(-V, N);
    // reflet studio : côtés sombres, SOFTBOX lumineux au zénith → les crêtes flashent
    float up = clamp(R.y, 0.0, 1.0);
    vec3 sky = mix(vec3(0.03, 0.02, 0.025), vec3(1.35, 1.22, 1.24), smoothstep(0.0, 0.85, up));
    // soleils nets qui balaient la nappe qui coule = sheen sexy
    float sun1 = pow(max(dot(R, normalize(vec3(-0.3, 0.85, 0.4))), 0.0), 300.0);
    float sun2 = pow(max(dot(R, normalize(vec3(0.5, 0.78, -0.35))), 0.0), 60.0);
    vec3 refl = sky + vec3(1.0) * sun1 * 5.0 + vec3(1.0, 0.96, 0.98) * sun2 * 1.1;
    // corps gloss : profond dans les creux, reflet DOMINANT (aspect verni/wet)
    vec3 body = mix(uDeep, uColor, pow(ndv, 0.7));
    vec3 col = mix(body * 0.7, refl, 0.55 + 0.4 * fres);
    col += uColor * fres * 0.3;                        // liseré rosé lumineux
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function LiquidGlossTest() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // fond dégradé chaud sombre → fait ressortir les reflets du gloss
    const bg = document.createElement('canvas')
    bg.width = bg.height = 512
    const bx = bg.getContext('2d')
    const grd = bx.createRadialGradient(256, 180, 40, 256, 300, 420)
    grd.addColorStop(0, '#3a2622')
    grd.addColorStop(0.5, '#1c1210')
    grd.addColorStop(1, '#0a0706')
    bx.fillStyle = grd
    bx.fillRect(0, 0, 512, 512)
    const bgTex = new THREE.CanvasTexture(bg)
    bgTex.colorSpace = THREE.SRGBColorSpace
    scene.background = bgTex

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.01, 100)
    let cam = [0, 0.75, 2.6]
    const params = (() => { try { return new URLSearchParams(window.location.search) } catch { return new URLSearchParams() } })()
    if (params.get('cam')) cam = params.get('cam').split(',').map(Number)
    camera.position.set(cam[0], cam[1], cam[2])

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI / 2 - 0.02 // reste au-dessus de la nappe

    const uniforms = {
      uTime: { value: 0 },
      uFlow: { value: parseFloat(params.get('flow')) || 0.12 },
      uAmp: { value: parseFloat(params.get('amp')) || 0.17 },
      uFreq: { value: parseFloat(params.get('freq')) || 1.5 },
      uColor: { value: new THREE.Color(params.get('color') ? '#' + params.get('color') : 0xf2a9a1) },
      uDeep: { value: new THREE.Color(0x6e2f30) }, // nude profond dans les creux
    }

    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag })
    const liquid = new THREE.Mesh(new THREE.PlaneGeometry(6, 6, 200, 200), mat)
    liquid.rotation.x = -Math.PI / 2 // à plat (nappe horizontale)
    scene.add(liquid)

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    let last = performance.now(), raf = null
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      uniforms.uTime.value += dt
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0706' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', bottom: 14, left: 16, color: '#e8b8ad', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        Nappe de gloss · glisser = pivoter · molette = zoom
      </div>
    </div>
  )
}
