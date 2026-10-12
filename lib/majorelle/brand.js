// « BLEU INTERDIT » — charte graphique partagée (affiche golden hour, interface AR, habillage écran).
// Typographies de l'affiche : Bodoni Moda (titres, italiques) + Montserrat (capitales espacées).
// Les textures canvas de l'interface AR ont besoin des polices AVANT de dessiner : await ensureBrandFonts().

export const BRAND = {
  ink: '#16205e',        // encre bleu nuit de l'affiche
  inkDeep: '#0e1234',    // bandeau bas de l'affiche
  gold: '#c9a45c',       // or des médaillons
  goldDeep: '#a77d2c',   // filets dorés de l'affiche
  goldLight: '#e8cf98',  // reflets
  ivory: '#f4e6c8',      // texte clair (bandeau bas)
  cream: '#efe4cf',
  peach: '#fbcf9f',      // horizon du ciel golden hour
  lavender: '#6a7fd0',   // zénith
  serif: "'Bodoni Moda', 'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif",
  sans: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
}

export const BRAND_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400;1,6..96,500&family=Montserrat:wght@300;400;500;600&display=swap'

let fontsPromise = null
/** Injecte la feuille Google Fonts une seule fois et attend les graisses utilisées (≤ 3 s, puis repli). */
export function ensureBrandFonts() {
  if (typeof document === 'undefined') return Promise.resolve(false)
  if (fontsPromise) return fontsPromise
  if (!document.querySelector('link[data-brand-fonts]')) {
    const l = document.createElement('link')
    l.rel = 'stylesheet'; l.href = BRAND_FONTS_HREF; l.setAttribute('data-brand-fonts', '1')
    document.head.appendChild(l)
  }
  const want = [
    '400 48px "Bodoni Moda"', 'italic 400 48px "Bodoni Moda"', '500 48px "Bodoni Moda"',
    '400 24px "Montserrat"', '500 24px "Montserrat"', '600 24px "Montserrat"',
  ]
  const load = Promise.all(want.map((f) => document.fonts?.load?.(f) ?? Promise.resolve())).then(() => true).catch(() => false)
  fontsPromise = Promise.race([load, new Promise((r) => setTimeout(() => r(false), 3000))])
  return fontsPromise
}
