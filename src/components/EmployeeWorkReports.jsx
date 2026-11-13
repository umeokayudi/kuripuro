// v1.0.252 · "Criar relatórios" pergunta PASSO A PASSO: 1) qual dia, 2) qual empresa, 3) qual loja (só se a empresa
// tem 2+ lojas); só então mostra os serviços daquele recorte. Empresa de 1 loja nunca vê "Todas as lojas".
// v1.0.229 · "Relatório de serviço" grows up: a PERIOD filter (Hoje / 7 dias / 15 dias / Este mês /
// 📅 De–Até), the day chips stay (now with "Todos"), three tappable counters (Por fazer / No escritório /
// Enviados) that filter the list, the list grouped by day with EVERY finished service (the ones without a
// report get a "Criar" button — no more hidden "Outro serviço" select), and "✚ Criar relatórios": a sheet
// where the employee ticks which services (by day or one by one, "só os que faltam" pre-ticked), chooses
// "mandar ao escritório" / "abrir um PDF com todos", and watches the progress. "📑 PDF" opens one PDF of the
// reports in the current filter.
// v1.0.172 · lives in "Meu dia" and in its own ☰ menu tab (no longer on Início).
// v1.0.150 · Employee home: 作業報告書 of my services. During the job: add photos (before /
// during / after) and notes; after the job: finish the text with the AI. The office sends it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { reportIdForJob, loadReport, saveReport, statusLabel } from '../lib/workReport'
import { quickJobReport } from '../lib/quickReport'
import toast from 'react-hot-toast'
import { locationNameFromTitle } from '../lib/cleaningType'
import { useLang } from '../hooks/useLang'
import WorkReportEditor from './WorkReportEditor'
import { combinedReportsHtml, groupByClientDay, isOnThePlanet } from '../lib/clientDayPdf'
import { openPrintHtml } from '../lib/openPrintHtml'
import { useCompanyStores, storesOfCompany, hasManyStores, companiesOfJobs, storeNameOfJob } from '../lib/companyStores'

const DAY = 864e5
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const MAX_BACK = 120 // the portal keeps the last 500 jobs; older reports live in the office
const MAX_LOAD = 150 // report summaries fetched at most per period
const PREF_KEY = 'kp_emp_reports_period'
const readPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null') } catch { return null } }
const writePref = v => { try { localStorage.setItem(PREF_KEY, JSON.stringify(v)) } catch { /* private mode */ } }

