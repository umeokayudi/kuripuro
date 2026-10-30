// v1.0.104 · Database side of deepCoverage.js: loads for the Deep & Spot tab, the deep state per
// restaurant (World Items / Client Report) and "Schedule" on a missing visit (→ Pending box).
import { supabase } from './supabase'
import { tokyoToday } from './dates'
import { addDays, dupKey } from './schedulePlan'
import { jobsToRows } from './scheduleGenerator'
import { pendingChanged } from './adminPending'
import { deepTargets, deepStatusByPlace, deepSpotType, isDeepWork, placeKey } from './deepCoverage'

const JOB_COLS = 'id,title,client_id,client_name,employee_id,employee_name,scheduled_date,scheduled_time,status,job_category,spot_status,spot_value,value,completed_at,address'

async function loadTargets() {
  const [c, cl] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('clients').select('id,company_name,is_active'),
  ])
  if (c.error) throw c.error
  return { targets: deepTargets(c.data || [], cl.data || []), clients: (cl.data || []).filter(x => x.is_active !== false) }
}

/** Everything the Deep & Spot tab needs for [from, to]. */
export async function fetchDeepSpot({ from, to }) {
  const [{ targets, clients }, j, e, sc] = await Promise.all([
    loadTargets(),
    supabase.from('jobs').select(JOB_COLS).gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
    supabase.from('employees').select('id,full_name,is_active'),
    supabase.from('spot_contracts').select('id,job_id,contract_number,contract_details').eq('is_active', true),
  ])
  if (j.error) throw j.error
  const jobs = (j.data || []).filter(x => deepSpotType(x))
  // Spot contracts: optional table (v1.0.21) → origin of each spot.
  const spotByJob = Object.fromEntries((sc.error ? [] : sc.data || []).filter(x => x.job_id).map(x => [x.job_id, x]))
  return { targets, clients, jobs, employees: e.data || [], spotByJob }
}

/**
 * Deep state per restaurant ({ [placeKey]: { lastDone, nextScheduled, nextExpected, … } }).
 * Optional `clientId` narrows it to one client (Client Report).
 */
export async function fetchDeepStatus({ clientId = null, today = tokyoToday() } = {}) {
  const { targets } = await loadTargets()
  const mine = clientId ? targets.filter(t => t.clientId === clientId) : targets
  let q = supabase.from('jobs').select(JOB_COLS).gte('scheduled_date', addDays(today, -180)).lte('scheduled_date', addDays(today, 62))
    .neq('status', 'cancelled').limit(8000)
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw error
  return deepStatusByPlace(mine, (data || []).filter(isDeepWork), { today })
}

/** Deep state of one restaurant by name (World store), or null when it has no deep contract. */
export async function fetchDeepStatusForPlace(name) {
  const all = await fetchDeepStatus()
  return all[placeKey(name)] || null
}

/**
 * "Schedule" on a missing visit: creates the job without a person, so it lands in the Pending box
 * (Schedule → Pending box) to be given to someone. Never duplicates the same place + service + day.
 * @returns {{ job: object|null, dup: boolean }}
 */
export async function scheduleMissing(target, date) {
  const title = `${target.base} — ${target.service}`
  const { data: same } = await supabase.from('jobs').select('id,title,scheduled_date').eq('scheduled_date', date).neq('status', 'cancelled')
  if ((same || []).some(j => dupKey(j.scheduled_date, j.title) === dupKey(date, title))) return { job: null, dup: true }
  const [row] = jobsToRows([{
    title, client: target.clientName, clientId: target.clientId, date, time: '09:00',
    category: 'maintenance', seq: 1, address: target.address || null, value: target.price || null,
    employeeId: null, employeeName: null,
  }])
  const { data, error } = await supabase.from('jobs').insert(row).select().single()
  if (error) throw error
  pendingChanged()
  return { job: data, dup: false }
}
