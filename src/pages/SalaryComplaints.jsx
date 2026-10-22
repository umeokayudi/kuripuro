import { useState, useEffect } from 'react'
import { pendingChanged } from '../lib/adminPending'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { fmtPeriod } from '../lib/salaryPeriod'
import { useLang } from '../hooks/useLang'

// Employees read EN or JA, so the chat note carries both.
function salaryAnswerMessage(c, status, answer) {
  const period = fmtPeriod(c.period)
  const en = status === 'resolved'
    ? `💴 Your salary question for ${period} was accepted.`
    : `💴 Your salary question for ${period} was not accepted.`
  const ja = status === 'resolved'
    ? `💴 ${period}の給与についての申し立ては承認されました。`
    : `💴 ${period}の給与についての申し立ては却下されました。`
  const note = answer ? `\n\n${answer}` : ''
  return `${en}${note}\n\n${ja}\n\nOpen the app to reply or confirm. / アプリで返信または確認できます。`
}

export default function SalaryComplaints() {
  const { t, tr } = useLang()
  const s = t.salaryIssues
  const [complaints, setComplaints] = useState([])
  const [filter, setFilter] = useState('pending')
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    pendingChanged()
    setLoading(true)
    const { data } = await supabase.from('salary_complaints').select('*').order('created_at', { ascending: false })
    setComplaints(data || [])
    setLoading(false)
  }

  const resolve = async (c, status) => {
    const answer = (notes[c.id] || '').trim()
    // A refusal always says why, so the employee knows what to do next.
    if (status === 'rejected' && !answer) return toast.error(tr('Write the reason for the employee first.', '従業員への理由を入力してください。', 'Escreva o motivo para o funcionário antes de recusar.'))
    const { error } = await supabase.from('salary_complaints').update({
      status, admin_response: answer, resolved_at: new Date().toISOString(),
    }).eq('id', c.id)
    if (error) return toast.error(error.message)
    // The payslip goes back to "waiting for the employee" so they can confirm it (or reply) again.
    if (c.statement_id) {
      await supabase.from('salary_statements').update({ employee_disputed_at: null, status: 'awaiting_confirmation' }).eq('id', c.statement_id)
    }
    // The answer also lands in the employee's chat, which notifies them in the app.
    await supabase.from('messages').insert({
      employee_id: c.employee_id, employee_name: c.employee_name, sender: 'admin', read: false,
      content: salaryAnswerMessage(c, status, answer),
    })
    toast.success(status === 'resolved' ? s.resolvedToast : s.rejectedToast)
    load()
  }

  const filtered = complaints.filter(c => filter === 'all' || c.status === filter)
  const pending = complaints.filter(c => c.status === 'pending').length

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{s.title}</h2>
      <div className="tab-pills" style={{ marginBottom: 14 }}>
        {[['pending', `${s.pending}${pending ? ` (${pending})` : ''}`], ['resolved', s.resolved], ['rejected', s.rejected], ['all', s.all]].map(([k, l]) => (
          <button key={k} className={`tab-pill${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>{t.app.loading}</div>}
      {filtered.length === 0 && !loading && <div className="card"><div style={{ color: 'var(--text3)' }}>{s.empty}</div></div>}

      {filtered.map(c => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.employee_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fmtPeriod(c.period)} · {c.category === 'contact' ? tr('📞 Asks to be contacted', '📞 連絡希望', '📞 Pede contato') : c.category === 'reply' ? tr('↩ Reply to your answer', '↩ 回答への返信', '↩ Resposta à sua resposta') : (c.category || s.general)}</div>
            </div>
            <span className={`badge ${c.status === 'resolved' ? 'badge-green' : c.status === 'rejected' ? 'badge-red' : 'badge-amber'}`}>{c.status}</span>
          </div>
          <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>{c.description}</div>
          {c.attachment_url && <a href={c.attachment_url} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginBottom: 10 }}>📎 {s.attachment}</a>}
          {c.admin_response && <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', padding: 8, borderRadius: 8, marginBottom: 8 }}>{s.response}: {c.admin_response}</div>}
          {c.status === 'pending' && (
            <div>
              <input placeholder={s.responsePlaceholder} value={notes[c.id] || ''}
                onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))}
                style={{ width: '100%', marginBottom: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => resolve(c, 'resolved')}>✅ {s.accept}</button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => resolve(c, 'rejected')}>✕ {s.reject}</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
