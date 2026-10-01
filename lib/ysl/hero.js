// Le produit héros : un seul rouge à lèvres (lipstick.glb optimisé, pièces séparées).
// root = groupe dont l'origine est le centre de la base et dont l'échelle = hauteur en unités marqueur
// (le modèle est normalisé à une hauteur de 1).
// - setShade(i) : « repeint » le produit avec une ligne dorée qui monte (shader scan)
// - reveal(d)   : apparition par balayage depuis la base
// - setOpen(b)  : capuchon qui s'envole et se range à droite, raisin qui monte en vissant

import * as THREE from 'three'

const SILVER = new THREE.Color(0.93, 0.93, 0.96) // capuchon = chrome argenté teinté de la nuance

// color = teinte de référence (capuchon chrome + raisin) ; body = corps mat accordé visuellement au capuchon
export const SHADES = [
  { name: 'Rouge', num: 'N°1', color: 0xb5172f, body: 0x93243a },
  { name: 'Lovenude', num: 'N°2', color: 0xe3a092, body: 0xe3a092 },
  { name: 'Corail', num: 'N°3', color: 0xe0603a, body: 0xc4634a },
  { name: 'Pink', num: 'N°4', color: 0xd4466a, body: 0xb44d69 },
  { name: 'Berry', num: 'N°5', color: 0x7e2236, body: 0x7c3047 },
  { name: 'Rosewood', num: 'N°6', color: 0xae4758, body: 0x9a4a59 },
]

const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }
const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }

// uniforms partagés par tous les matériaux du produit
function makeScanUniforms() {
  return {
    uScanOrigin: { value: new THREE.Vector3() },
    uScanAxis: { value: new THREE.Vector3(0, 1, 0) },
    uScanHeight: { value: 1 },
    uScan: { value: 2 },          // hauteur normalisée de la ligne de repeint (2 = terminé)
    uBand: { value: 0 },          // intensité de la ligne dorée
    uReveal: { value: 2 },        // tout ce qui est au-dessus est invisible (apparition)
    uBandColor: { value: new THREE.Color(1.0, 0.78, 0.42).multiplyScalar(2.2) },
  }
}

function patchMaterial(mat, U, tint, neutralSpec = false) {
  const tintU = tint ? { uOld: { value: new THREE.Color() }, uNew: { value: new THREE.Color() } } : null
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, tintU || {})
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uScanOrigin;\nuniform vec3 uScanAxis;\nuniform float uScanHeight;\nvarying float vScanH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvScanH = dot( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - uScanOrigin, uScanAxis ) / uScanHeight;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uScan; uniform float uBand; uniform float uReveal; uniform vec3 uBandColor;
        ${tint ? 'uniform vec3 uOld; uniform vec3 uNew;' : ''}
        varying float vScanH;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        if ( vScanH > uReveal ) discard;
        vec4 diffuseColor = vec4( ${tint ? 'mix( uNew, uOld, step( uScan, vScanH ) )' : 'diffuse'}, opacity );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sBand = exp( -pow2( ( vScanH - uScan ) * 34.0 ) ) * uBand;
        float rBand = exp( -pow2( ( vScanH - uReveal ) * 28.0 ) ) * step( uReveal, 1.2 );
        totalEmissiveRadiance += uBandColor * ( sBand + rBand );`)
    if (neutralSpec) { // l'argent ne prend pas la couleur des lumières : reflets directs en niveaux de gris
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular = vec3( dot( reflectedLight.directSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ) );`)
    }
  }
  mat.customProgramCacheKey = () => `ysl-hero-${tint ? 't' : 'n'}${neutralSpec ? 's' : ''}`
  return tintU
}

