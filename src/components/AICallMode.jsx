import { useState, useRef, useEffect } from 'react'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'

export default function AICallMode({ onClose, sendToAI }) {
  const [status, setStatus] = useState('connecting')
  const [transcript, setTranscript] = useState('')
  const [log, setLog] = useState([])
  const [voices, setVoices] = useState([])
  const [voiceName, setVoiceName] = useState(getSavedVoiceName())

  const recognitionRef = useRef(null)
  const shouldListenRef = useRef(true)
  const transcriptRef = useRef('')
  const voiceRef = useRef(null)
  const busyRef = useRef(false)

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

  const stopRecognition = () => {
    try { recognitionRef.current?.abort() } catch {}
    recognitionRef.current = null
  }

  const speak = async (text) => {
    stopRecognition()
    setStatus('speaking')
    await speakText(text, { voice: voiceRef.current, onEnd: () => setStatus('idle') })
  }

  const startListening = () => {
    if (!shouldListenRef.current || busyRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setStatus('idle')
      setLog(l => [...l, { role: 'system', text: 'Reconhecimento de voz não suportado. Use Chrome.' }])
      return
    }

    stopRecognition()
    const recognition = new SR()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => setStatus('listening')

    recognition.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript
      }
      transcriptRef.current = text.trim()
      setTranscript(transcriptRef.current)
    }

    recognition.onerror = (e) => {
      if (e.error === 'aborted' || e.error === 'no-speech') return
      setLog(l => [...l, { role: 'system', text: `Erro de voz: ${e.error}` }])
    }

    recognition.onend = async () => {
      if (!shouldListenRef.current) return
      const finalText = transcriptRef.current.trim()
      transcriptRef.current = ''
      setTranscript('')

      if (!finalText) {
        setTimeout(() => { if (shouldListenRef.current && !busyRef.current) startListening() }, 400)
        return
      }

      busyRef.current = true
      setLog(l => [...l, { role: 'user', text: finalText }])
      setStatus('thinking')

      try {
        const reply = await sendToAI(finalText)
        const replyText = reply || 'Não consegui responder agora.'
        setLog(l => [...l, { role: 'assistant', text: replyText }])
        await speak(replyText)
      } catch (e) {
        await speak('Desculpa, tive um erro. Pode repetir?')
      }

      busyRef.current = false
      if (shouldListenRef.current) {
        setTimeout(() => startListening(), 500)
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch {}
  }

  useEffect(() => {
    shouldListenRef.current = true
    ;(async () => {
      await speak('Oi! Pode falar, estou ouvindo.')
      startListening()
    })()
    return () => {
      shouldListenRef.current = false
      busyRef.current = false
      stopRecognition()
      window.speechSynthesis?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hangUp = () => {
    shouldListenRef.current = false
    busyRef.current = false
    stopRecognition()
    window.speechSynthesis?.cancel()
    onClose()
  }

  const statusLabel = {
    connecting: 'Conectando...',
    listening: 'Ouvindo... fale agora',
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
      {transcript && <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 12, maxWidth: 320, textAlign: 'center' }}>"{transcript}"</div>}

      <div style={{ width: '100%', maxWidth: 380, maxHeight: 220, overflowY: 'auto', marginTop: 12, marginBottom: 24 }}>
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
