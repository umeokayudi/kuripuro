import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import { enrichJobValues } from '../lib/employeePay'
import { isDuskinJob } from '../lib/employeeAddJob'
import { jobMinutes } from '../lib/salaryCalc'
import DateRangeSheet from './DateRangeSheet'
import {
  addDays, chartBars, daysBetween, dayLabel, jobEarnings, monthEnd, monthLabel, rangeLabel,
  shiftMonth, summarizeRange, trendPercent, weekStart,
} from '../lib/earnings'
import './EarningsPanel.css'

// Salary screen in the style of a driver-app "Earnings" page: pick a week, a month or any
// date range (arrows to move back and forth), see the total, a bar per day, a calendar
// with what each day paid, and tap a day for its jobs. Download the payslip of the month.
// Used in the employee Salary tab (theme="portal") and on the admin Salary page (theme="admin").

const T = {
  ja: {
    title: '収入', week: '週', month: '月', custom: '期間', net: '手取り', gross: '支給', ded: '控除', jobs: '件数', hours: '時間',
    days: '勤務日', perHour: '時給換算', vsPrev: '前の期間比', base: '基本給', spot: 'スポット', breakdown: '内訳',
    list: '作業', empty: 'この期間の作業はありません', dayEmpty: 'この日の作業はありません', loading: '読み込み中…',
    payslip: m => `${m}の給与明細 (PDF)`, making: 'PDF作成中…', done: '給与明細をダウンロードしました',
    noRate: '給与の単価が未設定のため ¥0 です。管理者に確認してください。', fixedNote: '月給制：日ごとに日給を計算',
    calendar: 'カレンダー', prev: '前へ', next: '次へ', allDays: '期間の全作業', back: '期間に戻る', thisWeek: '今週', thisMonth: '今月',
    pickRange: '期間を選択', perDay: '1日平均',
  },
  en: {
    title: 'Earnings', week: 'Week', month: 'Month', custom: 'Range', net: 'Net', gross: 'Gross', ded: 'Deductions', jobs: 'Jobs', hours: 'Hours',
    days: 'Days', perHour: 'Per hour', vsPrev: 'vs previous', base: 'Base pay', spot: 'Spot', breakdown: 'Breakdown',
    list: 'Jobs', empty: 'No jobs in this period', dayEmpty: 'No jobs on this day', loading: 'Loading…',
    payslip: m => `Payslip ${m} (PDF)`, making: 'Making PDF…', done: 'Payslip downloaded',
    noRate: 'No pay rate is set, so this shows ¥0. Check with the admin.', fixedNote: 'Monthly salary: paid per worked day',
    calendar: 'Calendar', prev: 'Previous', next: 'Next', allDays: 'All jobs in this period', back: 'Back to period', thisWeek: 'This week', thisMonth: 'This month',
    pickRange: 'Pick dates', perDay: 'Per day',
  },
  pt: {
    title: 'Ganhos', week: 'Semana', month: 'Mês', custom: 'Período', net: 'Líquido', gross: 'Bruto', ded: 'Descontos', jobs: 'Serviços', hours: 'Horas',
    days: 'Dias', perHour: 'Por hora', vsPrev: 'vs período anterior', base: 'Salário base', spot: 'Spot', breakdown: 'Detalhes',
    list: 'Serviços', empty: 'Nenhum serviço neste período', dayEmpty: 'Nenhum serviço neste dia', loading: 'Carregando…',
    payslip: m => `Holerite de ${m} (PDF)`, making: 'Gerando PDF…', done: 'Holerite baixado',
    noRate: 'Nenhum valor de pagamento cadastrado, por isso aparece ¥0. Fale com o admin.', fixedNote: 'Salário mensal: pago por dia trabalhado',
    calendar: 'Calendário', prev: 'Anterior', next: 'Próximo', allDays: 'Todos os serviços do período', back: 'Voltar ao período', thisWeek: 'Esta semana', thisMonth: 'Este mês',
    pickRange: 'Escolher datas', perDay: 'Por dia',
  },
}

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const yenShort = n => {
  const v = Math.round(Number(n || 0))
  if (v >= 1000000) return `¥${(v / 1000000).toFixed(1)}M`
  if (v >= 10000) return `¥${Math.round(v / 1000)}k`
  if (v >= 1000) return `¥${(v / 1000).toFixed(1)}k`
  return `¥${v}`
}

