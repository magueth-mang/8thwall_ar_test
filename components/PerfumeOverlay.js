'use client'

// Habillage écran de « BLEU INTERDIT » (SPEC_PERFUME §5.5–5.7) : copie DOM de PortalOverlay avec
//   - l'indication en 14 px, interlettrage 0,16em, sur une pastille sombre (rgba(0,0,0,0.5)) ;
//     une indication « A · B » s'affiche sur deux lignes (A, puis B) pour rester lisible sur 390 pt ;
//   - cinematicStates (bandes cinéma) = { intro, exiting, finale, returning } par défaut ;
//   - endCard affichée dans l'état « closed » (objet PB_COPY.endCard ou nœud React) ;
//   - REJOUER devient un bouton centré de 13 px dans « closed » ; ailleurs le petit bouton est en haut à droite,
//     SOUS le titre (sur 390 pt, « YVES SAINT LAURENT » espacé à 0,42em occupe ~230 px et chevauchait le bouton) ;
//   - prefers-reduced-motion : transitions de 0,2 s.
// Le cœur de l'interaction reste l'interface AR dans la scène ; tout ici laisse passer les touchers
// (pointerEvents none) sauf les boutons REJOUER.

import { isValidElement, useEffect, useState } from 'react'

const GOLD = '#C9A45C', CREAM = '#EFE9DC'
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif"
const SANS = "'Helvetica Neue', Arial, sans-serif"
const DEFAULT_CINEMATIC = ['intro', 'exiting', 'finale', 'returning']

function useReducedMotion() {
  const [rm, setRm] = useState(false)
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    if (!mq) return undefined
    const on = () => setRm(mq.matches)
    on()
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on)
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on) }
  }, [])
  return rm
}

function EndCard({ card }) {
  if (isValidElement(card)) return card
  const c = card || {}
  return (
    <div style={{ textAlign: 'center', fontFamily: SANS }}>
      {c.brand && <div style={{ fontFamily: SERIF, fontSize: 11, letterSpacing: '0.42em', paddingLeft: '0.42em', color: GOLD }}>{c.brand}</div>}
      <div style={{ width: 44, height: 1, background: GOLD, margin: '10px auto 8px', opacity: 0.85 }} />
      {c.name && <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 32, lineHeight: 1.1, color: CREAM }}>{c.name}</div>}
      {c.quote && <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, lineHeight: 1.35, color: CREAM, opacity: 0.92, marginTop: 10 }}>{c.quote}</div>}
      {c.disclaimer && (
        <div style={{ fontSize: 10, letterSpacing: '0.16em', paddingLeft: '0.16em', textTransform: 'uppercase', lineHeight: 1.5, color: CREAM, opacity: 0.66, marginTop: 14 }}>{c.disclaimer}</div>
      )}
      {c.cta && <div style={{ fontSize: 11, letterSpacing: '0.12em', paddingLeft: '0.12em', lineHeight: 1.45, color: GOLD, marginTop: 8 }}>{c.cta}</div>}
    </div>
  )
}

export function PerfumeOverlay({
  view, status, onReplay, bottomOffset = 0, title = 'Jardin Majorelle',
  cinematicStates = DEFAULT_CINEMATIC, endCard = null, titleVisible = true, children,
}) {
  const rm = useReducedMotion()
  const state = view?.state
  const cine = (cinematicStates instanceof Set ? cinematicStates : new Set(cinematicStates)).has(state)
  const closed = state === 'closed'
  const t = (s) => `${rm ? 0.2 : s}s`
  const bar = (top) => ({
    position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: '11vh', background: '#000',
    transform: `translateY(${cine ? '0' : top ? '-100%' : '100%'})`, transition: `transform ${t(0.9)} cubic-bezier(.65,0,.35,1)`,
  })
  const lines = status ? String(status).split(' · ') : []
  // en AR, l'en-tête n'apparaît que lorsque l'affiche est suivie (titleVisible = tracking)
  const showTitle = titleVisible && !cine && !(closed && endCard)

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1000000 }}>
      <div style={bar(true)} />
      <div style={bar(false)} />
      <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 18px)', left: 0, right: 0, textAlign: 'center', opacity: showTitle ? 1 : 0, transition: `opacity ${t(0.6)}` }}>
        <div style={{ fontFamily: SERIF, fontSize: 11, letterSpacing: '0.42em', paddingLeft: '0.42em', color: GOLD }}>YVES SAINT LAURENT</div>
        <div style={{ fontFamily: SERIF, fontSize: 18, color: CREAM, marginTop: 6, fontStyle: 'italic' }}>{title}</div>
      </div>

      {/* carton de fin + REJOUER centré (état closed) */}
      <div style={{
        position: 'absolute', left: 16, right: 16, bottom: `calc(env(safe-area-inset-bottom,0px) + ${96 + bottomOffset}px)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        opacity: closed ? 1 : 0, transform: `translateY(${closed || rm ? 0 : 10}px)`, transition: `opacity ${t(0.7)}, transform ${t(0.7)}`,
      }}>
        {endCard && (
          <div style={{
            maxWidth: 340, padding: '18px 22px 16px', borderRadius: 3,
            background: 'radial-gradient(120% 140% at 50% 0%, rgba(26,23,16,0.86) 0%, rgba(6,5,4,0.86) 70%)',
            border: `1px solid ${GOLD}55`, boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
          }}>
            <EndCard card={endCard} />
          </div>
        )}
        <button
          onClick={onReplay}
          tabIndex={closed ? 0 : -1}
          aria-hidden={!closed}
          style={{
            pointerEvents: closed ? 'auto' : 'none', background: 'rgba(0,0,0,0.55)', color: CREAM, border: `1px solid ${GOLD}`,
            borderRadius: 999, padding: '11px 26px', paddingLeft: 'calc(26px + 0.22em)', fontFamily: SANS, fontSize: 13, letterSpacing: '0.22em',
            minWidth: 150, minHeight: 44,
          }}
        >
          REJOUER
        </button>
      </div>

      {/* indication : 14 px, 0,16em, pastille sombre */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: `calc(env(safe-area-inset-bottom,0px) + ${34 + bottomOffset}px)`,
        display: 'flex', justifyContent: 'center', opacity: lines.length ? 1 : 0, transition: `opacity ${t(0.5)}`,
      }}>
        <div style={{
          maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: '9px 18px', paddingLeft: 'calc(18px + 0.16em)', borderRadius: 22,
          background: 'rgba(0,0,0,0.5)', color: CREAM, fontFamily: SANS, fontSize: 14, lineHeight: 1.4, letterSpacing: '0.16em',
          textTransform: 'uppercase', textAlign: 'center', textShadow: '0 1px 6px rgba(0,0,0,0.6)',
        }}>
          {lines.map((l, i) => <div key={i} style={{ opacity: i ? 0.82 : 1 }}>{l}</div>)}
        </div>
      </div>

      {children}

      <button
        onClick={onReplay}
        tabIndex={cine || closed ? -1 : 0}
        aria-hidden={cine || closed}
        style={{
          pointerEvents: cine || closed ? 'none' : 'auto', position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 66px)', right: 12,
          background: 'rgba(0,0,0,0.45)', color: CREAM, border: `1px solid ${GOLD}88`, borderRadius: 999,
          padding: '8px 14px', fontSize: 10, letterSpacing: '0.22em', paddingLeft: 'calc(14px + 0.22em)',
          opacity: cine || closed ? 0 : 1, transition: `opacity ${t(0.5)}`,
        }}
      >
        REJOUER
      </button>
    </div>
  )
}

export default PerfumeOverlay
