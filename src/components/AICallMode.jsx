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
    listening: 'Ouvindo... fale e pause',
    thinking: 'Pensando...',
    speaking: 'Falando...',
    idle: 'Pronto',
  }[status]

  const pulseColor = {
    connecting: '#94a3b8',
    listening: '#4ade80',
    thinking: '#fbbf24',
    speaking: '#c19c56',
    idle: '#94a3b8',
  }[status]

  const ptVoices = voices.filter(v => v.lang?.startsWith('pt'))

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'linear-gradient(160deg,#0d2137,#1a3a5c)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#fff', padding: 24,
    }}>
      <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.5, marginBottom: 8 }}>
        Ligação com o Assistente
      </div>

      {ptVoices.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Voz:</span>
          <select value={voiceName} onChange={e => setVoiceName(e.target.value)}
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', maxWidth: 220 }}>
            {ptVoices.map(v => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{
        width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${pulseColor}33, transparent 70%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20,
      }}>
        <div style={{
          width: 90, height: 90, borderRadius: '50%',
          background: `linear-gradient(135deg, ${pulseColor}, ${pulseColor}aa)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
          animation: status === 'listening' || status === 'speaking' ? 'aiCallPulse 1.4s infinite ease-in-out' : 'none',
        }}>
          {status === 'speaking' ? '🔊' : status === 'thinking' ? '💭' : '🎤'}
        </div>
        <style>{`@keyframes aiCallPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }`}</style>
      </div>

      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{statusLabel}</div>
      {transcript && (
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 8, maxWidth: 320, textAlign: 'center' }}>
          "{transcript}"
        </div>
      )}
      {transcript && status === 'listening' && (
        <button onClick={() => processUtterance()} style={{
          marginBottom: 12, padding: '8px 16px', borderRadius: 20, border: 'none',
          background: '#c19c56', color: '#0a1929', fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}>
          Enviar agora
        </button>
      )}

      <div style={{ width: '100%', maxWidth: 380, maxHeight: 180, overflowY: 'auto', marginTop: 8, marginBottom: 20 }}>
        {log.slice(-8).map((l, i) => (
          <div key={i} style={{
            fontSize: 12.5, marginBottom: 8, opacity: 0.85,
            textAlign: l.role === 'user' ? 'right' : 'left',
            color: l.role === 'system' ? '#f87171' : '#fff',
          }}>
            <span style={{ opacity: 0.5 }}>{l.role === 'user' ? 'Você: ' : l.role === 'assistant' ? 'IA: ' : ''}</span>
            {l.text}
          </div>
        ))}
      </div>

      <button onClick={hangUp} style={{
        width: 60, height: 60, borderRadius: '50%', border: 'none',
        background: '#ef4444', color: '#fff', fontSize: 24, cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(239,68,68,0.4)',
      }} title="Encerrar ligação">📞</button>
    </div>
  )
}
