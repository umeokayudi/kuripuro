/**
 * Automatic recurring billing rules.
 * Contract is the source of pricing; completed jobs are the source of delivered work.
 */

export function monthBounds(period) {
  const [year, month] = period.split('-').map(Number)
  const start = `${period}-01`
  const end = new Date(year, month, 0).toISOString().slice(0, 10)
  return { start, end }
}

export function applyDiscount(amount, discountPercent = 0) {
  const pct = Math.max(0, Math.min(100, Number(discountPercent) || 0))
  const discount = Math.round(Number(amount || 0) * pct / 100)
  return { gross: Math.round(Number(amount || 0)), discount, net: Math.round(Number(amount || 0) - discount) }
}

export function calculateTax(subtotal, taxRate = 10, priceIncludesTax = true) {
  const rate = Math.max(0, Number(taxRate) || 0)
  const base = Math.round(Number(subtotal || 0))
  if (priceIncludesTax) {
    return Math.round(base * rate / (100 + rate))
  }
  return Math.round(base * rate / 100)
}

export function contractBillingAmount(contract, completedJobs = []) {
  if (contract.billing_type === 'fixed_monthly') {
    return Math.round(Number(contract.fixed_monthly || 0))
  }

  const locationJobs = completedJobs.filter(job => {
    const title = String(job.title || '')
    const location = title.split(' — ')[0].trim()
    return location === String(contract.location_name || '').trim()
  })

  return locationJobs.reduce((sum, job) => sum + Number(job.value || job.spot_value || contract.price_per_visit || 0), 0)
}

export function buildContractLine(contract, completedJobs = []) {
  const amount = contractBillingAmount(contract, completedJobs)
  const pricing = applyDiscount(amount, contract.discount_percent)
  if (!pricing.net && !amount) return null

  const locationJobs = completedJobs.filter(job => String(job.title || '').split(' — ')[0].trim() === String(contract.location_name || '').trim())
  const quantity = contract.billing_type === 'fixed_monthly' ? 1 : locationJobs.length
  const unitPrice = contract.billing_type === 'fixed_monthly'
    ? Number(contract.fixed_monthly || 0)
    : quantity > 0 ? Math.round(amount / quantity) : Number(contract.price_per_visit || 0)

  const description = contract.billing_type === 'fixed_monthly'
    ? `${contract.location_name} — ${contract.service_type} (monthly)`
    : `${contract.location_name} — ${contract.service_type} (${quantity} completed visits)`

  return {
    description,
    quantity,
    unit_price: unitPrice,
    total: pricing.net,
    discount_amount: pricing.discount,
    discount_percent: Number(contract.discount_percent || 0),
    contract_id: contract.id,
    job_ids: locationJobs.map(job => job.id),
  }
}
