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
} from '../src/lib/cleaningType.js'
import { buildAddServiceOptions } from '../src/lib/employeeAddJob.js'
import { jobToServiceReport, mergeReportWithJob, reportNeedsPhotoSync } from '../src/lib/jobReport.js'
import { isOtpDeepOnlyLocation, otpBasicScheduleLocations } from '../src/lib/serviceCatalog.js'

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
  assert(partialValue === 1250, `partial value: ${partialValue}`)

  const basicJob = { title: 'Ibushio — Basic Cleaning' }
  const deepJob = { title: 'Ibushio — Deep Clean' }
  assert(getCleaningType(basicJob) === 'basic', 'basic detect')
  assert(getCleaningType(deepJob) === 'deep', 'deep detect')
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
}

async function main() {
  console.log('=== Deep clean + photo report unit tests ===\n')
  testCleaningType()
  console.log('✅ cleaningType')
  testOtpDeepOnlyContracts()
  console.log('✅ OTP deep-only contracts')
  testAddServiceOptions()
  console.log('✅ buildAddServiceOptions')
  testReportPhotos()
  console.log('✅ jobReport photo merge')
  console.log('\n✅ All unit tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
