// v1.0.116 · Approved quote → recurring contract draft. Nothing is saved here: Contracts opens its
// form filled from the quote and the office checks the days and saves (same validation as always).

/** quote (mitsumori row) + its lead → the Contracts form fields */
export function contractDraftFromQuote(quote, lead = null) {
  const subtotal = Number(quote?.subtotal || 0)
  const total = Number(quote?.total || 0)
  const preTax = subtotal > 0
  return {
    location_name: String(lead?.site_name || quote?.site_name || quote?.company_name || '').trim(),
    location_address: lead?.address || quote?.address || '',
    service_type: 'Basic Cleaning',
    billing_type: 'fixed_monthly',
    fixed_monthly: preTax ? subtotal : total,
    price_per_visit: 0,
    tax_rate: Number(quote?.tax_rate ?? 10),
    price_includes_tax: !preTax,
    hours_per_visit: Number(quote?.hours_per_visit) > 0 ? Number(quote.hours_per_visit) : 2,
    days_of_week: [],
    notes: [`Do orçamento ${quote?.quote_number || quote?.id || ''}`.trim(), quote?.frequency ? `Frequência: ${quote.frequency}` : ''].filter(Boolean).join(' · '),
    salesperson_id: quote?.salesperson_id || '',
  }
}

/** client row whose name matches the quote's company (case / spaces ignored), or null */
export function clientForQuote(quote, clients = []) {
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/^(株式会社|kk|k\.k\.)|(株式会社|kk|k\.k\.)$/g, '')
  const name = norm(quote?.company_name)
  if (!name) return null
  return (clients || []).find(c => quote?.client_id && c.id === quote.client_id)
    || (clients || []).find(c => norm(c.company_name) === name) || null
}
