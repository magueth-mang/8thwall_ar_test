'use client'

// Habillage écran du portail YSL : bandes cinéma pendant les séquences, indication contextuelle,
// nom de teinte, bouton REJOUER. Le cœur de l'interaction reste l'interface AR dans la scène.

const GOLD = '#C9A45C', CREAM = '#EFE9DC'
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif"
const CINEMATIC = new Set(['intro', 'exiting', 'returning'])

export function PortalOverlay({ view, status, onReplay, bottomOffset = 0, children }) {
  const cine = CINEMATIC.has(view.state)
  const bar = (top) => ({
    position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: '11vh', background: '#000',
    transform: `translateY(${cine ? '0' : top ? '-100%' : '100%'})`, transition: 'transform 0.9s cubic-bezier(.65,0,.35,1)',
  })
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1000000 }}>
      <div style={bar(true)} />
      <div style={bar(false)} />
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 18px)', left: 0, right: 0, textAlign: 'center', opacity: cine ? 0 : 1, transition: 'opacity .6s' }}>
        <div style={{ fontFamily: SERIF, fontSize: 11, letterSpacing: '0.42em', paddingLeft: '0.42em', color: GOLD }}>YVES SAINT LAURENT</div>
        <div style={{ fontFamily: SERIF, fontSize: 18, color: CREAM, marginTop: 6, fontStyle: 'italic' }}>Le Salon Secret</div>
      </div>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: `calc(env(safe-area-inset-bottom,0px) + ${34 + bottomOffset}px)`, textAlign: 'center',
        color: CREAM, textShadow: '0 1px 8px rgba(0,0,0,0.9)', textTransform: 'uppercase', letterSpacing: '0.24em', paddingLeft: '0.24em', fontSize: 11,
        opacity: status ? 1 : 0, transition: 'opacity .5s',
      }}>
        {status}
      </div>
      {children}
      <button
        onClick={onReplay}
        tabIndex={cine ? -1 : 0}
        aria-hidden={cine}
        style={{
          pointerEvents: cine ? 'none' : 'auto', position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 14px)', right: 14,
          background: 'rgba(0,0,0,0.45)', color: CREAM, border: `1px solid ${GOLD}88`, borderRadius: 999,
          padding: '8px 14px', fontSize: 10, letterSpacing: '0.22em', paddingLeft: 'calc(14px + 0.22em)',
          opacity: cine ? 0 : 1, transition: 'opacity .5s',
        }}
      >
        REJOUER
      </button>
    </div>
  )
}
