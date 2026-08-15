import { useState, useRef, useEffect } from 'react'

export default function AdminAI() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Oi! Sou o assistente de IA do KuriPuro. Posso consultar dados do sistema (jobs, funcionários, clientes, pagamentos, reclamações, avaliações) e também fazer mudanças — adicionar, editar ou apagar informações — quando você pedir.\n\nExperimenta perguntar algo como "quantos jobs o André completou essa semana" ou "adiciona uma reclamação pro Gabriel sobre atraso".' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', maxWidth: 760 }}>
      <div className="card-title" style={{ marginBottom: 12 }}>✨ Assistente de IA</div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: m.role === 'user' ? 'var(--navy)' : 'var(--surface2)',
            color: m.role === 'user' ? '#fff' : 'var(--text)',
            borderRadius: 14,
            padding: '10px 14px',
            fontSize: 14,
            whiteSpace: 'pre-wrap',
          }}>
            {m.content}
            {m.toolLog && m.toolLog.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
                {m.toolLog.map((t, j) => (
                  <div key={j} style={{ fontSize: 11, color: t.ok ? 'var(--green)' : 'var(--red)', fontFamily: 'monospace' }}>
                    {t.ok ? '✓' : '✗'} {t.name}({JSON.stringify(t.args)})
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text3)', fontSize: 13, padding: '10px 14px' }}>
            Pensando...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte ou peça uma mudança nos dados..."
          rows={2}
          style={{ flex: 1, resize: 'none', borderRadius: 12, border: '1px solid var(--border)', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit' }}
        />
        <button className="btn btn-primary" onClick={send} disabled={loading} style={{ alignSelf: 'flex-end' }}>
          Enviar
        </button>
      </div>
    </div>
  )
}
