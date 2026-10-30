// v1.0.104 · Jobs → Deep & Spot: only deep cleanings and spots, apart from the basic cleaning.
// Filters (restaurant, period, type, state, person), the "does every restaurant have it?" check
// (expected × scheduled × done per restaurant, from the contracts) and the MISSING list with
// [Schedule], which creates the visit without a person → Pending box of the Schedule screen.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { addDays, periodDays, splitName } from '../lib/schedulePlan'
import { deepCoverage, deepSpotType, lineState, placeKey, spotOfferState, spotOrigin } from '../lib/deepCoverage'
import { fetchDeepSpot, scheduleMissing } from '../lib/deepCoverageData'
import './deep-spot.css'

const PERIODS = ['day', 'week', 'month', 'custom']

function rangeOf(kind, anchor, custom) {
  if (kind === 'custom') {
    const from = custom.from || anchor
    return { from, to: custom.to && custom.to >= from ? custom.to : from }
  }
  const days = periodDays(kind, anchor, anchor.slice(0, 7))
  return { from: days[0], to: days[days.length - 1] }
}

function shift(kind, anchor, dir) {
  if (kind === 'day') return addDays(anchor, dir)
  if (kind === 'week') return addDays(anchor, 7 * dir)
  const [y, m] = anchor.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + dir, 1))
  return d.toISOString().slice(0, 10)
}

