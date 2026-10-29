import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { tokyoToday } from './DateRangeSheet'
import { avgStars } from '../lib/satisfaction'
import { summarizeJobs, formatMinutes } from '../lib/workKpis'
import MonthBars from './MonthBars'
import { pickLang, localeOf } from '../hooks/useLang'

// v1.0.34 — the editable number tiles at the top of the dashboard, now one roomy
// month-by-month bar chart per metric (last 6 or 12 months, current month highlighted).
const CHARTS_KEY = 'kuripuro-dashboard-charts-v1'
const DEFAULT_CHARTS = ['completed', 'cash', 'satisfaction', 'income', 'expenses', 'clients']
const JOB_FIELDS = 'id,scheduled_date,scheduled_time,status,employee_id,employee_name,started_at,completed_at,gps_start_distance,start_lat,checklist_total,checklist_done,photo_ai_score'

const TONES = { green: '#3fb26b', blue: '#3b82f6', purple: '#9b5de5', orange: '#f28b54', teal: '#14b8a6', amber: '#e0a82e', sky: '#60a5fa', navy: '#1e3a5f' }

// Supabase returns at most 1000 rows per request, so read in pages.
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error || !data) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

function monthKeys(count) {
  const [y, m] = tokyoToday().split('-').map(Number)
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7))
}

const yenCompact = v => {
  const abs = Math.abs(v)
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 10_000 ? `${Math.round(abs / 1000)}k` : abs.toLocaleString()
  return (v < 0 ? '−' : '') + '¥' + s
}
const yenFull = v => (v < 0 ? '−' : '') + '¥' + Math.abs(Math.round(v)).toLocaleString()

