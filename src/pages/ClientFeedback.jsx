import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { avgStars, starsDisplay } from '../lib/satisfaction'
import toast from 'react-hot-toast'

const TABS = ['ratings', 'complaints', 'compliments', 'requests']

export default function ClientFeedback() {
  const { t } = useLang()
  const f = t.feedback
  const [tab, setTab] = useState('ratings')
  const [ratings, setRatings] = useState([])
  const [complaints, setComplaints] = useState([])
  const [compliments, setCompliments] = useState([])
  const [requests, setRequests] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [responseDraft, setResponseDraft] = useState({})

  const load = async () => {
    const [r, cp, cm, rq, cl] = await Promise.all([
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_complaints').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_compliments').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_requests').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('clients').select('id, company_name'),
    ])
    setRatings(r.data || [])
    setComplaints(cp.data || [])
    setCompliments(cm.data || [])
    setRequests(rq.data || [])
    setClients(cl.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const clientName = (id) => clients.find(c => c.id === id)?.company_name || '—'
  const draft = (id) => responseDraft[id] ?? ''

  const saveComplaint = async (row) => {
    const admin_response = draft(row.id)
    const status = admin_response ? 'resolved' : row.status
    const { error } = await supabase.from('client_complaints').update({
      admin_response,
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.saved)
    load()
  }

  const saveCompliment = async (row) => {
    const admin_response = draft(row.id)
    const { error } = await supabase.from('client_compliments').update({
      admin_response,
      status: admin_response ? 'read' : 'new',
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.saved)
    load()
  }

  const saveRequest = async (row, status) => {
    const admin_notes = draft(row.id)
    const { error } = await supabase.from('client_requests').update({
      admin_notes,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.saved)
    load()
  }

  const openComplaints = complaints.filter(c => c.status !== 'resolved').length
  const openRequests = requests.filter(r => r.status === 'pending').length
  const newCompliments = compliments.filter(c => c.status === 'new').length
  const lowRatings = ratings.filter(r => r.stars <= 2).length

  const tabBadge = {
    ratings: lowRatings || null,
    complaints: openComplaints || null,
    compliments: newCompliments || null,
    requests: openRequests || null,
  }

  const tabLabel = {
    ratings: f.tabRatings,
    complaints: f.tabComplaints,
    compliments: f.tabCompliments,
    requests: f.tabRequests,
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{f.title}</h2>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{f.subtitle}</div>
      </div>

      <div className="tab-pills" style={{ marginBottom: 16 }}>
        {TABS.map(k => (
          <button key={k} className={`tab-pill${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {tabLabel[k]}
            {tabBadge[k] ? <span style={{ marginLeft: 6, background: '#f87171', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10 }}>{tabBadge[k]}</span> : null}
          </button>
        ))}
      </div>

      {loading && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>{f.loading}</div>}

      {!loading && tab === 'ratings' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
            {[
              [f.totalRatings, ratings.length],
              [f.avgStars, ratings.length ? avgStars(ratings).toFixed(1) : '—'],
              [f.lowRatings, lowRatings],
            ].map(([l, v]) => (
              <div key={l} className="card" style={{ textAlign: 'center', padding: '14px 16px' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
          {ratings.length === 0 && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>{f.noRatings}</div>}
          {ratings.map(r => (
            <div key={r.id} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${r.stars >= 4 ? 'var(--green)' : r.stars >= 3 ? '#EF9F27' : 'var(--red)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{clientName(r.client_id)} · {r.location_name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{r.employee_name || '—'} · {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ fontSize: 18, color: '#EF9F27', fontWeight: 700 }}>{starsDisplay(r.stars)}</div>
              </div>
              {r.comment && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8, lineHeight: 1.5 }}>{r.comment}</div>}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'complaints' && (
        <div>
          {complaints.length === 0 && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>{f.noComplaints}</div>}
          {complaints.map(row => (
            <div key={row.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{clientName(row.client_id)} · {row.location_name || '—'}</div>
                <span className={`badge ${row.status === 'resolved' ? 'badge-green' : 'badge-amber'}`}>{row.status}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{row.category} · {row.employee_name || '—'} · {new Date(row.created_at).toLocaleDateString()}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{row.description}</div>
              <textarea value={draft(row.id) || row.admin_response || ''} onChange={e => setResponseDraft(d => ({ ...d, [row.id]: e.target.value }))} placeholder={f.adminResponse} rows={2} style={{ width: '100%', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => saveComplaint(row)}>{f.saveResponse}</button>
                {row.status !== 'resolved' && (
                  <button className="btn btn-sm" onClick={() => saveComplaint({ ...row, status: 'resolved' })}>{f.markResolved}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'compliments' && (
        <div>
          {compliments.length === 0 && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>{f.noCompliments}</div>}
          {compliments.map(row => (
            <div key={row.id} className="card" style={{ marginBottom: 10, borderLeft: '4px solid var(--green)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{clientName(row.client_id)} · {row.location_name || '—'}</div>
                <span className={`badge ${row.status === 'new' ? 'badge-blue' : 'badge-green'}`}>{row.status}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{row.employee_name || '—'} · {new Date(row.created_at).toLocaleDateString()}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>👏 {row.message}</div>
              <textarea value={draft(row.id) || row.admin_response || ''} onChange={e => setResponseDraft(d => ({ ...d, [row.id]: e.target.value }))} placeholder={f.adminResponse} rows={2} style={{ width: '100%', marginBottom: 8 }} />
              <button className="btn btn-sm btn-primary" onClick={() => saveCompliment(row)}>{f.saveResponse}</button>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'requests' && (
        <div>
          {requests.length === 0 && <div className="card" style={{ color: 'var(--text3)', fontSize: 13 }}>{f.noRequests}</div>}
          {requests.map(row => (
            <div key={row.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>
                  {row.ticket_number || `#${row.id.slice(0, 8)}`} · {clientName(row.client_id)}
                </div>
                <span className={`badge ${row.status === 'completed' ? 'badge-green' : 'badge-amber'}`}>{row.status}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                {row.location_name || f.allLocations} · {new Date(row.created_at).toLocaleDateString()}
                {row.preferred_date ? ` · ${fill(f.preferredDate, { date: row.preferred_date })}` : ''}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{row.description}</div>
              <textarea value={draft(row.id) || row.admin_notes || ''} onChange={e => setResponseDraft(d => ({ ...d, [row.id]: e.target.value }))} placeholder={f.adminNotes} rows={2} style={{ width: '100%', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => saveRequest(row, row.status)}>{f.saveNotes}</button>
                {row.status !== 'completed' && (
                  <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => saveRequest(row, 'completed')}>{f.markDone}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
