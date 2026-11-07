// v1.0.167 · Painel do Dia: "Deep Cleaning do mês — [cliente]" (new card; the existing cards are untouched).
// Feitos X de Y (Z%) + Agendados · Faltando. Tap → Serviços › Deep & Spot (the full screen).
// Same rule as that screen (lib/deepMonthProgress). No money here.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import { deepMonthProgress, monthBounds, pct } from '../lib/deepMonthProgress'

/** Contracts + clients + jobs of the month → deepMonthProgress (read only). */
export async function loadDeepMonth(month) {
  const [from, to] = monthBounds(month)
  const [c, cl, j] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('clients').select('id,company_name,is_active,is_test').then(r => (r.error ? supabase.from('clients').select('id,company_name,is_active') : r)),
    supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,status,employee_id,employee_name,client_id,client_name,job_category,spot_status')
      .gte('scheduled_date', from).lte('scheduled_date', to).neq('status', 'cancelled').limit(5000),
  ])
  return deepMonthProgress(c.data || [], cl.data || [], j.data || [])
}

export function DeepBar({ value, height = 8 }) {
  return (
    <div style={{ height, background: 'var(--surface2)', borderRadius: height, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <div style={{ height: '100%', width: `${value}%`, background: 'var(--green)', borderRadius: height, transition: 'width .3s' }} />
    </div>
  )
}

export default function DeepMonthCard({ L }) {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  useEffect(() => {
    let alive = true
    loadDeepMonth(tokyoToday().slice(0, 7)).then(r => { if (alive) setList(r) }).catch(() => { if (alive) setList([]) })
    return () => { alive = false }
  }, [])
  if (!list || !list.length) return null
  return (
    <>
      {list.map(c => {
        const p = pct(c.totals)
        return (
          <button key={c.clientId} type="button" className="card" onClick={() => navigate('/jobs?tab=deepspot')}
            style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 14 }}
            aria-label={L(`Deep Cleaning of the month — ${c.clientName}: open`, `今月のディープ — ${c.clientName}：開く`, `Deep Cleaning do mês — ${c.clientName}: abrir`)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
              <b style={{ fontSize: 15 }}>🧽 {L('Deep Cleaning of the month', '今月のディープクリーニング', 'Deep Cleaning do mês')} — {c.clientName}</b>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{L('open ›', '開く ›', 'abrir ›')}</span>
            </div>
            <DeepBar value={p} height={10} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
              <b>{L(`Done ${c.totals.done} of ${c.totals.expected} (${p}%)`, `完了 ${c.totals.expected}件中 ${c.totals.done}件（${p}%）`, `Feitos ${c.totals.done} de ${c.totals.expected} (${p}%)`)}</b>
              <span style={{ color: 'var(--text2)' }}>
                {L(`Scheduled ${c.totals.scheduled} · Missing ${c.totals.missing}`, `予定 ${c.totals.scheduled}・未作成 ${c.totals.missing}`, `Agendados ${c.totals.scheduled} · Faltando ${c.totals.missing}`)}
              </span>
            </div>
          </button>
        )
      })}
    </>
  )
}
