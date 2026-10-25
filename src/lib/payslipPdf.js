import { contractPdfBlob, downloadBlob } from './contractPdf'
import { monthLabel, jobEarnings } from './earnings'
import { jobMinutes } from './salaryCalc'
import { salaryTypeLabel } from './employeePay'

// Payslip (給与明細 / Payslip) as an A4 PDF.
// Rendered from HTML like the contract PDF, so Japanese text uses the phone's own fonts
// instead of jsPDF's built-in Helvetica (which has no Japanese glyphs and printed mojibake).

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`

const L = {
  ja: {
    title: '給与明細書', employee: '氏名', contract: '契約種別', salaryType: '給与形態', period: '対象期間',
    rate: '単価', days: '勤務日数', hours: '勤務時間', jobs: '作業件数', earnings: '支給', deductionsTitle: '控除',
    item: '項目', amount: '金額', base: '基本給', spot: 'スポット手当', gross: '支給合計', dedTotal: '控除合計',
    net: '差引支給額', schedule: '支払予定', date: '日付', desc: '内容', status: '状態', detail: '作業明細',
    place: '現場', time: '時間', none: '控除はありません', confidential: '社外秘', created: '作成日',
    noRate: '給与の単価が設定されていません（月給・時給が ¥0）。金額が ¥0 の場合は管理者に確認してください。',
    perMonth: '/月', perHour: '/時', perDay: '日給', dayUnit: '日', jobUnit: '件',
    status_scheduled: '予定', status_paid: '支払済', status_pending: '保留',
  },
  en: {
    title: 'Payslip', employee: 'Employee', contract: 'Contract', salaryType: 'Pay type', period: 'Period',
    rate: 'Rate', days: 'Days worked', hours: 'Hours', jobs: 'Jobs', earnings: 'Earnings', deductionsTitle: 'Deductions',
    item: 'Item', amount: 'Amount', base: 'Base pay', spot: 'Spot jobs', gross: 'Gross pay', dedTotal: 'Total deductions',
    net: 'Net pay', schedule: 'Payment schedule', date: 'Date', desc: 'Description', status: 'Status', detail: 'Work detail',
    place: 'Place', time: 'Time', none: 'No deductions', confidential: 'Confidential', created: 'Created',
    noRate: 'No pay rate is set for this employee (monthly and hourly are ¥0). If the amount shows ¥0, check with the admin.',
    perMonth: '/mo', perHour: '/h', perDay: 'Daily', dayUnit: 'days', jobUnit: 'jobs',
    status_scheduled: 'Scheduled', status_paid: 'Paid', status_pending: 'Pending',
  },
  pt: {
    title: 'Holerite', employee: 'Funcionário', contract: 'Contrato', salaryType: 'Tipo de pagamento', period: 'Período',
    rate: 'Valor', days: 'Dias trabalhados', hours: 'Horas', jobs: 'Serviços', earnings: 'Ganhos', deductionsTitle: 'Descontos',
    item: 'Item', amount: 'Valor', base: 'Salário base', spot: 'Serviços spot', gross: 'Total bruto', dedTotal: 'Total de descontos',
    net: 'Valor líquido', schedule: 'Pagamentos programados', date: 'Data', desc: 'Descrição', status: 'Situação', detail: 'Detalhe dos serviços',
    place: 'Local', time: 'Horário', none: 'Sem descontos', confidential: 'Confidencial', created: 'Gerado em',
    noRate: 'Nenhum valor de pagamento cadastrado para este funcionário (mensal e por hora são ¥0). Se o valor aparecer ¥0, fale com o admin.',
    perMonth: '/mês', perHour: '/h', perDay: 'Diária', dayUnit: 'dias', jobUnit: 'serviços',
    status_scheduled: 'Agendado', status_paid: 'Pago', status_pending: 'Pendente',
  },
}
const docLang = lang => (lang === 'ja' || lang === 'pt' ? lang : 'en')

function rateText(emp, salary, t) {
  const type = emp?.salary_type || 'fixed'
  if (type === 'fixed') return `${yen(emp?.fixed_salary)}${t.perMonth} · ${t.perDay} ${yen(salary?.dailyRate)}`
  if (type === 'hourly') return `${yen(emp?.hourly_rate)}${t.perHour}`
  if (type === 'per_job') return `${emp?.job_bonus_rate || 100}%`
  return `${yen(emp?.fixed_salary)}${t.perMonth} + ${yen(emp?.hourly_rate)}${t.perHour} + ${emp?.job_bonus_rate || 0}%`
}

/** Printable HTML for one month. `salary` is calcEmployeeMonthlySalary(...) for that month. */
export function payslipHtml({ employee, month, salary, deductions = [], payments = [], jobs = [], lang = 'ja', companyName = 'KuriPuro by JBM' }) {
  const t = L[docLang(lang)]
  const s = salary || {}
  const dedRows = deductions.map(d => ({ label: d.description || t.deductionsTitle, amount: Number(d.amount || 0) }))
  const dedTotal = dedRows.reduce((a, d) => a + d.amount, 0)
  const gross = Number(s.total || 0)
  const net = Math.max(0, gross - dedTotal)
  const paid = payments.filter(p => !p.is_deduction && p.payment_type !== 'advance')
  const showJobAmounts = (employee?.salary_type || 'fixed') !== 'fixed' || jobs.some(j => j.job_category === 'spot')
  const created = new Date().toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { timeZone: 'Asia/Tokyo' })

  const info = [
    [t.employee, employee?.full_name || '—'], [t.contract, employee?.contract_type || '—'],
    [t.period, monthLabel(month, lang, true)], [t.salaryType, salaryTypeLabel(employee?.salary_type || 'fixed', lang)],
    [t.days, `${s.workedDays || 0} ${t.dayUnit}`], [t.rate, rateText(employee, s, t)],
    [t.hours, `${Number(s.hours || 0).toFixed(1)}h`], [t.jobs, `${s.jobs || 0} ${t.jobUnit}`],
  ]

  return `<!doctype html><html lang="${docLang(lang)}"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
