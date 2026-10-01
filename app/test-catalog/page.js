'use client'

import dynamic from 'next/dynamic'

// Preview orbitale : portail coulissant → salle catalogue de lipsticks YSL.
const CatalogTest = dynamic(() => import('@/components/CatalogTest'), { ssr: false })

export default function TestCatalogPage() {
  return <CatalogTest />
}
