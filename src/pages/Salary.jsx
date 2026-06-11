import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'

const PAYROLL = [
  { name: 'Yuki Tanaka', hours: 88, rate: 1100, transport: 6160, bonus: 5000, deduction: 4400, paid: false },
  { name: 'Kenji Sato', hours: 96, rate: 1300, transport: 8400, bonus: 0, deduction: 6240, paid: true },
  { name: 'Mika Kobayashi', hours: 72, rate: 1150, transport: 4900, bonus: 3000, deduction: 4140, paid: false },
]

export default function Salary() {
  const { t } = useLang()
  const [period, setPeriod] = useState('2026-06')
  const [filter, setFilter] = useState('all')
  const [payroll, setPayroll] = useState(PAYROLL)

  const months = ['2026-06', '2026-05', '2026-04', '2026-03']

  const net = r => r.hours * r.rate + r.transport + r.bonus - r.deduction

  const filtered = filter === 'all' ? payroll : payroll.filter(r => r.name === filter)

  const total = filtered.reduce((s, r) => s + net(r), 0)

  const togglePaid = (name) => {
    setPayroll(p => p.map(r => r.name === name ? { ...r, paid: !r.paid } : r))
  }

  const exportCSV = () => {
    const rows = [
      ['Employee', 'Hours', 'Base', 'Transport', 'Bonus', 'Deductions', 'Net Total', 'Status'],
      ...filtered.map(r => [r.name, r.hours, r.hours * r.rate, r.transport, r.bonus, r.deduction, net(r), r.paid ? 'Paid' : 'Pending'])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `kuripuro-salary-${period}.csv`
    a.click()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title"><Icons.calc /> {t.salary.title}</div>
        <div className="grid-3">
          <div className="form-group">
            <label>{t.salary.period}</label>
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              {months.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{t.salary.employee || 'Employee'}</label>
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">{t.salary.allEmployees}</option>
              {PAYROLL.map(r => <option key={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 14 }}>
            <button className="btn btn-primary"><Icons.calc /> {t.salary.calculate}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Icons.file /> {t.salary.payroll} — {period}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.salary.employee || 'Employee'}</th>
                <th>{t.salary.baseHours}</th>
                <th>{t.salary.baseSalary}</th>
                <th>{t.salary.transportAllowance}</th>
                <th>{t.salary.bonus}</th>
                <th>{t.salary.deductions}</th>
                <th>{t.salary.netTotal}</th>
                <th>{t.salary.status}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.name}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>¥{r.rate}/h</div>
                  </td>
                  <td>{r.hours}h</td>
                  <td>¥{(r.hours * r.rate).toLocaleString()}</td>
                  <td>¥{r.transport.toLocaleString()}</td>
                  <td>¥{r.bonus.toLocaleString()}</td>
                  <td className="negative">-¥{r.deduction.toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>¥{net(r).toLocaleString()}</td>
                  <td>
                    <button
                      className={`badge ${r.paid ? 'badge-green' : 'badge-amber'}`}
                      style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
                      onClick={() => togglePaid(r.name)}
                    >
                      {r.paid ? t.salary.paid : t.salary.pending}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.salary.totalPayroll}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>¥{total.toLocaleString()}</div>
          </div>
          <div className="btn-row" style={{ margin: 0 }}>
            <button className="btn" onClick={() => window.location.href = '/ryoshu'}><Icons.receipt /> {t.salary.payslip}</button>
            <button className="btn btn-primary" onClick={exportCSV}><Icons.download /> {t.salary.exportCSV}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
