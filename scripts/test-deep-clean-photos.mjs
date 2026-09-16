#!/usr/bin/env node
/**
 * Unit tests: deep cleaning + report photo merge
 * Run: node scripts/test-deep-clean-photos.mjs
 */
import {
  buildJobTitle,
  buildDeepCleanDescription,
  calculateJobValue,
  getCleaningType,
  jobMatchesLocationAndType,
  ALL_DEEP_COMPONENT_IDS,
  buildDeepCleanProgress,
  buildDeepCleanProgressForUser,
  filterDeepCleanProgressByLocation,
  storeProgressRows,
  buildDaySummaries,
  monthCalendarCells,
  daySummaryState,
  tuesdaySlotInfo,
} from '../src/lib/cleaningType.js'
import { SCHEDULE_CLIENTS } from '../src/lib/serviceCatalog.js'
import { buildAddServiceOptions } from '../src/lib/employeeAddJob.js'
import { jobToServiceReport, mergeReportWithJob, reportNeedsPhotoSync } from '../src/lib/jobReport.js'
import { viewablePhotoUrl, isStoragePhotoUrl } from '../src/lib/photoUrl.js'
import { isOtpDeepOnlyLocation, otpBasicScheduleLocations, otpDeepOnlyLocations } from '../src/lib/serviceCatalog.js'
import { expectedDeepCleanDatesForLocation, weekdaysInMonth, isDeepCleanAllowedOnDate } from '../src/lib/cleaningType.js'
import { monthBounds } from '../src/lib/dates.js'
import { generateServiceReportPdf, reportPdfFilename, resolvePdfPhotoUrl, fitRect, photoDims } from '../src/lib/generatePDF.js'
import { buildMonthSchedule, buildMissingDeepCleanJobs } from '../src/lib/scheduleGenerator.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testCleaningType() {
  const loc = 'Ibushio'
  const basicTitle = buildJobTitle(loc, { cleaningType: 'basic' })
  assert(basicTitle === 'Ibushio — Basic Cleaning', `basic title: ${basicTitle}`)

  const deepAll = buildJobTitle(loc, { cleaningType: 'deep', deepComponents: ALL_DEEP_COMPONENT_IDS })
  assert(deepAll === 'Ibushio — Deep Clean', `deep all: ${deepAll}`)

  const deepPartial = buildJobTitle(loc, {
    cleaningType: 'deep',
    deepComponents: ['grease_trap', 'range_hood'],
  })
  assert(deepPartial.includes('Grease Trap'), `partial: ${deepPartial}`)
  assert(deepPartial.includes('Range Hood'), `partial: ${deepPartial}`)

  const desc = buildDeepCleanDescription({
    deepComponents: ['ac', 'grating'],
    baseNotes: 'Key box: 0315',
  })
  assert(desc.includes('AC Cleaning'), desc)
  assert(desc.includes('Grating'), desc)
  assert(desc.includes('Key box'), desc)

  const fullValue = calculateJobValue({ cleaningType: 'deep', deepComponents: ALL_DEEP_COMPONENT_IDS, deepPrice: 5000 })
  assert(fullValue === 5000, `full value: ${fullValue}`)

  const partialValue = calculateJobValue({ cleaningType: 'deep', deepComponents: ['ac'], deepPrice: 5000 })
  assert(partialValue === 1000, `partial value: ${partialValue}`)

  const basicJob = { title: 'Ibushio — Basic Cleaning' }
  const deepJob = { title: 'Ibushio — Deep Clean' }
  assert(getCleaningType(basicJob) === 'basic', 'basic detect')
  assert(getCleaningType(deepJob) === 'deep', 'deep detect')
  assert(getCleaningType({ title: 'Ibushio — Grease Trap', job_category: 'maintenance' }) === 'basic', 'maintenance not deep')
  assert(getCleaningType({ title: 'Ibushio — Stove + Range Hood + Grating + AC Cleaning' }) === 'basic', 'rest-day block not deep')
  assert(getCleaningType({ title: 'Ibushio — Deep Clean (Grease Trap)' }) === 'deep', 'partial deep still deep')
  assert(jobMatchesLocationAndType(basicJob, 'Ibushio', 'basic'), 'basic match')
  assert(!jobMatchesLocationAndType(basicJob, 'Ibushio', 'deep'), 'basic not deep')
  assert(jobMatchesLocationAndType(deepJob, 'Ibushio', 'deep'), 'deep match')
  assert(jobMatchesLocationAndType(basicJob, 'Ibushio', 'basic') && jobMatchesLocationAndType(deepJob, 'Ibushio', 'deep'), 'same loc both types')
}

