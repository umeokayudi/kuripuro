// Employee portal: the team's jobs of the day for roles with the 'team_day' permission (leader, supervisor, office).
// Read-only and without any money: place, person, time and status.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { roleCan } from '../lib/employeeRoles'
import { tokyoToday } from '../lib/dates'
import { locationNameFromTitle } from '../lib/cleaningType'
import { sortByOrder } from '../lib/agenda'

const STATUS_COLOR = { assigned: '#60a5fa', in_progress: '#f59e0b', completed: '#4ade80' }

export default function TeamDay({ userId, L }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: people } = await supabase.from('employees').select('*').eq('is_active', true)
      const me = (people || []).find(p => p.id === userId)
      if (!me || !roleCan(me.job_role, 'team_day')) { if (alive) setRows(null); return }
      // A leader with people under them sees that team; supervisors / office see everyone.
      const mine = (people || []).filter(p => 'leader_id' in p && p.leader_id === userId)
      const team = new Set((me.job_role === 'leader' && mine.length ? mine : people || []).map(p => p.id).filter(id => id !== userId))
      const { data: jobs } = await supabase.from('jobs').select('id,title,employee_id,employee_name,scheduled_time,status,sequence_order')
        .eq('scheduled_date', tokyoToday()).neq('status', 'cancelled')
      if (!alive) return
      const byPerson = new Map()
      for (const j of jobs || []) {
        if (!team.has(j.employee_id)) continue
        if (!byPerson.has(j.employee_id)) byPerson.set(j.employee_id, { name: j.employee_name || '—', jobs: [] })
        byPerson.get(j.employee_id).jobs.push(j)
      }
      setRows([...byPerson.values()].map(p => ({ ...p, jobs: sortByOrder(p.jobs) })).sort((a, b) => a.name.localeCompare(b.name)))
    })()
    return () => { alive = false }
  }, [userId])

  if (!rows) return null
  return (
    <div style={{ margin: '14px 0', padding: '12px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>👥 {L("Team's day", 'チームの一日', 'Dia da equipe')}</div>
      {!rows.length && <div style={{ fontSize: 13, opacity: 0.6 }}>{L('No team jobs today.', '今日のチームの作業はありません。', 'Nenhum job da equipe hoje.')}</div>}
      {rows.map(p => {
        const done = p.jobs.filter(j => j.status === 'completed').length
        return (
          <div key={p.name} style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}><span>{p.name}</span><span style={{ opacity: 0.6 }}>{done}/{p.jobs.length}</span></div>
            {p.jobs.map(j => (
              <div key={j.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: STATUS_COLOR[j.status] || '#94a3b8' }} />
                <span style={{ opacity: 0.7, flexShrink: 0 }}>{j.scheduled_time || '—'}</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locationNameFromTitle(j.title)}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
