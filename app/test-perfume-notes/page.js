'use client'

import dynamic from 'next/dynamic'

// Banc d'essai WP5 « BLEU INTERDIT » : les trois notes (néroli, nymphéa, ambre) et le sillage
// (vaporisation → porte → fil d'or sur l'arc → pluie d'or) au-dessus de la vraie cour bakée.
const NotesFxTest = dynamic(() => import('@/components/NotesFxTest'), { ssr: false })

export default function TestPerfumeNotesPage() {
  return <NotesFxTest />
}
