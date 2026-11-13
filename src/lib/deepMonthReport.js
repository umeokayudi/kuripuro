// v1.0.234 · Monthly Deep Cleaning report for a client (made for On The Planet, works for any client
// with deep items in the contract). One printable page set, saved as PDF from the browser:
//   cover with the month's numbers and a chart per store → one block per store with every deep
//   service done: what was cleaned, the day and the START time, photos before / after.
// By the owner's rule this report NEVER shows the finish time, how long it took, or any value.
import { supabase } from './supabase'
import { deepMonthProgress, deepItemName, deepSubtypes, monthBounds, pct } from './deepMonthProgress'
import { splitName } from './schedulePlan'
import { mediaForJobs } from './workMedia'
import { storagePublicUrl } from './workReport'
import { QUOTE_ISSUER } from './quoteIssuer'

const JOB_FIELDS = 'id,title,client_id,client_name,scheduled_date,scheduled_time,status,job_category,spot_status,started_at,photo_start_url,photo_end_url'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const TXT = {
  ja: {
    title: 'ディープクリーニング 月次報告書', month: (y, m) => `${y}年${m}月分`, to: '御中', summary: '今月の実施状況', done: '実施済み', planned: '契約回数', rate: '実施率',
    scheduled: '予定あり', missing: '未実施', byStore: '店舗別の実施状況', byItem: '作業別の実施状況', services: '実施した作業', date: '実施日', start: '開始時刻',
    before: '作業前', after: '作業後', noPhoto: '写真なし', none: 'この月に実施済みのディープクリーニングはありません。', issued: '発行日', extra: '契約外の追加作業', store: '店舗',
    note: '本報告書は実施日・開始時刻・写真のみを記載しています。', weekday: ['日', '月', '火', '水', '木', '金', '土'],
  },
  pt: {
    title: 'Relatório mensal de Deep Cleaning', month: (y, m) => `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][m - 1]} de ${y}`, to: '', summary: 'Resumo do mês', done: 'Feitos', planned: 'Previstos no contrato', rate: 'Realizado',
    scheduled: 'Agendados', missing: 'Faltando', byStore: 'Por loja', byItem: 'Por tipo de serviço', services: 'Serviços realizados', date: 'Data', start: 'Início',
    before: 'Antes', after: 'Depois', noPhoto: 'sem foto', none: 'Nenhum Deep Cleaning concluído neste mês.', issued: 'Emitido em', extra: 'Serviços extras (fora do contrato)', store: 'Loja',
    note: 'Este relatório mostra a data, a hora de início e as fotos de cada serviço.', weekday: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  },
  en: {
    title: 'Monthly Deep Cleaning report', month: (y, m) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`, to: '', summary: 'Month summary', done: 'Done', planned: 'In the contract', rate: 'Completed',
    scheduled: 'Scheduled', missing: 'Missing', byStore: 'By store', byItem: 'By type of service', services: 'Services done', date: 'Date', start: 'Start',
    before: 'Before', after: 'After', noPhoto: 'no photo', none: 'No Deep Cleaning completed in this month.', issued: 'Issued on', extra: 'Extra services (outside the contract)', store: 'Store',
    note: 'This report shows the date, the start time and the photos of each service.', weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
}
export const deepReportText = lang => TXT[lang] || TXT.ja

/** Start time in Tokyo, "HH:mm". Real start when the team pressed Start, else the booked time. */
export function startTimeOf(job) {
  if (job.started_at) {
    const d = new Date(job.started_at)
    if (!Number.isNaN(d.getTime())) return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(String(job.scheduled_time || ''))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

export function dayLabel(date, lang) {
  const [y, m, d] = String(date).split('-').map(Number)
  const wd = deepReportText(lang).weekday[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return lang === 'ja' ? `${m}月${d}日（${wd}）` : lang === 'pt' ? `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${wd})` : `${wd} ${d}/${m}`
}

/** What was cleaned, from the job title: "Ibushio — Deep Clean (Range Hood, AC)" → "Range Hood · AC" in the report language. */
export function serviceLabel(title, lang) {
  const { rest } = splitName(title)
  const ids = [...new Set(deepSubtypes(rest).map(h => h.id))]
  return ids.length ? ids.map(id => deepItemName(id, lang)).join(' · ') : (rest || title || '')
}

/**
 * Pure: builds the report data from the month's progress + media. Only what the client may see.
 * @returns {{ client, month, totals, stores: [{ name, totals, items, services: [{ date, start, label, before:[], after:[] }] }], extras, byItem }}
 */
export function buildDeepMonthReport({ progress, media = new Map(), month, lang = 'ja' }) {
  const photos = (jobId, section) => (media.get(jobId) || []).filter(m => m.kind === 'photo' && m.section === section).map(m => m.path)
  const service = job => ({ job_id: job.id, date: job.scheduled_date, start: startTimeOf(job), label: serviceLabel(job.title, lang), before: photos(job.id, 'before'), after: photos(job.id, 'after') })
  const stores = (progress?.stores || []).map(st => {
    const seen = new Set()
    const done = []
    for (const it of st.items) for (const j of it.jobs) if (j.status === 'completed' && !seen.has(j.id)) { seen.add(j.id); done.push(j) }
    done.sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)) || startTimeOf(a).localeCompare(startTimeOf(b)))
    return {
      name: st.name, totals: st.totals,
      items: st.items.map(i => ({ id: i.id, name: deepItemName(i.id, lang), times: i.times, done: i.done, scheduled: i.scheduled, missing: i.missing })),
      services: done.map(service),
    }
  })
  const byItem = {}
  for (const st of stores) for (const i of st.items) {
    const b = byItem[i.id] || (byItem[i.id] = { id: i.id, name: i.name, times: 0, done: 0 })
    b.times += i.times; b.done += i.done
  }
  const extras = (progress?.extras || []).filter(j => j.status === 'completed')
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
    .map(j => ({ ...service(j), store: splitName(j.title).base }))
  return { client: progress?.clientName || '', month, totals: progress?.totals || { expected: 0, done: 0, scheduled: 0, missing: 0 }, stores, byItem: Object.values(byItem), extras }
}

/** Loads everything for one client and month (read only). */
export async function loadDeepMonthReport(clientId, month, { lang = 'ja', onProgress } = {}) {
  const [from, to] = monthBounds(month)
  const [c, cl, j] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true).eq('client_id', clientId),
    supabase.from('clients').select('id,company_name,is_active').eq('id', clientId),
    supabase.from('jobs').select(JOB_FIELDS).eq('client_id', clientId).gte('scheduled_date', from).lte('scheduled_date', to).neq('status', 'cancelled').limit(3000),
  ])
  const failed = [c, cl, j].find(r => r.error)
  if (failed) throw new Error(failed.error.message)
  const progress = deepMonthProgress(c.data || [], cl.data || [], j.data || [])[0] || { clientName: cl.data?.[0]?.company_name || '', stores: [], totals: { expected: 0, done: 0, scheduled: 0, missing: 0 }, extras: [] }
  const doneJobs = [...progress.stores.flatMap(s => s.items.flatMap(i => i.jobs)), ...(progress.extras || [])].filter(x => x.status === 'completed')
  const media = await mediaForJobs([...new Map(doneJobs.map(x => [x.id, x])).values()], { onProgress })
  return buildDeepMonthReport({ progress, media, month, lang })
}

// ── charts (inline SVG, print-safe) ─────────────────────────────────────────
function ring(value, size = 132) {
  const r = (size - 16) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value))
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${v}%">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e7eaf0" stroke-width="12"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#0b0f19" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="30" font-weight="700" fill="#0b0f19">${v}%</text></svg>`
}
function bars(rows, t) {
  const max = Math.max(1, ...rows.map(r => r.times))
  return `<div class="bars">${rows.map(r => {
    const w = (r.times / max) * 100
    const done = r.times ? (r.done / r.times) * 100 : 0
    return `<div class="bar-row"><div class="bar-name">${esc(r.name)}</div><div class="bar-track" style="width:${w}%"><div class="bar-fill" style="width:${done}%"></div></div><div class="bar-num"><b>${r.done}</b> / ${r.times}</div></div>`
  }).join('')}</div><div class="legend"><span><i class="lg-done"></i>${esc(t.done)}</span><span><i class="lg-plan"></i>${esc(t.planned)}</span></div>`
}

