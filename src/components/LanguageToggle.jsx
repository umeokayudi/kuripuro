import { useLang } from '../hooks/useLang'

export default function LanguageToggle({ variant = 'dark' }) {
  const { lang, switchLang } = useLang()
  const dark = variant === 'dark'
  return (
    <div className={`kp-lang ${dark ? 'kp-lang-dark' : 'kp-lang-light'}`} role="group" aria-label="Language">
      <button
        type="button"
        className={`kp-lang-btn${lang === 'en' ? ' on' : ''}`}
        onClick={() => switchLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={`kp-lang-btn${lang === 'ja' ? ' on' : ''}`}
        onClick={() => switchLang('ja')}
      >
        日本語
      </button>
    </div>
  )
}
