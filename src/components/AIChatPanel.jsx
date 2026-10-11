import { useState, useRef, useEffect, useMemo } from 'react'
import { apiPost } from '../lib/apiFetch'
import AICallMode from './AICallMode'
import { loadVoices, pickDefaultVoice, speakText, getSavedVoiceName, saveVoiceName } from '../lib/voice'
import { loadChatHistory, saveChatHistory } from '../lib/aiChatHistory'
import { useLang, fill } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
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

const MAX_INPUT_HEIGHT = 168
const MAX_INPUT_HEIGHT_COMPACT = 120

const svgProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const MicIcon = () => <svg {...svgProps}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
const SendIcon = () => <svg {...svgProps} strokeWidth={2.4}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
const ImageIcon = () => <svg {...svgProps}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>
const CameraIcon = () => <svg {...svgProps}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
const VideoIcon = () => <svg {...svgProps}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
const CopyIcon = () => <svg {...svgProps} width={14} height={14}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
const RefreshIcon = () => <svg {...svgProps} width={14} height={14}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>
const ClipIcon = () => <svg {...svgProps}><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" /></svg>

const approvalFrom = data => (data.pendingApproval ? { ...data.pendingApproval, state: 'waiting' } : undefined)

const APPROVAL_TEXT = {
  en: { title: 'Changes waiting for your authorization', create: 'Create', update: 'Change', delete: 'Delete', password: 'Approval password', authorize: 'Authorize', cancel: 'Cancel', cancelled: 'Cancelled. Nothing was changed.', done: 'Done: {n} of {total} changes applied.', failed: 'Stopped at an error: {error}', expired: 'This authorization expired. Ask the AI to prepare the change again.', noPassword: 'The AI approval password has not been created yet (AI_APPROVAL_PASSWORD on Vercel). Nothing can be changed until it exists.' },
  ja: { title: '承認待ちの変更', create: '作成', update: '変更', delete: '削除', password: '承認パスワード', authorize: '承認する', cancel: 'キャンセル', cancelled: 'キャンセルしました。何も変更していません。', done: '完了: {total}件中{n}件を反映しました。', failed: 'エラーで停止しました: {error}', expired: 'この承認は期限切れです。もう一度AIに変更を準備させてください。', noPassword: 'AI承認パスワードがまだ作成されていません（Vercel の AI_APPROVAL_PASSWORD）。作成するまで変更はできません。' },
  pt: { title: 'Mudanças aguardando sua autorização', create: 'Criar', update: 'Alterar', delete: 'Apagar', password: 'Senha de autorização', authorize: 'Autorizar', cancel: 'Cancelar', cancelled: 'Cancelado. Nada foi alterado.', done: 'Feito: {n} de {total} mudanças aplicadas.', failed: 'Parou por um erro: {error}', expired: 'Esta autorização expirou. Peça para a IA preparar a mudança de novo.', noPassword: 'A senha de autorização da IA ainda não foi criada (AI_APPROVAL_PASSWORD na Vercel). Nada pode ser alterado até ela existir.' },
}

function ApprovalCard({ approval, lang, onAuthorize, onCancel }) {
  const tx = APPROVAL_TEXT[lang] || APPROVAL_TEXT.en
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const waiting = approval.state === 'waiting'
  const submit = async e => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true); setError('')
    try { await onAuthorize(password) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  return (
    <form className={`ai-approval is-${approval.state}`} onSubmit={submit}>
      <div className="ai-approval-title">🔒 {tx.title}</div>
      <ol className="ai-approval-list">
        {approval.changes.map((c, i) => (
          <li key={i} className={`is-${c.kind}`}><strong>{tx[c.kind]} · {c.table}</strong><span>{c.text}</span></li>
        ))}
      </ol>
      {waiting && !approval.passwordConfigured && <p className="ai-approval-error">{tx.noPassword}</p>}
      {waiting && approval.passwordConfigured && (
        <div className="ai-approval-actions">
          <input type="password" autoComplete="off" placeholder={tx.password} aria-label={tx.password} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
          <button type="submit" className="ai-approval-ok" disabled={busy || !password}>{tx.authorize}</button>
          <button type="button" className="ai-approval-cancel" onClick={onCancel} disabled={busy}>{tx.cancel}</button>
        </div>
      )}
      {error && <p className="ai-approval-error">{error}</p>}
      {approval.state === 'cancelled' && <p className="ai-approval-note">{tx.cancelled}</p>}
      {approval.state === 'expired' && <p className="ai-approval-note">{tx.expired}</p>}
    </form>
  )
}

