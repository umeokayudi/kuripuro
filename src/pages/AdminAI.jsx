import { useLang } from '../hooks/useLang'
import AIChatPanel from '../components/AIChatPanel'

export default function AdminAI() {
  const { t } = useLang()
  return (
    <div>
      <div className="page-head">
        <h2>{t.sidebar.ai}</h2>
        <p>{t.app.aiPageHint}</p>
      </div>
      <div style={{ maxWidth: 760 }}>
        <AIChatPanel mode="admin" />
      </div>
    </div>
  )
}
