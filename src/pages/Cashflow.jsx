import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'

const INIT_ENTRIES = [
  { id: 1, type: 'income', cat: 'Client Payment', desc: 'Hotel Grand — Jun', amount: 450000, date: '2026-06-10' },
  { id: 2, type: 'income', cat: 'Client Payment', desc: 'Clinic Sakura — Jun', amount: 360000, date: '2026-06-08' },
  { id: 3, type: 'income', cat: 'Client Payment', desc: 'Tokyo Office — Jun', amount: 300000, date: '2026-06-07' },
  { id: 4, type: 'expense', cat: 'Salaries', desc: 'Payroll Jun 2026', amount: 304540, date: '2026-06-05' },
  { id: 5, type: 'expense', cat: 'Cleaning Supplies', desc: 'Monthly supplies', amount: 87000, date: '2026-06-03' },
  { id: 6, type: 'expense', cat: 'Transport', desc: 'Staff transport Jun', amount: 45200, date: '2026-06-01' },
]

export default function Cashflow() {
  const { t } = useLang()
  const [entries, setEntries] = useState(INIT_ENTRIES)
  const [form, setForm] = useState({ type: 'income', cat: 'Client Payment', amount: '', date: new Date().toISOString().split('T')[0], desc: '' })

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const totalIncome = entries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0)
  const totalExpense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
  const net = totalIncome - totalExpense

  const handleAdd = () => {
    if (!form.amount || !form.desc) return toast.error('Fill in all fields')
    setEntries(e => [{ id: Date.now(), ...form, amount: parseInt(form.amount) }, ...e])
    setForm(f => ({ ...f, amount: '', desc: '' }))
    toast.success('Entry added')
  }

  const cats = [t.cashflow.clientPayment, t.cashflow.salaries, t.cashflow.supplies, t.cashflow.transportCost, t.cashflow.rent, t.cashflow.other]

  return (
    <div>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">{t.cashflow.income}</div>
          <div className="metric-value positive">¥{totalIncome.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.cashflow.expenses}</div>
          <div className="metric-value negative">¥{totalExpense.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.cashflow.netBalance}</div>
          <div className="metric-value" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>¥{net.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">{t.cashflow.accumulated}</div>
          <div className="metric-value" style={{ color: 'var(--navy)' }}>¥{(net + 2310000).toLocaleString()}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Icons.plus /> {t.cashflow.newEntry}</div>
        <div className="grid-3">
          <div className="form-group">
            <label>{t.cashflow.type}</label>
            <select value={form.type} onChange={e => upd('type', e.target.value)}>
              <option value="income">{t.cashflow.income}</option>
              <option value="expense">{t.cashflow.expenses}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t.cashflow.category}</label>
            <select value={form.cat} onChange={e => upd('cat', e.target.value)}>
              {cats.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{t.cashflow.value}</label>
            <input type="number" value={form.amount} onChange={e => upd('amount', e.target.value)} placeholder="0" />
          </div>
          <div className="form-group">
            <label>{t.cashflow.date}</label>
            <input type="date" value={form.date} onChange={e => upd('date', e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>{t.cashflow.description}</label>
            <input value={form.desc} onChange={e => upd('desc', e.target.value)} placeholder="..." />
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}><Icons.plus /> {t.cashflow.add}</button>
      </div>

      <div className="card">
        <div className="card-title"><Icons.list /> {t.cashflow.entries}</div>
        {entries.map(e => (
          <div key={e.id} className="cf-row">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span className="cf-desc">{e.desc}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{e.cat}</span>
            </div>
            <span className="cf-date">{e.date.slice(5).replace('-', '/')}</span>
            <span className={`cf-amt ${e.type === 'income' ? 'positive' : 'negative'}`}>
              {e.type === 'income' ? '+' : '-'}¥{e.amount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
