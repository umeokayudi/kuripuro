import { useState, useRef, useEffect, useMemo } from 'react'
import { apiPost } from '../lib/apiFetch'
import AICallMode from './AICallMode'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'
import { loadChatHistory, saveChatHistory, clearChatHistory } from '../lib/aiChatHistory'
import { useLang } from '../hooks/useLang'
import { fill } from '../i18n/translations'

function formatText(text) {
  if (!text) return null
  return String(text).split('\n').map((line, i) => {
    const isBullet = /^\s*[-*•]\s+/.test(line)
    const content = line.replace(/^\s*[-*•]\s+/, '')
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={j}>{part.slice(2, -2)}</strong>
      return part
    })
    return (
      <div key={i} className={`ai-gpt-line${isBullet ? ' is-bullet' : ''}${line.trim() ? '' : ' is-gap'}`}>
        {isBullet && <span className="ai-gpt-bullet">•</span>}
        <span>{parts}</span>
      </div>
    )
  })
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M12 5l-7 7M12 5l7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function AIChatPanel({ compact = false, mode = 'admin', employeeId, employeeName, dark = false, workspace = false, suggestions = [] }) {
  const { t, lang } = useLang()
  const ai = t.ai || {}
  const welcome = useMemo(() => {
    const text = mode === 'employee' ? ai.employeeWelcome : mode === 'salesperson' ? ai.salesWelcome : ai.adminWelcome
    return [{ role: 'assistant', content: text || '' }]
  }, [mode, ai.employeeWelcome, ai.salesWelcome, ai.adminWelcome])

  const [messages, setMessages] = useState(() =>
    loadChatHistory(mode, employeeId, welcome)
  )
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [voiceReplies, setVoiceReplies] = useState(false)
  const [recording, setRecording] = useState(false)
  const [photoB64, setPhotoB64] = useState('')
  const photoRef = useRef(null)
  const [voices, setVoices] = useState([])
  const [voiceName, setVoiceName] = useState(getSavedVoiceName())
  const voiceRef = useRef(null)
  const bottomRef = useRef(null)
  const taRef = useRef(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const started = messages.some(m => m.role === 'user')
  const title = mode === 'employee' ? ai.employeeTitle : mode === 'salesperson' ? ai.salesTitle : ai.adminTitle
  const placeholder = mode === 'employee' ? ai.placeholderEmployee : mode === 'salesperson' ? ai.placeholderSales : ai.placeholderAdmin
  const voiceOptions = voices.filter(v => v.lang?.startsWith(lang === 'ja' ? 'ja' : 'en'))

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

  useEffect(() => {
    saveChatHistory(mode, employeeId, messages)
  }, [messages, mode, employeeId])

  const speakReply = (text) => speakText(text, { voice: voiceRef.current })

  const resizeTa = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const callAPI = async (allMessages) => {
    const payload = allMessages.slice(-24)
    const endpoint = mode === 'employee' || mode === 'salesperson' ? '/api/employee-ai' : '/api/admin-ai'
    const body = mode === 'employee'
      ? { messages: payload, employeeId, employeeName }
      : mode === 'salesperson'
        ? { messages: payload, salespersonId: employeeId, salespersonName: employeeName }
        : { messages: payload }
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

  const send = async (preset) => {
    const text = (preset ?? input).trim()
    if ((!text && !photoB64) || loading) return
    const userMsg = { role: 'user', content: text || (mode === 'salesperson' ? (ai.meishiPrompt || 'Read this meishi') : 'photo'), image: photoB64 || undefined }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setPhotoB64('')
    if (taRef.current) taRef.current.style.height = 'auto'
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
  }

  const clear = () => {
    clearChatHistory(mode, employeeId)
    setMessages(welcome)
    setInput('')
  }

  const cls = [
    'ai-gpt',
    compact ? 'ai-gpt-compact' : '',
    workspace ? 'ai-gpt-workspace' : '',
    dark ? 'ai-gpt-dark' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <header className="ai-gpt-top">
        <div className="ai-gpt-brand">
          <span className="ai-gpt-mark">K</span>
          <span className="ai-gpt-name">{title}</span>
        </div>
        <div className="ai-gpt-tools">
          <button type="button" className="ai-gpt-icon-btn" onClick={clear} title={ai.clearChat}>{ai.clearChat}</button>
          {voiceOptions.length > 0 && (
            <select value={voiceName} onChange={e => setVoiceName(e.target.value)} title={ai.voiceLabel} className="ai-gpt-voice">
              {voiceOptions.map(v => (
                <option key={v.name} value={v.name}>{v.name.split(' ')[0]}</option>
              ))}
            </select>
          )}
          <button type="button" className={`ai-gpt-icon-btn${voiceReplies ? ' on' : ''}`} onClick={() => setVoiceReplies(v => !v)} title={ai.readAloud}>
            {voiceReplies ? '🔊' : '🔇'}
          </button>
          <button type="button" className="ai-gpt-call" onClick={() => setCallOpen(true)} title={ai.call}>☎ {ai.call}</button>
        </div>
      </header>

      {callOpen && <AICallMode onClose={() => setCallOpen(false)} sendToAI={sendFromCall} />}

      <div className="ai-gpt-scroll">
        <div className="ai-gpt-col">
          {!started && (
            <div className="ai-gpt-hero">
              <div className="ai-gpt-hero-mark">K</div>
              <h1>{ai.greeting}</h1>
              {suggestions.length > 0 && (
                <div className="ai-gpt-cards">
                  {suggestions.map(text => (
                    <button key={text} type="button" className="ai-gpt-card" onClick={() => send(text)}>{text}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {started && messages.filter((m, i) => !(i === 0 && m.role === 'assistant')).map((m, i) => (
            <div key={i} className={`ai-gpt-row ${m.role === 'user' ? 'is-user' : 'is-bot'}`}>
              {m.role !== 'user' && <div className="ai-gpt-avatar" aria-hidden="true">K</div>}
              <div className="ai-gpt-bubble">
                {formatText(m.content)}
                {m.toolLog?.length > 0 && (
                  <details className="ai-gpt-tools-log">
                    <summary>{fill(ai.toolQueries || '{n}', { n: m.toolLog.length })}</summary>
                    {m.toolLog.map((log, j) => (
                      <div key={j} className={log.ok ? 'ok' : 'bad'}>{log.ok ? '✓' : '✗'} {log.name}</div>
                    ))}
                  </details>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="ai-gpt-row is-bot">
              <div className="ai-gpt-avatar" aria-hidden="true">K</div>
              <div className="ai-gpt-bubble">
                <div className="ai-gpt-dots" aria-label={ai.thinking}>
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="ai-gpt-dock">
        <div className="ai-gpt-box">
          <button type="button" className={`ai-gpt-mic${recording ? ' rec' : ''}`} onClick={startVoiceInput} title={ai.speak}>
            {recording ? '●' : '🎤'}
          </button>
          {mode === 'salesperson' && (
            <>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const { prepareImageForUpload } = await import('../lib/imageUpload')
                const prepared = await prepareImageForUpload(file)
                const buf = await prepared.arrayBuffer()
                const bytes = new Uint8Array(buf)
                let binary = ''
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
                setPhotoB64(btoa(binary))
              }} />
              <button type="button" className={`ai-gpt-mic${photoB64 ? ' on' : ''}`} onClick={() => photoRef.current?.click()} title={ai.meishi}>📷</button>
            </>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={e => { setInput(e.target.value); resizeTa() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={placeholder}
            rows={1}
          />
          <button type="button" className="ai-gpt-send" onClick={() => send()} disabled={loading || (!input.trim() && !photoB64)} title={ai.send}>
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
