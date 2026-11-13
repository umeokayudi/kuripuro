import { useEffect, useState } from 'react'
import { localeOf, pickLang } from '../hooks/useLang'
import { homeLogoProps } from '../lib/homeLogo'

// v1.0.254 · Header shared by the seller and marketing portals ("Cor que trabalha"):
//   top bar  → blue "K" (same box as the admin sidebar; tap = home) · area · date by extenso + live clock · bell · menu
//   home     → photo/initials + greeting + name (FieldHello), only on the first tab
// The date and the clock (with seconds) stay visible on every tab. The bell is the portal's own
// (bellCount / onBell come from the portal, so each profile shows its own notifications).

export function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  return now
}

export function greetingFor(date, lang) {
  const h = date.getHours()
  if (lang === 'ja') return h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
  if (lang === 'pt') return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export const initialsOf = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

/** Full date ("sexta-feira, 13 de novembro de 2026") + clock with seconds, ticking. */
export function FieldClock({ lang, compact = false }) {
  const now = useClock()
  const date = now.toLocaleDateString(localeOf(lang), compact
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="fh-clock" aria-live="off">
      <span className="fh-date">{date}</span>
      <time className="fh-time" dateTime={now.toISOString()}>{time}</time>
    </div>
  )
}

export function FieldAvatar({ name, photoUrl, size = 52 }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="fh-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {photoUrl && !broken ? <img src={photoUrl} alt="" onError={() => setBroken(true)} /> : initialsOf(name)}
    </span>
  )
}

/** Sticky top bar. `area` = "Vendas", "Marketing"… */
export default function FieldHeader({ area, lang, bellCount = 0, onBell, onMenu, onHome, menuOpen = false }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  return (
    <header className="fh-bar">
      <div className="fh-brand" {...homeLogoProps(onHome, L('Home', 'ホーム', 'Início'))}>
        <span className="fh-k">K</span>
        <span className="fh-brand-text"><strong>KuriPuro</strong><small>{area}</small></span>
      </div>
      <FieldClock lang={lang} />
      <div className="fh-actions">
        <button type="button" className="fh-icon fh-bell" aria-label={L('Notifications', 'お知らせ', 'Notificações')} onClick={onBell}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          {bellCount > 0 && <span className="fa-bell-count">{bellCount > 99 ? '99+' : bellCount}</span>}
        </button>
        <button type="button" className="fh-icon" aria-label={L('Menu', 'メニュー', 'Menu')} aria-expanded={menuOpen} onClick={onMenu}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
    </header>
  )
}

/** Greeting card on the home tab: photo (or initials) + greeting + name + one line under it. */
export function FieldHello({ name, photoUrl, lang, role, children }) {
  const now = useClock()
  const first = String(name || '').split(' ')[0]
  return (
    <section className="fh-hello">
      <FieldAvatar name={name} photoUrl={photoUrl} />
      <div className="fh-hello-copy">
        <span className="fh-hello-kicker">{greetingFor(now, lang)}</span>
        <h1>{first || '—'}</h1>
        {role && <p>{role}</p>}
      </div>
      {children && <div className="fh-hello-side">{children}</div>}
    </section>
  )
}
