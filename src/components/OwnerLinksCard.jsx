// v1.0.240 · Usuários → "Conta do dono e contas vinculadas". Only the owner (or, before anyone
// owns it, an admin claiming his own login) ever sees this card; every rule is enforced again on
// the server (api/_owner-view.js).
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { fetchOwnerStatus, fetchOwnerLog, claimOwner, saveOwnerLinks } from '../lib/ownerView'

export default function OwnerLinksCard({ me, rows = [] }) {
  const { tr, lang } = useLang()
  const [status, setStatus] = useState(null)
  const [employeeId, setEmployeeId] = useState('')
  const [sellerId, setSellerId] = useState('')
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const s = await fetchOwnerStatus({ fresh: true })
    setStatus(s)
    if (s?.isOwner) {
      setEmployeeId(s.saved?.employee_id || '')
      setSellerId(s.saved?.salesperson_id || '')
      fetchOwnerLog().then(setLog).catch(() => setLog([]))
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (status?.isOwner && window.location.hash === '#conta-do-dono') document.getElementById('conta-do-dono')?.scrollIntoView({ block: 'start' })
  }, [status?.isOwner])

  // Other admins (and anyone once an owner exists) see nothing at all.
  if (!status || (!status.isOwner && !status.canClaim)) return null

  const employees = rows.filter(r => r.type === 'employee' && r.active)
  const sellers = rows.filter(r => r.type === 'salesperson' && r.active)
  const fmt = iso => new Date(iso).toLocaleString(localeOf(lang), { timeZone: 'Asia/Tokyo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const roleName = r => r === 'employee' ? tr('Cleaner', '清掃スタッフ', 'Limpador') : r === 'salesperson' ? tr('Seller', '営業', 'Vendedor') : 'Admin'

  const claim = async () => {
    setBusy(true)
    try { await claimOwner(); toast.success(tr('Saved', '保存しました', 'Salvo')); await load() } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try {
      await saveOwnerLinks({ employee_id: employeeId || null, salesperson_id: sellerId || null })
      toast.success(tr('Saved — the View as menu is on your name, top right', '保存しました', 'Salvo — o menu Ver como fica no seu nome, no canto de cima'))
      await load()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <section id="conta-do-dono" className="kp-users-section">
      <div className="kp-users-section-head">
        <span className="kp-type-badge kp-type-admin">{tr('Owner account and linked accounts', 'オーナーと連携アカウント', 'Conta do dono e contas vinculadas')}</span>
      </div>
      <div className="card kp-owner-card">
        {!status.isOwner ? (
          <>
            <p className="kp-owner-card-text">
              {tr('No owner account is set yet. The owner is the only login that gets the "View as" button; nobody else ever sees it.',
                'オーナーアカウントはまだ設定されていません。',
                'Ainda não há conta do dono. Só a conta do dono recebe o botão "Ver como"; ninguém mais vê esse botão.')}
            </p>
            <p className="kp-owner-card-text">
              {tr(`Setting it makes THIS login (${me?.name || ''}) the owner. After that only this login can change it.`,
                `このログイン（${me?.name || ''}）をオーナーにします。`,
                `Isso define ESTE login (${me?.name || ''}) como dono. Depois disso, só este login pode mudar.`)}
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={claim} disabled={busy}>
              {tr('Set this login as the owner', 'このログインをオーナーにする', 'Definir este login como dono')}
            </button>
          </>
        ) : (
          <>
            <p className="kp-owner-card-text">
              {tr('Owner', 'オーナー', 'Dono')}: <strong>{status.owner?.name || me?.name}</strong>.{' '}
              {tr('Link ONE employee login and ONE sales login that are yours. Only you see "View as"; everyone else keeps only their own area.',
                '自分の従業員ログインと営業ログインを1つずつ連携します。',
                'Vincule UM login de funcionário e UM login de vendas que são seus. Só você vê o "Ver como"; os outros continuam vendo só a própria área.')}
            </p>
            <div className="kp-owner-card-grid">
              <div className="form-group">
                <label htmlFor="owner-emp">{tr('Your Cleaner profile', '清掃スタッフのプロフィール', 'Seu perfil de Limpador')}</label>
                <select id="owner-emp" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">{tr('— none —', '— なし —', '— nenhum —')}</option>
                  {employees.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {status.saved?.employee_id && !status.links?.employee && <small className="kp-owner-warn">{tr('The saved employee login is inactive.', '保存された従業員は無効です。', 'O funcionário salvo está inativo.')}</small>}
              </div>
              <div className="form-group">
                <label htmlFor="owner-seller">{tr('Your Seller profile', '営業のプロフィール', 'Seu perfil de Vendedor')}</label>
                <select id="owner-seller" value={sellerId} onChange={e => setSellerId(e.target.value)}>
                  <option value="">{tr('— none —', '— なし —', '— nenhuma —')}</option>
                  {sellers.map(r => <option key={r.id} value={r.id}>{r.name}{r.team === 'marketing' ? ' · Marketing' : ''}</option>)}
                </select>
                {status.saved?.salesperson_id && !status.links?.salesperson && <small className="kp-owner-warn">{tr('The saved sales login is inactive.', '保存された営業は無効です。', 'A conta de vendas salva está inativa.')}</small>}
              </div>
            </div>
            <div><button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{tr('Save', '保存', 'Salvar')}</button></div>
            <div className="kp-owner-log">
              <div className="kp-owner-log-title">{tr('Switch log', '切り替え履歴', 'Registro das trocas')}</div>
              {log.filter(l => l.action === 'switch').slice(0, 10).map((l, i) => (
                <div key={l.at + i} className="kp-owner-log-row">
                  <span>{fmt(l.at)}</span>
                  <span>{l.to === 'admin'
                    ? <>{tr('Back to', '戻った：', 'Voltou para o')} <strong>Admin</strong> ({tr('from', '元', 'saiu de')} {roleName(l.from)})</>
                    : <>{tr('Entered as', '切り替え：', 'Entrou como')} <strong>{roleName(l.to)}</strong> ({l.to_name})</>}</span>
                </div>
              ))}
              {!log.some(l => l.action === 'switch') && <div className="kp-owner-log-row"><span>{tr('No switches yet.', 'まだありません。', 'Nenhuma troca ainda.')}</span></div>}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
