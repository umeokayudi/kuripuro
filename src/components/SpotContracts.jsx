import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { spotContractHtml, spotContractTotals, DEFAULT_PAYMENT_DAY, contractStatus, dueDateAfter } from '../lib/spotContract'
import { createSpotInvoice, generateContractForJob, saveContractPdf, contractPdfUrl, refreshSpotContractPdf } from '../lib/spotContractOps'
import NewContractModal from './NewContractModal'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import PhotoLightbox from './PhotoLightbox'
import { signatureForDisplay, SIGNATURE_INK } from '../lib/signature'
import { showPrintOverlay } from '../lib/openPrintHtml'
import { googleCalendarUrl } from '../lib/calendar'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import toast from 'react-hot-toast'

// v1.0.21 · Contracts → Spot contracts: every spot job's contract with the location, stored.

const STATUS_BADGE = { draft: 'badge-amber', approved: 'badge-green', rejected: 'badge-red', cancelled: 'badge-navy' }
const STATUS_LABEL = { draft: 'Awaiting approval', approved: 'Approved ✓', rejected: 'Not approved', cancelled: 'Cancelled' }
const INVOICE_LABEL = { draft: 'draft', sent: 'sent', paid: 'paid ✓', overdue: 'overdue', cancelled: 'cancelled' }

