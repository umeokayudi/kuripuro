import { spotContractTotals, contractStatus } from './spotContract.js'

// v1.0.21 · Seller (salespeople) commission on contracts. Shared by the admin pages, the
// seller portal and the sales API. Rules come from sales_commission_rules (Sales Team →
// commission per seller): percent of the tax-excluded price ('base_monthly', the default)
// or of the total with tax ('contract_total'), or a fixed amount per contract.

/** Commission fields for a contract from the seller's rule (no rule → nothing). */
export function commissionFromRule(rule, c) {
  if (!rule || !['percent', 'fixed'].includes(rule.commission_type)) return { commission_type: null, commission_value: null, commission_amount: 0 }
  const value = Number(rule.commission_value || 0)
  if (rule.commission_type === 'fixed') return { commission_type: 'fixed', commission_value: value, commission_amount: Math.round(value) }
  const t = spotContractTotals(c)
  const basis = rule.percent_basis === 'contract_total' ? t.total : t.subtotal
  return { commission_type: 'percent', commission_value: value, commission_amount: Math.round(basis * value / 100) }
}

/** none | pending (contract awaiting approval) | earned (to pay) | paid | void (cancelled/rejected). */
export function commissionState(c) {
  if (!c?.salesperson_id || !Number(c.commission_amount)) return 'none'
  if (c.commission_paid_at) return 'paid'
  const st = contractStatus(c)
  if (st === 'cancelled' || st === 'rejected') return 'void'
  return st === 'approved' ? 'earned' : 'pending'
}

/** Totals for one seller: spot commissions by state and the monthly commission of fixed locations. */
export function sellerCommissionSummary(spots = [], fixed = []) {
  const sum = state => spots.filter(c => commissionState(c) === state).reduce((s, c) => s + Number(c.commission_amount || 0), 0)
  return {
    earned: sum('earned'),
    paid: sum('paid'),
    pending: sum('pending'),
    monthly: fixed.filter(c => c.is_active !== false).reduce((s, c) => s + Number(c.commission_amount || 0), 0),
  }
}
