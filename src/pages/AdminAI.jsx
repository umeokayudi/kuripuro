import { useState, useMemo } from 'react'
import AIChatPanel from '../components/AIChatPanel'
import { useLang } from '../hooks/useLang'

const SUGGESTIONS = {
  en: [
    { icon: '◉', title: 'Overview', prompt: 'Show me everything that needs my attention today.' },
    { icon: '¥', title: 'Finance', prompt: 'Analyze my finances this month: revenue, received, receivables, costs, profit and margin.' },
    { icon: '▦', title: 'Operations', prompt: 'Analyze today\'s operations and tell me what is delayed, pending or at risk.' },
    { icon: '◎', title: 'Clients', prompt: 'Which clients are at risk and which are the least profitable?' },
    { icon: '♙', title: 'Team', prompt: 'Analyze employee productivity and highlight who needs attention.' },
    { icon: '▤', title: 'Collections', prompt: 'Check this month\'s billing and tell me what has been invoiced and what is still missing.' },
  ],
  ja: [
    { icon: '◉', title: '概要', prompt: '今日、私が確認すべきことをすべて見せてください。' },
    { icon: '¥', title: '財務', prompt: '今月の財務を分析してください。売上、入金、未収金、コスト、利益、利益率を確認したいです。' },
    { icon: '▦', title: 'オペレーション', prompt: '今日の業務を分析して、遅延、保留、リスクのあるものを教えてください。' },
    { icon: '◎', title: 'クライアント', prompt: 'リスクのあるクライアントと、利益率の低いクライアントを教えてください。' },
    { icon: '♙', title: 'チーム', prompt: '従業員の生産性を分析して、注意が必要な人を教えてください。' },
    { icon: '▤', title: '請求', prompt: '今月の請求を確認して、請求済みと未請求のものを教えてください。' },
  ],
}

export default function AdminAI() {
  const [chatKey, setChatKey] = useState(0)
  const { lang, t } = useLang()
  const ai = t.ai || {}
  const copy = ai.commandCenter || {}
  const suggestions = useMemo(() => SUGGESTIONS[lang] || SUGGESTIONS.en, [lang])

  return (
    <div className="ai-command-center">
      <div className="ai-command-topbar">
        <div>
          <div className="eyebrow">KURIPURO AI</div>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <button type="button" className="btn ai-new-chat" onClick={() => setChatKey(v => v + 1)}>
          {copy.newChat}
        </button>
      </div>

      <div className="ai-command-layout">
        <aside className="ai-command-sidebar">
          <div className="ai-side-title">{copy.capabilities}</div>
          <div className="ai-capability">
            <span>⌕</span><div><strong>{copy.analyze}</strong><small>{copy.analyzeHint}</small></div>
          </div>
          <div className="ai-capability">
            <span>↗</span><div><strong>{copy.execute}</strong><small>{copy.executeHint}</small></div>
          </div>
          <div className="ai-capability">
            <span>◈</span><div><strong>{copy.decide}</strong><small>{copy.decideHint}</small></div>
          </div>
          <div className="ai-side-note">
            <strong>{copy.tipTitle}</strong>
            <p>{copy.tipText}</p>
          </div>
        </aside>

        <main className="ai-command-chat">
          <AIChatPanel key={chatKey} newChatId={chatKey} mode="admin" suggestions={suggestions} />
        </main>
      </div>
    </div>
  )
}
