import { useLang } from '../hooks/useLang'
import { APP_VERSION } from '../lib/appVersion'
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
      <div className="ai-workspace-head">
        <div>
          <div className="ai-workspace-kicker">{t.sidebar.ai} · {APP_VERSION}</div>
          <h2 className="page-head" style={{ margin: 0, fontSize: 22 }}>{ai.pageTitle}</h2>
          <p className="ai-workspace-hint">{ai.pageHint}</p>
        </div>
      </div>
      <AIChatPanel mode="admin" workspace suggestions={suggestions} />
    </div>
  )
}