function testAddServiceOptions() {
  const locations = [
    { name: 'Ibushio', group: 'OTP', clientId: 'x', clientName: 'On The Planet', pricePerVisit: 1923, deepCleanPrice: 5000 },
  ]
  const employeeId = 'emp-1'
  const todayJobs = [
    { id: 'j1', title: 'Ibushio — Basic Cleaning', employee_id: employeeId, status: 'assigned', started_at: null },
  ]

  const basicOpts = buildAddServiceOptions(locations, todayJobs, employeeId, 'basic')
  assert(basicOpts[0].state === 'mine', `basic should be mine: ${basicOpts[0].state}`)

  const deepOpts = buildAddServiceOptions(locations, todayJobs, employeeId, 'deep')
  assert(deepOpts[0].state === 'available', `deep should be available: ${deepOpts[0].state}`)

  const deepMine = [
    ...todayJobs,
    { id: 'j2', title: 'Ibushio — Deep Clean', employee_id: employeeId, status: 'assigned', started_at: null },
  ]
  const deepOpts2 = buildAddServiceOptions(locations, deepMine, employeeId, 'deep')
  assert(deepOpts2[0].state === 'mine', `deep mine: ${deepOpts2[0].state}`)
}

function testViewablePhotoUrl() {
  const path = 'jobs/job-1/end_0.jpg'
  assert(isStoragePhotoUrl(path), 'storage path detect')
  const proxied = viewablePhotoUrl(path)
  assert(proxied.startsWith('/api/photo?url='), `proxy url: ${proxied}`)
  assert(viewablePhotoUrl('data:image/png;base64,x') === 'data:image/png;base64,x', 'data url passthrough')
  assert(viewablePhotoUrl(null) === null, 'null safe')
}

function testReportPhotos() {
  const job = {
    id: 'job-1',
    status: 'completed',
    title: 'Ibushio — Basic Cleaning',
    employee_id: 'e1',
    employee_name: 'André',
    scheduled_date: '2026-08-26',
    photo_start_url: 'jobs/job-1/start_0.jpg',
    photo_end_url: 'jobs/job-1/end_0.jpg',
    started_at: '2026-08-26T01:00:00Z',
    completed_at: '2026-08-26T01:30:00Z',
    value: 1923,
  }

  const report = jobToServiceReport(job)
  assert(report.photo_before_url === 'jobs/job-1/start_0.jpg', 'before in report')
  assert(report.photo_after_url === 'jobs/job-1/end_0.jpg', 'after in report')

  const stale = { job_id: 'job-1', employee_name: 'André', photo_before_url: null, photo_after_url: null }
  const merged = mergeReportWithJob(stale, job)
  assert(merged.photo_before_url === 'jobs/job-1/start_0.jpg', 'merged before')
  assert(merged.photo_after_url === 'jobs/job-1/end_0.jpg', 'merged after')
  assert(reportNeedsPhotoSync(stale, job), 'needs sync')
  assert(!reportNeedsPhotoSync(merged, job), 'no sync after merge')
}

