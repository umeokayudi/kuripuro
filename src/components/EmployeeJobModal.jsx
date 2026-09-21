import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { keyboxForJob } from '../lib/scheduleGenerator'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import { GEOFENCE_M, mapsPointUrl } from '../lib/jobGps'
import { fill } from '../hooks/useLang'
import { lockBodyScroll } from '../lib/bodyScrollLock'
import JobPhotos from './JobPhotos'
import PhotoLightbox from './PhotoLightbox'

export default function EmployeeJobModal({
  job,
  onClose,
  labels,
  statusLabels,
  canRetro = false,
  onRetro,
}) {
  const [lightbox, setLightbox] = useState(null)
  const e = labels || {}

  useEffect(() => lockBodyScroll(), [])

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (lightbox) {
        setLightbox(null)
        return
      }
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, onClose])

  if (!job) return null

  const duration = job.started_at && job.completed_at
    ? Math.round((new Date(job.completed_at) - new Date(job.started_at)) / 60000)
    : null
  const cl = (job.checklist_template || '').split('\n').filter(Boolean)
  const dDate = job.scheduled_date
  const instructions = keyboxForJob(job)

  const node = (
    <>
      <div
        className="emp-job-modal"
        onClick={() => { if (!lightbox) onClose?.() }}
      >
        <div className="emp-job-sheet" data-kp-scroll onClick={ev => ev.stopPropagation()}>
          <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '0 auto 18px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ flex: 1, marginRight: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.3, marginBottom: 4 }}>{job.title}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{job.client_name}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#c19c56' }}>¥{Number(job.spot_value || job.value || 0).toLocaleString()}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 14 }}>
            {[['📅 ' + e.jobDate, dDate], ['🕐 ' + e.jobStart, job.scheduled_time || '—'], ['▶ ' + e.jobIn, job.started_at ? new Date(job.started_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'], ['🏁 ' + e.jobOut, job.completed_at ? new Date(job.completed_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'], ['⏱ ' + e.jobDuration, duration ? `${Math.floor(duration / 60)}h ${duration % 60}m` : '—'], [e.jobStatus, statusLabels?.[job.status] || job.status]].map(([l, v]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>{v}</div>
              </div>
            ))}
          </div>
          {(job.gps_start_lat || job.gps_end_lat) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {job.gps_start_distance_m != null && (
                <a href={mapsPointUrl(job.gps_start_lat, job.gps_start_lng) || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: Number(job.gps_start_distance_m) <= GEOFENCE_M ? '#4ade80' : '#f87171', textDecoration: 'none' }}>
                  📍 {fill(e.gpsStartMeters, { n: Math.round(job.gps_start_distance_m) })}
                </a>
              )}
              {job.gps_end_distance_m != null && (
                <a href={mapsPointUrl(job.gps_end_lat, job.gps_end_lng) || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: Number(job.gps_end_distance_m) <= GEOFENCE_M ? '#4ade80' : '#f87171', textDecoration: 'none' }}>
                  🏁 {fill(e.gpsEndMeters, { n: Math.round(job.gps_end_distance_m) })}
                </a>
              )}
            </div>
          )}
          {instructions && (
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 5 }}>📋 {e.instructionsKeybox}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{instructions}</div>
            </div>
          )}
          {cl.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 7, letterSpacing: 1, textTransform: 'uppercase' }}>
                Checklist — {job.checklist_total ? `${job.checklist_done ?? 0}/${job.checklist_total}` : fill(e.checklistCount, { n: cl.length })}
              </div>
              {cl.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{i + 1}</div>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>{label}</span>
                </div>
              ))}
            </div>
          )}
          {job.notes_employee && (
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>{e.yourNotes}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{job.notes_employee}</div>
            </div>
          )}
          {(job.photo_start_url || job.photo_end_url) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 7, letterSpacing: 1, textTransform: 'uppercase' }}>{e.photos}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{e.openPhoto}</div>
              <JobPhotos
                photoStartUrl={job.photo_start_url}
                photoEndUrl={job.photo_end_url}
                beforeLabel={e.photoStart}
                afterLabel={e.photoEnd}
                variant="compare"
                onPhotoClick={setLightbox}
              />
            </div>
          )}
          {hasMapsLink(job.address, job.title) && (
            <a href={mapsOpenUrl(job.address, job.title)} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 14, padding: '13px', textAlign: 'center', color: '#60a5fa', fontSize: 14, fontWeight: 600, textDecoration: 'none', marginBottom: 10 }}>
              🗺 {e.openMaps}
            </a>
          )}
          {canRetro && job.status === 'assigned' && (
            <button
              type="button"
              onClick={() => { onClose?.(); onRetro?.(job) }}
              style={{ width: '100%', padding: '14px', borderRadius: 14, border: '1px solid rgba(193,156,86,0.3)', background: 'rgba(193,156,86,0.12)', color: '#c19c56', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}
            >
              📝 {e.retroReport}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            {e.close}
          </button>
        </div>
      </div>
      {lightbox && (
        <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={e.close} />
      )}
    </>
  )
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}
