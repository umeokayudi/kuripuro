import { supabase } from './supabase'
import { monthlyByClient, teamCostByClient, isBilled, invoiceMonth } from './money'
import { monthLastDay } from './salaryCalc'
import { tokyoToday } from './dates'

// v1.0.133 · '*' so employee_pay counts as the job cost when the column exists
const JOB_COLS = '*'

export const previousMonth = (today = tokyoToday()) => {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * v1.0.109 · Money of every client from ONE place: monthly value from the active contracts and the real
 * team cost of the last full month. Returns { monthly, cost, costMonth, contracts }.
 */
export async function loadClientMoney({ costMonth = previousMonth() } = {}) {
  const [c, j, e, f] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('jobs').select(JOB_COLS).eq('status', 'completed').gte('scheduled_date', `${costMonth}-01`).lte('scheduled_date', monthLastDay(costMonth)).limit(5000),
    supabase.from('employees').select('*'),
    supabase.from('faturas').select('id,client_id,status,total,issue_date,period_start,paid_at'),
  ])
  const contracts = c.data || []
  // v1.0.133 · three different numbers, each with its own label on screen:
  //  contract/month (active contracts) · billed in the month (invoices sent) · received in the month (paid)
  const billed = {}, received = {}
  for (const inv of f.data || []) {
    if (!inv.client_id) continue
    if (isBilled(inv) && invoiceMonth(inv) === costMonth) billed[inv.client_id] = (billed[inv.client_id] || 0) + Number(inv.total || 0)
    if (inv.status === 'paid' && String(inv.paid_at || '').slice(0, 7) === costMonth) received[inv.client_id] = (received[inv.client_id] || 0) + Number(inv.total || 0)
  }
  return {
    contracts, billed, received,
    monthly: monthlyByClient(contracts),
    cost: teamCostByClient({ jobs: j.data || [], employees: e.data || [], month: costMonth }),
    costMonth,
  }
}

/**
 * Clients with monthly_revenue / monthly_cost taken from the facts above (the stored columns are old copies).
 * monthly_cost is null when the client had no completed job last month (unknown, not ¥0).
 */
export function withClientMoney(clients, money) {
  if (!money) return clients
  return (clients || []).map(c => ({
    ...c,
    monthly_revenue: money.monthly[c.id] || 0,
    monthly_cost: money.cost[c.id] ?? null,
    billed_month: money.billed?.[c.id] || 0,
    received_month: money.received?.[c.id] || 0,
  }))
}
