// v1.0.230 · Relatório mensal de Deep Cleaning da On The Planet (PDF para o cliente).
// v1.0.247 · Relatório mensal DO CLIENTE: any client (by client_id, client_name fallback), and the
// texts (opening, "what was done and why" per visit, closing) come from the AI — or from the
// automatic fallback below — and the admin can edit each one (resolveTexts in monthReportText.js).
// READ ONLY: reads jobs, job photos (storage jobs/<id>/start_N / end_N) and the service report
// notes (work-reports/<id>/report.json). Never writes anything to the database or storage.
//
// Hard rules (user, 13/11/2026):
//   · only DATE + START TIME of each visit — never end time, duration or hours worked;
//   · never any value (what the client pays or what the employee earns);
//   · only deep jobs with status COMPLETED; a completed visit without a BEFORE or an AFTER photo
//     is NOT in the client file — it goes to the admin's internal list "fora do relatório e por quê".
import { escapeHtml as esc } from './escapeHtml'
import { splitName } from './schedulePlan'
import { DEEP_TASKS, getCleaningType, ONTHEPLANET_CLIENT_ID, parseDeepTaskList } from './cleaningType'
import { checklistTemplateForJob, parseChecklistTemplate } from './jobChecklist'
import { safeNotes, TASK_PURPOSE } from './monthReportText'
import { isTestJob } from './testData'
import { isVideoPath } from './workMedia'

export const OTP_NAME = 'On The Planet'
export const OTP_CLIENT = { id: ONTHEPLANET_CLIENT_ID, name: OTP_NAME }
export { safeNotes }

