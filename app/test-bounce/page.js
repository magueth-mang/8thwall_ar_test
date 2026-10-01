'use client'

import dynamic from 'next/dynamic'

// Preview : balles qui rebondissent sur sol + murs (physique cannon-es).
const RoomBounceTest = dynamic(() => import('@/components/RoomBounceTest'), { ssr: false })

export default function TestBouncePage() {
  return <RoomBounceTest />
}
