import { useState, useRef, useEffect, useMemo } from 'react'
import AICallMode from './AICallMode'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'
import { loadChatHistory, saveChatHistory } from '../lib/aiChatHistory'

function formatText(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    const isBullet = /^\s*[-*•]\s+/.test(line)
    const content = line.replace(/^\s*[-*•]\s+/, '')
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={j}>{part.slice(2, -2)}</strong>
      return part
    })
    return (
      <div key={i} style={{ display: 'flex', gap: isBullet ? 6 : 0, marginBottom: line.trim() ? 2 : 8 }}>
        {isBullet && <span style={{ opacity: 0.5 }}>•</span>}
        <span>{parts}</span>
      </div>
    )
  })
}

const WELCOME = {
  admin: 'Oi! Sou o assistente do admin KuriPuro. Posso consultar e alterar jobs, funcionários, clientes, pagamentos e mais.\n\nExperimenta: "quantos jobs o André completou essa semana" ou use o botão 📞 Ligar para falar comigo.',
  employee: 'Oi! Sou seu assistente pessoal. Posso consultar seus jobs, salário, descontos, transporte e mensagens.\n\nPergunte algo como "quais são meus jobs de amanhã?" ou toque em 📞 Ligar para falar comigo.',
}

export default function AIChatPanel({ compact = false, mode = 'admin', employeeId, employeeName, dark = false }) {
  const welcome = useMemo(() => (
    [{ role: 'assistant', content: WELCOME[mode] || WELCOME.admin }]
  ), [mode])

  const [messages, setMessages] = useState(() =>
    loadChatHistory(mode, employeeId, welcome)
  )
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [voiceReplies, setVoiceReplies] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voices, setVoices] = useState([])
  const [voiceName, setVoiceName] = useState(getSavedVoiceName())
  const voiceRef = useRef(null)
  const bottomRef = useRef(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    saveChatHistory(mode, employeeId, messages)
  }, [messages, mode, employeeId])

  const speakReply = (text) => speakText(text, { voice: voiceRef.current })

  const callAPI = async (allMessages) => {
    const endpoint = mode === 'employee' ? '/api/employee-ai' : '/api/admin-ai'
    const body = mode === 'employee'
      ? { messages: allMessages, employeeId, employeeName }
      : { messages: allMessages }
    const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    let data
    try { data = await resp.json() } catch { throw new Error(`Resposta inválida (${resp.status})`) }
    if (!resp.ok || data.error) throw new Error(data.error || `Erro ${resp.status}`)
    return data
  }

  const sendFromCall = async (text) => {
    const userMsg = { role: 'user', content: text }
    const history = messagesRef.current.slice(-6)
    const newMessages = [...history, userMsg]
    setMessages(m => [...m, userMsg])
    const data = await callAPI(newMessages)
    const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog }
    setMessages(m => [...m, replyMsg])
    return data.reply
  }

  const startVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Reconhecimento de voz não suportado. Use Chrome.'); return }
    const recognition = new SR()
    recognition.lang = 'pt-BR'
    recognition.interimResults = false
    recognition.onstart = () => setRecording(true)
    recognition.onresult = (e) => setInput(prev => (prev ? prev + ' ' : '') + e.results[0][0].transcript)
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognition.start()
  }

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    try {
      const data = await callAPI(newMessages)
      const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog }
      setMessages(m => [...m, replyMsg])
      if (voiceReplies) speakReply(data.reply)
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ Erro: ${e.message}` }])
    }
    setLoading(false)
  }

  const userBubble = dark ? 'linear-gradient(135deg,#1a3a5c,#0f2540)' : 'var(--navy)'
  const botBubble = dark ? 'rgba(255,255,255,0.07)' : '#fff'
  const botColor = dark ? '#fff' : 'var(--text)'
  const botBorder = dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: compact ? '100%' : 'calc(100vh - 140px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 8 : 12, padding: compact ? '8px 12px 0' : 0 }}>
        <div style={{ fontSize: compact ? 12 : 14, fontWeight: 700, color: dark ? 'rgba(255,255,255,0.7)' : 'var(--text2)' }}>
          {mode === 'employee' ? '🤖 Meu Assistente' : '✨ Assistente Admin'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {voices.filter(v => v.lang?.startsWith('pt')).length > 0 && (
            <select value={voiceName} onChange={e => setVoiceName(e.target.value)} title="Voz da IA"
              style={{ fontSize: 11, padding: '5px 8px', borderRadius: 8, border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: dark ? '#fff' : 'inherit', maxWidth: 130 }}>
              {voices.filter(v => v.lang?.startsWith('pt')).map(v => (
                <option key={v.name} value={v.name}>{v.name.split(' ')[0]}</option>
              ))}
            </select>
          )}
          <button onClick={() => setVoiceReplies(v => !v)} title="Ler respostas em voz alta"
            style={{ border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: voiceReplies ? '#c19c56' : dark ? 'rgba(255,255,255,0.06)' : '#fff', color: voiceReplies ? '#0a1929' : dark ? '#fff' : 'var(--text)', borderRadius: 10, padding: '5px 9px', cursor: 'pointer', fontSize: 12 }}>
            {voiceReplies ? '🔊' : '🔇'}
          </button>
          <button onClick={() => setCallOpen(true)} title="Ligar pro assistente"
            style={{ border: 'none', background: 'linear-gradient(135deg,#4ade80,#22c55e)', color: '#0a1929', borderRadius: 10, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            📞 Ligar
          </button>
        </div>
      </div>

      {callOpen && <AICallMode onClose={() => setCallOpen(false)} sendToAI={sendFromCall} />}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '0 12px' : '0 4px 0 0' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
            <div style={{
              background: m.role === 'user' ? userBubble : botBubble,
              color: m.role === 'user' ? '#fff' : botColor,
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              padding: '10px 14px', fontSize: 13.5, lineHeight: 1.5,
              border: m.role === 'user' ? 'none' : botBorder,
            }}>
              {formatText(m.content)}
              {m.toolLog?.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ fontSize: 10, opacity: 0.6, cursor: 'pointer' }}>🔧 {m.toolLog.length} consulta(s)</summary>
                  {m.toolLog.map((t, j) => (
                    <div key={j} style={{ fontSize: 10, color: t.ok ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
                      {t.ok ? '✓' : '✗'} {t.name}{t.error ? `: ${t.error}` : ''}
                    </div>
                  ))}
                </details>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', fontSize: 12, opacity: 0.5, padding: '8px 12px' }}>Pensando...</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'var(--border)'}`, padding: compact ? 12 : '12px 0 0' }}>
        <button onClick={startVoiceInput} title="Falar"
          style={{ border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: recording ? 'rgba(248,113,113,0.2)' : dark ? 'rgba(255,255,255,0.06)' : '#fff', borderRadius: 12, width: 40, alignSelf: 'flex-end', cursor: 'pointer', fontSize: 16 }}>
          {recording ? '🔴' : '🎤'}
        </button>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={mode === 'employee' ? 'Pergunte sobre seus jobs, salário...' : 'Pergunte ou peça uma mudança...'}
          rows={compact ? 1 : 2}
          style={{ flex: 1, resize: 'none', borderRadius: 12, border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'var(--border)'}`, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', background: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: dark ? '#fff' : 'inherit' }}
        />
        <button onClick={send} disabled={loading}
          style={{ alignSelf: 'flex-end', padding: '10px 16px', borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
          Enviar
        </button>
      </div>
    </div>
  )
}