const CSS = `
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#e9edf3;color:#0b0f19;font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',Meiryo,-apple-system,'Segoe UI',sans-serif;font-size:12.5px;line-height:1.55}
.page{background:#fff;width:210mm;min-height:297mm;margin:12px auto;padding:16mm 15mm;page-break-after:always;break-after:page}
.page:last-child{page-break-after:auto;break-after:auto}
.kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;font-weight:700}
h1{font-size:26px;margin:6px 0 2px;letter-spacing:-.01em}h2{font-size:16px;margin:0 0 10px}h3{font-size:14px;margin:0}
.sub{color:#4b5563;font-size:14px}.client{font-size:18px;font-weight:700;margin-top:18px}
.hero{display:flex;gap:22px;align-items:center;border:1px solid #e7eaf0;border-radius:14px;padding:18px;margin:20px 0}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;flex:1}
.kpi{border:1px solid #e7eaf0;border-radius:10px;padding:10px 12px}.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums;line-height:1.1}.kpi span{font-size:11px;color:#6b7280}
.block{margin-top:20px}.bars{display:flex;flex-direction:column;gap:7px}
.bar-row{display:grid;grid-template-columns:38mm 1fr 18mm;align-items:center;gap:8px}.bar-name{font-size:12px;overflow-wrap:anywhere}
.bar-track{height:12px;background:#e7eaf0;border-radius:6px;overflow:hidden;min-width:6px}.bar-fill{height:100%;background:#0b0f19;border-radius:6px}
.bar-num{font-size:12px;text-align:right;font-variant-numeric:tabular-nums;color:#4b5563}.bar-num b{color:#0b0f19}
.legend{display:flex;gap:14px;font-size:11px;color:#6b7280;margin-top:8px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}.lg-done{background:#0b0f19}.lg-plan{background:#e7eaf0}
.store-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0b0f19;padding-bottom:8px;margin-bottom:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}.chip{border:1px solid #e7eaf0;border-radius:999px;padding:3px 10px;font-size:11.5px}.chip.ok{background:#0b0f19;color:#fff;border-color:#0b0f19}
.svc{border:1px solid #e7eaf0;border-radius:12px;padding:12px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}
.svc-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:8px}.svc-when{font-size:12px;color:#4b5563;white-space:nowrap}.svc-when b{color:#0b0f19}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.side-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:4px}
.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:4px}.photos.one{grid-template-columns:1fr}
.photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block;background:#f1f3f7}
.nophoto{border:1px dashed #d9dde6;border-radius:6px;aspect-ratio:4/3;display:grid;place-items:center;color:#9aa3b2;font-size:11px}
.foot{margin-top:18px;font-size:10.5px;color:#6b7280;border-top:1px solid #e7eaf0;padding-top:8px;display:flex;justify-content:space-between;gap:12px}
.empty{color:#6b7280;padding:18px;border:1px dashed #d9dde6;border-radius:12px;text-align:center}
@page{size:A4;margin:0}@media print{body{background:#fff}.page{margin:0;width:auto;min-height:0}}
@media screen and (max-width:820px){.page{width:auto;min-height:0;margin:8px;padding:18px}.hero{flex-direction:column;align-items:stretch}.kpis{grid-template-columns:1fr 1fr}.bar-row{grid-template-columns:30mm 1fr 14mm}}
`

