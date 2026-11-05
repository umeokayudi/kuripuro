// v1.0.151 · the Painel do Dia counter ("X de Y lojas feitas · Z em andamento") for any screen of the day
// (Agenda, Ao vivo) — same source (lib/dayPanel), so every screen shows the same numbers.
import { useEffect, useState } from 'react'
import { fetchDayPanel } from '../lib/dayPanel'
import { PENDING_CHANGED } from '../lib/adminPending'
import { DayCounter } from './DayPanelView'
import { tokyoToday } from '../lib/dates'

export default function DayStoreStrip({ date, L }) {
  const [count, setCount] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      const t = new Date(Date.now() + 9 * 3600e3)
      fetchDayPanel(date, { nowMin: t.getUTCHours() * 60 + t.getUTCMinutes(), today: tokyoToday() }).then(p => { if (alive) setCount(p.count) }).catch(() => {})
    }
    load()
    const id = setInterval(load, 30000)
    window.addEventListener(PENDING_CHANGED, load)
    return () => { alive = false; clearInterval(id); window.removeEventListener(PENDING_CHANGED, load) }
  }, [date])
  return count ? <DayCounter count={count} L={L} compact /> : null
}
