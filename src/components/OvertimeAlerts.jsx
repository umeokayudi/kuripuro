// Jobs open past planned time + tolerance (or past the ceiling). Shown on Live Track.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { locationNameFromTitle } from '../lib/cleaningType'
import { contractForAgendaJob, expectedMinutes, timeState } from '../lib/agenda'
import { loadAgendaSettings } from '../lib/jobAdminOps'
import { fmtMin } from './DayAgenda'
import { ManualCloseButton } from './ManualCloseModal'

export default function OvertimeAlerts({ jobs, onChanged }) {
  const { tr } = useLang()
  const [contracts, setContracts] = useState([])
  const [settings, setSettings] = useState(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    supabase.from('service_contracts').select('*').then(({ data }) => setContracts(data || []))
    loadAgendaSettings().then(setSettings)
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  if (!settings) return null
  const rows = (jobs || []).filter(j => j.status === 'in_progress').map(j => {
    const expected = expectedMinutes(j, contractForAgendaJob(j, contracts))
    return { j, expected, t: timeState(j, expected, settings, now) }
  }).filter(r => r.t.state === 'overrun' || r.t.state === 'cap')
  if (!rows.length) return null
  return (
    <div style={{ margin: '0 0 16px', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(239,68,68,.45)', background: 'rgba(239,68,68,.07)' }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: '#dc2626' }}>⚠️ {tr('Open past the planned time', '予定時間を超えて作業中', 'Abertos além do tempo previsto')} ({rows.length})</div>
      {rows.map(({ j, expected, t }) => (
        <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: '1px solid rgba(239,68,68,.15)' }}>
          <span style={{ flex: '1 1 180px', minWidth: 0 }}>
            <b>{locationNameFromTitle(j.title)}</b> · {j.employee_name || '—'}
            <span style={{ display: 'block', color: '#dc2626', fontWeight: 700 }}>
              {fmtMin(t.elapsed)} / {fmtMin(expected)} {tr('planned', '予定', 'previsto')}{t.state === 'cap' ? ` · ⛔ ${tr('ceiling', '上限', 'teto')}` : ''}
            </span>
          </span>
          <ManualCloseButton job={j} expected={expected} className="btn btn-sm btn-primary" onDone={onChanged} />
        </div>
      ))}
      <Link to="/jobs" className="btn btn-sm" style={{ marginTop: 8 }}>{tr('Open Day agenda', '本日の予定を開く', 'Abrir Agenda do Dia')}</Link>
    </div>
  )
}
