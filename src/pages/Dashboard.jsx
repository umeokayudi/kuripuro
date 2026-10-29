import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLang, fill, localeOf } from '../hooks/useLang'
import OverviewChart from '../components/OverviewChart'
import MonthlyKpiCharts from '../components/MonthlyKpiCharts'
import DateRangeSheet, { presetRange, formatRangeLabel, tokyoToday } from '../components/DateRangeSheet'
import { useAuth } from '../hooks/useAuth'
import { summarizeJobs, summarizeByEmployee, formatMinutes, gpsCheck } from '../lib/workKpis'
import toast from 'react-hot-toast'
import { askConfirm } from '../components/ConfirmDialog'

const addDays = (iso, days) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5) + 1

export default function Dashboard() {
  const { lang, t, tr } = useLang()
  const { user } = useAuth() || {}
  const d = t.dashboard
  const dateLocale = localeOf(lang)

  const [clients, setClients] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [evals, setEvals] = useState([])
  const [trendJobs, setTrendJobs] = useState([])
  const [trendCashflow, setTrendCashflow] = useState([])
  const [range, setRange] = useState(() => ({ ...presetRange('month'), preset: 'month' }))
  const [rangeOpen, setRangeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = async () => {
    const today = tokyoToday()
    // Selected range plus the same number of days before it, for the comparison.
    const trendStart = addDays(range.from, -daysBetween(range.from, range.to))
    const trendEnd = addDays(range.to, 1)
    const [c, j, ev, stale, tj, tc] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('id,scheduled_date,scheduled_time,status,employee_id,employee_name,started_at,completed_at,gps_start_distance,start_lat,checklist_total,checklist_done,photo_ai_score').gte('scheduled_date', trendStart).lt('scheduled_date', trendEnd).neq('status', 'cancelled'),
      supabase.from('cashflow').select('entry_type,amount,entry_date').gte('entry_date', trendStart).lt('entry_date', trendEnd),
    ])
    setClients(c.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setStaleCount(stale.count || 0)
    setTrendJobs(tj.data || [])
    setTrendCashflow(tc.data || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => {
    load()
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refresh = setInterval(load, 15000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [range.from, range.to])

  const cancelStaleJobs = async () => {
    const today = tokyoToday()
    if (!(await askConfirm({ message: fill(d.cancelStaleConfirm, { today }), danger: true }))) return
    const { error } = await supabase.from('jobs').update({ status: 'cancelled' }).eq('status', 'assigned').lt('scheduled_date', today)
    if (error) return toast.error(error.message)
    toast.success(d.staleCancelled)
    load()
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  const cost = clients.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
  const profit = revenue - cost

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || '—'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })

  const sortedClients = [...clients].sort((a, b) =>
    (Number(b.monthly_revenue || 0) - Number(b.monthly_cost || 0)) - (Number(a.monthly_revenue || 0) - Number(a.monthly_cost || 0))
  )
  const maxProfit = Math.max(...clients.map(c => Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)), 1)
  const statusColor = s => ({ assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#4ade80', cancelled: 'rgba(255,255,255,0.2)' }[s] || '#60a5fa')

  const rangeDays = daysBetween(range.from, range.to)
  const prevFrom = addDays(range.from, -rangeDays)
  const prevTo = addDays(range.from, -1)
  const inRange = (iso, from, to) => iso && iso >= from && iso <= to
  const completedIn = (from, to) => trendJobs.filter(job => job.status === 'completed' && inRange(job.scheduled_date, from, to)).length
  const cashIn = (from, to, type) => trendCashflow.filter(row => row.entry_type === type && inRange(row.entry_date, from, to))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  // Daily columns up to ~2 months, monthly columns beyond that.
  const daily = rangeDays <= 62
  const bucketKeys = []
  if (daily) for (let i = 0; i < rangeDays; i++) bucketKeys.push(addDays(range.from, i))
  else for (let key = range.from.slice(0, 7); key <= range.to.slice(0, 7);) {
    bucketKeys.push(key)
    const [y, m] = key.split('-').map(Number)
    key = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  }
  const overviewData = bucketKeys.map(key => {
    const from = daily ? key : (key + '-01' < range.from ? range.from : key + '-01')
    const to = daily ? key : (addDays(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1)).toISOString().slice(0, 10), -1))
    const end = to > range.to ? range.to : to
    const date = new Date((daily ? key : key + '-01') + 'T12:00:00Z')
    return {
      key,
      label: daily ? String(date.getUTCDate()) : date.toLocaleDateString(dateLocale, { month: 'short', timeZone: 'UTC' }),
      title: date.toLocaleDateString(dateLocale, daily ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      jobs: completedIn(from, end),
      cash: cashIn(from, end, 'income') - cashIn(from, end, 'expense'),
    }
  })

  const rangeJobs = trendJobs.filter(job => inRange(job.scheduled_date, range.from, range.to))
  const team = summarizeJobs(rangeJobs)
  const teamPrev = summarizeJobs(trendJobs.filter(job => inRange(job.scheduled_date, prevFrom, prevTo)))
  const people = summarizeByEmployee(rangeJobs)
  const liveJobs = todayJobs.filter(job => job.status === 'in_progress' && job.started_at)
  const pctText = v => v == null ? '—' : `${v}%`

  const metricLabels = tr(
    { completed: 'Completed jobs', cash: 'Net cash', avgService: 'Avg. service time', hoursWorked: 'Hours worked', onTime: 'On-time starts', gps: 'GPS check-ins' },
    { completed: '完了した作業', cash: '記録済み純入金', avgService: '平均作業時間', hoursWorked: '実働時間', onTime: '時間どおり開始', gps: 'GPSチェックイン' },
    { completed: 'Serviços concluídos', cash: 'Caixa líquido', avgService: 'Tempo médio de serviço', hoursWorked: 'Horas trabalhadas', onTime: 'Inícios no horário', gps: 'Check-ins por GPS' }
  )
  const vsPrev = tr('vs previous period', '前期間比', 'vs período anterior')

  const minutesAgo = lastUpdate ? Math.max(0, Math.floor((clock - lastUpdate) / 60000)) : null
  const updatedLabel = minutesAgo == null ? '' : minutesAgo === 0
    ? tr('Updated just now', 'たった今更新', 'Atualizado agora mesmo')
    : tr(`Updated ${minutesAgo} min ago`, `${minutesAgo}分前に更新`, `Atualizado há ${minutesAgo} min`)

  return (
    <div>
      {rangeOpen && <DateRangeSheet lang={lang} value={range} onClose={() => setRangeOpen(false)} onSave={next => { setRange(next); setRangeOpen(false) }} />}
      <header className="dx-hero">
        <div className="dx-hero-copy">
          <span className="dx-eyebrow">{new Date().toLocaleDateString(dateLocale, { dateStyle: 'full', timeZone: 'Asia/Tokyo' })}</span>
          <h1>{tr(<>Welcome to your<br />Dashboard</>, <>ダッシュボードへ<br />ようこそ</>, <>Bem-vindo ao seu<br />Painel</>)}{user?.name ? <span className="dx-hero-name">{lang === 'ja' ? `${user.name}さん` : `, ${user.name.split(' ')[0]}`}</span> : null}</h1>
        </div>
        <div className="dx-hero-controls">
          <button type="button" className="dx-range" onClick={() => setRangeOpen(true)} aria-haspopup="dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            <span>{formatRangeLabel(range, lang)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div className="dx-updated">{updatedLabel}{updatedLabel && ' · '}<button type="button" onClick={load}>{tr('Refresh', '更新', 'Atualizar')}</button></div>
        </div>
      </header>

      <MonthlyKpiCharts lang={lang} snapshot={{ today: todayJobs.length, revenue: fmt(revenue), profit: fmt(profit) }} />

      <section className="card dx-overview">
        <div className="dx-overview-head">
          <div><h2>{tr('Performance overview', '実績の概要', 'Visão geral do desempenho')}</h2><p>{formatRangeLabel(range, lang)} · {daily ? tr('by day', '日別', 'por dia') : tr('by month', '月別', 'por mês')}</p></div>
        </div>
        <OverviewChart data={overviewData} cashLabel={metricLabels.cash} jobsLabel={metricLabels.completed} formatCash={fmt} emptyLabel={tr('No data', 'データなし', 'Sem dados')} />
      </section>

      <section className="card dx-team">
        <div className="dx-overview-head">
          <div><h2>{tr('Team performance', 'チームのパフォーマンス', 'Desempenho da equipe')}</h2><p>{formatRangeLabel(range, lang)} · {tr('from start/finish times and GPS', '開始・終了時刻とGPSから', 'pelos horários de início/fim e GPS')}</p></div>
          <Link to="/live" className="dx-link">{tr('Live tracking →', 'ライブ追跡 →', 'Rastreamento ao vivo →')}</Link>
        </div>
        {liveJobs.length > 0 && (
          <div className="dx-live">
            {liveJobs.map(job => {
              const secs = Math.max(0, Math.floor((clock - new Date(job.started_at)) / 1000))
              const gps = gpsCheck(job)
              return (
                <div key={job.id} className="dx-live-item">
                  <span className="dx-live-dot" />
                  <div><strong>{job.employee_name || '—'}</strong><small>{(job.title || '').replace(/ — .*/, '')}{gps === 'away' ? tr(' · ⚠ away from site', ' · ⚠ 現場外', ' · ⚠ fora do local') : gps ? ' · 📍' : ''}</small></div>
                  <b>{String(Math.floor(secs / 3600)).padStart(2, '0')}:{String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</b>
                </div>
              )
            })}
          </div>
        )}
        <div className="dx-team-kpis">
          {[
            [metricLabels.avgService, formatMinutes(team.avgMin), teamPrev.avgMin != null && team.avgMin != null ? `${team.avgMin - teamPrev.avgMin > 0 ? '+' : team.avgMin - teamPrev.avgMin < 0 ? '−' : '±'}${formatMinutes(Math.abs(team.avgMin - teamPrev.avgMin))} ${vsPrev}` : null],
            [metricLabels.hoursWorked, formatMinutes(team.totalMin), tr(`${team.timed} timed jobs`, `計測 ${team.timed}件`, `${team.timed} serviços cronometrados`)],
            [metricLabels.onTime, pctText(team.onTimePct), team.avgDelayMin != null ? tr(`avg. start ${team.avgDelayMin > 0 ? '+' : ''}${team.avgDelayMin} min`, `平均開始 ${team.avgDelayMin}分`, `início médio ${team.avgDelayMin > 0 ? '+' : ''}${team.avgDelayMin} min`) : null],
            [metricLabels.gps, pctText(team.gpsPct), team.gpsAway ? tr(`${team.gpsAway} away from site`, `現場外 ${team.gpsAway}件`, `${team.gpsAway} fora do local`) : null],
            [tr('Checklist', 'チェックリスト', 'Checklist'), pctText(team.checklistPct), null],
          ].map(([label, value, sub]) => (
            <div key={label} className="dx-team-kpi"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
          ))}
        </div>
        {people.length === 0 ? <div className="ov-empty">{tr('No completed jobs in this period', 'この期間の完了作業はありません', 'Nenhum serviço concluído neste período')}</div> : (
          <div className="dx-table-wrap">
            <table className="dx-table">
              <thead><tr>
                <th>{tr('Employee', 'スタッフ', 'Funcionário')}</th>
                <th>{tr('Jobs', '件数', 'Serviços')}</th>
                <th>{tr('Avg. time', '平均時間', 'Tempo médio')}</th>
                <th>{tr('Hours', '実働', 'Horas')}</th>
                <th>{tr('On time', '時間どおり', 'No horário')}</th>
                <th>GPS</th>
                <th>{tr('Checklist', 'チェック', 'Checklist')}</th>
              </tr></thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.id || p.name}>
                    <td>{p.id ? <Link to={`/employees/${p.id}`}>{p.name}</Link> : p.name}</td>
                    <td>{p.completed}</td>
                    <td>{formatMinutes(p.avgMin)}</td>
                    <td>{formatMinutes(p.totalMin)}</td>
                    <td className={p.onTimePct != null && p.onTimePct < 80 ? 'is-bad' : ''}>{pctText(p.onTimePct)}</td>
                    <td className={p.gpsAway ? 'is-bad' : ''}>{pctText(p.gpsPct)}{p.gpsAway ? ` · ⚠${p.gpsAway}` : ''}</td>
                    <td>{pctText(p.checklistPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {staleCount > 0 && (
        <div style={{ background: 'rgba(239,159,39,0.08)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {fill(d.staleJobs, { count: staleCount })}</span>
          <button onClick={cancelStaleJobs} className="btn btn-sm" style={{ background: '#EF9F27', color: '#fff', border: 'none', flexShrink: 0 }}>{d.cancelStale}</button>
        </div>
      )}


      {todayJobs.some(j => j.area) && (() => {
        // Today by area (zone of the location): done / still to do
        const byArea = {}
        for (const j of todayJobs) {
          if (j.status === 'cancelled') continue
          const a = j.area || tr('No area', '未設定', 'Sem área')
          byArea[a] = byArea[a] || { total: 0, done: 0, staff: new Set() }
          byArea[a].total++
          if (j.status === 'completed') byArea[a].done++
          if (j.employee_name) byArea[a].staff.add(j.employee_name.split(' ')[0])
        }
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>📍 {tr('Today by area', '本日のエリア別', 'Hoje por área')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {Object.entries(byArea).sort((a, b) => b[1].total - a[1].total).map(([area, v]) => (
                <Link key={area} to="/jobs" style={{ textDecoration: 'none', color: 'inherit', background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{area}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{v.done}/{v.total}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr('done', '完了', 'concluídos')}{v.staff.size ? ` · ${[...v.staff].join(', ')}` : ''}</div>
                </Link>
              ))}
            </div>
          </div>
        )
      })()}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.todayJobsTitle} ({tokyoToday()})</div>
        {todayJobs.length === 0 ? (
          <div className="empty-state">
            <strong>{d.noTodayJobs}</strong>
          </div>
        ) : Object.entries(byEmp).map(([name, jobs]) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>{name}</div>
            {jobs.map(j => (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span>{j.title?.replace(/ — .*/, '')} · {j.scheduled_time || '—'}{j.area ? ` · 📍 ${j.area}` : ''}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(j.status) }}>{t.status[j.status] || j.status}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="dash-split">
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.recentEvals}</div>
          {evals.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{d.noEvals}</div>}
          {evals.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>{e.employee_name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.category} · {e.eval_date}</div></div>
              <span className={`badge ${e.points_change > 0 ? 'badge-green' : 'badge-red'}`}>{e.points_change > 0 ? '+' : ''}{e.points_change} pts</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.profitByClient}</div>
          {sortedClients.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{d.noClients}</div>}
          {sortedClients.map(c => {
            const p = Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)
            const pct = Math.round(p / maxProfit * 100)
            const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? '#EF9F27' : 'var(--red)'
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 120, fontSize: 12, fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</div>
                <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color, width: 70, textAlign: 'right' }}>¥{(p / 1000).toFixed(0)}k</div>
              </div>
            )
          })}
        </div>
      </div>
      {loading && <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>{d.updating}</div>}
    </div>
  )
}
