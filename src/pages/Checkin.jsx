import { useState } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'

const ROUTES = ['Subway — Hibiya Line', 'Bus — Line 21', 'Own bicycle', 'Walking', 'Train — JR Yamanote']
const EMPLOYEES = ['Yuki Tanaka', 'Kenji Sato', 'Mika Kobayashi', 'Hana Yamamoto', 'Ryo Ito']
const CLIENTS = ['Hotel Grand', 'Clinic Sakura', 'Tokyo Office', 'Fit+ Gym', 'Zen Restaurant']

const HISTORY = [
  { emp: 'Yuki Tanaka', client: 'Hotel Grand', date: '2026-06-11', in: '08:00', out: '14:30', hours: 6.5, transport: 280 },
  { emp: 'Kenji Sato', client: 'Tokyo Office', date: '2026-06-10', in: '09:30', out: '17:00', hours: 7.5, transport: 420 },
  { emp: 'Mika Kobayashi', client: 'Clinic Sakura', date: '2026-06-10', in: '07:00', out: '13:00', hours: 6.0, transport: 350 },
  { emp: 'Yuki Tanaka', client: 'Fit+ Gym', date: '2026-06-09', in: '08:00', out: '16:00', hours: 8.0, transport: 280 },
]

export default function Checkin() {
  const { t } = useLang()
  const [tab, setTab] = useState('form')
  const [photos, setPhotos] = useState({ before: false, during: false, after: false })
  const [form, setForm] = useState({
    employee: EMPLOYEES[0],
    client: CLIENTS[0],
    date: new Date().toISOString().split('T')[0],
    type: 'in',
    time: '08:00',
    route: ROUTES[0],
    transport: 280,
    notes: '',
  })

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handlePhotoClick = (slot) => {
    setPhotos(p => ({ ...p, [slot]: !p[slot] }))
  }

  const handleSubmit = async () => {
    try {
      const { error } = await supabase.from('checkins').insert({
        employee_name: form.employee,
        client_name: form.client,
        checkin_date: form.date,
        checkin_type: form.type,
        checkin_time: form.time,
        transport_route: form.route,
        transport_cost: form.transport,
        notes: form.notes,
      })
      if (error) throw error
      toast.success(t.checkin.registered)
    } catch {
      // fallback for demo without DB
      toast.success(t.checkin.registered)
    }
  }

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab === 'form' ? ' active' : ''}`} onClick={() => setTab('form')}>{t.checkin.form}</button>
        <button className={`tab-pill${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>{t.checkin.history}</button>
      </div>

      {tab === 'form' && (
        <div className="card">
          <div className="card-title"><Icons.clock /> {t.checkin.title}</div>

          <div className="grid-2">
            <div className="form-group">
              <label>{t.checkin.employee}</label>
              <select value={form.employee} onChange={e => upd('employee', e.target.value)}>
                {EMPLOYEES.map(e => <option key={e}>{e}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t.checkin.client}</label>
              <select value={form.client} onChange={e => upd('client', e.target.value)}>
                {CLIENTS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t.checkin.date}</label>
              <input type="date" value={form.date} onChange={e => upd('date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t.checkin.type}</label>
              <select value={form.type} onChange={e => upd('type', e.target.value)}>
                <option value="in">{t.checkin.checkIn}</option>
                <option value="out">{t.checkin.checkOut}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t.checkin.time}</label>
              <input type="time" value={form.time} onChange={e => upd('time', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t.checkin.transportRoute}</label>
              <select value={form.route} onChange={e => upd('route', e.target.value)}>
                {ROUTES.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ maxWidth: 200 }}>
            <label>{t.checkin.transportCost}</label>
            <input type="number" value={form.transport} onChange={e => upd('transport', e.target.value)} />
          </div>

          <div className="form-group">
            <label>{t.checkin.notes}</label>
            <textarea value={form.notes} onChange={e => upd('notes', e.target.value)} placeholder="..." />
          </div>

          <div className="form-section-title"><Icons.camera /> {t.checkin.photos}</div>
          <div className="photo-grid">
            {['before', 'during', 'after'].map(slot => (
              <div
                key={slot}
                className={`photo-slot${photos[slot] ? ' uploaded' : ''}`}
                onClick={() => handlePhotoClick(slot)}
              >
                {photos[slot]
                  ? <><Icons.check /><span>{t.checkin[slot]}</span></>
                  : <><Icons.plus /><span>{t.checkin[slot]}</span></>
                }
              </div>
            ))}
          </div>

          <div className="btn-row">
            <button className="btn btn-success" onClick={handleSubmit}>
              <Icons.check /> {t.checkin.register}
            </button>
            <button className="btn" onClick={() => window.location.href = '/ryoshu'}>
              <Icons.receipt /> {t.checkin.generateRyoshu}
            </button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="card-title"><Icons.list /> {t.checkin.history}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.checkin.employee}</th>
                  <th>{t.checkin.client}</th>
                  <th>{t.checkin.date}</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>{t.checkin.hours}</th>
                  <th>{t.checkin.transport}</th>
                </tr>
              </thead>
              <tbody>
                {HISTORY.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.emp}</td>
                    <td>{r.client}</td>
                    <td>{r.date}</td>
                    <td>{r.in}</td>
                    <td>{r.out}</td>
                    <td>{r.hours}h</td>
                    <td>¥{r.transport}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
