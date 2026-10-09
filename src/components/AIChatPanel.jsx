import { useState, useRef, useEffect, useMemo } from 'react'
import { apiPost } from '../lib/apiFetch'
import AICallMode from './AICallMode'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'
import { loadChatHistory, saveChatHistory } from '../lib/aiChatHistory'
import { useLang } from '../hooks/useLang'

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

const MAX_INPUT_HEIGHT = 168
const MAX_INPUT_HEIGHT_COMPACT = 120

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" /><path d="M5 12l7-7 7 7" />
    </svg>
  )
}

export default function AIChatPanel({ compact = false, mode = 'admin', employeeId, employeeName, dark = false, suggestions = [], newChatId = 0 }) {
  const { t, lang } = useLang()
  const ai = t.ai || {}
  const welcome = useMemo(() => (
    [{ role: 'assistant', content: (mode === 'employee' ? ai.employeeWelcome : ai.adminWelcome) || '' }]
  ), [mode, ai.employeeWelcome, ai.adminWelcome])

  const [messages, setMessages] = useState(() =>
    newChatId ? welcome : loadChatHistory(mode, employeeId, welcome)
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
  const inputRef = useRef(null)
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // Grow the input with its content up to a max height, then scroll inside it
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const max = compact ? MAX_INPUT_HEIGHT_COMPACT : MAX_INPUT_HEIGHT
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [input, compact])

  useEffect(() => {
    saveChatHistory(mode, employeeId, messages)
  }, [messages, mode, employeeId])

  const speakReply = (text) => speakText(text, { voice: voiceRef.current })

  const callAPI = async (allMessages) => {
    const endpoint = mode === 'employee' ? '/api/employee-ai' : '/api/admin-ai'
    const body = mode === 'employee'
      ? { messages: allMessages, employeeId, employeeName }
      : { messages: allMessages }
    const resp = await apiPost(endpoint, body)
    let data
    try { data = await resp.json() } catch { throw new Error(`Invalid response (${resp.status})`) }
    if (!resp.ok || data.error) throw new Error(data.error || `Error ${resp.status}`)
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
    if (!SR) { alert(ai.voiceChrome); return }
    const recognition = new SR()
    recognition.lang = lang === 'ja' ? 'ja-JP' : 'en-US'
    recognition.interimResults = false
    recognition.onstart = () => setRecording(true)
    recognition.onresult = (e) => setInput(prev => (prev ? prev + ' ' : '') + e.results[0][0].transcript)
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognition.start()
  }

  const onInputKeyDown = (e) => {
    // Japanese IME uses Enter to confirm conversion: never send in the middle of it
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const pickSuggestion = (prompt) => {
    setInput(prompt)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(prompt.length, prompt.length)
    })
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
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }])
    }
    setLoading(false)
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus()
  }

  const userBubble = dark ? 'linear-gradient(135deg,#1a3a5c,#0f2540)' : 'var(--navy)'
  const botBubble = dark ? 'rgba(255,255,255,0.07)' : '#fff'
  const botColor = dark ? '#fff' : 'var(--text)'
  const botBorder = dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)'

  return (
    <div className={`ai-chat-panel${compact ? ' ai-chat-panel-compact' : ''}`}>
      <div className={`ai-chat-header${compact ? ' ai-chat-header-compact' : ''}${dark ? ' ai-chat-header-dark' : ''}`}>
        <div className="ai-chat-identity">
          <div className="ai-avatar">✦</div>
          <div>
            <div className="ai-chat-title">{mode === 'employee' ? ai.employeeTitle : 'Kuripuro AI'}</div>
            {!compact && <div className="ai-chat-subtitle">Seu centro de comando inteligente</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {voices.filter(v => v.lang?.startsWith(lang === 'ja' ? 'ja' : 'en')).length > 0 && (
            <select value={voiceName} onChange={e => setVoiceName(e.target.value)} title="AI voice"
              style={{ fontSize: 11, padding: '5px 8px', borderRadius: 8, border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: dark ? '#fff' : 'inherit', maxWidth: 130 }}>
              {voices.filter(v => v.lang?.startsWith(lang === 'ja' ? 'ja' : 'en')).map(v => (
                <option key={v.name} value={v.name}>{v.name.split(' ')[0]}</option>
              ))}
            </select>
          )}
          <button onClick={() => setVoiceReplies(v => !v)} title="Ler respostas em voz alta"
            style={{ border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: voiceReplies ? '#c19c56' : dark ? 'rgba(255,255,255,0.06)' : '#fff', color: voiceReplies ? '#0a1929' : dark ? '#fff' : 'var(--text)', borderRadius: 10, padding: '5px 9px', cursor: 'pointer', fontSize: 12 }}>
            {voiceReplies ? '🔊' : '🔇'}
          </button>
          <button onClick={() => setCallOpen(true)} title={ai.call}
            style={{ border: 'none', background: 'linear-gradient(135deg,#4ade80,#22c55e)', color: '#0a1929', borderRadius: 10, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            📞 {ai.call}
          </button>
        </div>
      </div>

      {callOpen && <AICallMode onClose={() => setCallOpen(false)} sendToAI={sendFromCall} />}

      {!compact && messages.length <= 1 && suggestions.length > 0 && (
        <div className="ai-suggestions">
          {suggestions.map((suggestion, i) => (
            <button type="button" key={i} onClick={() => pickSuggestion(suggestion.prompt)} className="ai-suggestion">
              <span className="ai-suggestion-icon">{suggestion.icon || '✦'}</span>
              <span><strong>{suggestion.title}</strong><small>{suggestion.prompt}</small></span>
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '0 12px' : '4px 4px 0 0' }}>
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
                      {t.ok ? '✓' : '✗'} {t.name}
                    </div>
                  ))}
                </details>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', fontSize: 12, opacity: 0.5, padding: '8px 12px' }}>{ai.thinking}</div>}
        <div ref={bottomRef} />
      </div>

      <div className={`ai-composer-wrap${dark ? ' ai-composer-dark' : ''}${compact ? ' ai-composer-compact' : ''}`}>
        <div className={`ai-composer${recording ? ' is-recording' : ''}`} onClick={() => inputRef.current?.focus()}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={recording ? (ai.listening || 'Ouvindo…') : (mode === 'employee' ? ai.placeholderEmployee : ai.placeholderAdmin)}
            rows={1}
            aria-label={mode === 'employee' ? ai.placeholderEmployee : ai.placeholderAdmin}
          />
          <div className="ai-composer-actions">
            <button type="button" className={`ai-composer-mic${recording ? ' is-on' : ''}`}
              onClick={e => { e.stopPropagation(); startVoiceInput() }}
              title={recording ? 'Ouvindo…' : 'Falar'} aria-label="Falar">
              {recording ? <span className="ai-rec-dot" /> : <MicIcon />}
            </button>
            <button type="button" className="ai-composer-send"
              onClick={e => { e.stopPropagation(); send() }}
              disabled={loading || !input.trim()} title={ai.send} aria-label={ai.send}>
              {loading ? <span className="ai-send-spinner" /> : <SendIcon />}
            </button>
          </div>
        </div>
        {!compact && <div className="ai-composer-hint">Enter para enviar · Shift + Enter para nova linha</div>}
      </div>
    </div>
  )
}