/* Plain sans-serif: the phone picks its own Japanese font the same way for the page and for the canvas. Naming fonts made html2canvas mis-measure words. */
body{margin:0;font-family:sans-serif;color:#1c2333;background:#fff;font-size:14px}
.head{background:#060d18;color:#fff;padding:22px 26px;display:flex;justify-content:space-between;align-items:flex-end}
.head b{display:block;color:#c19c56;font-size:22px;letter-spacing:.3px}
.head span{font-size:15px;opacity:.9}
.head .m{font-size:18px;font-weight:700}
.wrap{padding:18px 26px 8px}
.info{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px;background:#f4f6fb;border-radius:8px;padding:14px 16px}
.info div{display:flex;justify-content:space-between;gap:10px;font-size:13px;border-bottom:1px solid #e3e7f0;padding:4px 0}
.info dt{color:#6b7385;font-weight:600}.info dd{margin:0;font-weight:600;text-align:right}
.warn{margin-top:12px;background:#fff6e5;border:1px solid #f0c66b;color:#7a5200;border-radius:8px;padding:10px 12px;font-size:13px}
h3{margin:20px 0 6px;font-size:15px;color:#060d18}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#060d18;color:#fff;text-align:left;padding:7px 10px;font-weight:600}
th.r,td.r{text-align:right}
td{padding:7px 10px;border-bottom:1px solid #edf0f5}
tr:nth-child(even) td{background:#f8faff}
tr.sum td{background:#c19c56!important;color:#fff;font-weight:700}
tr.ded td.r{color:#b41e1e}
tr.dsum td{background:#b41e1e!important;color:#fff;font-weight:700}
.net{margin-top:16px;background:#060d18;color:#c19c56;border-radius:8px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-size:20px;font-weight:800}
.net small{display:block;color:rgba(255,255,255,.55);font-size:12px;font-weight:500}
.muted{color:#8a91a2;font-size:12px}
.foot{margin-top:22px;padding:10px 26px;background:#060d18;color:#c19c56;font-size:11px;display:flex;justify-content:space-between}
</style></head><body>
<div class="head"><div><b>${esc(companyName)}</b><span>${t.title}</span></div><div class="m">${esc(monthLabel(month, lang, true))}</div></div>
<div class="wrap">
<dl class="info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
${s.notConfigured ? `<div class="warn">⚠ ${esc(t.noRate)}</div>` : ''}
<h3>${t.earnings}</h3>
<table><tr><th>${t.item}</th><th class="r">${t.amount}</th></tr>
<tr><td>${t.base}</td><td class="r">${yen(s.base)}</td></tr>
${Number(s.spotEarned || 0) ? `<tr><td>${t.spot}</td><td class="r">${yen(s.spotEarned)}</td></tr>` : ''}
<tr class="sum"><td>${t.gross}</td><td class="r">${yen(gross)}</td></tr></table>
<h3>${t.deductionsTitle}</h3>
${dedRows.length ? `<table><tr><th>${t.item}</th><th class="r">${t.amount}</th></tr>
${dedRows.map(d => `<tr class="ded"><td>${esc(d.label)}</td><td class="r">-${yen(d.amount)}</td></tr>`).join('')}
<tr class="dsum"><td>${t.dedTotal}</td><td class="r">-${yen(dedTotal)}</td></tr></table>` : `<div class="muted">${t.none}</div>`}
<div class="net"><div>${t.net}<small>${yen(gross)} − ${yen(dedTotal)}</small></div><div>${yen(net)}</div></div>
${paid.length ? `<h3>${t.schedule}</h3><table><tr><th>${t.date}</th><th>${t.desc}</th><th class="r">${t.amount}</th><th class="r">${t.status}</th></tr>
${paid.map(p => `<tr><td>${esc(p.payment_date || '')}</td><td>${esc(p.description || '')}</td><td class="r">${yen(p.amount)}</td><td class="r">${esc(t['status_' + p.status] || p.status || '')}</td></tr>`).join('')}</table>` : ''}
${jobs.length ? `<h3>${t.detail}</h3><table><tr><th>${t.date}</th><th>${t.place}</th><th class="r">${t.time}</th>${showJobAmounts ? `<th class="r">${t.amount}</th>` : ''}</tr>
${jobs.map(j => `<tr><td>${esc(j.scheduled_date)}</td><td>${esc(j.title || '')}</td><td class="r">${(jobMinutes(j) / 60).toFixed(1)}h</td>${showJobAmounts ? `<td class="r">${yen(jobEarnings(j, employee))}</td>` : ''}</tr>`).join('')}</table>` : ''}
</div>
<div class="foot"><span>${esc(companyName)} — ${t.confidential}</span><span>${t.created}: ${esc(created)}</span></div>
</body></html>`
}

/** Builds and downloads the payslip PDF for one month. */
export async function downloadPayslipPdf(opts) {
  const lang = docLang(opts.lang)
  const blob = await contractPdfBlob(payslipHtml(opts), { footer: { ja: 'KuriPuro - Kyuyo meisai', pt: 'KuriPuro - Holerite', en: 'KuriPuro - Payslip' }[lang] })
  const name = (opts.employee?.full_name || 'employee').trim().replace(/\s+/g, '_')
  downloadBlob(blob, `${{ ja: 'kyuyo', pt: 'holerite', en: 'payslip' }[lang]}_${name}_${opts.month}.pdf`)
}
