export function roundYen(value) { return Math.round(Number(value) || 0) }
export function lineTotal(quantity, unitPrice) { return roundYen((Number(quantity) || 0) * (Number(unitPrice) || 0)) }
export function invoiceTotals(items, taxRate = 10) {
  const subtotal = roundYen((items || []).reduce((sum, item) => {
    const line = item.total != null && item.total !== '' ? Number(item.total) : lineTotal(item.quantity, item.unit_price)
    return sum + (Number.isFinite(line) ? line : 0)
  }, 0))
  const rate = Number(taxRate) || 0
  const taxAmount = subtotal <= 0 ? 0 : roundYen(subtotal * rate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount, taxRate: rate }
}
export function addDays(date, days) { const d = new Date(String(date) + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
export function yen(value) { return '¥' + roundYen(value).toLocaleString('ja-JP') }
