'use client'

import dynamic from 'next/dynamic'

// Aperçu de la cour seule (lumière bakée + eau vivante), sans la mise en scène.
const MajorelleTest = dynamic(() => import('@/components/MajorelleTest'), { ssr: false })

export default function TestMajorelleGardenPage() {
  return <MajorelleTest />
}
