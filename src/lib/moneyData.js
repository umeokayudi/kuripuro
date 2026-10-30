import { supabase } from './supabase'
import { monthlyByClient, teamCostByClient } from './money'
import { monthLastDay } from './salaryCalc'
import { tokyoToday } from './dates'

const JOB_COLS = 'id,client_id,employee_id,status,scheduled_date,started_at,completed_at,retro_time_min,retro_value,value,job_category,spot_value'

export const previousMonth = (today = tokyoToday()) => {
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * v1.0.109 · Money of every client from ONE place: monthly value from the active contracts and the real
 * team cost of the last full month. Returns { monthly, cost, costMonth, contracts }.
 */
export async function loadClientMoney({ costMonth = previousMonth() } = {}) {
  const [c, j, e] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('jobs').select(JOB_COLS).eq('status', 'completed').gte('scheduled_date', `${costMonth}-01`).lte('scheduled_date', monthLastDay(costMonth)).limit(5000),
    supabase.from('employees').select('*'),
  ])
  const contracts = c.data || []
  return {
    contracts,
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
  }))
}
