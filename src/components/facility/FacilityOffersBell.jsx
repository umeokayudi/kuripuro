import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useLang, fill } from '../../hooks/useLang'
import { ELEMENT_KINDS, serviceOffers } from '../../lib/facilityModel'
import { listApprovedModels, listServiceLog, listRecommendations, offerService } from '../../lib/facilityApi'

const SEEN_KEY = 'kp_fac_offers_seen_v1'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (keys) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-500))) } catch { /* private mode */ } }

/** Linha "há X dias sem fazer" / "vence em X dias" de um serviço para oferecer (admin e vendedor). */
export function offerWhen(row, t) {
  if (row.status === 'overdue') return fill(t.notDoneFor, { n: row.daysSince, i: row.interval_days })
  if (row.daysLeft === 0) return t.dueToday
  return fill(t.dueIn, { n: row.daysLeft, since: row.daysSince })
}

/**
 * Admin (barra do topo): sininho separado só para Smart Facility — "oferecer tal serviço para tal cliente".
 * Atrasado ou vencendo em até 14 dias, em todas as lojas aprovadas. Avisa (toast) quando aparece algo novo.
 */
export default function FacilityOffersBell() {
  const { t: tr } = useLang()
  const t = tr.facility
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const seen = useRef(readSeen())

  const load = async () => {
    const [models, logs, recs, { data: clients }] = await Promise.all([
      listApprovedModels(),
      listServiceLog({ limit: 3000 }),
      listRecommendations({ status: 'pending' }).catch(() => []),
      supabase.from('clients').select('id,company_name'),
    ])
    const names = new Map((clients || []).map(c => [c.id, c.company_name]))
    const offered = new Set(recs.map(r => `${r.model_id}:${r.element_id}:${String(r.service || '').toLowerCase()}`))
    const list = serviceOffers(models, logs).map(r => ({
      ...r,
      client_name: names.get(r.client_id) || '',
      offered: offered.has(`${r.model_id}:${r.element_id}:${r.task_name.toLowerCase()}`),
    }))
    setRows(list)
    if (list.some(r => !r.offered && !seen.current.has(r.key))) setToastOpen(true)
  }

  useEffect(() => {
    load().catch(() => {})
    const id = setInterval(() => load().catch(() => {}), 10 * 60000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markSeen = () => {
    rows.forEach(r => seen.current.add(r.key))
    writeSeen(seen.current)
    setToastOpen(false)
  }
  const openPopup = () => { markSeen(); setOpen(true) }
  const openStore = (r) => { setOpen(false); navigate(`/facility?model=${r.model_id}`) }

  const offer = async (r) => {
    setBusy(r.key)
    try {
      await offerService({
        model: { id: r.model_id, client_id: r.client_id, location_name: r.location },
        element: { id: r.element_id, name: r.element_name },
        task: { name: r.task_name },
        reason: offerWhen(r, t),
        priority: r.status === 'overdue' ? 'high' : 'medium',
      })
      toast.success(t.offered)
      setRows(list => list.map(x => (x.key === r.key ? { ...x, offered: true } : x)))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const todo = rows.filter(r => !r.offered)
  const n = todo.length
  const late = todo.filter(r => r.status === 'overdue').length

  return (
    <>
      <button type="button" className={`ref-top-action tor-bell fob-bell${n ? ' has-items' : ''}`} onClick={openPopup}
        title={n ? fill(t.offersCount, { n }) : t.offersEmpty} aria-label={t.offersTitle}>
        <span aria-hidden="true" style={{ fontSize: 16 }}>🧽</span>
        {n > 0 && <span className={`tor-count${late ? ' fob-late' : ''}`}>{n > 9 ? '9+' : n}</span>}
      </button>

      {createPortal(<>
      {toastOpen && n > 0 && !open && (
        <div className="tor-toast fob-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🧽</span>
          <div className="tor-toast-text">
            <strong>{fill(t.offersCount, { n })}</strong>
            <span>{fill(t.offerTo, { task: todo[0].task_name, client: todo[0].client_name || todo[0].location })}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{t.open}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label="×">×</button>
        </div>
      )}

      {open && (
        <div className="tor-backdrop" onClick={() => setOpen(false)}>
          <section className="tor-modal" role="dialog" aria-modal="true" aria-label={t.offersTitle} onClick={e => e.stopPropagation()}>
            <header className="tor-head">
              <div>
                <h2>🧽 {t.offersTitle}</h2>
                <p>{n ? t.offersHint : t.offersEmpty}</p>
              </div>
              <button type="button" className="tor-close" onClick={() => setOpen(false)} aria-label="×">×</button>
            </header>
            <div className="tor-list">
              {rows.map(r => {
                const k = ELEMENT_KINDS[r.element_kind] || ELEMENT_KINDS.other
                return (
                  <article key={r.key} className={`tor-item fob-item st-${r.status}${r.offered ? ' is-offered' : ''}`}>
                    <div className="tor-item-top">
                      <div className="tor-avatar fob-avatar" aria-hidden="true">{k.icon}</div>
                      <div className="tor-item-main">
                        <strong>{fill(t.offerTo, { task: r.task_name, client: r.client_name || r.location })}</strong>
                        <span>{r.location} · {r.element_name}</span>
                      </div>
                      <span className={`tor-kind fob-kind st-${r.status}`}>{r.task_type === 'maintenance' ? '🔧' : '🧽'} {r.status === 'overdue' ? t.late : t.soon}</span>
                    </div>
                    <p className="fob-when">🕒 {offerWhen(r, t)}</p>
                    <div className="tor-actions">
                      <button type="button" className="tor-btn tor-btn-ghost" onClick={() => openStore(r)}>🏢 {t.openStore}</button>
                      <button type="button" className="tor-btn tor-btn-approve" disabled={r.offered || busy === r.key} onClick={() => offer(r)}>
                        {r.offered ? `✓ ${t.alreadyOffered}` : busy === r.key ? '…' : `📨 ${t.offerClient}`}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
            <footer className="tor-foot">
              <button type="button" className="tor-btn tor-btn-ghost" onClick={() => { setOpen(false); navigate('/facility') }}>🏢 Smart Facility</button>
              <button type="button" className="tor-btn tor-btn-ghost" onClick={() => setOpen(false)}>{t.later}</button>
            </footer>
          </section>
        </div>
      )}
      </>, document.body)}
    </>
  )
}
