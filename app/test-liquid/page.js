'use client'

import dynamic from 'next/dynamic'

// Preview isolée : nappe de gloss liquide qui coule (three.js pur).
const LiquidGlossTest = dynamic(() => import('@/components/LiquidGlossTest'), { ssr: false })

export default function TestLiquidPage() {
  return <LiquidGlossTest />
}
