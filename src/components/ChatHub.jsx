// v1.0.225 · Employee Chat tab = one list of conversations (no second chat system):
//   • Escritório (privado) — the existing office chat (table messages)
//   • Grupos — the area channels of v1.0.221 (Geral, Limpeza with every cleaner + cover cards)
//   • Gerência — start a private conversation with management (admins + leader / supervisor employees),
//     stored like the channels (Storage JSON, folder team-channel/dm/<a>__<b>)
// Opening a group or a private conversation renders TeamChannel with `focus` (one conversation + back button).
import { useEffect, useState } from 'react'
import FaceAvatar from './FaceAvatar'
import { CHANNELS, myChannels, managersOf, dmKey, dmOther, channelLabel } from '../lib/teamChannel'
import { loadMembers, loadPeople, listMyDms } from '../lib/teamChannelOps'
import './team-channel.css'

export default function ChatHub({ me, lang = 'pt', L = (en, ja, pt) => pt, officeUnread = 0, officeLast = '', coverCount = 0, onOpen }) {
  const [members, setMembers] = useState(null)
  const [people, setPeople] = useState([])
  const [dms, setDms] = useState([])

  useEffect(() => {
    let alive = true
    Promise.all([loadMembers().catch(() => null), loadPeople().catch(() => []), listMyDms(me).catch(() => [])]).then(([m, p, d]) => {
      if (!alive) return
      setMembers(m); setPeople(p || []); setDms(d || [])
    })
    return () => { alive = false }
  }, [me?.id, me?.role])

  const meFull = people.find(p => p.role === me?.role && p.id === me?.id) || { ...me, is_active: true }
  const groups = members ? myChannels(meFull, members) : []
  const managers = managersOf(people, me)
  const managerKeys = new Set(managers.map(p => { try { return dmKey(me, p) } catch { return null } }).filter(Boolean))
  // private conversations someone else started with me (not with a manager in the list)
  const otherDms = dms.filter(k => !managerKeys.has(k))

  const groupHint = k => k === 'limpeza'
    ? L('Every cleaner · cover requests', '清掃スタッフ全員・代わり募集', 'Todos os limpadores · pedidos de cobertura')
    : k === 'geral' ? L('The whole team and the office', 'チーム全員と事務所', 'Toda a equipe e o escritório')
      : L('Group of the area', 'エリアのグループ', 'Grupo da área')
  const roleHint = p => p.role === 'admin' ? L('Management · office', '管理者・事務所', 'Gerência · escritório')
    : p.job_role === 'supervisor' ? L('Supervisor', 'スーパーバイザー', 'Supervisor') : L('Leader', 'リーダー', 'Líder')
  const face = p => (p?.role === 'admin'
    ? <span className="ch-ico ch-office">KP</span>
    : <FaceAvatar id={p?.id} name={p?.name} size={40} className="tc-av" />)

  const row = ({ key, icon, title, hint, badge = 0, onClick }) => (
    <button key={key} type="button" className="ch-row" onClick={onClick}>
      {icon}
      <span className="ch-txt"><strong>{title}</strong>{hint && <small>{hint}</small>}</span>
      {badge > 0 && <span className="ch-badge">{badge}</span>}
      <span className="ch-go" aria-hidden="true">›</span>
    </button>
  )

  return (
    <div className="ch-hub">
      <section className="ch-sec" aria-label={L('Office', '事務所', 'Escritório')}>
        <h3>🔒 {L('Office (private)', '事務所（個別）', 'Escritório (privado)')}</h3>
        {row({
          key: 'office', icon: <span className="ch-ico ch-office">KP</span>,
          title: L('KuriPuro office', 'KuriPuro 事務所', 'Escritório KuriPuro'),
          hint: officeLast || L('Only you and the office', 'あなたと事務所だけ', 'Só você e o escritório'),
          badge: officeUnread, onClick: () => onOpen?.('office'),
        })}
      </section>

      <section className="ch-sec" aria-label={L('Groups', 'グループ', 'Grupos')}>
        <h3>👥 {L('Groups', 'グループ', 'Grupos')}</h3>
        {members === null && <p className="tc-muted">{L('Loading…', '読み込み中…', 'Carregando…')}</p>}
        {members && groups.length === 0 && <p className="tc-muted">{L('You are not in any group yet. The office adds you.', 'まだグループに入っていません。事務所が追加します。', 'Você ainda não está em nenhum grupo. O escritório adiciona você.')}</p>}
        {groups.map(k => row({
          key: k, icon: <span className="ch-ico">{CHANNELS.find(c => c.key === k)?.icon}</span>,
          title: channelLabel(k, lang), hint: groupHint(k),
          badge: k === 'limpeza' ? coverCount : 0, onClick: () => onOpen?.(k),
        }))}
      </section>

      <section className="ch-sec" aria-label={L('Management', '管理者', 'Gerência')}>
        <h3>💬 {L('Talk to management', '管理者と話す', 'Falar com a gerência')}</h3>
        <p className="tc-muted">{L('Private: only you and the person see it.', '非公開：あなたと相手だけが見られます。', 'Privado: só você e a pessoa veem.')}</p>
        {members !== null && managers.length === 0 && <p className="tc-muted">{L('No one in management yet.', '管理者がまだいません。', 'Ninguém na gerência ainda.')}</p>}
        {managers.map(p => {
          const k = dmKey(me, p)
          return row({
            key: k, icon: face(p), title: p.name, hint: dms.includes(k) ? roleHint(p) : `${roleHint(p)} · ${L('Start a conversation', '会話を始める', 'Iniciar conversa')}`,
            onClick: () => onOpen?.(k),
          })
        })}
        {otherDms.map(k => {
          const p = dmOther(k, me, people)
          return row({ key: k, icon: face(p), title: p?.name || '—', hint: L('Private conversation', '個別の会話', 'Conversa privada'), onClick: () => onOpen?.(k) })
        })}
      </section>
    </div>
  )
}
