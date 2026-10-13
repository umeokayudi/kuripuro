import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import { enrichJobValues } from '../lib/employeePay'
import { isDuskinJob } from '../lib/employeeAddJob'
import { jobMinutes } from '../lib/salaryCalc'
import { buildEarningsSeries, earningsWindowStart, jobEarnings, trendPercent } from '../lib/earnings'
import './EarningsPanel.css'

// "Ganhos" — earnings history like a driver app: weekly / monthly bars, tap a bar to see
// that period's breakdown and jobs, download the payslip of a month.
// Used in the employee Salary tab (theme="portal") and on the admin Salary page (theme="admin").

const MONTH_COUNT = 6
const WEEK_COUNT = 8

const T = {
  ja: {
    title: '収入', week: '週', month: '月', net: '手取り', gross: '支給', ded: '控除', jobs: '件数', hours: '時間',
    days: '勤務日', perDay: '1日平均', vsPrev: '前回比', total: '合計', avg: '平均', base: '基本給', spot: 'スポット',
    list: '作業', empty: 'この期間の作業はありません', loading: '読み込み中…', payslip: 'この月の給与明細 (PDF)',
    making: 'PDF作成中…', done: '給与明細をダウンロードしました', noRate: '給与の単価が未設定のため ¥0 です。管理者に確認してください。',
    fixedNote: '月給制のため件ごとの金額はありません', last: (n, u) => `直近${n}${u === 'week' ? '週' : 'か月'}`,
  },
  en: {
    title: 'Earnings', week: 'Week', month: 'Month', net: 'Net', gross: 'Gross', ded: 'Deductions', jobs: 'Jobs', hours: 'Hours',
    days: 'Days', perDay: 'Per day', vsPrev: 'vs previous', total: 'Total', avg: 'Average', base: 'Base pay', spot: 'Spot',
    list: 'Jobs', empty: 'No jobs in this period', loading: 'Loading…', payslip: 'Payslip for this month (PDF)',
    making: 'Making PDF…', done: 'Payslip downloaded', noRate: 'No pay rate is set, so this shows ¥0. Check with the admin.',
    fixedNote: 'Monthly salary: no per-job amount', last: (n, u) => `Last ${n} ${u === 'week' ? 'weeks' : 'months'}`,
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

function Bars({ series, active, onPick }) {
  const W = 340, H = 168, padT = 22, padB = 24, padX = 4
  const innerH = H - padT - padB
  const max = Math.max(...series.map(d => d.net), 1)
  const step = (W - padX * 2) / series.length
  const barW = Math.min(28, step * 0.62)
  const x = i => padX + step * i + step / 2
  return (
    <svg className="earn-bars" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={series.map(d => `${d.title}: ${yen(d.net)}`).join(', ')}>
      {[0.5, 1].map(f => (
        <line key={f} x1={padX} x2={W - padX} y1={padT + innerH * (1 - f)} y2={padT + innerH * (1 - f)} className="earn-grid" />
      ))}
      <line x1={padX} x2={W - padX} y1={padT + innerH} y2={padT + innerH} className="earn-axis" />
      {series.map((d, i) => {
        const bh = d.net > 0 ? Math.max(3, (d.net / max) * innerH) : 2
        const y = padT + innerH - bh
        const on = i === active
        return (
          <g key={d.key} className={on ? 'is-on' : ''}>
            <rect x={x(i) - barW / 2} y={y} width={barW} height={bh} rx="5" className="earn-bar" />
            {on && <text x={x(i)} y={y - 6} textAnchor="middle" className="earn-val">{yenShort(d.net)}</text>}
            <text x={x(i)} y={H - 7} textAnchor="middle" className="earn-lbl">{d.label}</text>
            <rect x={padX + step * i} y={0} width={step} height={H} fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => onPick(i)}>
              <title>{`${d.title}: ${yen(d.net)}`}</title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}

export default function EarningsPanel({ employeeId, employee: employeeProp, lang = 'en', theme = 'portal', showTitle = true }) {
  const t = T[lang === 'ja' ? 'ja' : 'en']
  const [mode, setMode] = useState('week')
  const [active, setActive] = useState(null)
  const [data, setData] = useState(null)
  const [making, setMaking] = useState(false)

  useEffect(() => {
    if (!employeeId) return
    let alive = true
    setData(null)
    setActive(null)
    const from = earningsWindowStart(MONTH_COUNT, WEEK_COUNT)
    const today = tokyoToday()
    Promise.all([
      employeeProp ? Promise.resolve({ data: employeeProp })
        : supabase.from('employees').select('id,full_name,contract_type,hourly_rate,fixed_salary,salary_type,job_bonus_rate,monthly_work_days').eq('id', employeeId).maybeSingle(),
      supabase.from('jobs').select('*').eq('employee_id', employeeId).eq('status', 'completed').gte('scheduled_date', from).lte('scheduled_date', today).order('scheduled_date', { ascending: false }).limit(2000),
      supabase.from('service_contracts').select('location_name,price_per_visit').eq('is_active', true),
      supabase.from('salary_payments').select('*').eq('employee_id', employeeId).eq('is_deduction', true).gte('payment_date', from).lte('payment_date', today),
    ]).then(([emp, jobs, contracts, ded]) => {
      if (!alive) return
      const visible = (jobs.data || []).filter(j => !isDuskinJob(j))
      setData({
        emp: emp.data || {},
        jobs: enrichJobValues(visible, contracts.data || []),
        deductions: ded.data || [],
      })
    }).catch(() => alive && setData({ emp: employeeProp || {}, jobs: [], deductions: [] }))
    return () => { alive = false }
  }, [employeeId, employeeProp])

  const series = useMemo(() => data
    ? buildEarningsSeries({ emp: data.emp, jobs: data.jobs, deductions: data.deductions, mode, count: mode === 'week' ? WEEK_COUNT : MONTH_COUNT, lang })
    : [], [data, mode, lang])

  if (!data) return <div className={`earn is-${theme}`}><div className="earn-loading">{t.loading}</div></div>

  const idx = active ?? series.length - 1
  const cur = series[idx]
  const trend = trendPercent(series, idx)
  const sum = series.reduce((s, d) => s + d.net, 0)
  const avg = Math.round(sum / (series.length || 1))
  const fixedOnly = (data.emp.salary_type || 'fixed') === 'fixed'
  const notConfigured = cur?.salary?.notConfigured

  const downloadPayslip = async () => {
    if (!cur?.month) return
    setMaking(true)
    try {
      const [{ downloadPayslipPdf }, pays] = await Promise.all([
        import('../lib/payslipPdf'),
        supabase.from('salary_payments').select('*').eq('employee_id', employeeId).eq('period', cur.month).order('payment_date'),
      ])
      await downloadPayslipPdf({
        employee: data.emp, month: cur.month, salary: cur.salary, lang,
        deductions: data.deductions.filter(d => (d.payment_date || '').startsWith(cur.month)),
        payments: pays.data || [],
        jobs: [...cur.jobList].reverse(),
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
          {['week', 'month'].map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'is-on' : ''}
              onClick={() => { setMode(m); setActive(null) }}>{t[m]}</button>
          ))}
        </div>
      </div>

      <div className="earn-head">
        <small>{cur.title}</small>
        <strong>{yen(cur.net)}</strong>
        <div className="earn-sub">
          <span>{t.gross} {yen(cur.total)}</span>
          {cur.deductions > 0 && <span className="is-neg">{t.ded} -{yen(cur.deductions)}</span>}
          {trend != null && (
            <span className={`earn-trend ${trend >= 0 ? 'is-up' : 'is-down'}`}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% {t.vsPrev}</span>
          )}
        </div>
      </div>

      <Bars series={series} active={idx} onPick={setActive} />

      <div className="earn-range">
        <span>{t.last(series.length, mode)} · {t.total} <b>{yen(sum)}</b></span>
        <span>{t.avg} <b>{yen(avg)}</b></span>
      </div>

      <div className="earn-stats">
        <div><b>{cur.jobs}</b><span>{t.jobs}</span></div>
        <div><b>{cur.hours.toFixed(1)}h</b><span>{t.hours}</span></div>
        <div><b>{cur.workedDays}</b><span>{t.days}</span></div>
        <div><b>{yenShort(cur.workedDays ? cur.net / cur.workedDays : 0)}</b><span>{t.perDay}</span></div>
      </div>

      {notConfigured && <div className="earn-warn">⚠ {t.noRate}</div>}

      <div className="earn-break">
        <div><span>{t.base}</span><b>{yen(cur.base)}</b></div>
        {cur.spot > 0 && <div><span>{t.spot}</span><b>{yen(cur.spot)}</b></div>}
        {cur.deductions > 0 && <div className="is-neg"><span>{t.ded}</span><b>-{yen(cur.deductions)}</b></div>}
        <div className="is-net"><span>{t.net}</span><b>{yen(cur.net)}</b></div>
      </div>

      {mode === 'month' && (
        <button type="button" className="earn-pdf" onClick={downloadPayslip} disabled={making}>
          📄 {making ? t.making : t.payslip}
        </button>
      )}

      <div className="earn-list">
        <div className="earn-list-h">{t.list} · {cur.jobs}{fixedOnly && cur.jobs > 0 && <small>{t.fixedNote}</small>}</div>
        {!cur.jobList.length && <div className="earn-empty">{t.empty}</div>}
        {cur.jobList.slice(0, 40).map(j => (
          <div key={j.id} className="earn-job">
            <div>
              <b>{j.title}</b>
              <small>{j.scheduled_date} · {(jobMinutes(j) / 60).toFixed(1)}h</small>
            </div>
            {(!fixedOnly || j.job_category === 'spot') && <span>{yen(jobEarnings(j, data.emp))}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
