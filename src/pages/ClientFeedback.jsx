import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { avgStars, starsDisplay } from '../lib/satisfaction'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import ClientSatisfactionPanel from '../components/ClientSatisfactionPanel'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { useSearchParams } from 'react-router-dom'
import { fetchContractSellers } from '../lib/contractSellers'
import { salesPost } from '../lib/salesApi'
import { quoteCommissionState } from '../lib/contractCommission'
import { QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import toast from 'react-hot-toast'
import StoreDossier from '../components/facility/StoreDossier'

const TABS = ['ratings', 'complaints', 'compliments', 'requests']

export default function ClientFeedback() {
  const { t, lang } = useLang()
  const f = t.feedback
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'ratings')
  const [sellers, setSellers] = useState([])
  const [ratings, setRatings] = useState([])
  const [complaints, setComplaints] = useState([])
  const [compliments, setCompliments] = useState([])
  const [requests, setRequests] = useState([])
  const [dossierFor, setDossierFor] = useState(null)
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [responseDraft, setResponseDraft] = useState({})
  const [jobPhotos, setJobPhotos] = useState({})
  const [lightbox, setLightbox] = useState(null)

  const load = async () => {
    const [r, cp, cm, rq, cl] = await Promise.all([
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_complaints').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_compliments').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('client_requests').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('clients').select('*'),
    ])
    const ratingsData = r.data || []
    const complaintsData = cp.data || []
    const complimentsData = cm.data || []
    setRatings(ratingsData)
    setComplaints(complaintsData)
    setCompliments(complimentsData)
    setRequests(rq.data || [])
    // pedido de orçamento aberto: a ficha da loja já vem aberta no primeiro
    setDossierFor(d => d ?? (rq.data || []).find(r => r.request_type === 'quote' && r.status === 'pending')?.id ?? null)
    setClients(cl.data || [])

    const jobIds = [...new Set([
      ...ratingsData.map(x => x.job_id),
      ...complaintsData.map(x => x.job_id),
      ...complimentsData.map(x => x.job_id),
    ].filter(Boolean))]
    if (jobIds.length) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id,photo_start_url,photo_end_url')
        .in('id', jobIds)
      setJobPhotos(Object.fromEntries((jobs || []).map(j => [j.id, j])))
    } else {
      setJobPhotos({})
    }

    setLoading(false)
  }

  useEffect(() => { load(); fetchContractSellers().then(r => setSellers(r.salespeople || [])).catch(() => {}) }, [])
  useEffect(() => { const q = searchParams.get('tab'); if (TABS.includes(q)) setTab(q) }, [searchParams])

  const clientName = (id) => clients.find(c => c.id === id)?.company_name || '—'
  const sellerName = (id) => sellers.find(p => p.id === id)?.full_name || '—'
  const yen = (n) => `¥${Math.round(Number(n || 0)).toLocaleString()}`
  const draft = (id) => responseDraft[id] ?? ''
  const [quoteDraft, setQuoteDraft] = useState({})

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

  const sendQuote = async (row) => {
    const d = quoteDraft[row.id] || {}
    const amount = Number(d.amount ?? row.quote_amount)
    if (!amount) return toast.error(f.quoteAmount)
    const { error } = await supabase.from('client_requests').update({
      quote_amount: amount, quote_note: (d.note ?? row.quote_note ?? '').trim() || null,
      quote_status: 'quoted', quoted_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.quoteSentAdmin)
    window.dispatchEvent(new Event(QUOTE_REQUESTS_CHANGED))
    load()
  }

  // v1.0.56 · Company price → seller (adds their extra = commission) → client.
  const priceQuote = async (row, direct) => {
    const d = quoteDraft[row.id] || {}
    const base = Number(d.amount ?? row.base_amount ?? row.quote_amount)
    if (!base) return toast.error(f.companyPrice)
    try {
      const r = await salesPost('/api/sales-data', { action: 'price-client-quote', id: row.id, base_amount: base, note: d.note ?? row.quote_note ?? '', direct }, lang)
      toast.success(r.to_seller ? f.sentToSeller : f.quoteSentAdmin)
    } catch (e) {
      // Without the admin server session (or before the v1.0.56 SQL) the client still gets the quote.
      if (!direct && clients.find(c => c.id === row.client_id)?.salesperson_id) return toast.error(e.message)
      return sendQuote(row)
    }
    window.dispatchEvent(new Event(QUOTE_REQUESTS_CHANGED))
    load()
  }

  const markCommissionPaid = async (row) => {
    const { error } = await supabase.from('client_requests').update({ commission_paid_at: new Date().toISOString() }).eq('id', row.id)
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

  const photosFor = (jobId) => jobId ? jobPhotos[jobId] : null

  const renderJobPhotos = (jobId) => {
    const job = photosFor(jobId)
    if (!job?.photo_start_url && !job?.photo_end_url) return null
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{f.servicePhotos}</div>
        <JobPhotos
          photoStartUrl={job.photo_start_url}
          photoEndUrl={job.photo_end_url}
          beforeLabel={f.before}
          afterLabel={f.after}
          size={48}
          onPhotoClick={setLightbox}
        />
      </div>
    )
  }

  const renderClientPhoto = (url) => {
    if (!url) return null
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{f.clientPhoto}</div>
        <button type="button" onClick={() => setLightbox(url)} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
          <img src={viewablePhotoUrl(url)} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover' }} />
        </button>
      </div>
    )
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

      <ClientSatisfactionPanel />

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
              {renderClientPhoto(r.photo_url)}
              {renderJobPhotos(r.job_id)}
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
              {renderClientPhoto(row.photo_url)}
              {renderJobPhotos(row.job_id)}
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
              {renderJobPhotos(row.job_id)}
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
              <button type="button" className="btn btn-sm" style={{ marginBottom: 8 }} onClick={() => setDossierFor(v => (v === row.id ? null : row.id))}>
                🏢 {t.facility.dossierTitle} {dossierFor === row.id ? '▲' : '▼'}
              </button>
              {dossierFor === row.id && (
                <StoreDossier clientId={row.client_id} locationName={row.location_name}
                  onUseSummary={row.request_type === 'quote' ? text => setQuoteDraft(d => ({ ...d, [row.id]: { ...d[row.id], note: text.replace(/\n/g, ' / ') } })) : undefined} />
              )}
              {row.request_type === 'quote' && (() => {
                const qs = row.quote_status || 'requested'
                const accountSeller = clients.find(c => c.id === row.client_id)?.salesperson_id || null
                const markup = Number(row.seller_markup || 0)
                const commState = quoteCommissionState(row)
                const open = qs === 'requested' || qs === 'priced' || (qs === 'quoted' && !markup)
                return (
                <div style={{ padding: 12, borderRadius: 10, background: 'var(--blue-bg)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
                    <span>{f.quoteRequest}{row.category ? ` · ${row.category}` : ''}</span>
                    <span className={`badge ${qs === 'accepted' ? 'badge-green' : qs === 'declined' ? 'badge-red' : qs === 'priced' ? 'badge-amber' : 'badge-blue'}`}>{f[`qs_${qs}`] || qs}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                    {accountSeller ? `${f.accountSeller}: ${sellerName(accountSeller)}` : f.noSeller}
                  </div>
                  {qs === 'priced' && <div style={{ fontSize: 12, marginBottom: 8 }}>{fill(f.withSeller, { name: sellerName(row.salesperson_id), base: yen(row.base_amount) })}</div>}
                  {row.base_amount != null && ['quoted', 'accepted', 'declined'].includes(qs) && (
                    <div style={{ fontSize: 12, marginBottom: 8 }}>{fill(f.priceSplit, { base: yen(row.base_amount), markup: yen(markup), total: yen(row.quote_amount) })}{row.salesperson_id ? ` · ${sellerName(row.salesperson_id)}` : ''}</div>
                  )}
                  {commState !== 'none' && commState !== 'void' && (
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12, marginBottom: 8 }}>
                      <span>{f.commission}: <b>{yen(markup)}</b> · {commState === 'paid' ? f.commissionPaid : commState === 'pending' ? f.commissionWaiting : ''}</span>
                      {commState === 'earned' && <button className="btn btn-sm" onClick={() => markCommissionPaid(row)}>{f.markCommissionPaid}</button>}
                    </div>
                  )}
                  {open && (
                    <div className="fb-quote-form">
                      <label style={{ fontSize: 11 }}>{accountSeller ? f.companyPrice : f.quoteAmount}
                        <input type="number" min="0" value={quoteDraft[row.id]?.amount ?? row.base_amount ?? row.quote_amount ?? ''} onChange={e => setQuoteDraft(d => ({ ...d, [row.id]: { ...d[row.id], amount: e.target.value } }))} style={{ width: '100%' }} />
                      </label>
                      <label style={{ fontSize: 11 }}>{f.quoteNote}
                        <input value={quoteDraft[row.id]?.note ?? row.quote_note ?? ''} onChange={e => setQuoteDraft(d => ({ ...d, [row.id]: { ...d[row.id], note: e.target.value } }))} style={{ width: '100%' }} />
                      </label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {accountSeller && qs === 'requested' && <button className="btn btn-sm btn-primary" title={f.toSellerHint} onClick={() => priceQuote(row, false)}>{f.toSeller}</button>}
                        <button className={`btn btn-sm${accountSeller && qs === 'requested' ? '' : ' btn-primary'}`} onClick={() => priceQuote(row, true)}>{accountSeller ? f.sendDirect : f.sendQuote}</button>
                      </div>
                    </div>
                  )}
                  {accountSeller && qs === 'requested' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{f.toSellerHint}</div>}
                </div>
                )
              })()}
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

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
