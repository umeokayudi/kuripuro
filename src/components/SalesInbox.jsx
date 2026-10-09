import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { salesPost } from '../lib/salesApi'

const COPY = {
  en: {
    inbox: 'Messages & alerts', empty: 'Nothing new.', read: 'Mark read', readAll: 'Mark all read', from: 'from',
    compose: 'Send a message', to: 'To', allSellers: 'All sellers', someSellers: 'Chosen sellers', managers: 'Managers (admin / marketing)', alsoManagers: 'Copy managers',
    kind: 'Type', kinds: { message: 'Message', alert: 'Alert', praise: 'Congrats' }, title: 'Subject', body: 'Message', send: 'Send', sent: n => `Sent to ${n}`, pick: 'Pick at least one seller.',
    events: { message: 'Message', alert: 'Alert', praise: 'Congrats', lead_assigned: 'New lead', day_report: 'Day report', seller_closed: 'Closing reported', followup_due: 'Follow-up', approach_saved: 'Approach' },
  },
  ja: {
    inbox: 'メッセージ・通知', empty: '新しい通知はありません。', read: '既読', readAll: 'すべて既読', from: '送信者',
    compose: 'メッセージを送る', to: '宛先', allSellers: '営業全員', someSellers: '選んだ営業', managers: '管理者（管理・マーケ）', alsoManagers: '管理者にも送る',
    kind: '種類', kinds: { message: 'メッセージ', alert: '注意', praise: 'おめでとう' }, title: '件名', body: '本文', send: '送信', sent: n => `${n}件送信しました`, pick: '営業を1人以上選んでください。',
    events: { message: 'メッセージ', alert: '注意', praise: 'おめでとう', lead_assigned: '新規リード', day_report: '日報', seller_closed: '成約報告', followup_due: 'フォロー', approach_saved: '営業活動' },
  },
}

const blank = { to: 'some', ids: [], kind: 'message', title: '', body: '', include_managers: false }

/** Unread notifications plus, for admins, a composer to message sellers and managers. */
export default function SalesInbox({ lang, notifications = [], sellers = [], onChanged, canSend = false, preset = null, onOpenLead }) {
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [draft, setDraft] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (preset?.id) { setDraft(d => ({ ...d, to: 'some', ids: [preset.id], title: preset.title || d.title })); setOpen(true) }
  }, [preset])

  const markRead = async body => {
    try { await salesPost('/api/sales-data', { action: 'read-notification', ...body }, lang); await onChanged?.() }
    catch (e) { toast.error(e.message) }
  }

  const send = async event => {
    event.preventDefault()
    if (draft.to === 'some' && !draft.ids.length) return toast.error(t.pick)
    setBusy(true)
    try {
      const body = { action: 'send-message', kind: draft.kind, title: draft.title, body: draft.body, include_managers: draft.include_managers }
      if (draft.to === 'all') body.to = 'all_sellers'
      else if (draft.to === 'managers') body.to = 'managers'
      else body.salesperson_ids = draft.ids
      const { sent } = await salesPost('/api/sales-data', body, lang)
      toast.success(t.sent(sent))
      setDraft(blank); setOpen(false)
      await onChanged?.()
    } catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  const toggleId = id => setDraft(d => ({ ...d, ids: d.ids.includes(id) ? d.ids.filter(x => x !== id) : [...d.ids, id] }))
  const rows = notifications.slice(0, 30)

  return <section className="card sales-inbox">
    <div className="sales-section-head">
      <div className="card-title">{t.inbox}{rows.length ? ` (${notifications.length})` : ''}</div>
      <div className="sales-action-row">
        {rows.length > 1 && <button type="button" className="btn btn-sm" onClick={() => markRead({ all: true })}>{t.readAll}</button>}
        {canSend && <button type="button" className={`btn btn-sm${open ? ' active' : ' btn-primary'}`} onClick={() => setOpen(v => !v)}>{t.compose}</button>}
      </div>
    </div>
    {canSend && open && <form className="sales-compose" onSubmit={send}>
      <div className="sales-form-grid">
        <label className="form-group"><span>{t.to}</span><select value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}><option value="some">{t.someSellers}</option><option value="all">{t.allSellers}</option><option value="managers">{t.managers}</option></select></label>
        <label className="form-group"><span>{t.kind}</span><select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}>{Object.entries(t.kinds).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
      </div>
      {draft.to === 'some' && <div className="sales-tag-picker">{sellers.filter(p => p.is_active !== false).map(p => <button type="button" key={p.id} aria-pressed={draft.ids.includes(p.id)} className={`btn btn-sm${draft.ids.includes(p.id) ? ' active' : ''}`} onClick={() => toggleId(p.id)}>{p.full_name}</button>)}</div>}
      {draft.to !== 'managers' && <label className="sales-check"><input type="checkbox" checked={draft.include_managers} onChange={e => setDraft(d => ({ ...d, include_managers: e.target.checked }))} /> {t.alsoManagers}</label>}
      <label className="form-group"><span>{t.title}</span><input value={draft.title} maxLength={160} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></label>
      <label className="form-group"><span>{t.body}</span><textarea rows="3" value={draft.body} maxLength={3000} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} /></label>
      <button type="submit" className="btn btn-primary" disabled={busy || (!draft.title.trim() && !draft.body.trim())}>{t.send}</button>
    </form>}
    {rows.length === 0 && <p className="sales-muted">{t.empty}</p>}
    {rows.map(row => <div className={`sales-inbox-row sales-inbox-${row.event_type}`} key={row.id}>
      <div>
        <span className="sales-chip">{t.events[row.event_type] || row.event_type}</span>
        <strong>{row.title}</strong>
        {row.body && <p>{row.body}</p>}
        <small className="sales-muted">{String(row.created_at || '').slice(0, 16).replace('T', ' ')}{row.sender_name ? ` · ${t.from} ${row.sender_name}` : ''}</small>
      </div>
      <div className="sales-followup-actions">
        {row.lead_id && onOpenLead && <button type="button" className="btn btn-sm" onClick={() => onOpenLead(row.lead_id)}>→</button>}
        <button type="button" className="btn btn-sm" onClick={() => markRead({ id: row.id })}>{t.read}</button>
      </div>
    </div>)}
  </section>
}
