'use client'

import dynamic from 'next/dynamic'

// Aperçu de développement de « BLEU INTERDIT » (orbite, sans AR) : le flacon qui dort dans le bassin du Jardin Majorelle.
// La version rouge à lèvres reste sur /test-majorelle-lipstick ; la cour seule sur /test-majorelle-garden.
const MajorellePerfumeTest = dynamic(() => import('@/components/MajorellePerfumeTest'), { ssr: false })

export default function TestMajorellePage() {
  return <MajorellePerfumeTest />
}
