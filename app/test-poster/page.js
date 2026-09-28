'use client'

import dynamic from 'next/dynamic'

// Preview orbitale de l'effet "affiche LOVENUDE" (distorsion liquide + bulle de savon).
const PosterTest = dynamic(() => import('@/components/PosterTest'), { ssr: false })

export default function TestPosterPage() {
  return <PosterTest />
}
