// Employee side: an approved / rejected day-off request shows once in the bell,
// then counts as seen (remembered per employee in this browser).

const storageKey = (employeeId) => `kp_timeoff_seen_${employeeId}`

/** A new decision on the same day (e.g. rejected → approved) is a new notice. */
export const noticeKey = (row) => `${row.id}:${row.status}`

export const isDecided = (row) => row?.status === 'approved' || row?.status === 'rejected'

/** Decided requests the employee has not seen yet, nearest day first. */
export function unseenDecisions(rows, seen) {
  return (rows || []).filter(r => isDecided(r) && !seen.has(noticeKey(r)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/** Requests for the "My day-off requests" list: upcoming ones, plus pending ones from the past. */
export function timeOffListRows(rows, today) {
  return (rows || []).filter(r => r.date >= today || r.status === 'pending')
}

export function loadSeen(employeeId) {
  try {
    const list = JSON.parse(localStorage.getItem(storageKey(employeeId)) || '[]')
    return new Set(Array.isArray(list) ? list : [])
  } catch { return new Set() }
}

/** Marks these rows as seen; keeps only keys still in `rows` so storage stays small. */
export function markSeen(employeeId, seen, rows) {
  const next = new Set(seen)
  for (const r of rows || []) if (isDecided(r)) next.add(noticeKey(r))
  const live = new Set((rows || []).map(noticeKey))
  const kept = [...next].filter(k => live.has(k))
  try { localStorage.setItem(storageKey(employeeId), JSON.stringify(kept)) } catch { /* private mode */ }
  return new Set(kept)
}
