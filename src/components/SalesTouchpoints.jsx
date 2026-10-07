import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import {
  TOUCH_CHANNELS,
  TOUCH_TYPES,
  emptyTouchpoint,
  isCrmSchemaMissing,
} from '../lib/sales'

export default function SalesTouchpoints({ leadId, mitsumoriId, s, today, onCrmMissing }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(() => emptyTouchpoint(today))
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!leadId && !mitsumoriId) {
      setRows([])
      return
    }
    let q = supabase.from('sales_touchpoints').select('*').order('happened_at', { ascending: false }).order('created_at', { ascending: false })
    if (mitsumoriId) q = q.eq('mitsumori_id', mitsumoriId)
    else q = q.eq('lead_id', leadId)
    const { data, error } = await q
    if (error) {
      if (isCrmSchemaMissing(error)) onCrmMissing?.()
      else toast.error(error.message)
      setRows([])
      return
    }
    setRows(data || [])
  }

  useEffect(() => { load() }, [leadId, mitsumoriId])

  const save = async () => {
    if (!String(form.body || '').trim()) return
    if (!leadId) return toast.error(s.missingCompany)
    setSaving(true)
    const { error } = await supabase.from('sales_touchpoints').insert({
      lead_id: leadId,
      mitsumori_id: mitsumoriId || null,
      event_type: form.event_type || 'reply',
      happened_at: form.happened_at || today,
      channel: form.channel || 'phone',
      said_by: form.said_by || '',
      body: String(form.body || '').trim(),
    })
    setSaving(false)
    if (error) {
      if (isCrmSchemaMissing(error)) onCrmMissing?.()
      return toast.error(error.message)
    }
    toast.success(s.replySaved)
    setForm(emptyTouchpoint(today))
    load()
  }

  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
      <div className="card-title">{s.internalSection}</div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{s.replies}</div>
      {!rows.length && <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 10 }}>{s.noReplies}</div>}
      {rows.map(row => (
        <div key={row.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0', fontSize: 13 }}>
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>
            {row.happened_at || '—'} · {s.touchTypes?.[row.event_type] || row.event_type} · {s.channels?.[row.channel] || row.channel}
            {row.said_by ? ` · ${row.said_by}` : ''}
          </div>
          <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{row.body}</div>
        </div>
      ))}
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div className="form-group"><label>{s.replyDate}</label>
          <input type="date" value={form.happened_at || ''} onChange={e => setForm({ ...form, happened_at: e.target.value })} />
        </div>
        <div className="form-group"><label>{s.replyChannel}</label>
          <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
            {TOUCH_CHANNELS.map(ch => <option key={ch} value={ch}>{s.channels?.[ch] || ch}</option>)}
          </select>
        </div>
        <div className="form-group"><label>{s.replyType}</label>
          <select value={form.event_type} onChange={e => setForm({ ...form, event_type: e.target.value })}>
            {TOUCH_TYPES.map(tp => <option key={tp} value={tp}>{s.touchTypes?.[tp] || tp}</option>)}
          </select>
        </div>
        <div className="form-group"><label>{s.replyWho}</label>
          <input value={form.said_by || ''} onChange={e => setForm({ ...form, said_by: e.target.value })} />
        </div>
        <div className="form-group" style={{ gridColumn: '1/-1' }}>
          <label>{s.replyBody}</label>
          <textarea rows={3} style={{ width: '100%', minHeight: 72 }} value={form.body || ''} onChange={e => setForm({ ...form, body: e.target.value })} />
        </div>
      </div>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '…' : s.addReply}</button>
    </div>
  )
}
