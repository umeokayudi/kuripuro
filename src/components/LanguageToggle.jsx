import { useLang } from '../hooks/useLang'

export default function LanguageToggle({ variant = 'dark', compact = false }) {
  const { lang, switchLang } = useLang()
  const dark = variant === 'dark'
  return (
    <div className={`kp-lang ${dark ? 'kp-lang-dark' : 'kp-lang-light'}`} role="group" aria-label="Language">
      <button
        type="button"
        className={`kp-lang-btn${lang === 'en' ? ' on' : ''}`}
        aria-pressed={lang === 'en'}
        aria-label="English"
        onClick={() => switchLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={`kp-lang-btn${lang === 'ja' ? ' on' : ''}`}
        aria-pressed={lang === 'ja'}
        aria-label="日本語"
        onClick={() => switchLang('ja')}
      >
        {compact ? 'JA' : '日本語'}
      </button>
    </div>
  )
}