function testOtpDeepOnlyContracts() {
  assert(isOtpDeepOnlyLocation('Ibushio'), 'Ibushio deep-only')
  assert(isOtpDeepOnlyLocation('Nyu Ibushio'), 'Nyu Ibushio deep-only')
  assert(isOtpDeepOnlyLocation('Horumon no Manmosu'), 'Horumon deep-only')
  assert(isOtpDeepOnlyLocation('Yakiniku Otoko Manmosu'), 'Manmosu deep-only')
  assert(!isOtpDeepOnlyLocation('Kodama Shinbashi'), 'Kodama still basic')

  const basicLocs = otpBasicScheduleLocations().map(l => l.name)
  assert(!basicLocs.includes('Ibushio'), 'Ibushio excluded from basic schedule')
  assert(basicLocs.includes('Kodama Shinbashi'), 'Kodama in basic schedule')

  const deepOnly = otpDeepOnlyLocations()
  assert(deepOnly.length === 4, `deep-only count ${deepOnly.length}`)
  assert(deepOnly[0].deepCleanDays?.includes(1), 'Mon deep clean')
  assert(deepOnly[0].deepCleanDays?.includes(3), 'Wed deep clean')
  assert(deepOnly.find(l => l.name === 'Ibushio')?.restDay === 0, 'Ibushio rest Sunday')
  assert(deepOnly.find(l => l.name === 'Nyu Ibushio')?.restDay === 1, 'Nyu Ibushio rest Monday')

  const sepMondays = weekdaysInMonth('2026-09', [1])
  assert(sepMondays[0] === '2026-09-07', `Sep 2026 first Monday (local): ${sepMondays[0]}`)

  const sepDates = expectedDeepCleanDatesForLocation('Ibushio', '2026-09')
  assert(sepDates.length >= 8, `Ibushio Mon+Wed in Sep: ${sepDates.length}`)
  const kodamaDates = expectedDeepCleanDatesForLocation('Kodama Shinbashi', '2026-09')
  assert(kodamaDates.length === weekdaysInMonth('2026-09', [2]).length, 'Kodama still Tuesday only')

  assert(isDeepCleanAllowedOnDate('Ibushio', '2026-09-07'), 'Ibushio deep Mon ok')
  assert(isDeepCleanAllowedOnDate('Ibushio', '2026-09-09'), 'Ibushio deep Wed ok')
  assert(!isDeepCleanAllowedOnDate('Ibushio', '2026-09-08'), 'Ibushio deep not Tue')
  assert(isDeepCleanAllowedOnDate('Kodama Shinbashi', '2026-09-08'), 'Kodama deep Tue ok')
  assert(!isDeepCleanAllowedOnDate('Kodama Shinbashi', '2026-09-07'), 'Kodama deep not Mon')
}