export function createHero(gltf) {
  const U = makeScanUniforms()
  const tints = []
  const M = (cfg, tint, neutralSpec = false) => {
    const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.15, ...cfg })
    const t = patchMaterial(m, U, tint, neutralSpec)
    if (t) tints.push({ mat: m, u: t, kind: tint })
    return m
  }
  const silver = M({ color: 0xe9ebef, metalness: 1, roughness: 0.1 }, null, true)
  const black = M({ color: 0x0b0b0b, metalness: 0.2, roughness: 0.3 })
  // capuchon : métal teinté + vernis (reflets argentés) ; teinte éclaircie pour répondre au corps mat
  const capMat = M({ metalness: 1.0, roughness: 0.09, clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 2.1 }, 'cap')
  const bodyMat = M({ metalness: 0.05, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.4 }, 'body')
  const neckMat = M({ metalness: 0.1, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.05 }, 'body')
  const bulletMat = M({ metalness: 0.0, roughness: 0.33, clearcoat: 0.65, clearcoatRoughness: 0.18, sheen: 0.45, sheenRoughness: 0.4, sheenColor: new THREE.Color(1, 0.88, 0.86) }, 'bullet')

  // ---- normalisation : hauteur 1, base au centre --------------------------------
  const model = gltf.scene
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const norm = new THREE.Group()
  norm.scale.setScalar(1 / (size.y || 1))
  model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
  norm.add(model)
  const root = new THREE.Group()
  const spin = new THREE.Group() // rotation propre (idle / drag) séparée du vol
  root.add(spin); spin.add(norm)
  root.updateMatrixWorld(true)

  const byName = (n) => model.getObjectByName(n)
  const matFor = (name) => {
    const n = (name || '').toLowerCase()
    if (n === 'metal_pink') return capMat
    if (n === 'black_glossy') return black
    if (n === 'pink_matte') return bodyMat
    if (n === 'pink_glossy') return neckMat
    if (n.includes('lovenude')) return bulletMat
    return silver // metal (Cassandre), metal_pink_int (fourreau) : argent poli
  }
  model.traverse((o) => { if (o.isMesh) o.material = matFor(o.material?.name) })

  // ---- pivots : capuchon / raisin --------------------------------------------------
  const H0 = size.y
  // le capuchon vit dans le repère du produit SANS la rotation propre : une fois rangé il ne tourne pas autour
  const capPivot = new THREE.Group(); capPivot.position.set(0, 0.0571 / H0, 0); root.add(capPivot)
  const bulletPivot = new THREE.Group(); bulletPivot.position.set(0, 0.058 / H0, 0); spin.add(bulletPivot)
  root.updateMatrixWorld(true)
  ;['LNB_cap', 'LNB_cap_interior'].forEach((n) => { const o = byName(n); if (o) capPivot.attach(o) })
  ;['LBN_Bottle_interior'].forEach((n) => { const o = byName(n); if (o) bulletPivot.attach(o) }) // le fourreau argenté reste en place
  const capRest = capPivot.position.clone(), bulletRest = bulletPivot.position.clone()

  // zone de toucher (cylindre invisible, un peu plus large que le produit)
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.08, 12), new THREE.MeshBasicMaterial({ visible: false }))
  proxy.position.y = 0.52
  root.add(proxy)

  // ---- état ---------------------------------------------------------------------
  let shade = 0
  const setColors = (i, which) => {
    const c = new THREE.Color(SHADES[i].color), body = new THREE.Color(SHADES[i].body ?? SHADES[i].color)
    tints.forEach(({ u, kind }) => {
      const col = kind === 'bullet' ? c.clone().offsetHSL(0, 0.04, 0.04) : kind === 'cap' ? c.clone().lerp(SILVER, 0.28).offsetHSL(0, 0.2, -0.02) : body
      u[which].value.copy(col)
    })
  }
  setColors(0, 'uOld'); setColors(0, 'uNew')

  let scanT = 1, scanDur = 0.9
  let revealT = 1, revealDur = 1.5
  let open = 0, openTarget = 0
  let clock = 0, capSpin = 0
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3()

  return {
    root, spin, proxy, U,
    get shade() { return shade },
    get openAmount() { return open },
    isOpen: () => openTarget > 0.5,
    /** change de teinte ; animate=false pour un changement instantané */
    setShade(i, animate = true) {
      i = ((i % SHADES.length) + SHADES.length) % SHADES.length
      if (i === shade && (scanT >= 1 || animate)) return false
      if (!animate) { shade = i; scanT = 1; U.uScan.value = 2; U.uBand.value = 0; setColors(i, 'uOld'); setColors(i, 'uNew'); return true }
      shade = i
      if (scanT < 1) { setColors(i, 'uNew'); return true } // balayage en cours : on ne change que la couleur sous la ligne
      tints.forEach(({ u }) => u.uOld.value.copy(u.uNew.value))
      setColors(i, 'uNew')
      scanT = 0; U.uBand.value = 1
      return true
    },
    scanProgress: () => scanT,
    /** apparition par balayage depuis la base */
    reveal(duration = 1.5) { revealT = 0; revealDur = duration; U.uReveal.value = -0.05 },
    hideInstant() { revealT = -1; U.uReveal.value = -0.1 },
    setOpen(v) { openTarget = v ? 1 : 0 },
    /** progression manuelle (glisser vers le haut sur le capuchon) */
    setOpenManual(v) { openTarget = v; open = v },
    update(dt) {
      clock += dt
      // repère du scan = base du produit, axe vertical du produit
      root.updateMatrixWorld(true)
      root.matrixWorld.decompose(tmpV, tmpQ, tmpS)
      U.uScanOrigin.value.copy(tmpV)
      U.uScanAxis.value.set(0, 1, 0).applyQuaternion(tmpQ).normalize()
      U.uScanHeight.value = tmpS.y * (1 + 0.12 * smooth(open)) // le raisin sorti dépasse un peu

      if (scanT < 1) {
        scanT = Math.min(1, scanT + dt / scanDur)
        U.uScan.value = -0.05 + smooth(scanT) * 1.2
        U.uBand.value = Math.sin(Math.PI * Math.min(1, scanT * 1.05))
        if (scanT >= 1) { U.uScan.value = 2; U.uBand.value = 0; tints.forEach(({ u }) => u.uOld.value.copy(u.uNew.value)) }
      }
      if (revealT >= 0 && revealT < 1) {
        revealT = Math.min(1, revealT + dt / revealDur)
        U.uReveal.value = -0.05 + smooth(revealT) * 1.25
        if (revealT >= 1) U.uReveal.value = 2
      }

      // ouverture : 0 → 0.4 le capuchon se soulève, 0.35 → 1 il part se ranger ; le raisin monte de 0.45 à 1
      const rate = openTarget > open ? 0.75 : 1.1
      open += Math.sign(openTarget - open) * Math.min(Math.abs(openTarget - open), dt * rate)
      const lift = smooth(open / 0.4)
      const park = smooth((open - 0.35) / 0.65)
      const capH = 0.43
      capPivot.position.set(
        capRest.x + park * 0.44,
        capRest.y + lift * capH * 0.62 * (1 - park) - park * 0.26 + Math.sin(clock * 1.3) * 0.012 * park,
        capRest.z - park * 0.08,
      )
      capSpin += dt * 0.35 * park
      capPivot.rotation.set(0, spin.rotation.y * (1 - park) + lift * 0.6 + park * 1.2 + capSpin, -park * 0.16)
      const tw = smooth((open - 0.45) / 0.55)
      bulletPivot.position.set(bulletRest.x, bulletRest.y + tw * 0.2, bulletRest.z)
    },
    /** point du sommet du capuchon / raisin en espace monde (pour les étincelles) */
    capWorld: (out) => capPivot.getWorldPosition(out),
    bulletTipWorld: (out) => bulletPivot.localToWorld(out.set(0, 0.33, 0)),
    easeOutBack,
  }
}
