import { isOverdueAssignedJob, OVERDUE_SKIP_HOURS } from './jobOverdue'
import { tokyoToday } from './dates'

export const SPLIT_TONE = {
  done: '#4ade80',
  pending: '#60a5fa',
  progress: '#f59e0b',
  assigned: '#93c5fd',
  late: '#f87171',
  missing: '#fbbf24',
}

export function roundPct(n, total) {
  if (!total) return 0
  return Math.round((Number(n) || 0) / total * 100)
}

export function splitFromCounts(parts, totalOverride) {
  const total = totalOverride ?? parts.reduce((s, p) => s + (Number(p.count) || 0), 0)
  return {
    total,
    parts: (parts || []).map(p => {
      const count = Number(p.count) || 0
      return {
        key: p.key,
        count,
        color: p.color || SPLIT_TONE[p.key] || '#94a3b8',
        pct: roundPct(count, total),
        share: total ? (count / total) * 100 : 0,
      }
    }),
  }
}

export function withLabels(split, labels = {}) {
  return {
    ...split,
    parts: (split?.parts || []).map(p => ({
      ...p,
      label: labels[p.key] || p.label || p.key,
    })),
  }
}

export function partCount(split, key) {
  return split?.parts?.find(p => p.key === key)?.count || 0
}

export function partPct(split, key) {
  return split?.parts?.find(p => p.key === key)?.pct || 0
}

/** Visit-level deep-clean mix: done / on-track / overdue / not generated. */
export function deepCleanVisitSplit(byLocation, today = tokyoToday()) {
  const todayStr = String(today || tokyoToday()).slice(0, 10)
  const now = new Date(`${todayStr}T18:00:00+09:00`)
  let done = 0
  let pending = 0
  let late = 0
  let missing = 0
  let expected = 0

  Object.values(byLocation || {}).forEach(data => {
    for (const date of (data.expectedDates || [])) {
      expected += 1
      const job = data.byDate?.[date]
        || (data.jobs || []).find(j => j.scheduled_date === date)
        || null
      if (job?.status === 'completed') done += 1
      else if (job && isOverdueAssignedJob(job, OVERDUE_SKIP_HOURS, now)) late += 1
      else if (job?.status === 'in_progress' || job?.status === 'assigned') pending += 1
      else missing += 1
    }
  })

  return splitFromCounts([
    { key: 'done', count: done, color: SPLIT_TONE.done },
    { key: 'pending', count: pending, color: SPLIT_TONE.pending },
    { key: 'late', count: late, color: SPLIT_TONE.late },
    { key: 'missing', count: missing, color: SPLIT_TONE.missing },
  ], expected)
}

/** Per-store stacked mix from storeProgressRows(). */
export function storeRowSplit(row) {
  const done = row?.completed || 0
  const late = row?.late || 0
  const missing = row?.missing || 0
  const open = row?.open ?? Math.max(0, (row?.pending || 0) - late)
  return splitFromCounts([
    { key: 'done', count: done, color: SPLIT_TONE.done },
    { key: 'pending', count: open, color: SPLIT_TONE.pending },
    { key: 'late', count: late, color: SPLIT_TONE.late },
    { key: 'missing', count: missing, color: SPLIT_TONE.missing },
  ], row?.expected)
}

/** All jobs in a list: done / in progress / scheduled / overdue. */
export function jobMixSplit(jobs, now) {
  let done = 0
  let progress = 0
  let assigned = 0
  let late = 0

  ;(jobs || []).forEach(job => {
    if (job?.status === 'completed') done += 1
    else if (job?.status === 'in_progress') progress += 1
    else if (job?.status === 'assigned' && isOverdueAssignedJob(job, OVERDUE_SKIP_HOURS, now)) late += 1
    else if (job?.status === 'assigned') assigned += 1
  })

  return splitFromCounts([
    { key: 'done', count: done, color: SPLIT_TONE.done },
    { key: 'progress', count: progress, color: SPLIT_TONE.progress },
    { key: 'assigned', count: assigned, color: SPLIT_TONE.assigned },
    { key: 'late', count: late, color: SPLIT_TONE.late },
  ])
}

export function splitAria(split, headline) {
  const bits = (split?.parts || [])
    .filter(p => p.count > 0)
    .map(p => `${p.label || p.key} ${p.count} (${p.pct}%)`)
  return [headline, bits.join(', ')].filter(Boolean).join(' — ')
}
