import { useEffect, useState } from 'react'
import AIChatPanel from '../components/AIChatPanel'

const SUGGESTIONS = [
  { icon: '◉', title: 'Visão geral', hint: 'O que precisa da sua atenção hoje', prompt: 'Me mostre tudo que precisa da minha atenção hoje.' },
  { icon: '¥', title: 'Financeiro', hint: 'Faturamento, custos e margem do mês', prompt: 'Analise meu financeiro deste mês: faturamento, recebido, a receber, custos, lucro e margem.' },
  { icon: '▦', title: 'Operação', hint: 'Atrasados, pendentes ou em risco', prompt: 'Analise a operação de hoje e me diga o que está atrasado, pendente ou em risco.' },
  { icon: '◎', title: 'Clientes', hint: 'Em risco e menos lucrativos', prompt: 'Quais clientes estão em risco e quais são os menos lucrativos?' },
  { icon: '♙', title: 'Equipe', hint: 'Quem precisa de atenção', prompt: 'Analise a produtividade dos funcionários e destaque quem precisa de atenção.' },
  { icon: '▤', title: 'Cobranças', hint: 'O que já foi faturado e o que falta', prompt: 'Verifique as cobranças deste mês e me diga o que já foi faturado e o que falta.' },
]

// v1.0.177 · "O que posso fazer": each capability opens quick actions.
// send: true → goes to the AI right away; false → fills the text box so the admin completes the details.
const CAPABILITIES = [
  {
    id: 'analyze', icon: '⌕', title: 'Analisar', hint: 'Financeiro, operação, equipe e clientes',
    actions: [
      { label: 'Financeiro do mês', send: true, prompt: 'Analise meu financeiro deste mês: faturamento, recebido, a receber, custos, lucro e margem.' },
      { label: 'Operação de hoje', send: true, prompt: 'Analise a operação de hoje e me diga o que está atrasado, pendente ou em risco.' },
      { label: 'Equipe', send: true, prompt: 'Analise a produtividade dos funcionários e destaque quem precisa de atenção.' },
      { label: 'Clientes', send: true, prompt: 'Quais clientes estão em risco e quais são os menos lucrativos?' },
    ],
  },
  {
    id: 'execute', icon: '↗', title: 'Executar', hint: 'Criar e atualizar tarefas e registros',
    actions: [
      { label: 'Criar um serviço', send: false, prompt: 'Crie um serviço para o cliente ' },
      { label: 'Mudar horário de um serviço', send: false, prompt: 'Mude o horário do serviço de ' },
      { label: 'Trocar funcionário de um serviço', send: false, prompt: 'Troque o funcionário do serviço de ' },
      { label: 'Registrar uma tarefa', send: false, prompt: 'Crie uma tarefa para ' },
    ],
  },
  {
    id: 'decide', icon: '◈', title: 'Decidir', hint: 'Encontrar problemas e prioridades',
    actions: [
      { label: 'O que fazer primeiro hoje', send: true, prompt: 'Me mostre tudo que precisa da minha atenção hoje, em ordem de prioridade.' },
      { label: 'Maiores problemas da semana', send: true, prompt: 'Quais são os maiores problemas desta semana e o que você sugere fazer em cada um?' },
      { label: 'Cobranças que faltam', send: true, prompt: 'Verifique as cobranças deste mês e me diga o que já foi faturado e o que falta.' },
    ],
  },
]

