import { escapeHtml } from './escapeHtml'

export function roundYen(n) {
  return Math.round(Number(n) || 0)
}

export function yen(n) {
  return `¥${roundYen(n).toLocaleString('ja-JP')}`
}

export function lineTotal(quantity, unitPrice) {
  return roundYen((Number(quantity) || 0) * (Number(unitPrice) || 0))
}

export function invoiceTotals(items, taxRate = 10) {
  const subtotal = roundYen(
    (items || []).reduce((sum, it) => {
      const line = it.total != null && it.total !== ''
        ? Number(it.total)
        : lineTotal(it.quantity, it.unit_price)
      return sum + (Number.isFinite(line) ? line : 0)
    }, 0)
  )
  const rate = Number(taxRate) || 0
  const taxAmount = roundYen(subtotal * rate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount, taxRate: rate }
}

/** KP-YYYYMM-001 from Tokyo issue date and existing rows. */
export function nextInvoiceNumber(existing, issueDate) {
  const yyyymm = String(issueDate || '').slice(0, 7).replace('-', '')
  const prefix = `KP-${yyyymm}-`
  let max = 0
  for (const row of existing || []) {
    const n = String(row?.invoice_number || '')
    if (!n.startsWith(prefix)) continue
    const seq = parseInt(n.slice(prefix.length), 10)
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export function previousCalendarMonth(today) {
  const [y, m] = String(today).split('-').map(Number)
  const startDate = new Date(Date.UTC(y, m - 2, 1))
  const endDate = new Date(Date.UTC(y, m - 1, 0))
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  }
}

export function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + Number(days || 0))).toISOString().slice(0, 10)
}

export function jobsToInvoiceItems(jobs) {
  return (jobs || []).map(job => {
    const unit = roundYen(job.value ?? job.spot_value ?? 0)
    const place = job.location_name || job.address || ''
    const description = [job.title, place].filter(Boolean).join(' — ')
    return {
      job_id: job.id || null,
      description,
      quantity: 1,
      unit_price: unit,
      total: unit,
    }
  })
}

export function cashflowDescription(invoiceNumber, clientName) {
  const no = invoiceNumber || 'invoice'
  return `請求書 ${no} · ${clientName || ''}`.trim()
}

export function buildInvoicePrintHtml(invoice, items, issuer = {}) {
  const clientName = escapeHtml(invoice.client_name)
  const issueDate = escapeHtml(invoice.issue_date)
  const periodStart = escapeHtml(invoice.period_start || '—')
  const periodEnd = escapeHtml(invoice.period_end || '—')
  const dueDate = escapeHtml(invoice.due_date || '—')
  const notes = escapeHtml(invoice.notes || '')
  const number = escapeHtml(invoice.invoice_number || invoice.id?.slice?.(0, 8) || '')
  const company = escapeHtml(issuer.company || 'KuriPuro by JBM')
  const address = escapeHtml(issuer.address || '')
  const regNumber = escapeHtml(issuer.regNumber || '')
  const bank = escapeHtml(issuer.bank || '')
  const paid = invoice.status === 'paid'
  const rows = (items || []).map(it => `
      <tr>
        <td>${escapeHtml(it.description || '')}</td>
        <td class="num">${escapeHtml(String(it.quantity ?? ''))}</td>
        <td class="num">${yen(it.unit_price)}</td>
        <td class="num">${yen(it.total)}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>請求書 ${number} - ${clientName}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;color:#152033;max-width:720px;margin:0 auto;padding:12px}
  h1{text-align:center;font-size:26px;letter-spacing:0.4em;margin:0 0 4px}
  .sub{text-align:center;color:#667;font-size:12px;margin-bottom:22px}
  .meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;font-size:13px}
  .bill-to{font-size:16px;font-weight:700}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#0c1c30;color:#fff;padding:8px 10px;text-align:left;font-size:12px;font-weight:600}
  td{padding:8px 10px;border-bottom:1px solid #e6ebf2;font-size:13px}
  .num{text-align:right;white-space:nowrap}
  .totals{width:280px;margin-left:auto}
  .totals td{border:none;padding:5px 8px}
  .total-row td{border-top:2px solid #152033;font-weight:700;font-size:15px}
  .footer{margin-top:28px;font-size:12px;color:#556;line-height:1.6}
  .stamp{position:absolute;right:40px;top:48px;border:3px solid #0f6e56;color:#0f6e56;padding:6px 14px;font-weight:800;transform:rotate(-12deg);font-size:18px}
  .wrap{position:relative}
</style></head>
<body>
  <div class="wrap">
    ${paid ? '<div class="stamp">入金済</div>' : ''}
    <h1>請求書</h1>
    <div class="sub">${company}</div>
    <div class="meta">
      <div>
        <div class="bill-to">${clientName} 御中</div>
        <div>対象期間: ${periodStart} 〜 ${periodEnd}</div>
      </div>
      <div style="text-align:right">
        <div>請求書番号: ${number}</div>
        <div>発行日: ${issueDate}</div>
        <div>支払期限: ${dueDate}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>内容</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>小計</td><td class="num">${yen(invoice.subtotal)}</td></tr>
      <tr><td>消費税 (${escapeHtml(String(invoice.tax_rate ?? 10))}%)</td><td class="num">${yen(invoice.tax_amount)}</td></tr>
      <tr class="total-row"><td>合計金額（税込）</td><td class="num">${yen(invoice.total)}</td></tr>
    </table>
    ${notes ? `<p style="margin-top:18px;font-size:13px;color:#556">備考: ${notes}</p>` : ''}
    <div class="footer">
      ${address ? `<div>${address}</div>` : ''}
      ${regNumber ? `<div>${regNumber}</div>` : ''}
      ${bank ? `<div>${bank}</div>` : '<div>振込先等については別途ご連絡いたします</div>'}
      <div style="margin-top:8px">本請求書は電子発行です。KuriPuro ${escapeHtml(issuer.version || '')}</div>
    </div>
  </div>
</body></html>`
}
