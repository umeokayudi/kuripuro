import { createContext, useContext, useState } from 'react'
import { translations } from '../i18n/translations'

const LangContext = createContext()

export function LangProvider({ children }) {
  const stored = localStorage.getItem('kp_lang')
  const validLang = (stored === 'en' || stored === 'ja') ? stored : 'en'
  const [lang, setLang] = useState(validLang)

  const t = translations[lang]

  const switchLang = (l) => {
    setLang(l)
    localStorage.setItem('kp_lang', l)
  }

  return (
    <LangContext.Provider value={{ lang, switchLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
