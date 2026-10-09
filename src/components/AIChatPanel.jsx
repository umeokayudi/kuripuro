import { useState, useRef, useEffect, useMemo } from 'react'
import { apiPost } from '../lib/apiFetch'
import AICallMode from './AICallMode'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'
import { loadChatHistory, saveChatHistory } from '../lib/aiChatHistory'
import { useLang } from '../hooks/useLang'
import { prepareImageForUpload } from '../lib/imageUpload'

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
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const imageInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const retryRequestRef = useRef(null)
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
    saveChatHistory(mode, employeeId, messages.map(message => { const stored = { ...message }; delete stored.attachmentsData; return stored }))
  }, [messages, mode, employeeId])

  const speakReply = (text) => speakText(text, { voice: voiceRef.current })

  const callAPI = async (allMessages) => {
    const endpoint = mode === 'employee' ? '/api/employee-ai' : '/api/admin-ai'
    const body = mode === 'employee'
      ? { messages: allMessages, employeeId, employeeName }
      : { messages: allMessages }
    if (mode === 'employee') body.language = lang
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 35000)
    let resp
    try {
      resp = await apiPost(endpoint, body, { signal: controller.signal })
    } catch (error) {
      const timeout = error.name === 'AbortError'
      throw new Error(timeout
        ? (lang === 'ja' ? 'AIの応答に時間がかかっています。もう一度お試しください。' : 'A IA demorou demais para responder. Tente novamente.')
        : (lang === 'ja' ? 'AIに接続できませんでした。接続を確認して再試行してください。' : 'Não consegui conectar à IA. Confira a conexão e tente novamente.'))
    } finally {
      clearTimeout(timer)
    }
    let data
    try { data = await resp.json() } catch {
      const unavailable = lang === 'ja'
        ? 'AIサーバーに接続できません。Vercel Functions と GEMINI_API_KEY の設定を確認してください。'
        : 'Não consegui conectar ao servidor de IA. Verifique as Vercel Functions e a configuração GEMINI_API_KEY.'
      throw new Error(unavailable)
    }
    if (!resp.ok || data.error) throw new Error(data.error || `Error ${resp.status}`)
    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new Error(lang === 'ja' ? 'AIから回答がありませんでした。もう一度お試しください。' : 'A IA não retornou uma resposta. Tente novamente.')
    }
    return data
  }

  const sendFromCall = async (text) => {
    const userMsg = { role: 'user', content: text }
    const history = messagesRef.current.slice(-6)
    const newMessages = [...history, userMsg]
    setMessages(m => [...m, { ...userMsg, attachmentsData: undefined }])
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

  const send = async () => {
    if ((!input.trim() && !attachments.length) || loading) return
    const labels = attachments.map(file => file.name)
    const userMsg = {
      role: 'user',
      content: [input.trim(), ...(labels.length ? [`Anexos: ${labels.join(', ')}`] : [])].filter(Boolean).join('\n'),
      attachments: attachments.map(({ name, type }) => ({ name, type })),
      attachmentsData: attachments,
    }
    const newMessages = [...messages, userMsg]
    setMessages(m => [...m, userMsg])
    retryRequestRef.current = newMessages
    setInput('')
    setAttachments([])
    setLoading(true)
    try {
      const data = await callAPI(newMessages)
      const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog }
      setMessages(m => [...m, replyMsg])
      if (voiceReplies) speakReply(data.reply)
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, isError: true }])
    }
    setLoading(false)
  }

  const retryLastRequest = async () => {
    const lastRequest = retryRequestRef.current
    if (!lastRequest || loading) return
    setMessages(current => current.slice(0, -1))
    setLoading(true)
    try {
      const data = await callAPI(lastRequest)
      const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog }
      setMessages(current => [...current, replyMsg])
      if (voiceReplies) speakReply(data.reply)
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `⚠️ ${error.message}`, isError: true }])
    } finally {
      setLoading(false)
    }
  }

  const userBubble = mode === 'employee'
    ? 'linear-gradient(135deg,#7651dc,#5a38bd)'
    : dark ? 'linear-gradient(135deg,#1a3a5c,#0f2540)' : 'var(--navy)'
  const botBubble = dark ? 'rgba(255,255,255,0.07)' : '#fff'
  const botColor = dark ? '#fff' : 'var(--text)'
  const botBorder = dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: compact ? '100%' : 'calc(100vh - 140px)' }}>
      <div className={`ai-chat-header${compact ? ' ai-chat-header-compact' : ''}`}>
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
            <button type="button" key={i} onClick={() => setInput(suggestion.prompt)} className="ai-suggestion">
              <span className="ai-suggestion-icon">{suggestion.icon || '✦'}</span>
              <span><strong>{suggestion.title}</strong><small>{suggestion.prompt}</small></span>
            </button>
          ))}
        </div>
      )}

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
              {m.attachments?.length > 0 && <div className="ai-attachment-list">{m.attachments.map((file, j) => <span key={j}>📎 {file.name}</span>)}</div>}
              {m.isError && i === messages.length - 1 && <button type="button" className="ai-retry-button" onClick={retryLastRequest} disabled={loading}>{lang === 'ja' ? '↻ 再試行' : '↻ Tentar novamente'}</button>}
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

      <>
        <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={e => { addSelectedFiles(e.target.files); e.target.value = '' }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { addSelectedFiles(e.target.files); e.target.value = '' }} />
        <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={e => { addSelectedFiles(e.target.files); e.target.value = '' }} />
        <input ref={fileInputRef} type="file" accept="application/pdf,text/plain,text/csv,.txt,.md,.csv" multiple hidden onChange={e => { addSelectedFiles(e.target.files); e.target.value = '' }} />
      </>
      {attachmentError && <div className="ai-attachment-error">{attachmentError}</div>}
      {attachments.length > 0 && <div className="ai-attachment-tray">{attachments.map((file, i) => <div className="ai-attachment-card" key={i}>
        {file.type.startsWith('image/') ? <img src={file.dataUrl} alt={file.name} /> : file.type.startsWith('video/') ? <video src={file.dataUrl} muted playsInline /> : <span className="ai-attachment-file-icon">PDF</span>}
        <span className="ai-attachment-file-meta"><b>{file.name}</b><small>{file.type.split('/')[0].toUpperCase()} · {(file.size / 1024).toFixed(0)} KB</small></span>
        <button type="button" aria-label={lang === 'ja' ? '添付ファイルを削除' : 'Remover anexo'} onClick={() => setAttachments(items => items.filter((_, index) => index !== i))}>×</button>
      </div>)}</div>}
      <div className="ai-compose-row" style={{ display: 'flex', gap: 8, marginTop: 10, borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'var(--border)'}`, padding: compact ? 12 : '12px 0 0' }}>
        <div className="ai-attach-actions">
          <button type="button" title={lang === 'ja' ? '写真' : 'Foto'} aria-label={lang === 'ja' ? '写真を追加' : 'Adicionar foto'} onClick={() => imageInputRef.current?.click()}><span>▧</span><small>{lang === 'ja' ? '写真' : 'Foto'}</small></button>
          <button type="button" title={lang === 'ja' ? 'カメラ' : 'Câmera'} aria-label={lang === 'ja' ? 'カメラを開く' : 'Abrir câmera'} onClick={() => cameraInputRef.current?.click()}><span>◎</span><small>{lang === 'ja' ? '撮影' : 'Câmera'}</small></button>
          <button type="button" title={lang === 'ja' ? '動画' : 'Vídeo'} aria-label={lang === 'ja' ? '動画を追加' : 'Adicionar vídeo'} onClick={() => videoInputRef.current?.click()}><span>▷</span><small>{lang === 'ja' ? '動画' : 'Vídeo'}</small></button>
          <button type="button" title={lang === 'ja' ? 'ファイル' : 'Arquivo'} aria-label={lang === 'ja' ? 'ファイルを追加' : 'Adicionar arquivo'} onClick={() => fileInputRef.current?.click()}><span>＋</span><small>{lang === 'ja' ? 'ファイル' : 'Arquivo'}</small></button>
        </div>
        <button onClick={startVoiceInput} title="Falar"
          style={{ border: `1px solid ${dark ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, background: recording ? 'rgba(248,113,113,0.2)' : dark ? 'rgba(255,255,255,0.06)' : '#fff', borderRadius: 12, width: 40, alignSelf: 'flex-end', cursor: 'pointer', fontSize: 16 }}>
          {recording ? '🔴' : '🎤'}
        </button>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={mode === 'employee' ? ai.placeholderEmployee : ai.placeholderAdmin}
          rows={compact ? 1 : 2}
          style={{ flex: 1, resize: 'none', borderRadius: 12, border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'var(--border)'}`, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', background: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: dark ? '#fff' : 'inherit' }}
        />
        <button onClick={send} disabled={loading || (!input.trim() && !attachments.length)}
          style={{ alignSelf: 'flex-end', padding: '10px 16px', borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
          {ai.send}
        </button>
      </div>
    </div>
  )

  async function addSelectedFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setAttachmentError('')
    const allowed = files.filter(file => /^(image\/|video\/|application\/pdf|text\/(plain|csv))/i.test(file.type) || /\.(txt|md|csv)$/i.test(file.name))
    if (allowed.length !== files.length) setAttachmentError(lang === 'ja' ? '写真、動画、PDF、TXT、CSVファイルを選択してください。' : 'Escolha fotos, vídeos, PDF, TXT ou CSV.')
    const existingBytes = attachments.reduce((sum, file) => sum + file.size, 0)
    const chosen = allowed.slice(0, Math.max(0, 3 - attachments.length))
    const next = []
    let total = existingBytes
    let rejectedForSize = false
    for (const sourceFile of chosen) {
      if (sourceFile.size > 8_000_000) { rejectedForSize = true; continue }
      const file = sourceFile.type.startsWith('image/') ? await prepareImageForUpload(sourceFile) : sourceFile
      if (file.size > 1_500_000 || total + file.size > 2_500_000) { rejectedForSize = true; continue }
      total += file.size
      next.push(new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: sourceFile.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl: reader.result })
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      }))
    }
    if (files.length + attachments.length > 3 || rejectedForSize) setAttachmentError(lang === 'ja' ? '最大3件、合計2.5MBまで添付できます。写真は自動で圧縮します。' : 'Anexe até 3 arquivos, somando no máximo 2,5 MB. Fotos são compactadas automaticamente.')
    Promise.all(next).then(results => setAttachments(items => [...items, ...results.filter(Boolean)].slice(0, 3)))
  }
}
