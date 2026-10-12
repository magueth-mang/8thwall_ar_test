// Configurateur de la voiture AR (prototype concession) : carrosserie, jantes, sellerie.
// Tout est préparé au chargement (matériaux créés et assignés une fois) : un changement d'option ne touche
// qu'aux couleurs / paramètres numériques → aucune recompilation de shader, transitions douces (~0,5 s).
// Les noms de matériaux / nœuds sont ceux du GLB BMW X7 M60i (Sketchfab) ; si une pièce manque, l'onglet disparaît.

import * as THREE from 'three'

export const CONFIG_OPTIONS = {
  paint: {
    label: 'Carrosserie',
    items: [
      { id: 'blanc', name: 'Blanc Alpin', finish: 'Uni', color: '#e9e9e6', metal: 0.0, rough: 0.28 },
      { id: 'noir', name: 'Noir Saphir', finish: 'Métallisé', color: '#0c0e13', metal: 0.75, rough: 0.32 },
      { id: 'gris', name: 'Gris Dravit', finish: 'Métallisé', color: '#5d605b', metal: 0.7, rough: 0.34 },
      { id: 'bleu', name: 'Bleu Nuit', finish: 'Métallisé', color: '#1a2342', metal: 0.7, rough: 0.3 },
      { id: 'rouge', name: 'Rouge Aventurine', finish: 'Métallisé', color: '#5c1016', metal: 0.7, rough: 0.3 },
      { id: 'vert', name: 'Vert Émeraude', finish: 'Métallisé', color: '#123528', metal: 0.7, rough: 0.32 },
    ],
  },
  rims: {
    label: 'Jantes',
    items: [
      { id: 'noir', name: 'Noir brillant', finish: '22 pouces', color: '#151515', metal: 0.5, rough: 0.12 },
      { id: 'argent', name: 'Argent', finish: '22 pouces', color: '#b9bcc0', metal: 1.0, rough: 0.22 },
      { id: 'graphite', name: 'Graphite', finish: '22 pouces', color: '#3a3c40', metal: 0.9, rough: 0.3 },
      { id: 'bronze', name: 'Bronze', finish: '22 pouces', color: '#7a5a36', metal: 1.0, rough: 0.28 },
    ],
  },
  leather: {
    label: 'Intérieur',
    items: [
      { id: 'ivoire', name: 'Cuir Ivoire', finish: 'Merino', color: '#ffffff' },
      { id: 'cognac', name: 'Cuir Cognac', finish: 'Merino', color: '#a8643a' },
      { id: 'tartufo', name: 'Cuir Tartufo', finish: 'Merino', color: '#5a3a2a' },
      { id: 'noir', name: 'Cuir Noir', finish: 'Merino', color: '#2b2b2d' },
      { id: 'rouge', name: 'Cuir Rouge Fiona', finish: 'Merino', color: '#7a1c1f' },
    ],
  },
}

export function createConfigurator(car) {
  const groups = { paint: [], rims: [], leather: [] }
  // carrosserie : un MeshPhysical vernis (clearcoat) remplace la peinture d'origine, partagé par toutes les pièces
  const paint = new THREE.MeshPhysicalMaterial({ name: 'cfg_paint', clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.1 })
  // vague de peinture : la nouvelle teinte balaie la carrosserie de l'avant vers l'arrière, avec un liseré lumineux
  const box = new THREE.Box3().setFromObject(car)
  const WU = { uOld: { value: new THREE.Color() }, uWave: { value: -9 }, uWaveOn: { value: 0 }, uCarO: { value: new THREE.Vector3() }, uCarF: { value: new THREE.Vector3(0, 0, 1) }, uFlake: { value: 0 }, uInvS: { value: 1 }, uCarInvR: { value: new THREE.Matrix3() }, uHalfL: { value: Math.max(0.5, (box.max.z - box.min.z) / 2 / (car.scale.x || 1)) } } // demi-longueur hors échelle d'affichage
  const halfL0 = WU.uHalfL.value
  paint.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WU)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vCfgW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vCfgW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCfgW;
