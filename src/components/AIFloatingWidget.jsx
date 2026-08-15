import { useState } from 'react'
import AIChatPanel from './AIChatPanel'

export default function AIFloatingWidget() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 999,
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg,#c19c56,#e8c47a)',
          border: 'none', boxShadow: '0 4px 16px rgba(193,156,86,0.4)',
          cursor: 'pointer', fontSize: 24, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
        title="Assistente de IA"
      >
        {open ? '✕' : '✨'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 24, zIndex: 998,
          width: 400, maxWidth: 'calc(100vw - 48px)', height: 560,
          maxHeight: 'calc(100vh - 140px)',
          background: 'var(--bg, #f4f6f9)', borderRadius: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          border: '1px solid var(--border)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13, color: 'var(--text2)', background: '#fff' }}>
            ✨ Assistente de IA
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <AIChatPanel compact />
          </div>
        </div>
      )}
    </>
  )
}
