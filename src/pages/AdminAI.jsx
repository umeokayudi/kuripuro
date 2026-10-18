import { useState } from 'react'
import AIChatPanel from '../components/AIChatPanel'

const SUGGESTIONS = [
  { icon: '◉', title: 'Visão geral', hint: 'O que precisa da sua atenção hoje', prompt: 'Me mostre tudo que precisa da minha atenção hoje.' },
  { icon: '¥', title: 'Financeiro', hint: 'Faturamento, custos e margem do mês', prompt: 'Analise meu financeiro deste mês: faturamento, recebido, a receber, custos, lucro e margem.' },
  { icon: '▦', title: 'Operação', hint: 'Atrasados, pendentes ou em risco', prompt: 'Analise a operação de hoje e me diga o que está atrasado, pendente ou em risco.' },
  { icon: '◎', title: 'Clientes', hint: 'Em risco e menos lucrativos', prompt: 'Quais clientes estão em risco e quais são os menos lucrativos?' },
  { icon: '♙', title: 'Equipe', hint: 'Quem precisa de atenção', prompt: 'Analise a produtividade dos funcionários e destaque quem precisa de atenção.' },
  { icon: '▤', title: 'Cobranças', hint: 'O que já foi faturado e o que falta', prompt: 'Verifique as cobranças deste mês e me diga o que já foi faturado e o que falta.' },
]

export default function AdminAI() {
  const [chatKey, setChatKey] = useState(0)

  return (
    <div className="ai-command-center">
      <div className="ai-command-topbar">
        <div>
          <div className="eyebrow">KURIPURO AI</div>
          <p>Pergunte, analise ou peça para executar. A IA trabalha com os dados do Kuripuro.</p>
        </div>
        <button type="button" className="btn ai-new-chat" onClick={() => setChatKey(v => v + 1)}>
          ＋ Novo chat
        </button>
      </div>

      <div className="ai-command-layout">
        <aside className="ai-command-sidebar">
          <div className="ai-side-title">O que posso fazer</div>
          <div className="ai-capability">
            <span>⌕</span><div><strong>Analisar</strong><small>Financeiro, operação, equipe e clientes</small></div>
          </div>
          <div className="ai-capability">
            <span>↗</span><div><strong>Executar</strong><small>Criar e atualizar tarefas e registros</small></div>
          </div>
          <div className="ai-capability">
            <span>◈</span><div><strong>Decidir</strong><small>Encontrar problemas e prioridades</small></div>
          </div>
          <div className="ai-side-note">
            <strong>Dica</strong>
            <p>Você não precisa saber o nome da tela. Diga o que quer fazer em linguagem normal.</p>
          </div>
        </aside>

        <main className="ai-command-chat">
          <AIChatPanel key={chatKey} newChatId={chatKey} mode="admin" suggestions={SUGGESTIONS} />
        </main>
      </div>
    </div>
  )
}
