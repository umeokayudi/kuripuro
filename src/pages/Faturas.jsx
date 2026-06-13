import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Faturas() {
  const [faturas, setFaturas] = useState([])
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('list')
  const [selected, setSelected] = useState(null)
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ client_id:'', period_start:'', period_end:'', due_date:'', tax_rate:10, notes:'' })

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [f, c] = await Promise.all([
      supabase.from('faturas').select('*').order('created_at', { ascending:false }),
      supabase.from('clients').select('*').eq('is_active', true).order('company_name'),
    ])
    setFaturas(f.data||[]); setClients(c.data||[])
    setLoading(false)
  }

  const loadJobs = async (clientId, start, end) => {
    if (!clientId||!start||!end) return
    const { data } = await supabase.from('jobs').select('*')
      .eq('client_id', clientId)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .eq('status', 'completed')
    setJobs(data||[])
    setItems((data||[]).map(j=>({ job_id:j.id, description:j.title, quantity:1, unit_price:Number(j.value||j.spot_value||0), total:Number(j.value||j.spot_value||0) })))
  }

  const upd = (k,v) => {
    setForm(f=>({...f,[k]:v}))
    if (k==='client_id'||k==='period_start'||k==='period_end') {
      const nf = {...form,[k]:v}
      if (nf.client_id&&nf.period_start&&nf.period_end) loadJobs(nf.client_id, nf.period_start, nf.period_end)
    }
  }

  const updItem = (i, k, v) => setItems(its => its.map((it,idx) => {
    if (idx!==i) return it
    const updated = {...it,[k]:v}
    if (k==='quantity'||k==='unit_price') updated.total = (parseFloat(updated.quantity)||0)*(parseFloat(updated.unit_price)||0)
    return updated
  }))

  const addItem = () => setItems(its=>[...its,{ job_id:null, description:'', quantity:1, unit_price:0, total:0 }])
  const removeItem = (i) => setItems(its=>its.filter((_,idx)=>idx!==i))

  const subtotal = items.reduce((s,it)=>s+Number(it.total||0),0)
  const tax = Math.round(subtotal * (form.tax_rate||10)/100)
  const total = subtotal + tax

  const handleCreate = async () => {
    const client = clients.find(c=>c.id===form.client_id)
    if (!client) return toast.error('Select a client')
    if (items.length===0) return toast.error('Add at least one item')
    const { data: fatura, error } = await supabase.from('faturas').insert({
      client_id: form.client_id,
      client_name: client.company_name,
      period_start: form.period_start||null,
      period_end: form.period_end||null,
      issue_date: new Date().toISOString().split('T')[0],
      due_date: form.due_date||null,
      subtotal, tax_amount:tax, total,
      tax_rate: parseInt(form.tax_rate)||10,
      status: 'draft',
      notes: form.notes
    }).select().single()
    if (error) return toast.error(error.message)
    for (const item of items) {
      await supabase.from('fatura_items').insert({ fatura_id:fatura.id, ...item, quantity:parseInt(item.quantity)||1, unit_price:parseFloat(item.unit_price)||0, total:parseFloat(item.total)||0 })
    }
    toast.success('Fatura created!')
    setTab('list'); load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this fatura?')) return
    await supabase.from('faturas').delete().eq('id', id)
    toast('Deleted.'); load()
  }

  const handleStatusChange = async (id, status) => {
    await supabase.from('faturas').update({ status }).eq('id', id)
    toast.success(`Status: ${status}`); load()
  }

  const handlePrint = (f) => {
    const w = window.open('', '_blank')
    w.document.write(`
      <html><head><title>請求書 - ${f.client_name}</title>
      <style>
        body{font-family:'Hiragino Sans',sans-serif;padding:40px;max-width:600px;margin:0 auto;color:#333}
        h1{text-align:center;font-size:22px;margin-bottom:6px}
        .sub{text-align:center;color:#666;font-size:13px;margin-bottom:30px}
        table{width:100%;border-collapse:collapse;margin:20px 0}
        th{background:#001028;color:#fff;padding:8px 12px;text-align:left;font-size:12px}
        td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px}
        .total-row{font-weight:bold;font-size:15px}
        .badge{display:inline-block;background:#001028;color:#c19c56;padding:2px 10px;border-radius:20px;font-size:11px}
        .footer{margin-top:40px;text-align:right;font-size:12px;color:#666}
      </style></head>
      <body>
        <h1>請求書</h1>
        <div class="sub">KuriPuro by JBM</div>
        <table style="border:none">
          <tr><td style="border:none"><strong>請求先:</strong> ${f.client_name} 御中</td><td style="border:none;text-align:right"><strong>発行日:</strong> ${f.issue_date}</td></tr>
          <tr><td style="border:none"><strong>対象期間:</strong> ${f.period_start||'—'} 〜 ${f.period_end||'—'}</td><td style="border:none;text-align:right"><strong>支払期限:</strong> ${f.due_date||'—'}</td></tr>
        </table>
        <table>
          <thead><tr><th>内容</th><th>数量</th><th>単価</th><th>金額</th></tr></thead>
          <tbody id="items"></tbody>
        </table>
        <table style="border:none;width:300px;margin-left:auto">
          <tr><td style="border:none">小計</td><td style="border:none;text-align:right">¥${Number(f.subtotal||0).toLocaleString()}</td></tr>
          <tr><td style="border:none">消費税 (${f.tax_rate}%)</td><td style="border:none;text-align:right">¥${Number(f.tax_amount||0).toLocaleString()}</td></tr>
          <tr class="total-row"><td style="border-top:2px solid #333">合計金額</td><td style="border-top:2px solid #333;text-align:right">¥${Number(f.total||0).toLocaleString()}</td></tr>
        </table>
        ${f.notes?`<p style="margin-top:20px;font-size:13px;color:#666">備考: ${f.notes}</p>`:''}
        <div class="footer">KuriPuro by JBM<br>振込先等については別途ご連絡いたします</div>
      </body></html>
    `)
    w.document.close()
    w.print()
  }

  const statusBadge = s => ({draft:'badge-amber',sent:'badge-blue',paid:'badge-green',cancelled:'badge-red'}[s]||'badge-navy')

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>Faturas ({faturas.length})</button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ Nova Fatura</button>
      </div>

      {tab==='list'&&(
        <div>
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {faturas.length===0&&!loading&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No faturas yet.</div></div>}
          {faturas.map(f=>(
            <div key={f.id} className="card" style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>{f.client_name}</div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{f.period_start} 〜 {f.period_end}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>発行: {f.issue_date} · 期限: {f.due_date||'—'}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:18,fontWeight:700,color:'var(--green)'}}>¥{Number(f.total||0).toLocaleString()}</div>
                  <span className={`badge ${statusBadge(f.status)}`}>{f.status}</span>
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={()=>handlePrint(f)}>🖨️ Print</button>
                {f.status==='draft'&&<button className="btn btn-sm btn-primary" onClick={()=>handleStatusChange(f.id,'sent')}>📤 Mark Sent</button>}
                {f.status==='sent'&&<button className="btn btn-sm" style={{background:'var(--green)',color:'#fff'}} onClick={()=>handleStatusChange(f.id,'paid')}>✅ Mark Paid</button>}
                {f.status!=='cancelled'&&<button className="btn btn-sm btn-danger" onClick={()=>handleStatusChange(f.id,'cancelled')}>Cancel</button>}
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(f.id)}>🗑 Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='new'&&(
        <div>
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">Nova Fatura</div>
            <div className="grid-2">
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label>Client *</label>
                <select value={form.client_id} onChange={e=>upd('client_id',e.target.value)}>
                  <option value="">Select client...</option>
                  {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Period Start</label><input type="date" value={form.period_start} onChange={e=>upd('period_start',e.target.value)} /></div>
              <div className="form-group"><label>Period End</label><input type="date" value={form.period_end} onChange={e=>upd('period_end',e.target.value)} /></div>
              <div className="form-group"><label>Due Date</label><input type="date" value={form.due_date} onChange={e=>upd('due_date',e.target.value)} /></div>
              <div className="form-group"><label>Tax Rate (%)</label>
                <select value={form.tax_rate} onChange={e=>upd('tax_rate',e.target.value)}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
              <div className="form-group" style={{gridColumn:'1/-1'}}><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>

          <div className="card" style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{margin:0}}>Items {jobs.length>0&&<span style={{fontSize:11,color:'var(--text3)',fontWeight:400}}>({jobs.length} completed jobs found)</span>}</div>
              <button className="btn btn-sm btn-primary" onClick={addItem}>+ Add Item</button>
            </div>
            {items.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No items. Select client + period or add manually.</div>}
            {items.map((it,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'3fr 1fr 1fr 1fr auto',gap:8,marginBottom:8,alignItems:'center'}}>
                <input value={it.description} onChange={e=>updItem(i,'description',e.target.value)} placeholder="Description" style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <input type="number" value={it.quantity} onChange={e=>updItem(i,'quantity',e.target.value)} placeholder="Qty" style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <input type="number" value={it.unit_price} onChange={e=>updItem(i,'unit_price',e.target.value)} placeholder="Price" style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <div style={{fontSize:13,fontWeight:600,color:'var(--green)'}}>¥{Number(it.total||0).toLocaleString()}</div>
                <button className="btn btn-sm btn-danger" onClick={()=>removeItem(i)}>✕</button>
              </div>
            ))}
            <div style={{borderTop:'1px solid var(--border)',marginTop:12,paddingTop:12}}>
              <div style={{display:'flex',justifyContent:'flex-end',gap:20,fontSize:13}}>
                <span style={{color:'var(--text3)'}}>Subtotal: <strong>¥{subtotal.toLocaleString()}</strong></span>
                <span style={{color:'var(--text3)'}}>Tax ({form.tax_rate}%): <strong>¥{tax.toLocaleString()}</strong></span>
                <span style={{color:'var(--green)',fontWeight:700,fontSize:15}}>Total: ¥{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleCreate}>✅ Create Fatura</button>
            <button className="btn" onClick={()=>setTab('list')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
