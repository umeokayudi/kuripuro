import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang'

// v1.0.96 · 8.2 key box codes never sit open in a list: masked until tapped, hidden again after 15 s.
export default function KeyReveal({ value, className, style }) {
  const { tr } = useLang()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return undefined
    const t = setTimeout(() => setShown(false), 15000)
    return () => clearTimeout(t)
  }, [shown])
  if (!value) return null
  return (
    <div className={className} style={style}>
      🔑 {shown ? value : '••••'}{' '}
      <button type="button" onClick={ev => { ev.stopPropagation(); setShown(s => !s) }}
        style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent, #2563eb)', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer' }}>
        {shown ? tr('hide', '隠す', 'esconder') : tr('show', '表示', 'ver')}
      </button>
    </div>
  )
}