export default function SpotContracts() {
  const [params] = useSearchParams()
  const focusId = params.get('spot')
  const [rows, setRows] = useState([])
  const [jobs, setJobs] = useState({})
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [signing, setSigning] = useState(null)
  const [invoices, setInvoices] = useState({})
  const [unlinkedJobs, setUnlinkedJobs] = useState([])
  const [pickJob, setPickJob] = useState('')
  const [busy, setBusy] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [creating, setCreating] = useState(false)
  const proofInput = useRef()
  const proofFor = useRef(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data, error }, emps] = await Promise.all([
      supabase.from('spot_contracts').select('*').eq('is_active', true).order('service_date', { ascending: false }).limit(500),
      supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name'),
    ])
    setMissing(!!error)
    const list = data || []
    setRows(list)
    setEmployees(emps.data || [])
    const ids = list.map(r => r.job_id).filter(Boolean)
    if (ids.length) {
      const { data: js } = await supabase.from('jobs').select('id,title,status,spot_status,scheduled_date,scheduled_time,address,employee_name,client_name,description,job_category').in('id', ids)
      setJobs(Object.fromEntries((js || []).map(j => [j.id, j])))
    }
    const fids = list.map(r => r.fatura_id).filter(Boolean)
    if (fids.length) {
      const { data: fs } = await supabase.from('faturas').select('id,status,due_date,total').in('id', fids)
      setInvoices(Object.fromEntries((fs || []).map(f => [f.id, f])))
    }
    // Spot jobs without a contract, for "Generate contract"
    const { data: spots } = await supabase.from('jobs').select('*').eq('job_category', 'spot').neq('status', 'cancelled').order('scheduled_date', { ascending: false }).limit(200)
    const linked = new Set(list.map(r => r.job_id))
    setUnlinkedJobs((spots || []).filter(j => !linked.has(j.id)))
    setLoading(false)
  }

  useEffect(() => {
    if (!focusId || loading) return
    document.getElementById(`spot-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, loading])

  const printContract = async (c, lang) => {
    const sig = c.signature_url ? await signatureForDisplay(c.signature_url) : ''
    showPrintOverlay(spotContractHtml(c, lang, sig))
  }

  // Every change re-saves the PDF copy, then reloads so the card shows the new save time.
  const resavePdf = (id) => refreshSpotContractPdf(id).then(r => { if (r) load() })

  const openPdf = async (c) => {
    if (c.pdf_path) return window.open(contractPdfUrl(c.pdf_path, c.pdf_saved_at), '_blank', 'noopener')
    const tab = window.open('', '_blank')
    setBusy(`pdf-${c.id}`)
    try {
      const { blob } = await saveContractPdf(c)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
      toast.success('📥 PDF saved')
      load()
    } catch (err) { tab?.close(); toast.error(`PDF: ${err.message}`) } finally { setBusy('') }
  }

  const saveEdit = async () => {
    const e = editing
    const emp = employees.find(x => x.id === e.employee_id)
    const patch = {
      contact_name: e.contact_name || null, contact_phone: e.contact_phone || null,
      price: parseFloat(e.price) || 0, tax_rate: parseInt(e.tax_rate, 10) || 0, price_includes_tax: e.price_includes_tax !== false,
      scope: e.scope || null, terms: e.terms || null, notes: e.notes || null,
      client_address: e.client_address || null, client_representative: e.client_representative || null,
      payment_day: Math.max(1, Math.min(31, parseInt(e.payment_day, 10) || DEFAULT_PAYMENT_DAY)),
      service_date: e.service_date || null, service_time: e.service_time || null,
      employee_id: e.employee_id || null, employee_name: emp?.full_name || e.employee_name || '',
    }
    const { error } = await supabase.from('spot_contracts').update(patch).eq('id', e.id)
    if (error) return toast.error(error.message)
    // Keep the job in step: who does it and when.
    if (e.job_id) {
      const jobPatch = { scheduled_date: patch.service_date, scheduled_time: patch.service_time }
      if (patch.employee_id) Object.assign(jobPatch, { employee_id: patch.employee_id, employee_name: patch.employee_name })
      if (jobPatch.scheduled_date) await supabase.from('jobs').update(jobPatch).eq('id', e.job_id)
    }
    toast.success('Contract updated')
    setEditing(null)
    load()
    resavePdf(e.id)
  }

  const setStatus = async (c, status) => {
    if (status === 'cancelled' && !confirm('Cancel this contract? Its draft invoice is cancelled too.')) return
    const patch = { status, approved_at: status === 'approved' ? new Date().toISOString() : null }
    const { error } = await supabase.from('spot_contracts').update(patch).eq('id', c.id)
    if (error) return toast.error(error.message)
    // A contract that is not going ahead should not leave an unpaid draft invoice behind.
    const inv = invoices[c.fatura_id]
    if ((status === 'cancelled' || status === 'rejected') && inv && inv.status === 'draft') {
      await supabase.from('faturas').update({ status: 'cancelled' }).eq('id', inv.id)
    }
    if (status === 'draft' && inv && inv.status === 'cancelled') {
      await supabase.from('faturas').update({ status: 'draft' }).eq('id', inv.id)
    }
    load()
    resavePdf(c.id)
  }

  const makeInvoice = async (c) => {
    setBusy(`inv-${c.id}`)
    try {
      const f = await createSpotInvoice(c)
      toast.success(`💴 Invoice created · payment due ${f.due_date}`)
      load()
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }

  const generate = async () => {
    const job = unlinkedJobs.find(j => j.id === pickJob)
    if (!job) return toast.error('Pick a spot job')
    setBusy('gen')
    try {
      const result = await generateContractForJob(job)
      const { contract, invoiceError } = result
      toast.success(`📄 Contract ${contract.contract_number} generated`)
      if (invoiceError) toast.error(`Invoice not created: ${invoiceError.message}`)
      setPickJob('')
      await load()
      setEditing({ ...contract })
      result.pdf?.then(r => { if (r) load() })
    } catch (err) { toast.error(err.message) } finally { setBusy('') }
  }

  const addProofs = async (files) => {
    const c = proofFor.current
    if (!c || !files?.length) return
    setBusy(`photo-${c.id}`)
    try {
      const paths = []
      for (const [i, file] of [...files].entries()) {
        paths.push(await uploadJobPhoto(`jobs/${c.job_id || 'contracts'}/contract_${c.id}_${Date.now()}_${i}.jpg`, file))
      }
      const next = [...(c.proof_photos || []), ...paths]
      const { error } = await supabase.from('spot_contracts').update({ proof_photos: next }).eq('id', c.id)
      if (error) throw error
      toast.success(`📷 ${paths.length} photo(s) added`)
      load()
    } catch (err) { toast.error(err.message) } finally { setBusy(''); proofFor.current = null }
  }

  const removeProof = async (c, path) => {
    if (!confirm('Remove this photo from the contract?')) return
    const next = (c.proof_photos || []).filter(p => p !== path)
    await supabase.from('spot_contracts').update({ proof_photos: next }).eq('id', c.id)
    load()
  }

  const saveSignature = async (dataUrl, signedBy) => {
    const { error } = await supabase.from('spot_contracts').update({ signature_url: dataUrl, signed_by: signedBy, signed_at: new Date().toISOString(), status: 'approved', approved_at: new Date().toISOString() }).eq('id', signing.id)
    if (error) return toast.error(error.message)
    toast.success('Signed and approved ✓')
    const id = signing.id
    setSigning(null)
    load()
    resavePdf(id)
  }

  if (missing) return (
    <div className="card"><div style={{ fontSize: 13, color: 'var(--text2)' }}>The spot contracts table is not in the database yet (sql/2026-10-11_contratos_spot.sql).</div></div>
  )

  const q = query.trim().toLowerCase()
  const shown = rows
    .filter(r => filter === 'all' || contractStatus(r) === filter)
    .filter(r => !q || [r.location_name, r.client_name, r.employee_name, r.contract_number].some(v => String(v || '').toLowerCase().includes(q)))
  const total = shown.filter(r => !['cancelled', 'rejected'].includes(contractStatus(r))).reduce((s, r) => s + spotContractTotals(r).total, 0)

  return (
    <div>
      <div className="kp-two-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        {[['Contracts', rows.length], ['Awaiting approval', rows.filter(r => contractStatus(r) === 'draft').length], ['Approved', rows.filter(r => contractStatus(r) === 'approved').length], ['Value (shown)', '¥' + total.toLocaleString()]].map(([l, v]) => (
          <div key={l} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {['all', 'draft', 'approved', 'rejected', 'cancelled'].map(f => (
          <button key={f} type="button" className={`tab-pill${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS_LABEL[f]}</button>
        ))}
        <div className="form-group" style={{ flex: '1 1 200px', minWidth: 0, margin: 0 }}><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search location, staff, number…" /></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New contract</button>
      </div>
      <input ref={proofInput} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { addProofs(e.target.files); e.target.value = '' }} />
      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ flex: '1 1 260px', minWidth: 0, margin: 0 }}>
          <label>📄 Generate contract for a spot job</label>
          <select value={pickJob} onChange={e => setPickJob(e.target.value)}>
            <option value="">{unlinkedJobs.length ? '— Spot jobs without a contract —' : 'Every spot job already has a contract'}</option>
            {unlinkedJobs.map(j => <option key={j.id} value={j.id}>{j.scheduled_date} · {j.title} · {j.employee_name || '—'}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" disabled={!pickJob || busy === 'gen'} onClick={generate}>{busy === 'gen' ? '…' : '📄 Generate contract'}</button>
      </div>

      {loading && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div></div>}
      {!loading && shown.length === 0 && <div className="card"><div style={{ color: 'var(--text3)', fontSize: 13 }}>No spot contracts yet. Use + New contract, or send a spot job in Jobs → New Job.</div></div>}

      {shown.map(c => {
        const job = jobs[c.job_id]
        const t = spotContractTotals(c)
        return (
          <div key={c.id} id={`spot-${c.id}`} className="card" style={{ marginBottom: 10, border: focusId === c.id ? '2px solid var(--navy)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.location_name} <span className={`badge ${STATUS_BADGE[contractStatus(c)] || 'badge-navy'}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[contractStatus(c)]}</span></div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.contract_number} · {c.service_date || '—'} {c.service_time || ''} · 👷 {c.employee_name || '—'}</div>
                {c.client_name && <div style={{ fontSize: 12, color: 'var(--text3)' }}>🏢 {c.client_name}{c.contact_name ? ` · ${c.contact_name}` : ''}{c.contact_phone ? ` · ${c.contact_phone}` : ''}</div>}
                {!c.client_name && (c.contact_name || c.contact_phone) && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.contact_name} {c.contact_phone}</div>}
                {hasMapsLink(c.location_address, c.location_name) && <a href={mapsOpenUrl(c.location_address, c.location_name)} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>🗺 Maps</a>}
                {job && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Job: {job.status}{job.spot_status ? ` · employee ${job.spot_status}` : ''}</div>}
                {c.pdf_saved_at && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>📥 PDF saved {new Date(c.pdf_saved_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>}
                {c.signed_by && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>✍️ {c.signed_by} · {new Date(c.signed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>}
                {(() => { const inv = invoices[c.fatura_id]; return inv
                  ? <div style={{ fontSize: 12, marginTop: 4 }}>💴 Invoice {INVOICE_LABEL[inv.status] || inv.status} · <strong>payment due {inv.due_date}</strong> · <a href="/faturas" style={{ color: '#60a5fa' }}>open</a></div>
                  : <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text3)' }}>💴 No invoice yet · would be due {dueDateAfter(c.service_date, c.payment_day)}</div> })()}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>¥{t.total.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>staff +¥{Number(c.employee_pay || 0).toLocaleString()}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => printContract(c, 'ja')}>📄 契約書</button>
              <button className="btn btn-sm" onClick={() => printContract(c, 'en')}>📄 EN</button>
              <button className="btn btn-sm" disabled={busy === `pdf-${c.id}`} onClick={() => openPdf(c)}>{busy === `pdf-${c.id}` ? '…' : '📥 PDF'}</button>
              {contractStatus(c) === 'draft' && <button className="btn btn-sm" onClick={() => setSigning(c)}>✍️ Sign</button>}
              {contractStatus(c) !== 'approved' && contractStatus(c) !== 'cancelled' && <button className="btn btn-sm" style={{ background: 'var(--green)', color: '#fff' }} onClick={() => setStatus(c, 'approved')}>✓ Approved</button>}
              {contractStatus(c) === 'draft' && <button className="btn btn-sm" onClick={() => setStatus(c, 'rejected')}>✕ Not approved</button>}
              {['approved', 'rejected'].includes(contractStatus(c)) && <button className="btn btn-sm" onClick={() => setStatus(c, 'draft')}>↺ Awaiting</button>}
              <button className="btn btn-sm" disabled={busy === `photo-${c.id}`} onClick={() => { proofFor.current = c; proofInput.current?.click() }}>{busy === `photo-${c.id}` ? '…' : '📷 Add photo proof'}</button>
              {!c.fatura_id && !['cancelled', 'rejected'].includes(contractStatus(c)) && <button className="btn btn-sm" disabled={busy === `inv-${c.id}`} onClick={() => makeInvoice(c)}>💴 Create invoice</button>}
              <button className="btn btn-sm" onClick={() => setEditing({ ...c })}>✏️ Edit</button>
              {(job || c.service_date) && <a className="btn btn-sm" href={googleCalendarUrl(job || { title: c.location_name, scheduled_date: c.service_date, scheduled_time: c.service_time, address: c.location_address, employee_name: c.employee_name, job_category: 'spot' })} target="_blank" rel="noreferrer">📅 Google Calendar</a>}
              {contractStatus(c) !== 'cancelled' && <button className="btn btn-sm btn-danger" onClick={() => setStatus(c, 'cancelled')}>Cancel</button>}
              {contractStatus(c) === 'cancelled' && <button className="btn btn-sm" onClick={() => setStatus(c, 'draft')}>↺ Reopen</button>}
            </div>
            {(c.proof_photos || []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {c.proof_photos.map(p => (
                  <div key={p} style={{ position: 'relative' }}>
                    <img src={viewablePhotoUrl(p)} alt="proof" onClick={() => setLightbox(viewablePhotoUrl(p))} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', border: '1px solid var(--border)' }} />
                    <button type="button" aria-label="Remove photo" onClick={() => removeProof(c, p)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--red)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setEditing(null)}>
          <div className="card" style={{ width: 'min(640px,100%)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-title">Edit {editing.contract_number}</div>
            <div className="grid-2">
              <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Company address (甲)</label><input value={editing.client_address || ''} onChange={e => setEditing(x => ({ ...x, client_address: e.target.value }))} /></div>
              <div className="form-group"><label>Representative (代表者)</label><input value={editing.client_representative || ''} onChange={e => setEditing(x => ({ ...x, client_representative: e.target.value }))} /></div>
              <div className="form-group"><label>Payment day (next month)</label><input type="number" min="1" max="31" value={editing.payment_day ?? DEFAULT_PAYMENT_DAY} onChange={e => setEditing(x => ({ ...x, payment_day: e.target.value }))} /></div>
              <div className="form-group"><label>Contact person</label><input value={editing.contact_name || ''} onChange={e => setEditing(x => ({ ...x, contact_name: e.target.value }))} /></div>
              <div className="form-group"><label>Contact phone</label><input value={editing.contact_phone || ''} onChange={e => setEditing(x => ({ ...x, contact_phone: e.target.value }))} /></div>
              <div className="form-group"><label>Date</label><input type="date" value={editing.service_date || ''} onChange={e => setEditing(x => ({ ...x, service_date: e.target.value }))} /></div>
              <div className="form-group"><label>Time</label><input type="time" value={editing.service_time || ''} onChange={e => setEditing(x => ({ ...x, service_time: e.target.value }))} /></div>
              <div className="form-group"><label>Assigned to</label>
                <select value={editing.employee_id || ''} onChange={e => setEditing(x => ({ ...x, employee_id: e.target.value }))}>
                  <option value="">—</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Price (¥)</label><input type="number" value={editing.price ?? 0} onChange={e => setEditing(x => ({ ...x, price: e.target.value }))} /></div>
              <div className="form-group"><label>Tax</label><select value={editing.tax_rate ?? 10} onChange={e => setEditing(x => ({ ...x, tax_rate: e.target.value }))}><option value="10">10%</option><option value="8">8%</option><option value="0">0%</option></select></div>
              <div className="form-group"><label>Price includes tax?</label><select value={String(editing.price_includes_tax !== false)} onChange={e => setEditing(x => ({ ...x, price_includes_tax: e.target.value === 'true' }))}><option value="true">Yes</option><option value="false">No</option></select></div>
            </div>
            <div className="form-group"><label>Scope of work</label><textarea rows={3} value={editing.scope || ''} onChange={e => setEditing(x => ({ ...x, scope: e.target.value }))} /></div>
            <div className="form-group"><label>Special terms 特記事項</label><textarea rows={3} value={editing.terms || ''} onChange={e => setEditing(x => ({ ...x, terms: e.target.value }))} /></div>
            <div className="form-group"><label>Internal notes</label><input value={editing.notes || ''} onChange={e => setEditing(x => ({ ...x, notes: e.target.value }))} /></div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Changing date, time or staff also updates the job.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={saveEdit}>✅ Save</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel="Close" />
      {creating && <NewContractModal onClose={() => setCreating(false)} onSaved={({ contract, pdf }) => { setCreating(false); load(); pdf?.then(r => { if (r) load() }) }} />}
      {signing && <ContractSignModal contract={signing} onCancel={() => setSigning(null)} onConfirm={saveSignature} />}
    </div>
  )
}

/** White signature pad (dark ink on paper) + signer name. */
export function ContractSignModal({ contract, onCancel, onConfirm, labels = {} }) {
  const canvasRef = useRef()
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [name, setName] = useState(contract?.contact_name || '')

  const paper = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  useEffect(() => { paper() }, [])

  const pos = (e) => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const p = e.touches ? e.touches[0] : e
    return { x: (p.clientX - r.left) * c.width / r.width, y: (p.clientY - r.top) * c.height / r.height }
  }
  const start = (e) => {
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
    drawing.current = true
    setHasInk(true)
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = SIGNATURE_INK
    ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const end = () => { drawing.current = false }
  const clear = () => { paper(); setHasInk(false) }
  const ready = hasInk && name.trim()

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onCancel}>
      <div style={{ background: '#fff', color: '#122033', borderRadius: 16, padding: 18, width: 'min(460px,100%)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{labels.title || 'Location signature'}</div>
        <div style={{ fontSize: 12, color: '#5c6573', marginBottom: 10 }}>{contract?.contract_number} · {contract?.location_name} · ¥{spotContractTotals(contract).total.toLocaleString()}</div>
        <label style={{ fontSize: 12, color: '#5c6573' }}>{labels.name || 'Name of the person signing'}</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="山田 太郎" style={{ width: '100%', margin: '4px 0 10px', padding: 10, borderRadius: 8, border: '1px solid #cfd8e6', color: '#122033', background: '#fff' }} />
        <div style={{ border: '1px solid #cfd8e6', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
          <canvas ref={canvasRef} width={420} height={170} style={{ width: '100%', height: 170, display: 'block', touchAction: 'none' }}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
          {!hasInk && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b8', fontSize: 14, pointerEvents: 'none' }}>{labels.signHere || 'Sign here'}</div>}
        </div>
        <div style={{ fontSize: 11, color: '#5c6573', margin: '8px 0 12px' }}>{labels.agree || 'By signing, the location agrees to the date, price and terms of this contract.'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <button type="button" className="btn" onClick={clear}>{labels.clear || 'Clear'}</button>
          <button type="button" className="btn" onClick={onCancel}>{labels.cancel || 'Cancel'}</button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => onConfirm(canvasRef.current.toDataURL('image/png'), name.trim())}>✓ {labels.confirm || 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
