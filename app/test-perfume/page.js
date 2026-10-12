'use client'

import dynamic from 'next/dynamic'

// Banc de look-dev du flacon « BLEU INTERDIT » (lib/majorelle/perfume.js, perfumeShaders.js ; WP3).
const PerfumeLookdevTest = dynamic(() => import('@/components/PerfumeLookdevTest'), { ssr: false })

export default function TestPerfumePage() {
  return <PerfumeLookdevTest />
}
