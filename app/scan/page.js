'use client'

import Script from 'next/script'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ARWall = dynamic(() => import('@/components/ARWall'), { ssr: false })

export default function ScanPage() {
  const router = useRouter()
  const [engineLoaded, setEngineLoaded] = useState(false)
  const [extrasLoaded, setExtrasLoaded] = useState(false)
  const [started, setStarted] = useState(false)

  const ready = engineLoaded && extrasLoaded

  // Le tap "Démarrer" = geste utilisateur requis sur iOS (capteurs de mouvement)
  async function start() {
    try {
      const DME = window.DeviceMotionEvent
      if (DME && typeof DME.requestPermission === 'function') {
        await DME.requestPermission()
      }
    } catch (e) {
      console.warn('DeviceMotion permission', e)
    }
    setStarted(true)
  }

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Script
        src="https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        data-preload-chunks="slam"
        onLoad={() => setEngineLoaded(true)}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/@8thwall/xrextras/dist/xrextras.js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        onLoad={() => setExtrasLoaded(true)}
      />

      {started && ready ? <ARWall /> : <StartGate ready={ready} onStart={start} />}

      <button
        onClick={() => router.push('/')}
        aria-label="Retour"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          left: 16,
          zIndex: 1000001,
          color: '#EFE9DC',
          background: 'rgba(0,0,0,0.45)',
          border: '1px solid rgba(201,164,92,0.5)',
          borderRadius: 999,
          width: 40,
          height: 40,
          fontSize: 18,
        }}
      >
        ‹
      </button>
    </main>
  )
}

function StartGate({ ready, onStart }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 28,
        textAlign: 'center',
        background:
          'radial-gradient(120% 80% at 50% -10%, #1a1710 0%, #0a0a0a 45%, #000 100%)',
      }}
    >
      <div
        style={{
          fontFamily: "'Didot', Georgia, serif",
          fontSize: 12,
          letterSpacing: '0.42em',
          paddingLeft: '0.42em',
          color: '#C9A45C',
        }}
      >
        YVES SAINT LAURENT
      </div>
      <div
        style={{
          fontFamily: "'Didot', Georgia, serif",
          fontSize: 30,
          color: '#EFE9DC',
          lineHeight: 1.3,
        }}
      >
        Réalité augmentée
      </div>
      <p
        style={{
          fontSize: 11,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(239,233,220,0.6)',
          maxWidth: 260,
          lineHeight: 1.8,
        }}
      >
        Autorisez la caméra, puis visez le QR code
      </p>
      <button
        onClick={onStart}
        disabled={!ready}
        style={{
          marginTop: 6,
          padding: '16px 44px',
          background: ready
            ? 'linear-gradient(180deg, #D8BE86 0%, #C9A45C 100%)'
            : 'rgba(201,164,92,0.25)',
          color: ready ? '#0a0a0a' : 'rgba(239,233,220,0.5)',
          border: 'none',
          borderRadius: 2,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.22em',
          paddingLeft: 'calc(44px + 0.22em)',
        }}
      >
        {ready ? 'DÉMARRER' : 'CHARGEMENT…'}
      </button>
    </div>
  )
}
