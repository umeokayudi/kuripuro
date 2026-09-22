import { useLang } from '../hooks/useLang'

const LANGS = [
  { id: 'en', compact: 'EN', full: 'EN' },
  { id: 'pt', compact: 'PT', full: 'PT' },
  { id: 'ja', compact: 'JA', full: '日本語' },
]

export default function LanguageToggle({ variant = 'dark', compact = false }) {
  const { lang, switchLang } = useLang()
  const dark = variant === 'dark'
  return (
    <div className={`kp-lang ${dark ? 'kp-lang-dark' : 'kp-lang-light'}`} role="group" aria-label="Language">
      {LANGS.map(({ id, compact: short, full }) => (
        <button
          key={id}
          type="button"
          className={`kp-lang-btn${lang === id ? ' on' : ''}`}
          onClick={() => switchLang(id)}
        >
          {compact ? short : full}
        </button>
      ))}
    </div>
  )
}
