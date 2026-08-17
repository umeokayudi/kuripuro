import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { fmtPeriod } from '../lib/salaryPeriod'

export default function SalaryComplaints() {
  const [complaints, setComplaints] = useState([])
  const [filter, setFilter] = useState('pending')
  const [notes, setNotes] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('salary_complaints').select('*').order('created_at', { ascending: false })
    setComplaints(data || [])
    setLoading(false)
  }

  const resolve = async (id, status) => {
    const { error } = await supabase.from('salary_complaints').update({
      status, admin_response: notes[id] || '', resolved_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(status === 'resolved' ? 'Reclamação resolvida' : 'Rejeitada')
    load()
  }

  const filtered = complaints.filter(c => filter === 'all' || c.status === filter)
  const pending = complaints.filter(c => c.status === 'pending').length

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>💬 Reclamações de Salário</h2>
      <div className="tab-pills" style={{ marginBottom: 14 }}>
        {[['pending', `Pendentes${pending ? ` (${pending})` : ''}`], ['resolved', 'Resolvidas'], ['rejected', 'Rejeitadas'], ['all', 'Todas']].map(([k, l]) => (
          <button key={k} className={`tab-pill${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text3)' }}>Loading...</div>}
      {filtered.length === 0 && !loading && <div className="card"><div style={{ color: 'var(--text3)' }}>Nenhuma reclamação.</div></div>}

      {filtered.map(c => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.employee_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{fmtPeriod(c.period)} · {c.category || 'geral'}</div>
            </div>
            <span className={`badge ${c.status === 'resolved' ? 'badge-green' : c.status === 'rejected' ? 'badge-red' : 'badge-amber'}`}>{c.status}</span>
          </div>
          <div style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>{c.description}</div>
          {c.attachment_url && <a href={c.attachment_url} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ marginBottom: 10 }}>📎 Anexo</a>}
          {c.admin_response && <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', padding: 8, borderRadius: 8, marginBottom: 8 }}>Resposta: {c.admin_response}</div>}
          {c.status === 'pending' && (
            <div>
              <input placeholder="Resposta ao funcionário..." value={notes[c.id] || ''}
                onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))}
                style={{ width: '100%', marginBottom: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => resolve(c.id, 'resolved')}>✅ Aceitar / Resolver</button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => resolve(c.id, 'rejected')}>✕ Rejeitar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
