// « BLEU INTERDIT » — préchargement des ressources dès l'écran d'accueil (avant même le bouton ENTRER),
// pour que la scène soit prête et compilée avant que l'affiche soit détectée (pas d'à-coup au scan).
//   - les GLB sont téléchargés en ArrayBuffer et gardés en mémoire : le directeur les PARSE à partir de ces octets
//     (un GLTF neuf à chaque montage, jamais un objet déjà modifié) ;
//   - les textures, sondes et JSON sont simplement demandés une fois pour chauffer le cache HTTP.

import { MJ_CFG } from '@/lib/majorellePortalScene'
import { PB_CFG } from '@/lib/majorelle/perfumeConfig'

const buffers = new Map() // url → Promise<ArrayBuffer | null>
let started = null

function fetchBuffer(url) {
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))
  }
  return buffers.get(url)
}
const warm = (url) => fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null)

/** Octets préchargés d'un GLB (ou null si non préchargé / échec). */
export function getPreloadedBuffer(url) {
  return buffers.has(url) ? buffers.get(url) : Promise.resolve(null)
}

/** Lance (une seule fois) le téléchargement de tout ce dont la scène parfum a besoin. */
export function preloadMajorellePerfume() {
  if (started || typeof window === 'undefined') return started
  const base = MJ_CFG.base, tex = PB_CFG.texBase
  const jobs = [
    fetchBuffer(MJ_CFG.doorUrl),
    fetchBuffer(PB_CFG.bottleUrl),
    warm(PB_CFG.metaUrl),
    warm(MJ_CFG.hdrUrl),
    // cour : interior.json donne le GLB et les cartes de lumière à précharger
    fetch(`${base}/interior.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((meta) => {
      if (!meta) return null
      const more = [fetchBuffer(`${base}/mj_interior.glb`)]
      for (const f of Object.values(meta.lightmaps || {})) more.push(warm(`${base}/${f}`))
      return Promise.all(more)
    }).catch(() => null),
    ...['T_PB_glass.png', 'T_PB_rosette.png', 'T_PB_gold_n.png', 'T_PB_petals.png', 'T_PB_sillage.png', 'T_PB_mist.png',
      'backdrop_poster_512.jpg', 'door_mask_256.png', 'door_arch_path.json'].map((f) => warm(tex + f)),
    ...['pool', 'basin', 'cup'].flatMap((n) => ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((s) => warm(`${base}/fx/probe_${n}_${s}.jpg`))),
  ]
  started = Promise.all(jobs).then(() => true)
  return started
}
