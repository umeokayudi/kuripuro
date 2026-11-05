// v1.0.159 · "Agendar depois" storage + data for the suggested date. No SQL: one small JSON file in
// the public service-photos bucket (same approach as the 作業報告書), quote-flow/later.json =
// { '<quote ref>': { until, note, by, at } }.
import { supabase } from './supabase'
import { storagePublicUrl } from './workReport'
import { geocodeAddress } from './geocode'
import { suggestQuoteDates } from './quoteSuggest'

const BUCKET = 'service-photos'
const LATER_FILE = 'quote-flow/later.json'

/** Every "agendar depois" mark ({} when none or unreadable). */
export async function loadQuoteLaterMap() {
  try {
    const r = await fetch(`${storagePublicUrl(LATER_FILE)}?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? (await r.json()) || {} : {}
  } catch { return {} }
}

async function writeMap(map) {
  const body = new Blob([JSON.stringify(map)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(LATER_FILE, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

/** Marks (later = { until, note, by }) or clears (later = null) one quote. */
export async function setQuoteLater(ref, later) {
  const map = await loadQuoteLaterMap()
  if (later) map[ref] = { ...later, at: new Date().toISOString() }
  else delete map[ref]
  // marks of quotes already booked/finished are cleaned by the tracker (book clears its own)
  await writeMap(map)
  try { window.dispatchEvent(new Event('kp:quote-flow-changed')) } catch { /* tests */ }
  return map[ref] || null
}

/**
 * Suggested dates for one accepted quote (does not change anything).
 * quote = quoteFromRequest/quoteFromMitsumori shape; address = the form's address.
 */
export async function fetchQuoteSuggestions(quote, { today, address = '', employees = [], days = 14 } = {}) {
  const to = new Date(`${today}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + days)
  const end = to.toISOString().slice(0, 10)
  const [jobs, avail] = await Promise.all([
    supabase.from('jobs').select('id,title,client_id,client_name,employee_id,employee_name,scheduled_date,scheduled_time,status,spot_status,area,gps_lat,gps_lng')
      .gt('scheduled_date', today).lte('scheduled_date', end).neq('status', 'cancelled').limit(2000),
    supabase.from('employee_availability').select('employee_id,date,kind').gt('date', today).lte('date', end),
  ])
  if (jobs.error) throw jobs.error
  const offDays = new Set((avail.data || []).filter(a => a.kind === 'off').map(a => `${a.employee_id}|${a.date}`))
  let coords = null
  const addr = address || quote.address || ''
  if (addr) { const c = await geocodeAddress(addr).catch(() => null); if (c?.lat != null) coords = c }
  return suggestQuoteDates({
    target: { place: quote.place || quote.client_name, client_id: quote.client_id, client_name: quote.client_name, coords },
    jobs: jobs.data || [], offDays, employees, today, preferred: quote.preferred_date || '', days,
  })
}