uniform vec3 uOld; uniform float uWave; uniform float uWaveOn; uniform vec3 uCarO; uniform vec3 uCarF; uniform float uHalfL;
uniform float uFlake; uniform float uInvS; uniform mat3 uCarInvR;
vec3 cfgHash3( vec3 p ) { return fract( sin( vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) ) ) * 43758.5453 ) - 0.5; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// metallic flakes under the clear coat (~2.5 mm), in car space so they do not swim when the car turns
if ( uFlake > 0.0 ) { vec3 fc = floor( uCarInvR * ( vCfgW - uCarO ) * uInvS * 650.0 ); normal = normalize( normal + cfgHash3( fc ) * 0.1 * uFlake ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float cfgU = dot( vCfgW - uCarO, uCarF ) / uHalfL;
diffuseColor.rgb = mix( uOld, diffuseColor.rgb, smoothstep( uWave - 0.05, uWave + 0.05, cfgU ) );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3( 1.0, 0.96, 0.9 ) * exp( -pow( ( cfgU - uWave ) / 0.03, 2.0 ) ) * 0.8 * uWaveOn;`)
  }
  paint.customProgramCacheKey = () => 'cfg-paint-wave'
  let waveT = 1
  const rim = new THREE.MeshStandardMaterial({ name: 'cfg_rim', envMapIntensity: 1.2 })
  let leather = null
  car.traverse((o) => {
    if (!o.isMesh) return
    const n = o.material?.name || ''
    if (n === 'inmx7m60i_body') { o.material = paint; groups.paint.push(o) }
    else if (n === 'inmx7m60i_leather1') {
      if (!leather) leather = o.material
      groups.leather.push(o)
    }
    // jantes : les maillages « black » sous les 4 nœuds de roue (GLTFLoader retire le « . » des noms : wheel001…)
    if (n === 'inmx7m60i_black' && /^inmx7m60i_wheel[._]?\d*$/.test(o.parent?.name || '')) { o.material = rim; groups.rims.push(o) }
  })
  const mats = { paint, rims: rim, leather }
  const available = Object.keys(groups).filter((k) => groups[k].length && mats[k])

  // transitions : couleur + métal + rugosité interpolés
  const tw = {}
  const target = {}
  for (const k of available) { tw[k] = { t: 1, from: {}, to: {} }; target[k] = null }
  const current = {}

  function set(kind, id, instant = false) {
    const opt = CONFIG_OPTIONS[kind]?.items.find((i) => i.id === id)
    const m = mats[kind]
    if (!opt || !m) return
    current[kind] = id
    if (kind === 'paint') WU.uFlake.value = (opt.metal ?? 0) > 0.5 ? 1 : 0
    if (kind === 'paint' && !instant) {
      WU.uOld.value.copy(m.color)
      m.color.set(opt.color); m.metalness = opt.metal; m.roughness = opt.rough
      waveT = 0; tw.paint.t = 1
      return
    }
    const t = tw[kind]
    t.from = { c: m.color.clone(), metal: m.metalness ?? 0, rough: m.roughness ?? 1 }
    t.to = { c: new THREE.Color(opt.color), metal: opt.metal ?? m.metalness, rough: opt.rough ?? m.roughness }
    t.t = instant ? 1 : 0
    if (instant) apply(kind, 1)
  }
  function apply(kind, k) {
    const m = mats[kind], t = tw[kind]
    m.color.lerpColors(t.from.c, t.to.c, k)
    if ('metalness' in m) m.metalness = t.from.metal + (t.to.metal - t.from.metal) * k
    if ('roughness' in m) m.roughness = t.from.rough + (t.to.rough - t.from.rough) * k
  }
  // valeurs de départ
  if (mats.paint) set('paint', 'blanc', true)
  if (mats.rims) set('rims', 'noir', true)
  if (mats.leather) set('leather', 'ivoire', true)

  return {
    available,
    current,
    set,
    update(dt) {
      // repère voiture (paillettes et vague) : une copie de matrice par image, sans allocation
      car.updateMatrixWorld()
      WU.uInvS.value = 1 / (car.scale.x || 1)
      WU.uCarO.value.setFromMatrixPosition(car.matrixWorld)
      WU.uCarInvR.value.setFromMatrix4(car.matrixWorld).transpose().multiplyScalar(WU.uInvS.value)
      if (waveT < 1) {
        waveT = Math.min(1, waveT + dt / 1.5)
        const e = waveT * waveT * (3 - 2 * waveT)
        car.updateMatrixWorld()
        WU.uCarO.value.setFromMatrixPosition(car.matrixWorld)
        WU.uCarF.value.set(0, 0, 1).transformDirection(car.matrixWorld)
        WU.uHalfL.value = halfL0 * car.scale.x
        WU.uWave.value = 1.15 - 2.3 * e
        WU.uWaveOn.value = Math.min(1, Math.sin(Math.PI * waveT) * 3)
        if (waveT >= 1) { WU.uWave.value = -9; WU.uWaveOn.value = 0 }
      }
      for (const k of available) {
        const t = tw[k]
        if (t.t >= 1) continue
        t.t = Math.min(1, t.t + dt / 0.55)
        const e = t.t * t.t * (3 - 2 * t.t)
        apply(k, e)
      }
    },
  }
}