const EMPTY_USAGE = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, heavyCalls: 0, escalated: 0, model: null }
const fmtTokens = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export default function AdminAI() {
  const [chatKey, setChatKey] = useState(0)
  const [openCap, setOpenCap] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches ? null : 'analyze'))
  const [pending, setPending] = useState(null)
  // v1.0.233 · owner only (this page is admin-only): which AI answers and what this conversation cost.
  const [aiInfo, setAiInfo] = useState(null)
  const [convUsage, setConvUsage] = useState(EMPTY_USAGE)
  useEffect(() => {
    let alive = true
    fetch('/api/admin-ai').then(r => r.json()).then(d => { if (alive) setAiInfo(d?.ai || null) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const addUsage = u => setConvUsage(prev => ({
    calls: prev.calls + (u.calls || 0),
    inputTokens: prev.inputTokens + (u.inputTokens || 0),
    outputTokens: prev.outputTokens + (u.outputTokens || 0),
    costUsd: u.costUsd == null ? prev.costUsd : (prev.costUsd || 0) + u.costUsd,
    heavyCalls: prev.heavyCalls + (u.heavyCalls || 0),
    escalated: prev.escalated + (u.escalated?.length || 0),
    model: u.model || prev.model,
  }))

  const runAction = (action) => {
    setPending({ id: Date.now(), text: action.prompt, send: action.send })
    // phone: close the strip again so the chat and the text box get the space back
    if (window.matchMedia?.('(max-width: 900px)').matches) setOpenCap(null)
  }

  return (
    <div className="ai-command-center">
      <div className="ai-command-topbar">
        <div>
          <div className="eyebrow">KURIPURO AI</div>
          <p>Pergunte, analise ou peça para executar. A IA trabalha com os dados do Kuripuro.</p>
        </div>
        <button type="button" className="btn ai-new-chat" onClick={() => { setPending(null); setConvUsage(EMPTY_USAGE); setChatKey(v => v + 1) }}>
          ＋ Novo chat
        </button>
      </div>

      <div className="ai-command-layout">
        <aside className="ai-command-sidebar" aria-label="O que posso fazer">
          <div className="ai-side-title">O que posso fazer</div>
          <div className="ai-cap-list">
            {CAPABILITIES.map(cap => {
              const open = openCap === cap.id
              return (
                <div key={cap.id} className={`ai-cap${open ? ' is-open' : ''}`}>
                  <button type="button" className="ai-cap-head" aria-expanded={open}
                    onClick={() => setOpenCap(open ? null : cap.id)}>
                    <span className="ai-cap-icon" aria-hidden="true">{cap.icon}</span>
                    <span className="ai-cap-text">
                      <strong>{cap.title}</strong>
                      <small>{cap.hint}</small>
                    </span>
                    <span className="ai-cap-chevron" aria-hidden="true">›</span>
                  </button>
                  {open && (
                    <div className="ai-cap-actions">
                      {cap.actions.map(action => (
                        <button type="button" key={action.label} className="ai-cap-action" onClick={() => runAction(action)}
                          title={action.send ? 'Enviar para a IA' : 'Escrever no chat para completar'}>
                          <span>{action.label}</span>
                          <em aria-hidden="true">{action.send ? '→' : '✎'}</em>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {aiInfo && (
            <div className="ai-side-note">
              <strong>IA em uso</strong>
              <p>
                Provedor: {aiInfo.provider === 'muse' ? 'Meta (Muse)' : aiInfo.provider === 'gemini' ? 'Google (Gemini)' : aiInfo.provider}{aiInfo.configured ? '' : ' · chave não configurada'}<br />
                Modelo: {convUsage.model || aiInfo.model || '—'}<br />
                Esta conversa: {convUsage.calls} chamada{convUsage.calls === 1 ? '' : 's'} · {fmtTokens(convUsage.inputTokens + convUsage.outputTokens)} tokens · {convUsage.costUsd == null ? (convUsage.calls ? 'custo não informado' : 'US$ 0') : `≈ US$ ${convUsage.costUsd.toFixed(4)}`}
                {convUsage.heavyCalls > 0 && <><br />Modelo pesado usado {convUsage.heavyCalls}×{convUsage.escalated ? ` (${convUsage.escalated} subida${convUsage.escalated === 1 ? '' : 's'} automática${convUsage.escalated === 1 ? '' : 's'})` : ''}</>}
              </p>
            </div>
          )}
          <div className="ai-side-note">
            <strong>Dica</strong>
            <p>Você não precisa saber o nome da tela. Diga o que quer fazer em linguagem normal. → envia na hora · ✎ escreve no chat para você completar.</p>
          </div>
        </aside>

        <main className="ai-command-chat">
          <AIChatPanel key={chatKey} newChatId={chatKey} mode="admin" suggestions={SUGGESTIONS} pendingPrompt={pending} onUsage={addUsage} />
        </main>
      </div>
    </div>
  )
}
