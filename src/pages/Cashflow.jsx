import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Cashflow() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState({ type:'income', category:'Client Payment', amount:'', description:'', date:new Date().toISOString().split('T')[0] })

  const INCOME_CATS = ['Client Payment','Spot Job','Bonus','Other Income']
  const EXPENSE_CATS = ['Salary','Supplies','Transport','Equipment','Tax','Other Expense']

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('caixa_movimentos').select('*').order('date', { ascending:false }).limit(100)
    setEntries(data||[])
    setLoading(false)
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleAdd = async () => {
    if (!form.amount||!form.description) return toast.error('Fill all fields')
    const { error } = await supabase.from('caixa_movimentos').insert({
      type: form.type, category: form.category,
      amount: parseFloat(form.amount),
      description: form.description, date: form.date
    })
    if (error) return toast.error(error.message)
    toast.success('Entry added!')
    setForm({ type:'income', category:'Client Payment', amount:'', description:'', date:new Date().toISOString().split('T')[0] })
    load(); setTab('overview')
  }

  const handleDelete = async (id) => {
    await supabase.from('caixa_movimentos').delete().eq('id', id)
    toast('Entry removed.'); load()
  }

  const month = new Date().toISOString().slice(0,7)
  const thisMonth = entries.filter(e=>e.date?.startsWith(month))
  const income = thisMonth.filter(e=>e.type==='income').reduce((s,e)=>s+Number(e.amount||0),0)
  const expense = thisMonth.filter(e=>e.type==='expense').reduce((s,e)=>s+Number(e.amount||0),0)
  const balance = income - expense

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='overview'?' active':''}`} onClick={()=>setTab('overview')}>Overview</button>
        <button className={`tab-pill${tab==='add'?' active':''}`} onClick={()=>setTab('add')}>+ Add Entry</button>
        <button className={`tab-pill${tab==='history'?' active':''}`} onClick={()=>setTab('history')}>History</button>
      </div>

      {tab==='overview'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
            {[['💴 Income',income,'var(--green)'],['💸 Expenses',expense,'var(--red)'],['💰 Balance',balance,balance>=0?'var(--green)':'var(--red)']].map(([l,v,c])=>(
              <div key={l} className="card" style={{textAlign:'center',padding:'18px'}}>
                <div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{l}</div>
                <div style={{fontSize:24,fontWeight:700,color:c}}>¥{Number(Math.abs(v)).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">This Month</div>
            {thisMonth.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No entries this month.</div>}
            {thisMonth.slice(0,15).map(e=>(
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500}}>{e.description}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>{e.date} · {e.category}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:14,fontWeight:600,color:e.type==='income'?'var(--green)':'var(--red)'}}>{e.type==='income'?'+':'-'}¥{Number(e.amount||0).toLocaleString()}</span>
                  <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(e.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==='add'&&(
        <div className="card">
          <div className="card-title">New Entry</div>
          <div className="grid-2">
            <div className="form-group"><label>Type</label>
              <select value={form.type} onChange={e=>upd('type',e.target.value)}>
                <option value="income">💴 Income</option>
                <option value="expense">💸 Expense</option>
              </select>
            </div>
            <div className="form-group"><label>Category</label>
              <select value={form.category} onChange={e=>upd('category',e.target.value)}>
                {(form.type==='income'?INCOME_CATS:EXPENSE_CATS).map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Amount (¥)</label><input type="number" value={form.amount} onChange={e=>upd('amount',e.target.value)} placeholder="50000" /></div>
            <div className="form-group"><label>Date</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Description</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Client payment — Hotel Grand" /></div>
          </div>
          <button className="btn btn-primary" onClick={handleAdd}>✅ Add Entry</button>
        </div>
      )}

      {tab==='history'&&(
        <div className="card">
          <div className="card-title">All Entries</div>
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {entries.length===0&&!loading&&<div style={{color:'var(--text3)',fontSize:13}}>No entries yet.</div>}
          {entries.map(e=>(
            <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div>
                <div style={{fontSize:13,fontWeight:500}}>{e.description}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>{e.date} · {e.category}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:13,fontWeight:600,color:e.type==='income'?'var(--green)':'var(--red)'}}>{e.type==='income'?'+':'-'}¥{Number(e.amount||0).toLocaleString()}</span>
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(e.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
