'use client'

import { useState } from 'react'
import { CONFIG_OPTIONS } from '@/lib/car/configurator'

// Panneau « premium neutre » du configurateur : onglets fins, pastilles rondes, nom + finition de l'option choisie.
// Verre sombre flouté, typographie légère en capitales espacées ; aucune couleur de marque.
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

export function CarConfigPanel({ available, current, onSelect, onTab, style }) {
  const tabs = ['paint', 'rims', 'leather'].filter((k) => available.includes(k))
  const [tab, setTab] = useState(tabs[0])
  if (!tabs.length) return null
  const kind = tabs.includes(tab) ? tab : tabs[0]
  const items = CONFIG_OPTIONS[kind].items
  const sel = items.find((i) => i.id === current[kind]) || items[0]
  return (
    <div style={{
      pointerEvents: 'auto', margin: '0 auto', maxWidth: 420, width: 'calc(100% - 24px)', boxSizing: 'border-box',
      padding: '14px 16px 16px', borderRadius: 18, background: 'rgba(14,14,16,0.62)', backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff', fontFamily: FONT, ...style,
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 22, marginBottom: 12 }}>
        {tabs.map((k) => (
          <button key={k} onClick={() => { setTab(k); onTab?.(k) }} style={{
            background: 'none', border: 'none', padding: '2px 0 6px', color: '#fff', opacity: k === kind ? 1 : 0.45,
            fontFamily: FONT, fontSize: 10.5, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase',
            borderBottom: `1px solid ${k === kind ? 'rgba(255,255,255,0.9)' : 'transparent'}`, cursor: 'pointer',
          }}>{CONFIG_OPTIONS[k].label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        {items.map((it) => {
          const on = it.id === sel.id
          return (
            <button key={it.id} aria-label={it.name} onClick={() => onSelect(kind, it.id)} style={{
              width: 38, height: 38, borderRadius: 999, padding: 3, cursor: 'pointer',
              background: 'transparent', border: `1px solid ${on ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.18)'}`,
              transform: on ? 'scale(1.06)' : 'none', transition: 'transform .2s, border-color .2s',
            }}>
              <span style={{
                display: 'block', width: '100%', height: '100%', borderRadius: 999,
                background: kind === 'leather' ? it.color === '#ffffff' ? '#e9dfcf' : it.color
                  : `radial-gradient(circle at 32% 28%, rgba(255,255,255,${it.metal > 0.5 ? 0.55 : 0.3}) 0%, ${it.color} 46%, ${it.color} 100%)`,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
              }} />
            </button>
          )
        })}
      </div>
      <div style={{ textAlign: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 300, letterSpacing: '0.04em' }}>{sel.name}</div>
        <div style={{ fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', opacity: 0.55, marginTop: 3 }}>{sel.finish}</div>
      </div>
    </div>
  )
}

export default CarConfigPanel
