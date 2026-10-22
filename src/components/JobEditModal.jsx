// Admin: edit any job after it was created / assigned (v1.0.66).
// Location, service, employee, date, time, address, value, notes and status in one place,
// with the chosen employee's other jobs that day so double bookings are easy to see.
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { jobLocationName } from '../lib/jobsBoard'

const SERVICE_PRESETS = ['Basic Cleaning', 'Deep Clean', 'Grease Trap', 'Range Hood', 'AC Cleaning']

function servicePart(title) {
  const i = String(title || '').indexOf(' — ')
  return i >= 0 ? title.slice(i + 3) : ''
}

export default function JobEditModal({ job, employees = [], locations = [], jobs = [], onClose, onSaved }) {
  const { t, tr } = useLang()
  const st = t.status
  const [form, setForm] = useState(() => ({
    location: jobLocationName(job) === '—' ? '' : jobLocationName(job),
    service: servicePart(job.title),
    employee_id: job.employee_id || '',
    scheduled_date: job.scheduled_date || '',
    scheduled_time: (job.scheduled_time || '').slice(0, 5),
    address: job.address || '',
    value: job.job_category === 'spot' ? (job.spot_value ?? job.value ?? 0) : (job.value ?? 0),
    description: job.description || '',
    status: job.status || 'assigned',
    photo_required: !!job.photo_required,
  }))
  const [saving, setSaving] = useState(false)
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const sameDay = useMemo(() => (
    form.employee_id && form.scheduled_date
      ? jobs.filter(j => j.id !== job.id && j.employee_id === form.employee_id && j.scheduled_date === form.scheduled_date && j.status !== 'cancelled')
        .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
      : []
  ), [jobs, job.id, form.employee_id, form.scheduled_date])

  const pickLocation = (name) => {
    const loc = locations.find(l => l.name === name)
    setForm(f => ({
      ...f,
      location: name,
      address: loc?.address || f.address,
      description: f.description || loc?.notes || '',
    }))
  }

  const save = async () => {
    if (!form.location.trim()) return toast.error(tr('Location name is required', '場所名を入力してください', 'Coloque o nome do local'))
    if (!form.scheduled_date) return toast.error(tr('Pick a date', '日付を選んでください', 'Escolha a data'))
    const emp = employees.find(e => e.id === form.employee_id)
    const title = form.service.trim() ? `${form.location.trim()} — ${form.service.trim()}` : form.location.trim()
    const value = Number(form.value) || 0
    const patch = {
      title,
      employee_id: form.employee_id || null,
      employee_name: emp?.full_name || null,
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time || null,
      address: form.address || null,
      description: form.description || null,
      status: form.status,
      photo_required: form.photo_required,
      ...(job.job_category === 'spot' ? { spot_value: value } : { value }),
    }
    setSaving(true)
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Job saved', '保存しました', 'Serviço salvo'))
    onSaved?.({ ...job, ...patch })
  }

  const remove = async () => {
    if (!confirm(tr(`Delete "${form.location}" on ${form.scheduled_date}?`, `${form.scheduled_date}の「${form.location}」を削除しますか？`, `Apagar "${form.location}" do dia ${form.scheduled_date}?`))) return
    const { error } = await supabase.from('jobs').delete().eq('id', job.id)
    if (error) return toast.error(error.message)
    toast.success(t.jobs.jobDeleted)
    onSaved?.(null)
  }

  const label = { fontSize: 12, color: 'var(--text3)', fontWeight: 600 }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="card" style={{ width: 'min(620px,100%)', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>✏️ {tr('Edit job', '仕事を編集', 'Editar serviço')}</div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="close">✕</button>
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label style={label}>{tr('Location', '場所', 'Local')} *</label>
            <input list="job-edit-locations" value={form.location} onChange={e => pickLocation(e.target.value)} />
            <datalist id="job-edit-locations">
              {locations.map(l => <option key={l.id || l.name} value={l.name} />)}
            </datalist>
          </div>
          <div className="form-group">
            <label style={label}>{tr('Service', 'サービス', 'Serviço')}</label>
            <input list="job-edit-services" value={form.service} onChange={e => upd('service', e.target.value)} placeholder="Basic Cleaning" />
            <datalist id="job-edit-services">
              {SERVICE_PRESETS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="form-group">
            <label style={label}>👤 {t.jobs.employee}</label>
            <select value={form.employee_id} onChange={e => upd('employee_id', e.target.value)}>
              <option value="">{t.jobs.unassigned}</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label style={label}>{t.jobs.status}</label>
            <select value={form.status} onChange={e => upd('status', e.target.value)}>
              {['assigned', 'in_progress', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{st[s]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label style={label}>📅 {tr('Date', '日付', 'Data')} *</label>
            <input type="date" value={form.scheduled_date} onChange={e => upd('scheduled_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label style={label}>🕐 {t.jobs.time}</label>
            <input type="time" value={form.scheduled_time} onChange={e => upd('scheduled_time', e.target.value)} />
          </div>
        </div>

        {form.employee_id && (
          <div style={{ fontSize: 12, background: 'var(--surface2)', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {tr('Same person, same day', '同じ日の担当', 'Mesmo funcionário nesse dia')} ({sameDay.length})
            </div>
            {sameDay.length === 0
              ? <div style={{ color: 'var(--text3)' }}>{tr('No other jobs that day.', 'この日は他の仕事はありません。', 'Nenhum outro serviço nesse dia.')}</div>
              : sameDay.map(j => (
                <div key={j.id} style={{ display: 'flex', gap: 8, padding: '2px 0', color: j.scheduled_time?.slice(0, 5) === form.scheduled_time ? '#dc2626' : 'var(--text2)' }}>
                  <span style={{ width: 44, fontWeight: 700 }}>{(j.scheduled_time || '—').slice(0, 5)}</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title}</span>
                </div>
              ))}
          </div>
        )}

        <div className="form-group">
          <label style={label}>{t.jobs.addressLabel || 'Address'}</label>
          <input value={form.address} onChange={e => upd('address', e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label style={label}>{job.job_category === 'spot' ? '⚡ Spot ¥' : tr('Value (¥)', '金額 (¥)', 'Valor (¥)')}</label>
            <input type="number" value={form.value} onChange={e => upd('value', e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 18 }}>
            <input type="checkbox" checked={form.photo_required} onChange={e => upd('photo_required', e.target.checked)} style={{ width: 16, height: 16 }} />
            📷 {t.jobs.photoRequired}
          </label>
        </div>
        <div className="form-group">
          <label style={label}>🔑 {tr('Notes / key box', 'メモ・キーボックス', 'Observações / key box')}</label>
          <textarea value={form.description} onChange={e => upd('description', e.target.value)} rows={3} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-danger" onClick={remove}>🗑 {t.jobs.deleteJob}</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : `✅ ${tr('Save', '保存', 'Salvar')}`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
