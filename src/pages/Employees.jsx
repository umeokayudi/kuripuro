import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'

const INIT_EMPLOYEES = [
  { id: 1, name: 'Yuki Tanaka', role: 'Cleaning Staff', initials: 'YT', color: '#185FA5', bg: '#E6F1FB', score: 87, hours: 88, complaints: 1, contract: 'Full-time', rate: 1100 },
  { id: 2, name: 'Kenji Sato', role: 'Supervisor', initials: 'KS', color: '#0F6E56', bg: '#E1F5EE', score: 73, hours: 96, complaints: 2, contract: 'Full-time', rate: 1300 },
  { id: 3, name: 'Mika Kobayashi', role: 'Specialist Cleaning', initials: 'MK', color: '#854F0B', bg: '#FAEEDA', score: 95, hours: 72, complaints: 0, contract: 'Part-time', rate: 1150 },
]
const CLIENTS = ['Hotel Grand', 'Clinic Sakura', 'Tokyo Office', 'Fit+ Gym', 'Zen Restaurant']
const COMPLAINT_TYPES = [
  { label: null, value: 5 },
  { label: null, value: 10 },
  { label: null, value: 3 },
  { label: null, value: 8 },
  { label: null, value: 2 },
]

export default function Employees() {
  const { t } = useLang()
  const [tab, setTab] = useState('list')
  const [employees, setEmployees] = useState(INIT_EMPLOYEES)
  const [rec, setRec] = useState({ empId: 1, client: CLIENTS[0], type: 5, desc: '' })
  const [newEmp, setNewEmp] = useState({
    name: '', phone: '', email: '', dob: '', address: '', myNumber: '',
    contract: 'Full-time', rate: 1100,
    bank: '', branch: '', accType: '普通', accNum: '', accHolder: '',
  })

  const scoreClass = s => s >= 90 ? 'score-excellent' : s >= 70 ? 'score-regular' : 'score-attention'
  const scoreLabel = s => s >= 90 ? t.employees.excellent : s >= 70 ? t.employees.regular : t.employees.attention
  const scoreBadge = s => s >= 90 ? 'badge-green' : s >= 70 ? 'badge-amber' : 'badge-red'

  const complaintTypes = [
    { label: t.employees.incompleteService, value: 5 },
    { label: t.employees.misconduct, value: 10 },
    { label: t.employees.lateness, value: 3 },
    { label: t.employees.propertyDamage, value: 8 },
    { label: t.employees.other, value: 2 },
  ]

  const handleComplaint = () => {
    setEmployees(emps => emps.map(e =>
      e.id === rec.empId
        ? { ...e, score: Math.max(0, e.score - rec.type), complaints: e.complaints + 1 }
        : e
    ))
    toast.error(t.employees.complaintAdded)
    setTab('list')
  }

  const handleAddEmployee = () => {
    const initials = newEmp.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const colors = [['#185FA5','#E6F1FB'],['#0F6E56','#E1F5EE'],['#854F0B','#FAEEDA'],['#7F77DD','#EEEDFE']]
    const [color, bg] = colors[employees.length % colors.length]
    setEmployees(emps => [...emps, {
      id: Date.now(), name: newEmp.name, role: newEmp.contract, initials, color, bg,
      score: 100, hours: 0, complaints: 0, contract: newEmp.contract, rate: newEmp.rate,
    }])
    toast.success(t.employees.employeeAdded)
    setTab('list')
  }

  const upd = (k, v) => setNewEmp(n => ({ ...n, [k]: v }))

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')}>{t.employees.list}</button>
        <button className={`tab-pill${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>{t.employees.register}</button>
        <button className={`tab-pill${tab === 'complaints' ? ' active' : ''}`} onClick={() => setTab('complaints')}>{t.employees.complaints}</button>
      </div>

      {tab === 'list' && employees.map(e => (
        <div key={e.id} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div className="avatar" style={{ background: e.bg, color: e.color, width: 44, height: 44, fontSize: 15 }}>{e.initials}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{e.role} · ¥{e.rate}/h</div>
            </div>
            <span className={`badge ${scoreBadge(e.score)}`}>{scoreLabel(e.score)}</span>
          </div>

          <div className="grid-3" style={{ gap: 10, marginBottom: 14 }}>
            <div style={{ textAlign: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '10px 0' }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: e.score >= 90 ? 'var(--green)' : e.score >= 70 ? '#EF9F27' : 'var(--red)' }}>{e.score}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.employees.score}</div>
            </div>
            <div style={{ textAlign: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '10px 0' }}>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{e.hours}h</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.employees.hoursMonth}</div>
            </div>
            <div style={{ textAlign: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '10px 0' }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: e.complaints > 0 ? 'var(--red)' : 'var(--green)' }}>{e.complaints}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.employees.complaints}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{t.employees.score}</div>
            <div className="score-bar">
              <div className={`score-fill ${scoreClass(e.score)}`} style={{ width: e.score + '%' }} />
            </div>
          </div>
        </div>
      ))}

      {tab === 'register' && (
        <div className="card">
          <div className="card-title"><Icons.user /> {t.employees.register}</div>
          <div className="grid-2">
            <div className="form-group"><label>{t.employees.fullName}</label><input value={newEmp.name} onChange={e => upd('name', e.target.value)} /></div>
            <div className="form-group"><label>{t.employees.phone}</label><input value={newEmp.phone} onChange={e => upd('phone', e.target.value)} placeholder="090-1234-5678" /></div>
            <div className="form-group"><label>{t.employees.email}</label><input type="email" value={newEmp.email} onChange={e => upd('email', e.target.value)} /></div>
            <div className="form-group"><label>{t.employees.dob}</label><input type="date" value={newEmp.dob} onChange={e => upd('dob', e.target.value)} /></div>
            <div className="form-group"><label>{t.employees.address}</label><input value={newEmp.address} onChange={e => upd('address', e.target.value)} /></div>
            <div className="form-group"><label>{t.employees.myNumber}</label><input value={newEmp.myNumber} onChange={e => upd('myNumber', e.target.value)} placeholder="0000-0000-0000" /></div>
            <div className="form-group">
              <label>{t.employees.contractType}</label>
              <select value={newEmp.contract} onChange={e => upd('contract', e.target.value)}>
                <option>{t.employees.fullTime}</option>
                <option>{t.employees.partTime}</option>
                <option>{t.employees.freelancer}</option>
              </select>
            </div>
            <div className="form-group"><label>{t.employees.hourlyRate}</label><input type="number" value={newEmp.rate} onChange={e => upd('rate', e.target.value)} /></div>
          </div>

          <div className="form-section-title"><Icons.bank /> {t.employees.bankInfo}</div>
          <div className="grid-2">
            <div className="form-group"><label>{t.employees.bankName}</label><input value={newEmp.bank} onChange={e => upd('bank', e.target.value)} placeholder="Japan Post / Mizuho..." /></div>
            <div className="form-group"><label>{t.employees.branch}</label><input value={newEmp.branch} onChange={e => upd('branch', e.target.value)} placeholder="001" /></div>
            <div className="form-group">
              <label>{t.employees.accountType}</label>
              <select value={newEmp.accType} onChange={e => upd('accType', e.target.value)}>
                <option value="普通">普通（普通預金）</option>
                <option value="当座">当座（当座預金）</option>
              </select>
            </div>
            <div className="form-group"><label>{t.employees.accountNumber}</label><input value={newEmp.accNum} onChange={e => upd('accNum', e.target.value)} placeholder="1234567" /></div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>{t.employees.accountHolder}</label>
              <input value={newEmp.accHolder} onChange={e => upd('accHolder', e.target.value)} placeholder="ヤマモト ハナコ" />
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleAddEmployee}><Icons.check /> {t.employees.registerBtn}</button>
        </div>
      )}

      {tab === 'complaints' && (
        <div className="card">
          <div className="card-title"><Icons.alert /> {t.employees.complaintsForm}</div>
          <div className="grid-2">
            <div className="form-group">
              <label>{t.employees.employee}</label>
              <select value={rec.empId} onChange={e => setRec(r => ({ ...r, empId: parseInt(e.target.value) }))}>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t.employees.complainantClient}</label>
              <select value={rec.client} onChange={e => setRec(r => ({ ...r, client: e.target.value }))}>
                {CLIENTS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t.employees.complaintType}</label>
              <select value={rec.type} onChange={e => setRec(r => ({ ...r, type: parseInt(e.target.value) }))}>
                {complaintTypes.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t.common.date || 'Date'}</label>
              <input type="date" defaultValue={new Date().toISOString().split('T')[0]} />
            </div>
          </div>
          <div className="form-group">
            <label>{t.employees.complaintDesc}</label>
            <textarea value={rec.desc} onChange={e => setRec(r => ({ ...r, desc: e.target.value }))} placeholder="..." />
          </div>
          <button className="btn btn-danger" onClick={handleComplaint}><Icons.alert /> {t.employees.registerComplaint}</button>
        </div>
      )}
    </div>
  )
}
