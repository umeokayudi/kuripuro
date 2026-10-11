import { useState, useRef, useEffect, useCallback } from 'react'
import { loadVoices, pickDefaultVoice, speakText, stopSpeaking, unlockSpeech, getSavedVoiceName, saveVoiceName } from '../lib/voice'

const SILENCE_MS = 1400

export default function AICallMode({ onClose, sendToAI }) {
  const [status, setStatus] = useState('connecting')
  const [transcript, setTranscript] = useState('')
  const [log, setLog] = useState([])
  const [voices, setVoices] = useState([])
  const [voiceName, setVoiceName] = useState(getSavedVoiceName())

  const activeRef = useRef(true)
  const busyRef = useRef(false)
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const transcriptRef = useRef('')
  const finalRef = useRef('')
  const voiceRef = useRef(null)
  const sendToAIRef = useRef(sendToAI)

  sendToAIRef.current = sendToAI

  useEffect(() => {
    loadVoices().then(v => {
      setVoices(v)
      voiceRef.current = pickDefaultVoice(v)
      if (!voiceName && voiceRef.current) setVoiceName(voiceRef.current.name)
    })
  }, [])

  useEffect(() => {
    const v = voices.find(x => x.name === voiceName)
    if (v) { voiceRef.current = v; saveVoiceName(v.name) }
  }, [voiceName, voices])

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  const detachRecognition = () => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (!rec) return
    rec.onstart = null
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    try { rec.stop() } catch {}
    try { rec.abort() } catch {}
  }

  const speak = async (text) => {
    detachRecognition()
    clearSilenceTimer()
    setStatus('speaking')
    await speakText(text, { voice: voiceRef.current, onEnd: () => setStatus('idle') })
  }

  const processUtterance = useCallback(async (forcedText) => {
    if (!activeRef.current || busyRef.current) return

    const text = (forcedText || transcriptRef.current || finalRef.current).trim()
    if (!text) return

    busyRef.current = true
    clearSilenceTimer()
    detachRecognition()
    transcriptRef.current = ''
    finalRef.current = ''
    setTranscript('')

    setLog(l => [...l, { role: 'user', text }])
    setStatus('thinking')

    try {
      const reply = await sendToAIRef.current(text)
      const replyText = (reply || 'Não consegui responder agora.').slice(0, 800)
      setLog(l => [...l, { role: 'assistant', text: replyText }])
      await speak(replyText)
    } catch (e) {
      const errMsg = e?.message || 'erro desconhecido'
      setLog(l => [...l, { role: 'system', text: `Erro: ${errMsg}` }])
      await speak('Desculpa, tive um erro. Pode repetir?')
    }

    busyRef.current = false
    if (activeRef.current) {
      setTimeout(() => startListeningRef.current?.(), 600)
    }
  }, [])

  const scheduleSilenceCheck = useCallback(() => {
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(() => {
      if (!activeRef.current || busyRef.current) return
      const text = (finalRef.current + ' ' + transcriptRef.current).trim()
      if (text) processUtterance(text)
    }, SILENCE_MS)
  }, [processUtterance])

  const startListeningRef = useRef(null)

  startListeningRef.current = () => {
    if (!activeRef.current || busyRef.current) return

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setStatus('idle')
      setLog(l => [...l, { role: 'system', text: 'Reconhecimento de voz não suportado. Use Chrome ou Safari.' }])
      return
    }

    detachRecognition()
    finalRef.current = ''
    transcriptRef.current = ''

    const recognition = new SR()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setStatus('listening')

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) {
          finalRef.current = `${finalRef.current} ${chunk}`.trim()
        } else {
          interim += chunk
        }
      }
      const display = `${finalRef.current} ${interim}`.trim()
      transcriptRef.current = display
      setTranscript(display)
      if (display) scheduleSilenceCheck()
    }

    recognition.onerror = (e) => {
      if (e.error === 'aborted') return
      if (e.error === 'no-speech') {
        if (activeRef.current && !busyRef.current) {
          setTimeout(() => startListeningRef.current?.(), 300)
        }
        return
      }
      setLog(l => [...l, { role: 'system', text: `Erro de voz: ${e.error}` }])
      if (activeRef.current && !busyRef.current) {
        setTimeout(() => startListeningRef.current?.(), 800)
      }
    }

    recognition.onend = () => {
      if (!activeRef.current || busyRef.current) return
      const pending = (finalRef.current + ' ' + transcriptRef.current).trim()
      if (pending) {
        processUtterance(pending)
        return
      }
      setTimeout(() => {
        if (activeRef.current && !busyRef.current && !recognitionRef.current) {
          startListeningRef.current?.()
        }
      }, 400)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (e) {
      setLog(l => [...l, { role: 'system', text: `Microfone: ${e.message}` }])
      setStatus('idle')
    }
  }

  useEffect(() => {
    activeRef.current = true
    unlockSpeech()

    ;(async () => {
      await speak('Oi! Pode falar, estou ouvindo.')
      startListeningRef.current?.()
    })()

    return () => {
      activeRef.current = false
      busyRef.current = false
      clearSilenceTimer()
      detachRecognition()
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hangUp = () => {
    activeRef.current = false
    busyRef.current = false
    clearSilenceTimer()
    detachRecognition()
    stopSpeaking()
    onClose()
  }

  const statusLabel = {
    connecting: 'Conectando...',
    listening: 'Ouvindo... fale e faça uma pausa',
    thinking: 'Pensando...',
    speaking: 'Falando...',
    idle: 'Toque no microfone para falar',
  }[status]

  const ptVoices = voices.filter(v => v.lang?.startsWith('pt'))
  const lastLines = log.slice(-3)

  const onMic = () => {
    if (status === 'listening' && transcript) processUtterance()
    else if (status === 'idle') startListeningRef.current?.()
  }

  return (
    <div className="ai-call" role="dialog" aria-modal="true" aria-label="Falando com a Kuripuro IA">
      <div className="ai-call-top">
        <span />
        <div><strong>Falando com a Kuripuro IA</strong><small>{statusLabel}</small></div>
        <button type="button" className="ai-call-x" onClick={hangUp} aria-label="Fechar">×</button>
      </div>

      <div className="ai-call-stage">
        <div className={`ai-call-orb is-${status}`} aria-hidden="true"><span /><span /><span /></div>
        <div className="ai-call-text" aria-live="polite">
          {lastLines.map((l, i) => (
            <div key={log.length - lastLines.length + i} className={`ai-call-line is-${l.role}${i < lastLines.length - 1 ? ' is-faded' : ''}`}>{l.text}</div>
          ))}
          {transcript && <div className="ai-call-line is-user ai-call-live">{transcript}</div>}
        </div>
      </div>

      <div className="ai-call-controls">
        {ptVoices.length > 0 ? (
          <select value={voiceName} onChange={e => setVoiceName(e.target.value)} aria-label="Voz">
            {ptVoices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        ) : <span />}
        <button type="button" className={`ai-call-mic${status === 'listening' ? ' is-live' : ''}`} onClick={onMic}
          title={status === 'listening' && transcript ? 'Enviar agora' : 'Falar'} aria-label={status === 'listening' && transcript ? 'Enviar agora' : 'Falar'}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
        </button>
        <button type="button" className="ai-call-end" onClick={hangUp} title="Encerrar" aria-label="Encerrar">✕</button>
      </div>
    </div>
  )
}
