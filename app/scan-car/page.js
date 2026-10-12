'use client'

import Script from 'next/script'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAR_INFO } from '@/lib/car/carSpecs'

// Expérience concession : voiture à taille réelle posée au sol (SLAM 8th Wall), présentée et configurée en AR.
const ARCarPlace = dynamic(() => import('@/components/ARCarPlace'), { ssr: false })
const MODEL_URL = '/car/bmw_x7.glb' // même fichier que la page AR (cache)

// le modèle se télécharge pendant que le visiteur lit l'écran d'accueil (même URL → cache pour la page AR)
let preload = null
function preloadModel(onProgress) {
  if (preload) { preload.listeners.add(onProgress); onProgress(preload.k); return preload }
  preload = { k: 0, listeners: new Set([onProgress]) }
  const emit = (k) => { preload.k = k; preload.listeners.forEach((f) => f(k)) }
  fetch(MODEL_URL).then(async (r) => {
    const total = Number(r.headers.get('content-length')) || 0
    if (!r.body || !total) { await r.arrayBuffer(); emit(1); return }
    const rd = r.body.getReader(); let got = 0
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; emit(Math.min(0.99, got / total)) }
    emit(1)
  }).catch(() => emit(1))
  return preload
}

export default function ScanCarPage() {
  const router = useRouter()
  const [engineLoaded, setEngineLoaded] = useState(false)
  const [extrasLoaded, setExtrasLoaded] = useState(false)
  const [started, setStarted] = useState(false)
  const ready = engineLoaded && extrasLoaded

  async function start() {
    try {
      const DME = window.DeviceMotionEvent
      if (DME && typeof DME.requestPermission === 'function') await DME.requestPermission()
    } catch (e) { console.warn('DeviceMotion permission', e) }
    setStarted(true)
  }

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#07080a', WebkitUserSelect: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <Script src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js" strategy="afterInteractive" crossOrigin="anonymous" data-preload-chunks="slam" onLoad={() => setEngineLoaded(true)} onReady={() => setEngineLoaded(true)} />
      <Script src="https://cdn.jsdelivr.net/npm/@8thwall/xrextras/dist/xrextras.js" strategy="afterInteractive" crossOrigin="anonymous" onLoad={() => setExtrasLoaded(true)} onReady={() => setExtrasLoaded(true)} />

      {started && ready ? <ARCarPlace /> : <Welcome ready={ready} onStart={start} />}

      <button onClick={() => router.push('/')} aria-label="Retour" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', left: 14, zIndex: 1000001, color: '#fff', background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, width: 38, height: 38, fontSize: 20, lineHeight: '34px', padding: 0 }}>‹</button>
    </main>
  )
}

// ---- écran d'accueil : lancement de modèle, fond studio noir, typographie fine, chargement intégré au bouton ----
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const track = (em) => ({ letterSpacing: `${em}em`, paddingLeft: `${em}em` })

function Icon({ d, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  )
}
const ICONS = {
  scale: <><path d="M3 17 17 3l4 4L7 21z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" /></>,
  points: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" strokeOpacity="0.5" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></>,
  palette: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.4" fill="currentColor" /><circle cx="12" cy="7.5" r="1.4" fill="currentColor" /><circle cx="16" cy="10" r="1.4" fill="currentColor" /><path d="M12 21c-1.5-2-1-4 1.5-4H17" /></>,
  space: <><rect x="3" y="7" width="18" height="10" rx="2" strokeDasharray="2.5 2.5" /><path d="M7 12h10M7 12l2-2M7 12l2 2M17 12l-2-2M17 12l-2 2" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
}

