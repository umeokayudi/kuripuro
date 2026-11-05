#!/usr/bin/env node
// v1.0.160 · accepted quote: suggested dates (route / map area) + "Agendar depois" in the bell.
import { suggestQuoteDates, storeKey, laterOptions, isLaterActive, reasonText } from '../src/lib/quoteSuggest.js'
import { buildBellQueue } from '../src/lib/bellQueue.js'

const assert = (c, m) => { if (!c) throw new Error(m) }
const today = '2026-11-05' // Thursday
const OTP = 'otp'
const emps = [{ id: 'g', full_name: 'Guilherme' }, { id: 'b', full_name: 'Gabriel' }, { id: 'l', full_name: 'Leticia' }]
const IB = { gps_lat: 35.7000, gps_lng: 139.7000 }
const NEAR = { gps_lat: 35.7050, gps_lng: 139.7000 } // ~550 m
const FAR = { gps_lat: 35.9000, gps_lng: 139.9000 }
const jobs = [
  { id: 'a', title: 'Ibushio — Basic Cleaning', client_id: OTP, employee_id: 'g', scheduled_date: '2026-11-09', scheduled_time: '00:30', status: 'assigned', area: 'Shibuya', ...IB },
  { id: 'b', title: 'Kodama — Basic Cleaning', client_id: OTP, employee_id: 'b', scheduled_date: '2026-11-07', scheduled_time: '01:00', status: 'assigned', area: 'Shibuya', ...NEAR },
  { id: 'c', title: 'Far — Basic', client_id: 'x', employee_id: 'l', scheduled_date: '2026-11-06', scheduled_time: '09:00', status: 'assigned', area: 'Chiba', ...FAR },
  { id: 'd', title: 'Ibushio — Basic Cleaning', client_id: OTP, employee_id: 'g', scheduled_date: '2026-11-12', scheduled_time: '00:30', status: 'cancelled', ...IB },
]
assert(storeKey('Ibushio - Deep Clean') === 'ibushio', 'store key of quote place')
assert(storeKey('Ibushio — Basic Cleaning') === 'ibushio', 'store key of job title')
const sg = suggestQuoteDates({ target: { place: 'Ibushio - Deep Clean', client_id: OTP }, jobs, employees: emps, today })
assert(sg.length === 3, `3 suggestions (got ${sg.length})`)
assert(sg[0].date === '2026-11-09' && sg[0].employee_id === 'g', `best = day Guilherme is already at Ibushio (got ${sg[0].date} ${sg[0].employee_id})`)
assert(sg[0].time === '02:30', `time right after the route job (got ${sg[0].time})`)
assert(sg[0].reasons.some(r => r.k === 'same_store'), 'reason same store')
assert(sg[1].date === '2026-11-07' && sg[1].employee_id === 'b' && sg[1].reasons.some(r => r.k === 'near'), `second = Gabriel nearby (got ${sg[1].date} ${sg[1].employee_id})`)
assert(new Set(sg.map(s => s.date)).size === 3, 'one suggestion per day')
assert(!sg.some(s => s.date === '2026-11-12' && s.reasons.some(r => r.k === 'same_store')), 'cancelled job is not an anchor')
// day off removes that person/day
const off = suggestQuoteDates({ target: { place: 'Ibushio' }, jobs, employees: emps, today, offDays: new Set(['g|2026-11-09']) })
assert(!off.some(s => s.date === '2026-11-09' && s.employee_id === 'g'), 'day off respected')
// preferred date
const pref = suggestQuoteDates({ target: { place: 'Nowhere' }, jobs: [], employees: emps, today, preferred: '2026-11-10' })
assert(pref[0].date === '2026-11-10', 'client preferred day wins when no route')
assert(reasonText({ k: 'near', m: 550, store: 'Kodama' }, (en, ja, pt) => pt) === 'Kodama fica a 550 m', 'reason text')
assert(suggestQuoteDates({ target: {}, jobs, employees: [], today }).length === 0, 'no team → no suggestion')
// later
const opts = laterOptions(today)
assert(opts.find(o => o.key === 'tomorrow').date === '2026-11-06' && opts.find(o => o.key === 'monday').date === '2026-11-09', 'later options')
assert(isLaterActive({ until: '2026-11-06' }, today) && !isLaterActive({ until: today }, today) && !isLaterActive(null, today), 'later active until the day')
// bell: snoozed → own group, not counted; due → counted
const toBook = [
  { id: 'qf-book-1', kind: 'request', ref_id: '1', name: 'On The Planet · Ibushio', later: { until: '2026-11-09' }, snoozed: true },
  { id: 'qf-book-2:r2026-11-05', kind: 'request', ref_id: '2', name: 'Bacana', later: { until: '2026-11-05' }, snoozed: false },
]
const q = buildBellQueue({ toBook, today })
assert(q.count === 1, `only the due one counts (got ${q.count})`)
assert(q.groups.find(g => g.key === 'later')?.items.length === 1 && q.groups.find(g => g.key === 'later').notCounted, 'snoozed in "later" group')
console.log('quote later + suggested dates: OK')
