import { useState } from 'react'
import AIChatPanel from './AIChatPanel'

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false }) {
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
          cursor: 'pointer', fontSize: 22, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
        title={mode === 'employee' ? 'Assistente IA' : 'Assistente Admin IA'}
      >
        {open ? '✕' : '📞'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 24, zIndex: 998,
          width: 380, maxWidth: 'calc(100vw - 48px)', height: 520,
          maxHeight: 'calc(100vh - 140px)',
          background: dark ? '#0d1f35' : 'var(--bg, #f4f6f9)',
          borderRadius: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          border: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <AIChatPanel compact mode={mode} employeeId={employeeId} employeeName={employeeName} dark={dark} />
        </div>
      )}
    </>
  )
}
