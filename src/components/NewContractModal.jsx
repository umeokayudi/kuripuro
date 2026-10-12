import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { buildSpotContractRow, emptySpotContractForm, contractPrefillFromClient, spotContractTotals, dueDateAfter, DEFAULT_PAYMENT_DAY, writtenAddress, serviceTypeJa, defaultScopeJa } from '../lib/spotContract'
import ContractDetailsFields from './ContractDetailsFields'
import { saveSpotContractWithInvoice } from '../lib/spotContractOps'
import { checklistTemplateForJob } from '../lib/jobChecklist'
import { fetchContractSellers } from '../lib/contractSellers'
import SellerCommissionFields from './SellerCommissionFields'
import toast from 'react-hot-toast'

// v1.0.21 · Contracts → Spot → "+ New contract": one form creates the job for the worker,
// the 業務委託契約書, its invoice (payment on day N of next month) and the saved PDF.

const EMPTY_JOB = { client_id: '', location_id: '', location_name: '', address: '', gps_lat: '', gps_lng: '', scheduled_date: '', scheduled_time: '', employee_id: '', spot_value: '', description: '', create_job: true }

export default function NewContractModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [employees, setEmployees] = useState([])
  const [job, setJob] = useState(EMPTY_JOB)
  const [contract, setContract] = useState(emptySpotContractForm())
  const [saving, setSaving] = useState(false)
  const [sellers, setSellers] = useState({ salespeople: [], rules: [] })

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('id,company_name,address,contact_person,contact_name,phone,manager_name,manager_phone').eq('is_active', true).order('company_name'),
      supabase.from('locations').select('*').eq('is_active', true).order('name'),
      supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name'),
    ]).then(([c, l, e]) => { setClients(c.data || []); setLocations(l.data || []); setEmployees(e.data || []) })
    fetchContractSellers().then(setSellers)
  }, [])

  const setJ = (k, v) => setJob(x => ({ ...x, [k]: v }))
  const setC = (k, v) => setContract(x => ({ ...x, [k]: v }))

  const pickClient = (id) => {
    setJ('client_id', id)
    const cli = clients.find(c => c.id === id)
    if (cli) setContract(x => ({ ...x, ...contractPrefillFromClient(cli) }))
  }
  const pickLocation = (id) => {
    const loc = locations.find(l => l.id === id)
    setJob(x => loc
      ? { ...x, location_id: id, location_name: loc.name, address: loc.address || '', gps_lat: loc.gps_lat || '', gps_lng: loc.gps_lng || '', description: x.description || loc.notes || '' }
      : { ...x, location_id: '' })
  }

  const save = async () => {
    if (!job.location_name.trim()) return toast.error('Location name is required')
    if (!job.scheduled_date) return toast.error('Pick the service date')
    if (job.create_job && (!job.employee_id || !job.address.trim())) return toast.error('To send the job, pick who does it and the address')
    setSaving(true)
    const cli = clients.find(c => c.id === job.client_id)
    const emp = employees.find(e => e.id === job.employee_id)
    const form = {
      title: job.location_name.trim(), client_id: job.client_id, employee_id: job.employee_id,
      scheduled_date: job.scheduled_date, scheduled_time: job.scheduled_time, address: job.address.trim(),
      value: contract.price, spot_value: job.spot_value, description: job.description, location_id: job.location_id,
      checklist_template: checklistTemplateForJob({ title: job.location_name }),
    }
    try {
      let inserted = null
      if (job.create_job) {
        const { data, error } = await supabase.from('jobs').insert({
          title: form.title, client_id: form.client_id || null, client_name: cli?.company_name || '',
          employee_id: form.employee_id, employee_name: emp?.full_name || '',
          scheduled_date: form.scheduled_date, scheduled_time: form.scheduled_time, address: form.address,
          gps_lat: job.gps_lat || null, gps_lng: job.gps_lng || null,
          value: parseFloat(contract.price) || 0, spot_value: parseFloat(job.spot_value) || 0,
          description: form.description, checklist_template: form.checklist_template, photo_required: false,
          job_category: 'spot', status: 'assigned', spot_status: 'pending',
        }).select().single()
        if (error) throw error
        inserted = data
      }
      const row = buildSpotContractRow({ contract, job: inserted, form, location: locations.find(l => l.id === job.location_id), client: cli, employee: emp })
      const result = await saveSpotContractWithInvoice(row)
      toast.success(`📄 Contract ${result.contract.contract_number} created${inserted ? ' · job sent to ' + (emp?.full_name || 'staff') : ''}`)
      if (result.invoice) toast.success(`💴 Invoice · payment due ${result.invoice.due_date}`)
      if (result.invoiceError) toast.error(`Invoice not created: ${result.invoiceError.message}`)
      onSaved?.(result)
    } catch (err) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  const t = spotContractTotals({ price: contract.price, tax_rate: contract.tax_rate, price_includes_tax: contract.price_includes_tax })
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="card" style={{ width: 'min(680px,100%)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="card-title">+ New contract 業務委託契約書</div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '2px 0 6px' }}>1 · Who and where</div>
        <div className="grid-2">
          <div className="form-group"><label>Client company (甲)</label>
            <select value={job.client_id} onChange={e => pickClient(e.target.value)}>
              <option value="">— No client / type below —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Saved location</label>
            <select value={job.location_id} onChange={e => pickLocation(e.target.value)}>
              <option value="">— New location —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Location name *</label><input value={job.location_name} onChange={e => setJ('location_name', e.target.value)} placeholder="Atomic Bar 新橋" /></div>
          <div className="form-group"><label>Location address</label><input value={job.address} onChange={e => setJ('address', e.target.value)} placeholder="東京都港区…" /></div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Company address (甲)</label><input value={contract.client_address} onChange={e => setC('client_address', e.target.value)} /></div>
          <div className="form-group"><label>Representative (代表者)</label><input value={contract.client_representative} onChange={e => setC('client_representative', e.target.value)} /></div>
          <div className="form-group"><label>Contact person · phone</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={contract.contact_name} onChange={e => setC('contact_name', e.target.value)} placeholder="山田" />
              <input value={contract.contact_phone} onChange={e => setC('contact_phone', e.target.value)} placeholder="03-…" />
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '6px 0 6px' }}>2 · When and who does it</div>
        <div className="grid-2">
          <div className="form-group"><label>Date *</label><input type="date" value={job.scheduled_date} onChange={e => setJ('scheduled_date', e.target.value)} /></div>
          <div className="form-group"><label>Time</label><input type="time" value={job.scheduled_time} onChange={e => setJ('scheduled_time', e.target.value)} /></div>
          <div className="form-group"><label>Assigned to</label>
            <select value={job.employee_id} onChange={e => setJ('employee_id', e.target.value)}>
              <option value="">—</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Staff pay (¥)</label><input type="number" value={job.spot_value} onChange={e => setJ('spot_value', e.target.value)} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '0 0 10px' }}>
          <input type="checkbox" checked={job.create_job} onChange={e => setJ('create_job', e.target.checked)} style={{ width: 'auto' }} />
          ⚡ Also send the spot job to the worker (they accept it in their portal)
        </label>

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '6px 0 6px' }}>3 · Price and payment</div>
        <div className="grid-2">
          <div className="form-group"><label>Price the location pays (¥)</label><input type="number" value={contract.price} onChange={e => setC('price', e.target.value)} /></div>
          <div className="form-group"><label>Tax</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={contract.tax_rate} onChange={e => setC('tax_rate', e.target.value)}><option value="10">10%</option><option value="8">8%</option><option value="0">0%</option></select>
              <select value={String(contract.price_includes_tax !== false)} onChange={e => setC('price_includes_tax', e.target.value === 'true')}><option value="true">tax included</option><option value="false">+ tax</option></select>
            </div>
          </div>
          <div className="form-group"><label>Payment day (next month)</label><input type="number" min="1" max="31" value={contract.payment_day} onChange={e => setC('payment_day', e.target.value)} /></div>
          <div className="form-group"><label>Summary</label>
            <div style={{ fontSize: 13, paddingTop: 8 }}>Total <strong>¥{t.total.toLocaleString()}</strong>{job.scheduled_date ? <> · due <strong>{dueDateAfter(job.scheduled_date, contract.payment_day || DEFAULT_PAYMENT_DAY)}</strong></> : null}</div>
          </div>
        </div>
        <div className="grid-2">
          <SellerCommissionFields sellers={sellers.salespeople} rules={sellers.rules} contract={contract} value={contract} onChange={patch => setContract(x => ({ ...x, ...patch }))} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', margin: '6px 0 6px' }}>4 · What the contract says (Japanese)</div>
        <ContractDetailsFields value={contract.contract_details || {}} onChange={d => setC('contract_details', d)} showClientAddress={false} showTerms={false} showScope={false}
          placeholders={{ written_address: writtenAddress(job.address) || undefined, responsible: contract.client_representative || contract.contact_name || undefined, service_label: serviceTypeJa(job.location_name) || undefined }} />
        <div className="form-group"><label>Scope of work in Japanese 作業範囲</label><textarea rows={3} value={contract.scope} onChange={e => setC('scope', e.target.value)} placeholder={defaultScopeJa(contract.contract_details?.service_label || serviceTypeJa(job.location_name)) || '厨房の清掃、レンジフード、床…'} /></div>
        <div className="form-group"><label>Special terms 特記事項 (Japanese)</label><textarea rows={2} value={contract.terms} onChange={e => setC('terms', e.target.value)} /></div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Saving creates the contract, its invoice and the PDF{job.create_job ? ', and sends the job to the worker' : ''}.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : '📄 Create contract'}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