function testDeepCleanProgressForUser() {
  const ym = '2026-09'
  const otpId = SCHEDULE_CLIENTS.ontheplanet.id
  const jobs = [
    {
      title: 'Kodama Oimachi — Deep Clean',
      scheduled_date: '2026-09-08',
      status: 'completed',
      client_id: otpId,
    },
    {
      title: 'Ibushio — Deep Clean',
      scheduled_date: '2026-09-07',
      status: 'assigned',
      client_id: otpId,
    },
  ]
  const full = buildDeepCleanProgress(jobs, ym)
  assert(full.totals.expected > 0, 'expected slots for September')
  assert(full.totals.completed === 1, `completed ${full.totals.completed}`)
  assert(full.totals.pending === 1, `pending ${full.totals.pending}`)

  const storeUser = { client_id: otpId, location_name: 'Kodama Oimachi' }
  const scoped = buildDeepCleanProgressForUser(jobs, ym, storeUser)
  assert(scoped.scope === 'location', scoped.scope)
  assert(scoped.location === 'Kodama Oimachi', scoped.location)
  assert(scoped.totals.completed === 1, `store completed ${scoped.totals.completed}`)
  assert(scoped.totals.pending === 0, `store pending ${scoped.totals.pending}`)
  assert(scoped.totals.notDone === scoped.totals.expected - scoped.totals.completed, 'notDone math')
  assert(scoped.totals.donePct + scoped.totals.notDonePct === 100 || scoped.totals.expected === 0, 'pct split')

  const extra = {
    title: 'Kodama Oimachi — Deep Clean',
    scheduled_date: '2026-09-10',
    status: 'completed',
    client_id: otpId,
  }
  const withExtra = buildDeepCleanProgress([...jobs, extra], ym)
  assert(withExtra.totals.completed === 1, `extra Thursday must not count as a service-day completion: ${withExtra.totals.completed}`)
  const extraStore = withExtra.byLocation['Kodama Oimachi']
  assert(extraStore.completed === 1, 'store completed stays on expected days')
  assert(extraStore.missing === extraStore.expected - 1, 'missing ignores extra-day jobs')

  const hqUser = { client_id: otpId }
  const all = buildDeepCleanProgressForUser(jobs, ym, hqUser)
  assert(all.scope === 'all', all.scope)
  assert(all.totals.completed === 1, 'hq completed')
  assert(all.totals.missing === all.totals.expected - all.totals.scheduled, 'missing = expected - scheduled')
  assert(typeof all.totals.pendingPct === 'number', 'pendingPct')
  assert(typeof all.totals.missingPct === 'number', 'missingPct')

  const filtered = filterDeepCleanProgressByLocation(all, 'Kodama Oimachi')
  assert(filtered.scope === 'location', filtered.scope)
  assert(filtered.location === 'Kodama Oimachi', filtered.location)
  assert(filtered.totals.completed === 1, 'filtered completed')
  assert(Object.keys(filtered.byLocation).join() === 'Kodama Oimachi', 'filtered stores')

  const backToAll = filterDeepCleanProgressByLocation(all, '')
  assert(backToAll.scope === 'all', backToAll.scope)
  assert(backToAll.totals.expected === all.totals.expected, 'all stores expected')

  const rows = storeProgressRows(all.byLocation)
  assert(rows.length === Object.keys(all.byLocation).length, 'one row per store')
  const oimachi = rows.find(r => r.name === 'Kodama Oimachi')
  assert(oimachi?.completed === 1, 'oimachi row completed')
  assert(oimachi.pct === Math.round((1 / oimachi.expected) * 100), `oimachi pct ${oimachi.pct}`)
  assert(rows.every((row, i) => i === 0 || rows[i - 1].pct <= row.pct), 'sorted by pct')

  const unknown = buildDeepCleanProgressForUser(jobs, ym, { location_name: 'Unknown Store' })
  assert(unknown.scope === 'none', unknown.scope)
  assert(unknown.totals.expected === 0, 'unknown store expected 0')

  const hqDays = buildDaySummaries(all.byLocation)
  assert(hqDays.length === 14, `hq service days ${hqDays.length}`)
  const tue = hqDays.find(d => d.date === '2026-09-08')
  assert(tue?.expected === 8, `tuesday stores ${tue?.expected}`)
  assert(tue?.done === 1, `tuesday done ${tue?.done}`)
  assert(tue?.state === 'partial', tue?.state)
  const mon = hqDays.find(d => d.date === '2026-09-07')
  assert(mon?.stores.some(s => s.name === 'Ibushio' && s.job?.status === 'assigned'), 'monday ibushio pending')

  const storeDays = buildDaySummaries(scoped.byLocation)
  assert(storeDays.length === 5, `store service days ${storeDays.length}`)
  assert(storeDays.every(d => d.expected === 1), 'one store per day')
  assert(storeDays.find(d => d.date === '2026-09-08')?.state === 'done', 'oimachi tuesday done')

  const cells = monthCalendarCells('2026-09')
  assert(cells.filter(Boolean).length === 30, 'september has 30 days')
  assert(cells[0] === null || cells[0].endsWith('-01'), 'leading pad or month start')

  const hqDaysFixed = buildDaySummaries(all.byLocation, '2026-09-16')
  assert(hqDaysFixed.find(d => d.date === '2026-09-01')?.state === 'late', 'past empty tuesday is late')
  assert(hqDaysFixed.find(d => d.date === '2026-09-22')?.state === 'missing', 'future empty tuesday is missing')
  assert(hqDaysFixed.find(d => d.date === '2026-09-07')?.state === 'late', 'past assigned-not-done is late')
  assert(hqDaysFixed.find(d => d.date === '2026-09-08')?.state === 'partial', 'past with some done is partial')
  assert(daySummaryState({ expected: 8, done: 0, pending: 0, past: true, overdueCount: 8 }) === 'late', 'late helper')
  assert(daySummaryState({ expected: 8, done: 8, pending: 0, past: true }) === 'done', 'done helper')
}

