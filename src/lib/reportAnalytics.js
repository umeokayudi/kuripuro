import { dateInRange, growthPct, invoiceDate, previousEqualRange } from './period'

export function yenFmt(n) {
  return `¥${Math.round(Number(n) || 0).toLocaleString('ja-JP')}`
}

export function jobStoreName(job) {
  const loc = String(job?.location_name || job?.client_name || '').trim()
  if (loc) return loc
  return String(job?.title || '').split(' — ')[0].trim()
}

export function jobServiceType(job) {
  return String(job?.cleaning_type || job?.job_category || '').trim() || 'regular'
}

export function jobWorkDate(job) {
  const d = String(job?.scheduled_date || job?.completed_at || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

export function rangeDays(start, end) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1
}

export function bucketGrain(start, end) {
  const days = rangeDays(start, end)
  if (days <= 14) return 'day'
  if (days <= 92) return 'week'
  return 'month'
}

function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function buildTimeBuckets(start, end, grain = bucketGrain(start, end)) {
  const out = []
  if (grain === 'month') {
    let cursor = `${String(start).slice(0, 7)}-01`
    const last = String(end).slice(0, 7)
    while (cursor.slice(0, 7) <= last) {
      const [y, m] = cursor.split('-').map(Number)
      const monthLast = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      const bStart = cursor < start ? start : cursor
      const bEnd = monthLast > end ? end : monthLast
      out.push({ key: cursor.slice(0, 7), start: bStart, end: bEnd })
      const next = new Date(Date.UTC(y, m, 1))
      cursor = next.toISOString().slice(0, 10)
    }
    return out
  }
  if (grain === 'week') {
    let cursor = start
    while (cursor <= end) {
      const weekEnd = addDays(cursor, 6)
      const bEnd = weekEnd > end ? end : weekEnd
      out.push({ key: cursor, start: cursor, end: bEnd })
      cursor = addDays(bEnd, 1)
    }
    return out
  }
  let cursor = start
  while (cursor <= end) {
    out.push({ key: cursor, start: cursor, end: cursor })
    cursor = addDays(cursor, 1)
  }
  return out
}

export function isOverdueInvoice(row, today) {
  if (row?.status !== 'sent' && row?.status !== 'pending') return false
  const due = String(row.due_date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today
}

export function filterInvoices(rows, { start, end, clientId, status, today }) {
  return (rows || []).filter(row => {
    if (!dateInRange(invoiceDate(row), start, end)) return false
    if (clientId && String(row.client_id) !== String(clientId)) return false
    if (status === 'overdue') return isOverdueInvoice(row, today)
    if (status && status !== 'all' && row.status !== status) return false
    return true
  })
}

export function filterJobs(rows, { start, end, clientId, store, serviceType, jobStatus }) {
  return (rows || []).filter(row => {
    const d = jobWorkDate(row)
    if (!dateInRange(d, start, end)) return false
    if (clientId && String(row.client_id) !== String(clientId)) return false
    if (store && jobStoreName(row) !== store) return false
    if (serviceType && serviceType !== 'all' && jobServiceType(row) !== serviceType) return false
    if (jobStatus && jobStatus !== 'all' && row.status !== jobStatus) return false
    return true
  })
}

function sumStatus(rows, statuses) {
  const set = new Set(statuses)
  return (rows || []).reduce((s, r) => set.has(r.status) ? s + Number(r.total || 0) : s, 0)
}

function countStatus(rows, statuses) {
  const set = new Set(statuses)
  return (rows || []).filter(r => set.has(r.status)).length
}

export function invoiceKpis(current, previous, today) {
  const billed = sumStatus(current, ['sent', 'paid', 'pending'])
  const billedPrev = sumStatus(previous, ['sent', 'paid', 'pending'])
  const received = sumStatus(current, ['paid'])
  const receivedPrev = sumStatus(previous, ['paid'])
  const toCollect = sumStatus(current, ['sent', 'pending'])
  const open = sumStatus(current, ['draft', 'sent', 'pending'])
  const overdue = (current || []).reduce((s, r) => s + (isOverdueInvoice(r, today) ? Number(r.total || 0) : 0), 0)
  const cancelled = sumStatus(current, ['cancelled'])
  const billedN = countStatus(current, ['sent', 'paid', 'pending'])
  const ticket = billedN ? Math.round(billed / billedN) : 0
  const ticketPrevN = countStatus(previous, ['sent', 'paid', 'pending'])
  const ticketPrev = ticketPrevN ? Math.round(billedPrev / ticketPrevN) : 0
  return {
    billed,
    billedPrev,
    billedGrowth: growthPct(billed, billedPrev),
    received,
    receivedPrev,
    receivedGrowth: growthPct(received, receivedPrev),
    toCollect,
    open,
    overdue,
    cancelled,
    ticket,
    ticketGrowth: growthPct(ticket, ticketPrev),
    billedCount: billedN,
  }
}

export function jobKpis(current, previous) {
  const done = (current || []).filter(j => j.status === 'completed')
  const donePrev = (previous || []).filter(j => j.status === 'completed')
  const services = done.length
  const servicesPrev = donePrev.length
  const value = done.reduce((s, j) => s + Number(j.value || j.spot_value || 0), 0)
  return {
    services,
    servicesPrev,
    servicesGrowth: growthPct(services, servicesPrev),
    jobValue: value,
  }
}

export function statusSlices(rows, today) {
  const paid = sumStatus(rows, ['paid'])
  const pending = sumStatus(rows, ['sent', 'pending'])
  const overdue = (rows || []).reduce((s, r) => s + (isOverdueInvoice(r, today) ? Number(r.total || 0) : 0), 0)
  const pendingNet = Math.max(0, pending - overdue)
  const cancelled = sumStatus(rows, ['cancelled'])
  return [
    { key: 'received', value: paid },
    { key: 'pending', value: pendingNet },
    { key: 'overdue', value: overdue },
    { key: 'cancelled', value: cancelled },
  ]
}

export function seriesFromBuckets(rows, buckets, pickDate, pickValue) {
  return buckets.map(b => {
    const inB = (rows || []).filter(r => dateInRange(pickDate(r), b.start, b.end))
    const value = inB.reduce((s, r) => s + pickValue(r), 0)
    return { ...b, value, count: inB.length }
  })
}

export function revenueSeries(invoices, buckets) {
  const billed = (invoices || []).filter(r => r.status === 'sent' || r.status === 'paid' || r.status === 'pending')
  return seriesFromBuckets(billed, buckets, invoiceDate, r => Number(r.total || 0))
}

export function jobSeries(jobs, buckets) {
  const done = (jobs || []).filter(j => j.status === 'completed')
  return seriesFromBuckets(done, buckets, jobWorkDate, () => 1)
}

export function rankClients(invoices, clients, limit = 8) {
  const names = Object.fromEntries((clients || []).map(c => [c.id, c.company_name]))
  const map = new Map()
  for (const row of invoices || []) {
    if (row.status !== 'sent' && row.status !== 'paid' && row.status !== 'pending') continue
    const id = row.client_id || row.client_name || '—'
    const cur = map.get(id) || { id, name: names[row.client_id] || row.client_name || '—', billed: 0, count: 0 }
    cur.billed += Number(row.total || 0)
    cur.count += 1
    map.set(id, cur)
  }
  return [...map.values()]
    .sort((a, b) => b.billed - a.billed)
    .slice(0, limit)
    .map(r => ({ ...r, value: r.billed }))
}

export function uniqueStores(jobs) {
  return [...new Set((jobs || []).map(jobStoreName).filter(Boolean))].sort()
}

export function uniqueServiceTypes(jobs) {
  return [...new Set((jobs || []).map(jobServiceType).filter(Boolean))].sort()
}

export function clientInsight(clientId, invoices, jobs, clients, range) {
  const client = (clients || []).find(c => String(c.id) === String(clientId))
  const inv = (invoices || []).filter(r => String(r.client_id) === String(clientId))
  const jb = (jobs || []).filter(j => String(j.client_id) === String(clientId))
  const billed = sumStatus(inv, ['sent', 'paid', 'pending'])
  const received = sumStatus(inv, ['paid'])
  const open = sumStatus(inv, ['draft', 'sent', 'pending'])
  const done = jb.filter(j => j.status === 'completed')
  const ticketN = countStatus(inv, ['sent', 'paid', 'pending'])
  const monthly = range?.start && range?.end
    ? revenueSeries(inv, buildTimeBuckets(range.start, range.end, 'month'))
    : []
  return {
    client,
    name: client?.company_name || inv[0]?.client_name || '—',
    billed,
    received,
    open,
    services: done.length,
    ticket: ticketN ? Math.round(billed / ticketN) : 0,
    monthly,
    invoices: inv.slice().sort((a, b) => String(invoiceDate(b)).localeCompare(invoiceDate(a))).slice(0, 8),
    jobs: done.slice().sort((a, b) => String(jobWorkDate(b)).localeCompare(jobWorkDate(a))).slice(0, 8),
  }
}

export function previousWindow(start, end) {
  return previousEqualRange({ start, end })
}
