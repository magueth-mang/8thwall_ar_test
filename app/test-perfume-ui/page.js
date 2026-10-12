'use client'

import dynamic from 'next/dynamic'

// Banc d'essai de l'interface spatiale « BLEU INTERDIT » (lib/majorelle/perfumeUI.js) et de PerfumeOverlay.
const PerfumeUITest = dynamic(() => import('@/components/PerfumeUITest'), { ssr: false })

export default function TestPerfumeUIPage() {
  return <PerfumeUITest />
}
