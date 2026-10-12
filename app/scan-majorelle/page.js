'use client'

import Script from 'next/script'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PB_COPY } from '@/lib/majorelle/perfumeConfig'
import { BRAND as B, ensureBrandFonts } from '@/lib/majorelle/brand'
import { preloadMajorellePerfume } from '@/lib/majorelle/preload'

// « BLEU INTERDIT » en AR. La version rouge à lèvres reste sur /scan-majorelle-lipstick.
const ARMajorellePerfume = dynamic(() => import('@/components/ARMajorellePerfume'), { ssr: false })

export default function ScanMajorellePage() {
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
    <main style={{ position: 'fixed', inset: 0, background: '#000', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <Script src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js" strategy="afterInteractive" crossOrigin="anonymous" data-preload-chunks="slam" onLoad={() => setEngineLoaded(true)} onReady={() => setEngineLoaded(true)} />
      <Script src="https://cdn.jsdelivr.net/npm/@8thwall/xrextras/dist/xrextras.js" strategy="afterInteractive" crossOrigin="anonymous" onLoad={() => setExtrasLoaded(true)} onReady={() => setExtrasLoaded(true)} />

      {started && ready ? <ARMajorellePerfume /> : <StartGate ready={ready} onStart={start} />}

      <button onClick={() => router.push('/')} aria-label="Retour" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: 14, zIndex: 1000001, color: B.ivory, background: 'rgba(14,18,52,0.32)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', border: '1px solid rgba(201,164,92,0.55)', borderRadius: 999, width: 38, height: 38, fontFamily: B.serif, fontSize: 20, lineHeight: '34px', padding: 0 }}>‹</button>
    </main>
  )
}

// écran d'accueil dans l'esthétique de l'affiche : l'affiche elle-même en fond, voile d'encre, bloc typographique
function StartGate({ ready, onStart }) {
  // la scène (GLB, textures, sondes, HDR) se télécharge pendant que le visiteur lit l'écran d'accueil
  useEffect(() => { ensureBrandFonts(); preloadMajorellePerfume() }, [])
  const caps = (size, track, weight = 500) => ({ fontFamily: B.sans, fontWeight: weight, fontSize: size, letterSpacing: `${track}em`, paddingLeft: `${track}em`, textTransform: 'uppercase' })
  const rule = (w) => ({ width: w, height: 1, background: `linear-gradient(90deg, transparent, ${B.gold}, transparent)` })
  // typographie française : espaces insécables dans les guillemets et avant le deux-points
  const tagline = '« ' + PB_COPY.tagline.replace(' :', ' :') + ' »'
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: B.inkDeep }}>
      <div style={{ position: 'absolute', inset: -12, background: 'url(/majorelle/marker_door_2k.png) center 30% / cover no-repeat', filter: 'blur(2px) saturate(1.05)', transform: 'scale(1.04)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(14,18,52,0.96) 0%, rgba(14,18,52,0.86) 38%, rgba(14,18,52,0.35) 68%, rgba(14,18,52,0.15) 100%)' }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom,0px) + 34px)', padding: '0 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: B.ivory,
      }}>
        <div style={{ ...caps(11, 0.52), color: B.goldLight }}>YVES SAINT LAURENT</div>
        <div style={{ ...rule(48), margin: '14px 0 12px' }} />
        <div style={{ fontFamily: B.serif, fontWeight: 400, fontSize: 46, lineHeight: 1, letterSpacing: '0.04em' }}>{PB_COPY.cartel.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <div style={rule(30)} /><span style={{ ...caps(9.5, 0.5), color: B.goldLight }}>{PB_COPY.cartel.type}</span><div style={rule(30)} />
        </div>
        <p style={{ fontFamily: B.serif, fontStyle: 'italic', fontSize: 18, lineHeight: 1.45, maxWidth: 310, margin: '26px 0 0', opacity: 0.95 }}>{tagline}</p>
        <p style={{ ...caps(10, 0.22, 500), lineHeight: 1.9, maxWidth: 300, margin: '18px 0 0', opacity: 0.7 }}>{PB_COPY.startGate}</p>
        <button onClick={onStart} disabled={!ready} style={{
          marginTop: 26, minWidth: 210, minHeight: 50, padding: '16px 40px', border: 'none', borderRadius: 2,
          background: ready ? `linear-gradient(180deg, ${B.goldLight} 0%, ${B.gold} 55%, ${B.goldDeep} 100%)` : 'rgba(201,164,92,0.22)',
          color: ready ? B.inkDeep : 'rgba(244,230,200,0.55)', boxShadow: ready ? '0 10px 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.35)' : 'none',
          ...caps(13, 0.34, 600),
        }}>
          {ready ? 'Entrer' : 'Chargement…'}
        </button>
        <div style={{ ...caps(8, 0.22, 400), marginTop: 18, opacity: 0.5 }}>{PB_COPY.endCard.disclaimer}</div>
      </div>
    </div>
  )
}