export default function AIChatPanel({ compact = false, mode = 'admin', employeeId, employeeName, dark = false, suggestions = [], newChatId = 0 }) {
  const { t, lang } = useLang()
  const { user } = useAuth() || {}
  const ai = t.ai || {}
  const firstName = (mode === 'employee' ? employeeName : user?.name || '').split(' ')[0]
  const cards = (suggestions.length ? suggestions : (mode === 'employee' ? ai.employeeSuggestions : ai.adminSuggestions) || []).slice(0, compact ? 4 : 6)
  const [copiedIndex, setCopiedIndex] = useState(null)
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
    saveChatHistory(mode, employeeId, messages.map(message => { const stored = { ...message }; delete stored.attachmentsData; return stored }))
  }, [messages, mode, employeeId])

  const speakReply = (text) => speakText(text, { voice: voiceRef.current })

  const callAPI = async (allMessages) => {
    const endpoint = mode === 'employee' ? '/api/employee-ai' : '/api/admin-ai'
    const body = mode === 'employee'
      ? { messages: allMessages }
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
    const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog, approval: approvalFrom(data) }
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
      const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog, approval: approvalFrom(data) }
      setMessages(m => [...m, replyMsg])
      if (voiceReplies) speakReply(data.reply)
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, isError: true }])
    }
    setLoading(false)
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus()
  }

  const retryLastRequest = async () => {
    const lastRequest = retryRequestRef.current
    if (!lastRequest || loading) return
    setMessages(current => current.slice(0, -1))
    setLoading(true)
    try {
      const data = await callAPI(lastRequest)
      const replyMsg = { role: 'assistant', content: data.reply, toolLog: data.toolLog, approval: approvalFrom(data) }
      setMessages(current => [...current, replyMsg])
      if (voiceReplies) speakReply(data.reply)
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `⚠️ ${error.message}`, isError: true }])
    } finally {
      setLoading(false)
    }
  }

  const regenerate = async () => {
    if (loading) return
    const current = messagesRef.current
    const lastUser = current.map(m => m.role).lastIndexOf('user')
    if (lastUser < 0) return
    const request = current.slice(0, lastUser + 1)
    retryRequestRef.current = request
    setMessages(request)
    setLoading(true)
    try {
      const data = await callAPI(request)
      setMessages(m => [...m, { role: 'assistant', content: data.reply, toolLog: data.toolLog, approval: approvalFrom(data) }])
      if (voiceReplies) speakReply(data.reply)
    } catch (error) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${error.message}`, isError: true }])
    } finally {
      setLoading(false)
    }
  }

  const setApproval = (index, patch) => setMessages(list => list.map((m, i) => (i === index ? { ...m, approval: { ...m.approval, ...patch } } : m)))

  const authorizeChanges = async (index, password) => {
    const tx = APPROVAL_TEXT[lang] || APPROVAL_TEXT.en
    const resp = await apiPost('/api/admin-ai', { authorize: messagesRef.current[index].approval.token, password })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      if (resp.status === 410) { setApproval(index, { state: 'expired', token: null }); return }
      throw new Error(data.error || `Error ${resp.status}`)
    }
    setApproval(index, { state: 'done', token: null })
    const failed = (data.results || []).find(r => !r.ok)
    const summary = [fill(tx.done, { n: data.executed, total: data.total }), ...(failed ? [fill(tx.failed, { error: failed.error })] : [])].join('\n')
    setMessages(list => [...list, { role: 'assistant', content: `${failed ? '⚠️' : '✅'} ${summary}` }])
  }

  const copyMessage = async (text, index) => {
    try { await navigator.clipboard.writeText(text); setCopiedIndex(index); setTimeout(() => setCopiedIndex(null), 1500) } catch {}
  }

  const lastAssistant = messages.map(m => m.role).lastIndexOf('assistant')
  const isEmpty = messages.length <= 1 && !loading

  const userBubble = mode === 'employee'
    ? 'linear-gradient(135deg,#7651dc,#5a38bd)'
    : dark ? 'linear-gradient(135deg,#1a3a5c,#0f2540)' : 'var(--navy)'
  const botBubble = dark ? 'rgba(255,255,255,0.07)' : '#fff'
  const botColor = dark ? '#fff' : 'var(--text)'
  const botBorder = dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)'

  return (
    <div className={`ai-chat-panel${compact ? ' ai-chat-panel-compact' : ''}`}>
      <div className={`ai-chat-header${compact ? ' ai-chat-header-compact' : ''}${dark ? ' ai-chat-header-dark' : ''}`}>
        <div className="ai-chat-identity">
          <span className="ai-orb ai-orb-sm" aria-hidden="true" />
          <div>
            <div className="ai-chat-title">{mode === 'employee' ? ai.employeeTitle : 'Kuripuro AI'}</div>
            {!compact && <div className="ai-chat-subtitle">{ai.subtitle}</div>}
          </div>
        </div>
        <div className="ai-chat-tools">
          {!compact && voices.filter(v => v.lang?.startsWith(lang === 'ja' ? 'ja' : 'en')).length > 0 && (
            <select className="ai-voice-select" value={voiceName} onChange={e => setVoiceName(e.target.value)} title="AI voice">
              {voices.filter(v => v.lang?.startsWith(lang === 'ja' ? 'ja' : 'en')).map(v => (
                <option key={v.name} value={v.name}>{v.name.split(' ')[0]}</option>
              ))}
            </select>
          )}
          <button type="button" className={`ai-tool-btn${voiceReplies ? ' is-on' : ''}`} onClick={() => setVoiceReplies(v => !v)} title={ai.readAloud} aria-label={ai.readAloud} aria-pressed={voiceReplies}>
            {voiceReplies ? '🔊' : '🔇'}
          </button>
          <button type="button" className="ai-voice-btn" onClick={() => setCallOpen(true)} title={ai.call}>
            <span className="ai-orb ai-orb-xs" aria-hidden="true" />{ai.voiceMode}
          </button>
        </div>
      </div>

      {callOpen && <AICallMode onClose={() => setCallOpen(false)} sendToAI={sendFromCall} />}

      {isEmpty ? (
        <div className="ai-hero">
          <span className="ai-orb ai-orb-lg" aria-hidden="true" />
          <p className="ai-hero-hi">{firstName ? fill(ai.hello, { name: firstName }) : ai.helloNoName}</p>
          <h2>{ai.howHelp}</h2>
          <p className="ai-hero-sub">{mode === 'employee' ? ai.heroSubEmployee : ai.heroSubAdmin}</p>
          {cards.length > 0 && (
            <div className="ai-cards">
              {cards.map((card, i) => (
                <button type="button" key={i} className="ai-card" onClick={() => pickSuggestion(card.prompt)}>
                  <strong><span className="ai-card-icon">{card.icon || '✦'}</span>{card.title}</strong>
                  <small>{card.hint || card.prompt}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="ai-thread" style={{ padding: compact ? '0 12px' : '0 4px 0 0' }}>
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role === 'user' ? 'is-user' : 'is-bot'}`}>
            {m.role !== 'user' && <span className="ai-orb ai-orb-xs ai-msg-avatar" aria-hidden="true" />}
            <div className="ai-msg-body">
              <div className="ai-bubble" style={{
                background: m.role === 'user' ? userBubble : botBubble,
                color: m.role === 'user' ? '#fff' : botColor,
                border: m.role === 'user' ? 'none' : botBorder,
              }}>
                {formatText(m.content)}
                {m.attachments?.length > 0 && <div className="ai-attachment-list">{m.attachments.map((file, j) => <span key={j}>📎 {file.name}</span>)}</div>}
                {m.isError && i === messages.length - 1 && <button type="button" className="ai-retry-button" onClick={retryLastRequest} disabled={loading}>{lang === 'ja' ? '↻ 再試行' : '↻ Tentar novamente'}</button>}
                {m.approval && <ApprovalCard approval={m.approval} lang={lang} onAuthorize={password => authorizeChanges(i, password)} onCancel={() => setApproval(i, { state: 'cancelled', token: null })} />}
                {m.toolLog?.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 10, opacity: 0.6, cursor: 'pointer' }}>🔧 {fill(ai.toolQueries || '{n}', { n: m.toolLog.length })}</summary>
                    {m.toolLog.map((t, j) => (
                      <div key={j} style={{ fontSize: 10, color: t.ok ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
                        {t.ok ? '✓' : '✗'} {t.name}
                      </div>
                    ))}
                  </details>
                )}
              </div>
              {m.role === 'assistant' && i > 0 && !m.isError && (
                <div className="ai-msg-actions">
                  {i === lastAssistant && <button type="button" onClick={regenerate} disabled={loading}><RefreshIcon />{ai.regenerate}</button>}
                  <button type="button" onClick={() => copyMessage(m.content, i)}><CopyIcon />{copiedIndex === i ? ai.copied : ai.copy}</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="ai-msg is-bot"><span className="ai-orb ai-orb-xs ai-msg-avatar is-thinking" aria-hidden="true" /><div className="ai-typing" aria-label={ai.thinking}><i /><i /><i /></div></div>}
        <div ref={bottomRef} />
      </div>
      )}

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
      <div className={`ai-composer-wrap${dark ? ' ai-composer-dark' : ''}${compact ? ' ai-composer-compact' : ''}`}>
        <div className={`ai-composer${recording ? ' is-recording' : ''}`} onClick={() => inputRef.current?.focus()}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={mode === 'employee' ? ai.placeholderEmployee : ai.placeholderAdmin}
            aria-label={mode === 'employee' ? ai.placeholderEmployee : ai.placeholderAdmin}
            rows={1}
          />
          <div className="ai-composer-toolbar" onClick={e => e.stopPropagation()}>
            <div className="ai-composer-attach">
              <button type="button" title={lang === 'ja' ? '写真' : 'Foto'} aria-label={lang === 'ja' ? '写真を追加' : 'Adicionar foto'} onClick={() => imageInputRef.current?.click()}><ImageIcon /></button>
              <button type="button" title={lang === 'ja' ? 'カメラ' : 'Câmera'} aria-label={lang === 'ja' ? 'カメラを開く' : 'Abrir câmera'} onClick={() => cameraInputRef.current?.click()}><CameraIcon /></button>
              <button type="button" title={lang === 'ja' ? '動画' : 'Vídeo'} aria-label={lang === 'ja' ? '動画を追加' : 'Adicionar vídeo'} onClick={() => videoInputRef.current?.click()}><VideoIcon /></button>
              <button type="button" title={lang === 'ja' ? 'ファイル' : 'Arquivo'} aria-label={lang === 'ja' ? 'ファイルを追加' : 'Adicionar arquivo'} onClick={() => fileInputRef.current?.click()}><ClipIcon /></button>
            </div>
            <div className="ai-composer-actions">
              <button type="button" className={`ai-composer-mic${recording ? ' is-on' : ''}`} onClick={startVoiceInput}
                title={lang === 'ja' ? '話す' : 'Falar'} aria-label={lang === 'ja' ? '話す' : 'Falar'}>
                {recording ? <span className="ai-rec-dot" /> : <MicIcon />}
              </button>
              <button type="button" className="ai-composer-send" onClick={send}
                disabled={loading || (!input.trim() && !attachments.length)} title={ai.send} aria-label={ai.send}>
                {loading ? <span className="ai-send-spinner" /> : <SendIcon />}
              </button>
            </div>
          </div>
        </div>
        {!compact && <div className="ai-composer-hint">{lang === 'ja' ? 'Enterで送信 · Shift + Enterで改行' : 'Enter para enviar · Shift + Enter para nova linha'}</div>}
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
