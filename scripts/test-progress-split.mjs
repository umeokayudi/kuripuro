#!/usr/bin/env node
import {
  deepCleanVisitSplit,
  jobMixSplit,
  partCount,
  partPct,
  roundPct,
  splitFromCounts,
  storeRowSplit,
  withLabels,
} from '../src/lib/progressSplit.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Progress split (no pie) ===\n')

assert(roundPct(1, 4) === 25, '25%')
assert(roundPct(0, 0) === 0, 'empty pct')
assert(roundPct(2, 3) === 67, 'rounds')

const empty = splitFromCounts([
  { key: 'done', count: 0 },
  { key: 'late', count: 0 },
])
assert(empty.total === 0, 'empty total')
assert(empty.parts.every(p => p.pct === 0 && p.share === 0), 'empty shares')

const labeled = withLabels(splitFromCounts([
  { key: 'done', count: 3, color: '#4ade80' },
  { key: 'late', count: 1, color: '#f87171' },
]), { done: 'Feito', late: 'Atrasado' })
assert(labeled.total === 4, 'labeled total')
assert(partCount(labeled, 'done') === 3, 'part count')
assert(partPct(labeled, 'late') === 25, 'late 25%')
assert(labeled.parts[0].label === 'Feito', 'label applied')
assert(labeled.parts[0].share === 75, 'share 75')

const byLocation = {
  Kodama: {
    expectedDates: ['2020-01-07', '2020-01-14', '2099-01-06', '2099-01-13'],
    byDate: {
      '2020-01-07': { status: 'completed', scheduled_date: '2020-01-07' },
      '2020-01-14': { status: 'assigned', scheduled_date: '2020-01-14', scheduled_time: '09:00' },
      '2099-01-06': { status: 'assigned', scheduled_date: '2099-01-06', scheduled_time: '09:00' },
      '2099-01-13': null,
    },
    jobs: [],
  },
}

const visits = deepCleanVisitSplit(byLocation, '2026-09-22')
assert(visits.total === 4, `visit total ${visits.total}`)
assert(partCount(visits, 'done') === 1, 'one done visit')
assert(partCount(visits, 'late') === 1, 'past assigned is late')
assert(partCount(visits, 'pending') === 1, 'future assigned is on track')
assert(partCount(visits, 'missing') === 1, 'empty slot is missing')
assert(partPct(visits, 'done') === 25, 'visit done 25%')

const row = storeRowSplit({
  expected: 4,
  completed: 1,
  pending: 2,
  late: 1,
  missing: 1,
})
assert(partCount(row, 'done') === 1, 'store done')
assert(partCount(row, 'pending') === 1, 'store open = pending - late')
assert(partCount(row, 'late') === 1, 'store late')
assert(partCount(row, 'missing') === 1, 'store missing')
assert(row.total === 4, 'store expected denom')

const mix = jobMixSplit([
  { status: 'completed', scheduled_date: '2020-01-01' },
  { status: 'in_progress', scheduled_date: '2026-09-22' },
  { status: 'assigned', scheduled_date: '2099-06-01', scheduled_time: '09:00' },
  { status: 'assigned', scheduled_date: '2020-01-02', scheduled_time: '09:00' },
  { status: 'cancelled', scheduled_date: '2020-01-03' },
])
assert(partCount(mix, 'done') === 1, 'mix done')
assert(partCount(mix, 'progress') === 1, 'mix in progress')
assert(partCount(mix, 'assigned') === 1, 'future assigned')
assert(partCount(mix, 'late') === 1, 'past assigned overdue')
assert(mix.total === 4, 'cancelled jobs skipped from mix')

console.log('ok')
