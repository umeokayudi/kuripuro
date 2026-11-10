// v1.0.151 · Reports without hunting: opens on TODAY grouped by store with the SAME counter as the Painel do Dia
// (lib/dayPanel). One-tap Hoje / Ontem / Semana, filter by person and by store, and a "Não feitos" group
// always visible, with not-started and late apart (each with its own count).
import { useEffect, useMemo, useState } from 'react'
import { fetchDayPanels, serviceLabel, plural } from '../lib/dayPanel'
import { PENDING_CHANGED } from '../lib/adminPending'
import { DayCounter, StoreList } from './DayPanelView'
import { fmtDay } from './AvailabilityPlanner'
import './dayPanel.css'
import { pollWhileVisible } from '../lib/visiblePoll'

const SHORTCUTS = ['today', 'yesterday', '7']

export default function DayStoresReport({ f, setF, range, today, lang, L }) {
  const [panels, setPanels] = useState(null)
  const days = Math.round((Date.parse(range.to + 'T12:00:00Z') - Date.parse(range.from + 'T12:00:00Z')) / 864e5) + 1
  const enabled = days <= 7
  useEffect(() => {
    if (!enabled) { setPanels(null); return }
    let alive = true
    const load = () => {
      const t = new Date(Date.now() + 9 * 3600e3)
      fetchDayPanels(range.from, range.to, { nowMin: t.getUTCHours() * 60 + t.getUTCMinutes(), today }).then(p => { if (alive) setPanels(p) }).catch(() => { if (alive) setPanels([]) })
    }
    load()
    const stopPoll = pollWhileVisible(load, 60000)
    window.addEventListener(PENDING_CHANGED, load)
    return () => { alive = false; stopPoll(); window.removeEventListener(PENDING_CHANGED, load) }
  }, [range.from, range.to, enabled, today])

  const people = useMemo(() => [...new Set((panels || []).flatMap(p => p.services.flatMap(s => [s.assigned, s.coveredBy]).filter(Boolean)))].sort(), [panels])
  const storesAll = useMemo(() => [...new Set((panels || []).flatMap(p => p.stores.map(s => s.store)))].sort(), [panels])
  const keepStore = st => (!f.place || st.store === f.place) && (!f.emp || st.services.some(s => s.assigned === f.emp || s.coveredBy === f.emp) || st.usualName === f.emp)
  const view = (panels || []).map(p => {
    const stores = p.stores.filter(keepStore)
    const filtered = !!(f.place || f.emp)
    const svcs = stores.flatMap(s => s.services).filter(s => !f.emp || s.assigned === f.emp || s.coveredBy === f.emp)
    const count = filtered ? {
      stores: stores.length, storesDone: stores.filter(s => s.state === 'done').length, storesWorking: stores.filter(s => s.state === 'working').length,
      storesLate: stores.filter(s => s.state === 'late').length, storesNotStarted: stores.filter(s => s.state === 'not_started').length,
      services: svcs.length, servicesDone: svcs.filter(s => s.status === 'done').length,
    } : p.count
    return { ...p, stores, svcs, count, noJob: stores.filter(s => s.noJob) }
  })
  const sum = view.reduce((a, p) => { for (const [k, v] of Object.entries(p.count)) a[k] = (a[k] || 0) + (typeof v === 'number' ? v : 0); return a }, {})
  const late = view.flatMap(p => p.svcs.filter(s => s.status === 'late').map(s => ({ ...s, date: p.date })))
  const notStarted = view.flatMap(p => [...p.svcs.filter(s => s.status === 'not_started').map(s => ({ ...s, date: p.date })), ...p.noJob.map(st => ({ id: `nojob:${p.date}:${st.key}`, date: p.date, store: st.store, noJob: true, assigned: st.usualName }))])
  const dShort = d => fmtDay(d, lang, { weekday: 'short', day: '2-digit', month: '2-digit' })
  const line = s => [days > 1 ? dShort(s.date) : '', s.store, s.noJob ? L('no job created', '作業未作成', 'sem serviço criado') : serviceLabel(s.job, L), s.assigned || L('nobody', '担当なし', 'sem pessoa')].filter(Boolean).join(' · ')

  return (
    <section className="card dp-card" aria-label={L('By store', '店舗別', 'Por loja')}>
      <div className="dx-overview-head">
        <div><h2>{L('By store', '店舗別', 'Por loja')}</h2><p>{range.from === range.to ? fmtDay(range.from, lang, { weekday: 'long', day: 'numeric', month: 'long' }) : `${dShort(range.from)} → ${dShort(range.to)}`} · {L('same numbers as the Day panel', '本日のパネルと同じ数字', 'mesmos números do Painel do Dia')}</p></div>
      </div>
      <div className="dp-shortcuts" role="group">
        {SHORTCUTS.map(p => (
          <button key={p} type="button" className={f.period === p ? 'on' : ''} onClick={() => setF({ period: p, from: '', to: '' })}>
            {{ today: L('Today', '今日', 'Hoje'), yesterday: L('Yesterday', '昨日', 'Ontem'), 7: L('Week', '週', 'Semana') }[p]}
          </button>
        ))}
      </div>
      {!enabled ? <div className="dp-empty">{L('By store shows up to 7 days — pick Today, Yesterday or Week.', '店舗別は最大7日です。今日・昨日・週を選んでください。', 'A vista por loja mostra até 7 dias — escolha Hoje, Ontem ou Semana.')}</div> : !panels ? <div className="dp-empty">{L('Loading…', '読み込み中…', 'Carregando…')}</div> : <>
        <div className="dp-filters">
          <select value={f.emp} onChange={e => setF({ emp: e.target.value })} aria-label={L('Person', '担当者', 'Pessoa')}>
            <option value="">{L('Everyone', '全員', 'Todas as pessoas')}</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={f.place} onChange={e => setF({ place: e.target.value })} aria-label={L('Store', '店舗', 'Loja')}>
            <option value="">{L('All stores', '全店舗', 'Todas as lojas')}</option>
            {storesAll.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <DayCounter count={{ storesWorking: 0, storesLate: 0, storesNotStarted: 0, services: 0, servicesDone: 0, stores: 0, storesDone: 0, ...sum }} L={L} compact />

        <div className="dp-notdone">
          <h3>{L('Not done', '未完了', 'Não feitos')} <span className="dp-n">{late.length + notStarted.length}</span></h3>
          {late.length + notStarted.length === 0 ? <div className="dp-empty">✅ {L('Nothing left undone', '未完了はありません', 'Nada ficou por fazer')}</div> : (
            <div className="dp-notdone-cols">
              <div>
                <h4>{L(`Late · ${late.length}`, `遅れ · ${late.length}`, `Atrasados · ${late.length}`)}</h4>
                <ul>{late.map(s => <li key={s.id + s.date}>⏰ {line(s)}{s.deadline ? L(` · deadline ${s.deadline}`, ` · 期限 ${s.deadline}`, ` · prazo ${s.deadline}`) : ''}</li>)}</ul>
              </div>
              <div>
                <h4>{L(`Not started · ${notStarted.length}`, `未開始 · ${notStarted.length}`, `Não iniciados · ${notStarted.length}`)}</h4>
                <ul>{notStarted.map(s => <li key={s.id + s.date}>○ {line(s)}</li>)}</ul>
              </div>
            </div>
          )}
        </div>

        {view.map(p => (
          <div key={p.date}>
            {days > 1 && <div className="dp-day-title">{fmtDay(p.date, lang, { weekday: 'long', day: 'numeric', month: 'short' })} · {L(`${p.count.storesDone} of ${p.count.stores} stores done`, `${p.count.stores}店舗中 ${p.count.storesDone}完了`, `${p.count.storesDone} de ${plural(p.count.stores, 'loja feita', 'lojas feitas')}`)}</div>}
            <StoreList stores={p.stores} L={L} emptyText={L('No store on this day', 'この日の店舗なし', 'Nenhuma loja neste dia')} />
          </div>
        ))}
      </>}
    </section>
  )
}
