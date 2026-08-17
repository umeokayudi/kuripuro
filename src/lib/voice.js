const VOICE_KEY = 'kp_ai_voice'
let resumeTimer = null

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
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500)
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
    .replace(/\s+/g, ' ')
    .trim()
}

function startResumeHack() {
  if (resumeTimer) return
  resumeTimer = setInterval(() => {
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.resume()
    } else {
      clearInterval(resumeTimer)
      resumeTimer = null
    }
  }, 8000)
}

export function stopSpeaking() {
  if (resumeTimer) {
    clearInterval(resumeTimer)
    resumeTimer = null
  }
  window.speechSynthesis?.cancel()
}

/** Unlock TTS on iOS/Safari — must run from a user gesture */
export function unlockSpeech() {
  if (!window.speechSynthesis) return
  const utter = new SpeechSynthesisUtterance(' ')
  utter.volume = 0.01
  utter.rate = 10
  window.speechSynthesis.speak(utter)
  window.speechSynthesis.cancel()
}

export function speakText(text, { voice, rate = 1.02, onStart, onEnd } = {}) {
  return new Promise((resolve) => {
    const cleaned = cleanForSpeech(text)
    if (!window.speechSynthesis || !cleaned) { onEnd?.(); resolve(); return }

    stopSpeaking()
    const utter = new SpeechSynthesisUtterance(cleaned)
    utter.lang = voice?.lang || 'pt-BR'
    if (voice) utter.voice = voice
    utter.rate = rate

    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (resumeTimer) {
        clearInterval(resumeTimer)
        resumeTimer = null
      }
      onEnd?.()
      resolve()
    }

    utter.onstart = () => {
      onStart?.()
      startResumeHack()
    }
    utter.onend = finish
    utter.onerror = finish

    window.speechSynthesis.speak(utter)
    // Safari sometimes never fires onend
    setTimeout(finish, Math.min(60000, cleaned.length * 120 + 3000))
  })
}
