const VOICE_KEY = 'kp_ai_voice'

export function getSavedVoiceName() {
  return localStorage.getItem(VOICE_KEY) || ''
}

export function saveVoiceName(name) {
  if (name) localStorage.setItem(VOICE_KEY, name)
  else localStorage.removeItem(VOICE_KEY)
}

export function loadVoices() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve([])
    const pick = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length) resolve(voices)
    }
    pick()
    window.speechSynthesis.onvoiceschanged = pick
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 300)
  })
}

export function pickDefaultVoice(voices) {
  const saved = getSavedVoiceName()
  if (saved) {
    const v = voices.find(x => x.name === saved)
    if (v) return v
  }
  const pt = voices.find(v => v.lang?.startsWith('pt') && /luciana|francisca|felipe|google português/i.test(v.name))
    || voices.find(v => v.lang?.startsWith('pt-BR'))
    || voices.find(v => v.lang?.startsWith('pt'))
  return pt || voices[0] || null
}

export function cleanForSpeech(text) {
  return (text || '')
    .replace(/\*\*/g, '')
    .replace(/[#*_`]/g, '')
    .replace(/\n+/g, '. ')
    .trim()
}

export function speakText(text, { voice, rate = 1.02, onStart, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !text) { resolve(); return }
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(cleanForSpeech(text))
    utter.lang = voice?.lang || 'pt-BR'
    if (voice) utter.voice = voice
    utter.rate = rate
    utter.onstart = () => onStart?.()
    utter.onend = () => { onEnd?.(); resolve() }
    utter.onerror = () => { onEnd?.(); resolve() }
    window.speechSynthesis.speak(utter)
  })
}
