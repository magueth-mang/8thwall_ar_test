// « BLEU INTERDIT » — réfraction du fond RÉEL (retour téléphone : à travers le flacon on ne voyait que l'affiche
// figée / la sonde / l'HDR, jamais la cour 3D, les koï, les nénuphars ni l'image caméra).
//
// Juste avant de dessiner le jus (premier élément transparent du flacon), on copie ce qui est déjà dans le tampon
// de rendu — image caméra 8th Wall, affiche, cour, eau, koï, fleurs — dans une FramebufferTexture de la taille du
// viewport. Le verre et le jus l'échantillonnent le long de leur rayon réfracté (pbScreen, perfumeShaders.js).
//   - copie au plus une fois par image (renderer.info.render.frame), seulement vers l'écran (pas de cible de rendu) ;
//   - uScreenK = 0 tant que le flacon est dans la cour (le jus y est dessiné avant l'eau : la copie serait incomplète)
//     et quand aucune copie valide n'existe → les shaders gardent leur fond d'avant (sonde / affiche) ;
//   - texture RGB8 dimensionnée : copie valide depuis un tampon RGBA8 (8th Wall : alpha true) comme RGB8 (alpha false) ;
//     la première copie est contrôlée (gl.getError) et, en cas d'échec, on retombe définitivement sur l'ancien fond ;
//   - aucun nouveau programme : seule la valeur des uniforms change (le sampler pointe d'abord sur 1 px gris).
// 8th Wall (xr.js) : la caméra est dessinée dans le même tampon par défaut avant renderer.render, viewport restauré.

import * as THREE from 'three'

export function createScreenGrab() {
  const grey = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)
  grey.needsUpdate = true
  const uniforms = {
    uScreen: { value: grey },
    uScreenK: { value: 0 },
    uScreenPx: { value: new THREE.Vector2(1, 1) },
  }
  const _vp = new THREE.Vector4(), _pos = new THREE.Vector2()
  let tex = null, lastFrame = -1, wanted = 0, checked = false, broken = false

  // appelé par onBeforeRender du jus et du verre (le premier des deux qui est dessiné copie)
  function grab(renderer) {
    if (broken || wanted <= 0.001 || renderer.getRenderTarget() !== null) { uniforms.uScreenK.value = 0; return }
    const frame = renderer.info.render.frame
    if (frame === lastFrame) return
    lastFrame = frame
    // viewport en pixels physiques, sans requête GL ni allocation (8th Wall restaure le viewport après la caméra)
    renderer.getCurrentViewport(_vp)
    const w = _vp.z, h = _vp.w
    if (w < 2 || h < 2) { uniforms.uScreenK.value = 0; return }
    if (!tex || tex.image.width !== w || tex.image.height !== h) {
      if (tex) tex.dispose()
      tex = new THREE.FramebufferTexture(w, h)
      tex.format = THREE.RGBFormat; tex.internalFormat = 'RGB8' // jamais de colorSpace ici : le shader décode lui-même
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false
      uniforms.uScreen.value = tex
      uniforms.uScreenPx.value.set(w, h)
      checked = false
    }
    const gl = renderer.getContext()
    if (!checked) for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++);
    _pos.set(_vp.x, _vp.y)
    renderer.copyFramebufferToTexture(tex, _pos)
    if (!checked) {
      checked = true
      const err = gl.getError()
      if (err !== gl.NO_ERROR) {
        broken = true; uniforms.uScreenK.value = 0; uniforms.uScreen.value = grey
        console.warn('[screenRefraction] copie impossible (0x' + err.toString(16) + ') → fond d\'avant')
        return
      }
    }
    uniforms.uScreenK.value = wanted
  }

  return {
    uniforms,
    grab,
    /** 0 → fond d'avant (sonde / affiche), 1 → fond réel copié */
    setAmount(k) { wanted = k },
    dispose() { if (tex) tex.dispose(); grey.dispose() },
  }
}
