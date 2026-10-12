// Jardin Majorelle — chargement de la cour bakée (blender/bake_majorelle.py).
//
// interior.json décrit le repère (K, X_OFF, Z_OFF : jardin en mètres → unités marqueur) et les cartes
// de lumière par atlas. Rendu : MeshBasicMaterial, couleur = texture de détail × carte de lumière
// (encodage (E / LM_SCALE)^(1/2.2), lu en sRGB) ; les bougainvilliers portent lumière × albédo dans
// leurs couleurs de sommets (/ VC_SCALE). Tone mapping attendu : AgX (même rendu que Blender).

import * as THREE from 'three'

/** Cherche interior.json puis interior_test.json ; null si aucune cour bakée n'est publiée. */
export async function pickMajorelleInterior(base = '/majorelle') {
  for (const sfx of ['', '_test']) {
    try {
      const r = await fetch(`${base}/interior${sfx}.json`, { cache: 'no-store' })
      if (r.ok) return { meta: await r.json(), glbUrl: `${base}/mj_interior${sfx}.glb` }
    } catch {}
  }
  return null
}

// CÈDRE (lib/majorelle/cedarAnswer.js, CEDAR_GOLD) — crochet OPT-IN : seul le directeur du parfum passe `gold`.
// Une bande de lumière (front s = −z + 0,55·y en mètres jardin) puis une rémanence éclairent la cour. Tout l'étalonnage
// se fait APRÈS AgX (linéaire d'affichage) : exposition (bande plus vive que la rémanence), teinte d'heure dorée, éclat
// de feuille d'or sur les texels clairs, puis épaule douce vers un plafond par canal max(soi, uMjGoldK.y) — un texel déjà
// clair ne s'éclaircit jamais (le halo additif du flacon, renderOrder 9, s'y ajoute : mesuré, sinon le mur sature).
// À uMjGold.z = .w = 0 les branches (sur uniform) sont sautées : sortie identique. Clé 'mj-agx-gold', aucun define.
const MJ_GOLD_VERT_PARS = 'uniform vec4 uMjFrame;\nvarying vec3 vMjG;'
const MJ_GOLD_VERT = 'vMjG = vec3( transformed.x - uMjFrame.x, transformed.y - uMjFrame.y, transformed.z ) * uMjFrame.z;' // objet = marqueur
const MJ_GOLD_FRAG_PARS = 'uniform vec4 uMjGold;\nuniform vec3 uMjGoldTint;\nuniform float uMjGoldGain;\nuniform vec4 uMjGoldK;\nvarying vec3 vMjG;'
// uMjGoldGain : exposition à pleine rémanence ; uMjGoldTint : teinte d'heure dorée ;
// uMjGoldK : x exposition de la bande (en plus), y plafond (linéaire d'affichage), z dépassement du plafond dans la bande, w feuille d'or
const MJ_GOLD_PRE = `
	float mjK = 0.0, mjBand = 0.0;
	if ( uMjGold.z + uMjGold.w > 0.0 ) {
		float mjS = - vMjG.z + 0.55 * vMjG.y;
		float mjQ = ( mjS - uMjGold.x ) / uMjGold.y;
		mjBand = exp( - mjQ * mjQ ) * uMjGold.z;
		mjK = clamp( mjBand + uMjGold.w * ( 1.0 - smoothstep( uMjGold.x - 1.4, uMjGold.x + 0.4, mjS ) ), 0.0, 1.5 );
	}
`
const MJ_GOLD_POST = `
	if ( mjK > 0.0 ) {
		vec3 mjC = gl_FragColor.rgb;
		float mjL = dot( mjC, vec3( 0.2126, 0.7152, 0.0722 ) );
		float mjMx = max( max( mjC.r, mjC.g ), mjC.b );
		// le bleu Majorelle reste bleu (plus lumineux, pas grisé par la teinte chaude) ; le reste vire à l'or
		float mjBlue = smoothstep( 0.05, 0.35, ( mjC.b - mjC.r ) / max( mjMx, 1e-3 ) );
		vec3 mjW = mjC * mix( uMjGoldTint, vec3( 1.0, 0.98, 1.0 ), 0.8 * mjBlue ) * ( 1.0 + ( uMjGoldGain - 1.0 ) * mjK + uMjGoldK.x * mjBand );
		mjW += vec3( 1.0, 0.72, 0.38 ) * ( smoothstep( 0.3, 0.7, mjL ) * uMjGoldK.w * mjBand );
		// plafond doux qui garde la teinte : le canal le plus fort ne dépasse jamais max(son niveau d'origine, uMjGoldK.y)
		float mjT = max( mjMx, min( max( mjMx, uMjGoldK.y ) * ( 1.0 + uMjGoldK.z * mjBand ), 0.96 ) ), mjS0 = 0.7 * mjT;  // la bande passe un peu au-dessus
		float mjM = max( max( mjW.r, mjW.g ), mjW.b );
		mjW *= ( mjM > mjS0 ? mjS0 + ( mjT - mjS0 ) * ( 1.0 - exp( - ( mjM - mjS0 ) / ( mjT - mjS0 ) ) ) : mjM ) / max( mjM, 1e-4 );
		gl_FragColor.rgb = mix( mjC, mjW, smoothstep( 0.0, 0.6, mjK ) );
	}
`
const AGX_LINE = 'gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );'

