import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QuickReportButton } from './QuickReport'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang, pickLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchPendingTimeOff, decideTimeOff, TIME_OFF_CHANGED } from '../lib/timeOff'
import { fetchAutoClosedPeriods, PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { fetchPendingQuoteRequests, QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import { fetchQuoteFlowAlerts, QUOTE_FLOW_CHANGED } from '../lib/quoteFlow'
import { fmtPeriod } from '../lib/salaryPeriod'
import { fmtDay } from './AvailabilityPlanner'
import { fetchDayContext } from '../lib/dayContext'
import DayContext from './DayContext'
import { fetchFacilityOffers, offerToClient, offerWhen } from './facility/FacilityOffersBell'
import { ELEMENT_KINDS } from '../lib/facilityModel'
import { fetchAssignAlerts } from '../lib/assignNotices'
import { PENDING_CHANGED, pendingChanged } from '../lib/adminPending'
import { fetchExceptions } from '../lib/exceptionQueue'
import { askConfirm } from './ConfirmDialog'
import { exceptionInfo, exceptionDeadline } from '../lib/exceptionText'
import { hideTests, HIDE_TESTS_CHANGED } from '../lib/testData'
import { fetchOtpRouteAlerts } from '../lib/jobDeadline'
import { decideCoverFlow } from '../lib/coverageOps'
import { fetchDayPanels, serviceLabel, plural } from '../lib/dayPanel'
import { addDays } from '../lib/schedulePlan'
import { impossibleText } from '../lib/routePlan'
import { ROUTE_SETTINGS_CHANGED } from '../lib/routeSettings'
import { buildBellQueue, badgeText } from '../lib/bellQueue'
import { markReviewed, markNotDone } from '../lib/attentionActions'
import { SHIFT_MARK_CHANGED } from '../lib/shiftMarks'
import { OPEN_BELL } from './DayPanelView'
import EmployeePayEdit from './EmployeePayEdit'

const tokyoMinutes = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })); return d.getHours() * 60 + d.getMinutes() }

const SEEN_KEY = 'kp_timeoff_seen_v1'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-500))) } catch { /* private mode */ } }

// "qui., 05/11 09:17" (Tokyo) — absolute date AND time of the event
const tokyoParts = iso => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` } }
// "3h03" / "45 min"
const durText = min => { const m = Math.max(0, Math.round(Number(min) || 0)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` }

