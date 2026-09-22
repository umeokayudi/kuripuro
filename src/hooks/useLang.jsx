import { createContext, useContext, useState } from 'react'
import { translations, fill } from '../i18n/translations'

const LangContext = createContext()
const LANGS = new Set(['en', 'ja', 'pt'])

function readStoredLang() {
  const stored = localStorage.getItem('kp_lang') || localStorage.getItem('emp_lang')
  if (stored === 'jp') return 'ja'
  return LANGS.has(stored) ? stored : 'en'
}

export function LangProvider({ children }) {
  const [lang, setLang] = useState(readStoredLang)

  const t = translations[lang] || translations.en

  const switchLang = (l) => {
    const next = l === 'jp' ? 'ja' : (LANGS.has(l) ? l : 'en')
    setLang(next)
    localStorage.setItem('kp_lang', next)
    localStorage.setItem('emp_lang', next)
  }

  return (
    <LangContext.Provider value={{ lang, switchLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
export { fill }
