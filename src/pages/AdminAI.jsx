import { useLang } from '../hooks/useLang'
import AIChatPanel from '../components/AIChatPanel'

export default function AdminAI() {
  const { t } = useLang()
  const ai = t.ai

  const suggestions = [
    ai.suggestToday,
    ai.suggestSales,
    ai.suggestInvoices,
    ai.suggestPayroll,
    ai.suggestClients,
    ai.suggestStaff,
  ].filter(Boolean)

  return (
    <div className="ai-workspace">
      <AIChatPanel mode="admin" workspace suggestions={suggestions} />
    </div>
  )
}
