'use client'

import dynamic from 'next/dynamic'

// Prévisualisation orbitale (desktop) de la scène "mur QR + espace" — three.js pur.
const WallTest = dynamic(() => import('@/components/WallTest'), { ssr: false })

export default function TestPage() {
  return <WallTest />
}
