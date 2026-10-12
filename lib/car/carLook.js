// Rendu réaliste de la voiture :
//   - environnement de reflets « vraie pièce » : l'image de la caméra (8th Wall, xrScene().cameraTexture) est
//     projetée sur une sphère autour du point de vue, complétée par trois softbox de studio (reflets nets,
//     lisibles sur la carrosserie), puis filtrée en PMREM. Recalculée ~1 fois par seconde ; sans caméra
//     (aperçu PC) : studio seul, calculé une fois ;
//   - matériaux : vitres teintées très réfléchissantes, pneus mats, plastiques satinés.

import * as THREE from 'three'

const ENV_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize( position ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`
// direction monde → repère caméra → coordonnées image ; l'arrière reprend l'avant en miroir, assombri ;
// le haut (plafond) et le bas (sol) sont légèrement assombris pour garder du modelé sur la carrosserie
const ENV_FS = /* glsl */`
uniform sampler2D uCam;
uniform mat3 uView;
uniform float uAspect;
uniform float uHasCam;
uniform vec3 uBase;
varying vec3 vDir;
vec3 srgbToLin( vec3 c ) { return pow( max( c, vec3( 0.0 ) ), vec3( 2.2 ) ); }
void main() {
  vec3 d = normalize( vDir );
  vec3 col = uBase * ( 0.55 + 0.45 * smoothstep( -0.4, 0.8, d.y ) );
  if ( uHasCam > 0.5 ) {
    vec3 c = uView * d;
    float back = step( 0.0, c.z );
    c.z = -abs( c.z );
    vec2 uv = c.xy / max( -c.z, 0.25 ) * vec2( 0.55 / uAspect, 0.55 ) + 0.5;
    uv = clamp( uv, 0.0, 1.0 );
    vec3 cam = srgbToLin( texture2D( uCam, uv ).rgb );
    cam *= mix( 1.0, 0.7, back ) * ( 0.8 + 0.2 * smoothstep( -0.6, 0.3, d.y ) );
    col = mix( col, cam * 1.15, 0.85 );
  }
  gl_FragColor = vec4( col, 1.0 );
}`

export function createCarLook({ car, scene, renderer, getCamTex }) {
  // ---- scène d'environnement ----
  const envScene = new THREE.Scene()
  const U = { uCam: { value: null }, uView: { value: new THREE.Matrix3() }, uAspect: { value: 0.56 }, uHasCam: { value: 0 }, uBase: { value: new THREE.Color(0.55, 0.55, 0.58) } }
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ uniforms: U, vertexShader: ENV_VS, fragmentShader: ENV_FS, side: THREE.BackSide, depthWrite: false }))
  envScene.add(sphere)
  // softbox : grand panneau au plafond + deux bandes latérales (lignes de reflet longues sur les flancs)
  const box = (w, h, x, y, z, ry, rx, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }))
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); envScene.add(m); return m
  }
  box(7, 4, 0, 6.5, 0, 0, Math.PI / 2, 3.2)          // plafond
  box(9, 1.1, -7, 2.0, 0, Math.PI / 2, 0, 4.0)        // bande latérale gauche (ligne de reflet sur les flancs)
  box(9, 1.1, 7, 2.4, 0, -Math.PI / 2, 0, 3.0)        // bande latérale droite
  box(12, 4, 0, 2.0, -8.5, 0, 0, 0.9)                 // remplissages doux avant / arrière
  box(12, 4, 0, 2.0, 8.5, Math.PI, 0, 0.9)
  const pmrem = new THREE.PMREMGenerator(renderer)
  let rt = null, last = -1

  // three r169 : fromScene alloue une cible à chaque appel → on libère la précédente (1 fois par seconde au plus)
  function bake() {
    const prevAC = renderer.autoClear
    const next = pmrem.fromScene(envScene, 0.035, 0.1, 50)
    renderer.autoClear = prevAC
    scene.environment = next.texture
    rt?.dispose(); rt = next
  }

  // ---- matériaux ----
  car.traverse((o) => {
    if (!o.isMesh) return
    const m = o.material, n = m?.name || ''
    if (n === 'inmx7m60i_glass') { m.color.set('#0e161b'); m.opacity = 0.42; m.roughness = 0.03; m.metalness = 0.15; m.envMapIntensity = 2.2 }
    else if (/^mm_tire/.test(n)) { m.roughness = 0.88; m.metalness = 0; m.envMapIntensity = 0.5 }
    else if (n === 'inmx7m60i_black' && !/wheel/.test(o.parent?.name || '')) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 0.9 }
  })

  bake()
  return {
    /** à appeler chaque image ; recalcule l'environnement environ une fois par seconde quand la caméra est là */
    update(t, camera) {
      const tex = getCamTex?.()
      if (!tex || !camera) return
      if (last >= 0 && t - last < 1.0) return
      last = t
      U.uCam.value = tex; U.uHasCam.value = 1
      camera.updateMatrixWorld()
      U.uView.value.setFromMatrix4(camera.matrixWorldInverse)
      U.uAspect.value = camera.aspect || 0.56
      sphere.position.copy(camera.position)
      bake()
    },
    dispose() { pmrem.dispose(); rt?.dispose(); sphere.geometry.dispose(); sphere.material.dispose() },
  }
}
