/** Salesperson portal: hashed login, own-data scope, meishi-required approaches. */

export const SALESPERSON_TABLES = ['salespeople', 'sales_day_reports', 'sales_field_approaches']

export const FOLLOWUP_STATUSES = ['open', 'done', 'lost']

export function salespersonSession(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: 'salesperson',
    phone: row.phone || '',
  }
}

export async function hashSalespersonSecret(email, password) {
  const payload = `${String(email || '').trim().toLowerCase()}|${String(password || '')}`
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto is required to hash salesperson passwords')
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function isSalespersonSchemaMissing(error) {
  const msg = String(error?.message || '').toLowerCase()
  return error?.code === 'PGRST205'
    || msg.includes('salespeople')
    || msg.includes('sales_day_reports')
    || msg.includes('sales_field_approaches')
}

export function emptyDayReport(today) {
  return {
    work_date: today || '',
    hours_worked: '',
    started_at: '',
    ended_at: '',
    areas: '',
    summary: '',
  }
}

export function emptyApproach(today) {
  return {
    work_date: today || '',
    place: '',
    company_name: '',
    site_name: '',
    contact_name: '',
    contact_title: '',
    contact_phone: '',
    contact_email: '',
    meishi_photo_url: '',
    notes: '',
    followup_note: '',
    followup_date: '',
    followup_status: 'open',
    outcome: '',
  }
}

export function reportIsValid(row) {
  const hours = Number(row?.hours_worked)
  return Boolean(row?.work_date) && hours > 0 && String(row?.summary || '').trim().length >= 8
}

export function approachIsValid(row) {
  return Boolean(
    row?.work_date
    && String(row?.place || '').trim()
    && String(row?.meishi_photo_url || '').trim()
  )
}

export function ownRowsOnly(rows, salespersonId) {
  if (!salespersonId) return []
  return (rows || []).filter(r => r.salesperson_id === salespersonId)
}

export function hoursInMonth(reports, yyyymm) {
  const prefix = String(yyyymm || '').slice(0, 7)
  return (reports || [])
    .filter(r => String(r.work_date || '').startsWith(prefix))
    .reduce((sum, r) => sum + (Number(r.hours_worked) || 0), 0)
}

export function openFollowups(approaches, today) {
  return (approaches || []).filter(a => {
    if (a.followup_status && a.followup_status !== 'open') return false
    return Boolean(a.followup_date || a.followup_note)
  }).sort((a, b) => String(a.followup_date || '9999').localeCompare(String(b.followup_date || '9999')))
    .map(a => ({ ...a, overdue: Boolean(a.followup_date && today && a.followup_date < today) }))
}

export function reportWritePayload(form, salespersonId) {
  return {
    salesperson_id: salespersonId,
    work_date: form.work_date,
    hours_worked: Number(form.hours_worked) || 0,
    started_at: form.started_at || null,
    ended_at: form.ended_at || null,
    areas: String(form.areas || '').trim(),
    summary: String(form.summary || '').trim(),
    updated_at: new Date().toISOString(),
  }
}

export function approachWritePayload(form, salespersonId, dayReportId = null) {
  return {
    salesperson_id: salespersonId,
    day_report_id: dayReportId || null,
    work_date: form.work_date,
    place: String(form.place || '').trim(),
    company_name: String(form.company_name || '').trim(),
    site_name: String(form.site_name || '').trim(),
    contact_name: String(form.contact_name || '').trim(),
    contact_title: String(form.contact_title || '').trim(),
    contact_phone: String(form.contact_phone || '').trim(),
    contact_email: String(form.contact_email || '').trim(),
    meishi_photo_url: String(form.meishi_photo_url || '').trim(),
    notes: String(form.notes || '').trim(),
    followup_note: String(form.followup_note || '').trim(),
    followup_date: form.followup_date || null,
    followup_status: form.followup_status || 'open',
    outcome: String(form.outcome || '').trim(),
  }
}

export function groupApproachesByDate(approaches) {
  const map = {}
  for (const row of approaches || []) {
    const d = row.work_date || '—'
    if (!map[d]) map[d] = []
    map[d].push(row)
  }
  return map
}
