import { createContext, useContext, useEffect, useState } from 'react'
import { translations, fill } from '../i18n/translations'
import { useAuth } from './useAuth'
import { PT_FALLBACK_EMPLOYEES, fetchSpeaksPt } from '../lib/employeeLang'

const LangContext = createContext()

// Portuguese is offered to the admin portal, the owner's own seller login and the
// employees the admin marked as Portuguese speakers (Employees → Portal language).
// Those employees always see PT and get no switcher; other employees choose EN / JA.
const PT_ACCOUNTS = ['alexandresales']
const loginName = (user) => String(user?.email || '').toLowerCase().split('@')[0]
const isEmployee = (user) => user?.role === 'employee'

const normalize = (l) => (l === 'jp' ? 'ja' : l)
const valid = (l, allowPt) => l === 'en' || l === 'ja' || (allowPt && l === 'pt')
const accountKey = (user) => (user?.id || user?.email ? `kp_lang_u:${user.id || user.email}` : null)
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** @deprecated kept for older imports — the admin setting (employees.speaks_portuguese) wins. */
export const PT_DEFAULT_EMPLOYEES = PT_FALLBACK_EMPLOYEES

// Last value read from the database for this employee, so the first paint is already right.
const ptCacheKey = (user) => `kp_emp_pt:${user?.id}`
function cachedEmployeePt(user) {
  const c = read(ptCacheKey(user))
  if (c === '1') return true
  if (c === '0') return false
  return PT_FALLBACK_EMPLOYEES.includes(user?.id)
}

export const canUsePt = (user, employeePt = cachedEmployeePt(user)) =>
  user?.role === 'admin' || PT_ACCOUNTS.includes(loginName(user)) || (isEmployee(user) && employeePt)

function readStoredLang(user, employeePt) {
  if (isEmployee(user) && employeePt) return 'pt'
  const allowPt = canUsePt(user, employeePt)
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
  const [employeePt, setEmployeePt] = useState(() => cachedEmployeePt(user))
  const [lang, setLang] = useState(() => readStoredLang(user, cachedEmployeePt(user)))

  // Re-read when the signed-in account changes (login / logout / switch), then ask the
  // database whether the admin marked this employee as a Portuguese speaker.
  const who = accountKey(user)
  useEffect(() => {
    const cached = cachedEmployeePt(user)
    setEmployeePt(cached)
    setLang(readStoredLang(user, cached))
    if (!isEmployee(user)) return
    let alive = true
    fetchSpeaksPt(user.id).then(stored => {
      if (!alive || stored == null) return
      write(ptCacheKey(user), stored ? '1' : '0')
      setEmployeePt(stored)
      setLang(readStoredLang(user, stored))
    })
    return () => { alive = false }
  }, [who]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = translations[lang] || translations.en
  const langLocked = isEmployee(user) && employeePt
  const ptAllowed = canUsePt(user, employeePt)

  const switchLang = (l) => {
    const next = normalize(l)
    if (langLocked || !valid(next, ptAllowed)) return
    setLang(next)
    if (who) write(who, next)
    // Device-wide default stays EN/JA only (it is what employees and clients see).
    if (next !== 'pt') { write('kp_lang', next); write('emp_lang', next) }
  }

  const tr = (en, ja, pt) => pickLang(lang, en, ja, pt)

  return (
    <LangContext.Provider value={{ lang, switchLang, t, tr, locale: localeOf(lang), ptAllowed, langLocked }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
export { fill }