/** Printable HTML (A4). `photoUrl` turns a storage path into a URL (default: public URL). */
export function deepMonthReportHtml(report, { lang = 'ja', photoUrl = storagePublicUrl, issuedOn = '' } = {}) {
  const t = deepReportText(lang)
  const [y, m] = String(report.month).split('-').map(Number)
  const tot = report.totals
  const side = (label, paths) => `<div><div class="side-label">${esc(label)}</div>${paths.length
    ? `<div class="photos${paths.length === 1 ? ' one' : ''}">${paths.slice(0, 4).map(p => `<img src="${esc(photoUrl(p))}" alt="${esc(label)}" loading="eager">`).join('')}</div>`
    : `<div class="nophoto">${esc(t.noPhoto)}</div>`}</div>`
  const svc = (s, withStore = false) => `<div class="svc"><div class="svc-top"><h3>${esc(withStore && s.store ? `${s.store} — ` : '')}${esc(s.label)}</h3>
    <div class="svc-when">${esc(t.date)} <b>${esc(dayLabel(s.date, lang))}</b>${s.start ? ` · ${esc(t.start)} <b>${esc(s.start)}</b>` : ''}</div></div>
    <div class="pair">${side(t.before, s.before)}${side(t.after, s.after)}</div></div>`
  const foot = `<div class="foot"><span>${esc(QUOTE_ISSUER.company)} · KuriPuro</span><span>${esc(t.note)}</span></div>`
  const cover = `<section class="page">
    <div class="kicker">KuriPuro</div><h1>${esc(t.title)}</h1><div class="sub">${esc(t.month(y, m))}${issuedOn ? ` · ${esc(t.issued)} ${esc(issuedOn)}` : ''}</div>
    <div class="client">${esc(report.client)}${t.to ? ` ${esc(t.to)}` : ''}</div>
    <div class="hero">${ring(pct(tot))}<div class="kpis">
      <div class="kpi"><b>${tot.done}</b><span>${esc(t.done)}</span></div><div class="kpi"><b>${tot.expected}</b><span>${esc(t.planned)}</span></div>
      <div class="kpi"><b>${tot.scheduled}</b><span>${esc(t.scheduled)}</span></div><div class="kpi"><b>${tot.missing}</b><span>${esc(t.missing)}</span></div></div></div>
    ${report.stores.length ? `<div class="block"><h2>${esc(t.byStore)}</h2>${bars(report.stores.map(s => ({ name: s.name, times: s.totals.expected, done: s.totals.done })), t)}</div>` : ''}
    ${report.byItem.length ? `<div class="block"><h2>${esc(t.byItem)}</h2>${bars(report.byItem, t)}</div>` : ''}
    ${!report.stores.some(s => s.services.length) && !report.extras.length ? `<div class="block empty">${esc(t.none)}</div>` : ''}
    ${foot}</section>`
  const storePages = report.stores.filter(s => s.services.length).map(s => `<section class="page">
    <div class="store-head"><div><div class="kicker">${esc(t.store)}</div><h2 style="margin:2px 0 0;font-size:20px">${esc(s.name)}</h2></div><div class="sub"><b>${s.totals.done}</b> / ${s.totals.expected} · ${esc(t.month(y, m))}</div></div>
    <div class="chips">${s.items.map(i => `<span class="chip${i.done >= i.times ? ' ok' : ''}">${esc(i.name)} ${i.done}/${i.times}</span>`).join('')}</div>
    ${s.services.map(x => svc(x)).join('')}${foot}</section>`).join('')
  const extraPage = report.extras.length ? `<section class="page"><div class="store-head"><h2 style="margin:0;font-size:20px">${esc(t.extra)}</h2></div>${report.extras.map(x => svc(x, true)).join('')}${foot}</section>` : ''
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`${t.title} ${report.client} ${report.month}`)}</title><style>${CSS}</style></head><body>${cover}${storePages}${extraPage}</body></html>`
}