// La cour est bakée sous la vue AgX de Blender ; le produit, lui, est réglé sous Neutral (teintes validées).
// Le renderer reste en Neutral et les matériaux de la cour appliquent AgX eux-mêmes.
function forceAgX(m, gold = null) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>', gold ? MJ_GOLD_PRE + AGX_LINE + MJ_GOLD_POST : AGX_LINE)
    if (gold) { // CÈDRE : uniforms partagés (mêmes objets pour toute la cour) + coordonnées jardin interpolées
      Object.assign(sh.uniforms, gold)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + MJ_GOLD_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + MJ_GOLD_VERT)
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + MJ_GOLD_FRAG_PARS)
    }
  }
  m.customProgramCacheKey = gold ? () => 'mj-agx-gold' : () => 'mj-agx'
  return m
}

// Le dôme de ciel déborde devant l'affiche (z > 0) et l'occulteur exporté ne couvre que ±2,5 marqueur : vu de loin
// ou de biais, le ciel apparaissait autour de l'affiche. On prolonge l'occulteur par une jupe (profondeur seule) et
// on coupe le ciel devant le plan du marqueur (ses sommets sont exportés directement en unités marqueur).
function skirtOccluder(occ, R = 60) {
  occ.geometry.computeBoundingBox()
  const b = occ.geometry.boundingBox, z = (b.min.z + b.max.z) / 2
  const pos = []
  for (const [x0, x1, y0, y1] of [[-R, b.min.x, -R, R], [b.max.x, R, -R, R], [b.min.x, b.max.x, b.max.y, R], [b.min.x, b.max.x, -R, b.min.y]]) {
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const skirt = new THREE.Mesh(g, occ.material)
  skirt.name = 'Portal_OccluderSkirt'
  skirt.renderOrder = -1
  skirt.frustumCulled = false
  skirt.position.copy(occ.position); skirt.quaternion.copy(occ.quaternion); skirt.scale.copy(occ.scale)
  occ.parent.add(skirt)
}

function clipSkyInFront(m, gold = null) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMjZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMjZ = position.z;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMjZ;' + (gold ? '\nuniform vec2 uMjGoldSky;' : ''))
      .replace('void main() {', 'void main() {\n\tif ( vMjZ > -0.002 ) discard;')
    if (gold) { // CÈDRE (P2) : le ciel se réchauffe pendant la rémanence (visible dans la vue proche) ; neutre à 0
      // teinte gardée sous un plafond : le canal le plus fort ne dépasse jamais 0,98 × son niveau d'origine (ciel clair :
      // la version additive écrêtait 17 % de la vue proche, mesuré)
      sh.uniforms.uMjGoldSky = gold.uMjGoldSky
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `if ( uMjGoldSky.x > 0.0 ) {
		vec3 mjC = gl_FragColor.rgb, mjW = mjC * vec3( 1.16, 1.0, 0.8 ) + vec3( 0.05, 0.025, 0.0 );
		float mjM = max( max( mjW.r, mjW.g ), mjW.b ), mjT = max( max( max( mjC.r, mjC.g ), mjC.b ) * 0.98, 0.6 );
		gl_FragColor.rgb = mix( mjC, mjW * min( 1.0, mjT / max( mjM, 1e-4 ) ), uMjGoldSky.x );
	}
	#include <dithering_fragment>`)
    }
  }
  m.customProgramCacheKey = gold ? () => 'mj-sky-clip-gold' : () => 'mj-sky-clip'
}

