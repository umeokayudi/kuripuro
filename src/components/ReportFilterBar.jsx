// v1.0.141 · Reports filters: one panel at the top (period chips, employee chips with counts,
// client / place / type / sort / search, problem chips with counts) + a slim bar that stays
// visible under the top bar while scrolling the list, with the active filters and "Clear".
import { useEffect, useRef, useState } from 'react'
import { pickLang } from '../hooks/useLang'
import { activeFilterCount, DEFAULT_FILTERS } from '../lib/reportFilters'

const fmtD = (ymd, lang) => {
  if (!ymd) return ''
  const [, m, d] = ymd.split('-')
  return lang === 'ja' ? `${Number(m)}/${Number(d)}` : `${d}/${m}`
}

export default function ReportFilterBar({ f, setF, reset, today, range, lang, facets, clients, videoPending, total, shown, loading, actions }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const panelRef = useRef(null)
  const [stuck, setStuck] = useState(false)
  const [box, setBox] = useState({ top: 0, left: 0, width: 0 })

  // the slim bar appears once the panel scrolled out of view; it sits right under the app top bar
  useEffect(() => {
    const el = panelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const tb = document.querySelector('.topbar')
    const off = tb ? tb.getBoundingClientRect().height : 0
    const measure = () => { const r = el.getBoundingClientRect(); setBox({ top: off, left: r.left, width: r.width }) }
    measure()
    const io = new IntersectionObserver(([e]) => { measure(); setStuck(!e.isIntersecting && e.boundingClientRect.top < off) }, { rootMargin: `-${off}px 0px 0px 0px` })
    io.observe(el)
    window.addEventListener('resize', measure)
    return () => { io.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const PERIOD_LABEL = {
    today: L('Today', '今日', 'Hoje'),
    yesterday: L('Yesterday', '昨日', 'Ontem'),
    7: L('7 days', '7日間', '7 dias'),
    30: L('30 days', '30日間', '30 dias'),
    month: L('This month', '今月', 'Este mês'),
    lastmonth: L('Last month', '先月', 'Mês passado'),
    90: L('90 days', '90日間', '90 dias'),
    custom: L('📅 Dates…', '📅 期間指定…', '📅 Datas…'),
  }
  const TYPE_LABEL = {
    done: L('All completed', '完了すべて', 'Todos concluídos'),
    live: L('Live', 'ライブ', 'Ao vivo'),
    retro: L('Retroactive', '事後報告', 'Retroativo'),
    manual: L('🔒 Closed by admin', '🔒 管理者が完了', '🔒 Fechado pelo admin'),
    open: L('Not finished (pending / late)', '未完了（保留・遅れ）', 'Não concluídos (pendentes / atrasados)'),
    everything: L('Everything (completed + not finished)', 'すべて（完了＋未完了）', 'Tudo (concluídos + não concluídos)'),
  }
  const PROBLEM_LABEL = {
    long: ['⚠️', L('Over 2× planned time', '予定の2倍超', 'Passou 2× do tempo')],
    lowai: ['🤖', L('Low AI grade (< 6)', 'AI評価が低い (6未満)', 'Nota IA baixa (< 6)')],
    checklist: ['☑', L('Checklist incomplete', 'チェック未完了', 'Checklist incompleto')],
    nophoto: ['📷', L('No photo', '写真なし', 'Sem foto')],
    nosig: ['✍️', L('No signature', 'サインなし', 'Sem assinatura')],
    novideo: ['🎬', L('No video', '動画なし', 'Sem vídeo')],
    notes: ['📝', L('Has notes', 'メモあり', 'Com notas')],
    open: ['⏰', L('Pending / late', '保留・遅れ', 'Pendente / atrasado')],
  }

  const periodText = f.period === 'custom' || f.period === 'today' || f.period === 'yesterday'
    ? (range.from === range.to ? fmtD(range.from, lang) : `${fmtD(range.from, lang)} – ${fmtD(range.to, lang)}`)
    : PERIOD_LABEL[f.period]

  const empNames = Object.keys(facets.emp).sort((a, b) => facets.emp[b] - facets.emp[a] || a.localeCompare(b))
  if (f.emp && !empNames.includes(f.emp)) empNames.unshift(f.emp)
  const places = Object.keys(facets.place).sort((a, b) => a.localeCompare(b))
  if (f.place && !places.includes(f.place)) places.unshift(f.place)
  const clientName = id => clients.find(c => c.id === id)?.company_name || id
  const shortName = n => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0] }

  const toggleProblem = p => setF(cur => ({ problems: cur.problems.includes(p) ? cur.problems.filter(x => x !== p) : [...cur.problems, p] }))
  const nActive = activeFilterCount(f)

  // active filters as removable pills (used in the slim bar)
  const pills = [
    f.period !== DEFAULT_FILTERS.period && { k: 'p', label: '📅 ' + periodText, clear: { period: DEFAULT_FILTERS.period, from: '', to: '' } },
    f.emp && { k: 'emp', label: '👤 ' + f.emp, clear: { emp: '' } },
    f.client && { k: 'client', label: '🏢 ' + clientName(f.client), clear: { client: '' } },
    f.place && { k: 'place', label: '📍 ' + f.place, clear: { place: '' } },
    f.type !== 'done' && { k: 'type', label: TYPE_LABEL[f.type], clear: { type: 'done' } },
    ...f.problems.map(p => ({ k: 'pb' + p, label: PROBLEM_LABEL[p].join(' '), clear: cur => ({ problems: cur.problems.filter(x => x !== p) }) })),
    f.q && { k: 'q', label: '🔎 “' + f.q + '”', clear: { q: '' } },
  ].filter(Boolean)

  const countText = loading ? L('Loading…', '読み込み中…', 'Carregando…')
    : shown === total
      ? L(`${total} reports`, `${total}件`, `${total} reports`)
      : L(`${shown} of ${total} reports`, `${total}件中 ${shown}件`, `${shown} de ${total} reports`)

  return (
    <>
      <div className="card rf-panel" ref={panelRef}>
        <div className="rf-row">
          <span className="rf-label">{L('Period', '期間', 'Período')}</span>
          <div className="rf-chips">
            {['today', 'yesterday', '7', '30', 'month', 'lastmonth', '90', 'custom'].map(p => (
              <button key={p} type="button" className={'rf-chip' + (f.period === p ? ' on' : '')}
                onClick={() => setF(p === 'custom' ? { period: 'custom', from: f.from || range.from, to: f.to || range.to } : { period: p, from: '', to: '' })}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
            {f.period === 'custom' && (
              <span className="rf-dates">
                <input type="date" value={f.from || range.from} max={today} onChange={e => setF({ from: e.target.value })} aria-label={L('From', '開始', 'De')} />
                <span>–</span>
                <input type="date" value={f.to || range.to} max={today} onChange={e => setF({ to: e.target.value })} aria-label={L('To', '終了', 'Até')} />
              </span>
            )}
            <span className="rf-range">{range.from === range.to ? fmtD(range.from, lang) : `${fmtD(range.from, lang)} – ${fmtD(range.to, lang)}`}</span>
          </div>
        </div>

        <div className="rf-row">
          <span className="rf-label">{L('Employee', 'スタッフ', 'Funcionário')}</span>
          <div className="rf-chips">
            <button type="button" className={'rf-chip' + (!f.emp ? ' on' : '')} onClick={() => setF({ emp: '' })}>
              {L('Everyone', '全員', 'Todos')} <b>{facets.empAll}</b>
            </button>
            {empNames.map(n => (
              <button key={n} type="button" title={n} className={'rf-chip' + (f.emp === n ? ' on' : '') + (!facets.emp[n] ? ' zero' : '')}
                onClick={() => setF({ emp: f.emp === n ? '' : n })}>
                {shortName(n)} <b>{facets.emp[n] || 0}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="rf-row rf-grid">
          <label className="rf-field">
            <span>{L('Client', '顧客', 'Cliente')}</span>
            <select value={f.client} onChange={e => setF({ client: e.target.value, place: '' })}>
              <option value="">{L('All clients', 'すべての顧客', 'Todos os clientes')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}{facets.client[c.id] ? ` (${facets.client[c.id]})` : ''}</option>)}
            </select>
          </label>
          <label className="rf-field">
            <span>{L('Place', '現場', 'Local')}</span>
            <select value={f.place} onChange={e => setF({ place: e.target.value })}>
              <option value="">{L('All places', 'すべての現場', 'Todos os locais')}</option>
              {places.map(p => <option key={p} value={p}>{p} ({facets.place[p] || 0})</option>)}
            </select>
          </label>
          <label className="rf-field">
            <span>{L('Type', '種類', 'Tipo')}</span>
            <select value={f.type} onChange={e => setF({ type: e.target.value })}>
              {Object.keys(TYPE_LABEL).map(k => {
                const n = k === 'done' ? (facets.type.live || 0) + (facets.type.retro || 0) + (facets.type.manual || 0)
                  : k === 'everything' ? null : facets.type[k]
                return <option key={k} value={k}>{TYPE_LABEL[k]}{n != null && (k !== 'open' || f.type === 'open' || f.type === 'everything') ? ` (${n || 0})` : ''}</option>
              })}
            </select>
          </label>
          <label className="rf-field">
            <span>{L('Sort', '並び順', 'Ordenar')}</span>
            <select value={f.sort} onChange={e => setF({ sort: e.target.value })}>
              <option value="recent">{L('Newest first', '新しい順', 'Mais recentes')}</option>
              <option value="oldest">{L('Oldest first', '古い順', 'Mais antigos')}</option>
              <option value="longest">{L('Longest time', '作業時間が長い順', 'Mais demorados')}</option>
              <option value="worstai">{L('Worst AI grade', 'AI評価が低い順', 'Pior nota da IA')}</option>
              <option value="employee">{L('Employee A–Z', 'スタッフ名順', 'Funcionário A–Z')}</option>
            </select>
          </label>
          <label className="rf-field rf-search">
            <span>{L('Search', '検索', 'Buscar')}</span>
            <input type="search" value={f.q} onChange={e => setF({ q: e.target.value })}
              placeholder={L('store, employee, note…', '店舗・スタッフ・メモ…', 'loja, funcionário, nota…')} />
          </label>
        </div>

        <div className="rf-row">
          <span className="rf-label">{L('Problems', '問題', 'Problemas')}</span>
          <div className="rf-chips">
            {['long', 'lowai', 'checklist', 'nophoto', 'nosig', 'novideo', 'notes', 'open'].map(p => {
              const n = facets.problem[p] || 0
              const on = f.problems.includes(p)
              const waiting = p === 'novideo' && videoPending
              return (
                <button key={p} type="button" className={'rf-chip rf-chip-pb' + (on ? ' on' : '') + (!n && !on ? ' zero' : '')} onClick={() => toggleProblem(p)}
                  title={p === 'open' ? L('Also loads jobs that were not finished', '未完了の作業も読み込みます', 'Também carrega os serviços não concluídos') : undefined}>
                  {PROBLEM_LABEL[p][0]} {PROBLEM_LABEL[p][1]} {p === 'open' && !(f.type === 'open' || f.type === 'everything' || on) ? null : <b>{waiting ? '…' : n}</b>}
                </button>
              )
            })}
          </div>
        </div>
        {f.problems.length > 1 && <div className="rf-hint">{L('Showing reports with any of the selected problems.', '選んだ問題のどれかがあるレポートを表示。', 'Mostrando reports com qualquer um dos problemas marcados.')}</div>}

        <div className="rf-foot">
          <div className="rf-count"><b>{countText}</b>{nActive > 0 && <button type="button" className="rf-clear" onClick={reset}>✕ {L(`Clear filters (${nActive})`, `条件をクリア (${nActive})`, `Limpar filtros (${nActive})`)}</button>}</div>
          <div className="rf-actions">{actions}</div>
        </div>
      </div>

      {stuck && (
        <div className="rf-sticky" style={{ top: box.top + 6, left: box.left, width: box.width }}>
          <b className="rf-sticky-count">{countText}</b>
          <select value={f.emp} onChange={e => setF({ emp: e.target.value })} aria-label={L('Employee', 'スタッフ', 'Funcionário')}>
            <option value="">👤 {L('Everyone', '全員', 'Todos')}</option>
            {empNames.map(n => <option key={n} value={n}>{n} ({facets.emp[n] || 0})</option>)}
          </select>
          <div className="rf-pills">
            {pills.filter(p => p.k !== 'emp').map(p => (
              <button key={p.k} type="button" className="rf-pill" onClick={() => setF(p.clear)} title={L('Remove', '外す', 'Tirar')}>{p.label} ✕</button>
            ))}
          </div>
          {nActive > 0 && <button type="button" className="rf-clear" onClick={reset}>{L('Clear', 'クリア', 'Limpar')}</button>}
          <button type="button" className="btn btn-sm" onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>⚙ {L('Filters', '条件', 'Filtros')}</button>
        </div>
      )}
    </>
  )
}
