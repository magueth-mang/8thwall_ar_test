// Re-éclairage live de la salle bakée.
// Chaque atlas (MAT_FLOOR / MAT_WALLS / MAT_PROPS) a une carte compagnon T_<ATLAS>_LF.jpg :
// pour chaque texel, la part de lumière venant des groupes R = architecture (coupole, plafonniers,
// lèche-murs), G = accents (niches, appliques, arche, pilastres), B = héros (spot du socle, lueurs).
// On repondère ces parts dans le shader → allumage en séquence, pénombre, focus… sans re-baker.

import * as THREE from 'three'

const ATLASES = ['FLOOR', 'WALLS', 'PROPS']

export function createLightRig(interiorRoot, { baseUrl = '/ysl-portal' } = {}) {
  const weights = new THREE.Vector3(1, 1, 1)
  const grade = { value: 1 }
  const uniforms = { uLW: { value: weights }, uGrade: grade }
  const loader = new THREE.TextureLoader()
  const lfLoads = []

  interiorRoot.traverse((o) => {
    if (!o.isMesh || !o.material?.name) return
    const atlas = ATLASES.find((a) => o.material.name === `MAT_${a}`)
    if (!atlas) return
    let lf
    lfLoads.push(new Promise((res) => { lf = loader.load(`${baseUrl}/T_${atlas}_LF.jpg`, res, undefined, () => res(null)) }))
    lf.colorSpace = THREE.NoColorSpace
    lf.flipY = false // mêmes UV que les textures glTF
    lf.generateMipmaps = false; lf.minFilter = THREE.LinearFilter // carte très douce : pas besoin de mipmaps
    const mat = o.material
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uLF = { value: lf }
      shader.uniforms.uLW = uniforms.uLW
      shader.uniforms.uGrade = uniforms.uGrade
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uLF;\nuniform vec3 uLW;\nuniform float uGrade;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 lf = texture2D( uLF, vMapUv ).rgb;
          float lfSum = max( lf.r + lf.g + lf.b, 1e-3 );
          diffuseColor.rgb *= ( dot( lf, uLW ) / lfSum ) * uGrade;`)
    }
    mat.customProgramCacheKey = () => 'ysl-lightrig'
    mat.needsUpdate = true
  })

  // tweening interne : on vise des cibles, update(dt) s'en approche avec une constante de temps
  const target = { arch: 1, accent: 1, hero: 1, grade: 1 }
  const speed = { arch: 4, accent: 4, hero: 4, grade: 4 }
  const cur = { arch: 1, accent: 1, hero: 1, grade: 1 }

  return {
    /** résolu quand les cartes de lumière sont chargées (pour les pré-envoyer au GPU) */
    loaded: Promise.all(lfLoads),
    /** Valeurs immédiates. */
    set({ arch, accent, hero, grade: g } = {}) {
      for (const [k, v] of Object.entries({ arch, accent, hero, grade: g })) if (v !== undefined) { cur[k] = target[k] = v }
    },
    /** Transition douce vers des cibles (rate = 1/s, plus grand = plus rapide). */
    to(values, rate = 3) {
      for (const [k, v] of Object.entries(values)) if (k in target) { target[k] = v; speed[k] = rate }
    },
    get: () => ({ ...cur }),
    update(dt) {
      for (const k of Object.keys(cur)) cur[k] += (target[k] - cur[k]) * Math.min(1, dt * speed[k])
      weights.set(cur.arch, cur.accent, cur.hero)
      grade.value = cur.grade
    },
  }
}
