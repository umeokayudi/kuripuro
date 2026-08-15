import { useState, useRef, useEffect } from 'react'

// Conversor bem simples de markdown -> JSX (bold, listas, quebras de linha)
function formatText(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const isBullet = /^\s*[-*•]\s+/.test(line)
    const content = line.replace(/^\s*[-*•]\s+/, '')
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>
      }
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

export default function AIChatPanel({ compact = false }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Oi! Posso consultar e alterar dados do sistema, e também analisar fotos que você mandar — de limpeza, comprovantes, o que precisar.\n\nExperimenta perguntar algo, ou anexa uma foto pra eu avaliar.' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachedImage, setAttachedImage] = useState(null) // { dataUrl, base64, mimeType }
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const base64 = dataUrl.split(',')[1]
      setAttachedImage({ dataUrl, base64, mimeType: file.type })
    }
    reader.readAsDataURL(file)
  }

  const send = async () => {
    if ((!input.trim() && !attachedImage) || loading) return
    const userMsg = { role: 'user', content: input.trim() || '(foto anexada)', image: attachedImage }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachedImage(null)
    setLoading(true)
    try {
      const resp = await fetch('/api/admin-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })
      const data = await resp.json()
      if (data.error) {
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ Erro: ${data.error}` }])
      } else {
        setMessages(m => [...m, { role: 'assistant', content: data.reply, toolLog: data.toolLog }])
      }
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ Erro de conexão: ${e.message}` }])
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: compact ? '100%' : 'calc(100vh - 140px)' }}>
      {!compact && <div className="card-title" style={{ marginBottom: 12 }}>✨ Assistente de IA</div>}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: compact ? '12px' : '0 4px 0 0' }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <div style={{
              background: m.role === 'user' ? 'linear-gradient(135deg,#1a3a5c,#0f2540)' : '#fff',
              color: m.role === 'user' ? '#fff' : 'var(--text)',
              borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              padding: '11px 15px',
              fontSize: 13.5,
              lineHeight: 1.5,
              boxShadow: m.role === 'user' ? 'none' : '0 1px 3px rgba(0,0,0,0.08)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
            }}>
              {m.image && (
                <img src={m.image.dataUrl} alt="anexo" style={{ maxWidth: '100%', borderRadius: 10, marginBottom: 8, display: 'block' }} />
              )}
              {formatText(m.content)}
              {m.toolLog && m.toolLog.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text3)', cursor: 'pointer', userSelect: 'none' }}>
                    🔧 {m.toolLog.length} ação(ões) no sistema
                  </summary>
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                    {m.toolLog.map((t, j) => (
                      <div key={j} style={{ fontSize: 10.5, color: t.ok ? 'var(--green)' : 'var(--red)', fontFamily: 'monospace', marginBottom: 2 }}>
                        {t.ok ? '✓' : '✗'} {t.name}({JSON.stringify(t.args)})
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '11px 15px' }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: '50%', background: 'var(--text3)',
                animation: `aiDotPulse 1.2s ${i * 0.15}s infinite ease-in-out`,
              }} />
            ))}
            <style>{`@keyframes aiDotPulse { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {attachedImage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 10, marginTop: 8 }}>
          <img src={attachedImage.dataUrl} alt="preview" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
          <span style={{ fontSize: 12, color: 'var(--text3)', flex: 1 }}>Foto anexada</span>
          <button onClick={() => setAttachedImage(null)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, padding: compact ? '12px' : '12px 0 0' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Anexar foto"
          style={{ border: '1px solid var(--border)', background: '#fff', borderRadius: 12, width: 42, alignSelf: 'flex-end', cursor: 'pointer', fontSize: 17 }}
        >📷</button>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte, peça uma mudança, ou anexa uma foto..."
          rows={compact ? 1 : 2}
          style={{ flex: 1, resize: 'none', borderRadius: 12, border: '1px solid var(--border)', padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit' }}
        />
        <button className="btn btn-primary" onClick={send} disabled={loading} style={{ alignSelf: 'flex-end' }}>
          Enviar
        </button>
      </div>
    </div>
  )
}
