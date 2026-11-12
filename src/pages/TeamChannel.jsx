// v1.0.217 · Admin page of the Canal da Equipe (the admin sees and takes part in everything).
import TeamChannel from '../components/TeamChannel'
import { useAuth } from '../hooks/useAuth'
import { useLang, pickLang } from '../hooks/useLang'

export default function TeamChannelPage() {
  const { user } = useAuth() || {}
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  if (!user) return null
  return (
    <div className="page-container" style={{ padding: '16px 14px 24px' }}>
      <TeamChannel me={{ role: 'admin', id: user.id, name: user.name || 'Escritório' }} lang={lang} L={L} />
    </div>
  )
}
