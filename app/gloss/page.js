'use client'

import dynamic from 'next/dynamic'

// Preview du lipgloss Lovenude (matériaux + animation d'ouverture) — three.js pur.
const GlossPreview = dynamic(() => import('@/components/GlossPreview'), { ssr: false })

export default function GlossPage() {
  return <GlossPreview />
}
