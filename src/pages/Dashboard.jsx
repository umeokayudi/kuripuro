import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadClientMoney, withClientMoney } from '../lib/moneyData'
import { useLang, fill, localeOf } from '../hooks/useLang'
import OverviewChart from '../components/OverviewChart'
import MonthlyKpiCharts from '../components/MonthlyKpiCharts'
import DateRangeSheet, { presetRange, formatRangeLabel, tokyoToday } from '../components/DateRangeSheet'
import { useAuth } from '../hooks/useAuth'
import { summarizeJobs, summarizeByEmployee, formatMinutes, gpsCheck } from '../lib/workKpis'
import toast from 'react-hot-toast'
import { askConfirm } from '../components/ConfirmDialog'
import { ensureServiceReports } from '../lib/jobReport'
import { fetchExceptions } from '../lib/exceptionQueue'
import { exceptionInfo } from '../lib/exceptionText'
import { billedInMonth } from '../lib/money'
import { isTestJob, isTestClient, isTestName } from '../lib/testData'
import { useHideTests } from '../hooks/useHideTests'

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
  const moneyRef = useRef(null)
  const [exceptions, setExceptions] = useState([])
  const [monthMoney, setMonthMoney] = useState({ billed: 0, received: 0 })
  const [hideTests, setHideTests] = useHideTests()
  const [more, setMore] = useState(false)
  const navigate = useNavigate()

  const load = async () => {
    const today = tokyoToday()
    // Selected range plus the same number of days before it, for the comparison.
    const trendStart = addDays(range.from, -daysBetween(range.from, range.to))
    const trendEnd = addDays(range.to, 1)
    const month = today.slice(0, 7)
    const [c, j, ev, stale, tj, tc, fm, cm, exc] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('id,scheduled_date,scheduled_time,status,employee_id,employee_name,client_name,started_at,completed_at,gps_start_distance,start_lat,checklist_total,checklist_done,photo_ai_score').gte('scheduled_date', trendStart).lt('scheduled_date', trendEnd).neq('status', 'cancelled'),
      supabase.from('cashflow').select('entry_type,amount,entry_date').gte('entry_date', trendStart).lt('entry_date', trendEnd),
      // v1.0.110 · "Money of the month" = same rules as Invoices / Cashflow (billed by period, received = income rows)
      supabase.from('faturas').select('id,total,status,period_start,issue_date').or(`period_start.gte.${month}-01,issue_date.gte.${month}-01`).limit(2000),
      supabase.from('cashflow').select('entry_type,amount,entry_date').eq('entry_type', 'income').gte('entry_date', `${month}-01`).lte('entry_date', today),
      fetchExceptions({ hideTests }).catch(() => []),
    ])
    // v1.0.109 · monthly value from the active contracts + real team cost (same numbers as Clients / Contracts)
    if (!moneyRef.current) moneyRef.current = await loadClientMoney().catch(() => null) // once per visit, not every refresh
    const money = moneyRef.current
    // v1.0.110 · "hide tests" (ON by default) takes test accounts out of every count on this screen
    const keep = (rows, isTest) => hideTests ? (rows || []).filter(r => !isTest(r)) : (rows || [])
    setClients(withClientMoney(keep(c.data, isTestClient), money))
    setTodayJobs(keep(j.data, isTestJob))
    setEvals(keep(ev.data, e => isTestName(e.employee_name)))
    setStaleCount(stale.count || 0)
    setTrendJobs(keep(tj.data, isTestJob))
    setTrendCashflow(tc.data || [])
    setMonthMoney({ billed: billedInMonth(fm.data || [], month), received: (cm.data || []).reduce((sum, r) => sum + Number(r.amount || 0), 0) })
    setExceptions(exc || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  // Completed jobs of the last 60 days without a service report get it now (once per session).
  useEffect(() => {
    if (sessionStorage.getItem('kp_reports_healed')) return
    try { sessionStorage.setItem('kp_reports_healed', '1') } catch { /* private mode */ }
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
    supabase.from('jobs').select('*').eq('status', 'completed').gte('scheduled_date', since).limit(1000)
      .then(({ data }) => ensureServiceReports(supabase, data))
      .then(n => { if (n) console.log(`service reports created: ${n}`) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refresh = setInterval(load, 15000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [range.from, range.to, hideTests])

  // v1.0.110 · bulk action: show exactly what will change, then confirm; only those ids are touched.
  const cancelStaleJobs = async () => {
    const today = tokyoToday()
    const { data: list, error: e1 } = await supabase.from('jobs').select('id,title,scheduled_date,employee_name').eq('status', 'assigned').lt('scheduled_date', today).order('scheduled_date').limit(500)
    if (e1) return toast.error(e1.message)
    if (!list?.length) { setStaleCount(0); return }
    const lines = list.slice(0, 20).map(j => `• ${j.scheduled_date} · ${String(j.title || '').split(' — ')[0]} · ${j.employee_name || tr('no person', '担当なし', 'sem pessoa')}`)
    if (list.length > 20) lines.push(tr(`…and ${list.length - 20} more`, `…ほか${list.length - 20}件`, `…e mais ${list.length - 20}`))
    const head = tr(`Cancel these ${list.length} jobs that were never started (before ${today})?`, `${today}より前の未開始の作業 ${list.length}件をキャンセルしますか？`, `Cancelar estes ${list.length} jobs que nunca foram iniciados (antes de ${today})?`)
    if (!(await askConfirm({ message: `${head}\n\n${lines.join('\n')}`, danger: true, confirmLabel: tr(`Cancel ${list.length} jobs`, `${list.length}件をキャンセル`, `Cancelar ${list.length} jobs`) }))) return
    const { error } = await supabase.from('jobs').update({ status: 'cancelled' }).in('id', list.map(j => j.id)).eq('status', 'assigned')
    if (error) return toast.error(error.message)
    toast.success(d.staleCancelled)
    load()
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  // Cost known only for clients with completed jobs last month; profit counts only those (never revenue − ¥0).
  const costed = clients.filter(c => c.monthly_cost != null)
  const cost = costed.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
  const profit = costed.length ? costed.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0) - cost : null

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || '—'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })

  const sortedClients = [...clients].filter(c => c.monthly_cost != null).sort((a, b) =>
    (Number(b.monthly_revenue || 0) - Number(b.monthly_cost || 0)) - (Number(a.monthly_revenue || 0) - Number(a.monthly_cost || 0))
  )
  const maxProfit = Math.max(...sortedClients.map(c => Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)), 1)
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

  // Today-only rows of the exception queue (+ payroll items, which have no date), same rows as the bell.
  const EXC = exceptionInfo(tr)
  const actionRows = exceptions.filter(x => !x.jobId || x.date >= addDays(tokyoToday(), -1))
  const todayActive = todayJobs.filter(j => j.status !== 'cancelled')
  const todayDone = todayActive.filter(j => j.status === 'completed')
  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }
  const costMonth = moneyRef.current?.costMonth
  // Cards without data are hidden (never "¥0" or "—" as if it were a number).
  const moneyCards = [
    [tr('Contracts / month', '契約 / 月', 'Contratos / mês'), fmt(revenue), tr(`${clients.filter(c => Number(c.monthly_revenue) > 0).length} clients`, `${clients.filter(c => Number(c.monthly_revenue) > 0).length}社`, `${clients.filter(c => Number(c.monthly_revenue) > 0).length} clientes`), '/contracts'],
    monthMoney.billed > 0 && [tr('Billed this month', '今月の請求', 'Faturado no mês'), fmt(monthMoney.billed), tr('invoices sent', '送付済み請求書', 'faturas enviadas'), '/faturas'],
    monthMoney.received > 0 && [tr('Received this month', '今月の入金', 'Recebido no mês'), fmt(monthMoney.received), tr('to date', '本日まで', 'até hoje'), '/cashflow'],
    profit != null && [tr('Profit (contracts − team)', '利益（契約 − 人件費）', 'Lucro (contratos − equipe)'), profit < 0 ? <span style={{ color: 'var(--red)' }}>−{fmt(-profit)}</span> : fmt(profit), tr(`real team cost of ${costMonth}`, `${costMonth}の実人件費`, `custo real da equipe de ${costMonth}`), '/clients'],
  ].filter(Boolean)

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
          <label className="dx-updated" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideTests} onChange={e => setHideTests(e.target.checked)} />
            {tr('Hide tests', 'テストを隠す', 'Ocultar testes')}
          </label>
        </div>
      </header>

      {/* v1.0.110 · three blocks first: what needs action today, what is done today, money of the month (one source) */}
      <section className="card dx-overview">
        <div className="dx-overview-head">
          <div><h2>{tr('Needs action today', '今日対応が必要', 'Hoje exige ação')}</h2><p>{tr('Most urgent first · each row has the button that resolves it', '緊急度順 · 各行に解決ボタン', 'Mais urgente primeiro · cada linha tem o botão que resolve')}</p></div>
          {actionRows.length > 0 && <span className="badge badge-red">{actionRows.length}</span>}
        </div>
        {actionRows.length === 0 && staleCount === 0
          ? <div className="ov-empty" style={{ padding: '18px 0' }}>✅ {tr('Nothing needs action now', '今は対応不要です', 'Nada exige ação agora')}</div>
          : <div>
            {staleCount > 0 && (
              <div style={rowStyle}>
                <span style={{ fontSize: 13 }}>🗂 {fill(d.staleJobs, { count: staleCount })}</span>
                <button type="button" onClick={cancelStaleJobs} className="btn btn-sm" style={{ flexShrink: 0 }}>{d.cancelStale}</button>
              </div>
            )}
            {actionRows.slice(0, 8).map(x => (
              <div key={x.id} style={rowStyle}>
                <span style={{ fontSize: 13, minWidth: 0 }}>{EXC[x.kind].icon} <strong>{EXC[x.kind].title(x)}</strong><small style={{ display: 'block', color: 'var(--text3)', fontSize: 11 }}>{[x.place, x.who, x.date].filter(Boolean).join(' · ')}</small></span>
                <button type="button" className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => navigate(EXC[x.kind].to(x))}>{EXC[x.kind].action}</button>
              </div>
            ))}
            {actionRows.length > 8 && <div style={{ fontSize: 12, color: 'var(--text3)', paddingTop: 8 }}>{tr(`+${actionRows.length - 8} more in the bell 🔔`, `ほか${actionRows.length - 8}件はベル🔔に`, `+${actionRows.length - 8} no sino 🔔`)}</div>}
          </div>}
      </section>

      <div className="dash-split">
        <section className="card">
          <div className="dx-overview-head">
            <div><h2>{tr('Done today', '今日の完了', 'Hoje feito')}</h2><p>{tokyoToday()}</p></div>
            <Link to="/live" className="dx-link">{tr('Live tracking →', 'ライブ追跡 →', 'Rastreamento ao vivo →')}</Link>
          </div>
          {todayActive.length === 0 ? <div className="ov-empty" style={{ padding: '18px 0' }}>{d.noTodayJobs}</div> : <>
            <div className="dx-team-kpi" style={{ margin: '8px 0 10px' }}>
              <span>{tr('Done / planned', '完了 / 予定', 'Feitos / previstos')}</span>
              <strong>{todayDone.length} / {todayActive.length}</strong>
              {liveJobs.length > 0 && <small>{tr(`${liveJobs.length} in progress now`, `${liveJobs.length}件 作業中`, `${liveJobs.length} em andamento agora`)}</small>}
            </div>
            {todayDone.map(j => (
              <div key={j.id} style={rowStyle}>
                <span style={{ fontSize: 13 }}>✓ {j.title?.replace(/ — .*/, '')}{isTestJob(j) && <span className="badge" style={{ marginLeft: 6 }}>TESTE</span>}</span>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{j.employee_name || '—'}</span>
              </div>
            ))}
          </>}
        </section>

        <section className="card">
          <div className="dx-overview-head">
            <div><h2>{tr('Money of the month', '今月のお金', 'Dinheiro do mês')}</h2><p>{tr('Same numbers as Contracts, Invoices and Cashflow', '契約・請求・キャッシュフローと同じ数字', 'Mesmos números de Contratos, Faturas e Cashflow')}</p></div>
            <Link to="/cashflow" className="dx-link">Cashflow →</Link>
          </div>
          <div className="dx-team-kpis" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {moneyCards.map(([label, value, sub, to]) => (
              <Link key={label} to={to} className="dx-team-kpi" style={{ textDecoration: 'none' }}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</Link>
            ))}
          </div>
        </section>
      </div>

      <button type="button" className="btn btn-sm" style={{ margin: '4px 0 16px' }} onClick={() => setMore(v => !v)} aria-expanded={more}>
        {more ? tr('Hide details ▲', '詳細を隠す ▲', 'Esconder detalhes ▲') : tr('More details ▼', '詳細を見る ▼', 'Mais detalhes ▼')}
      </button>

      {more && <>
        <MonthlyKpiCharts lang={lang} snapshotLoading={loading && !lastUpdate} snapshot={{ today: todayJobs.length, revenue: fmt(revenue), profit: profit == null ? '—' : fmt(profit) }} />

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

        {(evals.length > 0 || sortedClients.length > 0) && <div className="dash-split">
          {evals.length > 0 && <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.recentEvals}</div>
            {evals.map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{e.employee_name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.category} · {e.eval_date}</div></div>
                <span className={`badge ${e.points_change > 0 ? 'badge-green' : 'badge-red'}`}>{e.points_change > 0 ? '+' : ''}{e.points_change} pts</span>
              </div>
            ))}
          </div>}

          {sortedClients.length > 0 && <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.profitByClient}</div>
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
          </div>}
        </div>}
      </>}
      {loading && <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>{d.updating}</div>}
    </div>
  )
}
