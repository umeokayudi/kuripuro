import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { canRevealKey, logKeyReveal, KEY_ROLES } from '../lib/keyReveal'

// v1.0.96 · 8.2 key box codes never sit open in a list: masked until tapped, hidden again after 15 s.
// v1.0.107 · only admin / employee can reveal (roles prop narrows it), and every reveal is logged.
export default function KeyReveal({ value, className, style, source = 'other', refId = null, label = null, roles = KEY_ROLES, icon = '🔑', multiline = false, linkColor = 'var(--accent, #2563eb)' }) {
  const { tr } = useLang()
  const { user } = useAuth() || {}
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return undefined
    const t = setTimeout(() => setShown(false), 15000)
    return () => clearTimeout(t)
  }, [shown])
  if (!value) return null
  const allowed = canRevealKey(user, roles)
  const toggle = ev => {
    ev.stopPropagation()
    if (!shown) logKeyReveal(user, { source, refId, label })
    setShown(s => !s)
  }
  return (
    <div className={className} style={{ ...(multiline && shown ? { whiteSpace: 'pre-line' } : null), ...style }}>
      {icon ? `${icon} ` : ''}{shown && allowed ? value : '••••'}{' '}
      {allowed && (
        <button type="button" onClick={toggle}
          style={{ border: 'none', background: 'none', padding: 0, color: linkColor, fontWeight: 700, fontSize: 'inherit', cursor: 'pointer' }}>
          {shown ? tr('hide', '隠す', 'esconder') : tr('show', '表示', 'ver')}
        </button>
      )}
    </div>
  )
}