/** "2026-11" → ["2026-11-01", "2026-11-30", 30] */
export function monthRange(month) {
  const [y, m] = String(month).split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`, last]
}

export const isOtpJob = j => !!j && (j.client_id === ONTHEPLANET_CLIENT_ID || /on\s*the\s*planet/i.test(j.client_name || ''))
const normName = s => String(s || '').toLowerCase().replace(/^(株式会社|有限会社|合同会社|k\.?\s*k\.?|kk)\s*/i, '').replace(/[\s.・,]+/g, '')
/**
 * v1.0.247 · Is this job of the client? client_id first; the client_name only for a job saved
 * without client_id (old rows). OTP keeps its own rule (isOtpJob).
 */
export function isClientJob(j, client) {
  if (!j || !client) return false
  if (client.id === ONTHEPLANET_CLIENT_ID) return isOtpJob(j)
  if (j.client_id) return j.client_id === client.id
  const a = normName(j.client_name)
  return !!a && a === normName(client.name)
}
export const isDeepJob = j => getCleaningType(j) === 'deep' && !/basic/i.test(splitName(j?.title).rest)

/** Store name of a job title: "Kodama Kinshicho — Deep Clean (AC)" → "Kodama Kinshicho". */
export function storeOf(job) {
  const base = splitName(job?.title).base
  return base.replace(/\s*[-–—]\s*deep\s*clean.*$/i, '').trim() || '—'
}

/** What was cleaned, from the title: "Deep Clean (Range Hood, AC Cleaning)" → "Range Hood, AC Cleaning". */
export function serviceOf(job) {
  const t = String(job?.title || '')
  const inner = /\(([^)]+)\)/.exec(t)
  if (inner) return inner[1].replace(/,\s*Other\b/i, '').trim()
  const rest = splitName(t).rest.replace(/^deep\s*clean\s*[-–—]?\s*/i, '').trim()
  return rest && !/^deep\s*clean$/i.test(rest) ? rest : ''
}

const ITEM_JA = { 'range hood': 'レンジフード', 'grease trap': 'グリストラップ', 'grating': 'グレーチング', 'stove': 'コンロ', 'ac cleaning': 'エアコン', 'ac': 'エアコン', 'floor scrub': '床洗浄', 'floor wax': '床ワックス', 'fryer': 'フライヤー' }
const ITEM_PT = { 'range hood': 'Coifa', 'grease trap': 'Caixa de gordura', 'grating': 'Grelha do piso', 'stove': 'Fogão', 'ac cleaning': 'Ar-condicionado', 'ac': 'Ar-condicionado', 'floor scrub': 'Lavagem do piso', 'floor wax': 'Cera no piso', 'fryer': 'Fritadeira' }
export function serviceLabel(text, lang) {
  if (!text) return ''
  const map = lang === 'ja' ? ITEM_JA : lang === 'pt' ? ITEM_PT : null
  if (!map) return text
  const of = w => map[w.toLowerCase()] || deepTaskOf(w)?.[lang] || w
  return text.split(/\s*[,、+]\s*/).map(of).join(lang === 'ja' ? '・' : ', ')
}

const deepTaskOf = label => DEEP_TASKS.find(t => t.label.toLowerCase() === String(label || '').trim().toLowerCase()
  || (t.id === 'ac' && /^ac$/i.test(String(label || '').trim())))

/** Tasks of a deep visit: [{ id|null, label }] from the title list ("Other" left out). */
export function tasksOf(job) {
  const list = parseDeepTaskList(job?.title) || (serviceOf(job) ? serviceOf(job).split(/\s*[,、]\s*/) : [])
  return list.filter(l => l && !/^other$/i.test(l)).map(l => {
    const t = deepTaskOf(l)
    return { id: t?.id || null, label: t?.label || l }
  })
}

/** Checklist of the visit as the employee had it, split in done / not done (null = not recorded). */
export function checklistOf(job) {
  const saved = String(job?.checklist_template || '').trim()
  let items = []
  try { items = parseChecklistTemplate(saved || checklistTemplateForJob(job)) } catch { items = [] }
  items = items.map(x => (typeof x === 'string' ? x : x?.label || x?.text || '')).map(x => String(x).trim()).filter(Boolean)
  const total = Number(job?.checklist_total) || 0
  const doneN = job?.checklist_done == null ? null : Number(job.checklist_done)
  if (!items.length || doneN == null) return { recorded: false, total, done: doneN, doneItems: [], missed: [] }
  const missedText = String(job?.checklist_missed_items || '')
  if (!missedText && doneN < items.length) return { recorded: true, countOnly: true, total: total || items.length, done: doneN, doneItems: [], missed: [] }
  const missed = missedText ? items.filter(l => missedText.includes(l)) : []
  return { recorded: true, total: total || items.length, done: doneN, doneItems: items.filter(l => !missed.includes(l)), missed }
}

/** Start time HH:MM (Tokyo) — from started_at; when it was never recorded, the scheduled time (flagged). */
export function startTimeOf(job) {
  if (job?.started_at) {
    const d = new Date(job.started_at)
    if (!Number.isNaN(d.getTime())) {
      return { time: d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }), recorded: true }
    }
  }
  const t = String(job?.scheduled_time || '').slice(0, 5)
  return { time: /^\d{2}:\d{2}$/.test(t) ? t : '', recorded: false }
}

/** First photo (not video) of a section from listJobMedia() output. */
export function pickPhoto(media, section) {
  return (media || []).find(m => m.kind === 'photo' && m.section === section && !isVideoPath(m.path))?.path || null
}

/**
 * Builds everything the report needs from the jobs of the month.
 * @param jobs   all jobs of the month (any client/status; filtered here)
 * @param media  Map jobId → listJobMedia()  (only completed deep OTP jobs need it)
 * @param notes  Map jobId → service-report notes text (client-facing ご報告事項)
 */
export function buildDeepMonthReport({ month, jobs, media = new Map(), notes = new Map(), client = OTP_CLIENT }) {
  const [from, to, lastDay] = monthRange(month)
  const deep = (jobs || []).filter(j => isClientJob(j, client) && isDeepJob(j) && !isTestJob(j)
    && j.scheduled_date >= from && j.scheduled_date <= to)
  const programmed = deep.filter(j => j.status !== 'cancelled')
  const completed = programmed.filter(j => j.status === 'completed')
  const notDone = programmed.filter(j => j.status !== 'completed')

  const visits = []
  const excluded = []
  for (const j of completed) {
    const m = media.get(j.id) || []
    const before = pickPhoto(m, 'before')
    const after = pickPhoto(m, 'after')
    const reasons = []
    if (!before) reasons.push('no_before')
    if (!after) reasons.push('no_after')
    if (reasons.length) { excluded.push({ job: j, store: storeOf(j), reasons }); continue }
    const st = startTimeOf(j)
    const n = safeNotes(notes.get(j.id))
    const w = safeNotes(j.notes_employee)
    const warnings = []
    if (!st.recorded) warnings.push('start_scheduled')
    if (n.removed || w.removed) warnings.push('notes_trimmed')
    const photos = m.filter(x => x.kind === 'photo' && !isVideoPath(x.path))
    visits.push({
      id: j.id, date: j.scheduled_date, start: st.time, store: storeOf(j), service: serviceOf(j),
      before, after, notes: n.text, warnings,
      tasks: tasksOf(j), checklist: checklistOf(j), workerNote: w.text,
      photoCount: { before: photos.filter(x => x.section === 'before').length, after: photos.filter(x => x.section === 'after').length },
    })
  }
  visits.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.store.localeCompare(b.store))
  excluded.sort((a, b) => a.job.scheduled_date.localeCompare(b.job.scheduled_date))

  // per store: completed deep visits (the bar chart) and how many were programmed
  const stores = new Map()
  for (const j of programmed) {
    const k = storeOf(j)
    const s = stores.get(k) || { name: k, programmed: 0, done: 0 }
    s.programmed++
    if (j.status === 'completed') s.done++
    stores.set(k, s)
  }
  const byStore = [...stores.values()].sort((a, b) => b.done - a.done || a.name.localeCompare(b.name))

  // timeline: completed visits per day of the month
  const days = Array.from({ length: lastDay }, (_, i) => ({ day: i + 1, date: `${month}-${String(i + 1).padStart(2, '0')}`, count: 0 }))
  for (const j of completed) {
    const d = Number(j.scheduled_date.slice(8, 10))
    if (days[d - 1]) days[d - 1].count++
  }

  const total = { programmed: programmed.length, done: completed.length }
  total.pct = total.programmed ? Math.round((total.done / total.programmed) * 100) : 0
  return { month, from, to, lastDay, total, byStore, days, visits, excluded, notDone, client: { id: client.id, name: client.name } }
}

// ───────────────────────────── client document (HTML, one <section class="pg"> per A4 page) ──

const TXT = {
  ja: {
    doc: 'ディープクリーニング 月次報告書', sub: 'Monthly Deep Cleaning Report', client: 'お客様', sama: '様',
    month: '対象月', period: '対象期間', issued: '発行', summary: '今月のまとめ', done: '実施済み', programmed: '予定',
    rate: '実施率', byStore: '店舗別 実施回数', timeline: '実施日（カレンダー）', visits: '回',
    detail: '作業記録（訪問ごと）', store: '店舗', date: '日付', start: '開始時刻', service: '作業内容',
    before: '作業前', after: '作業後', notes: 'ご報告事項', noNotes: '特記事項はございません。',
    closing: '完了のご報告', sign: '責任者', why: '実施内容とその目的', storeLegend: '■ 実施　□ 予定', issuer: '発行者', page: (a, b) => `${a} / ${b}`,
    thanks: '今後とも何卒よろしくお願い申し上げます。', ofPlan: (d, p) => `予定 ${p} 件中 ${d} 件`,
    dateFmt: d => { const [y, m, dd] = d.split('-').map(Number); const w = '日月火水木金土'[new Date(y, m - 1, dd).getDay()]; return `${y}年${m}月${dd}日（${w}）` },
    monthFmt: m => { const [y, mm] = m.split('-').map(Number); return `${y}年${mm}月` },
    periodFmt: (a, b) => `${a.replace(/-/g, '/')} 〜 ${b.replace(/-/g, '/')}`,
    wd: ['日', '月', '火', '水', '木', '金', '土'], legend: '■ 実施日',
  },
  pt: {
    doc: 'Relatório Mensal de Deep Cleaning', sub: 'Monthly Deep Cleaning Report', client: 'Cliente', sama: '',
    month: 'Mês', period: 'Período', issued: 'Emitido em', summary: 'Resumo do mês', done: 'Realizados', programmed: 'Programados',
    rate: '% cumprido', byStore: 'Visitas por loja', timeline: 'Dias com visita', visits: 'visitas',
    detail: 'Detalhe por visita', store: 'Loja', date: 'Data', start: 'Hora de início', service: 'Serviço',
    before: 'Antes', after: 'Depois', notes: 'Observações', noNotes: 'Sem observações.',
    closing: 'Fechamento', sign: 'Responsável', why: 'O que foi feito e por quê', storeLegend: '■ realizados  □ programados', issuer: 'Emitido por', page: (a, b) => `${a} / ${b}`,
    thanks: 'Agradecemos a confiança.', ofPlan: (d, p) => `${d} de ${p} programados`,
    dateFmt: d => { const [y, m, dd] = d.split('-').map(Number); const w = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(y, m - 1, dd).getDay()]; return `${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y} (${w})` },
    monthFmt: m => { const [y, mm] = m.split('-').map(Number); return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][mm - 1]} de ${y}` },
    periodFmt: (a, b) => `${a.split('-').reverse().join('/')} a ${b.split('-').reverse().join('/')}`,
    wd: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'], legend: '■ dia com visita',
  },
  en: {
    doc: 'Monthly Deep Cleaning Report', sub: 'KuriPuro', client: 'Client', sama: '',
    month: 'Month', period: 'Period', issued: 'Issued', summary: 'Month summary', done: 'Completed', programmed: 'Scheduled',
    rate: 'Completion', byStore: 'Visits per store', timeline: 'Days with a visit', visits: 'visits',
    detail: 'Visit details', store: 'Store', date: 'Date', start: 'Start time', service: 'Service',
    before: 'Before', after: 'After', notes: 'Notes', noNotes: 'No notes.',
    closing: 'Closing', sign: 'Person in charge', why: 'What was done and why', storeLegend: '■ completed  □ scheduled', issuer: 'Issued by', page: (a, b) => `${a} / ${b}`,
    thanks: 'Thank you for your trust.', ofPlan: (d, p) => `${d} of ${p} scheduled`,
    dateFmt: d => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
    monthFmt: m => new Date(`${m}-15T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
    periodFmt: (a, b) => `${a} – ${b}`,
    wd: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], legend: '■ day with a visit',
  },
}
export const reportText = lang => TXT[lang] || TXT.ja

// ───────────────────────────── texts: automatic fallback + the facts given to the AI ──
const taskName = (t, lang) => {
  const d = t.id ? DEEP_TASKS.find(x => x.id === t.id) : null
  return d ? (lang === 'ja' ? d.ja : lang === 'pt' ? d.pt : d.label) : t.label
}
const joinList = (list, lang) => (lang === 'ja' ? list.join('・')
  : list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${lang === 'pt' ? 'e' : 'and'} ${list[list.length - 1]}`)

/** Visit text written by the system (when the AI fails or is not called): only facts of the visit. */
export function autoVisitText(v, lang = 'ja') {
  const names = (v.tasks || []).map(t => taskName(t, lang))
  const known = (v.tasks || []).filter(t => t.id && TASK_PURPOSE[t.id]).slice(0, 2)
  const ck = v.checklist?.recorded && !v.checklist.countOnly && v.checklist.total ? v.checklist : null
  const out = []
  if (lang === 'ja') {
    out.push(names.length ? `${names.join('・')}の清掃を実施いたしました。` : 'ディープクリーニングを実施いたしました。')
    for (const t of known) out.push(`${taskName(t, 'ja')}は、${TASK_PURPOSE[t.id].ja}に実施しております。`)
    if (ck) out.push(`チェックリスト${ck.total}項目中${ck.done}項目を確認いたしました。`)
    out.push('作業前・作業後の写真を記録しております。')
  } else if (lang === 'pt') {
    out.push(names.length ? `Realizamos a limpeza de ${joinList(names, 'pt')}.` : 'Realizamos a limpeza profunda.')
    for (const t of known) out.push(`${taskName(t, 'pt')}: ${TASK_PURPOSE[t.id].pt}.`)
    if (ck) out.push(`Checklist: ${ck.done} de ${ck.total} itens conferidos.`)
    out.push('Fotos de antes e depois registradas.')
  } else {
    out.push(names.length ? `We cleaned the ${joinList(names, 'en')}.` : 'We carried out the deep cleaning.')
    for (const t of known) out.push(`${taskName(t, 'en')}: ${TASK_PURPOSE[t.id].en}.`)
    if (ck) out.push(`Checklist: ${ck.done} of ${ck.total} items checked.`)
    out.push('Before and after photos were recorded.')
  }
  return out.join(lang === 'ja' ? '' : ' ')
}

/** Opening, visits and closing written by the system from the numbers alone (fallback of the AI). */
export function autoTexts(data, { lang = 'ja', clientName = OTP_NAME, today } = {}) {
  const T = reportText(lang)
  const { done, programmed, pct } = data.total
  const stores = data.byStore.filter(s => s.done).length
  const daysOn = data.days.filter(d => d.count).length
  const left = (today && data.to >= today) ? data.notDone.length : 0
  const inPdf = data.visits.length
  const all = programmed > 0 && done >= programmed
  let intro
  let closing
  if (lang === 'ja') {
    intro = [
      `${T.monthFmt(data.month)}、${clientName}様の${stores}店舗にてディープクリーニングを${done}件実施いたしました（予定${programmed}件、実施率${pct}%）。`,
      daysOn ? `作業は${daysOn}日にわたり実施しております。` : '',
      left ? `残る${left}件も予定どおり実施してまいります。` : '',
      inPdf ? `本報告書では、作業前・作業後の写真を記録した${inPdf}件の訪問をご報告いたします。` : '',
    ].join('')
    closing = `${all ? '今月予定されていたディープクリーニングはすべて実施いたしました。' : `今月は予定${programmed}件のうち${done}件のディープクリーニングを実施いたしました。`}${inPdf && inPdf === done ? '各訪問で作業前・作業後の写真を記録しております。' : ''}${T.thanks}`
  } else if (lang === 'pt') {
    intro = [
      `Em ${T.monthFmt(data.month)}, realizamos ${done} limpezas profundas em ${stores} ${stores === 1 ? 'loja' : 'lojas'} da ${clientName} (${programmed} programadas, ${pct}% cumprido).`,
      daysOn ? `O trabalho foi feito em ${daysOn} ${daysOn === 1 ? 'dia' : 'dias'} do mês.` : '',
      left ? `As ${left} restantes seguem programadas.` : '',
      inPdf ? `Este relatório traz ${inPdf} ${inPdf === 1 ? 'visita' : 'visitas'} com fotos de antes e depois.` : '',
    ].filter(Boolean).join(' ')
    closing = `${all ? 'Neste mês, realizamos todas as limpezas profundas programadas.' : `Neste mês, realizamos ${done} das ${programmed} limpezas profundas programadas.`}${inPdf && inPdf === done ? ' Cada visita tem registro fotográfico de antes e depois.' : ''} ${T.thanks}`
  } else {
    intro = [
      `In ${T.monthFmt(data.month)} we carried out ${done} deep cleanings at ${stores} ${stores === 1 ? 'store' : 'stores'} of ${clientName} (${programmed} scheduled, ${pct}% completed).`,
      daysOn ? `The work was spread over ${daysOn} ${daysOn === 1 ? 'day' : 'days'} of the month.` : '',
      left ? `The remaining ${left} are still scheduled.` : '',
      inPdf ? `This report shows ${inPdf} ${inPdf === 1 ? 'visit' : 'visits'} with before and after photos.` : '',
    ].filter(Boolean).join(' ')
    closing = `${all ? 'This month we carried out every scheduled deep cleaning.' : `This month we carried out ${done} of the ${programmed} scheduled deep cleanings.`}${inPdf && inPdf === done ? ' Every visit has before and after photos.' : ''} ${T.thanks}`
  }
  const visits = {}
  for (const v of data.visits) visits[v.id] = autoVisitText(v, lang)
  return { intro, closing, visits }
}

/**
 * Exactly what the AI receives: facts of the month, no time of day, no duration, no value,
 * no employee names. Start times are not sent either (the PDF shows them, the texts never do).
 */
export function aiFacts(data, { lang = 'ja', clientName = OTP_NAME, today } = {}) {
  const T = reportText('en')
  const taskCounts = {}
  for (const v of data.visits) for (const t of v.tasks || []) taskCounts[t.label] = (taskCounts[t.label] || 0) + 1
  return {
    lang,
    client: clientName,
    month: data.month,
    month_label: reportText(lang).monthFmt(data.month),
    today: today || null,
    month_finished: !today || data.to < today,
    totals: {
      scheduled: data.total.programmed, completed: data.total.done, completion_pct: data.total.pct,
      still_scheduled: data.notDone.length, visits_in_report_with_before_after_photos: data.visits.length,
    },
    stores: data.byStore.map(s => ({ name: s.name, completed: s.done, scheduled: s.programmed })),
    days_with_a_visit: data.days.filter(d => d.count).map(d => d.date),
    task_counts_in_report: taskCounts,
    visits: data.visits.map(v => ({
      id: v.id, store: v.store, date: v.date, weekday: T.dateFmt(v.date).split(',')[0],
      tasks: (v.tasks || []).map(t => ({ name: t.label, purpose: (t.id && TASK_PURPOSE[t.id]?.en) || null })),
      checklist: v.checklist?.recorded
        ? (v.checklist.countOnly ? { checked: v.checklist.done, total: v.checklist.total }
          : { checked: v.checklist.done, total: v.checklist.total, done_items: v.checklist.doneItems.slice(0, 30), not_done_items: v.checklist.missed })
        : 'not recorded',
      photos: { before: v.photoCount?.before || 1, after: v.photoCount?.after || 1 },
      client_notes: v.notes || '',
      field_worker_note: v.workerNote || '',
    })),
  }
}

const textOf = x => (typeof x === 'string' ? x : x?.text || '')

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e9edf3}
body{font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",Meiryo,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b2536;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg{width:794px;height:1123px;margin:0 auto 18px;background:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column}
.bar{background:#1f3a5f;color:#fff;padding:14px 40px;display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:.04em}
.bar b{font-size:14px;letter-spacing:.02em}
.body{flex:1;padding:30px 40px 0;display:flex;flex-direction:column;min-height:0}
.foot{padding:12px 40px 18px;display:flex;justify-content:space-between;font-size:10px;color:#7a8699;border-top:1px solid #e3e8ef;margin:0 40px}
.foot{padding-left:0;padding-right:0}
h2{font-size:19px;color:#1f3a5f;margin-bottom:16px;display:flex;align-items:center;gap:10px}
h2:before{content:"";width:6px;height:22px;border-radius:3px;background:#2f6fde;display:inline-block}
h3{font-size:13px;color:#46536a;margin:0 0 10px;font-weight:700;letter-spacing:.03em}
/* cover */
.cover{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:70px 64px 56px;background:linear-gradient(160deg,#1f3a5f 0%,#24497a 58%,#2f6fde 100%);color:#fff}
.logo{display:flex;align-items:center;gap:14px}
.logo .k{width:58px;height:58px;border-radius:16px;background:#2f6fde;border:2px solid rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff}
.logo .nm{font-size:30px;font-weight:800;letter-spacing:.01em}
.logo .by{font-size:12px;opacity:.75;margin-top:2px}
.cover .ttl{font-size:38px;font-weight:800;line-height:1.25;margin-top:8px}
.cover .st{font-size:15px;opacity:.8;margin-top:10px;letter-spacing:.05em}
.cover .cl{background:#fff;color:#1b2536;border-radius:14px;padding:26px 30px;display:grid;grid-template-columns:110px 1fr;row-gap:12px;font-size:15px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
.cover .cl span{color:#6a768a;font-size:13px;align-self:center}
.cover .cl b{font-size:17px}
.cover .cl .big{font-size:24px}
/* summary */
.lead{font-size:13px;line-height:1.75;color:#2b3648;background:#f2f6fc;border-left:4px solid #2f6fde;border-radius:0 10px 10px 0;padding:11px 16px;margin:-4px 0 16px;white-space:pre-line}
.kpis{display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:14px;margin-bottom:20px}
.kpi{border:1px solid #dfe5ee;border-radius:12px;padding:16px 18px;background:#f7f9fc}
.kpi small{display:block;font-size:12px;color:#5d6a80;margin-bottom:6px}
.kpi b{font-size:34px;color:#1f3a5f;line-height:1}
.kpi b i{font-style:normal;font-size:15px;color:#5d6a80;margin-left:4px}
.kpi.rate{background:#1f3a5f;border-color:#1f3a5f;color:#fff}
.kpi.rate small{color:#c9d6ea}.kpi.rate b{color:#fff}
.meter{height:10px;border-radius:5px;background:rgba(255,255,255,.22);margin-top:12px;overflow:hidden}
.meter div{height:100%;background:#4ade80;border-radius:5px}
.kpi.rate em{display:block;font-style:normal;font-size:11px;color:#c9d6ea;margin-top:7px}
.bars{display:flex;flex-direction:column;gap:7px;margin-bottom:20px}
.brow{display:grid;grid-template-columns:200px 1fr 54px;align-items:center;gap:12px;font-size:13px}
.brow .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#2b3648}
.brow .tr{height:18px;background:transparent;border-radius:5px;overflow:hidden}
.brow .tr .pl{height:100%;background:#e3eaf5;border:1px dashed #b8c7de;border-radius:5px;overflow:hidden}
.brow .tr .pl div{height:100%;background:linear-gradient(90deg,#2f6fde,#4b8bf0);border-radius:4px}
.brow .n i{font-style:normal;font-weight:400;color:#8a95a6}
.brow .n{font-weight:700;color:#1f3a5f;text-align:right}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.cal .wd{font-size:11px;color:#7a8699;text-align:center;padding-bottom:2px}
.cal .d{height:38px;border-radius:8px;border:1px solid #e3e8ef;background:#fbfcfe;font-size:12px;color:#9aa5b5;padding:5px 7px;position:relative}
.cal .d.on{background:#e7f0ff;border-color:#9fc0f7;color:#1f3a5f;font-weight:700}
.cal .d.on i{position:absolute;right:6px;bottom:5px;font-style:normal;font-size:11px;background:#2f6fde;color:#fff;border-radius:9px;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px}
.cal .d.x{visibility:hidden}
.lg{font-size:11px;color:#2f6fde;margin-top:8px}
/* visit */
.visit{border:1px solid #dfe5ee;border-radius:12px;padding:16px 18px 14px;margin-bottom:16px}
.vh{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.vh .s{font-size:17px;font-weight:800;color:#1f3a5f}
.vh .sv{font-size:12px;color:#5d6a80;margin-top:3px}
.vh .when{text-align:right;font-size:12px;color:#5d6a80;white-space:nowrap}
.vh .when b{display:block;font-size:14px;color:#1b2536}
.ph{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ph figure{position:relative;border-radius:9px;overflow:hidden;background:#eef2f7;height:232px}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph figcaption{position:absolute;left:8px;top:8px;background:rgba(18,32,55,.82);color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;letter-spacing:.04em}
.ph figure.a figcaption{background:#16a34a}
.nt{margin-top:11px;font-size:12px;line-height:1.65;color:#2b3648;background:#f7f9fc;border-radius:8px;padding:9px 12px}
.nt span{display:block;font-size:11px;color:#6a768a;font-weight:700;margin-bottom:2px}
.nt.empty{color:#8a95a6}
.why{margin-top:10px;font-size:12.5px;line-height:1.7;color:#1b2536;border-left:3px solid #16a34a;padding:2px 0 2px 12px;white-space:pre-line}
.why span{display:block;font-size:11px;color:#15803d;font-weight:700;margin-bottom:2px;letter-spacing:.03em}
/* closing */
.close{border:1px solid #dfe5ee;border-radius:14px;padding:30px 32px;font-size:15px;line-height:1.9;background:#f7f9fc;white-space:pre-line}
.close .ok{font-size:44px;color:#16a34a;line-height:1;margin-bottom:12px}
.sig{margin-top:40px;display:flex;justify-content:flex-end}
.sig .box{min-width:330px;font-size:13px;text-align:right}
.sig .ln{border-top:1px solid #1b2536;margin:4px 0 10px}
.sig img{display:block;height:84px;margin:0 0 6px auto;object-fit:contain}
.sig .blank{height:84px}
.iss{margin-top:34px;font-size:12px;color:#5d6a80;line-height:1.7}
@media print{html,body{background:#fff}.pg{margin:0;page-break-after:always;break-after:page}}
@page{size:A4;margin:0}
`

/** How many visits fit on one page (two when notes are short). */
function chunkVisits(visits, whyOf = () => '') {
  const pages = []
  let cur = []
  for (const v of visits) {
    const long = (v.notes || '').length + whyOf(v).length > 380
    if (long) { if (cur.length) pages.push(cur); pages.push([v]); cur = []; continue }
    cur.push(v)
    if (cur.length === 2) { pages.push(cur); cur = [] }
  }
  if (cur.length) pages.push(cur)
  return pages
}

/**
 * Full client document. `images` maps a storage path → src to use (data URL after shrinking);
 * when missing, `srcOf(path)` builds the public URL.
 */
export function deepMonthReportHtml(data, { lang = 'ja', clientName = OTP_NAME, issuedOn, signature, signer, issuer, srcOf = p => p, images = new Map(), texts } = {}) {
  const T = reportText(lang)
  const src = p => images.get(p) || srcOf(p)
  // v1.0.247 · texts = resolveTexts() output (or plain strings); missing → automatic text.
  const auto = texts ? null : autoTexts(data, { lang, clientName })
  const intro = texts ? textOf(texts.intro) : auto.intro
  const closingText = texts ? textOf(texts.closing) : auto.closing
  const whyOf = v => (texts ? textOf(texts.visits?.[v.id]) : auto.visits[v.id]) || ''
  const visitPages = chunkVisits(data.visits, whyOf)
  const totalPages = 2 + visitPages.length + 1
  let n = 0
  const head = right => `<div class="bar"><b>KuriPuro</b><span>${esc(right)}</span></div>`
  const foot = () => `<div class="foot"><span>${esc(T.doc)} · ${esc(clientName)}${T.sama ? ` ${T.sama}` : ''} · ${esc(T.monthFmt(data.month))}</span><span>${esc(T.page(++n, totalPages))}</span></div>`

  n++
  const cover = `<section class="pg"><div class="cover">
  <div class="logo"><div class="k">K</div><div><div class="nm">KuriPuro</div><div class="by">by JBM</div></div></div>
  <div><div class="ttl">${esc(T.doc)}</div><div class="st">${esc(T.sub)}</div></div>
  <div class="cl">
    <span>${esc(T.client)}</span><b class="big">${esc(clientName)}${T.sama ? ` ${T.sama}` : ''}</b>
    <span>${esc(T.month)}</span><b>${esc(T.monthFmt(data.month))}</b>
    <span>${esc(T.period)}</span><b>${esc(T.periodFmt(data.from, data.to))}</b>
    ${issuedOn ? `<span>${esc(T.issued)}</span><b>${esc(T.dateFmt(issuedOn))}</b>` : ''}
  </div></div></section>`

  const max = Math.max(1, ...data.byStore.map(s => s.programmed))
  const bars = data.byStore.map(s => `<div class="brow"><div class="nm">${esc(s.name)}</div><div class="tr"><div class="pl" style="width:${Math.max(6, Math.round((s.programmed / max) * 100))}%"><div style="width:${s.programmed ? Math.round((s.done / s.programmed) * 100) : 0}%"></div></div></div><div class="n">${s.done}<i> / ${s.programmed}</i></div></div>`).join('')
  const [y, m] = data.month.split('-').map(Number)
  const lead = new Date(y, m - 1, 1).getDay()
  const cal = T.wd.map(w => `<div class="wd">${esc(w)}</div>`).join('')
    + Array.from({ length: lead }, () => '<div class="d x"></div>').join('')
    + data.days.map(d => `<div class="d${d.count ? ' on' : ''}">${d.day}${d.count ? `<i>${d.count}</i>` : ''}</div>`).join('')
  const summary = `<section class="pg">${head(T.summary)}<div class="body">
  <h2>${esc(T.summary)} — ${esc(T.monthFmt(data.month))}</h2>
  ${intro ? `<div class="lead">${esc(intro)}</div>` : ''}
  <div class="kpis">
    <div class="kpi"><small>${esc(T.done)}</small><b>${data.total.done}<i>${esc(T.visits)}</i></b></div>
    <div class="kpi"><small>${esc(T.programmed)}</small><b>${data.total.programmed}<i>${esc(T.visits)}</i></b></div>
    <div class="kpi rate"><small>${esc(T.rate)}</small><b>${data.total.pct}%</b><div class="meter"><div style="width:${Math.min(100, data.total.pct)}%"></div></div><em>${esc(T.ofPlan(data.total.done, data.total.programmed))}</em></div>
  </div>
  <h3>${esc(T.byStore)} <span style="font-weight:400;color:#7a8699;font-size:11px;margin-left:8px">${esc(T.storeLegend)}</span></h3><div class="bars">${bars}</div>
  <h3>${esc(T.timeline)}</h3><div class="cal">${cal}</div><div class="lg">${esc(T.legend)}</div>
  </div>${foot()}</section>`

  const visitHtml = v => `<div class="visit">
  <div class="vh"><div><div class="s">${esc(v.store)}</div>${v.service ? `<div class="sv">${esc(T.service)}：${esc(serviceLabel(v.service, lang))}</div>` : ''}</div>
  <div class="when">${esc(T.date)}<b>${esc(T.dateFmt(v.date))}</b>${v.start ? `${esc(T.start)} <b style="display:inline">${esc(v.start)}</b>` : ''}</div></div>
  <div class="ph"><figure><img src="${esc(src(v.before))}" alt=""><figcaption>${esc(T.before)}</figcaption></figure><figure class="a"><img src="${esc(src(v.after))}" alt=""><figcaption>${esc(T.after)}</figcaption></figure></div>
  ${whyOf(v) ? `<div class="why"><span>${esc(T.why)}</span>${esc(whyOf(v))}</div>` : ''}
  ${v.notes ? `<div class="nt"><span>${esc(T.notes)}</span>${esc(v.notes).replace(/\n/g, '<br>')}</div>` : (whyOf(v) ? '' : `<div class="nt empty"><span>${esc(T.notes)}</span>${esc(T.noNotes)}</div>`)}
  </div>`
  const detail = visitPages.map((list, i) => `<section class="pg">${head(T.detail)}<div class="body">${i === 0 ? `<h2>${esc(T.detail)}</h2>` : ''}${list.map(visitHtml).join('')}</div>${foot()}</section>`).join('')

  const iss = issuer || {}
  const closing = `<section class="pg">${head(T.closing)}<div class="body">
  <h2>${esc(T.closing)}</h2>
  <div class="close"><div class="ok">✓</div>${esc(closingText)}</div>
  <div class="sig"><div class="box">${signature ? `<img src="${esc(signature)}" alt="">` : '<div class="blank"></div>'}<div class="ln"></div>${esc(T.sign)}&nbsp;&nbsp;<b>${esc(signer || '')}</b></div></div>
  <div class="iss">${esc(T.issuer)}：${esc([iss.company, iss.title && iss.name ? `${iss.title} ${iss.name}` : iss.name].filter(Boolean).join(' · '))}<br>${esc([iss.address, iss.phone, iss.email].filter(Boolean).join(' · '))}</div>
  </div>${foot()}</section>`

  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=820"><title>${esc(T.doc)} · ${esc(clientName)} · ${esc(data.month)}</title><style>${CSS}</style></head><body>${cover}${summary}${detail}${closing}</body></html>`
}

/** Reason texts for the admin's internal list (never in the client file). */
export const REASONS = {
  no_before: ['No BEFORE photo', '作業前の写真なし', 'Sem foto de ANTES'],
  no_after: ['No AFTER photo', '作業後の写真なし', 'Sem foto de DEPOIS'],
  start_scheduled: ['Start was not recorded — the scheduled time is shown', '開始時刻の記録なし（予定時刻を表示）', 'Início não registrado — aparece o horário agendado'],
  notes_trimmed: ['A sentence with time/duration/value was removed from the notes', '時間・金額を含む文を備考から削除', 'Uma frase com horário/duração/valor foi tirada das observações'],
}
REASONS.before_unreadable = ['The BEFORE photo could not be opened', '作業前の写真が開けません', 'A foto de ANTES não abre']
REASONS.after_unreadable = ['The AFTER photo could not be opened', '作業後の写真が開けません', 'A foto de DEPOIS não abre']
