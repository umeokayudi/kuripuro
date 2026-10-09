// Follow-up alerts, contact history and monthly goals for the sales CRM.
// Pure functions so the seller portal, the admin page and tests share one rule set.

export const CONTACT_CHANNELS = ['visit', 'phone', 'line', 'email', 'meeting', 'other']
export const GOAL_KEYS = ['approaches', 'contacts', 'leads', 'quotes', 'contracts', 'revenue']
export const STALE_AFTER_DAYS = 14
export const SOON_WITHIN_DAYS = 3

const CLOSED = new Set(['won', 'lost'])

function toDay(value) {
  return String(value || '').slice(0, 10)
}

export function daysBetween(from, to) {
  const a = Date.parse(`${toDay(from)}T00:00:00Z`)
  const b = Date.parse(`${toDay(to)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86_400_000)
}

export function addDaysIso(day, n) {
  const t = Date.parse(`${toDay(day)}T00:00:00Z`)
  if (!Number.isFinite(t)) return ''
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

export function lastContactDate(lead, touchpoints = []) {
  let latest = toDay(lead?.last_contact_date || lead?.first_contact_date)
  for (const row of touchpoints) {
    if (row.lead_id !== lead?.id) continue
    const day = toDay(row.happened_at)
    if (day && day > latest) latest = day
  }
  return latest
}

/**
 * Follow-up state of one open lead.
 * overdue: next date already passed · today · soon: within 3 days · scheduled: later
 * missing: no next date set · stale: no next date and no contact for 14+ days
 */
export function followupStatus(lead, today, touchpoints = []) {
  if (!lead || CLOSED.has(lead.stage)) return null
  const last = lastContactDate(lead, touchpoints)
  const sinceContact = last ? daysBetween(last, today) : null
  const next = toDay(lead.next_followup_date)
  if (next) {
    const diff = daysBetween(today, next)
    if (diff < 0) return { status: 'overdue', days: -diff, next, last, sinceContact }
    if (diff === 0) return { status: 'today', days: 0, next, last, sinceContact }
    if (diff <= SOON_WITHIN_DAYS) return { status: 'soon', days: diff, next, last, sinceContact }
    return { status: 'scheduled', days: diff, next, last, sinceContact }
  }
  if (sinceContact != null && sinceContact >= STALE_AFTER_DAYS) return { status: 'stale', days: sinceContact, next: '', last, sinceContact }
  return { status: 'missing', days: sinceContact ?? 0, next: '', last, sinceContact }
}

const STATUS_ORDER = { overdue: 0, today: 1, stale: 2, soon: 3, missing: 4, scheduled: 5 }

export function followupQueue(leads, today, touchpoints = []) {
  return (leads || [])
    .map(lead => ({ lead, info: followupStatus(lead, today, touchpoints) }))
    .filter(row => row.info)
    .sort((a, b) => (STATUS_ORDER[a.info.status] - STATUS_ORDER[b.info.status])
      || (a.info.status === 'overdue' ? b.info.days - a.info.days : a.info.days - b.info.days)
      || String(a.lead.company_name || '').localeCompare(String(b.lead.company_name || '')))
}

export function alertCounts(queue) {
  const counts = { overdue: 0, today: 0, soon: 0, stale: 0, missing: 0, scheduled: 0 }
  for (const row of queue || []) counts[row.info.status] += 1
  counts.needsAction = counts.overdue + counts.today + counts.stale
  return counts
}

export function contactsForLead(leadId, touchpoints = []) {
  return (touchpoints || [])
    .filter(row => row.lead_id === leadId)
    .sort((a, b) => toDay(b.happened_at).localeCompare(toDay(a.happened_at)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

export function monthOf(day) {
  return toDay(day).slice(0, 7)
}

/** Real results for one seller in one month (YYYY-MM). */
export function monthResults(data, salespersonId, month) {
  const mine = row => !salespersonId || row.salesperson_id === salespersonId
  const inMonth = value => monthOf(value) === month
  const contracts = (data?.contracts || []).filter(row => mine(row) && ['active', 'approved'].includes(row.status) && inMonth(row.reviewed_at || row.submitted_at || row.created_at))
  return {
    approaches: (data?.approaches || []).filter(row => mine(row) && inMonth(row.work_date)).length,
    contacts: (data?.touchpoints || []).filter(row => mine(row) && inMonth(row.happened_at)).length,
    leads: (data?.leads || []).filter(row => mine(row) && inMonth(row.first_contact_date || row.created_at)).length,
    quotes: (data?.quotes || []).filter(row => mine(row) && inMonth(row.created_at)).length,
    contracts: contracts.length,
    revenue: contracts.reduce((sum, row) => sum + Number(row.client_monthly_total || 0), 0),
  }
}

export function goalFor(goals, salespersonId, month) {
  return (goals || []).find(row => row.salesperson_id === salespersonId && row.period_month === month) || null
}

export function goalProgress(actual, target) {
  const goal = Number(target || 0)
  const value = Number(actual || 0)
  if (!goal) return { goal: 0, value, percent: 0, done: false }
  return { goal, value, percent: Math.min(100, Math.round(value / goal * 100)), done: value >= goal }
}

/** Share of the month already gone, so a seller can see if they are on pace. */
export function monthElapsedPercent(today) {
  const [y, m, d] = toDay(today).split('-').map(Number)
  if (!y || !m || !d) return 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Math.round(d / daysInMonth * 100)
}