function testTuesdayDeepSchedule() {
  const contracts = [
    { employeeId: 'e1', employeeName: 'Ana Silva', shortName: 'Ana', template: 'otp_basic', mondayAtomic: true },
    { employeeId: 'e1', employeeName: 'Ana Silva', shortName: 'Ana', template: 'otp_deep_only' },
  ]
  const jobs = buildMonthSchedule('2026-09', { contracts, includeDuskin: false })
  const tueDeep = jobs.filter(j => j.date === '2026-09-08' && /Deep Clean/i.test(j.title))
  assert(tueDeep.length === otpBasicScheduleLocations().length, `tuesday deep ${tueDeep.length}`)
  assert(tueDeep.every(j => j.type === 'deep'), 'tuesday jobs marked deep')
  const monDeep = jobs.filter(j => j.date === '2026-09-07' && /Deep Clean/i.test(j.title))
  assert(monDeep.length === otpDeepOnlyLocations().length, `monday deep-only ${monDeep.length}`)
  const wedDeep = jobs.filter(j => j.date === '2026-09-09' && /Deep Clean/i.test(j.title))
  assert(wedDeep.length === otpDeepOnlyLocations().length, `wednesday deep-only ${wedDeep.length}`)
}

function testMissingDeepCleanJobs() {
  const contracts = [
    { employeeId: 'e1', employeeName: 'Ana Silva', shortName: 'Ana', template: 'otp_basic' },
    { employeeId: 'e1', employeeName: 'Ana Silva', shortName: 'Ana', template: 'otp_deep_only' },
  ]
  const empty = buildMissingDeepCleanJobs('2026-09', [], { contracts })
  const expected = buildDeepCleanProgress([], '2026-09').totals.expected
  assert(empty.length === expected, `missing all slots ${empty.length} vs ${expected}`)
  assert(empty.every(j => /Deep Clean/i.test(j.title)), 'missing drafts are deep')

  const existing = [{
    title: 'Kodama Oimachi — Deep Clean',
    scheduled_date: '2026-09-08',
    status: 'assigned',
    client_id: SCHEDULE_CLIENTS.ontheplanet.id,
  }]
  const rest = buildMissingDeepCleanJobs('2026-09', existing, { contracts })
  assert(rest.length === expected - 1, `skip existing slot ${rest.length}`)
  assert(!rest.some(j => j.date === '2026-09-08' && j.title.startsWith('Kodama Oimachi')), 'oimachi tue kept')

  const fromGeneratorShape = buildMissingDeepCleanJobs('2026-09', [{
    title: 'Kodama Oimachi — Deep Clean',
    date: '2026-09-08',
    client: 'On The Planet',
  }], { contracts })
  assert(fromGeneratorShape.length === expected - 1, 'accepts generator date field')
}

function testTuesdaySlotInfo() {
  const assigned = { title: 'Ibushio — Deep Clean', status: 'assigned', scheduled_date: '2026-09-07' }
  const late = tuesdaySlotInfo(assigned, { slotLate: 'Late' }, '2026-09-07')
  assert(late.state === 'late', `past assigned is late: ${late.state}`)
  const missingPast = tuesdaySlotInfo(null, {}, '2026-09-01')
  assert(missingPast.state === 'late', `past empty is late: ${missingPast.state}`)
  const missingFuture = tuesdaySlotInfo(null, {}, '2026-12-29')
  assert(missingFuture.state === 'missing', `future empty is missing: ${missingFuture.state}`)
  const done = tuesdaySlotInfo({ status: 'completed', scheduled_date: '2026-09-08' }, {}, '2026-09-08')
  assert(done.state === 'done', done.state)
}

