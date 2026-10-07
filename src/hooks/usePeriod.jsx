import { createContext, useContext, useMemo, useState } from 'react'
import { tokyoToday } from '../lib/dates'
import { rangeForPreset } from '../lib/period'

const KEY = 'kp_period'
const PeriodContext = createContext(null)

function readStored() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.preset) return null
    return parsed
  } catch {
    return null
  }
}

export function PeriodProvider({ children }) {
  const [state, setState] = useState(() => {
    const saved = readStored()
    if (saved?.preset === 'custom' && saved.start && saved.end) return saved
    return rangeForPreset(saved?.preset || 'thisMonth')
  })

  const value = useMemo(() => {
    const today = tokyoToday()
    const resolved = state.preset === 'custom'
      ? state
      : rangeForPreset(state.preset, today)
    const setPreset = (preset) => {
      const next = preset === 'custom'
        ? { preset: 'custom', start: resolved.start, end: resolved.end }
        : rangeForPreset(preset, today)
      setState(next)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
    }
    const setCustom = (start, end) => {
      const next = { preset: 'custom', start, end: end < start ? start : end }
      setState(next)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
    }
    return { ...resolved, setPreset, setCustom }
  }, [state])

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

export function usePeriod() {
  const ctx = useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod requires PeriodProvider')
  return ctx
}
