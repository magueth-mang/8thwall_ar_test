'use client'

import dynamic from 'next/dynamic'

// Aperçu de développement du scénario « Jardin Majorelle » (orbite, sans AR).
const MajorelleTest = dynamic(() => import('@/components/MajorelleTest'), { ssr: false })

export default function TestMajorellePage() {
  return <MajorelleTest />
}
