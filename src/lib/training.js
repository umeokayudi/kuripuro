import { locationNameFromTitle } from './cleaningType'

export function locationFromJobTitle(title) {
  return locationNameFromTitle(title || '')
}

/** Match service_contract to job by location name */
export function contractForJob(job, contracts) {
  if (!job || !contracts?.length) return null
  const loc = locationFromJobTitle(job.title)
  if (!loc) return null
  return contracts.find(c =>
    c.location_name === loc ||
    loc.startsWith(c.location_name) ||
    c.location_name.startsWith(loc)
  ) || null
}

export function parseTrainingChecklist(text) {
  if (!text) return []
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}
