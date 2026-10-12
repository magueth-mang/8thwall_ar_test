'use client'

import dynamic from 'next/dynamic'

// Banc d'essai des effets d'eau de l'émergence « BLEU INTERDIT » (WP4, lib/majorelle/emergeFx.js), sans AR.
const EmergeFxTest = dynamic(() => import('@/components/EmergeFxTest'), { ssr: false })

export default function TestEmergePage() {
  return <EmergeFxTest />
}