function rangeFor(mode, anchor, custom) {
  if (mode === 'week') return { from: anchor, to: addDays(anchor, 6) }
  if (mode === 'month') return { from: `${anchor}-01`, to: monthEnd(anchor) }
  return custom
}

function previousRange(mode, anchor, range) {
  if (mode === 'week') return rangeFor('week', addDays(anchor, -7))
  if (mode === 'month') return rangeFor('month', shiftMonth(anchor, -1))
  const len = daysBetween(range.from, range.to)
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) }
}

function Bars({ bars, active, onPick }) {
  const today = tokyoToday()
  const W = 340, H = 176, padT = 24, padB = 22, padX = 2
  const innerH = H - padT - padB
  const max = Math.max(...bars.map(b => b.value), 1)
  const step = (W - padX * 2) / bars.length
  const barW = Math.max(3, Math.min(30, step * 0.64))
  const x = i => padX + step * i + step / 2
  const labelEvery = bars.length > 16 ? Math.ceil(bars.length / 8) : 1
  const peak = bars.reduce((m, b, i) => (b.value > (bars[m]?.value || 0) ? i : m), 0)
  const shown = active ?? (bars[peak]?.value ? peak : null)
  return (
    <svg className="earn-bars" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={bars.map(b => `${b.title}: ${yen(b.value)}`).join(', ')}>
      {[0.5, 1].map(f => (
        <line key={f} x1={padX} x2={W - padX} y1={padT + innerH * (1 - f)} y2={padT + innerH * (1 - f)} className="earn-grid" />
      ))}
      <line x1={padX} x2={W - padX} y1={padT + innerH} y2={padT + innerH} className="earn-axis" />
      {bars.map((b, i) => {
        const bh = b.value > 0 ? Math.max(4, (b.value / max) * innerH) : 2
        const y = padT + innerH - bh
        const on = i === active
        return (
          <g key={b.key} className={`${on ? 'is-on' : ''}${b.future ? ' is-future' : ''}${b.from <= today && today <= b.to ? ' is-today' : ''}`}>
            <rect x={x(i) - barW / 2} y={y} width={barW} height={bh} rx={Math.min(5, barW / 2)} className="earn-bar" />
            {i === shown && b.value > 0 && (
              <text x={Math.min(Math.max(x(i), 22), W - 22)} y={y - 7} textAnchor="middle" className="earn-val">{yenShort(b.value)}</text>
            )}
            {(i % labelEvery === 0 || on) && (
              <text x={x(i)} y={H - 6} textAnchor="middle" className="earn-lbl">{b.label}</text>
            )}
            <rect x={padX + step * i} y={0} width={step} height={H} fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => onPick(on ? null : i)}>
              <title>{`${b.title}: ${yen(b.value)}`}</title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}

function MonthCalendar({ summary, selected, onPick, lang }) {
  const first = summary.from
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const max = Math.max(...summary.days.map(d => d.total), 1)
  const names = lang === 'ja' ? ['月', '火', '水', '木', '金', '土', '日'] : lang === 'pt' ? ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const today = tokyoToday()
  return (
    <div className="earn-cal">
      {names.map((n, i) => <span key={i} className="earn-cal-wd">{n}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
      {summary.days.map(d => {
        const level = d.total > 0 ? Math.min(4, Math.ceil((d.total / max) * 4)) : 0
        const cls = ['earn-cal-day', `lv${level}`, d.future && 'is-future', d.day === selected && 'is-on', d.day === today && 'is-today'].filter(Boolean).join(' ')
        return (
          <button type="button" key={d.day} className={cls} disabled={d.future}
            onClick={() => onPick(d.day === selected ? null : d.day)} aria-label={`${dayLabel(d.day, lang)} ${yen(d.total)}`}>
            <b>{Number(d.day.slice(8))}</b>
            <small>{d.total > 0 ? yenShort(d.total) : d.jobs.length ? '✓' : ''}</small>
          </button>
        )
      })}
    </div>
  )
}

function JobRow({ job, emp, showAmount, lang }) {
  return (
    <div className="earn-job">
      <div>
        <b>{job.title}</b>
        <small>{dayLabel(job.scheduled_date, lang)}{job.scheduled_time ? ` · ${job.scheduled_time.slice(0, 5)}` : ''} · {(jobMinutes(job) / 60).toFixed(1)}h</small>
      </div>
      {showAmount && <span>{yen(jobEarnings(job, emp))}</span>}
    </div>
  )
}

export default function EarningsPanel({ employeeId, employee: employeeProp, lang = 'en', theme = 'portal', showTitle = true }) {
  const t = T[lang] || T.en
  const today = tokyoToday()
  const [mode, setMode] = useState('week')
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(today))
  const [monthAnchor, setMonthAnchor] = useState(() => today.slice(0, 7))
  const [custom, setCustom] = useState(() => ({ from: addDays(today, -29), to: today }))
  const [sheet, setSheet] = useState(false)
  const [activeBar, setActiveBar] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [data, setData] = useState(null)
  const [loadedFrom, setLoadedFrom] = useState(null)
  const [making, setMaking] = useState(false)

  const anchor = mode === 'week' ? weekAnchor : monthAnchor
  const range = rangeFor(mode, anchor, custom)
  // While a period is still running, compare it with the same number of days of the previous one.
  const fullPrev = previousRange(mode, anchor, range)
  const prevRange = range.from <= today && today < range.to
    ? { from: fullPrev.from, to: addDays(fullPrev.from, daysBetween(range.from, today) - 1) }
    : fullPrev
  const needFrom = fullPrev.from

  // Load a year back at first; reload further back only when the user goes past it.
  useEffect(() => {
    if (!employeeId) return
    if (loadedFrom && needFrom >= loadedFrom) return
    let alive = true
    const yearBack = addDays(today, -400)
    const from = needFrom < yearBack ? needFrom : yearBack
    Promise.all([
      employeeProp ? Promise.resolve({ data: employeeProp })
        : supabase.from('employees').select('id,full_name,contract_type,hourly_rate,fixed_salary,salary_type,job_bonus_rate,monthly_work_days').eq('id', employeeId).maybeSingle(),
      supabase.from('jobs').select('*').eq('employee_id', employeeId).eq('status', 'completed').gte('scheduled_date', addDays(from, -1)).lte('scheduled_date', today).order('scheduled_date', { ascending: false }).limit(5000),
      supabase.from('service_contracts').select('location_name,price_per_visit').eq('is_active', true),
      supabase.from('salary_payments').select('*').eq('employee_id', employeeId).eq('is_deduction', true).gte('payment_date', from).lte('payment_date', today),
    ]).then(([emp, jobs, contracts, ded]) => {
      if (!alive) return
      const visible = (jobs.data || []).filter(j => !isDuskinJob(j))
      setData({ emp: emp.data || {}, jobs: enrichJobValues(visible, contracts.data || []), deductions: ded.data || [] })
      setLoadedFrom(from)
    }).catch(() => alive && setData(d => d || { emp: employeeProp || {}, jobs: [], deductions: [] }))
    return () => { alive = false }
  }, [employeeId, employeeProp, needFrom, loadedFrom, today])

  const summary = useMemo(() => data && summarizeRange({ emp: data.emp, jobs: data.jobs, deductions: data.deductions, ...range }), [data, range.from, range.to])
  const prevSummary = useMemo(() => data && summarizeRange({ emp: data.emp, jobs: data.jobs, deductions: data.deductions, ...prevRange }), [data, prevRange.from, prevRange.to])
  const bars = useMemo(() => (summary ? chartBars(summary, lang) : []), [summary, lang])

  if (!data || !summary) return <div className={`earn is-${theme}`}><div className="earn-loading">{t.loading}</div></div>

  const resetPick = () => { setActiveBar(null); setSelectedDay(null) }
  const switchMode = m => { setMode(m); resetPick(); if (m === 'custom') setSheet(true) }
  const canNext = mode !== 'custom' && range.to < today
  const move = dir => {
    resetPick()
    if (mode === 'week') setWeekAnchor(a => addDays(a, dir * 7))
    else if (mode === 'month') setMonthAnchor(a => shiftMonth(a, dir))
    else {
      const len = daysBetween(custom.from, custom.to)
      setCustom(c => ({ from: addDays(c.from, dir * len), to: addDays(c.to, dir * len) }))
    }
  }
  const pickBar = i => {
    setActiveBar(i)
    const b = i == null ? null : bars[i]
    setSelectedDay(b && b.from === b.to ? b.from : null)
  }
  const pickDay = d => {
    setSelectedDay(d)
    const i = d ? bars.findIndex(b => b.from === d) : -1
    setActiveBar(i >= 0 ? i : null)
  }

  const periodTitle = mode === 'month'
    ? (anchor === today.slice(0, 7) ? `${t.thisMonth} · ${monthLabel(anchor, lang, true)}` : monthLabel(anchor, lang, true))
    : mode === 'week' && anchor === weekStart(today)
      ? `${t.thisWeek} · ${rangeLabel(range.from, range.to, lang)}`
      : rangeLabel(range.from, range.to, lang)

  const trend = trendPercent(summary.net, prevSummary?.net)
  const dayInfo = selectedDay ? summary.days.find(d => d.day === selectedDay) : null
  const activeWeek = activeBar != null && !dayInfo ? bars[activeBar] : null
  const fixedOnly = (data.emp.salary_type || 'fixed') === 'fixed'
  const notConfigured = summary.salary?.notConfigured ?? (
    (data.emp.salary_type || 'fixed') === 'fixed' ? !Number(data.emp.fixed_salary)
      : data.emp.salary_type === 'hourly' ? !Number(data.emp.hourly_rate) : false)
  const payslipMonth = mode === 'month' ? anchor : (range.to > today ? today : range.to).slice(0, 7)
  const jobsShown = dayInfo ? dayInfo.jobs
    : activeWeek ? summary.days.filter(d => d.day >= activeWeek.from && d.day <= activeWeek.to).flatMap(d => d.jobs)
      : summary.days.flatMap(d => d.jobs)
  const listJobs = [...jobsShown].reverse()

  const downloadPayslip = async () => {
    setMaking(true)
    try {
      const month = payslipMonth
      const s = summarizeRange({ emp: data.emp, jobs: data.jobs, deductions: data.deductions, from: `${month}-01`, to: monthEnd(month) })
      const [{ downloadPayslipPdf }, pays] = await Promise.all([
        import('../lib/payslipPdf'),
        supabase.from('salary_payments').select('*').eq('employee_id', employeeId).eq('period', month).order('payment_date'),
      ])
      await downloadPayslipPdf({
        employee: data.emp, month, salary: s.salary, lang,
        deductions: s.deductionRows, payments: pays.data || [],
        jobs: s.days.flatMap(d => d.jobs),
      })
      toast.success(t.done)
    } catch (err) {
      toast.error(err.message || 'PDF error')
    }
    setMaking(false)
  }

  return (
    <section className={`earn is-${theme}`} aria-label={t.title}>
      <div className="earn-top">
        {showTitle && <h3 className="earn-title">{t.title}</h3>}
        <div className="earn-seg" role="tablist">
          {['week', 'month', 'custom'].map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'is-on' : ''}
              onClick={() => switchMode(m)}>{m === 'custom' ? `📅 ${t.custom}` : t[m]}</button>
          ))}
        </div>
      </div>

      <div className="earn-nav">
        <button type="button" onClick={() => move(-1)} aria-label={t.prev}>‹</button>
        {mode === 'custom'
          ? <button type="button" className="earn-nav-title is-pick" onClick={() => setSheet(true)}>{periodTitle} ▾</button>
          : <span className="earn-nav-title">{periodTitle}</span>}
        <button type="button" onClick={() => move(1)} disabled={!canNext} aria-label={t.next}>›</button>
      </div>

      <div className="earn-head">
        <strong>{yen(dayInfo ? dayInfo.total : activeWeek ? activeWeek.value : summary.net)}</strong>
        {dayInfo || activeWeek ? (
          <div className="earn-sub">
            <span>{dayInfo ? dayLabel(dayInfo.day, lang) : activeWeek.title}</span>
            <button type="button" className="earn-link" onClick={resetPick}>{t.back}</button>
          </div>
        ) : (
          <div className="earn-sub">
            <span>{t.net}</span>
            <span>{t.gross} {yen(summary.total)}</span>
            {summary.deductions > 0 && <span className="is-neg">{t.ded} -{yen(summary.deductions)}</span>}
            {trend != null && (
              <span className={`earn-trend ${trend >= 0 ? 'is-up' : 'is-down'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% {t.vsPrev}</span>
            )}
          </div>
        )}
      </div>

      <Bars bars={bars} active={activeBar} onPick={pickBar} />

      <div className="earn-stats">
        <div><b>{summary.jobs}</b><span>{t.jobs}</span></div>
        <div><b>{summary.hours.toFixed(1)}h</b><span>{t.hours}</span></div>
        <div><b>{summary.workedDays}</b><span>{t.days}</span></div>
        <div><b>{yenShort(summary.hours ? summary.total / summary.hours : 0)}</b><span>{t.perHour}</span></div>
      </div>

      {notConfigured && <div className="earn-warn">⚠ {t.noRate}</div>}

      {mode === 'month' && (
        <div className="earn-block">
          <div className="earn-block-h">{t.calendar}</div>
          <MonthCalendar summary={summary} selected={selectedDay} onPick={pickDay} lang={lang} />
        </div>
      )}

      <div className="earn-block">
        <div className="earn-block-h">{t.breakdown}</div>
        <div className="earn-break">
          <div><span>{t.base}</span><b>{yen(summary.base)}</b></div>
          {summary.spot > 0 && <div><span>{t.spot}</span><b>{yen(summary.spot)}</b></div>}
          {summary.deductionRows.map(r => (
            <div key={r.id} className="is-neg"><span>{r.description || t.ded}</span><b>-{yen(r.amount)}</b></div>
          ))}
          <div className="is-net"><span>{t.net}</span><b>{yen(summary.net)}</b></div>
        </div>
        {fixedOnly && summary.jobs > 0 && <div className="earn-note">{t.fixedNote}</div>}
      </div>

      <button type="button" className="earn-pdf" onClick={downloadPayslip} disabled={making}>
        📄 {making ? t.making : t.payslip(monthLabel(payslipMonth, lang, true))}
      </button>

      <div className="earn-block">
        <div className="earn-block-h">
          {dayInfo ? dayLabel(dayInfo.day, lang) : activeWeek ? activeWeek.title : t.allDays} · {listJobs.length}
        </div>
        {!listJobs.length && <div className="earn-empty">{dayInfo ? t.dayEmpty : t.empty}</div>}
        {listJobs.slice(0, 60).map(j => (
          <JobRow key={j.id} job={j} emp={data.emp} lang={lang} showAmount={!fixedOnly || j.job_category === 'spot'} />
        ))}
      </div>

      {sheet && createPortal(
        <div className="earn-drs"><DateRangeSheet lang={lang} value={{ ...custom, preset: null }} onClose={() => setSheet(false)}
          onSave={r => { setCustom({ from: r.from, to: r.to }); setMode('custom'); resetPick(); setSheet(false) }} /></div>,
        document.body,
      )}
    </section>
  )
}
