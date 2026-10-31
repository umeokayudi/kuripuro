// v1.0.123 · Offers (⚡ Ofertar) as the employee reads them: the extra pay lives only in
// jobs.spot_value ("+¥ extra"). A pay amount also typed in the description shows the value twice
// (sometimes a different one), and copied lines repeat. These helpers find and clean both.

const YEN = /(?:¥\s?\d[\d.,]*|\d[\d.,]*\s?円)/
const PAY_WORDS = /(pagamento|pago|extra|adicional|valor|pay|報酬|給与|手当)/i

/** Exact repeated lines (or "|" parts) removed, order kept. */
export function dedupeLines(description) {
  const seen = new Set()
  const out = []
  for (const line of String(description || '').split('\n')) {
    const parts = line.split('|').map(p => p.trim()).filter(p => {
      if (!p) return false
      const k = p.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (parts.length) out.push(parts.join(' | '))
  }
  return out.join('\n')
}

/** Parts of the description that talk about the employee's pay with a yen amount. */
export function payMentions(description) {
  return String(description || '').split(/\n|\|/).map(p => p.trim()).filter(p => YEN.test(p) && PAY_WORDS.test(p))
}

/** Description without the pay parts (the value stays only in the extra field) and without repeats. */
export function stripPay(description) {
  const lines = dedupeLines(description).split('\n').map(line => line.split('|').map(p => p.trim())
    .filter(p => !(YEN.test(p) && PAY_WORDS.test(p))).join(' | ')).filter(Boolean)
  return lines.join('\n')
}

/** What is wrong with one offer, for the admin list. */
export function offerIssues(job) {
  const out = []
  const desc = job?.description || ''
  const extra = job?.job_category === 'spot' ? Number(job?.spot_value) || 0 : 0
  if (payMentions(desc).length) out.push(extra ? 'payTwice' : 'payInText')
  if (dedupeLines(desc) !== desc.split('\n').map(l => l.split('|').map(p => p.trim()).filter(Boolean).join(' | ')).filter(Boolean).join('\n')) out.push('repeated')
  return out
}
