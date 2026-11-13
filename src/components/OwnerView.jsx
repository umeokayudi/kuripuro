// v1.0.240/251 · "Ver como" do dono: menu on the admin avatar + two direct buttons in the side menu (only for the owner) + the fixed
// "Você está vendo como…" strip shown in the employee / sales portals while the owner views them.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { fetchOwnerStatus, savedViewAs, switchView, clearViewAs } from '../lib/ownerView'

// v1.0.251 · the owner's own profiles are named by what he does there: Limpador / Vendedor.
export function profileLabel(tr, role, team) {
  if (role === 'employee') return tr('Cleaner', '清掃スタッフ', 'Limpador')
  if (role === 'salesperson') return team === 'marketing' ? tr('Marketing', 'マーケティング', 'Marketing') : tr('Seller', '営業', 'Vendedor')
  return tr('Admin', '管理者', 'Admin')
}

/**
 * v1.0.251 · Owner only: the two direct buttons to enter his own Seller / Cleaner profile for real.
 * Renders nothing for anybody else; the server refuses the switch for anybody else too.
 */
export function OwnerSwitchButtons({ className = 'sidebar-logout sidebar-switch' }) {
  const { tr } = useLang()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    let alive = true
    fetchOwnerStatus().then(s => { if (alive) setStatus(s) })
    return () => { alive = false }
  }, [])
  if (!status?.isOwner || status.viewing) return null
  const links = status.links || {}
  const items = [
    links.salesperson && { to: 'salesperson', label: profileLabel(tr, 'salesperson', links.salesperson.team), name: links.salesperson.name },
    links.employee && { to: 'employee', label: profileLabel(tr, 'employee'), name: links.employee.name },
  ].filter(Boolean)
  if (!items.length) return null
  const go = async to => {
    setBusy(to)
    try { await switchView(to) } catch (e) { toast.error(e.message); setBusy('') }
  }
  return items.map(o => (
    <button key={o.to} type="button" className={className} disabled={Boolean(busy)} onClick={() => go(o.to)}
      title={tr('Enter this profile for real (no password). The top strip brings you back.', 'このプロフィールに切り替えます', 'Entra neste perfil de verdade (sem senha). A faixa no topo traz você de volta.')}>
      {busy === o.to ? '…' : `${o.label} (${o.name})`}
    </button>
  ))
}

/**
 * The avatar block of the admin topbar. For everyone except the owner it renders exactly the
 * same block as before; for the owner the same block opens a small "Ver como" menu.
 */
export function OwnerUserMenu({ user, roleText }) {
  const { tr } = useLang()
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    fetchOwnerStatus().then(s => { if (alive) setStatus(s) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])

  const block = (
    <>
      <div className="ref-avatar">{(user.name || 'A').slice(0, 2).toUpperCase()}</div>
      <div><div className="ref-user-name">{user.name}</div><div className="ref-user-role">{roleText}</div></div>
    </>
  )
  if (!status?.isOwner) return <div className="ref-user">{block}</div>

  const go = async to => {
    setBusy(to)
    try { await switchView(to) } catch (e) { toast.error(e.message); setBusy('') }
  }
  const links = status.links || {}
  const options = [
    { to: 'admin', label: tr('Administrator', '管理者', 'Administrador'), name: user.name, current: true },
    links.salesperson && { to: 'salesperson', label: profileLabel(tr, 'salesperson', links.salesperson.team), name: links.salesperson.name },
    links.employee && { to: 'employee', label: profileLabel(tr, 'employee'), name: links.employee.name },
  ].filter(Boolean)

  return (
    <div className="ref-user kp-owner-menu" ref={ref}>
      <button type="button" className="kp-owner-trigger" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open} title={tr('View as', '表示を切り替え', 'Ver como')}>
        {block}<span className="kp-owner-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="kp-owner-pop" role="menu">
          <div className="kp-owner-pop-title">{tr('View as', '表示を切り替え', 'Ver como')}</div>
          {options.map(o => (
            <button key={o.to} type="button" role="menuitem" className={`kp-owner-opt${o.current ? ' is-current' : ''}`} disabled={o.current || Boolean(busy)} onClick={() => go(o.to)}>
              <span className="kp-owner-opt-main"><strong>{o.label}</strong><small>{o.name}</small></span>
              <span className="kp-owner-opt-side">{o.current ? '✓' : busy === o.to ? '…' : '→'}</span>
            </button>
          ))}
          {options.length === 1 && <div className="kp-owner-pop-note">{tr('No linked accounts yet.', '連携アカウントはまだありません。', 'Nenhuma conta vinculada ainda.')}</div>}
          <a className="kp-owner-pop-link" href="/users#conta-do-dono">{tr('Owner account and linked accounts', 'オーナーと連携アカウント', 'Conta do dono e contas vinculadas')}</a>
        </div>
      )}
    </div>
  )
}

/** Strip on top of the employee / sales / marketing portal while the owner is viewing it. */
export function OwnerViewBanner({ user }) {
  const { tr } = useLang()
  const [viewing, setViewing] = useState(() => savedViewAs())
  const [busy, setBusy] = useState(false)

  // The server has the last word: a stale local flag (or a real employee on this phone) shows nothing.
  useEffect(() => {
    if (!savedViewAs()) return
    let alive = true
    fetchOwnerStatus({ fresh: true }).then(s => {
      if (!alive) return
      if (s?.viewing) setViewing(s.viewing)
      else { clearViewAs(); setViewing(null) }
    })
    return () => { alive = false }
  }, [user?.id])

  if (!viewing || !user || user.role === 'admin') return null
  const back = async () => {
    setBusy(true)
    try { await switchView('admin') } catch (e) { toast.error(e.message); setBusy(false) }
  }
  return (
    <div className="kp-owner-banner" role="status">
      <span className="kp-owner-banner-text">
        {tr('You are viewing as', '表示中：', 'Você está vendo como')} <strong>{profileLabel(tr, viewing.role, viewing.team)}</strong> — {viewing.name || user.name}
      </span>
      <button type="button" className="kp-owner-banner-back" onClick={back} disabled={busy}>{busy ? '…' : tr('Back to Admin', '管理者に戻る', 'Voltar para o Admin')}</button>
    </div>
  )
}
