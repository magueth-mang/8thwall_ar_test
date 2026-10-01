'use client'

import dynamic from 'next/dynamic'

// Preview orbitale : objet qui sort d'un portail mural et tombe au sol (physique).
const WallDropTest = dynamic(() => import('@/components/WallDropTest'), { ssr: false })

export default function TestDropPage() {
  return <WallDropTest />
}
