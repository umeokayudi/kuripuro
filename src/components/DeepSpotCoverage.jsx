import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { contractTargets, contractCheck, addDays } from '../lib/schedulePlan'
import { isTestJob, isTestClient } from '../lib/testData'
import { locationNameFromTitle } from '../lib/cleaningType'

// v1.0.133 · Serviços → "Deep & Spot": for a month, does EVERY deep / periodic contract item have its visit
// ("tem de todos?"), and which spot jobs happened. Same contract rules as the Schedule Generator
// (contractTargets + contractCheck); a contract without weekdays still needs its monthly visit.
const monthDays = m => {
  const [y, mo] = m.split('-').map(Number)
  const n = new Date(y, mo, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)
}
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function DeepSpotCoverage() {
  const { tr, locale } = useLang()
  const today = tokyoToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null)
    const days = monthDays(month)
    Promise.all([
      supabase.from('service_contracts').select('*').eq('is_active', true),
      supabase.from('clients').select('id,company_name,is_active,is_test').then(r => r.error ? supabase.from('clients').select('id,company_name,is_active') : r),
      supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,status,employee_id,employee_name,client_id,client_name,job_category,spot_status,completed_at')
        .gte('scheduled_date', days[0]).lte('scheduled_date', days[days.length - 1]).neq('status', 'cancelled').limit(5000),
    ]).then(([c, cl, j]) => {
      if (!alive) return
      const clients = (cl.data || []).filter(x => !isTestClient(x))
      setData({ contracts: c.data || [], clients, jobs: (j.data || []).filter(x => !isTestJob(x)), days })
    })
    return () => { alive = false }
  }, [month])

  const view = useMemo(() => {
    if (!data) return null
    // deep / periodic items; "no weekdays" contracts are still one visit per month here
    const targets = contractTargets(data.contracts, data.clients)
      .filter(t => t.kind !== 'weekly')
      .map(t => (t.kind === 'nodays' ? { ...t, kind: 'periodic' } : t))
    const check = contractCheck(targets, data.days, data.jobs, [], { wholeMonth: true })
    const byClient = {}
    for (const p of check.places) (byClient[p.target.clientName] = byClient[p.target.clientName] || []).push(p)
    const spots = data.jobs.filter(j => j.job_category === 'spot')
    const spotByClient = {}
    for (const j of spots) (spotByClient[j.client_name || '—'] = spotByClient[j.client_name || '—'] || []).push(j)
    return { check, byClient, spots, spotByClient }
  }, [data])

  const fmtDay = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short' }) : '—')
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const slotText = (s) => {
    const j = s.jobs.find(x => x.status === 'completed') || s.jobs[0]
    if (!j) return { icon: '❌', text: tr('Missing — no job this month', '未作成 — 今月の作業なし', 'Falta — nenhum job no mês'), tone: 'var(--red)' }
    if (j.status === 'completed') return { icon: '✓', text: tr(`Done ${fmtDay(j.scheduled_date)} · ${j.employee_name || '—'}`, `完了 ${fmtDay(j.scheduled_date)}・${j.employee_name || '—'}`, `Feito ${fmtDay(j.scheduled_date)} · ${j.employee_name || '—'}`), tone: 'var(--green)' }
    if (!j.employee_id) return { icon: '⚠️', text: tr(`${fmtDay(j.scheduled_date)} · no person`, `${fmtDay(j.scheduled_date)}・担当なし`, `${fmtDay(j.scheduled_date)} · sem pessoa`), tone: '#d97706' }
    const late = j.scheduled_date < today
    return { icon: late ? '⏰' : '⏳', text: tr(`${late ? 'Not done' : 'Scheduled'} ${fmtDay(j.scheduled_date)} · ${j.employee_name}`, `${late ? '未完了' : '予定'} ${fmtDay(j.scheduled_date)}・${j.employee_name}`, `${late ? 'Não feito' : 'Agendado'} ${fmtDay(j.scheduled_date)} · ${j.employee_name}`), tone: late ? 'var(--red)' : 'var(--text2)' }
  }
  const doneOf = list => list.filter(p => p.slots.some(s => s.jobs.some(j => j.status === 'completed'))).length

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>🧽 {tr('Deep & Spot — does every contract have it?', 'ディープ＆スポット — 全契約分ある？', 'Deep & Spot — tem de todos?')}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Each deep / periodic contract item needs one visit in the month.', 'ディープ・定期項目は月に1回の訪問が必要です。', 'Cada item deep / periódico do contrato precisa de uma visita no mês.')}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn btn-sm" onClick={() => setMonth(m => shift(m, -1))}>‹</button>
            <b style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel}</b>
            <button type="button" className="btn btn-sm" onClick={() => setMonth(m => shift(m, 1))}>›</button>
          </div>
        </div>
        {view && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
            <span><b>{doneOf(view.check.places)}</b>/{view.check.places.length} {tr('done', '完了', 'feitos')}</span>
            <span>{view.check.totals.ok}/{view.check.totals.expected} {tr('with a job and a person', '作業・担当あり', 'com job e pessoa')}</span>
            {view.check.totals.missing > 0 && <span style={{ color: 'var(--red)' }}>❌ {view.check.totals.missing} {tr('missing', '未作成', 'faltando')}</span>}
            <span>⚡ {view.spots.length} {tr('spot jobs', 'スポット', 'spots')}</span>
          </div>
        )}
      </div>

      {!view && <div aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
      {view && Object.keys(view.byClient).sort().map(name => {
        const list = view.byClient[name]
        return (
          <div key={name} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <b>{name}</b>
              <span className={`badge ${doneOf(list) === list.length ? 'badge-green' : 'badge-amber'}`}>{doneOf(list)}/{list.length}</span>
            </div>
            {list.map(p => {
              const s = slotText(p.slots[0])
              return (
                <div key={p.target.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ minWidth: 0 }}>{p.target.base} <span style={{ color: 'var(--text3)' }}>· {p.target.service}</span></span>
                  <span style={{ color: s.tone, textAlign: 'right' }}>{s.icon} {s.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
      {view && view.check.places.length === 0 && <div className="card" style={{ fontSize: 13, color: 'var(--text3)' }}>{tr('No deep / periodic contract items.', 'ディープ・定期の契約項目はありません。', 'Nenhum item deep / periódico nos contratos.')}</div>}

      {view && (
        <div className="card">
          <div className="card-title">⚡ {tr('Spot jobs of the month', '今月のスポット', 'Spots do mês')} ({view.spots.length})</div>
          {!view.spots.length && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{tr('No spot job this month.', '今月のスポットはありません。', 'Nenhum spot neste mês.')}</div>}
          {Object.keys(view.spotByClient).sort().map(name => (
            <div key={name} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{name}</div>
              {view.spotByClient[name].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).map(j => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                  <span>{fmtDay(j.scheduled_date)} · {locationNameFromTitle(j.title) || j.title}</span>
                  <span style={{ color: j.status === 'completed' ? 'var(--green)' : 'var(--text2)' }}>
                    {j.status === 'completed' ? `✓ ${j.employee_name || '—'}` : j.employee_id ? `⏳ ${j.employee_name}` : j.spot_status === 'pending' ? tr('⚡ offered', '⚡ オファー中', '⚡ ofertado') : tr('no person', '担当なし', 'sem pessoa')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