export function periodRange(preset, today, custom = {}) {
  if (preset === 'today') return { from: today, to: today }
  if (preset === '15') return { from: addDays(today, -14), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (preset === 'custom') {
    const min = addDays(today, -MAX_BACK)
    let from = custom.from || addDays(today, -6)
    let to = custom.to || today
    if (to > today) to = today
    if (from < min) from = min
    if (from > to) [from, to] = [to, from]
    return { from, to }
  }
  return { from: addDays(today, -6), to: today } // '7' (default)
}

const bucketOf = r => (!r || r.status === 'draft' ? 'todo' : r.status === 'sent' ? 'sent' : 'ready')

export default function EmployeeWorkReports({ jobs, activeJob, today, user, flat = false }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(null)
  const [state, setState] = useState({}) // jobId → its report
  const [loading, setLoading] = useState(false)
  const pref = useMemo(() => readPref() || {}, [])
  const [preset, setPreset] = useState(pref.preset || '7')
  const [custom, setCustom] = useState(pref.custom || {})
  const [pickedDay, setPickedDay] = useState(null) // null = every day of the period
  const [bucket, setBucket] = useState(null) // null | 'todo' | 'ready' | 'sent'
  const [creating, setCreating] = useState(false)
  const companyStores = useCompanyStores()
  const author = useMemo(() => ({ name: user?.name || '' }), [user?.name])
  const { from, to } = periodRange(preset, today, custom)
  useEffect(() => { writePref({ preset, custom }) }, [preset, custom])

  const inPeriod = useMemo(() => (jobs || [])
    .filter(j => j.scheduled_date >= from && j.scheduled_date <= to && (j.status === 'completed' || j.status === 'in_progress'))
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || String(b.scheduled_time || '').localeCompare(String(a.scheduled_time || ''))), [jobs, from, to])

  // Report summaries: fetched once per job (a ref remembers which ones were asked), a few at a time.
  const asked = useRef(new Set())
  const ids = inPeriod.slice(0, MAX_LOAD).map(j => j.id).join(',')
  useEffect(() => {
    let off = false
    const queue = inPeriod.slice(0, MAX_LOAD).filter(j => !asked.current.has(j.id))
    if (!queue.length) return undefined
    queue.forEach(j => asked.current.add(j.id))
    setLoading(true)
    const worker = async () => {
      while (queue.length && !off) {
        const j = queue.shift()
        try {
          const id = await reportIdForJob(j.id)
          const r = id ? await loadReport(id) : null
          if (r && !off) setState(s => ({ ...s, [j.id]: r }))
        } catch { asked.current.delete(j.id) }
      }
    }
    Promise.all(Array.from({ length: 6 }, worker)).then(() => { if (!off) setLoading(false) })
    // period changed mid-way: the ones not fetched yet are asked again next time
    return () => { off = true; queue.forEach(j => asked.current.delete(j.id)); setLoading(false) }
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = activeJob && activeJob.status === 'in_progress' ? activeJob : null
  const finished = inPeriod.filter(j => j.status === 'completed')
  const days = [...new Set(finished.map(j => j.scheduled_date))]
  const day = pickedDay && days.includes(pickedDay) ? pickedDay : null
  const ofDay = day ? finished.filter(j => j.scheduled_date === day) : finished
  const counts = { todo: 0, ready: 0, sent: 0 }
  ofDay.forEach(j => { counts[bucketOf(state[j.id])]++ })
  const shown = ofDay.filter(j => !bucket || bucketOf(state[j.id]) === bucket)
  const pendingOfDay = d => finished.some(j => j.scheduled_date === d && bucketOf(state[j.id]) === 'todo')

  const name = j => locationNameFromTitle(j.title) || j.title
  const ddmm = d => `${d?.slice(8)}/${d?.slice(5, 7)}`
  const wk = d => {
    const i = new Date(`${d}T12:00:00Z`).getUTCDay()
    return tr(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], ['日', '月', '火', '水', '木', '金', '土'][i], ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][i])
  }
  const dayHead = d => (d === today ? tr('Today', '今日', 'Hoje') : d === addDays(today, -1) ? tr('Yesterday', '昨日', 'Ontem') : wk(d)) + ` · ${ddmm(d)}`
  const periodTxt = from === to ? ddmm(from) : `${ddmm(from)} – ${ddmm(to)}`
  const statusClass = st => (st === 'sent' ? 'is-sent' : st === 'ready' ? 'is-ready' : 'is-draft')

  // One PDF of what is on screen (only services that already have a report).
  const shownReports = [...new Map(shown.filter(j => state[j.id]).map(j => [state[j.id].id, state[j.id]])).values()]
  const openPdf = (reports, { date, period } = {}) => {
    const clients = new Set(reports.map(r => r.client_name || ''))
    const html = combinedReportsHtml(reports, { clientName: clients.size === 1 ? [...clients][0] : '', date, period })
    if (html) openPrintHtml(html)
    else toast(tr('No report to put in the PDF yet.', 'PDFにする報告書がまだありません。', 'Ainda não há relatório para pôr no PDF.'))
  }
  const pdfOfScreen = () => openPdf(shownReports, day ? { date: day } : { period: periodTxt })

  // v1.0.181 · optional: all reports of one client on one day (e.g. every On The Planet store) in one PDF
  // v1.0.252 · só empresa com 2+ lojas no dia (empresa de 1 loja não é "todas as lojas")
  const groups = groupByClientDay([...new Map(ofDay.filter(j => state[j.id]).map(j => [state[j.id].id, state[j.id]])).values()])
    .filter(g => g.stores >= 2)
    .filter(g => Object.values(state).some(r => r.work_date === g.date && r.kind !== 'period' && (r.client_id || r.client_name) !== (g.client_id || g.client_name)))
    .slice(0, 3)

  const byDay = []
  shown.forEach(j => {
    const last = byDay[byDay.length - 1]
    if (last && last.date === j.scheduled_date) last.jobs.push(j)
    else byDay.push({ date: j.scheduled_date, jobs: [j] })
  })

  const presets = [
    ['today', tr('Today', '今日', 'Hoje')],
    ['7', tr('7 days', '7日間', '7 dias')],
    ['15', tr('15 days', '15日間', '15 dias')],
    ['month', tr('This month', '今月', 'Este mês')],
    ['custom', `📅 ${tr('Dates', '期間', 'Datas')}`],
  ]
  const choosePreset = p => {
    setPreset(p); setPickedDay(null)
    if (p === 'custom' && !custom.from) setCustom({ from: addDays(today, -6), to: today })
  }

  return (
    <div className={`ewr${flat ? ' ewr-flat' : ''}`}>
      {!flat && <>
        <div className="ewr-title">📄 {tr('Service report', '作業報告書', 'Relatório de serviço')}</div>
        <div className="ewr-sub">{tr('Photos and notes now or later — the AI writes it, the office sends it to the client.', '写真とメモは作業中でも後でもOK。AIが文章を作成し、事務所が送付します。', 'Fotos e notas agora ou depois — a IA escreve e o escritório envia ao cliente.')}</div>
      </>}

      {/* Period */}
      <div className="ewr-period" role="group" aria-label={tr('Period', '期間', 'Período')}>
        {presets.map(([k, label]) => (
          <button key={k} type="button" className={preset === k ? 'on' : ''} aria-pressed={preset === k} onClick={() => choosePreset(k)}>{label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="ewr-range">
          <label><span>{tr('From', '開始', 'De')}</span>
            <input type="date" value={from} min={addDays(today, -MAX_BACK)} max={today} onChange={e => { setCustom(c => ({ ...c, from: e.target.value, to: c.to || to })); setPickedDay(null) }} />
          </label>
          <label><span>{tr('To', '終了', 'Até')}</span>
            <input type="date" value={to} min={addDays(today, -MAX_BACK)} max={today} onChange={e => { setCustom(c => ({ ...c, to: e.target.value, from: c.from || from })); setPickedDay(null) }} />
          </label>
        </div>
      )}

      {/* Day chips: "Todos" + each day with services in the period (dot = something still to do) */}
      {days.length > 1 && (
        <div className="ewr-days" role="tablist" aria-label={tr('Day', '日付', 'Dia')}>
          <button type="button" role="tab" aria-selected={!day} className={!day ? 'on' : ''} onClick={() => setPickedDay(null)}>{tr('All', 'すべて', 'Todos')}</button>
          {days.map(d => (
            <button key={d} type="button" role="tab" aria-selected={d === day} className={d === day ? 'on' : ''} onClick={() => setPickedDay(d)}>
              {d === today ? tr('Today', '今日', 'Hoje') : ddmm(d)}{pendingOfDay(d) && <i aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      {/* Counters = status filter */}
      {finished.length > 0 && (
        <div className="ewr-stats">
          {[['todo', tr('To do', '未作成', 'Por fazer')], ['ready', tr('At the office', '事務所', 'No escritório')], ['sent', tr('Sent', '送付済み', 'Enviados')]].map(([k, label]) => (
            <button key={k} type="button" className={`ewr-stat is-${k}${bucket === k ? ' on' : ''}`} aria-pressed={bucket === k} onClick={() => setBucket(b => (b === k ? null : k))}>
              <b>{counts[k]}</b><span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      {finished.length > 0 && (
        <div className="ewr-actions">
          <button type="button" className="ewr-all" onClick={() => setCreating(true)} data-testid="ewr-create">
            <span>✚ {tr('Create reports', '報告書を作成', 'Criar relatórios')}</span>
            <small>{counts.todo > 0
              ? tr(`Pick the services · ${counts.todo} still to do ${day ? `on ${ddmm(day)}` : 'in this period'}`, `作業を選ぶ · ${day ? ddmm(day) : 'この期間'}の未作成 ${counts.todo}件`, `Escolha os serviços · ${counts.todo} ainda por fazer ${day ? `em ${ddmm(day)}` : 'neste período'}`)
              : tr('Everything is done ✓ — you can still pick and redo the PDF', 'すべて作成済み ✓ — 選んでPDFを作り直せます', 'Tudo feito ✓ — dá para escolher e refazer o PDF')}</small>
          </button>
          <button type="button" className="ewr-pdfbtn" disabled={!shownReports.length} onClick={pdfOfScreen} title={tr('One PDF with the reports listed below', '下の報告書を1つのPDFに', 'Um PDF com os relatórios da lista')}>
            <span>📑</span><small>PDF{shownReports.length ? ` (${shownReports.length})` : ''}</small>
          </button>
        </div>
      )}

      {live && (
        <div className="ewr-row is-live">
          <div className="ewr-row-main">
            <b>🟢 {name(live)}</b>
            <span>{ddmm(live.scheduled_date)} · {tr('in progress', '作業中', 'em andamento')}</span>
          </div>
          <button type="button" className="ewr-btn" onClick={() => setOpen(live)}>📷 {state[live.id] ? tr('Continue', '続ける', 'Continuar') : tr('Photos', '写真', 'Fotos')}</button>
        </div>
      )}

      {!finished.length && !live && (
        <p className="ewr-empty">{tr(`No finished services in ${periodTxt}.`, `${periodTxt}に完了した作業はありません。`, `Nenhum serviço terminado em ${periodTxt}.`)}{preset !== 'month' && preset !== 'custom' && <> <button type="button" onClick={() => choosePreset('custom')}>{tr('Pick other dates', '別の期間', 'Escolher outras datas')}</button></>}</p>
      )}
      {finished.length > 0 && !shown.length && (
        <p className="ewr-empty">{tr('Nothing here with this filter.', 'この条件では何もありません。', 'Nada aqui com este filtro.')} <button type="button" onClick={() => { setBucket(null); setPickedDay(null) }}>{tr('Show all', 'すべて表示', 'Mostrar todos')}</button></p>
      )}

      {byDay.map(g => (
        <div key={g.date} className="ewr-group">
          <div className="ewr-dayhead"><b>{dayHead(g.date)}</b><span>{g.jobs.length} {g.jobs.length === 1 ? tr('service', '件', 'serviço') : tr('services', '件', 'serviços')}</span></div>
          {g.jobs.map(j => {
            const r = state[j.id]
            return (
              <div key={j.id} className="ewr-row">
                <div className="ewr-row-main">
                  <b>{name(j)}</b>
                  <span>{r
                    ? <><em className={`ewr-st ${statusClass(r.status)}`}>{statusLabel(r.status, tr)}</em> · 📷 {(r.photos || []).length}</>
                    : <em className="ewr-st is-none">{loading ? '…' : tr('No report', '報告書なし', 'Sem relatório')}</em>}</span>
                </div>
                <button type="button" className={`ewr-btn${r?.status === 'sent' ? ' is-light' : ''}${!r ? ' is-new' : ''}`} onClick={() => setOpen(j)}>
                  {!r ? `✚ ${tr('Create', '作成', 'Criar')}` : r.status === 'sent' ? tr('View', '見る', 'Ver') : tr('Continue', '続ける', 'Continuar')}
                </button>
              </div>
            )
          })}
        </div>
      ))}

      {groups.map(g => (
        <button key={g.key} type="button" className={`ewr-pdf${isOnThePlanet(g.client_name) ? ' is-otp' : ''}`} onClick={() => openPdf(g.reports, { date: g.date })}>
          <span>📑 {tr(`One PDF: all ${g.reports.length} ${g.client_name} stores · ${ddmm(g.date)}`, `${g.client_name}の${g.reports.length}店舗を1つのPDFに · ${ddmm(g.date)}`, `Um PDF só: as ${g.reports.length} lojas ${g.client_name} · ${ddmm(g.date)}`)}</span>
          <small>{tr('Optional — the separate reports stay as they are.', '任意：個別の報告書はそのまま残ります。', 'Opcional — os relatórios separados continuam iguais.')}</small>
        </button>
      ))}

      {creating && (
        <CreateReportsSheet
          finished={finished} state={state} day={day} periodTxt={periodTxt} author={author} tr={tr}
          name={name} dayHead={dayHead} bucketOf={bucketOf} statusLabel={statusLabel} companyStores={companyStores}
          onReport={(jobId, r) => setState(s => ({ ...s, [jobId]: r }))}
          onPdf={openPdf}
          onClose={() => setCreating(false)} />
      )}
      {open && (
        <WorkReportEditor job={open} role="employee" author={author}
          onSaved={r => setState(s => ({ ...s, [open.id]: r }))}
          onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

// ── "Criar relatórios": dia → empresa → loja (se 2+) → marcar os serviços → progresso ───────────
function CreateReportsSheet({ finished, state, periodTxt, author, tr, name, dayHead, bucketOf, statusLabel, companyStores, onReport, onPdf, onClose }) {
  const [pickDay, setPickDay] = useState(null)       // passo 1
  const [pickCo, setPickCo] = useState(null)         // passo 2 (chave da empresa)
  const [pickStore, setPickStore] = useState(null)   // passo 3: '' = todas as lojas, 'Nome' = uma loja
  const [sel, setSel] = useState(() => new Set())
  const [toOffice, setToOffice] = useState(true)
  const [onePdf, setOnePdf] = useState(true)
  const [run, setRun] = useState(null) // { done, total, ok, made[], failed[] }
  const busy = run && run.done < run.total

  const days = [...new Set(finished.map(j => j.scheduled_date))]
  const jobsOfDay = pickDay ? finished.filter(j => j.scheduled_date === pickDay) : []
  const companies = companiesOfJobs(jobsOfDay)
  const company = companies.find(c => c.key === pickCo) || null
  const storesAll = company ? storesOfCompany(companyStores, company.client_id, company.jobs.map(storeNameOfJob)) : []
  const many = hasManyStores(storesAll)
  const storesOfDay = company ? [...new Set(company.jobs.map(storeNameOfJob))].sort((a, b) => a.localeCompare(b, 'ja')) : []
  // empresa de 1 loja: o passo 3 não existe e o recorte já é o local único
  const storeStepDone = company && (many ? pickStore !== null : true)
  const cutJobs = company && storeStepDone
    ? company.jobs.filter(j => !many || pickStore === '' || storeNameOfJob(j) === pickStore)
    : []
  const step = !pickDay ? 'day' : !company ? 'company' : !storeStepDone ? 'store' : 'pick'
  const missing = js => js.filter(j => bucketOf(state[j.id]) === 'todo').length

  const goDay = d => { setPickDay(d); setPickCo(null); setPickStore(null); setSel(new Set()) }
  const goCompany = c => {
    setPickCo(c.key); setPickStore(null)
    const stores = storesOfCompany(companyStores, c.client_id, c.jobs.map(storeNameOfJob))
    if (!hasManyStores(stores)) setSel(new Set(c.jobs.filter(j => bucketOf(state[j.id]) === 'todo').map(j => j.id)))
  }
  const goStore = st => {
    setPickStore(st)
    const list = company.jobs.filter(j => !st || storeNameOfJob(j) === st)
    setSel(new Set(list.filter(j => bucketOf(state[j.id]) === 'todo').map(j => j.id)))
  }
  const back = () => {
    if (step === 'pick') { if (many) { setPickStore(null) } else { setPickCo(null) }; setSel(new Set()) }
    else if (step === 'store') { setPickCo(null); setPickStore(null) }
    else if (step === 'company') goDay(null)
  }

  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const picked = cutJobs.filter(j => sel.has(j.id))
  const todoIds = cutJobs.filter(j => bucketOf(state[j.id]) === 'todo').map(j => j.id)

  const start = async () => {
    const list = picked
    if (!list.length) return
    setRun({ done: 0, total: list.length, ok: 0, made: [], failed: [] })
    const made = []
    const failed = []
    for (const j of list) {
      try {
        let r = await quickJobReport(j, { author })
        if (r && toOffice && r.status === 'draft') r = await saveReport({ ...r, status: 'ready' }, { by: author.name, action: 'ready-picked' })
        if (r) { onReport(j.id, r); made.push(r) }
      } catch (err) { console.warn('report', j.id, err); failed.push(j.id) }
      setRun(x => x && { ...x, done: x.done + 1, ok: made.length, made: [...made], failed: [...failed] })
    }
    const uniq = [...new Map(made.map(r => [r.id, r])).values()]
    const pdfOpts = { date: pickDay }
    setRun(x => x && { ...x, pdfOpts })
    if (onePdf && uniq.length) onPdf(uniq, pdfOpts)
    if (!failed.length) toast.success(tr(`${uniq.length} reports ready`, `${uniq.length}件の報告書を作成しました`, `${uniq.length} relatórios prontos`))
    else toast.error(tr(`${list.length - failed.length} of ${list.length} done — try again for the rest`, `${list.length}件中${list.length - failed.length}件完了。残りはもう一度`, `${list.length - failed.length} de ${list.length} feitos — tente de novo para o resto`))
  }

  const ddmm = d => `${d?.slice(8)}/${d?.slice(5, 7)}`
  const nServ = n => `${n} ${n === 1 ? tr('service', '件', 'serviço') : tr('services', '件', 'serviços')}`
  const todoTxt = n => (n > 0 ? tr(`${n} to do`, `未作成 ${n}`, `${n} por fazer`) : tr('all done ✓', '作成済み ✓', 'tudo feito ✓'))
  const finishedRun = run && run.done >= run.total
  const crumb = [
    pickDay && { k: 'day', t: dayHead(pickDay), go: () => goDay(null) },
    company && { k: 'co', t: company.name, go: () => { setPickCo(null); setPickStore(null); setSel(new Set()) } },
    company && many && pickStore !== null && { k: 'st', t: pickStore || tr('All stores', '全店舗', 'Todas as lojas'), go: () => { setPickStore(null); setSel(new Set()) } },
  ].filter(Boolean)
  const title = step === 'day' ? tr('Which day?', 'どの日ですか？', 'Qual dia?')
    : step === 'company' ? tr('Which company?', 'どの会社ですか？', 'Qual empresa?')
    : step === 'store' ? tr('Which store?', 'どの店舗ですか？', 'Qual loja?')
    : tr('Tick the services', '作業を選んでください', 'Marque os serviços')

  return createPortal(
    <div className="ewr-sheet-bg" onClick={() => { if (!busy) onClose() }} role="presentation">
      <div className="ewr-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={tr('Create reports', '報告書を作成', 'Criar relatórios')} data-testid="ewr-sheet">
        <div className="ewr-sheet-grip" />
        <div className="ewr-sheet-head">
          <div>
            <b>✚ {tr('Create reports', '報告書を作成', 'Criar relatórios')}</b>
            <span>{run ? periodTxt : title}</span>
          </div>
          <button type="button" className="ewr-x" disabled={busy} onClick={onClose} aria-label={tr('Close', '閉じる', 'Fechar')}>✕</button>
        </div>

        {!run && crumb.length > 0 && (
          <div className="ewr-quick" data-testid="ewr-crumb" style={{ flexWrap: "wrap" }}>
            <button type="button" onClick={back}>‹ {tr('Back', '戻る', 'Voltar')}</button>
            {crumb.map(c => <button key={c.k} type="button" onClick={c.go}>{c.t}</button>)}
          </div>
        )}

        {!run && step === 'day' && (
          <div className="ewr-sheet-body" data-testid="ewr-step-day">
            {days.map(d => {
              const js = finished.filter(j => j.scheduled_date === d)
              return (
                <button key={d} type="button" className="ewr-pick" style={{ width: "100%", textAlign: "left" }} onClick={() => goDay(d)}>
                  <span className="ewr-pick-main"><b>{dayHead(d)}</b><em className={`ewr-st ${missing(js) ? 'is-none' : 'is-sent'}`}>{nServ(js.length)} · {todoTxt(missing(js))}</em></span>
                </button>
              )
            })}
          </div>
        )}

        {!run && step === 'company' && (
          <div className="ewr-sheet-body" data-testid="ewr-step-company">
            {companies.map(c => (
              <button key={c.key} type="button" className="ewr-pick" style={{ width: "100%", textAlign: "left" }} onClick={() => goCompany(c)}>
                <span className="ewr-pick-main"><b>{c.name}</b><em className={`ewr-st ${missing(c.jobs) ? 'is-none' : 'is-sent'}`}>{nServ(c.jobs.length)} · {todoTxt(missing(c.jobs))}</em></span>
              </button>
            ))}
          </div>
        )}

        {!run && step === 'store' && (
          <div className="ewr-sheet-body" data-testid="ewr-step-store">
            <button type="button" className="ewr-pick" style={{ width: "100%", textAlign: "left" }} onClick={() => goStore('')}>
              <span className="ewr-pick-main"><b>{tr('All stores', '全店舗', 'Todas as lojas')}</b><em className={`ewr-st ${missing(company.jobs) ? 'is-none' : 'is-sent'}`}>{nServ(company.jobs.length)} · {todoTxt(missing(company.jobs))}</em></span>
            </button>
            {storesOfDay.map(st => {
              const js = company.jobs.filter(j => storeNameOfJob(j) === st)
              return (
                <button key={st} type="button" className="ewr-pick" style={{ width: "100%", textAlign: "left" }} onClick={() => goStore(st)}>
                  <span className="ewr-pick-main"><b>{st}</b><em className={`ewr-st ${missing(js) ? 'is-none' : 'is-sent'}`}>{nServ(js.length)} · {todoTxt(missing(js))}</em></span>
                </button>
              )
            })}
          </div>
        )}

        {!run && step === 'pick' && <>
          <div className="ewr-quick">
            <button type="button" onClick={() => setSel(new Set(todoIds))}>{tr(`Only missing (${todoIds.length})`, `未作成のみ (${todoIds.length})`, `Só os que faltam (${todoIds.length})`)}</button>
            <button type="button" onClick={() => setSel(new Set(cutJobs.map(j => j.id)))}>{tr(`All (${cutJobs.length})`, `すべて (${cutJobs.length})`, `Todos (${cutJobs.length})`)}</button>
            <button type="button" onClick={() => setSel(new Set())}>{tr('Clear', 'クリア', 'Limpar')}</button>
          </div>
          <div className="ewr-sheet-body" data-testid="ewr-step-pick">
            <div className="ewr-pick-day">
              {cutJobs.map(j => {
                const r = state[j.id]
                const b = bucketOf(r)
                return (
                  <label key={j.id} className={`ewr-pick${sel.has(j.id) ? ' on' : ''}`}>
                    <input type="checkbox" checked={sel.has(j.id)} onChange={() => toggle(j.id)} />
                    <span className="ewr-pick-main">
                      <b>{name(j)}</b>
                      <em className={`ewr-st ${b === 'todo' ? (r ? 'is-draft' : 'is-none') : b === 'sent' ? 'is-sent' : 'is-ready'}`}>{r ? statusLabel(r.status, tr) : tr('No report', '報告書なし', 'Sem relatório')}</em>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="ewr-opts">
            <label><input type="checkbox" checked={toOffice} onChange={e => setToOffice(e.target.checked)} /><span>{tr('Send to the office', '事務所へ送る', 'Mandar ao escritório')}<small>{tr('Drafts become "ready to send"', '下書きを「送付準備OK」に', 'Rascunhos viram "pronto para enviar"')}</small></span></label>
            <label><input type="checkbox" checked={onePdf} onChange={e => setOnePdf(e.target.checked)} /><span>{tr('Open one PDF with all', '1つのPDFで開く', 'Abrir um PDF com todos')}<small>{tr('To check or share', '確認・共有用', 'Para conferir ou mandar')}</small></span></label>
          </div>
          <div className="ewr-sheet-foot">
            <button type="button" className="ewr-go" disabled={!picked.length} onClick={start} data-testid="ewr-go">
              {picked.length
                ? tr(`Create ${picked.length} report${picked.length === 1 ? '' : 's'}`, `${picked.length}件を作成`, `Criar ${picked.length} relatório${picked.length === 1 ? '' : 's'}`)
                : tr('Tick at least one service', '1件以上選んでください', 'Marque pelo menos um serviço')}
            </button>
            <small>{tr('Uses the saved photos, checklist and signature. Reports that already exist are kept.', '保存済みの写真・チェックリスト・署名を使います。既存の報告書はそのまま。', 'Usa as fotos, o checklist e a assinatura salvos. Relatório que já existe fica como está.')}</small>
          </div>
        </>}

        {run && (
          <div className="ewr-run">
            <div className="ewr-bar"><i style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} /></div>
            <b>{finishedRun
              ? (run.failed.length ? tr(`${run.total - run.failed.length} of ${run.total} done`, `${run.total}件中${run.total - run.failed.length}件完了`, `${run.total - run.failed.length} de ${run.total} feitos`) : `✓ ${tr(`${run.total} reports ready`, `${run.total}件 作成完了`, `${run.total} relatórios prontos`)}`)
              : `⏳ ${tr('Making reports', '作成中', 'Gerando relatórios')} ${run.done}/${run.total}…`}</b>
            <ul>
              {picked.map((j, i) => (
                <li key={j.id} className={run.failed.includes(j.id) ? 'is-err' : i < run.done ? 'is-ok' : ''}>
                  <span>{run.failed.includes(j.id) ? '⚠️' : i < run.done ? '✓' : i === run.done ? '⏳' : '·'}</span>{name(j)} <small>{j.scheduled_date.slice(8)}/{j.scheduled_date.slice(5, 7)}</small>
                </li>
              ))}
            </ul>
            {finishedRun && (
              <div className="ewr-run-foot">
                {run.made.length > 0 && <button type="button" className="ewr-go is-light" onClick={() => onPdf([...new Map(run.made.map(r => [r.id, r])).values()], run.pdfOpts)}>📑 {tr('Open the PDF', 'PDFを開く', 'Abrir o PDF')}</button>}
                <button type="button" className="ewr-go" onClick={onClose}>{tr('Done', '完了', 'Pronto')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