// Admin topbar bell "Aguardando você": ONE ordered queue (lib/bellQueue) — the badge is its real size.
// PC: opens anchored under the bell (the screen stays visible behind); phone: full screen.
// Since v1.0.79 it also holds the Smart Facility "services to offer" (was a separate 🧽 button).
export default function TimeOffCenter() {
  const { lang, t: tAll } = useLang()
  const ft = tAll.facility
  const L = (en, jaText, pt) => pickLang(lang, en, jaText, pt)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('all')
  const [newQuotes, setNewQuotes] = useState([])
  const [toastOpen, setToastOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [notes, setNotes] = useState({})
  const [dayCtx, setDayCtx] = useState({})
  const [payroll, setPayroll] = useState([])
  const [quotes, setQuotes] = useState([])
  // v1.0.70 · accepted quotes with no date yet + quote jobs just finished (invoice sent)
  const [toBook, setToBook] = useState([])
  const [flowDone, setFlowDone] = useState([])
  const [newFlow, setNewFlow] = useState([])
  const [offers, setOffers] = useState([])
  const [newOffers, setNewOffers] = useState([])
  // v1.0.101 · who accepted an urgent offer
  const [taken, setTaken] = useState([])
  // v1.0.151 · today's panel (same source as the Painel do Dia): "não pode hoje", stores with no job
  const [panel, setPanel] = useState(null)
  // v1.0.154 · tomorrow's panel: after 21:00 of the evening before its gaps are in the bell that night
  const [nextPanel, setNextPanel] = useState(null)
  // v1.0.110 · one queue of exceptions, each row with the action that resolves it
  const [exceptions, setExceptions] = useState([])
  // v1.0.147 · 05:00: On The Planet route of the day with no start (one per person per day)
  const [routeAlerts, setRouteAlerts] = useState([])
  // v1.0.151 · items resolved here leave at once (the badge goes down), before the reload confirms
  const [hidden, setHidden] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())
  const [scrolled, setScrolled] = useState({ top: false, more: false })
  const [anchor, setAnchor] = useState(null)
  const bellRef = useRef(null)
  const listRef = useRef(null)
  const seen = useRef(readSeen())

  // v1.0.102 · a list that fails to load keeps its last value, and only the newest load is applied.
  const loadSeq = useRef(0)
  const last = useRef({ list: [], periods: [], quoteRows: [], flow: { toBook: [], done: [] }, offerRows: [], assign: { accepted: [], noPerson: [] }, panel: null, exc: [], otp: [] })
  const keep = (p, k) => p.then(v => { last.current[k] = v; return v }, () => last.current[k])
  const load = () => {
    const seq = ++loadSeq.current
    const today = tokyoToday(), nowMin = tokyoMinutes()
    return Promise.all([
      keep(fetchPendingTimeOff(today), 'list'),
      keep(fetchAutoClosedPeriods(), 'periods'),
      keep(fetchPendingQuoteRequests(), 'quoteRows'),
      keep(fetchQuoteFlowAlerts(), 'flow'),
      keep(fetchFacilityOffers(), 'offerRows'),
      keep(fetchAssignAlerts(), 'assign'),
      keep(fetchDayPanels(today, addDays(today, 1), { nowMin, today }), 'panel'),
      keep(fetchExceptions({ hideTests: hideTests() }), 'exc'),
      keep(fetchOtpRouteAlerts(today, nowMin), 'otp'),
    ]).then(([list, periods, quoteRows, flow, offerRows, assign, panels, exc, otp]) => {
      if (seq !== loadSeq.current) return
      // not started yet: stays until the route starts; started after 05:00: stays (with the real time) until OK
      const otpRows = (otp || []).map(a => ({ ...a, id: a.startedAt ? `${a.id}:started` : a.id })).filter(a => !(a.startedAt && seen.current.has(`${a.id}:ok`)))
      setRouteAlerts(otpRows)
      setExceptions(exc || [])
      setOffers(offerRows)
      const takenUnseen = assign.accepted.filter(a => !seen.current.has(a.id))
      setTaken(takenUnseen)
      // newest first: [tomorrow, today]
      setPanel(panels?.find(x => x.date === today) || null)
      setNextPanel(panels?.find(x => x.date !== today) || null)
      setRows(list)
      setPayroll(periods)
      setQuotes(quoteRows)
      setToBook(flow.toBook)
      // a finished job stays in the bell until it has been seen once
      const doneUnseen = flow.done.filter(d => !seen.current.has(d.id))
      setFlowDone(doneUnseen)
      setHidden(new Set())
      // Alert only once per item, ever: after that the number stays until it is resolved
      const fresh = [...list, ...periods, ...quoteRows, ...flow.toBook, ...doneUnseen, ...offerRows, ...takenUnseen, ...otpRows].filter(r => !seen.current.has(r.id))
      if (fresh.length) {
        setNewQuotes(quoteRows.filter(q => fresh.includes(q)))
        setNewFlow([...flow.toBook.filter(t => !t.snoozed), ...doneUnseen].filter(q => fresh.includes(q)))
        setNewOffers(offerRows.filter(q => fresh.includes(q)))
        fresh.forEach(r => seen.current.add(r.id))
        writeSeen(seen.current)
        setToastOpen(true)
      }
    })
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    const openFromOutside = () => openRef.current?.()
    const evs = [TIME_OFF_CHANGED, PAYROLL_CHANGED, QUOTE_REQUESTS_CHANGED, QUOTE_FLOW_CHANGED, PENDING_CHANGED, HIDE_TESTS_CHANGED, SHIFT_MARK_CHANGED, ROUTE_SETTINGS_CHANGED]
    evs.forEach(e => window.addEventListener(e, load))
    window.addEventListener(OPEN_BELL, openFromOutside)
    return () => { clearInterval(id); evs.forEach(e => window.removeEventListener(e, load)); window.removeEventListener(OPEN_BELL, openFromOutside) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The pop-up alert goes away on its own; the bell number stays.
  useEffect(() => {
    if (!toastOpen) return
    const id = setTimeout(() => setToastOpen(false), 12000)
    return () => clearTimeout(id)
  }, [toastOpen])

  const queue = buildBellQueue({ exceptions, panel, nextPanel, routeAlerts, timeOff: rows, quotes, toBook, flowDone, payroll, offers, taken, today: tokyoToday(), hidden })
  const n = queue.count

  // PC: anchored under the bell, right edge aligned with it; phone: full screen
  const place = () => {
    const r = bellRef.current?.getBoundingClientRect()
    const phone = window.innerWidth < 720
    setAnchor(phone || !r ? { phone: true } : { top: Math.round(r.bottom + 10), right: Math.max(12, Math.round(window.innerWidth - r.right)) })
  }
  useLayoutEffect(() => {
    if (!open) return
    place()
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('resize', place)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('keydown', onKey) }
  }, [open])
  const onListScroll = () => {
    const el = listRef.current
    if (!el) return
    setScrolled({ top: el.scrollTop > 4, more: el.scrollTop + el.clientHeight < el.scrollHeight - 4 })
  }
  useEffect(() => { if (open) requestAnimationFrame(onListScroll) }, [open, n, kind, expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const markSeen = () => {
    rows.concat(payroll, quotes, toBook, flowDone, offers, routeAlerts).forEach(r => seen.current.add(r.id))
    writeSeen(seen.current)
    setToastOpen(false)
  }
  const openPopup = () => {
    // always opens on "All": a chip chosen before could hide every row once its items were gone
    markSeen(); setKind('all'); setExpanded(new Set()); setOpen(true)
    fetchDayContext(last.current.list.map(r => r.date)).then(setDayCtx).catch(() => {})
  }
  const openRef = useRef(null)
  openRef.current = openPopup
  const hide = ids => { setHidden(prev => { const s = new Set(prev); ids.forEach(i => s.add(i)); return s }); pendingChanged(); setTimeout(load, 400) }

  const decide = async (row, status) => {
    setBusy(row.id + status)
    try {
      await decideTimeOff(row.id, status, notes[row.id])
      toast.success(status === 'approved' ? L('Day off approved', '休みを承認しました', 'Folga aprovada') : L('Request declined', '申請を却下しました', 'Pedido recusado'))
      setRows(r => r.filter(x => x.id !== row.id))
      setNoteFor(null)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }

  const go = path => { setOpen(false); markSeen(); navigate(path) }
  const openCalendar = () => go('/employees?tab=availability')
  const openTrack = (item) => go(`/mitsumori?track=${item.ref || `${item.kind === 'mitsumori' ? 'mit' : 'req'}:${item.ref_id}`}`)
  const okTaken = (t) => { seen.current.add(t.id); writeSeen(seen.current); setTaken(list => list.filter(x => x.id !== t.id)) }
  const okRoute = (a) => { seen.current.add(`${a.id}:ok`); writeSeen(seen.current); setRouteAlerts(list => list.filter(x => x.id !== a.id)) }
  const offer = async (r) => {
    setBusy(r.id)
    try {
      await offerToClient(r, ft)
      toast.success(ft.offered)
      setOffers(list => list.filter(x => x.id !== r.id))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }
  const EXC = exceptionInfo(L)
  const dShort = d => (d && d.length === 10 ? fmtDay(d, lang, { weekday: 'short', day: '2-digit', month: '2-digit' }) : '')
  const at = iso => { if (!iso) return ''; const p = tokyoParts(iso); return `${dShort(p.date)} ${p.hm}` }
  const ago = iso => { if (!iso) return ''; const m = (Date.now() - new Date(iso).getTime()) / 60000; return m > 0 ? ` (${L(`${durText(m)} ago`, `${durText(m)}前`, `há ${durText(m)}`)})` : '' }
  // v1.0.148 · "Coberto por outro": only the owner takes the job off A's agenda (or keeps it)
  const decideCover = async (x, remove) => { if (await decideCoverFlow(x, remove, { L, dShort })) hide([x.id]); else load() }
  const reviewed = async x => { try { await markReviewed([x.jobId]); hide([x.id]); toast.success(L('Marked as reviewed', '確認済みにしました', 'Marcado como conferido')) } catch (e) { toast.error(e.message) } }
  // v1.0.151 · cancelling is one item at a time, with the owner's confirmation (never "cancel all" in the bell)
  const notDone = async x => {
    const reason = await askConfirm({
      title: L('Mark as not done?', '未実施にしますか？', 'Marcar como não feito?'),
      message: L(`${dShort(x.date)} · ${x.place} · ${serviceLabel(x, L)} (${x.who || '—'}) will be cancelled: not paid, not billed.`, `${dShort(x.date)} · ${x.place}（${x.who || '—'}）を取消します。給与・請求に含まれません。`, `${dShort(x.date)} · ${x.place} · ${serviceLabel(x, L)} (${x.who || '—'}) será cancelado: não entra no pagamento nem na cobrança.`),
      reason: L('Reason (e.g. duplicate, not done)', '理由（例：重複、未実施）', 'Motivo (ex.: duplicado, não foi feito)'),
      confirmLabel: L('Not done', '未実施にする', 'Não feito'), danger: true,
    })
    if (!reason) return
    try { await markNotDone(x.jobId, typeof reason === 'string' ? reason : null); hide([x.id]); toast.success(L('Cancelled', '取消しました', 'Cancelado')) } catch (e) { toast.error(e.message === 'changed' ? L('Already changed', 'すでに変更済み', 'Já mudou') : e.message); load() }
  }

  const GROUP_TITLE = {
    late: L("Late today", '本日の遅れ', 'Atrasados de hoje'),
    uncovered: L('No cover', '担当不在', 'Sem cobertura'),
    covered: L('Covered by someone else — your decision', '他の人が対応 — 判断待ち', 'Cobertos — aguardando sua decisão'),
    exceptions: L('Other exceptions (by date)', 'その他の例外（日付順）', 'Demais exceções (por data)'),
    dayoff: L('Day-off requests', '休み申請', 'Pedidos de folga'),
    quotes: L('Quotes', '見積もり', 'Orçamentos'),
    payroll: L('Payroll', '給与', 'Folha'),
    offers: ft.offersTitle,
    info: L('Notices', 'お知らせ', 'Avisos'),
    waiting: L('Waiting on someone else (not counted)', '他の人の対応待ち（件数外）', 'Aguardando outra pessoa (não conta)'),
    later: L('Book later (not counted until the reminder)', 'あとで日程（リマインダーまで件数外）', 'Agendar depois (não conta até o lembrete)'),
  }
  const KIND_LABEL = {
    late: L('Late', '遅れ', 'Atrasado'), route: L('Route not started', 'ルート未開始', 'Rota não começou'),
    route_none: L("Today's route has not started", '本日のルート未開始', 'Rota de hoje ainda não começou'),
    free_uncovered: L('NO COVER · free service nobody took', '担当不在 · 未取得の空き作業', 'SEM COBERTURA · livre que ninguém pegou'),
    eve_unconfirmed: L('NO CONFIRMATION for tomorrow', '明日 未確認', 'SEM CONFIRMAÇÃO para amanhã'),
    impossible: L('Impossible route', '不可能なルート', 'Rota impossível'),
    cant: L("Can't today", '本日不可', 'Não pode hoje'), no_person: L('Nobody assigned', '担当なし', 'Sem pessoa'), no_job: L('No job created', '作業未作成', 'Sem serviço criado'),
    covered: L('Covered by another person', '他の人が実施', 'Coberto por outra pessoa'), incomplete: L('Never started', '未開始のまま', 'Nunca iniciado'),
    problem: L('Problem reported', '問題の報告', 'Problema reportado'), long: L('Took much longer', '予定より長い', 'Demorou muito mais'),
    no_photo: L('Done without final photo', '完了写真なし', 'Concluído sem foto final'), ai_waiting: L('Photo waiting for the AI', 'AI確認待ち', 'Foto aguardando a IA'),
    disputed: L('Payslip disputed', '明細に異議', 'Holerite contestado'), retro_review: L('Retroactive registration — review', '事後登録 — 確認', 'Registro retroativo — revisar'),
    paid_unconfirmed: L('Paid without confirmation', '確認なしで支払済', 'Pago sem confirmação'),
    pay_undefined: L('Worker pay to be defined', '作業者の支払い 未定', 'Pagamento a definir'),
  }
  const TONE = { route_none: 'red', free_uncovered: 'red', eve_unconfirmed: 'amber', impossible: 'amber', late: 'red', route: 'red', cant: 'red', no_person: 'amber', no_job: 'amber', covered: 'blue', incomplete: 'red' }
  const Btn = ({ main, onClick, children, disabled }) => <button type="button" className={`tor-btn tor-btn-sm ${main ? 'tor-btn-primary' : 'tor-btn-ghost'}`} disabled={disabled} onClick={onClick}>{children}</button>

  // what happened and when — absolute date and time of the event (+ the relative, never instead of it)
  const cutoffTxt = nextPanel?.cutoff || panel?.cutoff || '21:00'
  const whenOf = x => {
    switch (x.kind) {
      case 'late': return x.deadline
        ? L(`Deadline ${x.deadline} on ${dShort(x.date)} · ${durText(x.minutes)} past it`, `${dShort(x.date)} ${x.deadline}期限 · ${durText(x.minutes)}超過`, `Prazo ${x.deadline} de ${dShort(x.date)} · passou há ${durText(x.minutes)}`)
        : L(`Planned start ${x.time || '—'} on ${dShort(x.date)} · ${durText(x.minutes)} late`, `${dShort(x.date)} ${x.time || '—'}開始予定 · ${durText(x.minutes)}遅れ`, `Início previsto ${x.time || '—'} de ${dShort(x.date)} · ${durText(x.minutes)} de atraso`)
      case 'route': return x.startedAt
        ? L(`${dShort(x.date)} · alert at 05:00 · started at ${x.startedAt}`, `${dShort(x.date)} · 05:00の警告 · ${x.startedAt}開始`, `${dShort(x.date)} · alerta das 05:00 · começou às ${x.startedAt}`)
        : L(`${dShort(x.date)} · alert at 05:00 · ${plural(x.jobs, 'service', 'services')} · deadline 10:00`, `${dShort(x.date)} · 05:00の警告 · ${x.jobs}件 · 期限10:00`, `${dShort(x.date)} · alerta das 05:00 · ${plural(x.jobs, 'serviço', 'serviços')} · prazo 10:00`)
      case 'route_none': return L(`${dShort(x.date)} · alert at 05:00 · ${plural(x.n, 'service', 'services')} · nothing started`, `${dShort(x.date)} · 05:00の警告 · ${x.n}件 · 未着手`, `${dShort(x.date)} · alerta das 05:00 · ${plural(x.n, 'serviço', 'serviços')} · nada iniciado`)
      case 'free_uncovered': return [L(`${dShort(x.date)} · nobody took it by ${cutoffTxt} of the evening before`, `${dShort(x.date)} · 前日${cutoffTxt}までに誰も取らず`, `${dShort(x.date)} · ninguém pegou até ${cutoffTxt} da véspera`), x.deadline ? L(`deadline ${x.deadline}`, `期限 ${x.deadline}`, `prazo ${x.deadline}`) : '', x.planB?.length ? L(`plan B: ${x.planB.join(', ')}`, `プランB: ${x.planB.join('、')}`, `plano B: ${x.planB.join(', ')}`) : ''].filter(Boolean).join(' · ')
      case 'eve_unconfirmed': return L(`${dShort(x.date)} · expected by the weekly pattern · no mark by ${cutoffTxt}`, `${dShort(x.date)} · 週の予定で出勤予定 · ${cutoffTxt}までに記録なし`, `${dShort(x.date)} · esperado pelo padrão semanal · nada marcado até ${cutoffTxt}`) + (x.total ? L(` · ${x.total} services`, ` · ${x.total}件`, ` · ${plural(x.total, 'serviço', 'serviços')}`) : '')
      case 'impossible': return `${dShort(x.date)} · ${impossibleText({ name: x.who, minutes: x.minutes, deadline: x.deadline, bucket: x.bucket }, L)} · ${L(`${x.n} services`, `${x.n}件`, plural(x.n, 'serviço', 'serviços'))}`
      case 'cant': return [x.at ? L(`Marked “can't” on ${at(x.at)}${x.byRole === 'admin' ? ' (by the admin)' : ''}`, `${at(x.at)}に「不可」${x.byRole === 'admin' ? '（管理者）' : ''}`, `Marcou “Não posso” em ${at(x.at)}${x.byRole === 'admin' ? ' (pelo admin)' : ''}`) : dShort(x.date), x.reason ? `“${x.reason}”` : ''].filter(Boolean).join(' · ')
      case 'no_person': return L(`${dShort(x.date)}${x.time ? ` · planned ${x.time}` : ''}`, `${dShort(x.date)}${x.time ? ` · ${x.time}予定` : ''}`, `${dShort(x.date)}${x.time ? ` · previsto ${x.time}` : ''}`)
      case 'no_job': return L(`Contract of ${dShort(x.date)} · no job was created`, `${dShort(x.date)}の契約 · 作業未作成`, `Contrato de ${dShort(x.date)} · nenhum serviço criado`) + (x.who ? L(` · usually ${x.who}`, ` · 通常 ${x.who}`, ` · costuma ser ${x.who}`) : '')
      case 'covered': return L(`Done by ${x.by}${x.byJob?.completed_at ? ` on ${at(x.byJob.completed_at)}` : ''}`, `${x.by}が実施${x.byJob?.completed_at ? `（${at(x.byJob.completed_at)}）` : ''}`, `Feito por ${x.by}${x.byJob?.completed_at ? ` em ${at(x.byJob.completed_at)}` : ''}`)
      case 'incomplete': return L(`Planned for ${dShort(x.date)}${x.time ? ` ${x.time}` : ''} · never started`, `${dShort(x.date)}${x.time ? ` ${x.time}` : ''}予定 · 未開始`, `Era para ${dShort(x.date)}${x.time ? ` às ${x.time}` : ''} · nunca iniciado`)
      case 'retro_review': return L(`Service of ${dShort(x.date)} · registered on ${at(x.at)}`, `${dShort(x.date)}の作業 · ${at(x.at)}に登録`, `Serviço de ${dShort(x.date)} · registrado em ${at(x.at)}`) + ago(x.at)
      case 'problem': return L(`Sent on ${at(x.at)}`, `${at(x.at)}に送信`, `Enviado em ${at(x.at)}`) + ago(x.at)
      case 'long': return L(`Took ${durText(x.minutes)} (planned ${durText(x.expected)}) · finished ${at(x.at)}`, `${durText(x.minutes)}（予定${durText(x.expected)}）· ${at(x.at)}完了`, `Levou ${durText(x.minutes)} (previsto ${durText(x.expected)}) · concluído em ${at(x.at)}`)
      case 'pay_undefined': return L(`Service of ${dShort(x.date)}${x.at ? ` · finished ${at(x.at)}` : ''} · worker gets: to be defined`, `${dShort(x.date)}の作業${x.at ? ` · ${at(x.at)}完了` : ''} · 作業者受取: 未定`, `Serviço de ${dShort(x.date)}${x.at ? ` · concluído em ${at(x.at)}` : ''} · funcionário recebe: a definir`)
      case 'no_photo': case 'ai_waiting': return x.at ? L(`Finished on ${at(x.at)}`, `${at(x.at)}完了`, `Concluído em ${at(x.at)}`) : dShort(x.date)
      case 'disputed': case 'paid_unconfirmed': return L(`Payroll ${x.period}`, `${x.period}の給与`, `Folha ${x.period}`)
      default: return dShort(x.date)
    }
  }
  const actionsOf = x => {
    switch (x.kind) {
      case 'route': return <><Btn main onClick={() => go('/live')}>{L('Open Live Track', 'ライブ追跡を開く', 'Abrir Live Track')}</Btn>{x.startedAt && <Btn onClick={() => okRoute(x)}>✓ OK</Btn>}</>
      case 'route_none': return <><Btn main onClick={() => go('/live')}>{L('Open Live Track', 'ライブ追跡を開く', 'Abrir Live Track')}</Btn><Btn onClick={() => go('/')}>{L('Day panel', '本日のパネル', 'Painel do Dia')}</Btn></>
      case 'free_uncovered': case 'impossible': return <Btn main onClick={() => go('/schedule')}>{x.kind === 'impossible' ? L('Split the route', 'ルートを分ける', 'Dividir a rota') : L('Assign', '割当', 'Atribuir')}</Btn>
      case 'eve_unconfirmed': return <><Btn main onClick={() => go('/')}>{L('Mark for them', '代理で記録', 'Marcar por ele')}</Btn><Btn onClick={openCalendar}>{L('Availability', '勤務可能日', 'Disponibilidade')}</Btn></>
      case 'cant': return <><Btn main onClick={() => go('/live')}>{L('See the stores', '店舗を見る', 'Ver as lojas')}</Btn><Btn onClick={openCalendar}>{L('Availability', '勤務可能日', 'Disponibilidade')}</Btn></>
      case 'no_person': case 'no_job': return <Btn main onClick={() => go('/schedule')}>{x.kind === 'no_job' ? L('Create / assign', '作成・割当', 'Criar / atribuir') : L('Assign', '割当', 'Atribuir')}</Btn>
      case 'covered': return <><Btn main onClick={() => decideCover(x, true)}>{L(`Remove from ${x.who}`, `${x.who}から外す`, `Retirar de ${x.who}`)}</Btn><Btn onClick={() => decideCover(x, false)}>{L(`Keep on ${x.who}`, `${x.who}に残す`, `Manter em ${x.who}`)}</Btn></>
      case 'incomplete': return <><Btn main onClick={() => go(EXC.incomplete.to(x))}>{L('Close or reschedule', '終了・再予定', 'Fechar ou reagendar')}</Btn><Btn onClick={() => notDone(x)}>{L('Not done', '未実施', 'Não feito')}</Btn></>
      case 'retro_review': return <><Btn main onClick={() => reviewed(x)}>✓ {L('Reviewed', '確認済み', 'Conferido')}</Btn><Btn onClick={() => go('/live')}>{L('Open Live Track', 'ライブ追跡を開く', 'Abrir Live Track')}</Btn></>
      case 'no_photo': return <><Btn main onClick={() => reviewed(x)}>{L('Accept without photo', '写真なしで承認', 'Aceitar sem foto')}</Btn><Btn onClick={() => go(EXC.no_photo.to(x))}>{L('Open job', '作業を開く', 'Abrir job')}</Btn></>
      // v1.0.157 · define the worker's pay right here (it leaves the bell once saved)
      case 'pay_undefined': return <><EmployeePayEdit job={{ id: x.jobId, status: 'pending_pay', employee_pay: null }} style={{ fontSize: 12 }} onSaved={saved => { if (saved?.employee_pay != null) hide([x.id]) }} /><Btn onClick={() => go(EXC.pay_undefined.to(x))}>{L('Open job', '作業を開く', 'Abrir job')}</Btn></>
      case 'long': return <><Btn main onClick={() => reviewed(x)}>✓ {L('Checked', '確認済み', 'Conferido')}</Btn><Btn onClick={() => go(EXC.long.to(x))}>{L('Open job', '作業を開く', 'Abrir job')}</Btn></>
      default: return EXC[x.kind] ? <Btn main={!x.waiting} onClick={() => go(EXC[x.kind].to(x))}>{EXC[x.kind].action}</Btn> : null
    }
  }
  const icon = x => ({ route: '🌙', route_none: '🌙', cant: '✕', no_job: '📋', free_uncovered: '⚠️', eve_unconfirmed: '❔', impossible: '⏱' }[x.kind] || EXC[x.kind]?.icon || '•')
  const renderException = x => {
    const job = x.title ? serviceLabel({ title: x.title, job_category: x.job_category }, L) : ''
    const title = ['cant', 'eve_unconfirmed', 'impossible'].includes(x.kind) ? x.who : x.kind === 'route_none' ? L("Today's route", '本日のルート', 'Rota de hoje') : x.kind === 'route' ? L('On The Planet route', 'On The Planet ルート', 'Rota On The Planet') : (x.place || x.who || EXC[x.kind]?.title(x) || '—')
    const who = ['cant', 'eve_unconfirmed', 'impossible'].includes(x.kind) ? '' : x.kind === 'free_uncovered' ? L('nobody — free', '担当なし（空き）', 'ninguém — livre') : x.who
    return (
      <article key={x.id} className={`bq-card tone-${TONE[x.kind] || 'plain'}${x.waiting ? ' is-waiting' : ''}`}>
        <div className="bq-kind">{icon(x)} {KIND_LABEL[x.kind] || ''}{x.overdue ? <span className="bq-over"> · {L('overdue', '期限切れ', 'vencido')}</span> : null}</div>
        <strong className="bq-title">{title}</strong>
        {job && <div className="bq-sub">{job}</div>}
        {x.kind === 'cant' && <div className="bq-sub">{L(`${plural(x.n, 'store', 'stores')} without cover: `, `担当不在: `, `${plural(x.n, 'loja sem cobertura', 'lojas sem cobertura')}: `)}{x.stores.join(' · ')}</div>}
        {x.kind === 'problem' && x.text && <div className="bq-sub">“{x.text}”</div>}
        {who && <div className="bq-who"><span aria-hidden="true">👤</span> <span className="bq-name">{who}</span></div>}
        <div className="bq-when">{whenOf(x)}</div>
        {x.due && <div className={`bq-when${x.overdue ? ' is-bad' : ''}`}>{exceptionDeadline(x, L)}</div>}
        <div className="bq-actions">{actionsOf(x)}{x.jobId && <QuickReportButton jobId={x.jobId} className="tor-btn tor-btn-sm tor-btn-ghost" />}</div>
      </article>
    )
  }
  const renderOther = x => {
    switch (x.kind) {
      case 'dayoff': { const r = x._row; return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">🗓 {r.kind === 'off' ? L('Day off / can\'t', '休み・不可', 'Folga / não posso') : L('Extra work', '追加勤務', 'Trabalho extra')}</div>
          <strong className="bq-title">{r.employee_name || '—'}</strong>
          <div className="bq-sub">{fmtDay(r.date, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {r.created_at && <div className="bq-when">{L(`Asked on ${at(r.created_at)}`, `${at(r.created_at)}に申請`, `Pedido em ${at(r.created_at)}`)}</div>}
          {r.note && <p className="tor-note">“{r.note}”</p>}
          <DayContext ctx={dayCtx[r.date]} req={r} L={L} />
          {noteFor === r.id && <input className="tor-input" autoFocus value={notes[r.id] || ''} onChange={e => setNotes(v => ({ ...v, [r.id]: e.target.value }))} placeholder={L('Message to the employee (optional)', 'スタッフへのメッセージ（任意）', 'Mensagem para o funcionário (opcional)')} />}
          <div className="bq-actions">
            <button type="button" className="tor-btn tor-btn-sm tor-btn-reject" disabled={!!busy} onClick={() => decide(r, 'rejected')}>{busy === r.id + 'rejected' ? '…' : <>✕ {L('Decline', '却下', 'Recusar')}</>}</button>
            <button type="button" className="tor-btn tor-btn-sm tor-btn-approve" disabled={!!busy} onClick={() => decide(r, 'approved')}>{busy === r.id + 'approved' ? '…' : <>✓ {L('Approve', '承認', 'Aprovar')}</>}</button>
          </div>
          {noteFor !== r.id && <button type="button" className="tor-link" onClick={() => setNoteFor(r.id)}>{L('+ Add message', '+ メッセージ', '+ Adicionar mensagem')}</button>}
        </article>) }
      case 'quote': return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">📝 {L('Quote request · set the price', '見積もり依頼 · 価格設定', 'Pedido de orçamento · definir preço')}</div>
          <strong className="bq-title">{x.client_name || '—'}</strong>
          <div className="bq-sub">{[x.location_name, x.category || String(x.description || '').slice(0, 60)].filter(Boolean).join(' · ')}</div>
          {x.created_at && <div className="bq-when">{L(`Received ${at(x.created_at)}`, `${at(x.created_at)}受付`, `Recebido em ${at(x.created_at)}`)}</div>}
          <div className="bq-actions"><Btn main onClick={() => go('/mitsumori?tab=requests')}>{L('Open quote requests', '見積もり依頼を開く', 'Abrir pedidos de orçamento')}</Btn></div>
        </article>)
      case 'to_book': return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">{x.snoozed ? '🕒' : '📅'} {x.snoozed
            ? L(`Quote accepted · book later (reminder ${dShort(x.later.until)})`, `見積承認 · あとで日程（${dShort(x.later.until)}にリマインド）`, `Orçamento aceito · agendar depois (lembrete ${dShort(x.later.until)})`)
            : x.later ? L('Reminder · book the date of the accepted quote', 'リマインド · 承認済み見積の日程', 'Lembrete · marcar a data do orçamento aceito')
            : L('Quote accepted · book the date', '見積承認 · 日程', 'Orçamento aceito · marcar data')}</div>
          <strong className="bq-title">{x.name || '—'}</strong>
          <div className="bq-sub">{[x.what, x.total ? `¥${Math.round(Number(x.total)).toLocaleString()}` : '', x.later?.note].filter(Boolean).join(' · ')}</div>
          <div className="bq-actions"><Btn main={!x.snoozed} onClick={() => openTrack(x)}>{x.snoozed ? L('Book now', '今すぐ予約', 'Agendar agora') : L('See suggested date and book', 'おすすめ日を見て予約', 'Ver data sugerida e marcar')}</Btn></div>
        </article>)
      case 'flow_done': return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">🧾 {L('Job done · invoice sent', '作業完了・請求書を送付', 'Serviço feito · nota enviada')}</div>
          <strong className="bq-title">{x.name || '—'}</strong>
          {x.total ? <div className="bq-sub">¥{Math.round(Number(x.total)).toLocaleString()}</div> : null}
          <div className="bq-actions"><Btn main onClick={() => openTrack(x)}>{L('See the follow-up', '進捗を見る', 'Ver acompanhamento')}</Btn></div>
        </article>)
      case 'payroll': return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">💴 {L('Closed automatically · review', '自動締め · 要確認', 'Fechada automaticamente · revisar')}</div>
          <strong className="bq-title">{L(`Payroll ${fmtPeriod(x.period)}`, `${fmtPeriod(x.period)} 給与`, `Folha ${fmtPeriod(x.period)}`)}</strong>
          <div className="bq-when">{L(`Staff confirm by ${x.confirm_deadline} · pay on ${x.pay_date}`, `確認期限 ${x.confirm_deadline} · 支払 ${x.pay_date}`, `Equipe confirma até ${x.confirm_deadline} · pagamento em ${x.pay_date}`)}</div>
          <div className="bq-actions"><Btn main onClick={() => go(`/salary-periods?period=${x.period}`)}>{L('Open payslips', '明細を開く', 'Abrir holerites')}</Btn></div>
        </article>)
      case 'offer': { const k = ELEMENT_KINDS[x.element_kind] || ELEMENT_KINDS.other; return (
        <article key={x.id} className={`bq-card fob-item st-${x.status}`}>
          <div className="bq-kind">{k.icon} {x.task_type === 'maintenance' ? '🔧' : '🧽'} {x.status === 'overdue' ? ft.late : ft.soon}</div>
          <strong className="bq-title">{fill(ft.offerTo, { task: x.task_name, client: x.client_name || x.location })}</strong>
          <div className="bq-sub">{x.location} · {x.element_name}</div>
          <div className="bq-when">🕒 {offerWhen(x, ft)}</div>
          <div className="bq-actions">
            <Btn onClick={() => go(`/facility?model=${x.model_id}`)}>🏢 {ft.openStore}</Btn>
            <Btn main disabled={!!busy} onClick={() => offer(x)}>{busy === x.id ? '…' : `📨 ${ft.offerClient}`}</Btn>
          </div>
        </article>) }
      case 'taken': return (
        <article key={x.id} className="bq-card">
          <div className="bq-kind">⚡ {L('Offer accepted', 'オファー承諾', 'Oferta aceita')}</div>
          <strong className="bq-title">{(x.title || '').split(' — ')[0]}</strong>
          <div className="bq-sub">{serviceLabel(x, L)}</div>
          <div className="bq-who"><span aria-hidden="true">👤</span> <span className="bq-name">{x.employee_name || '—'}</span></div>
          <div className="bq-when">{dShort(x.scheduled_date)} {String(x.scheduled_time || '').slice(0, 5)}</div>
          <div className="bq-actions"><Btn main onClick={() => okTaken(x)}>✓ OK</Btn></div>
        </article>)
      default: return renderException(x)
    }
  }

  const PREVIEW = 3
  const groups = queue.groups.filter(g => kind === 'all' || g.key === kind)
  const activeKind = kind === 'all' || queue.groups.some(g => g.key === kind) ? kind : 'all'
  const allOpen = queue.groups.every(g => g.items.length <= PREVIEW || expanded.has(g.key))
  const toggleGroup = key => setExpanded(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  const expandAll = () => setExpanded(allOpen ? new Set() : new Set(queue.groups.map(g => g.key)))
  const totalLabel = n === 1 ? L('1 item', '1件', '1 item') : L(`${n} items`, `${n}件`, `${n} itens`)

  return (
    <>
      <button ref={bellRef} type="button" className={`ref-top-action tor-bell${n ? ' has-items' : ''}`} onClick={() => (open ? setOpen(false) : openPopup())}
        title={n ? L(`${totalLabel} waiting for you`, `確認待ち ${n}件`, `${totalLabel} aguardando você`) : L('Nothing waiting for you', '確認待ちはありません', 'Nada aguardando você')}
        aria-label={n ? L(`Waiting for you: ${n}`, `確認待ち ${n}件`, `Aguardando você: ${n}`) : L('Waiting for you', '確認待ち', 'Aguardando você')} aria-expanded={open}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {n > 0 && <span className={`tor-count${n > 99 ? ' is-wide' : ''}`}>{badgeText(n)}</span>}
      </button>

      {/* Portal: the topbar uses backdrop-filter, which would trap position:fixed inside it */}
      {createPortal(<>
      {toastOpen && newQuotes.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">📝</span>
          <div className="tor-toast-text">
            <strong>{newQuotes.length === 1 ? L('New quote request', '新しい見積もり依頼', 'Novo pedido de orçamento') : L(`${newQuotes.length} new quote requests`, `新しい見積もり依頼 ${newQuotes.length}件`, `${newQuotes.length} novos pedidos de orçamento`)}</strong>
            <span>{[newQuotes[0].client_name, newQuotes[0].location_name, newQuotes[0].category].filter(Boolean).join(' · ') || L('Set the company price', '会社の価格を設定してください', 'Defina o preço da empresa')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => go('/mitsumori?tab=requests')}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">{newFlow[0].id.startsWith('qf-done') ? '🧾' : '📅'}</span>
          <div className="tor-toast-text">
            <strong>{newFlow[0].id.startsWith('qf-done') ? L('Job done · invoice sent', '作業完了・請求書を送付', 'Serviço feito · nota enviada') : L('Quote accepted · book the date', '見積承認・日程を決めてください', 'Orçamento aceito · marque a data')}</strong>
            <span>{[newFlow[0].name, newFlow[0].total ? `¥${Math.round(Number(newFlow[0].total)).toLocaleString()}` : ''].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => openTrack(newFlow[0])}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">💴</span>
          <div className="tor-toast-text">
            <strong>{L(`Payroll ${fmtPeriod(payroll[0].period)} closed automatically`, `${fmtPeriod(payroll[0].period)} の給与を自動で締めました`, `Folha de ${fmtPeriod(payroll[0].period)} fechada automaticamente`)}</strong>
            <span>{L('Check the payslips before staff confirm', '従業員の確認前に明細をチェックしてください', 'Confira os holerites antes da equipe confirmar')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => go(`/salary-periods?period=${payroll[0].period}`)}>{L('Review', '確認', 'Revisar')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length === 0 && rows.length === 0 && newOffers.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🧽</span>
          <div className="tor-toast-text">
            <strong>{fill(ft.offersCount, { n: newOffers.length })}</strong>
            <span>{fill(ft.offerTo, { task: newOffers[0].task_name, client: newOffers[0].client_name || newOffers[0].location })}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length === 0 && rows.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🗓</span>
          <div className="tor-toast-text">
            <strong>{L(`${rows.length} day-off request${rows.length > 1 ? 's' : ''}`, `休み申請 ${rows.length}件`, `${rows.length} pedido${rows.length > 1 ? 's' : ''} de folga`)}</strong>
            <span>{rows.length === 1 ? `${rows[0].employee_name || '—'} · ${fmtDay(rows[0].date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}` : L('Waiting for your decision', '承認待ちです', 'Aguardando sua decisão')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{L('Review', '確認', 'Revisar')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}

      {open && anchor && (
        <div className={`bq-layer${anchor.phone ? ' is-phone' : ''}`} onClick={() => setOpen(false)}>
          <section className={`bq-pop${anchor.phone ? ' is-phone' : ''}`} role="dialog" aria-label={L('Waiting for you', '確認待ち', 'Aguardando você')}
            style={anchor.phone ? undefined : { top: anchor.top, right: anchor.right, maxHeight: `calc(100vh - ${anchor.top + 16}px)` }}
            onClick={e => e.stopPropagation()}>
            {!anchor.phone && <span className="bq-arrow" aria-hidden="true" />}
            <header className="bq-head">
              <h2>{L('Waiting for you', '確認待ち', 'Aguardando você')} <span className={`bq-total${n ? '' : ' is-zero'}`}>{n}</span></h2>
              <button type="button" className="tor-close" onClick={() => setOpen(false)} aria-label={L('Close', '閉じる', 'Fechar')}>×</button>
            </header>
            {n > 0 && <p className="bq-order">{L('Order: late today → no cover → covered (your decision) → other exceptions by date', '順番: 本日の遅れ → 担当不在 → カバー済み（判断待ち）→ その他（日付順）', 'Ordem: atrasados de hoje → sem cobertura → cobertos (sua decisão) → demais exceções por data')}</p>}

            {queue.groups.length > 1 && (
              <div className="bq-chips" role="tablist">
                {[{ key: 'all', label: L('All', 'すべて', 'Todos'), n }, ...queue.groups.map(g => ({ key: g.key, label: GROUP_TITLE[g.key], n: g.items.length, notCounted: g.notCounted }))].map(k => (
                  <button key={k.key} type="button" role="tab" aria-selected={activeKind === k.key} className={activeKind === k.key ? 'on' : ''} onClick={() => setKind(k.key)}>
                    {k.label} · {k.n}
                  </button>
                ))}
              </div>
            )}
            {activeKind === 'all' && queue.groups.some(g => g.items.length > PREVIEW) && (
              <div className="bq-expand-all"><button type="button" className="tor-link" onClick={expandAll}>{allOpen ? L('Show summary', '概要に戻す', 'Mostrar resumo') : L(`See everything (${n})`, `すべて表示（${n}）`, `Ver tudo (${n})`)}</button></div>
            )}

            <div ref={listRef} className={`bq-list${scrolled.top ? ' is-scrolled' : ''}${scrolled.more ? ' has-more' : ''}`} onScroll={onListScroll}>
              {queue.groups.length === 0 && <div className="bq-empty">✅ {L('Nothing waiting for you', '確認待ちはありません', 'Nada aguardando você')}</div>}
              {groups.map(g => {
                const showAll = activeKind !== 'all' || expanded.has(g.key) || g.items.length <= PREVIEW
                const items = showAll ? g.items : g.items.slice(0, PREVIEW)
                return (
                  <section key={g.key} className={`bq-group${g.notCounted ? ' is-waiting' : ''}`}>
                    <h3 className="bq-group-head">
                      <span>{g.icon} {GROUP_TITLE[g.key]}</span>
                      <span className="bq-group-n">{g.items.length}</span>
                    </h3>
                    {items.map(renderOther)}
                    {activeKind === 'all' && g.items.length > PREVIEW && (
                      <button type="button" className="bq-more" onClick={() => toggleGroup(g.key)} aria-expanded={expanded.has(g.key)}>
                        {expanded.has(g.key) ? L('Show less', '少なく表示', 'Mostrar menos') : L(`Show ${g.items.length - PREVIEW} more`, `残り${g.items.length - PREVIEW}件を表示`, `Mostrar mais ${g.items.length - PREVIEW}`)}
                      </button>
                    )}
                  </section>
                )
              })}
            </div>

            <footer className="bq-foot">
              <button type="button" className="tor-btn tor-btn-sm tor-btn-ghost" onClick={openCalendar}>🗓 {L('Open calendar', 'カレンダーを開く', 'Abrir calendário')}</button>
              <button type="button" className="tor-btn tor-btn-sm tor-btn-ghost" onClick={() => setOpen(false)}>{L('Close', '閉じる', 'Fechar')}</button>
            </footer>
          </section>
        </div>
      )}
      </>, document.body)}
    </>
  )
}
