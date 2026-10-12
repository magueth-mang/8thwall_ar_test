'use client'

import dynamic from 'next/dynamic'

// Aperçu de développement du scénario « Jardin Majorelle » complet (orbite, sans AR).
// La cour seule (sans la mise en scène) reste sur /test-majorelle-garden.
const MajorelleSceneTest = dynamic(() => import('@/components/MajorelleSceneTest'), { ssr: false })

export default function TestMajorelleLipstickPage() {
  return <MajorelleSceneTest />
}
