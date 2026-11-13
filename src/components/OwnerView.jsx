// v1.0.240/253 · Owner only. Everything lives in the menu that opens by clicking the owner's NAME
// (top right): "Ver como…" (read only, v1.0.234) + "Entrar como Vendedor" / "Entrar como Funcionário"
// (REAL session of his own linked accounts) + the switch log. The server (api/_owner-view.js)
// decides who is the owner and which two accounts are his; nobody else gets any of this.
// While inside a linked account, OwnerViewBanner shows the fixed "Você está como…" strip.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { isOwner } from '../lib/viewAs'
import { fetchOwnerStatus, fetchOwnerLog, savedViewAs, switchView, clearViewAs } from '../lib/ownerView'

const ViewAsPicker = lazy(() => import('./ViewAs'))

export function profileLabel(tr, role, team) {
  if (role === 'employee') return tr('Employee', '従業員', 'Funcionário')
  if (role === 'salesperson') return team === 'marketing' ? tr('Marketing', 'マーケティング', 'Marketing') : tr('Seller', '営業', 'Vendedor')
  return tr('Admin', '管理者', 'Admin')
}

function SwitchLog({ tr, lang }) {
  const [log, setLog] = useState(null)
  useEffect(() => { fetchOwnerLog().then(setLog).catch(() => setLog([])) }, [])
  const rows = (log || []).filter(l => l.action === 'switch').slice(0, 5)
  const fmt = iso => new Date(iso).toLocaleString(localeOf(lang), { timeZone: 'Asia/Tokyo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="kp-owner-log kp-owner-pop-log">
      <div className="kp-owner-log-title">{tr('Switch log (only you see it)', '切り替え履歴（あなたのみ）', 'Registro das trocas (só você vê)')}</div>
      {log === null ? <div className="kp-owner-log-row"><span>…</span></div>
        : rows.length ? rows.map((l, i) => (
          <div key={l.at + i} className="kp-owner-log-row">
            <span>{fmt(l.at)}</span>
            <span>{profileLabel(tr, l.from)} → <strong>{profileLabel(tr, l.to)}</strong>{l.to !== 'admin' && l.to_name ? ` (${l.to_name})` : ''}</span>
          </div>
        )) : <div className="kp-owner-log-row"><span>{tr('No switches yet.', 'まだありません。', 'Nenhuma troca ainda.')}</span></div>}
    </div>
  )
}

/**
 * The avatar block of the admin topbar. For everyone except the owner it renders exactly the
 * same block as before; for the owner the same block opens the menu.
 */
export function OwnerUserMenu({ user, roleText }) {
  const { tr, lang } = useLang()
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [viewAs, setViewAs] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    fetchOwnerStatus({ fresh: true }).then(s => { if (alive) setStatus(s) })
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
  const realSwitch = Boolean(status?.isOwner)
  const readOnly = isOwner(user)
  if (!realSwitch && !readOnly) return <div className="ref-user">{block}</div>

  const go = async to => {
    setBusy(to)
    try { await switchView(to) } catch (e) { toast.error(e.message); setBusy('') }
  }
  const links = status?.links || {}
  const entries = realSwitch ? [
    links.salesperson && { to: 'salesperson', label: tr('Enter as Seller', '営業として入る', 'Entrar como Vendedor'), name: links.salesperson.name },
    links.employee && { to: 'employee', label: tr('Enter as Employee (Cleaner)', '従業員（清掃）として入る', 'Entrar como Funcionário (Limpador)'), name: links.employee.name },
  ].filter(Boolean) : []

  return (
    <div className="ref-user kp-owner-menu" ref={ref}>
      <button type="button" className="kp-owner-trigger" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open} title={tr('View as', '表示を切り替え', 'Ver como')}>
        {block}<span className="kp-owner-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="kp-owner-pop" role="menu">
          {readOnly && (
            <button type="button" role="menuitem" className="kp-owner-opt" onClick={() => { setOpen(false); setViewAs(true) }}>
              <span className="kp-owner-opt-main"><strong>{tr('View as…', '画面を見る…', 'Ver como…')}</strong><small>{tr('read only, any login', '表示のみ', 'somente leitura, qualquer login')}</small></span>
              <span className="kp-owner-opt-side">👁</span>
            </button>
          )}
          {entries.map(o => (
            <button key={o.to} type="button" role="menuitem" className="kp-owner-opt" disabled={Boolean(busy)} onClick={() => go(o.to)}>
              <span className="kp-owner-opt-main"><strong>{o.label}</strong><small>{o.name} · {tr('real session', '実際のセッション', 'sessão real')}</small></span>
              <span className="kp-owner-opt-side">{busy === o.to ? '…' : '→'}</span>
            </button>
          ))}
          {realSwitch && <SwitchLog tr={tr} lang={lang} />}
        </div>
      )}
      {viewAs && <Suspense fallback={null}><ViewAsPicker onClose={() => setViewAs(false)} /></Suspense>}
    </div>
  )
}

/** Strip on top of the employee / sales / marketing portal while the owner is inside it. */
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
        {tr('You are signed in as', '現在のログイン：', 'Você está como')} <strong>{profileLabel(tr, viewing.role, viewing.team).toUpperCase()}</strong> — {viewing.name || user.name}
      </span>
      <button type="button" className="kp-owner-banner-back" onClick={back} disabled={busy}>{busy ? '…' : tr('Back to Admin', '管理者に戻る', 'Voltar para o Admin')}</button>
    </div>
  )
}
