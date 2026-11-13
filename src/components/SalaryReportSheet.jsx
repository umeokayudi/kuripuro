import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { salaryReport } from '../lib/salaryReport'
import './SalaryReportSheet.css'

// v1.0.214 · Relatório detalhado de salário of one person and one month: every job (date, store/service,
// hours, value), a subtotal per day and the month total. Values come only from what is set in the system
// ("Pagamento do funcionário" / package); a job without it shows "a definir". Employee: own report;
// admin: the report of whoever is open on the Salary screen.

const T = {
  pt: { title: 'Relatório detalhado', date: 'Data', place: 'Loja / serviço', hours: 'Horas', value: 'Valor', day: 'Subtotal do dia', tbd: 'a definir', pkg: 'no pacote', jobs: 'Serviços', sum: 'Soma dos serviços', fixed: 'Salário fixo', package: 'Pacote', extra: 'Extra', ded: 'Desconto', total: 'Total do mês', print: '🖨 Imprimir / PDF', close: 'Fechar', empty: 'Nenhum serviço concluído neste mês.', tbdNote: n => `${n} serviço(s) ainda sem valor — o escritório precisa colocar o valor.` },
  en: { title: 'Detailed report', date: 'Date', place: 'Store / service', hours: 'Hours', value: 'Amount', day: 'Day subtotal', tbd: 'to be set', pkg: 'in package', jobs: 'Jobs', sum: 'Jobs total', fixed: 'Fixed salary', package: 'Package', extra: 'Extra', ded: 'Deduction', total: 'Month total', print: '🖨 Print / PDF', close: 'Close', empty: 'No completed jobs this month.', tbdNote: n => `${n} job(s) still without an amount — the office has to set it.` },
  ja: { title: '給与明細（詳細）', date: '日付', place: '店舗 / 作業', hours: '時間', value: '金額', day: '日計', tbd: '未設定', pkg: 'パック', jobs: '件数', sum: '作業合計', fixed: '固定給', package: 'パック', extra: '追加', ded: '控除', total: '月合計', print: '🖨 印刷 / PDF', close: '閉じる', empty: '今月の完了作業はありません。', tbdNote: n => `${n}件はまだ金額が未設定です（事務所が設定します）。` },
}

const yen = n => '¥' + Math.round(Number(n || 0)).toLocaleString('ja-JP')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function cell(r, t) {
  if (r.pay === null) return t.tbd
  if (r.inPackage && !r.spot) return t.pkg
  return yen(r.pay)
}

function printHtml(name, month, rep, t) {
  const body = rep.days.map(d => d.rows.map(r => `<tr><td>${esc(d.date)}</td><td>${esc(r.place)}${r.service ? ` — ${esc(r.service)}` : ''}</td><td class="n">${r.hours.toFixed(2)}h</td><td class="n">${esc(cell(r, t))}</td></tr>`).join('')
    + `<tr class="sub"><td colspan="2">${t.day} ${esc(d.date)}</td><td class="n">${d.hours.toFixed(2)}h</td><td class="n">${yen(d.subtotal)}${d.undefinedCount ? ` + ${d.undefinedCount} ${t.tbd}` : ''}</td></tr>`).join('')
  const x = rep.totals
  const tot = [
    `<tr><td>${t.sum} (${x.jobs} · ${x.hours.toFixed(2)}h)</td><td class="n">${yen(x.jobsTotal)}</td></tr>`,
    x.fixed ? `<tr><td>${t.fixed}</td><td class="n">${yen(x.fixed)}</td></tr>` : '',
    ...x.packages.map(p => `<tr><td>${t.package} ${esc(p.name)}</td><td class="n">${yen(p.amount)}</td></tr>`),
    ...x.extras.map(e => `<tr><td>${t.extra} ${esc(e.description)}</td><td class="n">+${yen(e.amount)}</td></tr>`),
    ...x.deductions.map(e => `<tr><td>${t.ded} ${esc(e.description)}</td><td class="n">−${yen(e.amount)}</td></tr>`),
    `<tr class="sub"><td>${t.total}</td><td class="n">${yen(x.net)}</td></tr>`,
  ].join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} ${esc(month)}</title><style>
  body{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}
  th{background:#f3f5f8}.n{text-align:right;white-space:nowrap}.sub td{font-weight:700;background:#f8fafc}</style></head><body>
  <h1>${t.title} · ${esc(name)} · ${esc(month)}</h1>
  <table><thead><tr><th>${t.date}</th><th>${t.place}</th><th class="n">${t.hours}</th><th class="n">${t.value}</th></tr></thead><tbody>${body}</tbody></table>
  <table style="max-width:420px;margin-left:auto">${tot}</table></body></html>`
}

export default function SalaryReportSheet({ emp, jobs, lines, basis, month, lang = 'pt', onClose }) {
  const t = T[lang] || T.en
  const rep = useMemo(() => salaryReport({ emp, jobs, lines, month, basis }), [emp, jobs, lines, month, basis])
  const name = emp?.full_name || ''
  const x = rep.totals
  const print = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(printHtml(name, month, rep, t))
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }
  return createPortal(
    <div className="srs-back" onClick={onClose}>
      <div className="srs" role="dialog" aria-label={t.title} onClick={e => e.stopPropagation()}>
        <div className="srs-h">
          <div><b>{t.title}</b><small>{name} · {month}</small></div>
          <button type="button" className="srs-x" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {!rep.rows.length && <div className="srs-empty">{t.empty}</div>}
        {x.undefinedCount > 0 && <div className="srs-warn">⚠ {t.tbdNote(x.undefinedCount)}</div>}
        <div className="srs-list">
          {rep.days.map(d => (
            <div key={d.date} className="srs-day">
              {d.rows.map(r => (
                <div key={r.id} className="srs-row">
                  <span className="srs-d">{d.date.slice(5).replace('-', '/')}</span>
                  <span className="srs-p">{r.place}{r.service ? <small>{r.service}</small> : null}</span>
                  <span className="srs-n">{r.hours.toFixed(2)}h</span>
                  <span className={`srs-n${r.pay === null ? ' is-tbd' : ''}`}>{cell(r, t)}</span>
                </div>
              ))}
              <div className="srs-row is-sub">
                <span className="srs-d" />
                <span className="srs-p">{t.day}</span>
                <span className="srs-n">{d.hours.toFixed(2)}h</span>
                <span className="srs-n">{yen(d.subtotal)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="srs-tot">
          <div><span>{t.sum} ({x.jobs} · {x.hours.toFixed(2)}h)</span><b>{yen(x.jobsTotal)}</b></div>
          {x.fixed > 0 && <div><span>{t.fixed}</span><b>{yen(x.fixed)}</b></div>}
          {x.packages.map((p, i) => <div key={`p${i}`}><span>{t.package} {p.name}</span><b>{yen(p.amount)}</b></div>)}
          {x.extras.map((e, i) => <div key={`e${i}`}><span>{t.extra} {e.description}</span><b>+{yen(e.amount)}</b></div>)}
          {x.deductions.map((e, i) => <div key={`d${i}`} className="is-neg"><span>{t.ded} {e.description}</span><b>−{yen(e.amount)}</b></div>)}
          <div className="is-net"><span>{t.total}</span><b>{yen(x.net)}</b></div>
        </div>
        <button type="button" className="srs-print" onClick={print}>{t.print}</button>
      </div>
    </div>,
    document.body,
  )
}
