import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { loadKeyReveals } from '../lib/keyReveal'

const SOURCE = {
  contract: ['Contract', '契約', 'Contrato'],
  job: ['Job', 'ジョブ', 'Job'],
  agenda: ['Day agenda', '当日の予定', 'Agenda do dia'],
  employee_job: ['Employee app', 'スタッフアプリ', 'App do funcionário'],
}

// v1.0.107 · Admin-only list of who revealed a key box code and when (Tokyo time).
export default function KeyRevealLog() {
  const { tr } = useLang()
  const { user } = useAuth() || {}
  const [rows, setRows] = useState(undefined)
  const [open, setOpen] = useState(false)
  if (user?.role !== 'admin') return null
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) { setRows(undefined); setRows(await loadKeyReveals()) }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <button type="button" className="btn btn-sm" onClick={toggle}>🔑 {tr('Who revealed key codes', 'キーコードの表示履歴', 'Quem viu os códigos')}</button>
      {open && (
        <div className="card" style={{ marginTop: 8, padding: '10px 14px' }}>
          {rows === undefined && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Loading…', '読み込み中…', 'Carregando…')}</div>}
          {rows === null && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('The log starts after the SQL "registro_keybox" is applied.', 'SQL「registro_keybox」の適用後に記録が始まります。', 'O registro começa depois que o SQL "registro_keybox" for aplicado.')}</div>}
          {rows && rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Nobody revealed a code yet.', 'まだ表示されていません。', 'Ninguém revelou um código ainda.')}</div>}
          {rows && rows.map(r => {
            const s = SOURCE[r.source]
            return (
              <div key={r.id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ minWidth: 112, color: 'var(--text3)' }}>{new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span style={{ flex: 1, minWidth: 0 }}><b>{r.viewer_name || '—'}</b> · {r.ref_label || '—'} <span style={{ color: 'var(--text3)' }}>({s ? tr(...s) : r.source})</span></span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
