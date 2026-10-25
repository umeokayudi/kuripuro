// Spoken reminders during a job (every 5 minutes): time on the job, the next checklist step,
// and a warning when the phone's GPS is away from the store.
import { fill } from '../i18n/translations'
import { formatDistance } from './geocode'
import { checklistDisplayLabel } from './jobChecklist'

export const VOICE_EVERY_SEC = 5 * 60
const PREF_KEY = 'kp_voice_alerts'

export function voicePrefOn() {
  try { return localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}
export function setVoicePref(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** "25 minutes" / "1 hour 5 minutes" / "1時間5分". */
export function spokenDuration(min, lang) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (lang === 'ja') return `${h ? `${h}時間` : ''}${m || !h ? `${m}分` : ''}`
  const part = (n, one, many) => `${n} ${n === 1 ? one : many}`
  const [hour, hours, minute, minutes, and] = lang === 'pt' ? ['hora', 'horas', 'minuto', 'minutos', ' e '] : ['hour', 'hours', 'minute', 'minutes', ' ']
  return [h ? part(h, hour, hours) : '', m || !h ? part(m, minute, minutes) : ''].filter(Boolean).join(and)
}

/** Text of one reminder. `dist` is meters from the store (null when unknown). */
export function voiceMessage({ place, elapsedSec, expectedMin, checklist, dist, onSiteMeters, labels, lang }) {
  const min = Math.floor(elapsedSec / 60)
  const parts = [fill(labels.voiceElapsed, { place: place || '', time: spokenDuration(min, lang) }).replace(/^[.。]\s*/, '')]
  if (expectedMin && min > expectedMin) parts.push(fill(labels.voiceOver, { time: spokenDuration(min - expectedMin, lang) }))
  if (dist != null && dist > onSiteMeters) parts.push(fill(labels.voiceAway, { m: formatDistance(dist) }))
  const next = (checklist || []).find(c => !c.done)
  if (next) parts.push(fill(labels.voiceNext, { step: checklistDisplayLabel(next.label, lang) }))
  else if (checklist?.length) parts.push(labels.voiceAllDone)
  return parts.join(lang === 'ja' ? '' : ' ')
}

export function speak(text, lang) {
  if (!canSpeak() || !text) return
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US'
  const voice = synth.getVoices().find(v => v.lang?.toLowerCase().startsWith(lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en'))
  if (voice) u.voice = voice
  u.rate = lang === 'ja' ? 1 : 0.95
  synth.cancel()
  synth.speak(u)
}

// Mobile browsers only allow speech after a tap; call this from the tap that starts the job
// (or turns alerts on) so the later timed reminders are allowed to play.
export function unlockSpeech() {
  if (!canSpeak()) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  } catch { /* not supported */ }
}
