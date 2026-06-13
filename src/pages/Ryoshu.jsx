import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Ryoshu() {
  const [receipts, setReceipts] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ client_id:'', client_name:'', amount:'', description:'', issue_date:new Date().toISOString().split('T')[0], tax_rate:10 })

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [r, c] = await Promise.all([
      supabase.from('ryoshu').select('*').order('issue_date', { ascending:false }).limit(50),
      supabase.from('clients').select('id,company_name').eq('is_active',true).order('company_name'),
    ])
    setReceipts(r.data||[]); setClients(c.data||[])
    setLoading(false)
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleClientSelect = (id) => {
    const c = clients.find(c=>c.id===id)
    setForm(f=>({...f, client_id:id, client_name:c?.company_name||''}))
  }

  const handleCreate = async () => {
    if (!form.amount||!form.client_name) return toast.error('Fill required fields')
    const amount = parseFloat(form.amount)||0
    const tax = Math.round(amount * form.tax_rate/100)
    const total = amount + tax
    const { error } = await supabase.from('ryoshu').insert({
      client_id: form.client_id||null,
      client_name: form.client_name,
      amount, tax_amount:tax, total_amount:total,
      tax_rate: form.tax_rate,
      description: form.description,
      issue_date: form.issue_date,
      status: 'issued'
    })
    if (error) return toast.error(error.message)
    toast.success('領収書を作成しました!')
    setForm({ client_id:'', client_name:'', amount:'', description:'', issue_date:new Date().toISOString().split('T')[0], tax_rate:10 })
    setShowForm(false); load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this receipt?')) return
    await supabase.from('ryoshu').delete().eq('id', id)
    toast('Deleted.'); load()
  }

  const handlePrint = (r) => {
    const w = window.open('', '_blank')
    w.document.write(`
      <html><head><title>領収書</title>
      <style>body{font-family:sans-serif;padding:40px;max-width:400px;margin:0 auto}
      h1{text-align:center;font-size:24px;margin-bottom:30px}
      .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
      .total{font-size:20px;font-weight:bold;color:#0F6E56}
      .stamp{border:3px solid red;color:red;padding:4px 12px;display:inline-block;transform:rotate(-15deg);font-size:18px;font-weight:bold;margin-top:20px}
      </style></head>
      <body>
        <h1>領収書</h1>
        <div class="row"><span>発行日</span><span>${r.issue_date}</span></div>
        <div class="row"><span>宛名</span><span>${r.client_name} 御中</span></div>
        <div class="row"><span>但し書き</span><span>${r.description||'サービス代として'}</span></div>
        <div class="row"><span>小計</span><span>¥${Number(r.amount||0).toLocaleString()}</span></div>
        <div class="row"><span>消費税 (${r.tax_rate}%)</span><span>¥${Number(r.tax_amount||0).toLocaleString()}</span></div>
        <div class="row total"><span>合計金額</span><span>¥${Number(r.total_amount||0).toLocaleString()}</span></div>
        <div style="margin-top:30px;text-align:center"><div class="stamp">領収済</div></div>
        <div style="margin-top:40px;text-align:right"><p>KuriPuro by JBM</p></div>
      </body></html>
    `)
    w.document.close()
    w.print()
  }

  const totalMonth = receipts.filter(r=>r.issue_date?.startsWith(new Date().toISOString().slice(0,7))).reduce((s,r)=>s+Number(r.total_amount||0),0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,margin:0}}>領収書</h2>
          <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>今月合計: <strong>¥{totalMonth.toLocaleString()}</strong></div>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowForm(!showForm)}>+ 新規作成</button>
      </div>

      {showForm&&(
        <div className="card" style={{marginBottom:16,border:'1px solid var(--navy)'}}>
          <div className="card-title">新規領収書</div>
          <div className="grid-2">
            <div className="form-group"><label>クライアント</label>
              <select value={form.client_id} onChange={e=>handleClientSelect(e.target.value)}>
                <option value="">選択してください</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>宛名 *</label><input value={form.client_name} onChange={e=>upd('client_name',e.target.value)} placeholder="株式会社○○" /></div>
            <div className="form-group"><label>金額 (¥) *</label><input type="number" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
            <div className="form-group"><label>消費税率 (%)</label>
              <select value={form.tax_rate} onChange={e=>upd('tax_rate',parseInt(e.target.value))}>
                <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
              </select>
            </div>
            <div className="form-group"><label>発行日</label><input type="date" value={form.issue_date} onChange={e=>upd('issue_date',e.target.value)} /></div>
            <div className="form-group"><label>但し書き</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="サービス代として" /></div>
          </div>
          {form.amount&&<div style={{background:'var(--surface2)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:13}}>
            小計: ¥{Number(form.amount||0).toLocaleString()} + 税: ¥{Math.round(Number(form.amount||0)*form.tax_rate/100).toLocaleString()} = <strong>合計: ¥{(Number(form.amount||0)+Math.round(Number(form.amount||0)*form.tax_rate/100)).toLocaleString()}</strong>
          </div>}
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleCreate}>✅ 作成</button>
            <button className="btn" onClick={()=>setShowForm(false)}>キャンセル</button>
          </div>
        </div>
      )}

      {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
      {receipts.length===0&&!loading&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>領収書はまだありません。</div></div>}
      {receipts.map(r=>(
        <div key={r.id} className="card" style={{marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{r.client_name} 御中</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{r.issue_date} · {r.description||'サービス代'}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>¥{Number(r.total_amount||0).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>税込 ({r.tax_rate}%)</div>
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-sm btn-primary" onClick={()=>handlePrint(r)}>🖨️ 印刷</button>
            <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(r.id)}>🗑 削除</button>
          </div>
        </div>
      ))}
    </div>
  )
}