function testMonthBounds() {
  const sep = monthBounds('2026-09')
  assert(sep.from === '2026-09-01', sep.from)
  assert(sep.to === '2026-09-30', sep.to)
  const feb = monthBounds('2026-02')
  assert(feb.to === '2026-02-28', feb.to)
}

function testPhotoFit() {
  const portrait = fitRect(1200, 1600, 87, 168)
  assert(portrait.w <= 87.01 && portrait.h <= 168.01, `fits ${portrait.w}x${portrait.h}`)
  assert(Math.abs(portrait.w / portrait.h - 1200 / 1600) < 0.02, `ratio ${portrait.w / portrait.h}`)
  const landscape = fitRect(1600, 900, 87, 168)
  assert(Math.abs(landscape.w / landscape.h - 1600 / 900) < 0.02, 'landscape ratio')
  const wideBox = fitRect(1200, 1600, 182, 80)
  assert(Math.abs(wideBox.w / wideBox.h - 0.75) < 0.02, `portrait in wide box stays 3:4 ${wideBox.w}x${wideBox.h}`)
  assert(wideBox.h <= 80.01, 'does not overflow height')
  const fallback = photoDims(0, 0)
  assert(fallback.width / fallback.height === 3 / 4, 'missing size assumes 3:4')
  const known = photoDims(1200, 1600)
  assert(known.width === 1200 && known.height === 1600, 'keeps real size')
}

async function testServiceReportPdf() {
  const job = {
    id: 'job-pdf',
    status: 'completed',
    title: 'Ibushio — Deep Clean',
    employee_name: 'André',
    scheduled_date: '2026-09-07',
    photo_start_url: 'jobs/job-pdf/start.jpg',
    photo_end_url: 'jobs/job-pdf/end.jpg',
    notes_employee: 'Kitchen floor done',
    started_at: '2026-09-07T01:00:00Z',
    completed_at: '2026-09-07T01:40:00Z',
  }
  const report = jobToServiceReport(job)
  const name = reportPdfFilename(report)
  assert(name.includes('Ibushio'), name)
  assert(name.includes('2026-09-07'), name)
  const proxied = resolvePdfPhotoUrl('jobs/x.jpg')
  assert(proxied.includes('/api/photo'), proxied)
  const doc = await generateServiceReportPdf(report, { lang: 'en' })
  assert(doc.getNumberOfPages() >= 2, 'photos get their own page')
  const data = doc.output('arraybuffer')
  assert(data.byteLength > 1000, `pdf size ${data.byteLength}`)
}

async function main() {
  console.log('=== Deep clean + photo report unit tests ===\n')
  testCleaningType()
  console.log('✅ cleaningType')
  testOtpDeepOnlyContracts()
  console.log('✅ OTP deep-only contracts')
  testAddServiceOptions()
  console.log('✅ buildAddServiceOptions')
  testViewablePhotoUrl()
  console.log('✅ viewablePhotoUrl proxy')
  testReportPhotos()
  console.log('✅ jobReport photo merge')
  testDeepCleanProgressForUser()
  console.log('✅ buildDeepCleanProgressForUser')
  testTuesdayDeepSchedule()
  console.log('✅ Tuesday deep in month schedule')
  testMissingDeepCleanJobs()
  console.log('✅ fill missing deep-clean drafts')
  testTuesdaySlotInfo()
  console.log('✅ tuesdaySlotInfo late vs missing')
  testMonthBounds()
  console.log('✅ monthBounds')
  testPhotoFit()
  console.log('✅ photo fitRect keeps ratio')
  await testServiceReportPdf()
  console.log('✅ service report PDF')
  console.log('\n✅ All unit tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
