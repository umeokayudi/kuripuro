import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  elapsedSecondsFromStart,
  formatHms,
  formatShiftElapsed,
  isStaleActiveJob,
} from '../lib/employeePay'

export function EmpLiveDate({ lang }) {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
      {clock.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
    </div>
  )
}

export function EmpLiveTime() {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 44, fontWeight: 700, color: '#fff', fontFamily: 'monospace', letterSpacing: -3, lineHeight: 1 }}>
        {clock.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span style={{ fontSize: 20, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
        {String(clock.getSeconds()).padStart(2, '0')}
      </span>
    </div>
  )
}

export function EmpElapsed({ job, today, lang, prefix = '', style }) {
  const [elapsed, setElapsed] = useState(() => elapsedSecondsFromStart(job?.started_at))
  useEffect(() => {
    if (!job?.started_at) return undefined
    const tick = () => setElapsed(elapsedSecondsFromStart(job.started_at))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [job?.started_at])
  if (!job?.started_at) return null
  const stale = isStaleActiveJob(job, today, elapsed)
  return (
    <span style={style}>
      {prefix}{stale ? formatShiftElapsed(elapsed, lang) : formatHms(elapsed)}
    </span>
  )
}

export function EmpHourWatch({ startedAt }) {
  useEffect(() => {
    if (!startedAt) return undefined
    let warned = false
    const start = new Date(startedAt).getTime()
    if (!Number.isFinite(start)) return undefined
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000)
      if (secs >= 3600 && !warned) {
        warned = true
        toast('⏱️ 1 hour on this job — everything ok?', { duration: 8000 })
      }
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return null
}
