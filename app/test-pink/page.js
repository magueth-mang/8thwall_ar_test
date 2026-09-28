'use client'

import dynamic from 'next/dynamic'

// Preview orbitale de l'effet "mur qui éclate + univers rose" (lipstick).
const PinkWallTest = dynamic(() => import('@/components/PinkWallTest'), { ssr: false })

export default function TestPinkPage() {
  return <PinkWallTest />
}
