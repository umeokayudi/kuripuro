// v1.0.187 · the employee connects their OWN Google account and syncs their services into it
// (always marked with the company). Shown in ☰ "Google Agenda" and in Meu perfil.
// Always visible: while the office has not turned Google on, it says so instead of hiding.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { googleStatus, googleConnectUrl, disconnectGoogleAccount, syncMyGoogle } from '../lib/googleAgenda'

const box = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 16, marginBottom: 12 }
const bigBtn = { display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: 14, borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 14, textDecoration: 'none', cursor: 'pointer' }

export default function EmployeeGoogleAgenda({ L }) {
  const [st, setSt] = useState(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => googleStatus().then(s => { setSt(s); setFailed('') }).catch(e => setFailed(e.message))
  useEffect(() => { load() }, [])

  const acc = st?.accounts || []
  const tag = st?.settings?.company_tag || 'KURIPURO'
  const ready = st?.configured
  const sync = async () => {
    setBusy(true)
    try {
      const r = await syncMyGoogle()
      const n = (r.exported || []).reduce((t, a) => t + a.created + a.updated, 0)
      toast.success(L(`Done · ${n} services sent to your Google Calendar`, `完了 · ${n}件をGoogleカレンダーに送信`, `Pronto · ${n} serviços enviados para sua Google Agenda`))
      load()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>📅 {L('My Google Calendar', '自分のGoogleカレンダー', 'Minha Google Agenda')}</div>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
        {L(`Connect your own Google account: your services show up in your Google Calendar, marked [${tag}], and update by themselves.`,
          `自分のGoogleアカウントを接続すると、サービスが[${tag}]付きでGoogleカレンダーに入り、自動で更新されます。`,
          `Conecte sua própria conta Google: seus serviços aparecem na sua Google Agenda, marcados [${tag}], e se atualizam sozinhos.`)}
      </div>
      {!st && !failed && <div style={{ fontSize: 13, opacity: 0.6 }}>…</div>}
      {(failed || (st && !ready)) && (
        <div style={{ fontSize: 13, background: 'rgba(251,191,36,0.15)', color: '#b45309', fontWeight: 600, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          ⏳ {L('The office is still turning Google on. The button will work as soon as it is ready.', '事務所がGoogle連携を準備中です。準備ができ次第ボタンが使えます。', 'O escritório ainda está ativando o Google. O botão funciona assim que estiver pronto.')}
        </div>
      )}
      {acc.map(a => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 0' }}>
          <span style={{ overflowWrap: 'anywhere' }}>✓ {a.google_email}{a.last_error ? <span style={{ color: '#f87171' }}> · ⚠ {a.last_error.slice(0, 60)}</span> : null}</span>
          <button type="button" onClick={async () => { await disconnectGoogleAccount(a.id).catch(e => toast.error(e.message)); load() }}
            style={{ background: 'none', border: '1px solid rgba(148,163,184,0.5)', color: 'inherit', borderRadius: 8, padding: '4px 10px', fontSize: 12 }}>{L('Disconnect', '解除', 'Desconectar')}</button>
        </div>
      ))}
      {acc.length > 0 && (
        <button type="button" className="emp-primary-button" disabled={busy} onClick={sync} style={{ ...bigBtn, marginTop: 8 }}>
          {busy ? '…' : `🔄 ${L('Sync my Google Calendar now', '今すぐ同期', 'Sincronizar minha Google Agenda agora')}`}
        </button>
      )}
      {!acc.length && (ready
        ? <a href={googleConnectUrl()} className="emp-primary-button" style={bigBtn}>{L('Connect my Google account', 'Googleアカウントを接続', 'Conectar minha conta Google')}</a>
        : <button type="button" disabled style={{ ...bigBtn, background: 'rgba(148,163,184,0.25)', color: '#64748b', cursor: 'not-allowed' }}>{L('Connect my Google account', 'Googleアカウントを接続', 'Conectar minha conta Google')}</button>)}
    </div>
  )
}
