import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { countJobs } from '../lib/jobCounts'
import { hideTests, HIDE_TESTS_CHANGED } from '../lib/testData'

// v1.0.133 · The SAME job count on Dashboard, Serviços, Relatórios and the Gerador: one query by scheduled
// day for the period of the screen + countJobs (lib/jobCounts). The period is always written next to it.
export default function JobCountStrip({ from, to, style }) {
  const { tr, locale } = useLang()
  const [c, setC] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick(t => t + 1)
    window.addEventListener(HIDE_TESTS_CHANGED, on)
    return () => window.removeEventListener(HIDE_TESTS_CHANGED, on)
  }, [])
  useEffect(() => {
    if (!from || !to) return
    let alive = true
    supabase.from('jobs').select('id,status,employee_id,employee_name,client_name,scheduled_date,scheduled_time,started_at')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000)
      .then(({ data }) => { if (alive) setC(countJobs(data || [], { from, to, keepTests: !hideTests() })) })
    return () => { alive = false }
  }, [from, to, tick])
  const day = d => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const items = c ? [
    [tr('Scheduled', '予定', 'Programados'), c.scheduled],
    [tr('Assigned', '担当あり', 'Atribuídos'), c.assigned],
    [tr('Completed', '完了', 'Concluídos'), c.completed],
    [tr('Pending', '未完了', 'Pendentes'), c.pending],
    [tr('Late', '遅れ', 'Atrasados'), c.late],
  ] : []
  return (
    <div className="kp-count-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 12, color: 'var(--text3)', margin: '0 0 10px', ...style }}>
      <span>{from === to ? day(from) : `${day(from)} – ${day(to)}`}:</span>
      {!c ? <span className="kp-skel-text">…</span> : items.map(([l, n]) => (
        <span key={l} style={n && l === items[4][0] ? { color: 'var(--red)' } : undefined}><b style={{ color: 'var(--text)', fontSize: 13 }}>{n}</b> {l}</span>
      ))}
    </div>
  )
}
