import { useState, useRef, useEffect, useCallback } from 'react'

export default function AICallMode({ onClose, sendToAI }) {
  const [status, setStatus] = useState('connecting') // connecting | listening | thinking | speaking | idle
  const [transcript, setTranscript] = useState('')
  const [log, setLog] = useState([])
  const recognitionRef = useRef(null)
  const shouldListenRef = useRef(true)

  const speak = useCallback((text) => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return }
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'pt-BR'
      utter.rate = 1.05
      utter.onend = resolve
      utter.onerror = resolve
      setStatus('speaking')
      window.speechSynthesis.speak(utter)
    })
  }, [])

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setStatus('idle')
      setLog(l => [...l, { role: 'system', text: 'Reconhecimento de voz não suportado nesse navegador. Tenta no Chrome.' }])
      return
    }
    const recognition = new SR()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => setStatus('listening')

    recognition.onresult = (event) => {
      let text = ''
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript
      setTranscript(text)
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setLog(l => [...l, { role: 'system', text: `Erro de voz: ${e.error}` }])
    }

    recognition.onend = async () => {
      const finalText = transcript.trim()
      setTranscript('')
      if (!finalText) {
        if (shouldListenRef.current) startListening()
        return
      }
      setLog(l => [...l, { role: 'user', text: finalText }])
      setStatus('thinking')
      try {
        const reply = await sendToAI(finalText)
        setLog(l => [...l, { role: 'assistant', text: reply }])
        await speak(reply)
      } catch (e) {
        await speak('Desculpa, tive um erro. Pode repetir?')
      }
      if (shouldListenRef.current) startListening()
      else setStatus('idle')
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [transcript, sendToAI, speak])

  useEffect(() => {
    shouldListenRef.current = true
    ;(async () => {
      await speak('Oi! Pode falar, tô ouvindo.')
      if (shouldListenRef.current) startListening()
    })()
    return () => {
      shouldListenRef.current = false
      recognitionRef.current?.abort()
      window.speechSynthesis?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hangUp = () => {
    shouldListenRef.current = false
    recognitionRef.current?.abort()
    window.speechSynthesis?.cancel()
    onClose()
  }

  const statusLabel = {
    connecting: 'Conectando...',
    listening: 'Ouvindo...',
    thinking: 'Pensando...',
    speaking: 'Falando...',
    idle: 'Pausado',
  }[status]

  const pulseColor = {
    connecting: '#94a3b8',
    listening: '#4ade80',
    thinking: '#fbbf24',
    speaking: '#c19c56',
    idle: '#94a3b8',
  }[status]

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

      <div style={{
        width: 140, height: 140, borderRadius: '50%',
        background: `radial-gradient(circle, ${pulseColor}33, transparent 70%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 20, position: 'relative',
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

      <div style={{ width: '100%', maxWidth: 380, maxHeight: 220, overflowY: 'auto', marginTop: 20, marginBottom: 30 }}>
        {log.slice(-6).map((l, i) => (
          <div key={i} style={{
            fontSize: 12.5, marginBottom: 8, opacity: 0.8,
            textAlign: l.role === 'user' ? 'right' : 'left',
            color: l.role === 'system' ? '#f87171' : '#fff',
          }}>
            <span style={{ opacity: 0.5 }}>{l.role === 'user' ? 'Você: ' : l.role === 'assistant' ? 'IA: ' : ''}</span>
            {l.text}
          </div>
        ))}
      </div>

      <button
        onClick={hangUp}
        style={{
          width: 60, height: 60, borderRadius: '50%', border: 'none',
          background: '#ef4444', color: '#fff', fontSize: 24, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(239,68,68,0.4)',
        }}
        title="Encerrar ligação"
      >📞</button>
    </div>
  )
}
