import { jobEmployeePay } from './jobEmployeePay.js'
import { locationNameFromTitle } from './cleaningType.js'
import { jobMinutes, jobWorkerPay, payrollMonth, payRuleOf, spotExtra, monthLastDay } from './salaryCalc.js'
import { packageOfJob } from './payPackages.js'
import { kindLabel } from './payrollReport.js'

// v1.0.214 · Relatório detalhado de salário: one line per completed job of the month (date, store/service,
// hours worked, value of that job), a subtotal per day and the month total at the end.
// The value of each job is ONLY what is set in the system ("Pagamento do funcionário" on the job, or a
// registered monthly package) — never the client's price. Same payrollMonth as Payments / holerite, so the
// final total is the same number everywhere.

/**
 * @returns {{ month, days: [{ date, rows, hours, subtotal, undefinedCount }], rows, totals }}
 * row: { id, date, time, place, service, hours, pay (number | null = 'a definir'), spot, inPackage, packageName }
 */
export function salaryReport({ emp, jobs = [], lines = [], month, basis = null }) {
  const calc = payrollMonth({ emp, jobs, lines, month, basis })
  const rule = payRuleOf(calc)
  const last = monthLastDay(month)
  const done = (jobs || [])
    .filter(j => j.status === 'completed' && j.scheduled_date >= `${month}-01` && j.scheduled_date <= last)
    .slice()
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date))
      || String(a.started_at || a.scheduled_time || '').localeCompare(String(b.started_at || b.scheduled_time || '')))

  const perJob = rule.used === 'per_job' || (!rule.used && ['per_job', 'mixed'].includes(emp?.salary_type))
  const rows = done.map(j => {
    const pkg = rule.packages?.length ? packageOfJob(j, rule.packages) : null
    const own = jobEmployeePay(j)
    const spot = spotExtra(j)
    // 'a definir' = per-job month, not in a package, no value set on the job
    const undefinedPay = perJob && !pkg && own === null
    return {
      id: j.id, date: j.scheduled_date, time: j.scheduled_time || '',
      place: locationNameFromTitle(j.title) || j.title || '—', service: kindLabel(j),
      hours: Math.round(jobMinutes(j) / 60 * 100) / 100,
      pay: undefinedPay ? (spot || null) : jobWorkerPay(j, emp, rule),
      spot, inPackage: !!pkg, packageName: pkg ? (pkg.label || pkg.client_name || '') : '',
    }
  })

  const byDay = new Map()
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, [])
    byDay.get(r.date).push(r)
  }
  const days = [...byDay.entries()].map(([date, list]) => ({
    date, rows: list,
    hours: Math.round(list.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    subtotal: list.reduce((s, r) => s + (r.pay || 0), 0),
    undefinedCount: list.filter(r => r.pay === null).length,
  }))

  const jobsTotal = rows.reduce((s, r) => s + (r.pay || 0), 0)
  // fixed salary month: the base is the fixed salary (not per job); per job: the base is the sum of the jobs
  const fixedPart = rule.used === 'fixed' || (!rule.used && !perJob) ? calc.base - calc.packageTotal : 0
  return {
    month, rule: rule.used || null, rows, days,
    totals: {
      jobs: rows.length,
      hours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100,
      jobsTotal,
      undefinedCount: rows.filter(r => r.pay === null).length,
      fixed: fixedPart,
      packages: (calc.packages || []).map(p => ({ name: p.label || p.client_name || '', amount: Math.round(Number(p.amount) || 0) })),
      packageTotal: calc.packageTotal || 0,
      extras: (calc.extraRows || []).map(r => ({ description: r.description || 'Extra', amount: Math.round(Number(r.amount) || 0) })),
      extrasTotal: calc.extras || 0,
      deductions: (calc.dedRows || []).map(r => ({ description: r.description || '', amount: Math.round(Number(r.amount) || 0) })),
      deductionsTotal: calc.deductions || 0,
      gross: calc.gross,
      net: calc.net,
    },
  }
}

/** Plain-text / Markdown version (used by scripts and for checks). */
export function salaryReportMarkdown(name, rep) {
  const y = n => '¥' + Math.round(Number(n || 0)).toLocaleString('ja-JP')
  const out = [`### ${name} · ${rep.month}`, '', '| Data | Loja / serviço | Horas | Valor |', '|---|---|---:|---:|']
  for (const d of rep.days) {
    for (const r of d.rows) {
      const v = r.pay === null ? 'a definir' : r.inPackage && !r.spot ? `no pacote${r.packageName ? ` (${r.packageName})` : ''}` : y(r.pay)
      out.push(`| ${r.date} | ${r.place}${r.service ? ` — ${r.service}` : ''} | ${r.hours.toFixed(2)}h | ${v} |`)
    }
    out.push(`| **${d.date}** | **subtotal do dia** | **${d.hours.toFixed(2)}h** | **${y(d.subtotal)}${d.undefinedCount ? ` + ${d.undefinedCount} a definir` : ''}** |`)
  }
  const t = rep.totals
  out.push('', `- Serviços: ${t.jobs} · horas: ${t.hours.toFixed(2)}h · soma dos serviços: ${y(t.jobsTotal)}${t.undefinedCount ? ` (${t.undefinedCount} a definir)` : ''}`)
  if (t.fixed) out.push(`- Salário fixo: ${y(t.fixed)}`)
  for (const p of t.packages) out.push(`- Pacote ${p.name}: ${y(p.amount)}`)
  for (const e of t.extras) out.push(`- Extra ${e.description}: +${y(e.amount)}`)
  for (const d of t.deductions) out.push(`- Desconto ${d.description}: −${y(d.amount)}`)
  out.push(`- **Total do mês: ${y(t.net)}**`)
  return out.join('\n')
}