/** Remplace les matériaux exportés par des MeshBasicMaterial à carte de lumière / couleurs de sommets.
 *  Le renderer doit avoir un tone mapping actif (Neutral conseillé) : les fonctions AgX sont alors compilées.
 *  `gold` (facultatif, directeur du parfum seulement) : CEDAR_GOLD de lib/majorelle/cedarAnswer.js — branche la
 *  lumière dorée de la note CÈDRE sur la cour et le ciel ; uMjFrame est rempli ici (X_OFF, Z_OFF, 1/K). */
export function applyMajorelleMaterials(root, meta, base = '/majorelle', { gold = null } = {}) {
  if (gold && gold.uMjFrame) gold.uMjFrame.value.set(meta.X_OFF, meta.Z_OFF, 1 / meta.K, 0)
  const tl = new THREE.TextureLoader()
  const maps = {}
  const textures = []
  for (const [atlas, file] of Object.entries(meta.lightmaps || {})) {
    const t = tl.load(`${base}/${file}`)
    t.colorSpace = THREE.SRGBColorSpace
    t.flipY = false
    t.channel = atlas === 'PLANTS' ? 0 : 1 // plantes : un seul jeu d'UV (BakeUV)
    maps[atlas] = t
    textures.push(t)
  }
  const vlit = meta.vertexLit || {}
  const occluders = []
  root.traverse((o) => {
    if (!o.isMesh) return
    if (o.name === 'Portal_Occluder') { o.material.colorWrite = false; o.renderOrder = -1; occluders.push(o); return } // profondeur seule
    if (o.name === 'Sky') { o.material.toneMapped = false; o.material.depthWrite = false; o.renderOrder = 0; clipSkyInFront(o.material, gold); return }
    let n = o, atlas = null
    while (n && !atlas) { atlas = n.userData?.atlas; n = n.parent }
    if (!atlas || (!maps[atlas] && !vlit[atlas])) return
    const old = o.material
    o.material = forceAgX(vlit[atlas]
      ? new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color().setScalar(vlit[atlas]), side: old.side })
      : new THREE.MeshBasicMaterial({
        map: old.map || null, color: old.color ? old.color.clone() : new THREE.Color(1, 1, 1),
        lightMap: maps[atlas], lightMapIntensity: meta.LM_SCALE * Math.PI, side: old.side,
      }), gold)
    if (old.map) textures.push(old.map)
    old.dispose()
  })
  occluders.forEach((o) => skirtOccluder(o))
  return textures
}

/** Repère jardin (mètres, three.js) → unités marqueur : x' = X_OFF + K·x, y' = Z_OFF + K·y, z' = K·z. */
export function gardenToMarker(meta, x, y, z, out = new THREE.Vector3()) {
  return out.set(meta.X_OFF + meta.K * x, meta.Z_OFF + meta.K * y, meta.K * z)
}
export function markerToGarden(meta, v, out = new THREE.Vector3()) {
  return out.set((v.x - meta.X_OFF) / meta.K, (v.y - meta.Z_OFF) / meta.K, v.z / meta.K)
}
