// v1.0.173 · Meu salário (week/month), payslip PDF and Payments must give the same number.
// Case from 06/11: Alexandre, "Mensal fixo" ¥0/mês, 7 basics with Pagamento do funcionário ¥1.000 + 1 deep without.
import assert from 'node:assert/strict'
import { summarizeRange, jobEarnings, monthEnd } from '../src/lib/earnings.js'
import { payrollMonth } from '../src/lib/salaryCalc.js'
import { payslipHtml } from '../src/lib/payslipPdf.js'

const emp = { id: 'a', full_name: 'Alexandre', salary_type: 'fixed', fixed_salary: 0, hourly_rate: 0, monthly_work_days: 22, is_active: true }
const job = (d, t, pay, extra = {}) => ({ id: `${d}-${t}`, status: 'completed', scheduled_date: d, title: t, employee_pay: pay, started_at: `${d}T01:00:00Z`, completed_at: `${d}T03:00:00Z`, ...extra })
const jobs = [
  job('2026-11-03', 'Kodama Oimachi', 1000), job('2026-11-05', 'Tooda', 1000), job('2026-11-05', 'Ibushio Deep', null),
  job('2026-11-06', 'Sakana 2', 1000), job('2026-11-06', 'Kodama Yurakucho', 1000), job('2026-11-06', 'Tooda', 1000),
  job('2026-11-06', 'Sakana Honten', 1000), job('2026-11-06', 'Kodama Oimachi', 1000),
]
const today = '2026-11-06'
const payroll = { jobs, lines: [], basisByMonth: {} }

const pay = payrollMonth({ emp, jobs, lines: [], month: '2026-11' })
assert.equal(pay.net, 7000, 'Payments')

const month = summarizeRange({ emp, jobs, payroll, from: '2026-11-01', to: monthEnd('2026-11'), today })
assert.equal(month.net, 7000, 'Meu salário · mês')
assert.equal(month.days.reduce((s, d) => s + d.total, 0), 7000, 'dias do mês somam o mês')

const week = summarizeRange({ emp, jobs, payroll, from: '2026-11-02', to: '2026-11-08', today })
assert.equal(week.net, 7000, 'Meu salário · semana (era ¥0)')
assert.equal(week.days.find(d => d.day === '2026-11-06').total, 5000)

// without the payroll bundle (old callers) the rule is the same
assert.equal(summarizeRange({ emp, jobs, from: '2026-11-02', to: '2026-11-08', today }).net, 7000)

const r = month.ruleOf(jobs[0])
assert.equal(jobEarnings(jobs[0], emp, r), 1000, 'linha do serviço')
assert.equal(jobEarnings(jobs[2], emp, r), 0, 'deep sem pagamento = a definir')

const html = payslipHtml({ employee: emp, month: '2026-11', salary: month.salary, jobs: month.days.flatMap(d => d.jobs), lang: 'pt' })
assert.ok(html.includes('Pagamento por serviço'), 'PDF diz por serviço')
assert.ok(!html.includes('Nenhum valor de pagamento cadastrado'), 'PDF sem aviso falso de ¥0')
assert.ok(html.includes('¥1,000'), 'PDF mostra ¥1,000 por serviço')
assert.ok(html.includes('¥7,000'))

// fixed salary person: unchanged — full month, per worked day on the week
const fx = { ...emp, fixed_salary: 220000 }
const fxJobs = jobs.map(j => ({ ...j, employee_pay: null }))
assert.equal(summarizeRange({ emp: fx, jobs: fxJobs, payroll: { jobs: fxJobs, lines: [] }, from: '2026-11-01', to: '2026-11-30', today }).net, 220000)
assert.equal(summarizeRange({ emp: fx, jobs: fxJobs, payroll: { jobs: fxJobs, lines: [] }, from: '2026-11-02', to: '2026-11-08', today }).net, 30000)

// hourly person: unchanged
const hr = { ...emp, salary_type: 'hourly', hourly_rate: 1500 }
assert.equal(summarizeRange({ emp: hr, jobs: fxJobs, from: '2026-11-02', to: '2026-11-08', today }).net, 8 * 2 * 1500)

console.log('salary unified: ok')
