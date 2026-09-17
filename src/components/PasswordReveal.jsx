import { useState } from 'react'

export default function PasswordReveal({ value, showLabel = 'Show', hideLabel = 'Hide', compact = false, dark = false }) {
  const [show, setShow] = useState(false)
  const empty = !value
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <code style={{
        fontSize: compact ? 12 : 13,
        letterSpacing: show ? 0 : 1,
        color: empty ? (dark ? 'rgba(255,255,255,0.35)' : 'var(--text3)') : (dark ? '#fff' : 'var(--text)'),
        background: dark ? 'rgba(255,255,255,0.08)' : 'var(--surface2)',
        padding: compact ? '4px 8px' : '6px 10px',
        borderRadius: 8,
        minWidth: 72,
      }}>
        {empty ? '—' : show ? value : '••••••••'}
      </code>
      {!empty && (
        <button
          type="button"
          className={dark ? undefined : 'btn btn-sm'}
          onClick={() => setShow(s => !s)}
          style={dark ? {
            padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)', color: '#e8c47a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          } : undefined}
        >
          {show ? hideLabel : showLabel}
        </button>
      )}
    </div>
  )
}
