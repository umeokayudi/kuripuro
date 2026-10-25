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
  if (lang === 'pt') {
    const p = (n, one, many) => `${n} ${n === 1 ? one : many}`
    return [h ? p(h, 'hora', 'horas') : '', m || !h ? p(m, 'minuto', 'minutos') : ''].filter(Boolean).join(' e ')
  }
  const part = (n, one, many) => `${n} ${n === 1 ? one : many}`
  return [h ? part(h, 'hour', 'hours') : '', m || !h ? part(m, 'minute', 'minutes') : ''].filter(Boolean).join(' ')
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

const SPEECH_LANG = { ja: 'ja-JP', pt: 'pt-BR', en: 'en-US' }
const langOf = (v) => String(v?.lang || '').toLowerCase().replace('_', '-')

// Female voices by name on iPhone/Mac, Android/Chrome and Windows. The first match wins over
// the platform default, which on iPhone is often a male or novelty voice.
const FEMALE = {
  ja: ['kyoko', 'o-ren', 'nanami', 'ayumi', 'haruka', 'sayaka', 'mayu', 'shiori', 'google 日本語', 'ja-jp-x-htm', 'ja-jp-x-jab'],
  en: ['samantha', 'ava', 'allison', 'susan', 'zoe', 'nicky', 'karen', 'serena', 'kate', 'tessa', 'moira', 'victoria', 'aria', 'jenny', 'zira', 'michelle', 'google us english', 'google uk english female', 'en-us-x-sfg', 'en-us-x-tpc'],
  pt: ['luciana', 'fernanda', 'francisca', 'thalita', 'maria', 'joana', 'catarina', 'raquel', 'google português', 'pt-br-x-afs', 'pt-br-x-pte'],
}
const MALE = /\b(male|otoya|hattori|ichiro|keita|daniel|alex|fred|aaron|arthur|oliver|tom|evan|nathan|david|mark|guy|ryan|felipe|antonio|duarte|reed|eddy|rocko|grandpa|ralph|junior)\b/i
// Apple's joke and robotic voices sound "very strange" — never use them.
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ|flo|grandma|sandy|shelley)\b/i

/** Best female voice for the app language from a voice list (exported for tests). */
export function pickAlertVoice(voices, lang) {
  const code = lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en'
  const region = SPEECH_LANG[code].toLowerCase()
  const score = (v) => {
    const name = `${v.name || ''} ${v.voiceURI || ''}`.toLowerCase()
    if (NOVELTY.test(name)) return -Infinity
    let s = 1
    const fem = FEMALE[code].findIndex(n => name.includes(n))
    if (fem >= 0) s += 100 - fem
    else if (/female|woman|feminin/.test(name)) s += 60
    if (MALE.test(name)) s -= 80
    if (langOf(v) === region) s += 10
    if (/premium|enhanced|natural|neural|online/.test(name)) s += 5
    return s
  }
  return (voices || [])
    .filter(v => langOf(v).startsWith(code))
    .map(v => ({ v, s: score(v) }))
    .filter(x => x.s > -Infinity)
    .sort((a, b) => b.s - a.s)[0]?.v || null
}

// Phones load the voice list late; keep it fresh so the first reminder already has the right voice.
let voiceList = []
if (canSpeak()) {
  const refresh = () => { try { voiceList = window.speechSynthesis.getVoices() || [] } catch { /* not supported */ } }
  refresh()
  try { window.speechSynthesis.addEventListener?.('voiceschanged', refresh) } catch { /* old browser */ }
}

export function speak(text, lang) {
  if (!canSpeak() || !text) return
  const synth = window.speechSynthesis
  const say = () => {
    const code = lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en'
    const u = new SpeechSynthesisUtterance(text)
    u.lang = SPEECH_LANG[code]
    const voice = pickAlertVoice(voiceList.length ? voiceList : synth.getVoices(), code)
    if (voice) { u.voice = voice; u.lang = voice.lang || u.lang }
    u.rate = code === 'ja' ? 1 : 0.95
    u.pitch = 1.05
    synth.cancel()
    synth.speak(u)
  }
  if (!voiceList.length) voiceList = synth.getVoices() || []
  if (voiceList.length) say()
  else setTimeout(() => { voiceList = synth.getVoices() || []; say() }, 400)
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
