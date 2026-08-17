import { createContext, useContext, useState } from 'react'
import { translations, fill } from '../i18n/translations'

const LangContext = createContext()

function readStoredLang() {
  const stored = localStorage.getItem('kp_lang') || localStorage.getItem('emp_lang')
  if (stored === 'jp') return 'ja'
  return (stored === 'en' || stored === 'ja') ? stored : 'en'
}

export function LangProvider({ children }) {
  const [lang, setLang] = useState(readStoredLang)

  const t = translations[lang]

  const switchLang = (l) => {
    const next = l === 'jp' ? 'ja' : l
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
