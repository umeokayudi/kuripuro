import { jobDurationMin, formatMinutes, ON_SITE_METERS } from '../lib/workKpis'
import { fill } from '../i18n/translations'

const pad = n => String(n).padStart(2, '0')
const clockText = secs => `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`

/** Big running stopwatch for the job in progress, measured against the worker's own average. */
export default function ServiceTimer({ job, elapsed, history, labels, lang }) {
  const title = (job.title || '').split(' —')[0]
  const past = (history || []).filter(j => j.id !== job.id && j.status === 'completed')
  const here = past.filter(j => (j.title || '').split(' —')[0] === title).map(jobDurationMin).filter(v => v != null)
  const all = past.map(jobDurationMin).filter(v => v != null)
  const avgOf = list => Math.round(list.reduce((s, v) => s + v, 0) / list.length)
  const expected = here.length ? avgOf(here) : all.length ? avgOf(all) : null
  const target = (expected || 45) * 60
  const ratio = Math.min(elapsed / target, 1.5)
  const tone = ratio < 1 ? 'is-good' : ratio < 1.25 ? 'is-warn' : 'is-over'
  const R = 54, C = 2 * Math.PI * R
  const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const time = d => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const started = job.started_at ? new Date(job.started_at) : null
  const end = started && expected ? new Date(started.getTime() + expected * 60000) : null
  const overMin = expected ? Math.floor(elapsed / 60) - expected : 0

  let gps = null
  if (job.gps_start_distance != null) gps = job.gps_start_distance <= ON_SITE_METERS
    ? { cls: 'is-good', text: fill(labels.gpsOnSite, { m: job.gps_start_distance }) }
    : { cls: 'is-warn', text: fill(labels.gpsAway, { m: job.gps_start_distance }) }
  else if (job.start_lat != null) gps = { cls: 'is-good', text: labels.gpsSaved + (job.start_accuracy ? ` ±${job.start_accuracy}m` : '') }
  else gps = { cls: 'is-muted', text: labels.gpsMissing }

  return (
    <div className={`svc-timer ${tone}`}>
      <div className="svc-ring">
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <circle cx="64" cy="64" r={R} className="svc-ring-track" />
          <circle cx="64" cy="64" r={R} className="svc-ring-bar" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(ratio, 1))} />
        </svg>
        <div className="svc-ring-text">
          <strong>{clockText(elapsed)}</strong>
          <small>{Math.round(ratio * 100)}%</small>
        </div>
      </div>
      <div className="svc-info">
        <span className="svc-kicker">⏱ {labels.timerTitle}</span>
        {started && <span>{fill(labels.startedAt, { time: time(started) })}</span>}
        <span>{expected ? fill(here.length ? labels.avgHere : labels.avgOverall, { time: formatMinutes(expected) }) : labels.firstTimeHere}</span>
        {end && (overMin > 0
          ? <span className="svc-over">{fill(labels.overTime, { time: formatMinutes(overMin) })}</span>
          : <span>{fill(labels.expectedEnd, { time: time(end) })}</span>)}
        <span className={`svc-gps ${gps.cls}`}>📍 {gps.text}</span>
      </div>
    </div>
  )
}
