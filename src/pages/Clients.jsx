import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'

const INIT_CLIENTS = [
  { id: 1, name: 'Hotel Grand', contact: 'Tanaka Hiroshi', phone: '03-1111-2222', serviceType: 'Daily cleaning', revenue: 450000, cost: 130000, status: 'Active' },
  { id: 2, name: 'Clinic Sakura', contact: 'Sato Keiko', phone: '03-3333-4444', serviceType: 'Weekly cleaning', revenue: 360000, cost: 90000, status: 'Active' },
  { id: 3, name: 'Tokyo Office', contact: 'Yamamoto Ryo', phone: '03-5555-6666', serviceType: 'Daily cleaning', revenue: 300000, cost: 75000, status: 'Active' },
  { id: 4, name: 'Fit+ Gym', contact: 'Ito Mana', phone: '03-7777-8888', serviceType: 'Weekly cleaning', revenue: 200000, cost: 50000, status: 'Active' },
  { id: 5, name: 'Zen Restaurant', contact: 'Suzuki Taro', phone: '03-9999-0000', serviceType: 'Night cleaning', revenue: 120000, cost: 26000, status: 'Active' },
]

export default function Clients() {
  const { t } = useLang()
  const [tab, setTab] = useState('list')
  const [clients, setClients] = useState(INIT_CLIENTS)
  const [form, setForm] = useState({ name: '', contact: '', phone: '', email: '', address: '', serviceType: 'Daily cleaning', revenue: 400000, cost: 200000 })

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleAdd = () => {
    setClients(c => [...c, { id: Date.now(), ...form, status: 'Active' }])
    toast.success(t.clients.clientAdded)
    setTab('list')
    setForm({ name: '', contact: '', phone: '', email: '', address: '', serviceType: 'Daily cleaning', revenue: 400000, cost: 200000 })
  }

  const totalRevenue = clients.reduce((s, c) => s + c.revenue, 0)
  const totalCost = clients.reduce((s, c) => s + c.cost, 0)
  const totalProfit = totalRevenue - totalCost

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{t.clients.list}</button>
        <button className={`tab-pill${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>{t.clients.register}</button>
        <button className={`tab-pill${tab === 'services' ? ' active' : ''}`} onClick={() => setTab('services')}>{t.clients.services}</button>
      </div>

      {tab === 'list' && clients.map(c => {
        const profit = c.revenue - c.cost
        const margin = Math.round(profit / c.revenue * 100)
        return (
          <div key={c.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.contact} · {c.phone}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.serviceType}</div>
              </div>
              <span className="badge badge-green">{c.status}</span>
            </div>
            <div className="grid-3" style={{ gap: 10 }}>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>¥{(c.revenue / 1000).toFixed(0)}k</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.clients.revenue}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--green)' }}>¥{(profit / 1000).toFixed(0)}k</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.clients.profit}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{margin}%</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.clients.margin}</div>
              </div>
            </div>
          </div>
        )
      })}

      {tab === 'register' && (
        <div className="card">
          <div className="card-title"><Icons.building /> {t.clients.register}</div>
          <div className="grid-2">
            <div className="form-group"><label>{t.clients.companyName}</label><input value={form.name} onChange={e => upd('name', e.target.value)} /></div>
            <div className="form-group"><label>{t.clients.contactPerson}</label><input value={form.contact} onChange={e => upd('contact', e.target.value)} /></div>
            <div className="form-group"><label>{t.clients.phone}</label><input value={form.phone} onChange={e => upd('phone', e.target.value)} /></div>
            <div className="form-group"><label>{t.clients.email}</label><input type="email" value={form.email} onChange={e => upd('email', e.target.value)} /></div>
            <div className="form-group"><label>{t.clients.address}</label><input value={form.address} onChange={e => upd('address', e.target.value)} /></div>
            <div className="form-group">
              <label>{t.clients.serviceType}</label>
              <select value={form.serviceType} onChange={e => upd('serviceType', e.target.value)}>
                <option>Daily cleaning</option>
                <option>Weekly cleaning</option>
                <option>Monthly cleaning</option>
                <option>Post-construction cleaning</option>
                <option>Night cleaning</option>
              </select>
            </div>
            <div className="form-group"><label>{t.clients.contractValue}</label><input type="number" value={form.revenue} onChange={e => upd('revenue', parseInt(e.target.value))} /></div>
            <div className="form-group"><label>{t.clients.estimatedCost}</label><input type="number" value={form.cost} onChange={e => upd('cost', parseInt(e.target.value))} /></div>
          </div>
          <button className="btn btn-primary" onClick={handleAdd}><Icons.check /> {t.clients.registerBtn}</button>
        </div>
      )}

      {tab === 'services' && (
        <div className="card">
          <div className="card-title"><Icons.list /> {t.clients.services}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.clients.companyName}</th><th>{t.clients.serviceType}</th><th>{t.clients.revenue}</th><th>{t.clients.cost}</th><th>{t.clients.profit}</th><th>{t.clients.margin}</th></tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  const profit = c.revenue - c.cost
                  const margin = Math.round(profit / c.revenue * 100)
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td>{c.serviceType}</td>
                      <td>¥{c.revenue.toLocaleString()}</td>
                      <td>¥{c.cost.toLocaleString()}</td>
                      <td className="positive">¥{profit.toLocaleString()}</td>
                      <td><span className={`badge ${margin >= 60 ? 'badge-green' : margin >= 40 ? 'badge-amber' : 'badge-red'}`}>{margin}%</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 30 }}>
            <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.clients.totalRevenue}</div><div style={{ fontSize: 18, fontWeight: 600 }}>¥{totalRevenue.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.clients.totalCost}</div><div style={{ fontSize: 18, fontWeight: 600, color: 'var(--red)' }}>¥{totalCost.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.clients.totalProfit}</div><div style={{ fontSize: 18, fontWeight: 600, color: 'var(--green)' }}>¥{totalProfit.toLocaleString()}</div></div>
          </div>
        </div>
      )}
    </div>
  )
}