export default function MonthlyKpiCharts({ lang, snapshot = {}, snapshotLoading = false }) {
  const tr = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const dateLocale = localeOf(lang)
  const [months, setMonths] = useState(6)
  const [rows, setRows] = useState({ jobs: [], cash: [], ratings: [], clients: [] })
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [visible, setVisible] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CHARTS_KEY)) || DEFAULT_CHARTS }
    catch { return DEFAULT_CHARTS }
  })

  const keys = useMemo(() => monthKeys(months), [months])
  const start = keys[0] + '-01'

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [jobs, cash, ratings, clients] = await Promise.all([
        fetchAll(() => supabase.from('jobs').select(JOB_FIELDS).gte('scheduled_date', start).neq('status', 'cancelled').order('scheduled_date')),
        fetchAll(() => supabase.from('cashflow').select('entry_type,amount,entry_date').gte('entry_date', start).order('entry_date')),
        fetchAll(() => supabase.from('client_ratings').select('stars,created_at').gte('created_at', start).order('created_at')),
        fetchAll(() => supabase.from('clients').select('id,created_at').eq('is_active', true).order('created_at')),
      ])
      if (!alive) return
      setRows({ jobs, cash, ratings, clients })
      setLoaded(true)
    }
    load()
    const timer = setInterval(load, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [start])

  const buckets = useMemo(() => keys.map(key => {
    const inMonth = iso => iso && String(iso).slice(0, 7) === key
    const jobs = rows.jobs.filter(j => inMonth(j.scheduled_date))
    const team = summarizeJobs(jobs)
    const sum = type => rows.cash.filter(r => r.entry_type === type && inMonth(r.entry_date)).reduce((s, r) => s + Number(r.amount || 0), 0)
    const ratings = rows.ratings.filter(r => inMonth(new Date(r.created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })))
    const income = sum('income'), expenses = sum('expense')
    const date = new Date(key + '-01T12:00:00Z')
    return {
      key,
      label: date.toLocaleDateString(dateLocale, { month: 'short', timeZone: 'UTC' }),
      title: date.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      completed: team.completed,
      cash: income - expenses,
      income,
      expenses,
      clients: rows.clients.filter(c => String(c.created_at).slice(0, 7) <= key).length,
      satisfaction: avgStars(ratings),
      ratingsCount: ratings.length,
      avgService: team.avgMin,
      hoursWorked: team.timed ? team.totalMin : null,
      onTime: team.onTimePct,
      gps: team.completed ? team.gpsPct : null,
    }
  }), [keys, rows, dateLocale])

  const L = tr(
    { completed: 'Completed jobs', cash: 'Net cash', income: 'Money in', expenses: 'Money out', clients: 'Active clients', satisfaction: 'Client satisfaction', avgService: 'Avg. service time', hoursWorked: 'Hours worked', onTime: 'On-time starts', gps: 'GPS check-ins', today: "Today's jobs", revenue: 'Contract revenue', profit: 'Estimated profit' },
    { completed: '完了した作業', cash: '純入金', income: '入金', expenses: '出金', clients: '稼働中の顧客', satisfaction: '顧客満足度', avgService: '平均作業時間', hoursWorked: '実働時間', onTime: '時間どおり開始', gps: 'GPSチェックイン', today: '本日の作業', revenue: '月間契約売上（推定）', profit: '推定利益' },
    { completed: 'Serviços concluídos', cash: 'Caixa líquido', income: 'Entradas', expenses: 'Saídas', clients: 'Clientes ativos', satisfaction: 'Satisfação dos clientes', avgService: 'Tempo médio de serviço', hoursWorked: 'Horas trabalhadas', onTime: 'Inícios no horário', gps: 'Check-ins por GPS', today: 'Serviços de hoje', revenue: 'Receita de contratos', profit: 'Lucro estimado' }
  )
  const pct = v => `${Math.round(v)}%`
  const charts = [
    { id: 'completed', tone: 'green', format: v => String(v) },
    { id: 'cash', tone: 'blue', format: (v, short) => short ? yenCompact(v) : yenFull(v) },
    { id: 'satisfaction', tone: 'amber', format: (v, short) => short ? v.toFixed(1) : `${v.toFixed(1)} ★`, max: 5, sub: b => b.ratingsCount ? tr(`${b.ratingsCount} ratings`, `${b.ratingsCount}件の評価`, `${b.ratingsCount} avaliações`) : null, link: '/client-feedback' },
    { id: 'income', tone: 'purple', format: (v, short) => short ? yenCompact(v) : yenFull(v) },
    { id: 'expenses', tone: 'orange', format: (v, short) => short ? yenCompact(v) : yenFull(v), lowerIsBetter: true },
    { id: 'clients', tone: 'teal', format: v => String(v), note: tr('at the end of each month', '各月末時点', 'no fim de cada mês'), link: '/clients' },
    { id: 'avgService', tone: 'sky', format: v => formatMinutes(v) },
    { id: 'hoursWorked', tone: 'navy', format: (v, short) => short ? `${Math.round(v / 60)}h` : formatMinutes(v) },
    { id: 'onTime', tone: 'green', format: pct, max: 100 },
    { id: 'gps', tone: 'teal', format: pct, max: 100 },
  ]
  const snapshots = [
    { id: 'today', value: snapshot.today ?? '—', note: tr('today', '本日', 'hoje') },
    { id: 'revenue', value: snapshot.revenue ?? '—', note: tr('Estimated from contracts, per month', '契約データに基づく推定・月額', 'Estimativa pelos contratos, por mês') },
    { id: 'profit', value: snapshot.profit ?? '—', note: tr('Contract revenue − estimated cost', '契約売上 − 推定コスト', 'Receita de contratos − custo estimado') },
  ]
  const toggle = (id, on) => {
    const next = on ? [...visible, id] : visible.filter(x => x !== id)
    setVisible(next)
    try { localStorage.setItem(CHARTS_KEY, JSON.stringify(next)) } catch {}
  }
  const thisMonth = buckets[buckets.length - 1]
  const lastMonth = buckets[buckets.length - 2]
  const vsLast = tr('vs last month', '先月比', 'vs mês passado')

  return (
    <section className="mk-wrap" aria-label={tr('Month by month', '月別の指標', 'Mês a mês')}>
      <div className="mk-head">
        <div>
          <h2>{tr('Month by month', '月別の推移', 'Mês a mês')}</h2>
          <p>{tr('This month is the dark bar. Tap a bar to see that month.', '今月は濃い色。棒をタップすると詳細が見られます。', 'O mês atual é a barra escura. Toque numa barra para ver aquele mês.')}</p>
        </div>
        <div className="mk-controls">
          <div className="mk-seg" role="group" aria-label={tr('Period', '期間', 'Período')}>
            {[6, 12].map(n => <button key={n} type="button" className={months === n ? 'is-on' : ''} onClick={() => setMonths(n)}>{tr(`${n} months`, `${n}か月`, `${n} meses`)}</button>)}
          </div>
          <button type="button" className="mk-edit" onClick={() => setEditing(v => !v)}>{editing ? tr('Done', '完了', 'Concluir') : tr('Edit charts', '表示する指標を編集', 'Editar gráficos')}</button>
        </div>
      </div>
      {editing && (
        <div className="dash-metric-picker">
          {[...charts, ...snapshots].map(c => <label key={c.id}><input type="checkbox" checked={visible.includes(c.id)} onChange={e => toggle(c.id, e.target.checked)} /><span>{L[c.id]}</span></label>)}
        </div>
      )}
      <div className="mk-grid">
        {charts.filter(c => visible.includes(c.id)).map(c => {
          const now = thisMonth?.[c.id]
          const before = lastMonth?.[c.id]
          const diff = loaded && now != null && before != null ? now - before : null
          const good = diff == null || diff === 0 ? null : (diff > 0) !== !!c.lowerIsBetter
          const diffText = diff == null ? null : diff === 0 ? tr('same as last month', '先月と同じ', 'igual ao mês passado')
            : `${diff > 0 ? '▲ +' : '▼ −'}${c.format(Math.abs(diff))} ${vsLast}`
          return (
            <article key={c.id} className="mk-card" style={{ '--tone': TONES[c.tone] }}>
              <header>
                <span className="mk-label">{L[c.id]}</span>
                {c.link && <Link to={c.link} className="mk-link">{tr('Details →', '詳細 →', 'Detalhes →')}</Link>}
              </header>
              <div className="mk-now">
                <strong>{!loaded ? <span className="kp-skel-text">{tr('loading…', '読み込み中…', 'carregando…')}</span> : now == null ? '—' : c.format(now)}</strong>
                <small>{thisMonth?.title}{tr(' · so far', '（途中）', ' · até agora')}</small>
              </div>
              {diffText ? <div className={`mk-diff${good == null ? '' : good ? ' is-good' : ' is-bad'}`}>{diffText}</div>
                : c.note ? <div className="mk-diff">{c.note}</div> : <div className="mk-diff">&nbsp;</div>}
              {loaded
                ? <MonthBars data={buckets.map(b => ({ key: b.key, label: b.label, title: b.title, value: b[c.id], sub: c.sub?.(b) }))} format={c.format} tone={TONES[c.tone]} max={c.max} emptyLabel={tr('No data yet', 'まだデータがありません', 'Ainda sem dados')} />
                : <div className="kp-skel kp-skel-chart" aria-label={tr('Loading…', '読み込み中…', 'Carregando…')} />}
            </article>
          )
        })}
        {snapshots.filter(s => visible.includes(s.id)).map(s => (
          <article key={s.id} className="mk-card mk-card-plain" style={{ '--tone': TONES.navy }}>
            <header><span className="mk-label">{L[s.id]}</span></header>
            <div className="mk-now"><strong>{snapshotLoading ? <span className="kp-skel-text">{tr('loading…', '読み込み中…', 'carregando…')}</span> : s.value}</strong></div>
            <div className="mk-diff">{s.note}</div>
          </article>
        ))}
      </div>
    </section>
  )
}
