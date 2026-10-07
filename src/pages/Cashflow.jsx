import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

/** Normaliza linha do DB (entry_type/entry_date) para UI (type/date) */
function normalizeEntry(row) {
  if (!row) return row
  return {
    ...row,
    type: row.type || row.entry_type,
    date: row.date || row.entry_date,
  }
}

export default function Cashflow() {
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [salaryPayments, setSalaryPayments] = useState([])
  const [transportClaims, setTransportClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState({ type:'income', category:'Client Payment', amount:'', description:'', date:new Date().toISOString().split('T')[0] })
  const [period, setPeriod] = useState(new Date().toISOString().slice(0,7))

  const INCOME_CATS = ['Client Payment','Spot Job','Bonus','Other Income']
  const EXPENSE_CATS = ['Salary','Supplies','Transport','Equipment','Tax','Other Expense']

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data, error }, { data: invoiceData }, { data: salaryData }, { data: transportData }, { data: clientData }, { data: jobData }] = await Promise.all([
      supabase.from('cashflow').select('*').order('entry_date', { ascending:false }).limit(500),
      supabase.from('faturas').select('id,client_id,client_name,issue_date,due_date,total,status,paid_at').order('issue_date', { ascending:false }).limit(500),
      supabase.from('salary_payments').select('id,employee_id,employee_name,amount,payment_date,status,payment_type,is_deduction').order('payment_date', { ascending:false }).limit(1000),
      supabase.from('transport_claims').select('id,employee_id,employee_name,job_id,amount,claim_date,status').order('claim_date', { ascending:false }).limit(1000),
    ])
    if (error) return toast.error(error.message)
    setEntries((data || []).map(normalizeEntry))
    setInvoices(invoiceData || [])
    setSalaryPayments(salaryData || [])
    setTransportClaims(transportData || [])
    setLoading(false)
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleAdd = async () => {
    if (!form.amount||!form.description) return toast.error('Fill all fields')
    const { error } = await supabase.from('cashflow').insert({
      entry_type: form.type,
      category: form.category,
      amount: parseFloat(form.amount),
      description: form.description,
      entry_date: form.date,
    })
    if (error) return toast.error(error.message)
    toast.success('Entry added!')
    setForm({ type:'income', category:'Client Payment', amount:'', description:'', date:new Date().toISOString().split('T')[0] })
    load(); setTab('overview')
  }

  const handleDelete = async (id) => {
    await supabase.from('cashflow').delete().eq('id', id)
    toast('Entry removed.'); load()
  }

  const month = period
  const thisMonth = entries.filter(e=>e.date?.startsWith(month))
  const income = thisMonth.filter(e=>e.type==='income').reduce((s,e)=>s+Number(e.amount||0),0)
  const expense = thisMonth.filter(e=>e.type==='expense').reduce((s,e)=>s+Number(e.amount||0),0)
  const balance = income - expense
  const issued = invoices.filter(f=>f.issue_date?.startsWith(month) && f.status !== 'cancelled').reduce((s,f)=>s+Number(f.total||0),0)
  const receivable = invoices.filter(f=>f.status === 'sent' || f.status === 'draft').reduce((s,f)=>s+Number(f.total||0),0)
  const today = new Date().toISOString().slice(0,10)
  const overdue = invoices.filter(f=>(f.status === 'sent' || f.status === 'draft') && f.due_date && f.due_date < today).reduce((s,f)=>s+Number(f.total||0),0)
  const paidSalary = salaryPayments
    .filter(p => p.status === 'paid' && !p.is_deduction && p.payment_date?.startsWith(month))
    .reduce((s,p)=>s+Number(p.amount||0),0)
  const paidTransport = transportClaims
    .filter(p => ['paid','approved','reimbursed'].includes(p.status) && p.claim_date?.startsWith(month))
    .reduce((s,p)=>s+Number(p.amount||0),0)
  const manualSalary = thisMonth.filter(e=>e.type==='expense' && e.category==='Salary').reduce((s,e)=>s+Number(e.amount||0),0)
  const manualTransport = thisMonth.filter(e=>e.type==='expense' && e.category==='Transport').reduce((s,e)=>s+Number(e.amount||0),0)
  const salaryCost = Math.max(paidSalary, manualSalary)
  const transportCost = Math.max(paidTransport, manualTransport)
  const otherExpense = Math.max(0, expense - manualSalary - manualTransport)
  const realCosts = salaryCost + transportCost + otherExpense
  const realProfit = income - realCosts
  const realMargin = income > 0 ? (realProfit / income) * 100 : 0
  const projected = income + receivable - realCosts

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='overview'?' active':''}`} onClick={()=>setTab('overview')}>Overview</button>
        <button className={`tab-pill${tab==='add'?' active':''}`} onClick={()=>setTab('add')}>+ Add Entry</button>
        <button className={`tab-pill${tab==='history'?' active':''}`} onClick={()=>setTab('history')}>History</button>
      </div>

      {tab==='overview'&&(
        <div>
          <div className="finance-toolbar">
            <div>
              <div className="finance-eyebrow">FINANCE HQ</div>
              <h3>Visão financeira</h3>
              <p>Caixa real + faturamento + valores que ainda precisam entrar.</p>
            </div>
            <input type="month" value={period} onChange={e=>setPeriod(e.target.value)} />
          </div>
          <div className="finance-kpis">
            {[
              ['Faturado', issued, 'var(--navy)'],
              ['Recebido', income, 'var(--green)'],
              ['A receber', receivable, 'var(--hq-blue)'],
              ['Vencido', overdue, 'var(--red)'],
              ['Despesas', expense, 'var(--red)'],
              ['Projeção', projected, projected >= 0 ? 'var(--green)' : 'var(--red)'],
            ].map(([label,value,color]) => (
              <div className="finance-kpi" key={label}>
                <span>{label}</span><strong style={{color}}>¥{Math.abs(value).toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <div className="finance-kpis" style={{marginTop:12}}>
            <div className="finance-kpi"><span>Lucro real</span><strong style={{color:realProfit>=0?'var(--green)':'var(--red)'}}>¥{Math.abs(realProfit).toLocaleString()}</strong></div>
            <div className="finance-kpi"><span>Margem real</span><strong style={{color:realMargin>=0?'var(--green)':'var(--red)'}}>{realMargin.toFixed(1)}%</strong></div>
          </div>
          <div className="finance-summary-grid">
            <div className="card finance-focus-card">
              <div className="card-title">Situação do mês</div>
              <div className="finance-big-row"><span>Entradas registradas</span><strong className="finance-positive">¥{income.toLocaleString()}</strong></div>
              <div className="finance-big-row"><span>Despesas registradas</span><strong className="finance-negative">¥{expense.toLocaleString()}</strong></div>
              <div className="finance-big-row"><span>Custos reais</span><strong className="finance-negative">¥{realCosts.toLocaleString()}</strong></div>
              <div className="finance-big-row finance-total"><span>Lucro real</span><strong className={realProfit>=0?'finance-positive':'finance-negative'}>¥{Math.abs(realProfit).toLocaleString()}</strong></div>
            </div>
            <div className="card finance-focus-card">
              <div className="card-title">Cobranças</div>
              <div className="finance-big-row"><span>Faturas emitidas</span><strong>¥{issued.toLocaleString()}</strong></div>
              <div className="finance-big-row"><span>Em aberto</span><strong className="finance-blue">¥{receivable.toLocaleString()}</strong></div>
              <div className="finance-big-row finance-total"><span>Vencido</span><strong className="finance-negative">¥{overdue.toLocaleString()}</strong></div>
            </div>
          </div>
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">Onde o dinheiro está indo</div>
            <div className="finance-big-row"><span>Salários pagos</span><strong>¥{salaryCost.toLocaleString()}</strong></div>
            <div className="finance-big-row"><span>Transporte</span><strong>¥{transportCost.toLocaleString()}</strong></div>
            <div className="finance-big-row"><span>Outras despesas</span><strong>¥{otherExpense.toLocaleString()}</strong></div>
            <div className="finance-big-row finance-total"><span>Total de custos reais</span><strong>¥{realCosts.toLocaleString()}</strong></div>
          </div>
          <div className="card">
            <div className="card-title">Movimentações do mês</div>
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
