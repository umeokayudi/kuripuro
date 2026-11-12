import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { isTestJob } from '../lib/testData'
import { locationNameFromTitle } from '../lib/cleaningType'
import { monthBounds, pct, deepItemName, itemTone } from '../lib/deepMonthProgress'
import { loadDeepMonth, DeepBar } from './DeepMonthCard'

// v1.0.133 · Serviços → "Deep & Spot". v1.0.167 · the deep part shows the PROGRESS of the month per store
// (lib/deepMonthProgress): expected = deep items of the active contracts (store × subtype × times a month),
// done / scheduled / missing; one job never counted twice; the generic "OTP — …" items are not a store.
// Chips: green done · blue scheduled · amber part · red missing. No money on this screen.
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const TONE = {
  done: { bg: 'var(--green-bg)', fg: 'var(--green)' },
  scheduled: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
  partial: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  missing: { bg: 'var(--red-bg)', fg: 'var(--red)' },
}

export default function DeepSpotCoverage() {
  const { tr, locale, lang } = useLang()
  const navigate = useNavigate()
  const today = tokyoToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [deep, setDeep] = useState(null)
  const [spots, setSpots] = useState(null)
  useEffect(() => {
    let alive = true
    setDeep(null); setSpots(null)
    const [from, to] = monthBounds(month)
    loadDeepMonth(month).then(r => { if (alive) setDeep(r) }).catch(() => { if (alive) setDeep([]) })
    supabase.from('jobs').select('id,title,scheduled_date,status,employee_id,employee_name,client_name,job_category,spot_status')
      .eq('job_category', 'spot').gte('scheduled_date', from).lte('scheduled_date', to).neq('status', 'cancelled').limit(2000)
      .then(({ data }) => { if (alive) setSpots((data || []).filter(x => !isTestJob(x))) })
    return () => { alive = false }
  }, [month])

  const view = useMemo(() => {
    if (!spots) return null
    const spotByClient = {}
    for (const j of spots) (spotByClient[j.client_name || '—'] = spotByClient[j.client_name || '—'] || []).push(j)
    return { spots, spotByClient }
  }, [spots])

  const fmtDay = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short' }) : '—')
  const shortDay = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }) : '—')
  const firstName = n => String(n || '').trim().split(/\s+/)[0] || tr('no person', '担当なし', 'sem pessoa')
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const openJob = id => navigate(`/jobs?search=${id}`)
  const createJob = (c, st, it) => navigate(`/jobs?tab=new&place=${encodeURIComponent(st.name)}&client=${c.clientId}&deep=${it.id}`)

  const chipText = it => {
    const name = deepItemName(it.id, lang)
    const tone = itemTone(it)
    if (tone === 'done') return `${name} ${it.done}/${it.times} ✓`
    if (tone === 'scheduled') {
      const next = it.jobs.find(j => j.status !== 'completed')
      return `${name} · ${shortDay(next?.scheduled_date)} · ${firstName(next?.employee_name)}${it.times > 1 ? ` · ${it.done}/${it.times}` : ''}`
    }
    return `${name} ${it.done + it.scheduled}/${it.times}`
  }
  const chipTitle = it => it.jobs.map(j => `${shortDay(j.scheduled_date)} · ${j.employee_name || '—'} · ${j.status === 'completed' ? tr('done', '完了', 'feito') : tr('scheduled', '予定', 'agendado')}`).join('\n')

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>🧽 {tr('Deep Cleaning of the month', '今月のディープクリーニング', 'Deep Cleaning do mês')}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Expected = deep items of the active contracts (store × item × times a month). A cancelled job goes back to missing.', '予定数＝有効な契約のディープ項目（店舗×項目×月の回数）。キャンセルした作業は未作成に戻ります。', 'Esperado = itens de deep dos contratos ativos (loja × item × vezes no mês). Job cancelado volta para faltando.')}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn btn-sm" onClick={() => setMonth(m => shift(m, -1))} aria-label={tr('Previous month', '前月', 'Mês anterior')}>‹</button>
            <b style={{ minWidth: 130, textAlign: 'center' }}>{monthLabel}</b>
            <button type="button" className="btn btn-sm" onClick={() => setMonth(m => shift(m, 1))} aria-label={tr('Next month', '翌月', 'Próximo mês')}>›</button>
          </div>
        </div>
      </div>

      {!deep && <div aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
      {deep && deep.length === 0 && <div className="card" style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14 }}>{tr('No deep items in the active contracts.', '有効な契約にディープ項目はありません。', 'Nenhum item de deep nos contratos ativos.')}</div>}
      {deep && deep.map(c => {
        const p = pct(c.totals)
        return (
          <div key={c.clientId} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
              <b style={{ fontSize: 15 }}>{c.clientName}</b>
              <b style={{ fontSize: 15 }}>{p}%</b>
            </div>
            <DeepBar value={p} height={12} />
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
              <b>{tr(`Done ${c.totals.done} of ${c.totals.expected}`, `完了 ${c.totals.expected}件中 ${c.totals.done}件`, `Feitos ${c.totals.done} de ${c.totals.expected}`)}</b>
              <span style={{ color: 'var(--blue)' }}>{tr(`Scheduled ${c.totals.scheduled}`, `予定 ${c.totals.scheduled}`, `Agendados ${c.totals.scheduled}`)}</span>
              <span style={{ color: c.totals.missing ? 'var(--red)' : 'var(--text3)' }}>{tr(`Missing ${c.totals.missing}`, `未作成 ${c.totals.missing}`, `Faltando ${c.totals.missing}`)}</span>
            </div>

            <div style={{ marginTop: 10 }}>
              {c.stores.map(st => {
                const sp = pct(st.totals)
                return (
                  <div key={st.key} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                      <b style={{ fontSize: 14, minWidth: 0, overflowWrap: 'anywhere' }}>{st.name}</b>
                      <span style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{st.totals.done}/{st.totals.expected}</span>
                    </div>
                    <DeepBar value={sp} height={6} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {st.items.map(it => {
                        const tone = itemTone(it)
                        const col = TONE[tone]
                        const target = it.jobs.find(j => j.status !== 'completed') || it.jobs[0]
                        return (
                          <span key={it.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-sm" title={chipTitle(it) || undefined}
                              onClick={() => (target ? openJob(target.id) : createJob(c, st, it))}
                              style={{ background: col.bg, color: col.fg, borderColor: col.fg, fontWeight: 600, maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left' }}>
                              {chipText(it)}
                            </button>
                            {it.missing > 0 && (
                              <button type="button" className="btn btn-sm" onClick={() => createJob(c, st, it)}
                                aria-label={tr(`Create job: ${st.name} · ${deepItemName(it.id, lang)}`, `作業を作成：${st.name}・${deepItemName(it.id, lang)}`, `Criar job: ${st.name} · ${deepItemName(it.id, lang)}`)}>
                                ＋ {tr('Create job', '作業を作成', 'Criar job')}
                              </button>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            {c.extras.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                {tr(`${c.extras.length} deep job(s) this month fill no contract item (store or item outside the contract, or extra) — not counted.`, `今月の契約外・重複のディープ作業 ${c.extras.length}件 — 集計に含めません。`, `${c.extras.length} job(s) de deep no mês não entram em nenhum item do contrato (loja/item fora do contrato ou a mais) — não contam.`)}
              </div>
            )}
          </div>
        )
      })}

      {view && (
        <div className="card">
          <div className="card-title">⚡ {tr('Spot jobs of the month', '今月のスポット', 'Spots do mês')} ({view.spots.length})</div>
          {!view.spots.length && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{tr('No spot job this month.', '今月のスポットはありません。', 'Nenhum spot neste mês.')}</div>}
          {Object.keys(view.spotByClient).sort().map(name => (
            <div key={name} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{name}</div>
              {view.spotByClient[name].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).map(j => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
                  <span>{fmtDay(j.scheduled_date)} · {locationNameFromTitle(j.title) || j.title}</span>
                  <span style={{ color: j.status === 'completed' ? 'var(--green)' : 'var(--text2)' }}>
                    {j.status === 'completed' ? `✓ ${j.employee_name || '—'}` : j.employee_id ? `⏳ ${j.employee_name}` : j.spot_status === 'pending' ? tr('⚡ offered', '⚡ オファー中', '⚡ ofertado') : tr('no person', '担当なし', 'sem pessoa')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