export default function DeepSpotTab() {
  const { lang, tr } = useLang()
  const today = tokyoToday()
  const [period, setPeriod] = useState('month')
  const [anchor, setAnchor] = useState(today)
  const [custom, setCustom] = useState({ from: addDays(today, -6), to: today })
  const [client, setClient] = useState('')
  const [place, setPlace] = useState('')
  const [type, setType] = useState('all')
  const [state, setState] = useState('all')
  const [person, setPerson] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [dates, setDates] = useState({})
  const [openPlace, setOpenPlace] = useState(null)
  const [allMissing, setAllMissing] = useState(false)
  const range = rangeOf(period, anchor, custom)

  const load = () => {
    setError('')
    fetchDeepSpot(range).then(setData, err => { setError(err.message || String(err)); setData(d => d || { targets: [], clients: [], jobs: [], employees: [], spotByJob: {} }) })
  }
  useEffect(load, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDay = d => new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })
  const rangeText = range.from === range.to ? fmtDay(range.from)
    : period === 'month' ? (s => s.charAt(0).toUpperCase() + s.slice(1))(new Date(`${range.from}T12:00:00`).toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric' }))
      : `${fmtDay(range.from)} – ${fmtDay(range.to)}`

  const L = {
    day: tr('Day', '日', 'Dia'), week: tr('Week', '週', 'Semana'), month: tr('Month', '月', 'Mês'), custom: tr('Custom', '期間指定', 'Livre'),
    deep: tr('Deep', '深層', 'Deep'), spot: tr('Spot', 'スポット', 'Spot'),
    scheduled: tr('Scheduled', '予定（担当なし）', 'Agendado'), assigned: tr('Assigned', '割当済み', 'Atribuído'),
    done: tr('Done', '完了', 'Concluído'), missing: tr('MISSING', '不足', 'FALTANDO'), cancelled: tr('Cancelled', 'キャンセル', 'Cancelado'),
    expected: tr('Expected', '予定数', 'Esperado'),
  }

  const view = useMemo(() => {
    if (!data) return null
    const placeOk = (base, clientId) => (!client || clientId === client) && (!place || placeKey(base) === place)
    const targets = data.targets.filter(t => placeOk(t.base, t.clientId))
    const cov = deepCoverage(targets, data.jobs, { ...range, today })
    const missing = cov.missing.filter(m => !person || m.job?.employee_id === person)
    const lines = data.jobs
      .filter(j => placeOk(splitName(j.title).base, j.client_id || data.targets.find(t => placeKey(t.base) === placeKey(j.title))?.clientId))
      .filter(j => type === 'all' || deepSpotType(j) === type)
      .filter(j => !person || j.employee_id === person)
      .map(j => ({ job: j, type: deepSpotType(j), state: lineState(j, today) }))
      .filter(l => l.state !== 'cancelled' || l.type === 'spot')
      .filter(l => state === 'all' || l.state === state)
      .sort((a, b) => a.job.scheduled_date.localeCompare(b.job.scheduled_date) || String(a.job.scheduled_time || '').localeCompare(String(b.job.scheduled_time || '')))
    // Restaurants for the filter: contracts + jobs, by client.
    const placeMap = new Map()
    for (const t of data.targets) placeMap.set(placeKey(t.base), { key: placeKey(t.base), name: t.base, clientId: t.clientId })
    for (const j of data.jobs) if (!placeMap.has(placeKey(j.title))) placeMap.set(placeKey(j.title), { key: placeKey(j.title), name: splitName(j.title).base, clientId: j.client_id })
    const places = [...placeMap.values()].filter(p => !client || p.clientId === client).sort((a, b) => a.name.localeCompare(b.name))
    const clientIds = new Set([...data.targets.map(t => t.clientId), ...data.jobs.map(j => j.client_id)].filter(Boolean))
    const clients = data.clients.filter(c => clientIds.has(c.id)).sort((a, b) => a.company_name.localeCompare(b.company_name))
    const peopleIds = new Set(data.jobs.map(j => j.employee_id).filter(Boolean))
    const people = data.employees.filter(e => peopleIds.has(e.id)).sort((a, b) => a.full_name.localeCompare(b.full_name))
    return { cov, missing, lines, places, clients, people }
  }, [data, client, place, type, state, person, range.from, range.to, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const empName = id => data?.employees.find(e => e.id === id)?.full_name || ''
  const serviceName = t => (t.item === 'deep' ? tr('Deep Clean', '深層清掃', 'Deep Clean') : t.service)
  const reasonText = m => ({
    notCreated: tr('Not scheduled yet', 'まだ予定なし', 'Ainda não agendado'),
    passed: tr('Day passed with no service', '作業なしで日が過ぎました', 'O dia passou sem serviço'),
    notDone: tr(`Scheduled but not done${m.job?.employee_name ? ` · ${m.job.employee_name}` : ''}`, `予定済みだが未完了${m.job?.employee_name ? `・${m.job.employee_name}` : ''}`, `Agendado mas não concluído${m.job?.employee_name ? ` · ${m.job.employee_name}` : ''}`),
  })[m.reason]

  const doSchedule = async (m, key) => {
    const date = dates[key] || (m.date >= today ? m.date : today)
    setBusy(key)
    try {
      const { dup } = await scheduleMissing(m.target, date)
      if (dup) toast(tr('Already exists on that day — not duplicated.', 'その日に既にあります — 重複なし', 'Já existe nesse dia — não duplicado.'))
      else toast.success(tr('Created in the Pending box — assign it in Schedule.', '未割当ボックスに作成しました — スケジュールで割り当ててください。', 'Criado na Caixa de Pendentes — atribua em Escala.'))
      load()
    } catch (err) {
      toast.error(err.message || String(err))
    } finally {
      setBusy('')
    }
  }

  const offerText = j => {
    const name = j.employee_name || empName(j.employee_id)
    return ({
      open: tr('Offered to everyone · open', '全員にオファー中', 'Oferecido a todos · aberto'),
      waiting: tr(`Offered to ${name} · waiting`, `${name}さんにオファー中`, `Oferecido a ${name} · aguardando`),
      accepted: tr(`Accepted by ${name}`, `${name}さんが承諾`, `Aceito por ${name}`),
      declined: tr(`Declined by ${name}`, `${name}さんが辞退`, `Recusado por ${name}`),
      assigned: tr(`Assigned to ${name}`, `${name}さんに割当`, `Atribuído a ${name}`),
      done: tr(`Done by ${name}`, `${name}さんが完了`, `Concluído por ${name}`),
      cancelled: L.cancelled,
    })[spotOfferState(j)]
  }

  const cov = view?.cov
  const showCoverage = type !== 'spot'

  return (
    <div className="ds">
      <div className="card ds-filters">
        <div className="ds-period">
          <div className="ds-seg" role="tablist">
            {PERIODS.map(p => <button key={p} type="button" className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{L[p]}</button>)}
          </div>
          {period !== 'custom' ? (
            <div className="ds-nav">
              <button type="button" aria-label="◀" onClick={() => setAnchor(a => shift(period, a, -1))}>◀</button>
              <b>{rangeText}</b>
              <button type="button" aria-label="▶" onClick={() => setAnchor(a => shift(period, a, 1))}>▶</button>
              {anchor !== today && <button type="button" className="ds-today" onClick={() => setAnchor(today)}>{tr('Today', '今日', 'Hoje')}</button>}
            </div>
          ) : (
            <div className="ds-nav">
              <input type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
              <span>–</span>
              <input type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
            </div>
          )}
        </div>
        <div className="ds-selects">
          <label><span>{tr('Client', '顧客', 'Cliente')}</span>
            <select value={client} onChange={e => { setClient(e.target.value); setPlace('') }}>
              <option value="">{tr('All', 'すべて', 'Todos')}</option>
              {view?.clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </label>
          <label><span>{tr('Restaurant', '店舗', 'Restaurante')}</span>
            <select value={place} onChange={e => setPlace(e.target.value)}>
              <option value="">{tr('All', 'すべて', 'Todos')}</option>
              {view?.places.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label><span>{tr('Type', '種類', 'Tipo')}</span>
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="all">Deep + Spot</option>
              <option value="deep">{L.deep}</option>
              <option value="spot">{L.spot}</option>
            </select>
          </label>
          <label><span>{tr('State', '状態', 'Estado')}</span>
            <select value={state} onChange={e => setState(e.target.value)}>
              <option value="all">{tr('All', 'すべて', 'Todos')}</option>
              <option value="scheduled">{L.scheduled}</option>
              <option value="assigned">{L.assigned}</option>
              <option value="done">{L.done}</option>
              <option value="missing">{L.missing}</option>
            </select>
          </label>
          <label><span>{tr('Person', '担当者', 'Pessoa')}</span>
            <select value={person} onChange={e => setPerson(e.target.value)}>
              <option value="">{tr('Everyone', '全員', 'Todos')}</option>
              {view?.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="card ds-error">⚠️ {error}</div>}
      {!view && !error && (
        <div className="card"><div className="ds-skel" /><div className="ds-skel" /><div className="ds-skel short" /></div>
      )}

      {view && showCoverage && (
        <section className="card ds-cov">
          <div className="ds-cov-head">
            <div>
              <div className="card-title" style={{ marginBottom: 2 }}>{tr('Does every restaurant have it?', '全店舗そろっていますか？', 'Tem de todos?')}</div>
              <div className="ds-muted">{tr('Deep cleanings expected by the contracts (frequency of each item) in the period.', '契約（各項目の頻度）から見た期間内の深層清掃。', 'Deep cleanings esperados pelos contratos (frequência de cada item) no período.')}</div>
            </div>
            <span className={`ds-pill ${cov.missing.length ? 'bad' : 'ok'}`}>{cov.missing.length ? `⚠️ ${cov.missing.length} ${L.missing}` : `✓ ${tr('All covered', '全て対応済み', 'Tudo coberto')}`}</span>
          </div>
          <div className="ds-tiles">
            <div><small>{L.expected}</small><b>{cov.totals.expected}</b></div>
            <div><small>{tr('Scheduled', '予定済み', 'Agendado')}</small><b className="blue">{cov.totals.scheduled}</b></div>
            <div><small>{L.done}</small><b className="green">{cov.totals.done}</b></div>
            <div><small>{tr('Missing', '不足', 'Faltando')}</small><b className={cov.missing.length ? 'red' : ''}>{cov.missing.length}</b></div>
          </div>
          {cov.places.length === 0 && <div className="ds-muted">{tr('No deep contract for this filter.', 'この条件の深層契約はありません。', 'Nenhum contrato de deep para este filtro.')}</div>}
          <div className="ds-places">
            {cov.places.map(p => {
              const pct = p.expected ? Math.round((p.done / p.expected) * 100) : 100
              const sch = p.expected ? Math.round((p.scheduled / p.expected) * 100) : 100
              const isOpen = openPlace === p.base
              return (
                <div key={p.base} className={`ds-place ${p.ok ? 'ok' : 'bad'}`}>
                  <button type="button" className="ds-place-head" onClick={() => setOpenPlace(isOpen ? null : p.base)} aria-expanded={isOpen}>
                    <span className="ds-place-name"><b>{p.ok ? '✓' : '⚠️'} {p.base}</b><small>{p.clientName}</small></span>
                    <span className="ds-place-nums">
                      <span title={L.done}>✅ {p.done}</span>
                      <span title={tr('Scheduled', '予定済み', 'Agendado')}>📅 {p.scheduled}</span>
                      <span title={L.expected}>🎯 {p.expected}</span>
                    </span>
                  </button>
                  <div className="ds-bar"><i className="sch" style={{ width: `${Math.min(100, sch)}%` }} /><i className="done" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                  {isOpen && (
                    <div className="ds-items">
                      {p.items.map(i => (
                        <span key={i.target.key} className={`ds-item ${i.scheduled >= i.expected ? 'ok' : 'bad'}`}>
                          {serviceName(i.target)} · {i.done}/{i.expected}
                          <small>{i.target.perMonth ? tr(`${i.target.perMonth}×/month`, `月${i.target.perMonth}回`, `${i.target.perMonth}×/mês`) : tr(`${i.target.perYear}×/year`, `年${i.target.perYear}回`, `${i.target.perYear}×/ano`)}</small>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {view && showCoverage && view.missing.length > 0 && (
        <section className="card ds-missing">
          <div className="card-title">⚠️ {tr('MISSING', '不足リスト', 'FALTANTES')} ({view.missing.length})</div>
          <div className="ds-muted" style={{ marginBottom: 10 }}>
            {tr('[Schedule] creates the visit without a person in the ', '[予定する] で担当なしの作業を ', '[Agendar] cria o serviço sem pessoa na ')}
            <Link to="/schedule">{tr('Pending box', '未割当ボックス', 'Caixa de Pendentes')}</Link>
            {tr(' to be assigned.', ' に作成し、そこで割り当てます。', ' para atribuir.')}
          </div>
          <div className="ds-mlist">
            {(allMissing ? view.missing : view.missing.slice(0, 6)).map(m => {
              const key = `${m.target.key}|${m.date}|${m.reason}`
              return (
                <div key={key} className={`ds-mrow r-${m.reason}`}>
                  <div className="ds-mrow-main">
                    <b>{m.target.base} — {serviceName(m.target)}</b>
                    <small>{m.target.clientName} · {fmtDay(m.date)}</small>
                    <span className="ds-reason">{reasonText(m)}</span>
                  </div>
                  {m.reason === 'notDone' ? (
                    <Link className="btn btn-sm" to={`/jobs?search=${m.job.id}`}>{tr('Open', '開く', 'Abrir')}</Link>
                  ) : (
                    <div className="ds-mrow-act">
                      <input type="date" value={dates[key] || (m.date >= today ? m.date : today)} min={today} onChange={e => setDates(d => ({ ...d, [key]: e.target.value }))} aria-label={tr('Date', '日付', 'Data')} />
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === key} onClick={() => doSchedule(m, key)}>{busy === key ? '…' : `📥 ${tr('Schedule', '予定する', 'Agendar')}`}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {view.missing.length > 6 && (
            <button type="button" className="btn btn-sm ds-more" onClick={() => setAllMissing(v => !v)}>
              {allMissing ? tr('Show less', '閉じる', 'Mostrar menos') : tr(`Show all (${view.missing.length})`, `すべて表示（${view.missing.length}）`, `Ver todos (${view.missing.length})`)}
            </button>
          )}
        </section>
      )}

      {view && (
        <section className="card ds-lines">
          <div className="card-title">{tr('Deep cleanings and spots', '深層清掃とスポット', 'Deep cleanings e spots')} ({view.lines.length})</div>
          {view.lines.length === 0 && <div className="ds-muted">{tr('Nothing in this period with these filters.', 'この期間・条件では何もありません。', 'Nada neste período com estes filtros.')}</div>}
          {view.lines.map(({ job: j, type: ty, state: stt }) => {
            const sc = data.spotByJob[j.id]
            const { base, rest } = splitName(j.title)
            return (
              <div key={j.id} className={`ds-line t-${ty}`}>
                <div className="ds-line-top">
                  <span className={`ds-type t-${ty}`}>{ty === 'spot' ? `⚡ ${L.spot}` : `✨ ${L.deep}`}</span>
                  <b className="ds-line-place">{base}</b>
                  <span className={`ds-state s-${stt}`}>{L[stt]}</span>
                </div>
                <div className="ds-line-sub">
                  {rest && <span>{rest}</span>}
                  <span>📅 {fmtDay(j.scheduled_date)}{j.scheduled_time ? ` · ${String(j.scheduled_time).slice(0, 5)}` : ''}</span>
                  <span>👤 {j.employee_name || empName(j.employee_id) || tr('No person', '担当なし', 'Sem pessoa')}</span>
                </div>
                {ty === 'spot' && (
                  <div className="ds-line-spot">
                    <span className={`ds-origin o-${spotOrigin(j, sc)}`}>{spotOrigin(j, sc) === 'client' ? `🏪 ${tr('Client request', '顧客の依頼', 'Pedido do cliente')}` : `🏢 ${tr('Internal', '社内', 'Interno')}`}</span>
                    <span className="ds-offer">{offerText(j)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
