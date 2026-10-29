import { createContext, useContext, useEffect, useState } from 'react'
import { translations, fill } from '../i18n/translations'
import { useAuth } from './useAuth'

const LangContext = createContext()

// Portuguese is offered to the admin portal, the employee portal (many Brazilian
// workers read neither English nor Japanese) and the owner's own seller login.
const PT_ACCOUNTS = ['alexandresales']
const loginName = (user) => String(user?.email || '').toLowerCase().split('@')[0]
export const canUsePt = (user) => user?.role === 'admin' || user?.role === 'employee' || PT_ACCOUNTS.includes(loginName(user))

const normalize = (l) => (l === 'jp' ? 'ja' : l)
const valid = (l, allowPt) => l === 'en' || l === 'ja' || (allowPt && l === 'pt')
const accountKey = (user) => (user?.id || user?.email ? `kp_lang_u:${user.id || user.email}` : null)
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

// Brazilian workers who open the portal in Portuguese by default (employees.id, the same
// stable id the personal themes use). They can still switch to EN / JA on the toggle.
export const PT_DEFAULT_EMPLOYEES = [
  '4c064fb5-e39d-4086-a798-f6e670730bac', // Alexandre
  'b62cc1a1-9750-4dbd-8f03-8a4c4aa4d86c', // Gabriel
  '8772f25f-7bd2-460d-8818-ad3bad3ab541', // Guilherme
  '3a39b220-9984-41e4-ab61-4cf96b93a99f', // Letícia
]
export const ptByDefault = (user) => user?.role === 'employee' && PT_DEFAULT_EMPLOYEES.includes(user?.id)

// Applies the Portuguese default once per account, so a later EN / JA choice on the toggle sticks.
function applyPtDefault(user) {
  if (!ptByDefault(user)) return
  const done = `kp_lang_ptdefault:${user.id}`
  if (read(done)) return
  write(accountKey(user), 'pt')
  write(done, '1')
}

function readStoredLang(user) {
  const allowPt = canUsePt(user)
  applyPtDefault(user)
  // A choice saved for this account wins over the device-wide one, so Portuguese on the
  // owner's login never leaks to an employee who signs in on the same phone.
  const own = normalize(accountKey(user) && read(accountKey(user)))
  if (valid(own, allowPt)) return own
  const stored = normalize(read('kp_lang') || read('emp_lang'))
  return valid(stored, false) ? stored : 'en'
}

/** Pick the text for a language: pickLang(lang, en, ja, pt). Portuguese falls back to English. */
export function pickLang(lang, en, ja, pt) {
  if (lang === 'ja') return ja ?? en
  if (lang === 'pt') return pt ?? en
  return en
}

/** Locale for dates / numbers. */
export const localeOf = (lang) => (lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB')

export function LangProvider({ children }) {
  const { user } = useAuth() || {}
  const [lang, setLang] = useState(() => readStoredLang(user))

  // Re-read when the signed-in account changes (login / logout / switch).
  const who = accountKey(user)
  useEffect(() => { setLang(readStoredLang(user)) }, [who]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = translations[lang] || translations.en

  const switchLang = (l) => {
    const next = normalize(l)
    if (!valid(next, canUsePt(user))) return
    setLang(next)
    if (who) write(who, next)
    // Device-wide default stays EN/JA only (it is what employees and clients see).
    if (next !== 'pt') { write('kp_lang', next); write('emp_lang', next) }
  }

  const tr = (en, ja, pt) => pickLang(lang, en, ja, pt)

  return (
    <LangContext.Provider value={{ lang, switchLang, t, tr, locale: localeOf(lang), ptAllowed: canUsePt(user) }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
export { fill }
