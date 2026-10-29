import { useState } from 'react'
import { fill } from '../i18n/translations'
import { speak, canSpeak, spokenDuration } from '../lib/voiceAlert'
import { businessName } from '../lib/nearbyJob'
import './JobDueAlert.css'

/** "in 25 min" / "it is time" / "40 min late". */
export function dueWhenText(past, labels) {
  if (past < 0) return fill(labels.dueAhead, { min: -past })
  if (past < 1) return labels.dueNow
  return fill(labels.duePast, { min: past })
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tone = (at, freq) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = freq; o.type = 'sine'
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4)
    }
    tone(0, 880); tone(0.45, 1175); tone(0.9, 880)
    setTimeout(() => ctx.close?.(), 1800)
  } catch { /* audio blocked until the first tap */ }
}

/** Vibrate, beep, say it out loud (when the voice is on) and show a system notification if allowed. */
export function ringDueAlert(item, { labels, lang, voiceOn }) {
  if (!item) return
  try { navigator.vibrate?.([400, 150, 400, 150, 400]) } catch { /* no vibration */ }
  beep()
  const place = businessName(item.job) || item.job.title
  const when = item.past < 0
    ? fill(labels.dueVoiceAhead, { time: spokenDuration(-item.past, lang) })
    : item.past < 1 ? labels.dueNow : fill(labels.dueVoicePast, { time: spokenDuration(item.past, lang) })
  const text = fill(item.kind === 'accept' ? labels.dueVoiceAccept : labels.dueVoiceStart, { place, when })
  if (voiceOn && canSpeak()) speak(text, lang)
  try {
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(item.kind === 'accept' ? labels.dueTitleAccept : labels.dueTitleStart, { body: `${place} · ${dueWhenText(item.past, labels)}`, tag: `kp-due-${item.job.id}`, renotify: true })
    }
  } catch { /* notifications not available */ }
}

/** Pop-up for a job due now: accept / decline a spot offer, or go start a scheduled job. */
export default function JobDueAlert({ item, others = 0, labels, onAccept, onDecline, onGoStart, onLater }) {
  const [busy, setBusy] = useState(false)
  if (!item) return null
  const { job, past, kind } = item
  const run = fn => async () => { if (busy) return; setBusy(true); try { await fn?.(job) } finally { setBusy(false) } }
  const late = past >= 5
  return (
    <div className="jda-overlay">
      <section className={`jda-sheet${late ? ' is-late' : ''}`} role="alertdialog" aria-modal="true" aria-label={kind === 'accept' ? labels.dueTitleAccept : labels.dueTitleStart}>
        <div className="jda-kicker"><span className="jda-bell" aria-hidden="true">🔔</span>{kind === 'accept' ? labels.dueTitleAccept : labels.dueTitleStart}</div>
        <h2>{(job.title || '').replace(/ — .*/, '')}</h2>
        <div className="jda-when">{dueWhenText(past, labels)}</div>
        <div className="jda-meta">📅 {job.scheduled_date} · 🕐 {job.scheduled_time || '—'}</div>
        {kind === 'accept' && Number(job.spot_value) > 0 && <span className="jda-value">+¥{Number(job.spot_value).toLocaleString()}</span>}
        {others > 0 && <div className="jda-more">{fill(labels.dueOthers, { n: others })}</div>}
        <div className="jda-btns">
          {kind === 'accept' ? (
            <div className="two">
              <button type="button" className="jda-btn is-soft" disabled={busy} onClick={run(onDecline)}>✕ {labels.decline}</button>
              <button type="button" className="jda-btn is-go" disabled={busy} onClick={run(onAccept)}>✅ {labels.accept}</button>
            </div>
          ) : (
            <button type="button" className="jda-btn is-start" onClick={() => onGoStart?.(job)}>▶ {labels.dueGoStart}</button>
          )}
          <button type="button" className="jda-btn is-ghost" onClick={() => onLater?.(item)}>{labels.dueLater}</button>
        </div>
        <div className="jda-hint">{labels.dueRepeatHint}</div>
      </section>
    </div>
  )
}
