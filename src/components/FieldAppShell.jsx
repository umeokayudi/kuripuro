import { useEffect, useState } from 'react'
import LanguageToggle from './LanguageToggle'

// Phone-first frame shared by the seller and marketing portals, built like the
// employee portal: small brand header with bell + menu, a greeting card, the
// screen, and a bottom bar with a big round "+" in the middle.

export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  return now
}

export function greetingFor(date, lang) {
  const h = date.getHours()
  if (lang === 'ja') return h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Sheet({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('fa-sheet-open')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('fa-sheet-open') }
  }, [onClose])
  return (
    <div className="fa-sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <section className={`fa-sheet${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="fa-sheet-grip" aria-hidden="true" />
        <header className="fa-sheet-head"><h2>{title}</h2><button type="button" className="fa-icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="fa-sheet-body">{children}</div>
      </section>
    </div>
  )
}

export default function FieldAppShell({
  kicker, userName, lang, bellCount = 0, onBell, menuItems = [], onLogout, logoutLabel = 'Log out',
  tabs, tab, onTab, onPlus, plusLabel, statusChip, children,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const now = useClock()
  const first = String(userName || '').split(' ')[0]
  const left = tabs.slice(0, 2)
  const right = tabs.slice(2, 4)
  const navButton = item => (
    <button key={item.key} type="button" className={`fa-nav-item${tab === item.key ? ' is-active' : ''}`} aria-current={tab === item.key ? 'page' : undefined}
      onClick={() => item.key === 'more' ? setMenuOpen(true) : onTab(item.key)}>
      <span className="fa-nav-icon" aria-hidden="true">{item.icon}</span>
      <span className="fa-nav-label">{item.label}</span>
      {item.badge > 0 && <span className="fa-nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>}
    </button>
  )

  return (
    <div className="fa-app">
      <header className="fa-header">
        <div className="fa-brand"><span className="fa-mark">KP</span><span>{kicker}</span></div>
        <div className="fa-header-actions">
          <button type="button" className="fa-icon-btn fa-bell" aria-label={lang === 'ja' ? 'お知らせ' : 'Notifications'} onClick={onBell}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            {bellCount > 0 && <span className="fa-bell-count">{bellCount > 99 ? '99+' : bellCount}</span>}
          </button>
          <button type="button" className="fa-icon-btn" aria-label={lang === 'ja' ? 'メニュー' : 'Menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
        </div>
      </header>

      <div className="fa-hello">
        <div>
          <h1>{greetingFor(now, lang)}, {first}!</h1>
          <p>{now.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="fa-clock">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      </div>
      {statusChip}

      <main className="fa-content">{children}</main>

      <nav className="fa-bottom-nav" aria-label={lang === 'ja' ? 'メインナビゲーション' : 'Main navigation'}>
        {left.map(navButton)}
        <button type="button" className="fa-plus" aria-label={plusLabel} title={plusLabel} onClick={onPlus}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        {right.map(navButton)}
      </nav>

      {menuOpen && <Sheet title={lang === 'ja' ? 'メニュー' : 'Menu'} onClose={() => setMenuOpen(false)}>
        <div className="fa-menu-list">
          {menuItems.map(item => (
            <button key={item.key} type="button" className={`fa-menu-item${tab === item.key ? ' is-active' : ''}`} onClick={() => { setMenuOpen(false); item.onClick ? item.onClick() : onTab(item.key) }}>
              <span className="fa-menu-icon" aria-hidden="true">{item.icon}</span>
              <span className="fa-menu-copy"><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
              {item.badge > 0 && <span className="fa-nav-badge is-inline">{item.badge}</span>}
              <span aria-hidden="true" className="fa-chevron">›</span>
            </button>
          ))}
        </div>
        <div className="fa-menu-footer">
          <LanguageToggle variant="light" />
          <button type="button" className="fa-btn fa-btn-ghost is-danger" onClick={onLogout}>{logoutLabel}</button>
        </div>
      </Sheet>}
    </div>
  )
}
