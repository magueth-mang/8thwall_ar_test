'use client'

import dynamic from 'next/dynamic'

// Aperçu orbital des effets « eau vivante » du jardin Majorelle (cour factice, sans AR).
const MajorelleFxTest = dynamic(() => import('@/components/MajorelleFxTest'), { ssr: false })

export default function TestMajorelleFxPage() {
  return <MajorelleFxTest />
}