function Welcome({ ready, onStart }) {
  const [k, setK] = useState(0)
  const [shown, setShown] = useState(false)
  useEffect(() => { preloadModel(setK); const t = setTimeout(() => setShown(true), 30); return () => clearTimeout(t) }, [])
  const appear = (i) => ({ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(14px)', transition: `opacity 1s ${0.15 + i * 0.12}s, transform 1.2s cubic-bezier(.2,.7,.2,1) ${0.15 + i * 0.12}s` })
  const canStart = ready
  const pct = Math.round(k * 100)
  const label = !ready ? 'Préparation…' : k < 1 ? `Entrer · véhicule ${pct} %` : 'Entrer dans l’expérience'

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', color: '#fff', fontFamily: FONT, display: 'flex', flexDirection: 'column', background: 'radial-gradient(130% 80% at 50% 40%, #0b0c0f 0%, #07080a 50%, #030304 100%)' }}>
      <style>{`
        @keyframes mjSweep { 0% { transform: translateX(-60%) skewX(-18deg) } 60%, 100% { transform: translateX(160%) skewX(-18deg) } }
        @keyframes mjFloat { 0%, 100% { transform: scale(1.02) translateY(0) } 50% { transform: scale(1.045) translateY(-4px) } }
        @media (max-height: 720px) { .mj-feat { display: none !important } .mj-tag { font-size: 14px !important } .mj-title { font-size: 32px !important } }
      `}</style>

      {/* en-tête */}
      <div style={{ flex: 'none', paddingTop: 'calc(env(safe-area-inset-top,0px) + 26px)', padding: 'calc(env(safe-area-inset-top,0px) + 26px) 64px 0', textAlign: 'center', ...appear(0) }}>
        <div style={{ fontSize: 9.5, fontWeight: 500, color: 'rgba(255,255,255,0.55)', ...track(0.32) }}>EXPÉRIENCE EN RÉALITÉ AUGMENTÉE</div>
      </div>

      {/* filigrane géant + voiture studio */}
      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', top: '2%', left: 0, right: 0, textAlign: 'center', fontSize: 'min(52vw, 32vh, 300px)', fontWeight: 100, lineHeight: 1, color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.10)', ...appear(1) }}>X7</div>
        <div style={{ position: 'relative', width: 'min(128vw, 820px)', height: '100%', maxHeight: 560, ...appear(2) }}>
          <div style={{ position: 'absolute', inset: 0, background: 'url(/car/hero.jpg) center / contain no-repeat', animation: 'mjFloat 9s ease-in-out infinite',
            WebkitMaskImage: 'radial-gradient(62% 58% at 52% 54%, #000 62%, transparent 100%)', maskImage: 'radial-gradient(62% 58% at 52% 54%, #000 62%, transparent 100%)' }} />
          {/* reflet qui balaie la carrosserie */}
          <div style={{ position: 'absolute', inset: '18% 8% 22% 8%', overflow: 'hidden', mixBlendMode: 'screen', WebkitMaskImage: 'radial-gradient(60% 60% at 50% 55%, #000 50%, transparent 100%)', maskImage: 'radial-gradient(60% 60% at 50% 55%, #000 50%, transparent 100%)' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '22%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)', animation: 'mjSweep 6s ease-in-out 1.6s infinite' }} />
          </div>
          {/* sol : reflet studio */}
          <div style={{ position: 'absolute', left: '12%', right: '12%', bottom: '14%', height: 2, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)', filter: 'blur(1px)' }} />
        </div>
      </div>

      {/* bloc texte + actions */}
      <div style={{ flex: 'none', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 22px)', padding: '0 26px calc(env(safe-area-inset-bottom,0px) + 22px)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)', ...track(0.6), ...appear(3) }}>{CAR_INFO.maker.toUpperCase()}</div>
        <div className="mj-title" style={{ fontSize: 40, fontWeight: 200, lineHeight: 1.05, marginTop: 10, letterSpacing: '0.01em', ...appear(3) }}>{CAR_INFO.model}</div>
        <div style={{ width: 56, height: 1, margin: '18px 0 16px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)', ...appear(4) }} />
        <div className="mj-tag" style={{ fontSize: 16, fontWeight: 300, color: 'rgba(255,255,255,0.86)', lineHeight: 1.5, maxWidth: 320, ...appear(4) }}>
          Le showroom vient à vous. Posez le véhicule chez vous, à taille réelle, puis découvrez-le et configurez-le.
        </div>

        {/* trois promesses */}
        <div className="mj-feat" style={{ display: 'flex', gap: 10, marginTop: 24, width: '100%', maxWidth: 380, ...appear(5) }}>
          {[['scale', 'Taille réelle'], ['points', '6 points d’intérêt'], ['palette', 'Configurateur']].map(([ic, t]) => (
            <div key={t} style={{ flex: 1, padding: '14px 6px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
              <Icon d={ICONS[ic]} />
              <div style={{ fontSize: 9.5, fontWeight: 500, lineHeight: 1.3, color: 'rgba(255,255,255,0.75)', ...track(0.14) }}>{t.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* bouton : la jauge de chargement du véhicule est le remplissage du bouton */}
        <button onClick={onStart} disabled={!canStart} style={{
          position: 'relative', overflow: 'hidden', marginTop: 22, width: '100%', maxWidth: 380, height: 58, borderRadius: 999, border: 'none',
          background: canStart ? '#f4f4f2' : 'rgba(255,255,255,0.08)', color: canStart ? '#0a0a0b' : 'rgba(255,255,255,0.5)',
          fontFamily: FONT, fontSize: 12.5, fontWeight: 600, ...track(0.22), cursor: canStart ? 'pointer' : 'default',
          boxShadow: canStart ? '0 18px 50px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.9)' : 'none', transition: 'background .4s, color .4s', ...appear(6),
        }}>
          {canStart && k < 1 && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: 'rgba(0,0,0,0.07)', transition: 'width .3s' }} />}
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            {label.toUpperCase()}
            {canStart && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
          </span>
        </button>

        {/* conseils */}
        <div style={{ display: 'flex', gap: 18, marginTop: 16, color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 400, ...appear(7) }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon d={ICONS.space} size={16} /> Espace de 5 × 2 m</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon d={ICONS.light} size={16} /> Sol bien éclairé</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 9, color: 'rgba(255,255,255,0.32)', ...track(0.16), ...appear(7) }}>
          CAMÉRA ET CAPTEURS DE MOUVEMENT REQUIS · {CAR_INFO.footer.toUpperCase()}
        </div>
      </div>
    </div>
  )
}
